import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getProjectReview, retryProject, retryProjectFiles, retryProjectSummary } from '../services/projects';
import type { ProjectFile, ProjectReview, ScoreDimensions } from '../types';
import { queryKeys } from '../lib/queryKeys';
import { useToast } from '../hooks/useToast';
import ScoreCard from '../components/ScoreCard';
import ProjectScoreTable from '../components/ProjectScoreTable';
import ErrorState from '../components/ErrorState';

const POLL_MS = 2000;

// Mirrors backend/app/schemas/project_review.py's SCORE_EXCLUDED_TIERS --
// same eligible-file definition overallScore itself uses, so the dimension
// breakdown shown alongside it is computed over the same set, not a
// meaningless placeholder (ScoreCard has no "no data" state for dimensions).
const SCORE_EXCLUDED_TIERS = new Set(['config', 'test', 'docs']);
const DIMENSION_KEYS: (keyof ScoreDimensions)[] = ['correctness', 'security', 'performance', 'quality', 'architecture'];

function aggregateDimensions(files: ProjectFile[]): ScoreDimensions | null {
  const eligible = files.filter((f) => f.status === 'COMPLETED' && !SCORE_EXCLUDED_TIERS.has(f.tier) && f.result);
  if (eligible.length === 0) return null;
  const sums: ScoreDimensions = { correctness: 0, security: 0, performance: 0, quality: 0, architecture: 0 };
  for (const f of eligible) {
    for (const key of DIMENSION_KEYS) sums[key] += f.result!.dimensions[key];
  }
  for (const key of DIMENSION_KEYS) sums[key] = Math.round((sums[key] / eligible.length) * 10) / 10;
  return sums;
}

