#!/usr/bin/env node
//
// Optional cron companion to conflict-check.js.
// Polls GitHub for the status of awaiting_review tasks and flips them to
// `merged` when the underlying PR is merged (or `closed` when the branch is gone).
//
// Suggested cron:
//   */15 * * * * /usr/bin/node /srv/devplatform/scripts/pr-status-sync.js >> /var/log/devplatform/pr-sync.log 2>&1
//
import pg from 'pg';
import { Octokit } from 'octokit';

const { Pool } = pg;
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('GITHUB_TOKEN required'); process.exit(1); }

const octokit = new Octokit({ auth: TOKEN });
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'devplatform',
  user: process.env.PGUSER || 'devplatform',
  password: process.env.PGPASSWORD,
});

function parseRepo(repo) {
  const [owner, name] = repo.split('/');
  return { owner, repo: name };
}

async function check(task) {
  if (!task.pr_url) return;
  const m = task.pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return;
  const [, owner, repo, num] = m;
  try {
    const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: Number(num) });
    if (data.merged) {
      await pool.query(`UPDATE tasks SET status='merged', merged_at = COALESCE(merged_at, NOW()) WHERE id=$1`, [task.id]);
      console.log(`task #${task.id}: merged`);
    } else if (data.state === 'closed') {
      await pool.query(`UPDATE tasks SET status='closed' WHERE id=$1`, [task.id]);
      console.log(`task #${task.id}: closed without merge`);
    }
  } catch (err) {
    console.warn(`task #${task.id} pr check failed:`, err.message);
  }
}

async function main() {
  const { rows } = await pool.query(
    `SELECT id, pr_url FROM tasks WHERE status = 'awaiting_review' AND pr_url IS NOT NULL`,
  );
  for (const task of rows) await check(task);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
