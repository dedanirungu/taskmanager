import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';

function fmtSeconds(s) {
  if (!s || s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/api/admin/dashboard').then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const sc = data.status_counts || {};

  return (
    <>
      <div className="page-header"><h2>Dashboard</h2></div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Open"           value={sc.open || 0} />
        <Stat label="In progress"    value={sc.in_progress || 0} />
        <Stat label="Submitted"      value={sc.submitted || 0} />
        <Stat label="Awaiting review" value={sc.awaiting_review || 0} />
        <Stat label="Merged"         value={sc.merged || 0} />
        <Stat label="Closed"         value={sc.closed || 0} />
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Per project</h3>
          <table>
            <thead><tr><th>Project</th><th>Open</th><th>WIP</th><th>Submitted</th><th>Review</th><th>Merged</th></tr></thead>
            <tbody>
              {data.per_project.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">{p.open}</td>
                  <td className="mono">{p.in_progress}</td>
                  <td className="mono">{p.submitted}</td>
                  <td className="mono">{p.awaiting_review}</td>
                  <td className="mono">{p.merged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Active claims</h3>
          {data.active_claims.length === 0 && <div className="muted">Nobody working right now.</div>}
          <table>
            <thead><tr><th>#</th><th>Title</th><th>Project</th><th>Assignee</th><th>Claimed</th></tr></thead>
            <tbody>
              {data.active_claims.map((c) => (
                <tr key={c.id}>
                  <td className="mono"><Link to={`/tasks/${c.id}`}>{c.id}</Link></td>
                  <td>{c.title}</td>
                  <td>{c.project_name}</td>
                  <td>{c.assignee}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{new Date(c.claimed_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Durations (merged tasks)</h3>
          <div className="grid-2">
            <div>
              <label>Avg claim → submit</label>
              <div style={{ fontSize: 18 }}>{fmtSeconds(data.durations.avg_claim_to_submit_seconds)}</div>
            </div>
            <div>
              <label>Avg submit → merge</label>
              <div style={{ fontSize: 18 }}>{fmtSeconds(data.durations.avg_submit_to_merge_seconds)}</div>
            </div>
            <div>
              <label>Sample size</label>
              <div style={{ fontSize: 18 }}>{data.durations.submitted_count ?? 0}</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Open conflicts</h3>
          {data.open_conflicts.length === 0
            ? <div className="muted">No open conflicts. 🎉</div>
            : (
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {data.open_conflicts.map((c) => (
                  <li key={c.id}>
                    <b>{c.project_name}</b>: <code className="mono">{c.branch_a}</code> ↔ <code className="mono">{c.branch_b}</code>
                    <div className="muted" style={{ fontSize: 12 }}>{c.conflicting_files?.length || 0} file(s)</div>
                  </li>
                ))}
              </ul>
            )}
          <Link to="/admin/conflicts" style={{ fontSize: 13 }}>All conflicts →</Link>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Recent activity</h3>
        <table>
          <thead><tr><th>When</th><th>Task</th><th>Event</th><th>Status</th><th>Actor</th></tr></thead>
          <tbody>
            {data.recent_events.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 12 }}>{new Date(e.created_at).toISOString().slice(0, 19).replace('T', ' ')}</td>
                <td><Link to={`/tasks/${e.task_id}`}>#{e.task_id} {e.task_title}</Link></td>
                <td><code className="mono">{e.event_type}</code></td>
                <td>{e.to_status && <span className={`badge ${e.to_status}`}>{e.to_status}</span>}</td>
                <td>{e.actor || <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.04 }}>{label}</div>
      <div style={{ fontSize: 24, marginTop: 4 }}>{value}</div>
    </div>
  );
}
