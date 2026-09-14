import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import CodeEditor, { type EditorMarker } from '../components/CodeEditor';
import LanguageSelector from '../components/LanguageSelector';
import ReviewButton from '../components/ReviewButton';
import ConfirmModal from '../components/ConfirmModal';
import ValidationStatus from '../components/ValidationStatus';
import ProjectUploadPanel from '../components/ProjectUploadPanel';
import { detectLanguage } from '../lib/languageDetect';
import { createReview } from '../services/reviews';
import { useToast } from '../hooks/useToast';
import { useCodeValidation } from '../hooks/useCodeValidation';

type InputMode = 'single' | 'project';

const MAX_BYTES = 500 * 1024; // 500 KB, per spec input limits
const MAX_LINES = 50_000;
const ACCEPTED_EXTENSIONS = '.py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.go,.rs,.rb,.php,.sql';
const AMBIGUITY_GAP = 0.15;

// Validation results that don't claim syntax was checked at all -- Review
// Code stays available for these (see code_validators.py's module docstring:
// a missing/heuristic validator must never block a review it has no basis to
// judge), just without the "syntax valid" confidence the other paths give.
const NON_BLOCKING_STATUSES = new Set(['validation_unavailable', 'unsupported_language']);

interface EditCodeState {
  code?: string;
  language?: string;
  basedOnReviewId?: string;
}

