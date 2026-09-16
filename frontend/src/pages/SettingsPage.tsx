import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../services/auth.tsx';
import { disconnectGithub, getGithubStatus } from '../services/github';
import { queryKeys } from '../lib/queryKeys';
import { useToast } from '../hooks/useToast';

export default function SettingsPage() {
  const { user } = useAuth();
  const [disconnecting, setDisconnecting] = useState(false);
  const { show } = useToast();
  const queryClient = useQueryClient();

  // Shares one cache entry with GithubImportPanel (queryKeys.githubStatus)
  // -- Settings is its own route, so it fully remounts every visit; without
  // this it re-fetched and flashed a loading skeleton every single time.
  const { data: github } = useQuery({ queryKey: queryKeys.githubStatus, queryFn: getGithubStatus });

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGithub();
      queryClient.setQueryData(queryKeys.githubStatus, { connected: false });
      show('GitHub disconnected', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to disconnect GitHub', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <div className="card" style={{ maxWidth: 480, marginTop: 20 }}>
        <div className="field-label">Signed in as</div>
        <div style={{ marginBottom: 16 }}>{user?.email}</div>
        <div className="field-label">Account ID</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>{user?.id}</div>
      </div>

      <div className="card" style={{ maxWidth: 480, marginTop: 16 }}>
        <div className="field-label">Integrations</div>
        {!github ? (
          <div className="skeleton" style={{ height: 36 }} />
        ) : github.connected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14 }}>GitHub</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Connected as @{github.githubUsername}</div>
            </div>
            <button className="btn btn-danger" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? (<><span className="spinner" aria-hidden="true" />Disconnecting…</>) : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            GitHub is not connected. Connect it from Project Review's "Import from GitHub" tab.
          </div>
        )}
      </div>
    </div>
  );
}
