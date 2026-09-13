import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listReviews, retryReview } from '../services/reviews';
import type { Review, ReviewStatus } from '../types';
import { SUPPORTED_LANGUAGES, languageLabel } from '../lib/languageDetect';
import DateRangeFilter from '../components/DateRangeFilter';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import ReviewCard from '../components/ReviewCard';
import SelectMenu from '../components/SelectMenu';
import { useToast } from '../hooks/useToast';

type SortKey = 'date' | 'score';
type StatusFilter = ReviewStatus | 'all';
type LanguageFilter = string;

const PAGE_SIZE = 8;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'ANALYZING', label: 'Analyzing' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const LANGUAGE_OPTIONS: { value: LanguageFilter; label: string }[] = [
  { value: 'all', label: 'All languages' },
  ...SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: languageLabel(l) })),
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'date', label: 'Newest first' },
  { value: 'score', label: 'Highest score' },
];

// Windowed page numbers (1, current-1..current+1, last), with '…' filling
// gaps -- avoids rendering a button for every page once there are many.
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}

export default function HistoryPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [language, setLanguage] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<SortKey>('date');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { show } = useToast();

  useEffect(() => {
    listReviews().then(setReviews).catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!reviews) return [];
    let result = reviews;
    if (language !== 'all') result = result.filter((r) => r.language === language);
    if (status !== 'all') result = result.filter((r) => r.status === status);
    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter((r) => new Date(r.createdAt) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999); // include the whole end day, not just midnight
      result = result.filter((r) => new Date(r.createdAt) <= to);
    }
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
  }, [reviews, search, language, status, dateFrom, dateTo, sort]);

  // A filter change can easily leave `page` pointing past the new result
  // set's last page -- reset to page 1 whenever any filter or sort changes.
  useEffect(() => {
    setPage(1);
  }, [search, language, status, dateFrom, dateTo, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const hasActiveFilters = search.trim() !== '' || language !== 'all' || status !== 'all' || dateFrom !== '' || dateTo !== '';
  const clearFilters = () => {
    setSearch('');
    setLanguage('all');
    setStatus('all');
    setDateFrom('');
    setDateTo('');
  };

  const handleRetry = async (reviewId: string) => {
    try {
      await retryReview(reviewId);
      show('Review resubmitted', 'success');
      navigate(`/reviews/${reviewId}/progress`);
    } catch (e) {
      show(e instanceof Error ? e.message : 'Retry failed', 'error');
    }
  };

  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">All Reviews</h1>
          {reviews && (
            <p className="page-subtitle">
              {filtered.length} review{filtered.length === 1 ? '' : 's'}
              {hasActiveFilters ? ' matching your filters' : ''}
            </p>
          )}
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
        <SelectMenu value={language} options={LANGUAGE_OPTIONS} onChange={setLanguage} ariaLabel="Filter by language" />
        <SelectMenu value={status} options={STATUS_OPTIONS} onChange={setStatus} ariaLabel="Filter by status" />
        <DateRangeFilter
          from={dateFrom}
          to={dateTo}
          onChange={(newFrom, newTo) => {
            setDateFrom(newFrom);
            setDateTo(newTo);
          }}
        />
        <SelectMenu value={sort} options={SORT_OPTIONS} onChange={setSort} ariaLabel="Sort by" />
        {hasActiveFilters && (
          <button className="btn btn-ghost" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {reviews === null ? (
        <div>{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 108, marginBottom: 12 }} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No reviews match your filters"
          action={hasActiveFilters ? <button className="btn" style={{ marginTop: 12 }} onClick={clearFilters}>Clear filters</button> : undefined}
        />
      ) : (
        <>
          {paged.map((r) => (
            <ReviewCard key={r.id} review={r} onRetry={handleRetry} />
          ))}

          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                Previous
              </button>
              <div className="pagination-pages">
                {pageNumbers(currentPage, totalPages).map((p, i) =>
                  p === '…' ? (
                    <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
                  ) : (
                    <button
                      key={p}
                      className={`pagination-page${p === currentPage ? ' active' : ''}`}
                      onClick={() => setPage(p)}
                      aria-current={p === currentPage ? 'page' : undefined}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>
              <span className="pagination-status">Page {currentPage} of {totalPages}</span>
              <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
