import { ApiError } from './api';
import type { GithubBranch, GithubImportResult, GithubRepo, GithubStatus } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// Mirrors services/projects.ts's own jsonFetch -- kept local rather than
// exported from there since these two service files have no reason to
// depend on each other.
async function jsonFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('icr_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function getGithubStatus() {
  return jsonFetch<GithubStatus>('/api/github/status');
}

// Fetches the authorize URL via an authenticated request (rather than
// navigating straight to /api/github/oauth/start) because a plain top-level
// browser navigation can't carry the Authorization header this app's auth
// depends on -- the caller does the actual `window.location` redirect with
// the URL this returns.
export async function startGithubOAuth(): Promise<void> {
  const { url } = await jsonFetch<{ url: string }>('/api/github/oauth/start');
  window.location.href = url;
}

export function disconnectGithub() {
  return jsonFetch<void>('/api/github/disconnect', { method: 'DELETE' });
}

export function listGithubRepos() {
  return jsonFetch<GithubRepo[]>('/api/github/repos');
}

export function listGithubBranches(owner: string, repo: string) {
  return jsonFetch<GithubBranch[]>(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`);
}

export function importGithubRepo(owner: string, repo: string, branch: string) {
  return jsonFetch<GithubImportResult>('/api/github/import', {
    method: 'POST',
    body: JSON.stringify({ owner, repo, branch }),
  });
}
