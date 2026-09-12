import type { HistoricalMatch } from '../types';
import EmptyState from './EmptyState';

export default function HistoricalInsight({ matches }: { matches: HistoricalMatch[] }) {
  if (matches.length === 0) {
    return (
      <div className="card">
        <EmptyState compact icon="🕘" title="No relevant historical rules" description="Nothing in this team's past review rules was confirmed to apply to this submission." />
      </div>
    );
  }
  return (
    <div className="card">
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        {matches.length} relevant historical rule{matches.length === 1 ? '' : 's'}, confirmed by Gemini against this code.
      </p>
      {matches.map((m, i) => (
        <div className="historical-item" key={i}>
          <div className="historical-type">✓ {m.type}</div>
          <div className="historical-desc">"{m.description}"</div>
        </div>
      ))}
    </div>
  );
}
