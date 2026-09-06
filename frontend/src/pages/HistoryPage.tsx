import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listReviews } from '../services/reviews';
import type { Review } from '../types';
import { SUPPORTED_LANGUAGES } from '../lib/languageDetect';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LanguageBadge from '../components/LanguageBadge';

type SortKey = 'date' | 'score';

export default function HistoryPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('all');
  const [sort, setSort] = useState<SortKey>('date');

  useEffect(() => {
    listReviews().then(setReviews).catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!reviews) return [];
    let result = reviews.filter((r) => r.status === 'COMPLETED');
    if (language !== 'all') result = result.filter((r) => r.language === language);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) => r.language.toLowerCase().includes(q) || r.result?.summary.toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) =>
      sort === 'score' ? (b.score ?? 0) - (a.score ?? 0) : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return result;
  }, [reviews, search, language, sort]);

  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">All Reviews</h1>
        </div>
      </div>

      <div className="filters-row">
        <input
          className="search-input"
          placeholder="Search by language or summary…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search reviews"
        />
        <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Filter by language">
          <option value="all">All languages</option>
          {SUPPORTED_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          <option value="date">Newest first</option>
          <option value="score">Highest score</option>
        </select>
      </div>

      {reviews === null ? (
        <div>{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 56, marginBottom: 8 }} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No reviews match your filters" />
      ) : (
        filtered.map((r) => (
          <Link key={r.id} to={`/reviews/${r.id}`} className="review-row">
            <LanguageBadge language={r.language} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {r.result?.summary}
            </span>
            <span className="review-score">{r.score?.toFixed(1)}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
          </Link>
        ))
      )}
    </div>
  );
}
