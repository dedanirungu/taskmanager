import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function duration(a, b) {
  if (!a || !b) return null;
  const secs = Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [task, setTask]         = useState(null);
  const [events, setEvents]     = useState([]);
  const [comments, setComments] = useState([]);
  const [body, setBody]         = useState('');
  const [err, setErr]           = useState(null);
  const [msg, setMsg]           = useState(null);

  async function load() {
    try {
      const [{ task }, { events }, { comments }] = await Promise.all([
        api.get(`/api/tasks/${id}`),
        api.get(`/api/tasks/${id}/events`),
        api.get(`/api/tasks/${id}/comments`),
      ]);
      setTask(task); setEvents(events); setComments(comments);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function postComment(e) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      const { comment } = await api.post(`/api/tasks/${id}/comments`, { body });
      setComments((cs) => [...cs, comment]);
      setBody('');
    } catch (e) { setErr(e.message); }
  }

  async function checkpoint() {
    const msg = prompt('Checkpoint message (optional):') ?? null;
    if (msg === null) return; // cancelled
    setErr(null); setMsg(null);
    try {
      await api.post(`/api/tasks/${id}/checkpoint`, msg ? { commit_message: msg } : {});
      setMsg('Checkpoint pushed.');
      load();
    } catch (e) { setErr(e.message); }
  }

  async function submit() {
    if (!confirm('Submit task? This pushes everything and marks the task as ready for PR.')) return;
    setErr(null); setMsg(null);
    try {
      const r = await api.post(`/api/tasks/${id}/submit`, {});
      setMsg(`Submitted. Open PR: ${r.compare_url}`);
      load();
    } catch (e) { setErr(e.message); }
  }

  if (err && !task) return <div className="error">{err}</div>;
  if (!task) return <div className="muted">Loading…</div>;

  const isMine = task.assigned_to === user.id;
  const canCheckpoint = task.status === 'in_progress' && (isMine || user.role === 'admin');
  const active = ['in_progress', 'submitted'].includes(task.status);
  // SSO launch URL: own workspace via /api/me, admin viewing someone else's via /api/admin
  const ideLaunchUrl = active
    ? (isMine
        ? '/api/me/workspace/launch'
        : (user.role === 'admin' && task.assignee_workspace_id
            ? `/api/admin/workspaces/${task.assignee_workspace_id}/launch`
            : null))
    : null;

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/" className="muted" style={{ fontSize: 12 }}>← back to board</Link>
          <h2 style={{ margin: '4px 0 0' }}>#{task.id} · {task.title}</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            <span className={`badge ${task.status}`}>{task.status}</span>
            <span style={{ marginLeft: 10 }}>{task.project_name}</span>
            {task.branch_name && <span className="mono" style={{ marginLeft: 10 }}>{task.branch_name}</span>}
            {task.assigned_to_username && <span style={{ marginLeft: 10 }}>· {task.assigned_to_username}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {ideLaunchUrl && (
            <a href={ideLaunchUrl} target="_blank" rel="noreferrer">
              <button type="button">
                {isMine ? 'Open IDE →' : `Open ${task.assigned_to_username}'s IDE →`}
              </button>
            </a>
          )}
          {canCheckpoint && <button onClick={checkpoint}>Checkpoint</button>}
          {canCheckpoint && <button className="primary" onClick={submit}>Submit</button>}
          {task.pr_url && <a className="primary" href={task.pr_url} target="_blank" rel="noreferrer" style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--accent)', color: '#fff' }}>Open PR ↗</a>}
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="grid-2">
        <div>
          <div className="panel">
            <label>Description</label>
            <div style={{ whiteSpace: 'pre-wrap' }}>{task.description || <span className="muted">No description.</span>}</div>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Comments</h3>
            {comments.length === 0 && <div className="muted">No comments yet.</div>}
            {comments.map((c) => (
              <div key={c.id} style={{ borderBottom: '1px solid var(--border)', padding: '10px 0' }}>
                <div className="muted" style={{ fontSize: 12 }}><b>{c.author}</b> · {fmt(c.created_at)}</div>
                <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{c.body}</div>
              </div>
            ))}
            <form onSubmit={postComment} style={{ marginTop: 14 }}>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" />
              <button className="primary" style={{ marginTop: 8 }} type="submit" disabled={!body.trim()}>Comment</button>
            </form>
          </div>
        </div>

        <div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Timeline</h3>
            {events.length === 0 && <div className="muted">No events yet.</div>}
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {events.map((e) => (
                <li key={e.id} style={{ marginBottom: 8 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{fmt(e.created_at)}</span>
                  {' — '}
                  <b>{e.event_type}</b>
                  {e.to_status && <> → <span className={`badge ${e.to_status}`}>{e.to_status}</span></>}
                  {e.actor && <span className="muted"> by {e.actor}</span>}
                  {e.metadata?.message && <div className="muted" style={{ fontSize: 12 }}>"{e.metadata.message}"</div>}
                  {e.metadata?.pr_url && <div style={{ fontSize: 12 }}><a href={e.metadata.pr_url} target="_blank" rel="noreferrer">PR</a></div>}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Stats</h3>
            <div className="grid-2">
              <div><label>Created</label><div className="mono" style={{ fontSize: 12 }}>{fmt(task.created_at)}</div></div>
              <div><label>By</label><div>{task.created_by_username}</div></div>
              <div><label>Claimed</label><div className="mono" style={{ fontSize: 12 }}>{fmt(task.claimed_at)}</div></div>
              <div><label>Submitted</label><div className="mono" style={{ fontSize: 12 }}>{fmt(task.submitted_at)}</div></div>
              <div><label>Merged</label><div className="mono" style={{ fontSize: 12 }}>{fmt(task.merged_at)}</div></div>
              <div><label>Time to submit</label><div>{duration(task.claimed_at, task.submitted_at) || '—'}</div></div>
              <div><label>Time to merge</label><div>{duration(task.submitted_at, task.merged_at) || '—'}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
