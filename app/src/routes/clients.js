import { query } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { slugify } from '../util/slug.js';

export default async function clientRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/admin/clients', async () => {
    const { rows } = await query(`
      SELECT c.id, c.name, c.slug, c.description, c.created_at,
             COALESCE(
               (SELECT json_agg(p ORDER BY p.name)
                FROM (SELECT id, name, slug, github_repo FROM projects WHERE client_id = c.id) p),
               '[]'::json
             ) AS projects
      FROM clients c
      ORDER BY c.name
    `);
    return { clients: rows };
  });

  app.post('/api/admin/clients', async (req, reply) => {
    const { name, description = null } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });
    const slug = slugify(name);
    try {
      const { rows } = await query(
        `INSERT INTO clients (name, slug, description) VALUES ($1, $2, $3) RETURNING *`,
        [name, slug, description],
      );
      await audit({ actorId: req.user.id, action: 'client.create', target: `client:${rows[0].id}`, payload: rows[0] });
      return { client: rows[0] };
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'client already exists' });
      throw err;
    }
  });

  app.patch('/api/admin/clients/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const { name, description } = req.body || {};
    const fields = [];
    const params = [];
    const push = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
    if (name !== undefined) {
      push('name', name);
      push('slug', slugify(name));
    }
    if (description !== undefined) push('description', description);
    if (!fields.length) return { ok: true };
    params.push(id);
    const { rows } = await query(
      `UPDATE clients SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not found' });
    await audit({ actorId: req.user.id, action: 'client.update', target: `client:${id}` });
    return { client: rows[0] };
  });

  app.delete('/api/admin/clients/:id', async (req, reply) => {
    const id = Number(req.params.id);
    // ON DELETE SET NULL on projects.client_id leaves orphan projects intact.
    const { rowCount } = await query(`DELETE FROM clients WHERE id = $1`, [id]);
    if (!rowCount) return reply.code(404).send({ error: 'not found' });
    await audit({ actorId: req.user.id, action: 'client.delete', target: `client:${id}` });
    return { ok: true };
  });
}
