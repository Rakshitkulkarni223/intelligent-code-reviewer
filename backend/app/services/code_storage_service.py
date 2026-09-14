"""Object storage for project-review code text (docs/PROJECT_ZIP_REVIEW_PLAN.md
§7). Firestore holds everything about a ProjectReview/ProjectFile except the
code itself; this is where the actual text lives.

ponytail: _store is an in-memory {storageUri: text} dict standing in for
Cloud Storage, used while LOCAL_MODE=true -- same shape/lifetime as
firestore_service's own local stand-in. LOCAL_MODE=false calls real
google-cloud-storage, reusing the same bucket/credentials Phase 10 already
set up for the historical-rules bucket, just a different bucket/prefix
(project_files_bucket) written to at runtime instead of only by the offline
ingestion script.
"""

import asyncio

from app.config import settings

_store: dict[str, str] = {}
_lock = asyncio.Lock()

_client = None


def _get_client():
    global _client
    if _client is None:
        from google.cloud import storage

        _client = storage.Client(project=settings.google_cloud_project)
    return _client


def _blob_path(uri: str) -> str:
    # uri shape: gs://{bucket}/{path} -- strip the bucket prefix this
    # service itself always writes (see put()), never trust an arbitrary uri.
    prefix = f"gs://{settings.project_files_bucket}/"
    if not uri.startswith(prefix):
        raise ValueError(f"Unexpected storage uri: {uri}")
    return uri[len(prefix):]


async def put(user_id: str, project_id: str, file_id: str, text: str) -> str:
    if settings.local_mode:
        uri = f"local://{project_id}/files/{file_id}.txt"
        async with _lock:
            _store[uri] = text
        return uri

    uri = f"gs://{settings.project_files_bucket}/{user_id}/{project_id}/files/{file_id}.txt"
    blob = _get_client().bucket(settings.project_files_bucket).blob(_blob_path(uri))
    await asyncio.to_thread(blob.upload_from_string, text, content_type="text/plain; charset=utf-8")
    return uri


async def get(uri: str) -> str:
    if settings.local_mode:
        async with _lock:
            text = _store.get(uri)
        if text is None:
            raise KeyError(f"No stored content for {uri}")
        return text

    blob = _get_client().bucket(settings.project_files_bucket).blob(_blob_path(uri))
    return await asyncio.to_thread(blob.download_as_text)


async def put_original_zip(user_id: str, project_id: str, data: bytes) -> str:
    if settings.local_mode:
        uri = f"local://{project_id}/original.zip"
        async with _lock:
            _store[uri] = data  # type: ignore[assignment] -- local stand-in only, bytes not text
        return uri

    uri = f"gs://{settings.project_files_bucket}/{user_id}/{project_id}/original.zip"
    blob = _get_client().bucket(settings.project_files_bucket).blob(_blob_path(uri))
    await asyncio.to_thread(blob.upload_from_string, data, content_type="application/zip")
    return uri
