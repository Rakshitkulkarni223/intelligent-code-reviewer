"""Object storage for project-review code text (docs/PROJECT_ZIP_REVIEW_PLAN.md
§7). Firestore holds everything about a ProjectReview/ProjectFile except the
code itself; this is where the actual text lives.

ponytail: _store is an in-memory {storageUri: text} dict standing in for
Cloud Storage, used while LOCAL_MODE=true -- same shape/lifetime as
firestore_service's own local stand-in. LOCAL_MODE=false calls real
google-cloud-storage, reusing the same bucket/credentials Phase 10 already
set up for the historical-rules bucket (settings.historical_bucket).
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
    prefix = f"gs://{settings.historical_bucket}/"
    if not uri.startswith(prefix):
        raise ValueError(f"Unexpected storage uri: {uri}")
    return uri[len(prefix):]


async def put(user_id: str, project_id: str, file_id: str, text: str) -> str:
    if settings.local_mode:
        uri = f"local://{project_id}/files/{file_id}.txt"
        async with _lock:
            _store[uri] = text
        return uri

    uri = f"gs://{settings.historical_bucket}/{user_id}/{project_id}/files/{file_id}.txt"
    blob = _get_client().bucket(settings.historical_bucket).blob(_blob_path(uri))
    await asyncio.to_thread(blob.upload_from_string, text, content_type="text/plain; charset=utf-8")
    return uri


async def get(uri: str) -> str:
    if settings.local_mode:
        async with _lock:
            text = _store.get(uri)
        if text is None:
            raise KeyError(f"No stored content for {uri}")
        return text

    blob = _get_client().bucket(settings.historical_bucket).blob(_blob_path(uri))
    return await asyncio.to_thread(blob.download_as_text)


async def put_original_zip(user_id: str, project_id: str, data: bytes) -> str:
    if settings.local_mode:
        uri = f"local://{project_id}/original.zip"
        async with _lock:
            _store[uri] = data  # type: ignore[assignment] -- local stand-in only, bytes not text
        return uri

    uri = f"gs://{settings.historical_bucket}/{user_id}/{project_id}/original.zip"
    blob = _get_client().bucket(settings.historical_bucket).blob(_blob_path(uri))
    await asyncio.to_thread(blob.upload_from_string, data, content_type="application/zip")
    return uri


async def delete_project_data(user_id: str, project_id: str) -> None:
    """Removes every object this project ever wrote (the zip plus every
    per-file text blob) -- everything for a project lives under the same
    put()/put_original_zip() prefix, so one prefix delete covers it all.
    Called from project_review_service.delete_project_review; best-effort
    since a project can be deleted at any status, including before any
    object was ever written."""
    if settings.local_mode:
        prefix = f"local://{project_id}/"
        async with _lock:
            for uri in [u for u in _store if u.startswith(prefix)]:
                del _store[uri]
        return

    prefix = f"{user_id}/{project_id}/"
    bucket = _get_client().bucket(settings.historical_bucket)
    blobs = await asyncio.to_thread(lambda: list(bucket.list_blobs(prefix=prefix)))
    for blob in blobs:
        await asyncio.to_thread(blob.delete)
