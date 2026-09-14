import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProjectFile } from '../services/projects';
import type { ProjectFile } from '../types';
import LanguageBadge from '../components/LanguageBadge';
import ReviewResultView from '../components/ReviewResultView';
import ErrorState from '../components/ErrorState';

const POLL_MS = 1500;

// docs/PROJECT_ZIP_REVIEW_PLAN.md §5.5 -- a project file's drill-down.
// Renders through the same ReviewResultView a single Review's result page
// uses (tabs, ScoreCard, IssueList, the fix flow), with its own chrome for
// what's specific to a ProjectFile: pending/failed states, and the
// truncated-file banner in the same visual slot ReviewResultPage's
// resubmission banner uses.
export default function ProjectFileResultPage() {
  const { projectId, fileId } = useParams<{ projectId: string; fileId: string }>();
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !fileId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const f = await getProjectFile(projectId, fileId);
        if (cancelled) return;
        setFile(f);
        if (f.status === 'QUEUED' || f.status === 'ANALYZING') {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load file');
      }
    };
    poll();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [projectId, fileId]);

  if (error) return <ErrorState message={error} />;
  if (!file) {
    return (
      <div className="card" style={{ maxHeight: 300 }}>
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{file.path}</h1>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            <LanguageBadge language={file.language} />
            <span className="badge">{file.tier}</span>
          </div>
        </div>
        <Link className="btn" to={`/projects/${projectId}`}>Back to project</Link>
      </div>

      {file.truncated && (
        <div className="info-banner" role="status" style={{ marginBottom: 20 }}>
          <div className="info-banner-main">
            <p className="info-banner-text">{file.truncatedNote}</p>
          </div>
        </div>
      )}

      {(file.status === 'QUEUED' || file.status === 'ANALYZING') && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-muted)' }}>
            {file.status === 'QUEUED' ? 'Waiting to be analyzed…' : 'Analyzing…'}
          </p>
        </div>
      )}

      {file.status === 'FAILED' && (
        <div className="confidence-picker" role="alert">
          {file.error ?? 'Analysis failed for this file.'}
        </div>
      )}

      {file.status === 'SKIPPED' && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-muted)' }}>This file was skipped because the project review was cancelled before it started.</p>
        </div>
      )}

      {file.status === 'COMPLETED' && file.result && (
        <ReviewResultView result={file.result} code={file.code} language={file.language} fixBaseId={file.id} />
      )}
    </div>
  );
}
