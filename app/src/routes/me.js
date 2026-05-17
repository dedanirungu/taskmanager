import { query } from '../db/pool.js';
import { requireUser } from '../middleware/auth.js';

export default async function meRoutes(app) {
  app.addHook('preHandler', requireUser);

  app.get('/api/me/workspace', async (req, reply) => {
    const { rows } = await query(
      `SELECT id, subdomain, container_name, ide_password, status, current_task_id
       FROM workspaces WHERE user_id = $1`,
      [req.user.id],
    );
    const ws = rows[0];
    if (!ws) return reply.code(404).send({ error: 'no workspace yet' });

    const { rows: previews } = await query(
      `SELECT id, name, internal_port FROM workspace_previews
       WHERE workspace_id = $1 ORDER BY name`,
      [ws.id],
    );
    return {
      workspace: {
        ...ws,
        url: `https://${ws.subdomain}.${process.env.PUBLIC_DOMAIN}`,
        previews: previews.map((p) => ({
          ...p,
          url: `https://${p.name}-${ws.subdomain}.${process.env.PUBLIC_DOMAIN}`,
        })),
      },
    };
  });

  app.get('/api/me/projects', async (req) => {
    if (req.user.access_scope === 'all' || req.user.role === 'admin') {
      const { rows } = await query(`SELECT id, name, slug, github_repo FROM projects ORDER BY name`);
      return { projects: rows };
    }
    const { rows } = await query(
      `SELECT p.id, p.name, p.slug, p.github_repo
       FROM projects p
       JOIN user_projects up ON up.project_id = p.id
       WHERE up.user_id = $1
       ORDER BY p.name`,
      [req.user.id],
    );
    return { projects: rows };
  });
}
