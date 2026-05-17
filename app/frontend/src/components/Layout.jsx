import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [activeTaskId, setActiveTaskId] = useState(null);

  useEffect(() => {
    if (user.role === 'admin') return;
    api.get('/api/me/workspace')
      .then((r) => setActiveTaskId(r.workspace?.current_task_id || null))
      .catch(() => {});
  }, [user.id, user.role]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>DevPlatform</h1>
        <nav>
          {user.role === 'admin' && <NavLink to="/admin" end>Dashboard</NavLink>}
          <NavLink to="/" end>Task board</NavLink>
          <NavLink to="/workspace">
            My workspace
            {activeTaskId && <span className="badge in_progress" style={{ marginLeft: 6 }}>#{activeTaskId}</span>}
          </NavLink>

          {user.role === 'admin' && (
            <>
              <div style={{ marginTop: 16, color: '#666', fontSize: 11, padding: '0 10px' }}>ADMIN</div>
              <NavLink to="/admin/clients">Clients</NavLink>
              <NavLink to="/admin/projects">Projects</NavLink>
              <NavLink to="/admin/users">Users</NavLink>
              <NavLink to="/admin/workspaces">Workspaces</NavLink>
              <NavLink to="/admin/conflicts">Conflicts</NavLink>
              <NavLink to="/admin/audit">Audit log</NavLink>
            </>
          )}
        </nav>
        <div className="me">
          <div>{user.username}</div>
          <div style={{ marginTop: 4 }}>{user.role} · {user.access_scope}</div>
          <button className="ghost" style={{ marginTop: 10, width: '100%' }} onClick={logout}>Log out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
