import { useAuth } from '../services/auth.tsx';

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <div className="card" style={{ maxWidth: 480, marginTop: 20 }}>
        <div className="field-label">Signed in as</div>
        <div style={{ marginBottom: 16 }}>{user?.email}</div>
        <div className="field-label">Account ID</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>{user?.id}</div>
      </div>
    </div>
  );
}
