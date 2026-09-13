import CodeEditor from './CodeEditor';

interface Props {
  language: string;
  before: string;
  after: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ApplyFixModal({ language, before, after, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="card modal-card apply-fix-modal" role="dialog" aria-modal="true" aria-labelledby="apply-fix-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title" id="apply-fix-title">Preview fix</div>
        <p className="modal-body">Review the change, then apply it to open your code with the fix in place. Nothing is submitted until you do.</p>
        <div className="apply-fix-diff">
          <div>
            <div className="apply-fix-label apply-fix-label-before">Current</div>
            <div className="editor-panel">
              <CodeEditor value={before} language={language} readOnly height="140px" ariaLabel="Current code" />
            </div>
          </div>
          <div>
            <div className="apply-fix-label apply-fix-label-after">Suggested</div>
            <div className="editor-panel">
              <CodeEditor value={after} language={language} readOnly height="140px" ariaLabel="Suggested code" />
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm}>Apply This Fix →</button>
        </div>
      </div>
    </div>
  );
}