export default function NewReviewPage() {
  const [mode, setMode] = useState<InputMode>('single');
  const location = useLocation();
  // Set when arriving via an "Edit Code" action (e.g. from a completed or
  // failed review) that wants this page pre-filled instead of blank -- see
  // ReviewResultPage/ReviewProgressPage's handleEditCode.
  const editState = location.state as EditCodeState | null;
  const [code, setCode] = useState(editState?.code ?? '');
  const [filename, setFilename] = useState<string | undefined>();
  const [languageOverride, setLanguageOverride] = useState<string | null>(editState?.language ?? null);
  // Threaded through to the submit call so a genuine revision of this code
  // gets compared against the review it started from -- cleared on Clear
  // since starting over means there's no more lineage to declare. Not
  // guessed from history: submitting from a blank/new session never sets
  // this, so unrelated code never gets compared against an unrelated past
  // review (see review_service.process_review).
  const [basedOnReviewId, setBasedOnReviewId] = useState(editState?.basedOnReviewId);
  const [dragging, setDragging] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { show } = useToast();

  const detection = useMemo(() => detectLanguage(code, filename), [code, filename]);
  const language = languageOverride ?? detection.language;
  const isAmbiguous =
    !languageOverride &&
    code.trim().length > 0 &&
    detection.alternates.length > 0 &&
    detection.confidence - detection.alternates[0].confidence < AMBIGUITY_GAP;

  const lines = code ? code.split('\n').length : 0;
  const sizeKb = new Blob([code]).size / 1024;
  const tooLarge = new Blob([code]).size > MAX_BYTES;
  const tooManyLines = lines > MAX_LINES;

  const validation = useCodeValidation(code, language);
  const validationBlocksReview = validation.result != null && !NON_BLOCKING_STATUSES.has(validation.result.status) && !validation.result.valid;
  const canReview = validation.result != null && !validationBlocksReview;

  const markers = useMemo<EditorMarker[]>(() => {
    const r = validation.result;
    if (!r || r.line == null || (r.status !== 'incomplete' && r.status !== 'syntax_error')) return [];
    const startColumn = r.column ?? 1;
    return [
      {
        startLineNumber: r.line,
        startColumn,
        endLineNumber: r.endLine ?? r.line,
        endColumn: r.endColumn ?? startColumn + 1,
        message: r.message,
        severity: 'error',
      },
    ];
  }, [validation.result]);

  const loadFile = (file: File) => {
    if (file.size > MAX_BYTES) {
      show(`File exceeds the ${MAX_BYTES / 1024} KB limit.`, 'error');
      return;
    }
    file.text().then((text) => {
      setCode(text);
      setFilename(file.name);
      setLanguageOverride(null);
      setBasedOnReviewId(undefined);
    });
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  };

  const handleClear = () => {
    setCode('');
    setFilename(undefined);
    setLanguageOverride(null);
    setBasedOnReviewId(undefined);
    setConfirmClear(false);
  };

  const handleSubmit = async () => {
    // Defense in depth -- the button is also disabled for these, but a
    // submit must never depend solely on a disabled attribute doing its job.
    if (!code.trim() || tooLarge || tooManyLines || !canReview) return;
    setSubmitting(true);
    try {
      const { reviewId } = await createReview(code, language, crypto.randomUUID(), basedOnReviewId);
      navigate(`/reviews/${reviewId}/progress`);
    } catch (e) {
      // Preserve the code and validation result on failure -- only
      // `submitting` resets, so the user can just retry without redoing
      // either step.
      show(e instanceof Error ? e.message : 'Failed to submit review', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">New Code Review</h1>
          <p className="page-subtitle">Write, paste, or upload code to get instant AI feedback.</p>
        </div>
      </div>

      <div className="tab-bar" role="tablist">
        <button role="tab" aria-selected={mode === 'single'} className={`tab-button${mode === 'single' ? ' active' : ''}`} onClick={() => setMode('single')}>
          Single File
        </button>
        <button role="tab" aria-selected={mode === 'project'} className={`tab-button${mode === 'project' ? ' active' : ''}`} onClick={() => setMode('project')}>
          Project (.zip)
        </button>
      </div>

      {mode === 'project' ? (
        <ProjectUploadPanel />
      ) : (
      <div className="editor-panel">
        <div className="editor-toolbar">
          <div className="editor-toolbar-left">
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Language:</span>
            <LanguageSelector value={language} onChange={(l) => setLanguageOverride(l)} />
            {!languageOverride && code.trim() && (
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                Detected: {detection.language} ({Math.round(detection.confidence * 100)}%)
              </span>
            )}
          </div>
          <div className="editor-toolbar-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
            />
            <button className="btn" onClick={() => fileInputRef.current?.click()}>Upload file</button>
            <button className="btn btn-ghost" onClick={() => code && setConfirmClear(true)} disabled={!code}>Clear</button>
          </div>
        </div>

        {isAmbiguous && (
          <div className="confidence-picker" style={{ margin: '12px 16px 0' }} role="alert">
            <span>
              Detected languages: {detection.language} {Math.round(detection.confidence * 100)}%, {detection.alternates[0].language}{' '}
              {Math.round(detection.alternates[0].confidence * 100)}%.
            </span>
            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setLanguageOverride(detection.language)}>
              Use {detection.language}
            </button>
            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setLanguageOverride(detection.alternates[0].language)}>
              Use {detection.alternates[0].language}
            </button>
          </div>
        )}

        <div
          className={`code-input-shell${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <CodeEditor value={code} language={language} onChange={setCode} ariaLabel="Paste or write code" markers={markers} />
          {!code && (
            <div className="code-placeholder-overlay" aria-hidden="true">
              <span className="code-placeholder-icon">⌨</span>
              Start typing, paste your code, or drag a file here.
            </div>
          )}
        </div>

        <ValidationStatus phase={validation.phase} result={validation.result} errorMessage={validation.errorMessage} />

        <div className="editor-footer">
          <span className="editor-footer-meta" style={{ color: tooLarge || tooManyLines ? 'var(--danger)' : undefined }}>
            {lines} lines &middot; {sizeKb.toFixed(1)} KB
            {tooLarge && ' — exceeds 500 KB limit'}
            {tooManyLines && ' — exceeds 50,000 line limit'}
          </span>
          <div className="editor-footer-actions">
            <button
              className="btn"
              onClick={() => validation.validate(code, language)}
              disabled={!code.trim() || tooLarge || tooManyLines || validation.phase === 'validating'}
            >
              {validation.phase === 'validating' ? 'Validating…' : 'Validate Code'}
            </button>
            <span title={!canReview ? 'Validate the code first -- fix any issue found, or confirm the language it uses can’t be auto-checked.' : undefined}>
              <ReviewButton
                onClick={handleSubmit}
                loading={submitting}
                disabled={!code.trim() || tooLarge || tooManyLines || !canReview}
              />
            </span>
          </div>
        </div>
      </div>
      )}

      {confirmClear && (
        <ConfirmModal
          title="Clear current code?"
          body="This will remove your current draft. Completed reviews will remain in your history."
          confirmLabel="Clear"
          danger
          onConfirm={handleClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
