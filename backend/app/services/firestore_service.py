import asyncio
from datetime import datetime, timezone

from google.cloud import firestore

from app.config import settings
from app.schemas.project_review import ProjectFile, ProjectReview
from app.schemas.review import Review

# ponytail: _store/_idempotency are an in-memory stand-in for
# `users/{userId}/reviews/{reviewId}` in Firestore, used while LOCAL_MODE=true.
# Same shape, same access pattern (always scoped by userId) as the real client
# below so callers below never needed to change shape when it was wired up.
_store: dict[str, dict[str, Review]] = {}
_idempotency: dict[str, dict[str, str]] = {}
# user_id -> {codeHash -> version}, assignment order = first-submission order.
_code_versions: dict[str, dict[str, int]] = {}
_lock = asyncio.Lock()

# Same stand-in pattern, for `users/{userId}/projectReviews/{projectId}` (+
# its `files` subcollection) -- docs/PROJECT_ZIP_REVIEW_PLAN.md §4.2/§7.
_project_store: dict[str, dict[str, ProjectReview]] = {}
_project_files_store: dict[str, dict[str, dict[str, ProjectFile]]] = {}
_project_lock = asyncio.Lock()

_client: firestore.AsyncClient | None = None


def _get_client() -> firestore.AsyncClient:
    global _client
    if _client is None:
        _client = firestore.AsyncClient(
            project=settings.google_cloud_project,
            database=settings.firestore_database or "(default)",
        )
    return _client


def _review_ref(user_id: str, review_id: str):
    return _get_client().collection("users").document(user_id).collection("reviews").document(review_id)


def _idempotency_ref(user_id: str, key: str):
    return _get_client().collection("users").document(user_id).collection("idempotencyKeys").document(key)


def _to_firestore_doc(review: Review) -> dict:
    return review.model_dump()


async def create_review(review: Review) -> None:
    if settings.local_mode:
        async with _lock:
            _store.setdefault(review.userId, {})[review.id] = review
        return
    await _review_ref(review.userId, review.id).set(_to_firestore_doc(review))


async def get_review(user_id: str, review_id: str) -> Review | None:
    if settings.local_mode:
        async with _lock:
            return _store.get(user_id, {}).get(review_id)
    snapshot = await _review_ref(user_id, review_id).get()
    return Review(**snapshot.to_dict()) if snapshot.exists else None


async def list_reviews(user_id: str) -> list[Review]:
    if settings.local_mode:
        async with _lock:
            reviews = list(_store.get(user_id, {}).values())
        return sorted(reviews, key=lambda r: r.createdAt, reverse=True)

    query = (
        _get_client()
        .collection("users")
        .document(user_id)
        .collection("reviews")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
    )
    return [Review(**doc.to_dict()) async for doc in query.stream()]


async def update_review(user_id: str, review_id: str, **fields) -> Review | None:
    if settings.local_mode:
        async with _lock:
            existing = _store.get(user_id, {}).get(review_id)
            if not existing:
                return None
            updated = existing.model_copy(update=fields)
            _store[user_id][review_id] = updated
            return updated

    ref = _review_ref(user_id, review_id)
    snapshot = await ref.get()
    if not snapshot.exists:
        return None
    updates = {k: (v.model_dump() if hasattr(v, "model_dump") else v) for k, v in fields.items()}
    await ref.update(updates)
    updated_snapshot = await ref.get()
    return Review(**updated_snapshot.to_dict())


async def delete_review(user_id: str, review_id: str) -> bool:
    """Deletes a review, returning whether it existed. Doesn't touch
    idempotencyKeys or other reviews' previousReviewId/basedOnReviewId
    pointers -- a dangling reference to a deleted review is the same
    "not found" a caller already gets for any other missing review."""
    if settings.local_mode:
        async with _lock:
            return _store.get(user_id, {}).pop(review_id, None) is not None

    ref = _review_ref(user_id, review_id)
    snapshot = await ref.get()
    if not snapshot.exists:
        return False
    await ref.delete()
    return True


