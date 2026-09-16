import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ManifestFile, ProjectManifest, ReviewMode } from '../types';
import { createProjectReview } from '../services/projects';
import { queryKeys } from '../lib/queryKeys';
import { useToast } from '../hooks/useToast';
import ProjectFileTree from './ProjectFileTree';

// The file-selection/review-mode/submit screen shown once ANY source has
// produced a ProjectManifest -- originally only zip upload
// (ProjectUploadPanel), now shared with GitHub import (GithubImportPanel)
// too, since neither create_project_review nor anything below it cares
// where the manifest's uploadToken came from (docs/GITHUB_IMPORT_PLAN.md
// §4.5's "only the input path changes" point, extended to the frontend).
export default function ProjectManifestReview({
  manifest,
  onBack,
  backLabel,
}: {
  manifest: ProjectManifest;
  onBack: () => void;
  backLabel: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(manifest.files.filter((f) => f.defaultSelected).map((f) => f.path))
  );
  const [reviewMode, setReviewMode] = useState<ReviewMode>('standard');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const applyMode = (mode: ReviewMode, files: ManifestFile[]) => {
    setReviewMode(mode);
    setSelected(new Set(files.filter((f) => (mode === 'comprehensive' ? true : f.defaultSelected)).map((f) => f.path)));
  };

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleManyFiles = (paths: string[], nextSelected: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (nextSelected) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  };

  const totals = useMemo(() => {
    const files = manifest.files.filter((f) => selected.has(f.path));
    return { count: files.length, lines: files.reduce((s, f) => s + f.lines, 0) };
  }, [manifest, selected]);

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const { projectId } = await createProjectReview(manifest.uploadToken, [...selected], reviewMode);
      queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews });
      navigate(`/projects/${projectId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to start project review', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="card project-summary-card" style={{ marginBottom: 16 }}>
        <div className="project-summary-heading">
          <span className="project-summary-icon" aria-hidden="true">📦</span>
          <div>
            <div className="project-summary-name">{manifest.originalFilename}</div>
            <div className="project-summary-meta">{manifest.profile.projectType} &middot; {manifest.profile.estimatedComplexity} project</div>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Review mode</span>
        <div className="segmented" role="tablist">
          <button
            role="tab" aria-selected={reviewMode === 'standard'}
            className={`segmented-option${reviewMode === 'standard' ? ' active' : ''}`}
            onClick={() => applyMode('standard', manifest.files)}
          >
            Standard
          </button>
          <button
            role="tab" aria-selected={reviewMode === 'comprehensive'}
            className={`segmented-option${reviewMode === 'comprehensive' ? ' active' : ''}`}
            onClick={() => applyMode('comprehensive', manifest.files)}
          >
            Comprehensive
          </button>
        </div>
        {reviewMode === 'standard' && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>tests, docs &amp; config skipped by default</span>
        )}
      </div>

      <ProjectFileTree
        files={manifest.files}
        excluded={manifest.excluded}
        selected={selected}
        onToggle={toggleFile}
        onToggleMany={toggleManyFiles}
        onSelectAll={() => setSelected(new Set(manifest.files.map((f) => f.path)))}
        onDeselectAll={() => setSelected(new Set())}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={totals.count === 0 || submitting}>
          {submitting ? (<><span className="spinner" aria-hidden="true" />Creating project…</>) : `Review Project (${totals.count} files) →`}
        </button>
      </div>
    </div>
  );
}
