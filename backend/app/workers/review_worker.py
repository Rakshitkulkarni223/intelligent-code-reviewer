import asyncio
import logging

from app.services import pubsub_service, review_service

logger = logging.getLogger("review_worker")

RETRY_BACKOFF_SECONDS = 2


async def run_worker() -> None:
    """Consumes review jobs one at a time. A message is only dropped (acked)
    after process_review succeeds or gives up after MAX_DELIVERY_ATTEMPTS --
    mirrors how a real Pub/Sub subscription + DLQ would behave."""
    while True:
        message = await pubsub_service.consume()
        try:
            await review_service.process_review(message.user_id, message.review_id, message.delivery_attempt)
        except Exception:  # noqa: BLE001 -- retry path, already logged in process_review
            await asyncio.sleep(RETRY_BACKOFF_SECONDS)
            await pubsub_service.republish(message)
        finally:
            pubsub_service.task_done()
