// Seed the first admin user.  Usage:
//   ADMIN_USERNAME=dedan ADMIN_PASSWORD=changeme ADMIN_EMAIL=you@example.com \
//     node src/db/seed-admin.js
import bcrypt from 'bcryptjs';
import { pool } from './pool.js';

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
const email = process.env.ADMIN_EMAIL || null;

if (!username || !password) {
  console.error('ADMIN_USERNAME and ADMIN_PASSWORD must be set.');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

const { rows } = await pool.query(
  `INSERT INTO users (username, password_hash, email, role, access_scope)
   VALUES ($1, $2, $3, 'admin', 'all')
   ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         email         = COALESCE(EXCLUDED.email, users.email)
   RETURNING id, username`,
  [username, hash, email],
);

console.log('admin seeded:', rows[0]);
await pool.end();
