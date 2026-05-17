import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import Layout from './components/Layout.jsx';
import TaskBoard from './pages/TaskBoard.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import MyWorkspace from './pages/MyWorkspace.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import AdminClients from './pages/AdminClients.jsx';
import AdminProjects from './pages/AdminProjects.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminWorkspaces from './pages/AdminWorkspaces.jsx';
import AdminConflicts from './pages/AdminConflicts.jsx';
import AdminAudit from './pages/AdminAudit.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Inner />
    </AuthProvider>
  );
}

function Inner() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 24, color: '#888' }}>Loading…</div>;
  if (!user) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<TaskBoard />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/workspace" element={<MyWorkspace />} />

        {user.role === 'admin' && <Route path="/admin"            element={<AdminDashboard />} />}
        {user.role === 'admin' && <Route path="/admin/clients"    element={<AdminClients />} />}
        {user.role === 'admin' && <Route path="/admin/projects"   element={<AdminProjects />} />}
        {user.role === 'admin' && <Route path="/admin/users"      element={<AdminUsers />} />}
        {user.role === 'admin' && <Route path="/admin/workspaces" element={<AdminWorkspaces />} />}
        {user.role === 'admin' && <Route path="/admin/conflicts"  element={<AdminConflicts />} />}
        {user.role === 'admin' && <Route path="/admin/audit"      element={<AdminAudit />} />}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
