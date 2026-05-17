import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const newBlank = {
  username: '', password: '', email: '',
  role: 'developer', access_scope: 'scoped', project_ids: [],
  workspace_subdomain: '',
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
  const [created, setCreated] = useState(null); // result of last successful creation

  async function load() {
    try {
      setUsers((await api.get('/api/admin/users')).users);
      setProjects((await api.get('/api/admin/projects')).projects);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr(null); setMsg(null); setCreated(null);
    try {
      const body = {
        username: form.username,
        password: form.password,
        email: form.email || null,
        role: form.role,
        access_scope: form.access_scope,
        project_ids: form.access_scope === 'scoped' ? form.project_ids.map(Number) : [],
      };
      if (form.workspace_subdomain) body.workspace_subdomain = form.workspace_subdomain;
      const result = await api.post('/api/admin/users', body);
      // Stash for the success panel; remember the plaintext password we just used.
      setCreated({ ...result, plaintext_password: form.password });
      setForm(newBlank);
      setCreating(false);
      await load();
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
      body.project_ids = editForm.access_scope === 'scoped' ? editForm.project_ids.map(Number) : [];
      await api.patch(`/api/admin/users/${u.id}`, body);
      setEditing(null);
      setMsg(`Updated ${u.username}` + (editForm.password ? ' (password changed)' : ''));
      load();
    } catch (e) { setErr(e.message); }
  }

  async function remove(u) {
    if (!confirm(`Delete user ${u.username}? This removes their workspace container, files, SSL cert, and nginx config.`)) return;
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
        <button className="primary" onClick={() => { setCreating((v) => !v); setCreated(null); }}>{creating ? 'Cancel' : '+ New user'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {msg && <div className="ok">{msg}</div>}

      {created && <CreatedPanel result={created} onDismiss={() => setCreated(null)} />}

      {creating && (
        <form className="panel" onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label>Username</label><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div className="field"><label>Password</label><input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></div>
            <div className="field"><label>Email <span className="muted">(optional)</span></label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
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
            {form.role === 'developer' && (
              <div className="field">
                <label>Workspace subdomain <span className="muted">(optional — defaults to dev&lt;id&gt;)</span></label>
                <input placeholder="e.g. alice" value={form.workspace_subdomain} onChange={(e) => setForm({ ...form, workspace_subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} />
              </div>
            )}
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

          {form.role === 'developer' && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              ↳ Workspace will be provisioned automatically: container + Let's Encrypt cert + nginx reload, ~1 min after Create.
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

function copy(text, setFlash) {
  navigator.clipboard.writeText(text).then(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 1200);
  });
}

function CopyableRow({ label, value, mono = true }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {mono ? <code className="mono">{value}</code> : <span>{value}</span>}
        <button className="ghost" type="button" onClick={() => copy(value, setCopied)}>{copied ? 'Copied!' : 'Copy'}</button>
      </div>
    </div>
  );
}

function CreatedPanel({ result, onDismiss }) {
  const { user, workspace, workspace_error, plaintext_password } = result;
  return (
    <div className="panel" style={{ borderColor: 'var(--ok)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{ marginTop: 0 }}>✓ Created {user.username}</h3>
        <button className="ghost" onClick={onDismiss}>Dismiss</button>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Save these now — the password and IDE password are only shown once.
      </p>

      <CopyableRow label="Platform login — username" value={user.username} />
      <CopyableRow label="Platform login — password" value={plaintext_password} />

      {workspace && (
        <>
          <hr style={{ borderColor: 'var(--border)', margin: '14px 0' }} />
          <h4 style={{ margin: '0 0 8px' }}>Workspace</h4>
          <CopyableRow label="IDE URL" value={workspace.url} />
          <CopyableRow label="IDE password" value={workspace.ide_password} />
          <CopyableRow label="Container" value={workspace.container_name} />
          <CopyableRow label="Host port (for nginx)" value={`127.0.0.1:${workspace.host_port}`} />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            SSL cert + nginx config: <b>automatic within ~1 minute</b> (host-side cron picks up the trigger file).
            If the URL still 404s after 2 minutes, run: <code className="mono">ssh root@&lt;vps&gt; 'cat /var/log/devplatform/triggers.log'</code>.
          </div>
        </>
      )}

      {workspace_error && (
        <div className="error" style={{ marginTop: 12 }}>
          User was created but workspace provisioning failed: {workspace_error}
        </div>
      )}
    </div>
  );
}
