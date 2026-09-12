import asyncio
import json
import logging
from dataclasses import dataclass

from google.cloud import pubsub_v1

from app.config import settings

logger = logging.getLogger("pubsub_service")


@dataclass
class ReviewMessage:
    user_id: str
    review_id: str
    delivery_attempt: int = 1


# ponytail: _queue is an in-process asyncio.Queue standing in for a real
# Pub/Sub topic + subscription, used while LOCAL_MODE=true. It keeps the same
# publish/consume shape a real subscription has (a message is only "acked" --
# i.e. dropped -- after the worker finishes, and a failed message is
# redelivered up to MAX_DELIVERY_ATTEMPTS) so review_worker.py's control flow
# never needed to change when the real client below was wired up.
_queue: asyncio.Queue[ReviewMessage] = asyncio.Queue()

_publisher: pubsub_v1.PublisherClient | None = None
_subscriber: pubsub_v1.SubscriberClient | None = None

# Real mode only: the ack_id of the message consume() most recently handed to
# the worker, and whether it's already been resolved (acked or nacked). One
# pending message at a time matches the worker's one-message-at-a-time loop.
# Needed because task_done() and republish() are called with no/partial
# reference to "which message" (mirroring the local Queue.task_done() shape)
# -- whichever of them runs first resolves the message; the other is then a
# no-op, since a Pub/Sub message can't be both acked and nacked.
_pending_ack_id: str | None = None
_pending_resolved: bool = True


def _get_publisher() -> pubsub_v1.PublisherClient:
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


def _get_subscriber() -> pubsub_v1.SubscriberClient:
    global _subscriber
    if _subscriber is None:
        _subscriber = pubsub_v1.SubscriberClient()
    return _subscriber


def _topic_path() -> str:
    return _get_publisher().topic_path(settings.google_cloud_project, settings.pubsub_topic)


def _subscription_path() -> str:
    return _get_subscriber().subscription_path(settings.google_cloud_project, settings.pubsub_subscription)


async def publish(user_id: str, review_id: str) -> None:
    if settings.local_mode:
        await _queue.put(ReviewMessage(user_id=user_id, review_id=review_id))
        return
    data = json.dumps({"user_id": user_id, "review_id": review_id}).encode("utf-8")
    await asyncio.to_thread(lambda: _get_publisher().publish(_topic_path(), data=data).result())


async def republish(message: ReviewMessage) -> None:
    global _pending_resolved
    if settings.local_mode:
        await _queue.put(ReviewMessage(message.user_id, message.review_id, message.delivery_attempt + 1))
        return
    if _pending_resolved:
        return
    _pending_resolved = True
    # Nack: force immediate redelivery instead of waiting out the full ack
    # deadline. Pub/Sub's own subscription-level max-delivery-attempts +
    # dead-letter policy is what ultimately bounds retries in real mode.
    await asyncio.to_thread(
        _get_subscriber().modify_ack_deadline,
        subscription=_subscription_path(),
        ack_ids=[_pending_ack_id],
        ack_deadline_seconds=0,
    )


async def consume() -> ReviewMessage:
    global _pending_ack_id, _pending_resolved
    if settings.local_mode:
        return await _queue.get()

    while True:
        response = await asyncio.to_thread(
            _get_subscriber().pull,
            subscription=_subscription_path(),
            max_messages=1,
        )
        if response.received_messages:
            break
        await asyncio.sleep(1)

    received = response.received_messages[0]
    payload = json.loads(received.message.data.decode("utf-8"))
    _pending_ack_id = received.ack_id
    _pending_resolved = False
    return ReviewMessage(
        user_id=payload["user_id"],
        review_id=payload["review_id"],
        delivery_attempt=received.delivery_attempt or 1,
    )


async def task_done() -> None:
    global _pending_resolved
    if settings.local_mode:
        _queue.task_done()
        return
    if _pending_resolved:
        return
    _pending_resolved = True
    await asyncio.to_thread(
        _get_subscriber().acknowledge,
        subscription=_subscription_path(),
        ack_ids=[_pending_ack_id],
    )
