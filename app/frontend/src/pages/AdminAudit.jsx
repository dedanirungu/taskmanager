import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminAudit() {
  const [entries, setEntries] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/admin/audit').then((r) => setEntries(r.entries)).catch((e) => setErr(e.message));
  }, []);

  return (
    <>
      <div className="page-header"><h2>Audit log</h2></div>
      {err && <div className="error">{err}</div>}
      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Payload</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{new Date(e.created_at).toISOString().replace('T', ' ').slice(0, 19)}</td>
                <td>{e.actor || <span className="muted">—</span>}</td>
                <td className="mono">{e.action}</td>
                <td className="mono">{e.target || ''}</td>
                <td className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', maxWidth: 380, overflow: 'hidden' }}>
                  {e.payload ? JSON.stringify(e.payload) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
