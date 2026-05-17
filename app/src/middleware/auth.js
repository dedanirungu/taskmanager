import { query } from '../db/pool.js';

// Loads req.user from the session if present.  Attach as a fastify preHandler.
export async function loadUser(req) {
  const userId = req.session?.userId;
  if (!userId) return;
  const { rows } = await query(
    `SELECT id, username, email, role, access_scope, telegram_chat_id
     FROM users WHERE id = $1`,
    [userId],
  );
  if (rows[0]) req.user = rows[0];
}

export function requireUser(req, reply, done) {
  if (!req.user) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  done();
}

export function requireAdmin(req, reply, done) {
  if (!req.user || req.user.role !== 'admin') {
    reply.code(403).send({ error: 'forbidden' });
    return;
  }
  done();
}

// Returns the set of project ids the user may see, or `null` meaning "all".
export async function visibleProjectIds(user) {
  if (!user) return [];
  if (user.access_scope === 'all' || user.role === 'admin') return null;
  const { rows } = await query(
    `SELECT project_id FROM user_projects WHERE user_id = $1`,
    [user.id],
  );
  return rows.map((r) => Number(r.project_id));
}
