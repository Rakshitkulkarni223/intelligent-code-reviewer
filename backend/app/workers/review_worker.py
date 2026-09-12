import asyncio
import logging

from app.services import pubsub_service, review_service

logger = logging.getLogger("review_worker")

RETRY_BACKOFF_SECONDS = 2


async def run_worker() -> None:
    """Consumes review jobs one at a time. A message is only dropped (acked)
    after process_review succeeds or gives up after MAX_DELIVERY_ATTEMPTS --
    mirrors how a real Pub/Sub subscription + DLQ would behave.

    Both stages are wrapped in their own try/except so a transient error from
    either can never escape the while loop: this task is fire-and-forget
    (asyncio.create_task in main.py's lifespan, nothing ever awaits it), so if
    it ever raised, the whole worker would die silently -- no more reviews
    processed, ever, with no visible error until the process eventually
    shuts down. consume() in particular makes a real network call to Pub/Sub
    every second while idle in real mode, so this isn't a hypothetical."""
    while True:
        try:
            message = await pubsub_service.consume()
        except Exception:  # noqa: BLE001 -- must never let this loop die
            logger.error("failed to consume from pubsub, retrying", exc_info=True)
            await asyncio.sleep(RETRY_BACKOFF_SECONDS)
            continue

        try:
            await review_service.process_review(message.user_id, message.review_id, message.delivery_attempt)
        except Exception:  # noqa: BLE001 -- retry path, already logged in process_review
            await asyncio.sleep(RETRY_BACKOFF_SECONDS)
            await pubsub_service.republish(message)
        finally:
            await pubsub_service.task_done()
