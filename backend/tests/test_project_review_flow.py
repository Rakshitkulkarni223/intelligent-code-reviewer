import io
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import app

HEADERS_A = {"Authorization": "Bearer user_a"}
HEADERS_B = {"Authorization": "Bearer user_b"}


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


@pytest.fixture(scope="module")
def client():
    # Module-scoped for the same reason test_review_flow.py's client is:
    # the in-process project queue binds to whichever asyncio event loop is
    # running when it's first used.
    with TestClient(app) as c:
        yield c


def _upload_manifest(client: TestClient, headers: dict, entries: dict[str, bytes], filename: str = "project.zip"):
    data = _make_zip(entries)
    return client.post(
        "/api/projects/manifest",
        files={"file": (filename, data, "application/zip")},
        headers=headers,
    )


def _wait_for_project_completion(client: TestClient, project_id: str, headers: dict, timeout: float = 10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = client.get(f"/api/projects/{project_id}", headers=headers)
        body = r.json()
        if body["status"] in ("COMPLETED", "PARTIAL", "FAILED", "CANCELLED"):
            return body
        time.sleep(0.1)
    raise TimeoutError("project did not reach a terminal state in time")


SQL_INJECTION_FILE = 'def get_user(id):\n    q = f"SELECT * FROM users WHERE id = {id}"\n    return db.execute(q)\n'
CLEAN_FILE = "def add(a, b):\n    return a + b\n"


def test_manifest_reports_tiers_and_exclusions(client):
    r = _upload_manifest(client, HEADERS_A, {
        "src/auth/login.py": SQL_INJECTION_FILE,
        "src/main.py": CLEAN_FILE,
        "README.md": "# hi\n",
        "node_modules/pkg/index.js": "module.exports = 1;",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["uploadToken"]
    paths = {f["path"]: f for f in body["files"]}
    assert paths["src/auth/login.py"]["tier"] == "auth"
    assert paths["src/auth/login.py"]["defaultSelected"] is True
    assert paths["README.md"]["tier"] == "docs"
    assert paths["README.md"]["defaultSelected"] is False
    excluded_paths = {e["path"] for e in body["excluded"]}
    assert "node_modules/pkg/index.js" in excluded_paths


def test_full_project_review_flow_completes_and_aggregates(client):
    manifest = _upload_manifest(client, HEADERS_A, {
        "src/auth/login.py": SQL_INJECTION_FILE,
        "src/main.py": CLEAN_FILE,
    }).json()

    create = client.post(
        "/api/projects",
        json={
            "uploadToken": manifest["uploadToken"],
            "selectedPaths": ["src/auth/login.py", "src/main.py"],
            "reviewMode": "standard",
        },
        headers=HEADERS_A,
    )
    assert create.status_code == 201
    project_id = create.json()["projectId"]
    assert create.json()["fileCount"] == 2

    result = _wait_for_project_completion(client, project_id, HEADERS_A)
    assert result["status"] == "COMPLETED"
    assert result["overallScore"] is not None
    assert result["filesAnalyzed"] == 2
    assert len(result["files"]) == 2
    scores = {f["path"]: f["score"] for f in result["files"]}
    assert scores["src/auth/login.py"] < scores["src/main.py"]


def test_files_analyzed_stays_accurate_under_concurrent_completions(client, monkeypatch):
    """Regression test for a real bug: filesAnalyzed used to be a stored
    counter incremented with `filesAnalyzed + 1` -- a read-then-write with
    no transaction tying the two together, so files completing within the
    same await-yield window could both read the same stale value and both
    write +1, losing one of the two increments. A 2-file test can't catch
    this (nothing to race), so this uses enough files to run genuinely
    concurrently under settings.project_review_concurrency, with a tiny
    forced yield in the mock analyzer to make the interleaving reliable
    rather than dependent on scheduling luck."""
    import asyncio

    from app.services import gemini_service as gs

    original_analyze = gs.analyze_code

    async def yielding_analyze(code, language, historical_rules=None, model=None):
        await asyncio.sleep(0)  # forces a real event-loop yield, not just a fast return
        return await original_analyze(code, language, historical_rules, model)

    monkeypatch.setattr(gs, "analyze_code", yielding_analyze)

    entries = {f"src/f{i}.py": CLEAN_FILE for i in range(16)}
    manifest = _upload_manifest(client, HEADERS_A, entries).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": list(entries.keys()), "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    project_id = create.json()["projectId"]
    result = _wait_for_project_completion(client, project_id, HEADERS_A)

    assert result["status"] == "COMPLETED"
    assert result["filesAnalyzed"] == 16
    assert all(f["status"] == "COMPLETED" for f in result["files"])


def test_project_review_routes_pro_model_only_to_auth_and_api_tiers(client, monkeypatch):
    """Calling the strongest Gemini model for every file in a project doesn't
    scale -- PRO_MODEL_TIERS (app/schemas/project_review.py) restricts it to
    auth/api, the tiers where the extra reasoning is actually worth the
    latency. Every other tier (source, util here) should get the fast model."""
    from app.config import settings
    from app.services import gemini_service as gs

    original_analyze = gs.analyze_code
    recorded_models: dict[str, str | None] = {}

    async def recording_analyze(code, language, historical_rules=None, model=None):
        recorded_models[code] = model
        return await original_analyze(code, language, historical_rules, model)

    monkeypatch.setattr(gs, "analyze_code", recording_analyze)

    entries = {
        "src/auth/login.py": "AUTH_TIER\n" + CLEAN_FILE,
        "src/api/routes.py": "API_TIER\n" + CLEAN_FILE,
        "src/main.py": "SOURCE_TIER\n" + CLEAN_FILE,
        "src/utils/helpers.py": "UTIL_TIER\n" + CLEAN_FILE,
    }
    manifest = _upload_manifest(client, HEADERS_A, entries).json()
    tiers_by_path = {f["path"]: f["tier"] for f in manifest["files"]}
    # Sanity-check the tier assumptions this test's routing assertions rely on.
    assert tiers_by_path == {
        "src/auth/login.py": "auth", "src/api/routes.py": "api",
        "src/main.py": "source", "src/utils/helpers.py": "util",
    }

    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": list(entries.keys()), "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    project_id = create.json()["projectId"]
    _wait_for_project_completion(client, project_id, HEADERS_A)

    assert recorded_models["AUTH_TIER\n" + CLEAN_FILE] == settings.project_review_pro_model
    assert recorded_models["API_TIER\n" + CLEAN_FILE] == settings.project_review_pro_model
    assert recorded_models["SOURCE_TIER\n" + CLEAN_FILE] == settings.project_review_flash_model
    assert recorded_models["UTIL_TIER\n" + CLEAN_FILE] == settings.project_review_flash_model


# ---- Retry (post-v1 addition) ----


def _make_failing_analyze(fail_paths_by_content: dict[str, list[bool]], original):
    """Builds a fake gemini_service.analyze_code that raises for any code
    string whose next scheduled outcome (popped from fail_paths_by_content)
    is True, and otherwise delegates to the real mock analyzer. A plain
    RuntimeError is non-transient per is_transient_failure, so the file
    fails on its very first attempt with no in-run retry backoff delay."""
    async def fake_analyze(code, language, historical_rules=None, model=None):
        schedule = fail_paths_by_content.get(code)
        if schedule and schedule.pop(0):
            raise RuntimeError("simulated Gemini failure")
        return await original(code, language, historical_rules, model)
    return fake_analyze


def test_partial_status_and_retry_failed_files(client, monkeypatch):
    from app.services import gemini_service as gs

    original_analyze = gs.analyze_code
    good_file = "GOOD\n" + CLEAN_FILE
    bad_file = "BAD\n" + CLEAN_FILE
    # Fails once (the initial run), then succeeds on retry.
    schedule = {bad_file: [True]}
    monkeypatch.setattr(gs, "analyze_code", _make_failing_analyze(schedule, original_analyze))

    manifest = _upload_manifest(client, HEADERS_A, {"src/good.py": good_file, "src/bad.py": bad_file}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/good.py", "src/bad.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    project_id = create.json()["projectId"]
    result = _wait_for_project_completion(client, project_id, HEADERS_A)

    assert result["status"] == "PARTIAL"
    statuses = {f["path"]: f["status"] for f in result["files"]}
    assert statuses == {"src/good.py": "COMPLETED", "src/bad.py": "FAILED"}
    assert result["filesAnalyzed"] == 2
    # The score must never be dragged down by the failed file -- it's
    # excluded entirely, not counted as a 0.
    assert result["overallScore"] == next(f["score"] for f in result["files"] if f["path"] == "src/good.py")

    # Retrying while nothing has failed yet (a fresh run's fail schedule is
    # now empty, so the next attempt succeeds) should bring the whole
    # project to COMPLETED without ever re-touching src/good.py.
    good_file_id = next(f["id"] for f in result["files"] if f["path"] == "src/good.py")
    retry = client.post(f"/api/projects/{project_id}/retry-files", json={}, headers=HEADERS_A)
    assert retry.status_code == 200
    final = _wait_for_project_completion(client, project_id, HEADERS_A)
    assert final["status"] == "COMPLETED"
    statuses = {f["path"]: f["status"] for f in final["files"]}
    assert statuses == {"src/good.py": "COMPLETED", "src/bad.py": "COMPLETED"}
    # good.py's own file id is unchanged -- proof it was never re-created/
    # re-analyzed, only bad.py was.
    assert next(f["id"] for f in final["files"] if f["path"] == "src/good.py") == good_file_id
    assert final["filesAnalyzed"] == 2


def test_retry_files_rejects_when_nothing_failed(client):
    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/main.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    project_id = create.json()["projectId"]
    _wait_for_project_completion(client, project_id, HEADERS_A)

    r = client.post(f"/api/projects/{project_id}/retry-files", json={}, headers=HEADERS_A)
    assert r.status_code == 400


def test_retry_entire_project_when_every_file_failed(client, monkeypatch):
    from app.services import gemini_service as gs

    original_analyze = gs.analyze_code
    file_a = "PROJECT_RETRY_A\n" + CLEAN_FILE
    file_b = "PROJECT_RETRY_B\n" + CLEAN_FILE
    schedule = {file_a: [True], file_b: [True]}
    monkeypatch.setattr(gs, "analyze_code", _make_failing_analyze(schedule, original_analyze))

    manifest = _upload_manifest(client, HEADERS_A, {"src/a.py": file_a, "src/b.py": file_b}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/a.py", "src/b.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    project_id = create.json()["projectId"]
    result = _wait_for_project_completion(client, project_id, HEADERS_A)
    assert result["status"] == "FAILED"

    retry = client.post(f"/api/projects/{project_id}/retry", headers=HEADERS_A)
    assert retry.status_code == 200
    final = _wait_for_project_completion(client, project_id, HEADERS_A)
    assert final["status"] == "COMPLETED"
    assert {f["status"] for f in final["files"]} == {"COMPLETED"}


def test_retry_project_summary_regenerates_without_reanalyzing_files(client, monkeypatch):
    from app.services import gemini_service as gs

    call_count = {"n": 0}
    original_summarize = gs.summarize_project

    async def flaky_summarize(profile, file_summaries, model=None):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated summary failure")
        return await original_summarize(profile, file_summaries, model)

    monkeypatch.setattr(gs, "summarize_project", flaky_summarize)

    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/main.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    project_id = create.json()["projectId"]
    result = _wait_for_project_completion(client, project_id, HEADERS_A)
    assert result["status"] == "COMPLETED"
    assert result["summary"] is None  # the summary pass failed, but that never blocks COMPLETED
    file_id = result["files"][0]["id"]

    retry = client.post(f"/api/projects/{project_id}/retry-summary", headers=HEADERS_A)
    assert retry.status_code == 200
    body = retry.json()
    assert body["summary"] is not None
    # The file itself was never re-touched -- same id, still COMPLETED,
    # proof retry-summary only re-ran the aggregation/summary pass.
    assert body["files"][0]["id"] == file_id
    assert body["files"][0]["status"] == "COMPLETED"


def test_project_file_drilldown_returns_code_and_result(client):
    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/main.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    ).json()
    project_id = create["projectId"]
    result = _wait_for_project_completion(client, project_id, HEADERS_A)
    file_id = result["files"][0]["id"]

    detail = client.get(f"/api/projects/{project_id}/files/{file_id}", headers=HEADERS_A)
    assert detail.status_code == 200
    body = detail.json()
    assert body["code"] == CLEAN_FILE
    assert body["result"]["score"] == 10.0


def test_zero_files_selected_returns_422(client):
    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    r = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": [], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    assert r.status_code == 422


def test_invalid_zip_returns_400(client):
    r = client.post(
        "/api/projects/manifest",
        files={"file": ("bad.zip", b"not a zip", "application/zip")},
        headers=HEADERS_A,
    )
    assert r.status_code == 400


def test_stale_upload_token_returns_404(client):
    r = client.post(
        "/api/projects",
        json={"uploadToken": "nonexistent-token", "selectedPaths": ["a.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    assert r.status_code == 404


def test_upload_token_cannot_be_used_by_a_different_user(client):
    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    r = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/main.py"], "reviewMode": "standard"},
        headers=HEADERS_B,
    )
    assert r.status_code == 404


def test_cross_user_project_is_not_found(client):
    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/main.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    ).json()
    r = client.get(f"/api/projects/{create['projectId']}", headers=HEADERS_B)
    assert r.status_code == 404


def test_missing_auth_rejected_on_all_routes(client):
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/projects/x").status_code == 401
    assert client.post("/api/projects/manifest", files={"file": ("a.zip", b"x", "application/zip")}).status_code == 401


def test_cancel_preserves_completed_files(client):
    # A project with enough files that cancelling immediately after create
    # has a real chance of catching at least one file still QUEUED.
    entries = {f"src/f{i}.py": CLEAN_FILE for i in range(8)}
    manifest = _upload_manifest(client, HEADERS_A, entries).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": list(entries.keys()), "reviewMode": "standard"},
        headers=HEADERS_A,
    ).json()
    project_id = create["projectId"]

    cancel = client.post(f"/api/projects/{project_id}/cancel", headers=HEADERS_A)
    assert cancel.status_code == 200

    result = _wait_for_project_completion(client, project_id, HEADERS_A)
    assert result["status"] in ("CANCELLED", "COMPLETED")  # COMPLETED if all files won the race
    # Whichever files did complete before cancellation took effect keep their
    # results -- cancelling never discards work already done (§4.8).
    for f in result["files"]:
        assert f["status"] in ("COMPLETED", "SKIPPED", "ANALYZING", "QUEUED")


def test_cancel_actually_stops_files_still_waiting_for_a_slot(client, monkeypatch):
    """Regression test for a real bug: the cancellation check originally
    lived in the per-file dispatch loop, before each asyncio.create_task
    call -- but that loop runs to completion in milliseconds regardless of
    the concurrency limit (creating a Task doesn't block), so by the time a
    cancel request reached the server, every file was already dispatched
    and the check never mattered. This only surfaces with the mock analyzer
    (near-instant) if analysis is artificially slowed down enough for a
    cancel sent immediately after submission to land before every file has
    had a turn -- otherwise (as in test_cancel_preserves_completed_files
    above) everything just finishes before cancellation can matter either
    way, which is why that test alone couldn't have caught this."""
    import asyncio

    from app.services import gemini_service as gs

    original_analyze = gs.analyze_code

    async def slow_analyze(code, language, historical_rules=None, model=None):
        await asyncio.sleep(0.3)
        return await original_analyze(code, language, historical_rules, model)

    monkeypatch.setattr(gs, "analyze_code", slow_analyze)

    entries = {f"src/f{i}.py": CLEAN_FILE for i in range(12)}
    manifest = _upload_manifest(client, HEADERS_A, entries).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": list(entries.keys()), "reviewMode": "standard"},
        headers=HEADERS_A,
    ).json()
    project_id = create["projectId"]

    # Cancel immediately -- with a 0.3s delay per file and concurrency=4,
    # only the first ~4 files can possibly be past the semaphore by the
    # time this lands, so a correct implementation must skip the rest.
    cancel = client.post(f"/api/projects/{project_id}/cancel", headers=HEADERS_A)
    assert cancel.status_code == 200

    result = _wait_for_project_completion(client, project_id, HEADERS_A, timeout=15.0)
    assert result["status"] == "CANCELLED"
    statuses = [f["status"] for f in result["files"]]
    assert statuses.count("SKIPPED") > 0, "no file was skipped -- cancellation isn't actually stopping queued work"
    assert statuses.count("SKIPPED") + statuses.count("COMPLETED") == 12


def test_run_project_does_not_clobber_a_cancel_that_arrived_first(client):
    """Regression test for a real bug: _run_project() used to unconditionally
    write status="ANALYZING" as its first action. If a cancel request set
    status="CANCELLING" after the project was queued but before the worker
    actually dequeued and started it -- a window that got much easier to
    hit once project creation stopped doing per-file object-storage writes
    synchronously (it used to take long enough that this race rarely
    mattered) -- that unconditional write silently threw the cancellation
    away and the project just ran to completion anyway.

    Constructs the "already CANCELLING, worker hasn't touched it yet" state
    directly and calls _run_project() on the TestClient's own event loop
    (via client.portal.call) rather than racing the real queue/background
    worker -- the outcome must not depend on scheduling luck to be testable."""
    from app.schemas.project_review import ProjectFile, ProjectProfile, ProjectReview
    from app.services import firestore_service
    from app.workers import project_review_worker

    user_id = "race_test_user"
    project_id = "race_test_project"

    async def seed_already_cancelling_project():
        project = ProjectReview(
            id=project_id, userId=user_id, status="CANCELLING",
            originalFilename="t.zip", profile=ProjectProfile(),
            fileCount=1, excludedCount=0, filesAnalyzed=0,
            totalLines=1, totalSize=1, createdAt=firestore_service.now(),
        )
        await firestore_service.create_project_review(project)
        pf = ProjectFile(id="race_test_file", path="main.py", language="python", tier="source", status="QUEUED")
        await firestore_service.create_project_file(user_id, project_id, pf)

    client.portal.call(seed_already_cancelling_project)
    client.portal.call(project_review_worker._run_project, user_id, project_id)

    result = client.get(f"/api/projects/{project_id}", headers={"Authorization": f"Bearer {user_id}"}).json()
    assert result["status"] == "CANCELLED"
    assert result["files"][0]["status"] == "SKIPPED"


def test_list_projects_returns_summary_without_files(client):
    manifest = _upload_manifest(client, HEADERS_A, {"src/main.py": CLEAN_FILE}).json()
    client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/main.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    )
    r = client.get("/api/projects", headers=HEADERS_A)
    assert r.status_code == 200
    body = r.json()
    assert len(body) >= 1
    assert "files" not in body[0]


def test_truncation_flagged_for_oversized_file(client):
    from app.config import settings

    huge_file = "\n".join(f"x = {i}" for i in range(settings.project_file_max_lines + 500))
    manifest = _upload_manifest(client, HEADERS_A, {"src/big.py": huge_file}).json()
    create = client.post(
        "/api/projects",
        json={"uploadToken": manifest["uploadToken"], "selectedPaths": ["src/big.py"], "reviewMode": "standard"},
        headers=HEADERS_A,
    ).json()
    result = _wait_for_project_completion(client, create["projectId"], HEADERS_A)
    assert result["files"][0]["truncated"] is True
    assert "1,000".replace(",", "") in result["files"][0]["truncatedNote"] or str(settings.project_file_max_lines) in result["files"][0]["truncatedNote"]
