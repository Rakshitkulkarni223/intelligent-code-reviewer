import base64
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import firestore_service, github_service

HEADERS_A = {"Authorization": "Bearer github_user_a"}
HEADERS_B = {"Authorization": "Bearer github_user_b"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


# ---- OAuth state signing (§4.3) ----


def test_state_round_trips_to_the_same_user_id():
    state = github_service.make_state("user_123")
    assert github_service.verify_state(state) == "user_123"


def test_state_tampered_signature_rejected():
    state = github_service.make_state("user_123")
    tampered = state[:-4] + ("AAAA" if state[-4:] != "AAAA" else "BBBB")
    with pytest.raises(ValueError):
        github_service.verify_state(tampered)


def test_state_for_different_user_does_not_verify_as_this_one():
    state = github_service.make_state("user_123")
    assert github_service.verify_state(state) != "someone_else"


def test_expired_state_rejected():
    # Forges an already-expired but correctly-signed state directly, rather
    # than waiting out STATE_TTL_SECONDS or monkeypatching time.
    payload = "user_123:1"  # expiry=1 (Unix epoch second 1) -- long past
    signature = github_service._sign(payload)
    state = base64.urlsafe_b64encode(f"{payload}:{signature}".encode()).decode()
    with pytest.raises(ValueError):
        github_service.verify_state(state)


def test_malformed_state_rejected():
    with pytest.raises(ValueError):
        github_service.verify_state("not-valid-base64!!")


# ---- /api/github/status, /disconnect ----


def test_status_not_connected_by_default(client):
    r = client.get("/api/github/status", headers=HEADERS_A)
    assert r.status_code == 200
    assert r.json() == {"connected": False, "githubUsername": None}


def test_status_reflects_a_stored_connection(client, monkeypatch):
    import asyncio

    revoked_tokens = []

    async def fake_revoke_grant(token):
        revoked_tokens.append(token)

    monkeypatch.setattr(github_service, "revoke_grant", fake_revoke_grant)

    asyncio.get_event_loop().run_until_complete(
        firestore_service.set_github_integration("github_user_a", "fake-token", "octocat")
    )
    r = client.get("/api/github/status", headers=HEADERS_A)
    assert r.json() == {"connected": True, "githubUsername": "octocat"}

    r = client.delete("/api/github/disconnect", headers=HEADERS_A)
    assert r.status_code == 204
    assert client.get("/api/github/status", headers=HEADERS_A).json()["connected"] is False
    # The whole point of this fix: disconnect must also revoke the grant on
    # GitHub's side, not just forget the token locally (see github.py's
    # disconnect() and github_service.revoke_grant's docstring for why).
    assert revoked_tokens == ["fake-token"]


def test_disconnect_succeeds_locally_even_if_revoke_fails(client, monkeypatch):
    import asyncio

    async def failing_revoke_grant(token):
        raise github_service.GithubApiError("token already invalid")

    monkeypatch.setattr(github_service, "revoke_grant", failing_revoke_grant)

    asyncio.get_event_loop().run_until_complete(
        firestore_service.set_github_integration("github_user_a", "already-dead-token", "octocat")
    )
    r = client.delete("/api/github/disconnect", headers=HEADERS_A)
    assert r.status_code == 204
    assert client.get("/api/github/status", headers=HEADERS_A).json()["connected"] is False


def test_repos_requires_a_connected_account(client):
    r = client.get("/api/github/repos", headers=HEADERS_B)
    assert r.status_code == 401


# ---- /api/github/oauth/start ----


def test_oauth_start_returns_json_url_not_a_redirect(client, monkeypatch):
    # A plain top-level browser navigation can't carry the Authorization
    # header this app's auth depends on -- this route must return the URL
    # as JSON (fetched with the header intact) for the frontend to then
    # navigate to itself, never redirect directly.
    from app.config import settings

    monkeypatch.setattr(settings, "github_client_id", "test-client-id")
    monkeypatch.setattr(settings, "github_client_secret", "test-secret")
    monkeypatch.setattr(settings, "github_oauth_redirect_uri", "http://localhost:8000/api/github/oauth/callback")

    r = client.get("/api/github/oauth/start", headers=HEADERS_A, follow_redirects=False)
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("https://github.com/login/oauth/authorize?")
    assert "client_id=test-client-id" in url


def test_oauth_start_503_when_unconfigured(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "github_client_id", "")
    r = client.get("/api/github/oauth/start", headers=HEADERS_A)
    assert r.status_code == 503


# ---- /api/github/import (network calls mocked) ----


def test_import_reuses_the_existing_preview_pipeline(client, monkeypatch):
    import asyncio

    asyncio.get_event_loop().run_until_complete(
        firestore_service.set_github_integration("github_user_a", "fake-token", "octocat")
    )

    zip_bytes = _make_zip({
        "demo-a1b2c3d4/src/main.py": b"def main():\n    return 1\n",
        "demo-a1b2c3d4/README.md": b"# Demo\n",
    })

    async def fake_get_repo_info(token, owner, repo):
        assert token == "fake-token"
        return {"size": 12, "default_branch": "main"}

    async def fake_resolve_branch_commit(token, owner, repo, branch):
        assert branch == "main"
        return "a1b2c3d4" * 5  # 40 hex chars, like a real sha

    async def fake_download_zipball(token, owner, repo, ref):
        return zip_bytes

    monkeypatch.setattr(github_service, "get_repo_info", fake_get_repo_info)
    monkeypatch.setattr(github_service, "resolve_branch_commit", fake_resolve_branch_commit)
    monkeypatch.setattr(github_service, "download_zipball", fake_download_zipball)

    r = client.post(
        "/api/github/import",
        json={"owner": "octocat", "repo": "demo", "branch": "main"},
        headers=HEADERS_A,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["repoFullName"] == "octocat/demo"
    assert body["branch"] == "main"
    assert body["commitSha"] == "a1b2c3d4" * 5
    # strip_common_root=True (GitHub-only) should have stripped the
    # zipball's wrapping "demo-a1b2c3d4/" directory from every path.
    paths = {f["path"] for f in body["manifest"]["files"]}
    assert paths == {"src/main.py", "README.md"}
    assert body["manifest"]["uploadToken"]


def test_import_rejects_oversized_repo_before_downloading(client, monkeypatch):
    import asyncio

    from app.config import settings

    asyncio.get_event_loop().run_until_complete(
        firestore_service.set_github_integration("github_user_a", "fake-token", "octocat")
    )

    async def fake_get_repo_info(token, owner, repo):
        return {"size": (settings.max_zip_bytes // 1024) + 1024, "default_branch": "main"}

    downloaded = False

    async def fake_download_zipball(token, owner, repo, ref):
        nonlocal downloaded
        downloaded = True
        return b""

    monkeypatch.setattr(github_service, "get_repo_info", fake_get_repo_info)
    monkeypatch.setattr(github_service, "download_zipball", fake_download_zipball)

    r = client.post(
        "/api/github/import",
        json={"owner": "octocat", "repo": "huge", "branch": "main"},
        headers=HEADERS_A,
    )
    assert r.status_code == 400
    assert not downloaded
