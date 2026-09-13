import { apiFetch } from './api';
import type { ValidationResult } from '../types';

export function validateCode(code: string, language: string, signal?: AbortSignal) {
  return apiFetch<ValidationResult>('/api/code/validate', {
    method: 'POST',
    body: JSON.stringify({ code, language }),
    signal,
  });
}
