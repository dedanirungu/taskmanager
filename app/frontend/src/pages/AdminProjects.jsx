import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const blank = {
  name: '', github_repo: '', default_branch: 'main', description: '',
  git_author_name: '', git_author_email: '', github_token: '', client_id: '',
};

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [clients, setClients]   = useState([]);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(blank);

  async function load() {
    try {
      setProjects((await api.get('/api/admin/projects')).projects);
      setClients((await api.get('/api/admin/clients')).clients);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/admin/projects', {
        ...form,
        git_author_name:  form.git_author_name.trim()  || null,
        git_author_email: form.git_author_email.trim() || null,
        github_token:     form.github_token.trim()     || null,
        client_id:        form.client_id ? Number(form.client_id) : null,
      });
      setForm(blank); setCreating(false); load();
    } catch (e) { setErr(e.message); }
  }

  function startEdit(p) {
    setEditing(p.id);
    setEditForm({
      name: p.name, github_repo: p.github_repo,
      default_branch: p.default_branch,
      description: p.description || '',
      git_author_name: p.git_author_name || '',
      git_author_email: p.git_author_email || '',
      github_token: '',
      client_id: p.client_id ? String(p.client_id) : '',
    });
  }

  async function save(id) {
    setErr(null);
    try {
      const body = {
        description: editForm.description,
        default_branch: editForm.default_branch,
        git_author_name:  editForm.git_author_name.trim()  || null,
        git_author_email: editForm.git_author_email.trim() || null,
        client_id:        editForm.client_id ? Number(editForm.client_id) : null,
      };
      if (editForm.github_token === 'clear') body.github_token = '';
      else if (editForm.github_token.trim()) body.github_token = editForm.github_token.trim();

      await api.patch(`/api/admin/projects/${id}`, body);
      setEditing(null); load();
    } catch (e) { setErr(e.message); }
  }

  async function remove(id) {
    if (!confirm('Delete project? Tasks will cascade.')) return;
    await api.delete(`/api/admin/projects/${id}`);
    load();
  }

  return (
    <>
      <div className="page-header">
        <h2>Projects</h2>
        <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New project'}</button>
      </div>
      {err && <div className="error">{err}</div>}

      {creating && (
        <form className="panel" onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>GitHub repo (owner/name)</label><input required placeholder="newgif/gif-backend" value={form.github_repo} onChange={(e) => setForm({ ...form, github_repo: e.target.value })} /></div>
            <div className="field">
              <label>Client <span className="muted">(optional, groups sibling repos)</span></label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">(no client — standalone project)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Default branch</label><input value={form.default_branch} onChange={(e) => setForm({ ...form, default_branch: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Description</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="field"><label>Commit author name <span className="muted">(optional)</span></label><input placeholder="defaults to PLATFORM_GIT_NAME" value={form.git_author_name} onChange={(e) => setForm({ ...form, git_author_name: e.target.value })} /></div>
            <div className="field"><label>Commit author email</label><input type="email" value={form.git_author_email} onChange={(e) => setForm({ ...form, git_author_email: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>GitHub PAT for this project <span className="muted">(optional)</span></label>
              <input type="password" placeholder="github_pat_xxx" value={form.github_token} onChange={(e) => setForm({ ...form, github_token: e.target.value })} autoComplete="off" />
            </div>
          </div>
          <button className="primary" type="submit">Create</button>
        </form>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Client</th><th>Repo</th><th>Branch</th><th>Commit author</th><th>PAT</th><th></th></tr></thead>
          <tbody>
            {projects.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 24, textAlign: 'center' }}>No projects yet.</td></tr>}
            {projects.map((p) => (editing === p.id ? (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <select value={editForm.client_id} onChange={(e) => setEditForm({ ...editForm, client_id: e.target.value })}>
                    <option value="">(none)</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="mono">{p.github_repo}</td>
                <td><input value={editForm.default_branch} onChange={(e) => setEditForm({ ...editForm, default_branch: e.target.value })} /></td>
                <td>
                  <input placeholder="author name" value={editForm.git_author_name} onChange={(e) => setEditForm({ ...editForm, git_author_name: e.target.value })} />
                  <input style={{ marginTop: 4 }} placeholder="author email" type="email" value={editForm.git_author_email} onChange={(e) => setEditForm({ ...editForm, git_author_email: e.target.value })} />
                </td>
                <td>
                  <input type="password" placeholder={p.has_github_token ? '••• ("clear" to remove)' : 'github_pat_xxx'} value={editForm.github_token} onChange={(e) => setEditForm({ ...editForm, github_token: e.target.value })} autoComplete="off" />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="primary" onClick={() => save(p.id)}>Save</button>{' '}
                  <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={p.id}>
                <td>{p.name}<div className="muted mono" style={{ fontSize: 11 }}>{p.slug}</div></td>
                <td>{p.client_name || <span className="muted">—</span>}</td>
                <td className="mono">{p.github_repo}</td>
                <td className="mono">{p.default_branch}</td>
                <td>{p.git_author_name ? <span><b>{p.git_author_name}</b> <span className="muted">&lt;{p.git_author_email}&gt;</span></span> : <span className="muted">(platform default)</span>}</td>
                <td>{p.has_github_token ? <span className="badge submitted">project PAT</span> : <span className="muted" style={{ fontSize: 12 }}>platform PAT</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => startEdit(p)}>Edit</button>{' '}
                  <button className="danger ghost" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </>
  );
}
