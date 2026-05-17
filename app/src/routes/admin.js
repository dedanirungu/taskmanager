import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { query, withTx } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { slugify } from '../util/slug.js';
import { randomPassword } from '../util/random.js';
import { createOrStartWorkspaceContainer, stopWorkspaceContainer, removeWorkspaceContainer } from '../services/docker.js';

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

// Drop a one-line trigger file in TRIGGERS_DIR. The host's cron watches
// this directory and runs issue-certs.sh + render-nginx.sh for the domain.
const TRIGGERS_DIR = process.env.TRIGGERS_DIR
  || path.join(process.env.WORKSPACE_ROOT || '/srv/devplatform/workspaces', '..', 'triggers');

async function writeTrigger(domain, kind /* 'req' | 'del' */) {
  try {
    await fs.mkdir(TRIGGERS_DIR, { recursive: true });
    const file = path.join(TRIGGERS_DIR, `${domain}.${kind}`);
    await fs.writeFile(file, domain + '\n', { mode: 0o644 });
  } catch (err) {
    console.warn(`[trigger] failed to write ${kind} trigger for`, domain, err.message);
  }
}

async function writeCertTrigger(domain)   { return writeTrigger(domain, 'req'); }
async function writeDeleteTrigger(domain) { return writeTrigger(domain, 'del'); }

async function removeWorkspaceFilesOnHost(subdomain) {
  const wsRoot = process.env.WORKSPACE_ROOT || '/srv/devplatform/workspaces';
  const dir = path.join(wsRoot, subdomain);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn('[cleanup] failed to remove workspace dir', dir, err.message);
  }
}

const WS_PORT_MIN = Number(process.env.WORKSPACE_PORT_MIN || 8081);
const WS_PORT_MAX = Number(process.env.WORKSPACE_PORT_MAX || 8199);
const PREVIEW_PORT_MIN = Number(process.env.PREVIEW_PORT_MIN || 8201);
const PREVIEW_PORT_MAX = Number(process.env.PREVIEW_PORT_MAX || 8499);

async function allocateHostPort(client) {
  const { rows } = await client.query(
    `SELECT host_port FROM workspaces WHERE host_port IS NOT NULL ORDER BY host_port`,
  );
  const taken = new Set(rows.map((r) => r.host_port));
  for (let p = WS_PORT_MIN; p <= WS_PORT_MAX; p++) {
    if (!taken.has(p)) return p;
  }
  throw new Error(`no free workspace port in ${WS_PORT_MIN}..${WS_PORT_MAX}`);
}

async function allocatePreviewHostPort(client) {
  const { rows } = await client.query(
    `SELECT host_port FROM workspace_previews ORDER BY host_port`,
  );
  const taken = new Set(rows.map((r) => r.host_port));
  for (let p = PREVIEW_PORT_MIN; p <= PREVIEW_PORT_MAX; p++) {
    if (!taken.has(p)) return p;
  }
  throw new Error(`no free preview port in ${PREVIEW_PORT_MIN}..${PREVIEW_PORT_MAX}`);
}

async function loadPreviews(workspaceId, client) {
  const q = client || { query };
  const { rows } = await q.query(
    `SELECT id, name, internal_port, host_port FROM workspace_previews
     WHERE workspace_id = $1 ORDER BY name`,
    [workspaceId],
  );
  return rows;
}

