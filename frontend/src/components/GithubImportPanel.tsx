import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GithubImportResult, GithubRepo, GithubStatus } from '../types';
import { getGithubStatus, importGithubRepo, listGithubBranches, listGithubRepos, startGithubOAuth } from '../services/github';
import { useToast } from '../hooks/useToast';
import SelectMenu from './SelectMenu';
import ProjectManifestReview from './ProjectManifestReview';

// docs/GITHUB_IMPORT_PLAN.md -- the "Import from GitHub" half of Project
// Review's upload-source switch. Ends by handing a ProjectManifest to the
// same ProjectManifestReview screen ProjectUploadPanel uses: from that point
// on there is no difference between a zip upload and a GitHub import.
export default function GithubImportPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<GithubStatus | 'checking'>('checking');
  const [connecting, setConnecting] = useState(false);

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<GithubImportResult | null>(null);

  const { show } = useToast();

  const refreshStatus = () => getGithubStatus().then(setStatus).catch(() => setStatus({ connected: false }));

  useEffect(() => {
    refreshStatus();
  }, []);

  // Handles the return leg of the OAuth redirect (github.com -> our backend
  // callback -> here, with ?github=connected|error) -- clears the param
  // immediately so refreshing the page doesn't replay the toast.
  useEffect(() => {
    const outcome = searchParams.get('github');
    if (!outcome) return;
    if (outcome === 'connected') {
      show('GitHub connected', 'success');
      refreshStatus();
    } else if (outcome === 'error') {
      show('Failed to connect GitHub -- please try again', 'error');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('github');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (status === 'checking' || !status.connected) return;
    setRepos(null);
    setReposError(null);
    listGithubRepos()
      .then(setRepos)
      .catch((e) => {
        setReposError(e instanceof Error ? e.message : 'Failed to load repositories');
        if (e instanceof Error && e.message.toLowerCase().includes('no longer valid')) setStatus({ connected: false });
      });
  }, [status]);

  useEffect(() => {
    if (!selectedRepo) {
      setBranches(null);
      setSelectedBranch(null);
      return;
    }
    const [owner, repo] = selectedRepo.split('/');
    const repoMeta = repos?.find((r) => r.fullName === selectedRepo);
    setLoadingBranches(true);
    setBranches(null);
    listGithubBranches(owner, repo)
      .then((list) => {
        const names = list.map((b) => b.name);
        setBranches(names);
        setSelectedBranch(repoMeta?.defaultBranch && names.includes(repoMeta.defaultBranch) ? repoMeta.defaultBranch : names[0] ?? null);
      })
      .catch((e) => show(e instanceof Error ? e.message : 'Failed to load branches', 'error'))
      .finally(() => setLoadingBranches(false));
  }, [selectedRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await startGithubOAuth(); // navigates the browser away -- nothing after this runs
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to start GitHub connection', 'error');
      setConnecting(false);
    }
  };

  const handleLoadRepository = async () => {
    if (!selectedRepo || !selectedBranch) return;
    const [owner, repo] = selectedRepo.split('/');
    setImporting(true);
    try {
      const imported = await importGithubRepo(owner, repo, selectedBranch);
      setResult(imported);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to import repository', 'error');
    } finally {
      setImporting(false);
    }
  };

  if (result) {
    return (
      <div>
        <div className="card" style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)' }}>
          Imported from <strong style={{ color: 'var(--text)' }}>{result.repoFullName}</strong> @ {result.branch}
          {' '}(<code>{result.commitSha.slice(0, 7)}</code>)
        </div>
        <ProjectManifestReview
          manifest={result.manifest}
          onBack={() => setResult(null)}
          backLabel="Choose a different repository"
        />
      </div>
    );
  }

  if (status === 'checking') {
    return <div className="skeleton" style={{ height: 140 }} />;
  }

  if (!status.connected) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
        <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Import from GitHub</p>
        <p style={{ margin: '0 0 18px', color: 'var(--text-muted)', fontSize: 13 }}>
          Connect your GitHub account to select a repository for project review.
        </p>
        <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
          {connecting ? (<><span className="spinner" aria-hidden="true" />Connecting…</>) : 'Connect GitHub'}
        </button>
      </div>
    );
  }

  if (importing) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 24px' }}>
        <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2, margin: '0 auto 12px', display: 'block' }} aria-hidden="true" />
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Downloading and analyzing the repository…</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Select repository</p>
        {status.githubUsername && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Connected as @{status.githubUsername}</span>
        )}
      </div>

      {reposError ? (
        <p style={{ color: 'var(--danger)', fontSize: 13 }}>{reposError}</p>
      ) : repos === null ? (
        <div className="skeleton" style={{ height: 38, marginBottom: 12 }} />
      ) : repos.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No repositories found on this GitHub account.</p>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>Repository</label>
            <SelectMenu
              value={selectedRepo ?? ''}
              options={repos.map((r) => ({ value: r.fullName, label: r.fullName + (r.private ? ' 🔒' : '') }))}
              onChange={setSelectedRepo}
              ariaLabel="Repository"
            />
          </div>

          {selectedRepo && (
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>Branch</label>
              {loadingBranches || !branches ? (
                <div className="skeleton" style={{ height: 38 }} />
              ) : (
                <SelectMenu
                  value={selectedBranch ?? ''}
                  options={branches.map((b) => ({ value: b, label: b }))}
                  onChange={setSelectedBranch}
                  ariaLabel="Branch"
                />
              )}
            </div>
          )}

          <button className="btn btn-primary" onClick={handleLoadRepository} disabled={!selectedRepo || !selectedBranch}>
            Load Repository
          </button>
        </>
      )}
    </div>
  );
}
