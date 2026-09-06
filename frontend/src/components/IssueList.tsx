import type { Issue } from '../types';
import IssueCard from './IssueCard';
import EmptyState from './EmptyState';

const SEVERITY_ORDER: Record<Issue['severity'], number> = { high: 0, medium: 1, low: 2 };

export default function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return (
      <div className="card">
        <EmptyState compact icon="✅" title="No issues found" description="Gemini didn't flag any problems in this submission." />
      </div>
    );
  }
  const sorted = [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <div>
      {sorted.map((issue, i) => (
        <IssueCard key={i} issue={issue} />
      ))}
    </div>
  );
}
