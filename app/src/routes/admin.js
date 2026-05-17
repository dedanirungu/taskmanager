import bcrypt from 'bcryptjs';
import { query, withTx } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { slugify } from '../util/slug.js';
import { randomPassword } from '../util/random.js';
import { createOrStartWorkspaceContainer, stopWorkspaceContainer, removeWorkspaceContainer } from '../services/docker.js';

const WS_PORT_MIN = Number(process.env.WORKSPACE_PORT_MIN || 8081);
const WS_PORT_MAX = Number(process.env.WORKSPACE_PORT_MAX || 8199);

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

export default async function adminRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  // ---------- Projects ----------

  app.get('/api/admin/projects', async () => {
    const { rows } = await query(
      `SELECT id, name, slug, github_repo, default_branch, description,
              git_author_name, git_author_email, created_at
       FROM projects ORDER BY name`,
    );
    return { projects: rows };
  });

  app.post('/api/admin/projects', async (req, reply) => {
    const {
      name, github_repo, default_branch = 'main', description = null,
      git_author_name = null, git_author_email = null,
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
        `INSERT INTO projects (name, slug, github_repo, default_branch, description, git_author_name, git_author_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [name, slug, github_repo, default_branch, description, git_author_name, git_author_email],
      );
      await audit({ actorId: req.user.id, action: 'project.create', target: `project:${rows[0].id}`, payload: rows[0] });
      return { project: rows[0] };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'project already exists' });
      throw err;
    }
  });

  app.patch('/api/admin/projects/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const { description, default_branch, git_author_name, git_author_email } = req.body || {};

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

    if (!fields.length) return { ok: true };

    params.push(id);
    const { rows } = await query(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit({ actorId: req.user.id, action: 'project.update', target: `project:${id}`, payload: req.body });
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
    const { username, password, email, role = 'developer', access_scope = 'scoped', project_ids = [] } = req.body || {};
    if (!username || !password) return reply.code(400).send({ error: 'username and password required' });
    if (!['admin', 'developer'].includes(role)) return reply.code(400).send({ error: 'invalid role' });
    if (!['all', 'scoped'].includes(access_scope)) return reply.code(400).send({ error: 'invalid access_scope' });

    const hash = await bcrypt.hash(password, 12);

    try {
      const user = await withTx(async (client) => {
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

      await audit({ actorId: req.user.id, action: 'user.create', target: `user:${user.id}`, payload: { role, access_scope } });
      return { user };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'username already exists' });
      throw err;
    }
  });

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
    // Stop + remove any workspace for the user first.
    const { rows } = await query('SELECT container_name FROM workspaces WHERE user_id = $1', [id]);
    for (const w of rows) {
      await stopWorkspaceContainer(w.container_name).catch(() => {});
      await removeWorkspaceContainer(w.container_name).catch(() => {});
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    await audit({ actorId: req.user.id, action: 'user.delete', target: `user:${id}` });
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

    const sub = subdomain || `dev${user.id}`;
    const containerName = `${sub}-workspace`;
    const password = randomPassword();

    const workspace = await withTx(async (client) => {
      // Reuse the existing port if the workspace already exists; otherwise allocate.
      const { rows: existing } = await client.query(
        `SELECT host_port FROM workspaces WHERE user_id = $1`,
        [user_id],
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
        [user_id, containerName, sub, password, hostPort],
      );
      return rows[0];
    });

    await createOrStartWorkspaceContainer({
      containerName: workspace.container_name,
      subdomain: workspace.subdomain,
      password: workspace.ide_password,
      hostPort: workspace.host_port,
      gitName: user.username,
      gitEmail: user.email || `${user.username}@devplatform.local`,
    });

    await query(`UPDATE workspaces SET status = 'running' WHERE id = $1`, [workspace.id]);
    await audit({ actorId: req.user.id, action: 'workspace.create', target: `workspace:${workspace.id}` });

    return {
      workspace: {
        ...workspace,
        status: 'running',
        url: `https://${workspace.subdomain}.${process.env.PUBLIC_DOMAIN}`,
        nginx_upstream: `127.0.0.1:${workspace.host_port}`,
      },
    };
  });

  app.get('/api/admin/workspaces', async () => {
    const { rows } = await query(
      `SELECT w.*, u.username FROM workspaces w
       JOIN users u ON u.id = w.user_id
       ORDER BY w.created_at DESC`,
    );
    return { workspaces: rows };
  });

  app.post('/api/admin/workspaces/:id/start', async (req, reply) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM workspaces WHERE id = $1', [id]);
    const ws = rows[0];
    if (!ws) return reply.code(404).send({ error: 'not found' });

    const { rows: ur } = await query('SELECT id, username, email FROM users WHERE id = $1', [ws.user_id]);
    const user = ur[0];

    await createOrStartWorkspaceContainer({
      containerName: ws.container_name,
      subdomain: ws.subdomain,
      password: ws.ide_password,
      hostPort: ws.host_port,
      gitName: user.username,
      gitEmail: user.email || `${user.username}@devplatform.local`,
    });
    await query(`UPDATE workspaces SET status = 'running' WHERE id = $1`, [id]);
    return { ok: true };
  });

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
