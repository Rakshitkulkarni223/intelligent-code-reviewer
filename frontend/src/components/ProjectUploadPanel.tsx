import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ManifestFile, ProjectManifest, ReviewMode } from '../types';
import { createProjectReview, uploadProjectManifest } from '../services/projects';
import { useToast } from '../hooks/useToast';
import { filesToZip, isSingleZipFile } from '../lib/buildZip';
import ProjectFileTree from './ProjectFileTree';

const MAX_ZIP_MB = 25;

// docs/PROJECT_ZIP_REVIEW_PLAN.md §5.1/§5.2/§5.3 -- the Project (.zip) half
// of NewReviewPage's mode switch. Kept as its own component so the
// single-file path (CodeEditor/ReviewButton/etc.) is never touched by this.
export default function ProjectUploadPanel() {
  const [dragging, setDragging] = useState(false);
  const [bundling, setBundling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewMode, setReviewMode] = useState<ReviewMode>('standard');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { show } = useToast();
  const folderInputRef = useRef<HTMLInputElement>(null);

  const applyMode = (mode: ReviewMode, files: ManifestFile[]) => {
    setReviewMode(mode);
    setSelected(new Set(files.filter((f) => (mode === 'comprehensive' ? true : f.defaultSelected)).map((f) => f.path)));
  };

  const uploadZip = async (file: File) => {
    if (file.size > MAX_ZIP_MB * 1024 * 1024) {
      show(`Archive exceeds the ${MAX_ZIP_MB} MB limit.`, 'error');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const m = await uploadProjectManifest(file, setProgress);
      setManifest(m);
      applyMode('standard', m.files);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to process archive', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Single entry point for every input shape this panel accepts: one
  // already-zipped archive (used as-is), or a folder / several loose files
  // (bundled into a zip client-side, then fed through the exact same
  // uploadZip path -- the backend only ever parses real zip bytes).
  const loadEntries = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    if (isSingleZipFile(files)) {
      await uploadZip(files[0]);
      return;
    }

    setBundling(true);
    try {
      const zip = await filesToZip(files);
      await uploadZip(zip);
    } catch {
      show('Failed to bundle the selected files into an archive.', 'error');
    } finally {
      setBundling(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) loadEntries(e.dataTransfer.files);
  };

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Bulk toggle for a folder checkbox in the nested tree -- selecting or
  // deselecting every file under that folder in one state update rather
  // than one onToggle call per file.
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
    if (!manifest) return null;
    const files = manifest.files.filter((f) => selected.has(f.path));
    return { count: files.length, lines: files.reduce((s, f) => s + f.lines, 0) };
  }, [manifest, selected]);

  const handleSubmit = async () => {
    if (!manifest || selected.size === 0) return;
    setSubmitting(true);
    try {
      const { projectId } = await createProjectReview(manifest.uploadToken, [...selected], reviewMode);
      navigate(`/projects/${projectId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Failed to start project review', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!manifest) {
    return (
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {uploading || bundling ? (
          <>
            <div className="dropzone-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="M7 8l5-5 5 5" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <p className="dropzone-title">
              {bundling ? 'Bundling selected files…' : `Uploading… ${Math.round(progress * 100)}%`}
            </p>
            {!bundling && (
              <div className="dropzone-progress-track">
                <div className="dropzone-progress-fill" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="dropzone-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12" />
                <path d="M7 8l5-5 5 5" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <p className="dropzone-title">Drag and drop a .zip, a folder, or multiple files here</p>
            <p className="dropzone-subtitle">Loose files are bundled into an archive automatically</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                Browse File
                <input
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  onChange={(e) => e.target.files && loadEntries(e.target.files)}
                />
              </label>
              <button className="btn" onClick={() => folderInputRef.current?.click()}>Browse Folder</button>
              <input
                ref={(el) => {
                  folderInputRef.current = el;
                  if (el) (el as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
                }}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => e.target.files && loadEntries(e.target.files)}
              />
            </div>
            <p className="dropzone-hint">Max {MAX_ZIP_MB} MB &middot; up to 500 files</p>
          </>
        )}
      </div>
    );
  }

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
        <button className="btn btn-ghost" onClick={() => setManifest(null)}>Upload a different archive</button>
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
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!totals || totals.count === 0 || submitting}>
          {submitting ? (<><span className="spinner" aria-hidden="true" />Creating project…</>) : `Review Project (${totals?.count ?? 0} files) →`}
        </button>
      </div>
    </div>
  );
}
