import type { HistoricalMatch } from '../types';
import EmptyState from './EmptyState';

export default function HistoricalInsight({ matches }: { matches: HistoricalMatch[] }) {
  if (matches.length === 0) {
    return (
      <div className="card">
        <EmptyState compact icon="🕘" title="No historical patterns matched" description="This submission didn't closely resemble prior review rules." />
      </div>
    );
  }
  return (
    <div className="card">
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        {matches.length} historical pattern{matches.length === 1 ? '' : 's'} matched this submission.
      </p>
      {matches.map((m, i) => (
        <div className="historical-item" key={i}>
          <div className="historical-type">{m.type}</div>
          <div className="historical-desc">"{m.description}"</div>
        </div>
      ))}
    </div>
  );
}
