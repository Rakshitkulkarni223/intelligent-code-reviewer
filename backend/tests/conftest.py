import asyncio
import os

# Tests must always exercise the in-memory/mock stand-ins, regardless of
# whatever backend/.env has configured for interactive `uvicorn` runs (e.g.
# LOCAL_MODE=false pointed at a real, possibly-unavailable GCP project) --
# set before any `app.*` module is imported, since app.config.Settings reads
# the environment once at import time.
os.environ["LOCAL_MODE"] = "true"

import pytest  # noqa: E402 -- after the LOCAL_MODE env var is set


@pytest.fixture(autouse=True, scope="module")
def _reset_in_process_queues():
    """Each test file that uses a module-scoped `TestClient(app)` fixture
    gets its own event loop (Starlette's TestClient opens a fresh anyio
    portal per `with` block). But pubsub_service._queue and
    project_queue_service._queue are plain module-level `asyncio.Queue()`
    singletons, created once for the whole pytest process and lazily bound
    to whichever event loop first calls .get()/.put() on them -- once one
    test file's loop closes, the next file's app-startup worker task tries
    to consume from a queue still bound to that dead loop and gets
    'Queue ... is bound to a different event loop', silently swallowed by
    the worker's own retry-forever error handling (so review/project
    submissions in that file just hang until their test's timeout).

    Replacing both queues with fresh, unbound instances before each test
    module runs means whichever loop that module's client actually uses is
    the first (and only) one to bind them -- this is purely a test-process
    artifact of running many short-lived event loops in one pytest session;
    a real deployment has exactly one event loop for the app's lifetime and
    never hits this."""
    from app.services import project_queue_service, pubsub_service

    pubsub_service._queue = asyncio.Queue()
    project_queue_service._queue = asyncio.Queue()
    yield
