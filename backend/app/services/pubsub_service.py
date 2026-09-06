import asyncio
from dataclasses import dataclass


@dataclass
class ReviewMessage:
    user_id: str
    review_id: str
    delivery_attempt: int = 1


# ponytail: in-process asyncio.Queue stands in for a real Pub/Sub topic +
# subscription (Phase 5/10). It keeps the same publish/consume shape (a
# message is only "acked" -- i.e. dropped -- after the worker finishes, and a
# failed message is republished up to MAX_DELIVERY_ATTEMPTS) so swapping in
# google-cloud-pubsub later doesn't change the worker's control flow.
_queue: asyncio.Queue[ReviewMessage] = asyncio.Queue()


async def publish(user_id: str, review_id: str) -> None:
    await _queue.put(ReviewMessage(user_id=user_id, review_id=review_id))


async def republish(message: ReviewMessage) -> None:
    await _queue.put(ReviewMessage(message.user_id, message.review_id, message.delivery_attempt + 1))


async def consume() -> ReviewMessage:
    return await _queue.get()


def task_done() -> None:
    _queue.task_done()