async def find_latest_completed_by_hash(user_id: str, code_hash: str) -> Review | None:
    """Most recent COMPLETED review this user has for this exact code, or
    None. Used by review_service.create_review to skip re-running Gemini/
    Vector Search on a byte-identical resubmission. Filters/sorts in Python
    rather than via a compound Firestore query (codeHash == X AND status ==
    COMPLETED, ordered by createdAt) so this doesn't require creating a
    composite index -- a single-field equality filter is auto-indexed, and a
    given user resubmitting the exact same code is realistically a handful of
    rows, not enough to matter fetching client-side."""
    if settings.local_mode:
        async with _lock:
            candidates = [r for r in _store.get(user_id, {}).values() if r.codeHash == code_hash and r.status == "COMPLETED"]
        return max(candidates, key=lambda r: r.createdAt, default=None)

    query = _get_client().collection("users").document(user_id).collection("reviews").where("codeHash", "==", code_hash)
    docs = [doc.to_dict() async for doc in query.stream()]
    completed = [Review(**d) for d in docs if d.get("status") == "COMPLETED"]
    return max(completed, key=lambda r: r.createdAt, default=None)


async def assign_code_version(user_id: str, code_hash: str) -> int:
    """1-based index of `code_hash` among the distinct code identities this
    user has ever submitted, in first-submission order. A hash seen before
    (resubmission, forced or not) keeps the version it was first assigned
    rather than incrementing."""
    if settings.local_mode:
        async with _lock:
            versions = _code_versions.setdefault(user_id, {})
            if code_hash not in versions:
                versions[code_hash] = len(versions) + 1
            return versions[code_hash]

    query = _get_client().collection("users").document(user_id).collection("reviews")
    docs = [doc.to_dict() async for doc in query.stream()]
    first_seen: dict[str, datetime] = {}
    for d in docs:
        h = d.get("codeHash")
        created = d.get("createdAt")
        if h and (h not in first_seen or created < first_seen[h]):
            first_seen[h] = created
    if code_hash not in first_seen:
        return len(first_seen) + 1
    ordered_hashes = [h for h, _ in sorted(first_seen.items(), key=lambda kv: kv[1])]
    return ordered_hashes.index(code_hash) + 1


async def get_idempotent_review_id(user_id: str, key: str) -> str | None:
    if settings.local_mode:
        async with _lock:
            return _idempotency.get(user_id, {}).get(key)
    snapshot = await _idempotency_ref(user_id, key).get()
    return snapshot.to_dict()["reviewId"] if snapshot.exists else None


async def set_idempotency_key(user_id: str, key: str, review_id: str) -> None:
    if settings.local_mode:
        async with _lock:
            _idempotency.setdefault(user_id, {})[key] = review_id
        return
    await _idempotency_ref(user_id, key).set({"reviewId": review_id})


def now() -> datetime:
    return datetime.now(timezone.utc)


# --- Project reviews (docs/PROJECT_ZIP_REVIEW_PLAN.md §4.2) ---


