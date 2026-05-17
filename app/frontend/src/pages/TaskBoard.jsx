import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function TaskBoard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ project_id: '', title: '', description: '' });
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    try {
      const { tasks } = await api.get('/api/tasks');
      setTasks(tasks);
      const { projects } = await api.get('/api/me/projects');
      setProjects(projects);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function claim(t) {
    setErr(null); setMsg(null);
    try {
      const res = await api.post(`/api/tasks/${t.id}/claim`, {});
      setMsg(`Claimed — opening ${res.workspace_url} (IDE password: ${res.ide_password})`);
      window.open(res.workspace_url, '_blank', 'noopener');
      await load();
    } catch (e) { setErr(e.message); }
  }

  async function createTask(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/tasks', {
        project_id: Number(form.project_id),
        title: form.title,
        description: form.description,
      });
      setForm({ project_id: '', title: '', description: '' });
      setCreating(false);
      await load();
    } catch (e) { setErr(e.message); }
  }

  const visible = statusFilter ? tasks.filter((t) => t.status === statusFilter) : tasks;

  return (
    <>
      <div className="page-header">
        <h2>Task board</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 180 }}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="submitted">Submitted</option>
            <option value="awaiting_review">Awaiting review</option>
            <option value="merged">Merged</option>
            <option value="closed">Closed</option>
          </select>
          {user.role === 'admin' && (
            <button className="primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ New task'}
            </button>
          )}
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      {creating && (
        <form className="panel" onSubmit={createTask}>
          <div className="field">
            <label>Project</label>
            <select required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">— choose —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Title</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Description (markdown ok)</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button className="primary" type="submit">Create task</button>
        </form>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Project</th>
              <th>Title</th>
              <th>Status</th>
              <th>Branch</th>
              <th>Assignee</th>
              <th>PR</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ padding: 24, textAlign: 'center' }}>No tasks.</td></tr>
            )}
            {visible.map((t) => (
              <tr key={t.id} style={{ cursor: 'pointer' }} onClick={(e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.tagName === 'INPUT') return;
                navigate(`/tasks/${t.id}`);
              }}>
                <td className="mono">{t.id}</td>
                <td>{t.project_name}</td>
                <td>
                  <div>{t.title}{t.comment_count > 0 && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>💬 {t.comment_count}</span>}</div>
                  {t.description && <div className="muted" style={{ fontSize: 12 }}>{t.description.slice(0, 80)}{t.description.length > 80 ? '…' : ''}</div>}
                </td>
                <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                <td className="mono">{t.branch_name || '—'}</td>
                <td>{t.assigned_to_username || <span className="muted">unassigned</span>}</td>
                <td>{t.pr_url ? <a href={t.pr_url} target="_blank" rel="noreferrer">PR</a> : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  {t.status === 'open' && <button onClick={(e) => { e.stopPropagation(); claim(t); }}>Claim</button>}
                  {(t.status === 'in_progress' || t.status === 'submitted' || t.status === 'awaiting_review') && (
                    <Link to={`/tasks/${t.id}`} onClick={(e) => e.stopPropagation()}>Open →</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        Need your IDE? <Link to="/workspace">Go to your workspace →</Link>
      </p>
    </>
  );
}
