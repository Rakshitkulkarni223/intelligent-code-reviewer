import { ApiError } from './api';
import type { ProjectFile, ProjectManifest, ProjectReview, ProjectReviewSummary, ReviewMode } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// Separate from apiFetch (services/api.ts) because that one always sets
// Content-Type: application/json -- a multipart upload needs the browser to
// set its own Content-Type (with the multipart boundary), and needs
// upload-progress events apiFetch's plain fetch() can't provide.
export function uploadProjectManifest(file: File, onProgress?: (fraction: number) => void): Promise<ProjectManifest> {
  const token = localStorage.getItem('icr_token');
  const form = new FormData();
  form.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/projects/manifest`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as ProjectManifest);
      } else {
        const detail = (body as { detail?: string })?.detail ?? `Upload failed (${xhr.status})`;
        reject(new ApiError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(form);
  });
}

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

export function createProjectReview(uploadToken: string, selectedPaths: string[], reviewMode: ReviewMode) {
  return jsonFetch<{ projectId: string; status: string; fileCount: number; excludedCount: number }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ uploadToken, selectedPaths, reviewMode }),
  });
}

export function getProjectReview(projectId: string) {
  return jsonFetch<ProjectReview>(`/api/projects/${projectId}`);
}

export function listProjectReviews() {
  return jsonFetch<ProjectReviewSummary[]>('/api/projects');
}

export function getProjectFile(projectId: string, fileId: string) {
  return jsonFetch<ProjectFile>(`/api/projects/${projectId}/files/${fileId}`);
}

export function cancelProjectReview(projectId: string) {
  return jsonFetch<ProjectReview>(`/api/projects/${projectId}/cancel`, { method: 'POST' });
}

export function deleteProjectReview(projectId: string) {
  return jsonFetch<void>(`/api/projects/${projectId}`, { method: 'DELETE' });
}

// fileIds omitted -- retry every currently-FAILED file. A specific list --
// retry just those (also covers retrying a single file).
export function retryProjectFiles(projectId: string, fileIds?: string[]) {
  return jsonFetch<ProjectReview>(`/api/projects/${projectId}/retry-files`, {
    method: 'POST',
    body: JSON.stringify({ fileIds: fileIds ?? null }),
  });
}

export function retryProject(projectId: string) {
  return jsonFetch<ProjectReview>(`/api/projects/${projectId}/retry`, { method: 'POST' });
}

export function retryProjectSummary(projectId: string) {
  return jsonFetch<ProjectReview>(`/api/projects/${projectId}/retry-summary`, { method: 'POST' });
}