export default async function adminRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  // ---------- Projects ----------

  app.get('/api/admin/projects', async () => {
    // Never expose github_token; surface only whether one is set.
    const { rows } = await query(
      `SELECT id, name, slug, github_repo, default_branch, description,
              git_author_name, git_author_email,
              (github_token IS NOT NULL) AS has_github_token,
              created_at
       FROM projects ORDER BY name`,
    );
    return { projects: rows };
  });

  app.post('/api/admin/projects', async (req, reply) => {
    const {
      name, github_repo, default_branch = 'main', description = null,
      git_author_name = null, git_author_email = null,
      github_token = null,
    } = req.body || {};
    if (!name || !github_repo) {
      return reply.code(400).send({ error: 'name and github_repo required' });
    }
    if ((git_author_name && !git_author_email) || (!git_author_name && git_author_email)) {
      return reply.code(400).send({ error: 'set both git_author_name and git_author_email or neither' });
    }
    const slug = slugify(name);
    try {
      const { rows } = await query(
        `INSERT INTO projects (name, slug, github_repo, default_branch, description,
                               git_author_name, git_author_email, github_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, slug`,
        [name, slug, github_repo, default_branch, description, git_author_name, git_author_email, github_token || null],
      );
      await audit({
        actorId: req.user.id, action: 'project.create',
        target: `project:${rows[0].id}`,
        payload: { name, slug, github_repo, has_github_token: !!github_token },
      });
      return { project: rows[0] };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'project already exists' });
      throw err;
    }
  });

  app.patch('/api/admin/projects/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const { description, default_branch, git_author_name, git_author_email, github_token } = req.body || {};

    if ((git_author_name && !git_author_email) || (git_author_email && !git_author_name)) {
      return reply.code(400).send({ error: 'set both git_author_name and git_author_email or neither' });
    }

    const fields = [];
    const params = [];
    const push = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };

    if (description !== undefined)      push('description', description);
    if (default_branch !== undefined)   push('default_branch', default_branch);
    if (git_author_name !== undefined)  push('git_author_name', git_author_name);
    if (git_author_email !== undefined) push('git_author_email', git_author_email);
    // Special sentinel: client sends empty string to clear the token; missing key = unchanged.
    if (github_token !== undefined)     push('github_token', github_token || null);

    if (!fields.length) return { ok: true };

    params.push(id);
    const { rows } = await query(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, slug, default_branch, git_author_name, git_author_email,
                 (github_token IS NOT NULL) AS has_github_token`,
      params,
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit({
      actorId: req.user.id, action: 'project.update', target: `project:${id}`,
      payload: { keys: Object.keys(req.body), token_changed: github_token !== undefined },
    });
    return { project: rows[0] };
  });

  app.delete('/api/admin/projects/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const { rowCount } = await query('DELETE FROM projects WHERE id = $1', [id]);
    if (!rowCount) return reply.code(404).send({ error: 'not found' });
    await audit({ actorId: req.user.id, action: 'project.delete', target: `project:${id}` });
    return { ok: true };
  });

  // ---------- Users (developers) ----------

  app.get('/api/admin/users', async () => {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.role, u.access_scope, u.telegram_chat_id, u.created_at,
              COALESCE(json_agg(up.project_id) FILTER (WHERE up.project_id IS NOT NULL), '[]') AS project_ids
       FROM users u
       LEFT JOIN user_projects up ON up.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );
    return { users: rows };
  });

  app.post('/api/admin/users', async (req, reply) => {
    const {
      username, password, email,
      role = 'developer',
      access_scope = 'scoped',
      project_ids = [],
      // If true (default for developers), provision the workspace container
      // and write a trigger file for cert+nginx in the same request.
      // Developers are always auto-provisioned with a workspace; admins are not.
      // This used to be a checkbox in the UI but it created confusion: the
      // operator forgot to tick it and the dev had no workspace on first login.
      provision_workspace = (role === 'developer'),
      workspace_subdomain,
    } = req.body || {};
    if (!username || !password) return reply.code(400).send({ error: 'username and password required' });
    if (!['admin', 'developer'].includes(role)) return reply.code(400).send({ error: 'invalid role' });
    if (!['all', 'scoped'].includes(access_scope)) return reply.code(400).send({ error: 'invalid access_scope' });

    const hash = await bcrypt.hash(password, 12);

    let user;
    try {
      user = await withTx(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO users (username, password_hash, email, role, access_scope)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role, access_scope, created_at`,
          [username, hash, email || null, role, access_scope],
        );
        const u = rows[0];

        if (access_scope === 'scoped' && Array.isArray(project_ids) && project_ids.length) {
          const values = project_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
          await client.query(
            `INSERT INTO user_projects (user_id, project_id) VALUES ${values}
             ON CONFLICT DO NOTHING`,
            [u.id, ...project_ids],
          );
        }
        return u;
      });
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'username already exists' });
      throw err;
    }

    await audit({ actorId: req.user.id, action: 'user.create', target: `user:${user.id}`, payload: { role, access_scope, provision_workspace } });

    let workspace = null;
    let workspace_error = null;
    if (provision_workspace) {
      try {
        workspace = await provisionWorkspaceForUser({
          user, subdomain: workspace_subdomain, actorId: req.user.id,
        });
      } catch (err) {
        // User was created OK; just report the workspace failure so the admin can retry.
        workspace_error = err.message;
      }
    }

    return { user, workspace, workspace_error };
  });

  // Shared with POST /api/admin/workspaces below — extracted so user creation can call it inline.
  async function provisionWorkspaceForUser({ user, subdomain, actorId }) {
    const sub = subdomain || `dev${user.id}`;
    const containerName = `${sub}-workspace`;
    const password = randomPassword();

    const ws = await withTx(async (client) => {
      const { rows: existing } = await client.query(
        `SELECT host_port FROM workspaces WHERE user_id = $1`,
        [user.id],
      );
      const hostPort = existing[0]?.host_port || (await allocateHostPort(client));

      const { rows } = await client.query(
        `INSERT INTO workspaces (user_id, container_name, subdomain, ide_password, host_port, status)
         VALUES ($1, $2, $3, $4, $5, 'stopped')
         ON CONFLICT (user_id) DO UPDATE
           SET subdomain      = EXCLUDED.subdomain,
               container_name = EXCLUDED.container_name,
               ide_password   = EXCLUDED.ide_password,
               host_port      = COALESCE(workspaces.host_port, EXCLUDED.host_port)
         RETURNING *`,
        [user.id, containerName, sub, password, hostPort],
      );
      return rows[0];
    });

    await recreateWorkspaceContainer(ws);
    await query(`UPDATE workspaces SET status = 'running' WHERE id = $1`, [ws.id]);
    await audit({ actorId, action: 'workspace.create', target: `workspace:${ws.id}` });
    await writeCertTrigger(`${ws.subdomain}.${process.env.PUBLIC_DOMAIN}`);

    const previews = await loadPreviews(ws.id);
    return {
      ...ws,
      status: 'running',
      url: `https://${ws.subdomain}.${process.env.PUBLIC_DOMAIN}`,
      nginx_upstream: `127.0.0.1:${ws.host_port}`,
      previews,
    };
  }

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const { password, email, telegram_chat_id, access_scope, project_ids } = req.body || {};

    await withTx(async (client) => {
      if (password) {
        const hash = await bcrypt.hash(password, 12);
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
      }
      if (email !== undefined) await client.query('UPDATE users SET email = $1 WHERE id = $2', [email, id]);
      if (telegram_chat_id !== undefined) await client.query('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [telegram_chat_id, id]);
      if (access_scope) await client.query('UPDATE users SET access_scope = $1 WHERE id = $2', [access_scope, id]);

      if (Array.isArray(project_ids)) {
        await client.query('DELETE FROM user_projects WHERE user_id = $1', [id]);
        if (project_ids.length) {
          const values = project_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
          await client.query(
            `INSERT INTO user_projects (user_id, project_id) VALUES ${values}
             ON CONFLICT DO NOTHING`,
            [id, ...project_ids],
          );
        }
      }
    });

    await audit({ actorId: req.user.id, action: 'user.update', target: `user:${id}` });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return reply.code(400).send({ error: 'cannot delete yourself' });

    // Find all workspaces (and their previews) belonging to this user, then
    // tear them down completely: container → preview certs → workspace cert
    // → workspace dir on host.  Trigger files queue the host-side cert+nginx work.
    const { rows: workspaces } = await query(
      `SELECT id, container_name, subdomain FROM workspaces WHERE user_id = $1`, [id],
    );
    const publicDomain = process.env.PUBLIC_DOMAIN;
    for (const w of workspaces) {
      const { rows: previews } = await query(
        `SELECT name FROM workspace_previews WHERE workspace_id = $1`, [w.id],
      );
      await stopWorkspaceContainer(w.container_name).catch(() => {});
      await removeWorkspaceContainer(w.container_name).catch(() => {});
      for (const p of previews) {
        await writeDeleteTrigger(`${p.name}-${w.subdomain}.${publicDomain}`);
      }
      await writeDeleteTrigger(`${w.subdomain}.${publicDomain}`);
      await removeWorkspaceFilesOnHost(w.subdomain);
    }

    await query('DELETE FROM users WHERE id = $1', [id]);
    await audit({
      actorId: req.user.id, action: 'user.delete', target: `user:${id}`,
      payload: { workspaces_removed: workspaces.length },
    });
    return { ok: true };
  });

  // ---------- Workspaces ----------
  //
  // A workspace is created per developer. Subdomain is "dev<userId>" by default but admin may override.
  app.post('/api/admin/workspaces', async (req, reply) => {
    const { user_id, subdomain } = req.body || {};
    if (!user_id) return reply.code(400).send({ error: 'user_id required' });

    const { rows: userRows } = await query('SELECT id, username, email FROM users WHERE id = $1', [user_id]);
    const user = userRows[0];
    if (!user) return reply.code(404).send({ error: 'user not found' });

    const workspace = await provisionWorkspaceForUser({
      user, subdomain, actorId: req.user.id,
    });
    return { workspace };
  });

  app.get('/api/admin/workspaces', async () => {
    const { rows } = await query(
      `SELECT w.*, u.username,
              COALESCE(
                (SELECT json_agg(p ORDER BY p.name)
                 FROM (SELECT id, name, internal_port, host_port
                       FROM workspace_previews WHERE workspace_id = w.id) p),
                '[]'::json
              ) AS previews
       FROM workspaces w
       JOIN users u ON u.id = w.user_id
       ORDER BY w.created_at DESC`,
    );
    return { workspaces: rows };
  });

  // ---------- Preview ports ----------
  app.post('/api/admin/workspaces/:id/previews', async (req, reply) => {
    const wsId = Number(req.params.id);
    const { name, internal_port } = req.body || {};
    if (!name || !internal_port) return reply.code(400).send({ error: 'name and internal_port required' });
    if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) {
      return reply.code(400).send({ error: 'name must be a valid DNS label (lowercase, digits, hyphens)' });
    }
    const port = Number(internal_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return reply.code(400).send({ error: 'internal_port must be 1..65535' });
    }

    try {
      const result = await withTx(async (client) => {
        const { rows: wsRows } = await client.query(`SELECT * FROM workspaces WHERE id = $1`, [wsId]);
        const ws = wsRows[0];
        if (!ws) throw httpError(404, 'workspace not found');
        const hostPort = await allocatePreviewHostPort(client);
        await client.query(
          `INSERT INTO workspace_previews (workspace_id, name, internal_port, host_port)
           VALUES ($1, $2, $3, $4)`,
          [wsId, name, port, hostPort],
        );
        return { workspace: ws };
      });

      // Recreate the container with the new port bindings.
      await recreateWorkspaceContainer(result.workspace);
      await writeCertTrigger(`${name}-${result.workspace.subdomain}.${process.env.PUBLIC_DOMAIN}`);
      await audit({ actorId: req.user.id, action: 'workspace.preview.add', target: `workspace:${wsId}`, payload: { name, internal_port: port } });
      return { ok: true };
    } catch (err) {
      if (err.statusCode) return reply.code(err.statusCode).send({ error: err.message });
      if (err.code === '23505') return reply.code(409).send({ error: 'name or port already used on this workspace' });
      throw err;
    }
  });

  app.delete('/api/admin/workspaces/:id/previews/:previewId', async (req, reply) => {
    const wsId = Number(req.params.id);
    const previewId = Number(req.params.previewId);
    const { rows: wsRows } = await query(`SELECT * FROM workspaces WHERE id = $1`, [wsId]);
    const ws = wsRows[0];
    if (!ws) return reply.code(404).send({ error: 'workspace not found' });
    const { rows: prevRows } = await query(
      `SELECT name FROM workspace_previews WHERE id = $1 AND workspace_id = $2`,
      [previewId, wsId],
    );
    if (!prevRows[0]) return reply.code(404).send({ error: 'preview not found' });
    await query(
      `DELETE FROM workspace_previews WHERE id = $1 AND workspace_id = $2`,
      [previewId, wsId],
    );
    await recreateWorkspaceContainer(ws);
    await writeDeleteTrigger(`${prevRows[0].name}-${ws.subdomain}.${process.env.PUBLIC_DOMAIN}`);
    await audit({ actorId: req.user.id, action: 'workspace.preview.remove', target: `workspace:${wsId}`, payload: { preview_id: previewId, name: prevRows[0].name } });
    return { ok: true };
  });

  app.post('/api/admin/workspaces/:id/start', async (req, reply) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM workspaces WHERE id = $1', [id]);
    const ws = rows[0];
    if (!ws) return reply.code(404).send({ error: 'not found' });
    await recreateWorkspaceContainer(ws);
    await query(`UPDATE workspaces SET status = 'running' WHERE id = $1`, [id]);
    return { ok: true };
  });

  async function recreateWorkspaceContainer(workspace) {
    // Note: we do NOT pass the developer's name/email here. Containers get the
    // PLATFORM identity by default; per-project override is written into each
    // cloned repo's local .git/config during claim.
    const previews = await loadPreviews(workspace.id);
    await createOrStartWorkspaceContainer({
      containerName: workspace.container_name,
      subdomain: workspace.subdomain,
      password: workspace.ide_password,
      hostPort: workspace.host_port,
      previews,
    });
  }

  app.post('/api/admin/workspaces/:id/stop', async (req, reply) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT container_name FROM workspaces WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await stopWorkspaceContainer(rows[0].container_name);
    await query(`UPDATE workspaces SET status = 'stopped' WHERE id = $1`, [id]);
    return { ok: true };
  });

  // ---------- Audit log ----------

  app.get('/api/admin/audit', async (req) => {
    const limit = Math.min(Number(req.query?.limit || 200), 1000);
    const { rows } = await query(
      `SELECT a.id, a.action, a.target, a.payload, a.created_at, u.username AS actor
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT $1`,
      [limit],
    );
    return { entries: rows };
  });
}