// docs/PROJECT_ZIP_REVIEW_PLAN.md §5.5. Order is deliberate: score -> "needs
// attention first" -> project summary -> the full file table, since "what
// should I fix" is what a user opening this page wants first.
//
// Doubles as the "partial results" view (§5.4): reachable while the project
// is still ANALYZING (via ProjectProgressPage's "View partial results" link),
// in which case a banner replaces the usual header and not-yet-terminal
// files show a status badge instead of a score in the table -- no separate
// API shape, just the same GET /api/projects/{id} poll ProjectProgressPage
// itself uses.
export default function ProjectResultPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { show } = useToast();

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const p = await getProjectReview(projectId);
        if (cancelled) return;
        setProject(p);
        if (p.status === 'QUEUED' || p.status === 'ANALYZING' || p.status === 'CANCELLING') {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load project');
      }
    };
    poll();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [projectId]);

  // retry-files/retry both put the project back into QUEUED/ANALYZING and
  // do the actual re-analysis asynchronously in the worker -- routing
  // through the progress page reuses its existing poll-until-terminal-then-
  // redirect-back-here logic rather than duplicating it here.
  const handleRetryFiles = async (fileIds?: string[]) => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await retryProjectFiles(projectId, fileIds);
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews });
      navigate(`/projects/${projectId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to retry', 'error');
      setRetrying(false);
    }
  };

  const handleRetryProject = async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      await retryProject(projectId);
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews });
      navigate(`/projects/${projectId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to retry', 'error');
      setRetrying(false);
    }
  };

  // Unlike the two above, this never touches file status or the project's
  // QUEUED/ANALYZING lifecycle -- it's a single synchronous call that
  // returns the updated project directly, so there's nothing to poll for.
  const handleRetrySummary = async () => {
    if (!projectId || retrying) return;
    setRetrying(true);
    try {
      const updated = await retryProjectSummary(projectId);
      setProject(updated);
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews });
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to regenerate the summary', 'error');
    } finally {
      setRetrying(false);
    }
  };

  if (error) return <ErrorState message={error} />;
  if (!project) {
    return (
      <div className="card" style={{ maxHeight: 300 }}>
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  const stillRunning = project.status === 'QUEUED' || project.status === 'ANALYZING' || project.status === 'CANCELLING';
  const dimensions = aggregateDimensions(project.files);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{project.originalFilename}</h1>
          <p className="page-subtitle">{project.profile.projectType} &middot; {project.fileCount} files reviewed &middot; {project.totalLines.toLocaleString()} lines</p>
        </div>
        <Link className="btn" to="/history">Back to history</Link>
      </div>

      {stillRunning && (
        <div className="info-banner" role="status" style={{ marginBottom: 20 }}>
          <div className="info-banner-main" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {project.status !== 'CANCELLING' && <span className="spinner" style={{ color: 'var(--accent)', margin: 0 }} aria-hidden="true" />}
            <p className="info-banner-text">
              {project.status === 'CANCELLING'
                ? <>Cancelling this review — files already in progress will finish, no new ones will start. {project.filesAnalyzed} of {project.fileCount} files done so far.</>
                : <>This review is still in progress — {project.filesAnalyzed} of {project.fileCount} files analyzed. The results below will keep updating as more finish.</>}
            </p>
          </div>
          <div className="info-banner-actions">
            <Link className="btn" to={`/projects/${project.id}/progress`}>View live progress →</Link>
          </div>
        </div>
      )}

      {project.status === 'FAILED' && (
        <div className="confidence-picker" style={{ marginBottom: 20, justifyContent: 'space-between' }} role="alert">
          <span>{project.error ?? "We couldn't analyze the project because of a temporary processing or network issue."}</span>
          <button className="btn" onClick={handleRetryProject} disabled={retrying}>
            {retrying ? (<><span className="spinner" aria-hidden="true" />Retrying…</>) : 'Retry Project'}
          </button>
        </div>
      )}

      {project.status === 'PARTIAL' && (
        <div className="info-banner" role="status" style={{ marginBottom: 20 }}>
          <div className="info-banner-main">
            <p className="info-banner-text">
              Project Review · Partially Completed — {project.files.filter((f) => f.status === 'COMPLETED').length} of{' '}
              {project.fileCount} files analyzed successfully, {project.files.filter((f) => f.status === 'FAILED').length} failed.
              Score calculated from the files that succeeded.
            </p>
          </div>
          <div className="info-banner-actions">
            <button className="btn btn-primary" onClick={() => handleRetryFiles()} disabled={retrying}>
              {retrying ? (<><span className="spinner" aria-hidden="true" />Retrying…</>) : 'Retry Failed Files'}
            </button>
          </div>
        </div>
      )}

      {(project.status === 'COMPLETED' || project.status === 'PARTIAL') && project.summary == null
        && project.files.some((f) => f.status === 'COMPLETED') && (
        <div className="info-banner" role="status" style={{ marginBottom: 20 }}>
          <div className="info-banner-main">
            <p className="info-banner-text">File analysis completed, but the final project report could not be generated.</p>
          </div>
          <div className="info-banner-actions">
            <button className="btn" onClick={handleRetrySummary} disabled={retrying}>
              {retrying ? (<><span className="spinner" aria-hidden="true" />Retrying…</>) : 'Retry Final Report'}
            </button>
          </div>
        </div>
      )}

      {project.overallScore != null && dimensions && (
        <div className="result-layout" style={{ marginBottom: 20 }}>
          <div className="result-sidebar">
            <ScoreCard score={project.overallScore} dimensions={dimensions} />
          </div>
          <div>
            {project.worstFiles.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 15, marginTop: 0 }}>Needs attention first</h2>
                {project.worstFiles.map((w) => (
                  <Link
                    key={w.fileId}
                    to={`/projects/${project.id}/files/${w.fileId}`}
                    style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', color: 'inherit', textDecoration: 'none' }}
                  >
                    <span>⚠ {w.path}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{w.score.toFixed(1)} &middot; {w.issueCount} issue{w.issueCount === 1 ? '' : 's'}</span>
                  </Link>
                ))}
              </div>
            )}
            {project.summary && (
              <div className="card">
                <h2 style={{ fontSize: 15, marginTop: 0 }}>Project summary</h2>
                <p style={{ color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>{project.summary}</p>
                {project.recommendations.length > 0 && (
                  <ul style={{ marginTop: 14, marginBottom: 0, paddingLeft: 20, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                    {project.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ProjectScoreTable projectId={project.id} files={project.files} onRetryFile={(fileId) => handleRetryFiles([fileId])} />
    </div>
  );
}
