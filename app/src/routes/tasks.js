import { query, withTx } from '../db/pool.js';
import { requireUser, visibleProjectIds } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { emitTaskEvent } from '../services/events.js';
import { branchNameForTask } from '../util/slug.js';
import { checkoutTaskBranch, commitAndPush } from '../services/docker.js';
import { sendTelegram, escapeHtml } from '../services/telegram.js';

export default async function taskRoutes(app) {
  app.addHook('preHandler', requireUser);

  // ---------- List tasks (filtered by visibility) ----------

  app.get('/api/tasks', async (req) => {
    const visible = await visibleProjectIds(req.user);
    const status = req.query?.status;
    const params = [];
    const where = [];

    if (visible !== null) {
      if (visible.length === 0) return { tasks: [] };
      params.push(visible);
      where.push(`t.project_id = ANY($${params.length}::bigint[])`);
    }
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }

    const sql = `
      SELECT t.*,
             p.name AS project_name,
             p.slug AS project_slug,
             p.github_repo,
             u.username AS assigned_to_username,
             (SELECT COUNT(*)::int FROM task_comments WHERE task_id = t.id) AS comment_count
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assigned_to
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.created_at DESC
    `;
    const { rows } = await query(sql, params);
    return { tasks: rows };
  });

  // ---------- Create task (admins only) ----------

  app.post('/api/tasks', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const { project_id, title, description = null } = req.body || {};
    if (!project_id || !title) return reply.code(400).send({ error: 'project_id and title required' });

    const task = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO tasks (project_id, title, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [project_id, title, description, req.user.id],
      );
      await client.query(
        `INSERT INTO task_events (task_id, actor_id, event_type, to_status)
         VALUES ($1, $2, 'created', 'open')`,
        [rows[0].id, req.user.id],
      );
      return rows[0];
    });

    await audit({ actorId: req.user.id, action: 'task.create', target: `task:${task.id}`, payload: { title, project_id } });
    return { task };
  });

  // ---------- Claim a task ----------

  app.post('/api/tasks/:id/claim', async (req, reply) => {
    const taskId = Number(req.params.id);

    const txResult = await withTx(async (client) => {
      const { rows: tRows } = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [taskId]);
      const task = tRows[0];
      if (!task) throw httpError(404, 'task not found');
      if (task.status !== 'open') throw httpError(409, `task is ${task.status}, not open`);

      if (req.user.role !== 'admin') {
        const { rows: active } = await client.query(
          `SELECT id FROM tasks WHERE assigned_to = $1 AND status IN ('in_progress','submitted') LIMIT 1`,
          [req.user.id],
        );
        if (active.length) throw httpError(409, 'you already have an active task');
      }

      const { rows: pRows } = await client.query(`SELECT * FROM projects WHERE id = $1`, [task.project_id]);
      const project = pRows[0];
      if (!project) throw httpError(500, 'project missing');

      if (req.user.access_scope === 'scoped') {
        const { rows: scope } = await client.query(
          `SELECT 1 FROM user_projects WHERE user_id = $1 AND project_id = $2`,
          [req.user.id, project.id],
        );
        if (!scope.length) throw httpError(403, 'project not in your scope');
      }

      const { rows: wRows } = await client.query(`SELECT * FROM workspaces WHERE user_id = $1`, [req.user.id]);
      const workspace = wRows[0];
      if (!workspace) throw httpError(409, 'no workspace provisioned for you yet — ask admin');

      const branch = branchNameForTask(task);

      const { rows: updated } = await client.query(
        `UPDATE tasks
           SET status = 'in_progress', assigned_to = $1, branch_name = $2, claimed_at = NOW()
         WHERE id = $3 RETURNING *`,
        [req.user.id, branch, taskId],
      );
      await client.query(`UPDATE workspaces SET current_task_id = $1 WHERE id = $2`, [taskId, workspace.id]);

      await emitTaskEvent({
        taskId, actorId: req.user.id,
        eventType: 'claimed', fromStatus: 'open', toStatus: 'in_progress',
        metadata: { branch },
      }, client);

      return { task: updated[0], project, workspace };
    }).catch((err) => {
      if (err.statusCode) { reply.code(err.statusCode).send({ error: err.message }); return null; }
      throw err;
    });
    if (!txResult) return;
    const { task, project, workspace } = txResult;

    try {
      await checkoutTaskBranch({
        containerName: workspace.container_name,
        project,
        branchName: task.branch_name,
      });
    } catch (err) {
      console.error('[claim] docker checkout failed:', err.message);
      await query(
        `UPDATE tasks SET status='open', assigned_to=NULL, branch_name=NULL, claimed_at=NULL WHERE id=$1`,
        [taskId],
      );
      await query(`UPDATE workspaces SET current_task_id=NULL WHERE id=$1`, [workspace.id]);
      await emitTaskEvent({
        taskId, actorId: req.user.id, eventType: 'claim_rollback',
        toStatus: 'open', metadata: { reason: err.message },
      });
      return reply.code(500).send({ error: 'failed to prepare workspace: ' + err.message });
    }

    await audit({
      actorId: req.user.id, action: 'task.claim', target: `task:${task.id}`,
      payload: { branch: task.branch_name, project: project.slug },
    });

    return {
      task,
      workspace_url: `https://${workspace.subdomain}.${process.env.PUBLIC_DOMAIN}`,
      ide_password: workspace.ide_password,
      project_path_in_ide: `/home/coder/projects/${project.slug}`,
    };
  });

  // ---------- Checkpoint (commit + push without changing status) ----------

  app.post('/api/tasks/:id/checkpoint', async (req, reply) => {
    const taskId = Number(req.params.id);
    const { commit_message } = req.body || {};

    const { rows: tRows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const task = tRows[0];
    if (!task) return reply.code(404).send({ error: 'not found' });
    if (task.assigned_to !== req.user.id && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'not your task' });
    }
    if (task.status !== 'in_progress') {
      return reply.code(409).send({ error: `cannot checkpoint task in status ${task.status}` });
    }

    const { rows: pRows } = await query('SELECT * FROM projects WHERE id = $1', [task.project_id]);
    const project = pRows[0];
    const { rows: wRows } = await query('SELECT * FROM workspaces WHERE user_id = $1', [task.assigned_to]);
    const workspace = wRows[0];

    const message = commit_message?.trim() || `Task #${task.id} checkpoint`;
    try {
      await commitAndPush({
        containerName: workspace.container_name,
        project,
        branchName: task.branch_name,
        commitMessage: message,
      });
    } catch (err) {
      return reply.code(500).send({ error: 'push failed: ' + err.message });
    }

    await emitTaskEvent({
      taskId, actorId: req.user.id, eventType: 'checkpoint',
      metadata: { message },
    });
    await audit({ actorId: req.user.id, action: 'task.checkpoint', target: `task:${taskId}` });

    return { ok: true, branch: task.branch_name };
  });

  // ---------- Submit a task ----------

  app.post('/api/tasks/:id/submit', async (req, reply) => {
    const taskId = Number(req.params.id);
    const { commit_message } = req.body || {};

    const { rows: tRows } = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    const task = tRows[0];
    if (!task) return reply.code(404).send({ error: 'not found' });
    if (task.assigned_to !== req.user.id && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'not your task' });
    }
    if (task.status !== 'in_progress') {
      return reply.code(409).send({ error: `cannot submit task in status ${task.status}` });
    }

    const { rows: pRows } = await query('SELECT * FROM projects WHERE id = $1', [task.project_id]);
    const project = pRows[0];

    const { rows: wRows } = await query('SELECT * FROM workspaces WHERE user_id = $1', [task.assigned_to]);
    const workspace = wRows[0];
    if (!workspace) return reply.code(409).send({ error: 'workspace missing' });

    const message = commit_message?.trim() || `Task #${task.id}: ${task.title}`;

    try {
      await commitAndPush({
        containerName: workspace.container_name,
        project,
        branchName: task.branch_name,
        commitMessage: message,
      });
    } catch (err) {
      console.error('[submit] push failed:', err.message);
      return reply.code(500).send({ error: 'push failed: ' + err.message });
    }

    await query(`UPDATE tasks SET status='submitted', submitted_at=NOW() WHERE id=$1`, [taskId]);
    await query(`UPDATE workspaces SET current_task_id=NULL WHERE id=$1`, [workspace.id]);
    await emitTaskEvent({
      taskId, actorId: req.user.id, eventType: 'submitted',
      fromStatus: 'in_progress', toStatus: 'submitted', metadata: { message },
    });

    await audit({
      actorId: req.user.id, action: 'task.submit', target: `task:${taskId}`,
      payload: { branch: task.branch_name },
    });

    const compareUrl = `https://github.com/${project.github_repo}/pull/new/${task.branch_name}`;
    await sendTelegram(
      `<b>Task #${task.id} submitted</b>\n` +
      `<b>Project:</b> ${escapeHtml(project.name)}\n` +
      `<b>Title:</b> ${escapeHtml(task.title)}\n` +
      `<b>By:</b> ${escapeHtml(req.user.username)}\n` +
      `<b>Branch:</b> <code>${escapeHtml(task.branch_name)}</code>\n` +
      `<a href="${compareUrl}">Open PR on GitHub</a>`,
    );

    return { ok: true, compare_url: compareUrl };
  });

  // ---------- Admin sets PR URL ----------

  app.post('/api/tasks/:id/pr-url', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const taskId = Number(req.params.id);
    const { pr_url } = req.body || {};
    if (!pr_url) return reply.code(400).send({ error: 'pr_url required' });

    const { rowCount } = await query(
      `UPDATE tasks SET pr_url=$1, status='awaiting_review' WHERE id=$2 AND status='submitted'`,
      [pr_url, taskId],
    );
    if (!rowCount) return reply.code(409).send({ error: 'task not in submitted state' });
    await emitTaskEvent({
      taskId, actorId: req.user.id, eventType: 'pr_set',
      fromStatus: 'submitted', toStatus: 'awaiting_review', metadata: { pr_url },
    });
    await audit({ actorId: req.user.id, action: 'task.pr_url.set', target: `task:${taskId}`, payload: { pr_url } });
    return { ok: true };
  });

  app.post('/api/tasks/:id/merged', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const taskId = Number(req.params.id);
    await query(`UPDATE tasks SET status='merged', merged_at=NOW() WHERE id=$1`, [taskId]);
    await emitTaskEvent({ taskId, actorId: req.user.id, eventType: 'merged', toStatus: 'merged' });
    await audit({ actorId: req.user.id, action: 'task.merged', target: `task:${taskId}` });
    return { ok: true };
  });

  app.post('/api/tasks/:id/close', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const taskId = Number(req.params.id);
    await query(`UPDATE tasks SET status='closed' WHERE id=$1`, [taskId]);
    await emitTaskEvent({ taskId, actorId: req.user.id, eventType: 'closed', toStatus: 'closed' });
    await audit({ actorId: req.user.id, action: 'task.close', target: `task:${taskId}` });
    return { ok: true };
  });
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}
