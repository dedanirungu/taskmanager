import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { audit } from '../services/audit.js';

export default async function authRoutes(app) {
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: 'username and password required' });
    }

    const { rows } = await query(
      `SELECT id, username, password_hash, role, access_scope
       FROM users WHERE username = $1`,
      [username],
    );
    const user = rows[0];

    const placeholderHash = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, user ? user.password_hash : placeholderHash);
    if (!user || !ok) {
      await audit({ action: 'auth.login.fail', payload: { username } });
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    req.session.userId = user.id;
    await audit({ actorId: user.id, action: 'auth.login.success' });
    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        access_scope: user.access_scope,
      },
    };
  });

  app.post('/api/auth/logout', async (req) => {
    const userId = req.session?.userId;
    if (userId) await audit({ actorId: userId, action: 'auth.logout' });
    await new Promise((resolve) => req.session.destroy(() => resolve()));
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' });
    return { user: req.user };
  });
}
