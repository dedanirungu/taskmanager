import { query } from '../db/pool.js';
import { requireUser } from '../middleware/auth.js';

// Returns an auto-submitting HTML form that POSTs the IDE password to
// code-server's /login endpoint, so the user lands inside the IDE without
// being prompted for the password they don't need to know.
export function autoSubmitLaunchHtml({ url, password }) {
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]));
  return `<!doctype html><html><head>
<meta charset="utf-8"><title>Opening workspace…</title>
<style>body{font-family:system-ui;background:#0f1115;color:#e6e8eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body>
<div>Opening workspace…</div>
<form id="f" action="${esc(url)}" method="POST" style="display:none">
  <input type="hidden" name="password" value="${esc(password)}">
  <input type="hidden" name="base" value="/">
</form>
<script>document.getElementById('f').submit()</script>
<noscript><p>JavaScript is required. Submit manually:</p>
<form action="${esc(url)}" method="POST">
  <input type="hidden" name="password" value="${esc(password)}">
  <input type="hidden" name="base" value="/">
  <button type="submit">Open workspace</button>
</form></noscript>
</body></html>`;
}

export default async function meRoutes(app) {
  app.addHook('preHandler', requireUser);

  // SSO into the developer's own IDE.  Visiting this URL while logged into
  // the platform sends the user straight into code-server, skipping the
  // separate IDE password prompt.
  app.get('/api/me/workspace/launch', async (req, reply) => {
    const { rows } = await query(
      `SELECT subdomain, ide_password FROM workspaces WHERE user_id = $1`,
      [req.user.id],
    );
    const ws = rows[0];
    if (!ws) return reply.code(404).send({ error: 'no workspace yet — ask admin' });
    const url = `https://${ws.subdomain}.${process.env.PUBLIC_DOMAIN}/login`;
    reply.type('text/html; charset=utf-8').send(autoSubmitLaunchHtml({ url, password: ws.ide_password }));
  });

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