def _serialize_field(value):
    """Recursively converts a pydantic model (or list of them) to a plain
    JSON-safe value for a Firestore .update() call. Needed here specifically
    because ProjectReview.worstFiles is a list[WorstFile] -- the existing
    single-object pattern (`v.model_dump() if hasattr(v, "model_dump") else
    v`) used elsewhere in this file never had to handle a *list* of models
    before this field existed."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_serialize_field(item) for item in value]
    return value


def _project_ref(user_id: str, project_id: str):
    return _get_client().collection("users").document(user_id).collection("projectReviews").document(project_id)


def _project_file_ref(user_id: str, project_id: str, file_id: str):
    return _project_ref(user_id, project_id).collection("files").document(file_id)


async def create_project_review(project: ProjectReview) -> None:
    if settings.local_mode:
        async with _project_lock:
            _project_store.setdefault(project.userId, {})[project.id] = project
            _project_files_store.setdefault(project.userId, {}).setdefault(project.id, {})
        return
    data = project.model_dump(mode="json", exclude={"files"})
    await _project_ref(project.userId, project.id).set(data)


async def get_project_review(user_id: str, project_id: str, include_files: bool = True) -> ProjectReview | None:
    if settings.local_mode:
        async with _project_lock:
            project = _project_store.get(user_id, {}).get(project_id)
            if not project:
                return None
            if not include_files:
                return project
            files = list(_project_files_store.get(user_id, {}).get(project_id, {}).values())
            return project.model_copy(update={"files": files})

    snapshot = await _project_ref(user_id, project_id).get()
    if not snapshot.exists:
        return None
    data = snapshot.to_dict()
    files: list[ProjectFile] = []
    if include_files:
        files = [ProjectFile(**doc.to_dict()) async for doc in _project_ref(user_id, project_id).collection("files").stream()]
    return ProjectReview(**data, files=files)


async def list_project_reviews(user_id: str) -> list[ProjectReview]:
    if settings.local_mode:
        async with _project_lock:
            projects = list(_project_store.get(user_id, {}).values())
        return sorted(projects, key=lambda p: p.createdAt, reverse=True)

    query = (
        _get_client()
        .collection("users")
        .document(user_id)
        .collection("projectReviews")
        .order_by("createdAt", direction=firestore.Query.DESCENDING)
    )
    return [ProjectReview(**doc.to_dict()) async for doc in query.stream()]


async def update_project_review(user_id: str, project_id: str, **fields) -> ProjectReview | None:
    if settings.local_mode:
        async with _project_lock:
            existing = _project_store.get(user_id, {}).get(project_id)
            if not existing:
                return None
            updated = existing.model_copy(update=fields)
            _project_store[user_id][project_id] = updated
            return updated

    ref = _project_ref(user_id, project_id)
    snapshot = await ref.get()
    if not snapshot.exists:
        return None
    updates = {k: _serialize_field(v) for k, v in fields.items()}
    await ref.update(updates)
    return await get_project_review(user_id, project_id, include_files=False)


async def create_project_file(user_id: str, project_id: str, file: ProjectFile) -> None:
    if settings.local_mode:
        async with _project_lock:
            _project_files_store.setdefault(user_id, {}).setdefault(project_id, {})[file.id] = file
        return
    await _project_file_ref(user_id, project_id, file.id).set(file.model_dump(mode="json"))


async def get_project_file(user_id: str, project_id: str, file_id: str) -> ProjectFile | None:
    if settings.local_mode:
        async with _project_lock:
            return _project_files_store.get(user_id, {}).get(project_id, {}).get(file_id)
    snapshot = await _project_file_ref(user_id, project_id, file_id).get()
    return ProjectFile(**snapshot.to_dict()) if snapshot.exists else None


async def update_project_file(user_id: str, project_id: str, file_id: str, **fields) -> ProjectFile | None:
    if settings.local_mode:
        async with _project_lock:
            existing = _project_files_store.get(user_id, {}).get(project_id, {}).get(file_id)
            if not existing:
                return None
            updated = existing.model_copy(update=fields)
            _project_files_store[user_id][project_id][file_id] = updated
            return updated

    ref = _project_file_ref(user_id, project_id, file_id)
    snapshot = await ref.get()
    if not snapshot.exists:
        return None
    updates = {k: _serialize_field(v) for k, v in fields.items()}
    await ref.update(updates)
    updated_snapshot = await ref.get()
    return ProjectFile(**updated_snapshot.to_dict())


async def list_project_files(user_id: str, project_id: str) -> list[ProjectFile]:
    if settings.local_mode:
        async with _project_lock:
            return list(_project_files_store.get(user_id, {}).get(project_id, {}).values())
    return [ProjectFile(**doc.to_dict()) async for doc in _project_ref(user_id, project_id).collection("files").stream()]


async def delete_project_review(user_id: str, project_id: str) -> bool:
    """Deletes a project review and its files subcollection, returning
    whether it existed. Mirrors delete_review's shape -- ownership is
    enforced by only ever deleting scoped to the caller's own user_id."""
    if settings.local_mode:
        async with _project_lock:
            _project_files_store.get(user_id, {}).pop(project_id, None)
            return _project_store.get(user_id, {}).pop(project_id, None) is not None

    ref = _project_ref(user_id, project_id)
    snapshot = await ref.get()
    if not snapshot.exists:
        return False
    async for doc in ref.collection("files").stream():
        await doc.reference.delete()
    await ref.delete()
    return True
