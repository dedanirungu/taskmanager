import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const blank = {
  name: '', github_repo: '', default_branch: 'main', description: '',
  git_author_name: '', git_author_email: '',
};

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null); // project id being edited
  const [editForm, setEditForm] = useState(blank);

  async function load() {
    try { setProjects((await api.get('/api/admin/projects')).projects); }
    catch (e) { setErr(e.message); }
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
    });
  }

  async function save(id) {
    setErr(null);
    try {
      await api.patch(`/api/admin/projects/${id}`, {
        description: editForm.description,
        default_branch: editForm.default_branch,
        git_author_name:  editForm.git_author_name.trim()  || null,
        git_author_email: editForm.git_author_email.trim() || null,
      });
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
            <div className="field"><label>GitHub repo (owner/name)</label><input required placeholder="dedan/client1" value={form.github_repo} onChange={(e) => setForm({ ...form, github_repo: e.target.value })} /></div>
            <div className="field"><label>Default branch</label><input value={form.default_branch} onChange={(e) => setForm({ ...form, default_branch: e.target.value })} /></div>
            <div className="field"><label>Description</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="field">
              <label>Commit author name <span className="muted">(optional, used on this project's commits)</span></label>
              <input placeholder="e.g. ClientA Bot" value={form.git_author_name} onChange={(e) => setForm({ ...form, git_author_name: e.target.value })} />
            </div>
            <div className="field">
              <label>Commit author email</label>
              <input type="email" placeholder="bot@clientA.com" value={form.git_author_email} onChange={(e) => setForm({ ...form, git_author_email: e.target.value })} />
            </div>
          </div>
          <button className="primary" type="submit">Create</button>
        </form>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Repo</th><th>Branch</th><th>Commit author</th><th></th></tr></thead>
          <tbody>
            {projects.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24, textAlign: 'center' }}>No projects yet.</td></tr>}
            {projects.map((p) => (editing === p.id ? (
              <tr key={p.id}>
                <td>{p.name} <div className="muted mono" style={{ fontSize: 11 }}>{p.slug}</div></td>
                <td className="mono">{p.github_repo}</td>
                <td><input value={editForm.default_branch} onChange={(e) => setEditForm({ ...editForm, default_branch: e.target.value })} /></td>
                <td>
                  <input placeholder="name" value={editForm.git_author_name} onChange={(e) => setEditForm({ ...editForm, git_author_name: e.target.value })} />
                  <input style={{ marginTop: 4 }} placeholder="email" type="email" value={editForm.git_author_email} onChange={(e) => setEditForm({ ...editForm, git_author_email: e.target.value })} />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="primary" onClick={() => save(p.id)}>Save</button>{' '}
                  <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={p.id}>
                <td>{p.name} <div className="muted mono" style={{ fontSize: 11 }}>{p.slug}</div></td>
                <td className="mono">{p.github_repo}</td>
                <td className="mono">{p.default_branch}</td>
                <td>
                  {p.git_author_name
                    ? <span><b>{p.git_author_name}</b> <span className="muted">&lt;{p.git_author_email}&gt;</span></span>
                    : <span className="muted">(uses developer identity)</span>}
                </td>
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
