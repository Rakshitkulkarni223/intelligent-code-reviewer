import { apiFetch } from './api';
import type { Review } from '../types';

export function createReview(code: string, language: string, idempotencyKey: string) {
  return apiFetch<{ reviewId: string; status: string }>('/api/reviews', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ code, language }),
  });
}

export function getReview(reviewId: string) {
  return apiFetch<Review>(`/api/reviews/${reviewId}`);
}

export function listReviews() {
  return apiFetch<Review[]>('/api/reviews');
}

export function retryReview(reviewId: string) {
  return apiFetch<{ reviewId: string; status: string }>(`/api/reviews/${reviewId}/retry`, {
    method: 'POST',
  });
}
