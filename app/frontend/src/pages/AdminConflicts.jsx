import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AdminConflicts() {
  const [conflicts, setConflicts] = useState([]);
  const [includeResolved, setIR] = useState(false);
  const [err, setErr] = useState(null);

  async function load() {
    try {
      const { conflicts } = await api.get(`/api/admin/conflicts${includeResolved ? '?resolved=1' : ''}`);
      setConflicts(conflicts);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [includeResolved]);

  return (
    <>
      <div className="page-header">
        <h2>Conflicts</h2>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={includeResolved} onChange={(e) => setIR(e.target.checked)} />
          <span>Include resolved</span>
        </label>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Project</th><th>Branches</th><th>Files</th><th>Alerted</th><th>Resolved</th></tr></thead>
          <tbody>
            {conflicts.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 24, textAlign: 'center' }}>No conflicts.</td></tr>}
            {conflicts.map((c) => (
              <tr key={c.id}>
                <td>{c.project_name}</td>
                <td>
                  <code className="mono">{c.branch_a}</code><br />
                  <span className="muted">↔</span><br />
                  <code className="mono">{c.branch_b}</code>
                </td>
                <td>
                  {(c.conflicting_files || []).length === 0 && <span className="muted">—</span>}
                  <ul style={{ paddingLeft: 18, margin: 0, fontSize: 12 }}>
                    {(c.conflicting_files || []).slice(0, 5).map((f) => <li key={f}><code className="mono">{f}</code></li>)}
                    {(c.conflicting_files || []).length > 5 && <li className="muted">…and {c.conflicting_files.length - 5} more</li>}
                  </ul>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{new Date(c.alerted_at).toISOString().slice(0, 19).replace('T', ' ')}</td>
                <td className="mono" style={{ fontSize: 12 }}>{c.resolved_at ? new Date(c.resolved_at).toISOString().slice(0, 19).replace('T', ' ') : <span className="muted">open</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
