import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminWorkspaces() {
  const [workspaces, setWs] = useState([]);
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState(null);
  const [selectedUser, setSelectedUser] = useState('');

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
    try { await api.post('/api/admin/workspaces', { user_id: Number(selectedUser) }); load(); }
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

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>User</th><th>Container</th><th>Subdomain</th><th>Nginx upstream</th><th>IDE password</th><th>Status</th><th>Task</th><th></th></tr></thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id}>
                <td>{w.username}</td>
                <td className="mono">{w.container_name}</td>
                <td className="mono">{w.subdomain}</td>
                <td className="mono">{w.host_port ? `127.0.0.1:${w.host_port}` : '—'}</td>
                <td className="mono">{w.ide_password}</td>
                <td><span className={`badge ${w.status}`}>{w.status}</span></td>
                <td>{w.current_task_id ? <code className="mono">#{w.current_task_id}</code> : <span className="muted">idle</span>}</td>
                <td style={{ textAlign: 'right' }}>
                  {w.status === 'running'
                    ? <button onClick={async () => { await api.post(`/api/admin/workspaces/${w.id}/stop`, {}); load(); }}>Stop</button>
                    : <button onClick={async () => { await api.post(`/api/admin/workspaces/${w.id}/start`, {}); load(); }}>Start</button>}
                </td>
              </tr>
            ))}
            {workspaces.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 24, textAlign: 'center' }}>No workspaces provisioned.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
