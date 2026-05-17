import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await login(username, password); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Sign in</h1>
        <div className="field">
          <label>Username</label>
          <input autoFocus value={username} onChange={(e) => setU(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} required />
        </div>
        {err && <div className="error">{err}</div>}
        <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
