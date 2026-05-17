import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';

import { loadUser } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import clientRoutes from './routes/clients.js';
import taskRoutes from './routes/tasks.js';
import commentRoutes from './routes/comments.js';
import dashboardRoutes from './routes/dashboard.js';
import meRoutes from './routes/me.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set and at least 32 chars');
  process.exit(1);
}

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  trustProxy: true,
  bodyLimit: 1024 * 1024 * 4,
});

await app.register(fastifyCookie);
await app.register(fastifySession, {
  secret: SESSION_SECRET,
  cookieName: 'devplatform.sid',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
  saveUninitialized: false,
});

await app.register(fastifyRateLimit, {
  global: false,
  max: 200,
  timeWindow: '1 minute',
});

app.addHook('preHandler', loadUser);

await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(clientRoutes);
await app.register(taskRoutes);
await app.register(commentRoutes);
await app.register(dashboardRoutes);
await app.register(meRoutes);

app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

// Static frontend (built React SPA).
const distDir = path.resolve(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distDir)) {
  await app.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.type('text/html').send(fs.readFileSync(path.join(distDir, 'index.html'), 'utf8'));
  });
} else {
  app.log.warn(`frontend dist not found at ${distDir} — API only`);
}

try {
  await app.listen({ host: '0.0.0.0', port: PORT });
  app.log.info(`devplatform listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
