import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import CodeEditor from '../components/CodeEditor';
import LanguageSelector from '../components/LanguageSelector';
import ReviewButton from '../components/ReviewButton';
import ConfirmModal from '../components/ConfirmModal';
import { detectLanguage } from '../lib/languageDetect';
import { createReview } from '../services/reviews';
import { useToast } from '../hooks/useToast';

const MAX_BYTES = 500 * 1024; // 500 KB, per spec input limits
const MAX_LINES = 50_000;
const ACCEPTED_EXTENSIONS = '.py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.go,.rs,.rb,.php';
const AMBIGUITY_GAP = 0.15;

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function NewReviewPage() {
  const [code, setCode] = useState('');
  const [filename, setFilename] = useState<string | undefined>();
  const [languageOverride, setLanguageOverride] = useState<string | null>(null);
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

  const loadFile = (file: File) => {
    if (file.size > MAX_BYTES) {
      show(`File exceeds the ${MAX_BYTES / 1024} KB limit.`, 'error');
      return;
    }
    file.text().then((text) => {
      setCode(text);
      setFilename(file.name);
      setLanguageOverride(null);
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
    setConfirmClear(false);
  };

  const handleSubmit = async () => {
    if (!code.trim() || tooLarge || tooManyLines) return;
    setSubmitting(true);
    try {
      const idempotencyKey = await sha256(`${code}:${language}`);
      const { reviewId } = await createReview(code, language, idempotencyKey);
      navigate(`/reviews/${reviewId}/progress`);
    } catch (e) {
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
          <div style={{ display: 'flex', gap: 8 }}>
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
          style={{ padding: code ? 0 : '20px' }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {code ? (
            <CodeEditor value={code} language={language} onChange={setCode} />
          ) : (
            <div className={`upload-dropzone${dragging ? ' dragging' : ''}`}>
              Start typing, paste your code, or drag a file here.
              <br />
              <textarea
                aria-label="Paste or write code"
                style={{ width: '100%', minHeight: 120, marginTop: 16, background: 'transparent', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: 10 }}
                onChange={(e) => setCode(e.target.value)}
                placeholder="def hello():&#10;    pass"
              />
            </div>
          )}
        </div>

        <div className="editor-footer">
          <span style={{ color: tooLarge || tooManyLines ? 'var(--danger)' : undefined }}>
            {lines} lines &middot; {sizeKb.toFixed(1)} KB
            {tooLarge && ' — exceeds 500 KB limit'}
            {tooManyLines && ' — exceeds 50,000 line limit'}
          </span>
          <ReviewButton onClick={handleSubmit} loading={submitting} disabled={!code.trim() || tooLarge || tooManyLines} />
        </div>
      </div>

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
