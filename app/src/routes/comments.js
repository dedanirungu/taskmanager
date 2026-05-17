import { query } from '../db/pool.js';
import { requireUser, visibleProjectIds } from '../middleware/auth.js';
import { audit } from '../services/audit.js';

async function userCanSeeTask(user, taskId) {
  const visible = await visibleProjectIds(user);
  const { rows } = await query(`SELECT project_id FROM tasks WHERE id = $1`, [taskId]);
  if (!rows[0]) return false;
  if (visible === null) return true;
  return visible.includes(Number(rows[0].project_id));
}

export default async function commentRoutes(app) {
  app.addHook('preHandler', requireUser);

  app.get('/api/tasks/:id/comments', async (req, reply) => {
    const id = Number(req.params.id);
    if (!(await userCanSeeTask(req.user, id))) return reply.code(403).send({ error: 'forbidden' });

    const { rows } = await query(
      `SELECT c.id, c.body, c.created_at, u.username AS author
       FROM task_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC`,
      [id],
    );
    return { comments: rows };
  });

  app.post('/api/tasks/:id/comments', async (req, reply) => {
    const id = Number(req.params.id);
    const { body } = req.body || {};
    if (!body || !body.trim()) return reply.code(400).send({ error: 'body required' });
    if (body.length > 10_000) return reply.code(400).send({ error: 'comment too long' });
    if (!(await userCanSeeTask(req.user, id))) return reply.code(403).send({ error: 'forbidden' });

    const { rows } = await query(
      `INSERT INTO task_comments (task_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [id, req.user.id, body.trim()],
    );
    await audit({ actorId: req.user.id, action: 'task.comment', target: `task:${id}` });
    return { comment: { ...rows[0], author: req.user.username } };
  });

  app.get('/api/tasks/:id/events', async (req, reply) => {
    const id = Number(req.params.id);
    if (!(await userCanSeeTask(req.user, id))) return reply.code(403).send({ error: 'forbidden' });

    const { rows } = await query(
      `SELECT e.id, e.event_type, e.from_status, e.to_status, e.metadata, e.created_at,
              u.username AS actor
       FROM task_events e
       LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.task_id = $1
       ORDER BY e.created_at ASC`,
      [id],
    );
    return { events: rows };
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!(await userCanSeeTask(req.user, id))) return reply.code(403).send({ error: 'forbidden' });

    const { rows } = await query(
      `SELECT t.*,
              p.name AS project_name, p.slug AS project_slug, p.github_repo,
              u.username AS assigned_to_username,
              creator.username AS created_by_username
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN users creator ON creator.id = t.created_by
       WHERE t.id = $1`,
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    return { task: rows[0] };
  });
}
