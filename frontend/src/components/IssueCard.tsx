import type { Issue } from '../types';

const SEVERITY_TEXT: Record<Issue['severity'], string> = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

export default function IssueCard({ issue }: { issue: Issue }) {
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
    </div>
  );
}
