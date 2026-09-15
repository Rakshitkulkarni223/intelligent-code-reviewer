// Centralized so Dashboard and History share one cache entry per resource --
// visiting either page warms the cache for the other, instead of each page
// keeping its own separate copy that still has to refetch from scratch.
export const queryKeys = {
  reviews: ['reviews'] as const,
  projectReviews: ['projectReviews'] as const,
};
