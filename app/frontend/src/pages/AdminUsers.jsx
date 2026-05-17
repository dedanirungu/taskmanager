import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const newBlank = {
  username: '', password: '', email: '',
  role: 'developer', access_scope: 'scoped', project_ids: [],
};

const editBlank = {
  password: '', email: '', telegram_chat_id: '',
  access_scope: 'scoped', project_ids: [],
};

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(newBlank);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(editBlank);

  async function load() {
    try {
      setUsers((await api.get('/api/admin/users')).users);
      setProjects((await api.get('/api/admin/projects')).projects);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr(null); setMsg(null);
    try {
      await api.post('/api/admin/users', {
        ...form,
        project_ids: form.project_ids.map(Number),
      });
      setForm(newBlank);
      setCreating(false);
      load();
    } catch (e) { setErr(e.message); }
  }

  function startEdit(u) {
    setEditing(u.id);
    setEditForm({
      password: '',
      email: u.email || '',
      telegram_chat_id: u.telegram_chat_id || '',
      access_scope: u.access_scope,
      project_ids: (u.project_ids || []).map(String),
    });
    setMsg(null); setErr(null);
  }

  async function save(u) {
    setErr(null); setMsg(null);
    try {
      const body = {
        email: editForm.email || null,
        telegram_chat_id: editForm.telegram_chat_id || null,
        access_scope: editForm.access_scope,
      };
      if (editForm.password.trim()) body.password = editForm.password.trim();
      if (editForm.access_scope === 'scoped') {
        body.project_ids = editForm.project_ids.map(Number);
      } else {
        body.project_ids = [];   // clear when scope is 'all'
      }
      await api.patch(`/api/admin/users/${u.id}`, body);
      setEditing(null);
      setMsg(`Updated ${u.username}` + (editForm.password ? ' (password changed)' : ''));
      load();
    } catch (e) { setErr(e.message); }
  }

  async function remove(u) {
    if (!confirm(`Delete user ${u.username}? This removes their workspace container too.`)) return;
    await api.delete(`/api/admin/users/${u.id}`);
    load();
  }

  function toggleNewPid(id) {
    setForm((f) => ({
      ...f,
      project_ids: f.project_ids.includes(String(id))
        ? f.project_ids.filter((x) => x !== String(id))
        : [...f.project_ids, String(id)],
    }));
  }
  function toggleEditPid(id) {
    setEditForm((f) => ({
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
      {msg && <div className="ok">{msg}</div>}

      {creating && (
        <form className="panel" onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label>Username</label><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div className="field"><label>Password</label><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></div>
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
                    onChange={() => toggleNewPid(p.id)} />
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
          <thead><tr><th>Username</th><th>Role</th><th>Scope</th><th>Email</th><th>Telegram</th><th>Projects</th><th></th></tr></thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 24, textAlign: 'center' }}>No users yet.</td></tr>}
            {users.map((u) => (
              editing === u.id ? (
                <tr key={u.id}>
                  <td><b>{u.username}</b><div className="muted" style={{ fontSize: 11 }}>{u.role}</div></td>
                  <td colSpan={6}>
                    <div className="grid-2">
                      <div className="field">
                        <label>New password <span className="muted">(leave blank to keep current)</span></label>
                        <input type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} autoComplete="new-password" placeholder="••••••••" />
                      </div>
                      <div className="field">
                        <label>Email</label>
                        <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Telegram chat ID <span className="muted">(optional)</span></label>
                        <input value={editForm.telegram_chat_id} onChange={(e) => setEditForm({ ...editForm, telegram_chat_id: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Access scope</label>
                        <select value={editForm.access_scope} onChange={(e) => setEditForm({ ...editForm, access_scope: e.target.value })}>
                          <option value="scoped">scoped (assigned projects only)</option>
                          <option value="all">all projects</option>
                        </select>
                      </div>
                    </div>
                    {editForm.access_scope === 'scoped' && (
                      <div className="field">
                        <label>Assigned projects</label>
                        {projects.length === 0 && <div className="muted">No projects yet.</div>}
                        {projects.map((p) => (
                          <label key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
                            <input type="checkbox" style={{ width: 'auto' }}
                              checked={editForm.project_ids.includes(String(p.id))}
                              onChange={() => toggleEditPid(p.id)} />
                            <span>{p.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <button className="primary" onClick={() => save(u)}>Save</button>{' '}
                      <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td><span className="badge">{u.role}</span></td>
                  <td className="muted">{u.access_scope}</td>
                  <td className="muted">{u.email || '—'}</td>
                  <td className="muted mono" style={{ fontSize: 12 }}>{u.telegram_chat_id || '—'}</td>
                  <td className="mono">{u.access_scope === 'all' ? '*' : (u.project_ids || []).join(', ') || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => startEdit(u)}>Edit</button>{' '}
                    <button className="danger ghost" onClick={() => remove(u)}>Delete</button>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
