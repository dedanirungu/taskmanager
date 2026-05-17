import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function MyWorkspace() {
  const [ws, setWs] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/api/me/workspace').then((r) => setWs(r.workspace)).catch((e) => setErr(e.message));
  }, []);

  function copy() {
    if (!ws?.ide_password) return;
    navigator.clipboard.writeText(ws.ide_password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (err) return <div className="error">{err}</div>;
  if (!ws) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-header"><h2>My workspace</h2></div>
      <div className="panel">
        <div className="field">
          <label>IDE</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/api/me/workspace/launch" target="_blank" rel="noreferrer">
              <button className="primary" type="button">Open IDE →</button>
            </a>
            <span className="muted" style={{ fontSize: 12 }}>(SSO — no separate password prompt)</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Direct URL (if you need to bookmark it): <a href={ws.url} target="_blank" rel="noreferrer">{ws.url}</a>
          </div>
        </div>
        <div className="field">
          <label>IDE password <span className="muted">(only needed if SSO fails)</span></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code className="mono">{ws.ide_password}</code>
            <button onClick={copy} className="ghost">{copied ? 'Copied!' : 'Copy'}</button>
          </div>
        </div>
        <div className="field">
          <label>Container</label>
          <code className="mono">{ws.container_name}</code> <span className={`badge ${ws.status}`}>{ws.status}</span>
        </div>
        {ws.current_task_id && (
          <div className="field">
            <label>Active task</label>
            <Link to={`/tasks/${ws.current_task_id}`}>#{ws.current_task_id} →</Link>
          </div>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Preview URLs</h3>
        {(!ws.previews || ws.previews.length === 0) && (
          <div className="muted">
            No preview URLs configured for you yet. Ask the admin to add one with the port your app listens on
            (e.g. <code className="mono">app → 3000</code> for next/react, <code className="mono">app → 5173</code> for vite).
          </div>
        )}
        {(ws.previews || []).length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>URL</th><th>Run your app on</th></tr></thead>
            <tbody>
              {ws.previews.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.name}</td>
                  <td><a href={p.url} target="_blank" rel="noreferrer">{p.url}</a></td>
                  <td className="mono">0.0.0.0:{p.internal_port}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          When you start your dev server, make sure it binds to <code className="mono">0.0.0.0</code> (not <code className="mono">localhost</code>)
          on the port shown — otherwise the host can't reach it. For example:<br />
          <code className="mono">npm run dev -- --host 0.0.0.0</code> (vite), or set <code className="mono">HOST=0.0.0.0</code> for many node servers.
        </p>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        Run <code className="mono">claude</code> in the workspace terminal to start the Claude Code CLI — sign in with
        <em> your own </em> Claude Pro account the first time.
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        Note: commits made via <b>Submit</b> / <b>Checkpoint</b> are attributed to the platform identity (not yours).
        The platform handles the GitHub push on your behalf — you don't need a GitHub account or git credentials.
      </p>
    </>
  );
}
