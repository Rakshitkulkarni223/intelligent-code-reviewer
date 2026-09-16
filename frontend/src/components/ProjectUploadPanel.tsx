import { useRef, useState, type DragEvent } from 'react';
import type { ProjectManifest } from '../types';
import { uploadProjectManifest } from '../services/projects';
import { useToast } from '../hooks/useToast';
import { filesToZip, isSingleZipFile } from '../lib/buildZip';
import ProjectManifestReview from './ProjectManifestReview';

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
  const { show } = useToast();
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  if (manifest) {
    return <ProjectManifestReview manifest={manifest} onBack={() => setManifest(null)} backLabel="Upload a different archive" />;
  }

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
