import asyncio
from datetime import datetime, timezone

from google.cloud import firestore

from app.config import settings
from app.schemas.review import Review

# ponytail: _store/_idempotency are an in-memory stand-in for
# `users/{userId}/reviews/{reviewId}` in Firestore, used while LOCAL_MODE=true.
# Same shape, same access pattern (always scoped by userId) as the real client
# below so callers below never needed to change shape when it was wired up.
_store: dict[str, dict[str, Review]] = {}
_idempotency: dict[str, dict[str, str]] = {}
_lock = asyncio.Lock()

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
