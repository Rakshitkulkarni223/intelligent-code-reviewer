import asyncio
from datetime import datetime, timezone

from app.schemas.review import Review

# ponytail: in-memory stand-in for `users/{userId}/reviews/{reviewId}` in
# Firestore (Phase 7/10). Same shape, same access pattern (always scoped by
# userId) so swapping in a real Firestore client later is a small diff, not a
# rewrite of callers.
_store: dict[str, dict[str, Review]] = {}
_idempotency: dict[str, dict[str, str]] = {}
# ponytail: raw code is kept out of the Review model (never returned by the API,
# never logged) but the worker still needs it to run analysis and to support
# retry. Local stand-in for a Cloud Storage object / excluded Firestore field.
_code_cache: dict[str, str] = {}
_lock = asyncio.Lock()


async def create_review(review: Review) -> None:
    async with _lock:
        _store.setdefault(review.userId, {})[review.id] = review


async def get_review(user_id: str, review_id: str) -> Review | None:
    async with _lock:
        return _store.get(user_id, {}).get(review_id)


async def list_reviews(user_id: str) -> list[Review]:
    async with _lock:
        reviews = list(_store.get(user_id, {}).values())
    return sorted(reviews, key=lambda r: r.createdAt, reverse=True)


async def update_review(user_id: str, review_id: str, **fields) -> Review | None:
    async with _lock:
        existing = _store.get(user_id, {}).get(review_id)
        if not existing:
            return None
        updated = existing.model_copy(update=fields)
        _store[user_id][review_id] = updated
        return updated


async def get_idempotent_review_id(user_id: str, key: str) -> str | None:
    async with _lock:
        return _idempotency.get(user_id, {}).get(key)


async def set_idempotency_key(user_id: str, key: str, review_id: str) -> None:
    async with _lock:
        _idempotency.setdefault(user_id, {})[key] = review_id


async def save_code(review_id: str, code: str) -> None:
    async with _lock:
        _code_cache[review_id] = code


async def get_code(review_id: str) -> str | None:
    async with _lock:
        return _code_cache.get(review_id)


def now() -> datetime:
    return datetime.now(timezone.utc)
