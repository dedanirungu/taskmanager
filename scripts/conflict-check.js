#!/usr/bin/env node
//
// Runs every 20 minutes via cron.  For each project:
//   1. Ensure a bare clone exists at $CONFLICT_CHECK_ROOT/<slug>.git
//   2. git fetch origin --prune
//   3. For every pair of active task branches (in_progress + submitted),
//      use `git merge-tree --write-tree` to detect conflicts.
//   4. Telegram-alert the admin on new conflicts (deduped via conflict_alerts table).
//   5. Mark previously-alerted conflicts resolved when a branch disappears.
//
// Env vars (same as the platform):
//   PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
//   GITHUB_TOKEN
//   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID
//   CONFLICT_CHECK_ROOT (default /srv/conflict-check)
//
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const exec = promisify(execFile);
const { Pool } = pg;

const ROOT = process.env.CONFLICT_CHECK_ROOT || '/srv/conflict-check';
const TOKEN = process.env.GITHUB_TOKEN || '';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'devplatform',
  user: process.env.PGUSER || 'devplatform',
  password: process.env.PGPASSWORD,
});

function authedUrl(repo) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN required for conflict-check');
  return `https://${TOKEN}:x-oauth-basic@github.com/${repo}.git`;
}

async function run(args, opts = {}) {
  try {
    const { stdout } = await exec('git', args, { maxBuffer: 32 * 1024 * 1024, ...opts });
    return { ok: true, stdout };
  } catch (err) {
    return { ok: false, stderr: err.stderr?.toString() || err.message, stdout: err.stdout?.toString() || '' };
  }
}

async function ensureBareClone(project) {
  const dir = path.join(ROOT, `${project.slug}.git`);
  try { await fs.access(dir); }
  catch {
    console.log(`[conflict] cloning ${project.github_repo} -> ${dir}`);
    await fs.mkdir(ROOT, { recursive: true });
    const res = await exec('git', ['clone', '--bare', authedUrl(project.github_repo), dir]);
    if (!res) throw new Error('clone failed');
  }
  return dir;
}

async function fetchAll(dir, repo) {
  // Use the authenticated URL on each fetch so the PAT is never persisted in the bare clone.
  const url = authedUrl(repo);
  const res = await exec('git', ['fetch', '--prune', url, '+refs/heads/*:refs/heads/*'], { cwd: dir });
  return res;
}

async function listRemoteBranches(dir) {
  const { stdout } = await exec('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd: dir });
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

// Use `git merge-tree --write-tree --name-only` to surface conflicting files.
async function detectConflict(dir, branchA, branchB) {
  const res = await run(
    ['merge-tree', '--write-tree', '--name-only', '-z', branchA, branchB],
    { cwd: dir },
  );

  if (res.ok) {
    // No conflict, merge would be clean. stdout is the tree oid only.
    return { conflict: false, files: [] };
  }

  // merge-tree exits non-zero on conflict.  The conflicting filenames are NUL-separated on stdout
  // after the resulting tree oid + a newline.  We extract everything after the first newline.
  const out = res.stdout || '';
  const stderr = res.stderr || '';
  const newlineIdx = out.indexOf('\n');
  const files = (newlineIdx === -1 ? out : out.slice(newlineIdx + 1))
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean);

  // Some git versions print the conflict report on stderr instead. As a fallback, also include
  // anything that looks like a file path from stderr.
  if (!files.length && stderr) {
    for (const line of stderr.split('\n')) {
      const m = line.match(/^(?:CONFLICT \([^)]+\): Merge conflict in |Auto-merging )(.+)$/);
      if (m) files.push(m[1].trim());
    }
  }

  return { conflict: true, files: Array.from(new Set(files)) };
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.log('[conflict] telegram disabled, would have sent:\n' + text);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const body = await res.json();
    if (!body.ok) console.error('[conflict] telegram api error:', body);
  } catch (err) {
    console.error('[conflict] telegram send failed:', err.message);
  }
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function processProject(project) {
  const dir = await ensureBareClone(project);
  const fetchRes = await fetchAll(dir, project.github_repo);
  if (!fetchRes) console.warn(`[conflict] fetch reported nothing for ${project.slug}`);

  const existing = new Set(await listRemoteBranches(dir));

  const { rows: tasks } = await pool.query(
    `SELECT id, branch_name FROM tasks
     WHERE project_id = $1 AND status IN ('in_progress','submitted') AND branch_name IS NOT NULL`,
    [project.id],
  );

  const branches = tasks.map((t) => t.branch_name).filter((b) => existing.has(b));

  // Pairwise check.
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const [a, b] = [branches[i], branches[j]].sort();

      const { rowCount } = await pool.query(
        `SELECT 1 FROM conflict_alerts
         WHERE project_id = $1 AND branch_a = $2 AND branch_b = $3 AND resolved_at IS NULL`,
        [project.id, a, b],
      );
      if (rowCount) continue;

      const result = await detectConflict(dir, a, b);
      if (!result.conflict) continue;

      console.log(`[conflict] ${project.slug}: ${a} ↔ ${b} (${result.files.length} files)`);
      await pool.query(
        `INSERT INTO conflict_alerts (project_id, branch_a, branch_b, conflicting_files)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT DO NOTHING`,
        [project.id, a, b, JSON.stringify(result.files)],
      );

      const fileList = result.files.slice(0, 10).map((f) => `  • <code>${esc(f)}</code>`).join('\n');
      const more = result.files.length > 10 ? `\n  …and ${result.files.length - 10} more` : '';
      await sendTelegram(
        `<b>⚠ Merge conflict</b>\n` +
        `<b>Project:</b> ${esc(project.name)}\n` +
        `<b>Branches:</b>\n  <code>${esc(a)}</code>\n  <code>${esc(b)}</code>\n` +
        (result.files.length ? `<b>Files:</b>\n${fileList}${more}` : ''),
      );
    }
  }

  // Resolve alerts whose branches are gone.
  const { rows: open } = await pool.query(
    `SELECT id, branch_a, branch_b FROM conflict_alerts WHERE project_id = $1 AND resolved_at IS NULL`,
    [project.id],
  );
  for (const alert of open) {
    if (!existing.has(alert.branch_a) || !existing.has(alert.branch_b)) {
      await pool.query(`UPDATE conflict_alerts SET resolved_at = NOW() WHERE id = $1`, [alert.id]);
      console.log(`[conflict] resolved alert ${alert.id} (branch gone)`);
    }
  }
}

async function main() {
  const { rows: projects } = await pool.query(`SELECT id, name, slug, github_repo, default_branch FROM projects`);
  console.log(`[conflict] checking ${projects.length} project(s)`);
  for (const p of projects) {
    try {
      await processProject(p);
    } catch (err) {
      console.error(`[conflict] project ${p.slug} failed:`, err.message);
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error('[conflict] fatal:', err);
  process.exit(1);
});
