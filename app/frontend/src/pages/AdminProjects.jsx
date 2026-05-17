import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminProjects() {
  const [projects, setProjects] = useState([]);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({ name: '', github_repo: '', default_branch: 'main', description: '' });
  const [creating, setCreating] = useState(false);

  async function load() {
    try { setProjects((await api.get('/api/admin/projects')).projects); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/admin/projects', form);
      setForm({ name: '', github_repo: '', default_branch: 'main', description: '' });
      setCreating(false);
      load();
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
          </div>
          <button className="primary" type="submit">Create</button>
        </form>
      )}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Name</th><th>Slug</th><th>Repo</th><th>Default branch</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="mono">{p.slug}</td>
                <td className="mono">{p.github_repo}</td>
                <td className="mono">{p.default_branch}</td>
                <td style={{ textAlign: 'right' }}><button className="danger ghost" onClick={() => remove(p.id)}>Delete</button></td>
              </tr>
            ))}
            {projects.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24, textAlign: 'center' }}>No projects yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
