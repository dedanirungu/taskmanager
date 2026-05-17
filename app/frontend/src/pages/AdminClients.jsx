import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminClients() {
  const [clients, setClients] = useState([]);
  const [err, setErr] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  async function load() {
    try { setClients((await api.get('/api/admin/clients')).clients); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post('/api/admin/clients', form);
      setForm({ name: '', description: '' });
      setCreating(false);
      load();
    } catch (e) { setErr(e.message); }
  }

  async function save(id) {
    setErr(null);
    try {
      await api.patch(`/api/admin/clients/${id}`, editForm);
      setEditing(null); load();
    } catch (e) { setErr(e.message); }
  }

  async function remove(id) {
    if (!confirm('Delete this client? Its projects will remain (unassigned).')) return;
    await api.delete(`/api/admin/clients/${id}`);
    load();
  }

  return (
    <>
      <div className="page-header">
        <h2>Clients</h2>
        <button className="primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New client'}</button>
      </div>
      {err && <div className="error">{err}</div>}

      {creating && (
        <form className="panel" onSubmit={create}>
          <div className="grid-2">
            <div className="field"><label>Name</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. GIF" /></div>
            <div className="field"><label>Description</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="(optional)" /></div>
          </div>
          <button className="primary" type="submit">Create</button>
        </form>
      )}

      {clients.length === 0 && <div className="muted">No clients yet. Add one, then assign projects to it from Admin → Projects.</div>}

      {clients.map((c) => (
        <div key={c.id} className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {editing === c.id ? (
                <div className="grid-2">
                  <div className="field"><label>Name</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
                  <div className="field"><label>Description</label><input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></div>
                </div>
              ) : (
                <>
                  <h3 style={{ margin: 0 }}>{c.name}</h3>
                  <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>{c.slug}</div>
                  {c.description && <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{c.description}</div>}
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {editing === c.id
                ? (<><button className="primary" onClick={() => save(c.id)}>Save</button><button className="ghost" onClick={() => setEditing(null)}>Cancel</button></>)
                : (<>
                    <button onClick={() => { setEditing(c.id); setEditForm({ name: c.name, description: c.description || '' }); }}>Edit</button>
                    <button className="danger ghost" onClick={() => remove(c.id)}>Delete</button>
                  </>)}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label>Projects in this client</label>
            {c.projects.length === 0
              ? <div className="muted" style={{ fontSize: 13 }}>None yet. Edit a project to assign it to this client.</div>
              : (
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {c.projects.map((p) => (
                    <li key={p.id}>
                      <b>{p.name}</b> <span className="muted mono" style={{ fontSize: 11 }}>{p.github_repo}</span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      ))}
    </>
  );
}
