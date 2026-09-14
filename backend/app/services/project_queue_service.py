"""In-process queue of project-review jobs -- kept as its own module (rather
than living in project_review_worker.py) so both project_review_service.py
(publishes, after creating a project) and project_review_worker.py (consumes)
can depend on it without a circular import between those two, the same
separation pubsub_service.py already has from review_service.py/review_worker.py.

See project_review_worker.py's module docstring for why this has no real
Pub/Sub counterpart yet (a documented scope limitation, not an oversight).
"""

import asyncio

_queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()


async def publish(user_id: str, project_id: str) -> None:
    await _queue.put((user_id, project_id))


async def consume() -> tuple[str, str]:
    return await _queue.get()


def task_done() -> None:
    _queue.task_done()
