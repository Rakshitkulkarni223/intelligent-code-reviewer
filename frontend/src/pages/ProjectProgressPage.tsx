import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { cancelProjectReview, getProjectReview } from '../services/projects';
import type { ProjectReview } from '../types';
import { queryKeys } from '../lib/queryKeys';
import ProjectFileStatusList from '../components/ProjectFileStatusList';
import ErrorState from '../components/ErrorState';
import { useToast } from '../hooks/useToast';

const POLL_MS = 1500;

// docs/PROJECT_ZIP_REVIEW_PLAN.md §5.4 -- grouped counts, cancellable, with
// a way to see completed files before the rest finish. This page and
// ProjectResultPage's own in-progress view are two routes over the same
// GET /api/projects/{id} poll; this one is the default landing spot right
// after submit, ProjectResultPage is reachable early via "View partial
// results" or automatically once the project reaches a terminal state.
export default function ProjectProgressPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const p = await getProjectReview(projectId);
        if (cancelled) return;
        setProject(p);
        if (p.status === 'COMPLETED' || p.status === 'FAILED' || p.status === 'CANCELLED') {
          // History's project list shows status/score for this same project
          // -- without this it'd keep showing "ANALYZING" until its own
          // staleTime lapses, even though this page already knows better.
          queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews });
          navigate(`/projects/${projectId}`, { replace: true });
          return;
        }
        timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load project');
      }
    };
    poll();

    return () => { cancelled = true; clearTimeout(timer); };
  }, [projectId, navigate, queryClient]);

  const handleCancel = async () => {
    if (!projectId) return;
    setCancelling(true);
    try {
      await cancelProjectReview(projectId);
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews });
      show('Cancelling remaining files…', 'success');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to cancel', 'error');
      setCancelling(false);
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

  const isCancelling = project.status === 'CANCELLING' || cancelling;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isCancelling && <span className="spinner" style={{ color: 'var(--accent)' }} aria-hidden="true" />}
            Reviewing {project.originalFilename}
          </h1>
          <p className="page-subtitle">{project.profile.projectType} &middot; {project.fileCount} files</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={handleCancel} disabled={isCancelling}>
            {isCancelling ? (<><span className="spinner" aria-hidden="true" />Cancelling…</>) : 'Cancel'}
          </button>
          <Link className="btn btn-primary" to={`/projects/${project.id}`}>View partial results →</Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', marginBottom: 14 }}>
          <div
            style={{
              height: '100%',
              width: `${project.fileCount ? (project.filesAnalyzed / project.fileCount) * 100 : 0}%`,
              background: 'var(--accent)', transition: 'width 0.3s',
            }}
          />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          {project.filesAnalyzed} / {project.fileCount} files
        </p>
      </div>

      <ProjectFileStatusList files={project.files} />
    </div>
  );
}
