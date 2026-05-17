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
          <label>URL</label>
          <div><a href={ws.url} target="_blank" rel="noreferrer">{ws.url}</a></div>
        </div>
        <div className="field">
          <label>IDE password</label>
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
        <p className="muted" style={{ fontSize: 13 }}>
          When you open the workspace, log in with the password above. Run <code className="mono">claude</code> in the
          terminal to start the Claude Code CLI — sign in with <em>your own</em> Claude Pro account the first time.
        </p>
      </div>
    </>
  );
}
