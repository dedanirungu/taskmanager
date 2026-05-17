import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    username: '', password: '', email: '',
    role: 'developer', access_scope: 'scoped', project_ids: [],
  });

  async function load() {
    try {
      setUsers((await api.get('/api/admin/users')).users);
      setProjects((await api.get('/api/admin/projects')).projects);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/admin/users', {
        ...form,
        project_ids: form.project_ids.map(Number),
      });
      setForm({ username: '', password: '', email: '', role: 'developer', access_scope: 'scoped', project_ids: [] });
      setCreating(false);
      load();
    } catch (e) { setErr(e.message); }
  }

  async function remove(id) {
    if (!confirm('Delete user? This removes their workspace container too.')) return;
    await api.delete(`/api/admin/users/${id}`);
    load();
  }

  function togglePid(id) {
    setForm((f) => ({
      ...f,
      project_ids: f.project_ids.includes(String(id))
        ? f.project_ids.filter((x) => x !== String(id))
        : [...f.project_ids, String(id)],
    }));
  }

  return (
    <>
      <div className="page-header">
        <h2>Users</h2>
        <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New user'}</button>
      </div>
      {err && <div className="error">{err}</div>}

      {creating && (
        <form className="panel" onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label>Username</label><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div className="field"><label>Password</label><input required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="field"><label>Email (for git commits)</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="developer">developer</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className="field">
              <label>Access scope</label>
              <select value={form.access_scope} onChange={(e) => setForm({ ...form, access_scope: e.target.value })}>
                <option value="scoped">scoped (assigned projects only)</option>
                <option value="all">all projects</option>
              </select>
            </div>
          </div>
          {form.access_scope === 'scoped' && (
            <div className="field">
              <label>Assigned projects</label>
              {projects.length === 0 && <div className="muted">No projects yet — create one first.</div>}
              {projects.map((p) => (
                <label key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
                  <input type="checkbox" style={{ width: 'auto' }}
                    checked={form.project_ids.includes(String(p.id))}
                    onChange={() => togglePid(p.id)} />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          )}
          <button className="primary" type="submit">Create</button>
        </form>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Scope</th><th>Email</th><th>Projects</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td><span className="badge">{u.role}</span></td>
                <td className="muted">{u.access_scope}</td>
                <td className="muted">{u.email || '—'}</td>
                <td className="mono">{u.access_scope === 'all' ? '*' : (u.project_ids || []).join(', ') || '—'}</td>
                <td style={{ textAlign: 'right' }}><button className="danger ghost" onClick={() => remove(u.id)}>Delete</button></td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 24, textAlign: 'center' }}>No users yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
