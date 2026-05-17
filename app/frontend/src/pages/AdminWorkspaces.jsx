import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminWorkspaces() {
  const [workspaces, setWs] = useState([]);
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState(null);
  const [selectedUser, setSelectedUser] = useState('');
  const [adding, setAdding] = useState(null); // workspace id we're adding a preview to
  const [addForm, setAddForm] = useState({ name: '', internal_port: '' });

  const publicDomain = window.location.host.startsWith('platform.')
    ? window.location.host.replace(/^platform\./, '')
    : window.location.host;

  async function load() {
    try {
      setWs((await api.get('/api/admin/workspaces')).workspaces);
      setUsers((await api.get('/api/admin/users')).users);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!selectedUser) return;
    setErr(null);
    try { await api.post('/api/admin/workspaces', { user_id: Number(selectedUser) }); load(); setSelectedUser(''); }
    catch (e) { setErr(e.message); }
  }

  async function addPreview(wsId) {
    setErr(null);
    try {
      await api.post(`/api/admin/workspaces/${wsId}/previews`, {
        name: addForm.name.trim().toLowerCase(),
        internal_port: Number(addForm.internal_port),
      });
      setAddForm({ name: '', internal_port: '' });
      setAdding(null);
      load();
    } catch (e) { setErr(e.message); }
  }

  async function removePreview(wsId, pid) {
    if (!confirm('Remove this preview? Container will be recreated.')) return;
    setErr(null);
    try { await api.delete(`/api/admin/workspaces/${wsId}/previews/${pid}`); load(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <>
      <div className="page-header"><h2>Workspaces</h2></div>
      {err && <div className="error">{err}</div>}

      <div className="panel">
        <div className="row">
          <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
            <option value="">— pick a user to provision —</option>
            {users.filter((u) => !workspaces.find((w) => w.user_id === u.id)).map((u) => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
          <button className="primary" onClick={create} disabled={!selectedUser}>Provision workspace</button>
        </div>
      </div>

      {workspaces.length === 0 && <div className="muted">No workspaces provisioned.</div>}

      {workspaces.map((w) => (
        <div key={w.id} className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>{w.username}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                <code className="mono">{w.container_name}</code>
                <span className={`badge ${w.status}`} style={{ marginLeft: 8 }}>{w.status}</span>
                {w.current_task_id && <span style={{ marginLeft: 8 }}>· task <code className="mono">#{w.current_task_id}</code></span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {w.status === 'running'
                ? <button onClick={async () => { await api.post(`/api/admin/workspaces/${w.id}/stop`, {}); load(); }}>Stop</button>
                : <button onClick={async () => { await api.post(`/api/admin/workspaces/${w.id}/start`, {}); load(); }}>Start</button>}
            </div>
          </div>

          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <label>IDE URL</label>
              <div><a href={`https://${w.subdomain}.${publicDomain}`} target="_blank" rel="noreferrer">https://{w.subdomain}.{publicDomain}</a></div>
              <label style={{ marginTop: 8 }}>IDE password</label>
              <code className="mono">{w.ide_password}</code>
            </div>
            <div>
              <label>Nginx upstream (host loopback)</label>
              <code className="mono">127.0.0.1:{w.host_port}</code>
            </div>
          </div>

          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Preview URLs</h4>
              <button onClick={() => setAdding(adding === w.id ? null : w.id)}>
                {adding === w.id ? 'Cancel' : '+ Add preview port'}
              </button>
            </div>

            {adding === w.id && (
              <div className="row" style={{ marginBottom: 12 }}>
                <input placeholder="name (e.g. app, api, frontend)" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
                <input type="number" placeholder="internal port (e.g. 3000, 5173)" value={addForm.internal_port} onChange={(e) => setAddForm({ ...addForm, internal_port: e.target.value })} />
                <button className="primary" onClick={() => addPreview(w.id)} disabled={!addForm.name || !addForm.internal_port}>Add</button>
              </div>
            )}

            {(w.previews || []).length === 0
              ? <div className="muted" style={{ fontSize: 13 }}>No preview ports configured. Devs can still use code-server's <code className="mono">/proxy/&lt;port&gt;/</code> path.</div>
              : (
                <table>
                  <thead><tr><th>Name</th><th>URL</th><th>Internal port</th><th>Host port</th><th></th></tr></thead>
                  <tbody>
                    {w.previews.map((p) => {
                      const host = `${p.name}-${w.subdomain}.${publicDomain}`;
                      return (
                        <tr key={p.id}>
                          <td className="mono">{p.name}</td>
                          <td><a href={`https://${host}`} target="_blank" rel="noreferrer">https://{host}</a></td>
                          <td className="mono">{p.internal_port}</td>
                          <td className="mono">127.0.0.1:{p.host_port}</td>
                          <td style={{ textAlign: 'right' }}><button className="danger ghost" onClick={() => removePreview(w.id, p.id)}>Remove</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              ⚠ After adding/removing preview ports, the container is recreated and you must issue an SSL cert
              for the new subdomain: <code className="mono">bash scripts/issue-certs.sh &lt;name&gt;-{w.subdomain}.{publicDomain}</code> then <code className="mono">bash scripts/render-nginx.sh</code>.
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
