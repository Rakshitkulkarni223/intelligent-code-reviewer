import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Issue } from '../types';
import { applyFix, buildFixPreview } from '../lib/applyFix';
import { useToast } from '../hooks/useToast';
import ApplyFixModal from './ApplyFixModal';
import CodeEditor from './CodeEditor';

const SEVERITY_TEXT: Record<Issue['severity'], string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

interface Props {
  issue: Issue;
  code?: string;
  language: string;
  reviewId: string;
}

export default function IssueCard({ issue, code, language, reviewId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { show } = useToast();
  const navigate = useNavigate();

  const endLine = issue.endLine ?? issue.line;
  // Only offer to apply when there's an actual file to splice into and a
  // locatable line range -- a fix shown for its own sake (e.g. viewed from
  // a context with no code, or lines that no longer exist) still shows the
  // snippet and stays copyable, just without the Apply action.
  const preview = code != null && issue.suggestedFix != null && issue.line != null && endLine != null
    ? buildFixPreview(code, issue.line, endLine, issue.suggestedFix)
    : null;

  const handleCopy = async () => {
    if (!issue.suggestedFix) return;
    try {
      await navigator.clipboard.writeText(issue.suggestedFix);
      show('Copied to clipboard', 'success');
    } catch {
      show('Could not copy to clipboard', 'error');
    }
  };

  const handleApplyConfirmed = () => {
    if (!code || issue.line == null || endLine == null || !issue.suggestedFix) return;
    const patched = applyFix(code, issue.line, endLine, issue.suggestedFix);
    setPreviewOpen(false);
    if (!patched) {
      show('Could not locate the affected lines in the current code', 'error');
      return;
    }
    navigate('/reviews/new', { state: { code: patched, language, basedOnReviewId: reviewId } });
  };

  return (
    <div className="issue-card">
      <div className="issue-header">
        <span className={`severity-badge severity-${issue.severity}`}>{SEVERITY_TEXT[issue.severity]}</span>
        <span className="badge">{issue.category}</span>
        <span className="issue-title">{issue.title}</span>
        {issue.line != null && <span className="issue-line">Line {issue.line}</span>}
      </div>
      <p className="issue-description">{issue.description}</p>
      <div className="issue-suggestion">{issue.suggestion}</div>

      {issue.suggestedFix && (
        <div className="issue-fix">
          <button className="issue-fix-toggle" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? '▾' : '▸'} {expanded ? 'Hide' : 'View'} suggested fix
          </button>
          {expanded && (
            <div className="issue-fix-body">
              <div className="editor-panel">
                <CodeEditor value={issue.suggestedFix} language={language} readOnly height="100px" ariaLabel="Suggested fix" />
              </div>
              <div className="issue-fix-actions">
                <button className="btn" onClick={handleCopy}>Copy</button>
                {preview && (
                  <button className="btn btn-primary" onClick={() => setPreviewOpen(true)}>Preview &amp; Apply →</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {previewOpen && preview && (
        <ApplyFixModal
          language={language}
          before={preview.before}
          after={preview.after}
          onConfirm={handleApplyConfirmed}
          onCancel={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
