"""GitHub OAuth + API calls for Project Review's "Import from GitHub" path
(docs/GITHUB_IMPORT_PLAN.md). The only thing this module produces for the
rest of the app is zip bytes -- everything downstream of download_zipball()
(extraction, tiering, manifest, review) is the exact same pipeline zip
upload already uses, untouched.
"""

import base64
import hashlib
import hmac
import time
from urllib.parse import urlencode

import httpx

from app.config import settings

GITHUB_API = "https://api.github.com"
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"

# How long a "Connect GitHub" redirect has to be completed before its state
# token is rejected -- generous enough for a human to actually go through
# GitHub's consent screen, short enough that a leaked/logged URL is useless
# soon after.
STATE_TTL_SECONDS = 10 * 60

_API_HEADERS_ACCEPT = "application/vnd.github+json"
_API_VERSION = "2022-11-28"


class GithubApiError(Exception):
    """A GitHub API call failed for a reason worth showing the user (repo
    not found, branch not found, ...) -- maps to a 4xx, not a 500."""


class GithubAuthError(Exception):
    """The stored token is missing, expired, or revoked -- caller should
    surface this as a 401 so the frontend can prompt reconnecting."""


def _sign(payload: str) -> str:
    # Reuses the OAuth client secret as the HMAC key -- it's already a
    # secret only this backend holds, so no separate signing key is needed
    # just for this.
    return hmac.new(settings.github_client_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_state(user_id: str) -> str:
    """Signed, expiring token embedding user_id -- GitHub's OAuth callback
    is a plain browser redirect with no Authorization header, so this is
    the only way the callback can know which app user to attach the
    resulting access token to (§4.3 of the plan)."""
    payload = f"{user_id}:{int(time.time()) + STATE_TTL_SECONDS}"
    signature = _sign(payload)
    return base64.urlsafe_b64encode(f"{payload}:{signature}".encode()).decode()


def verify_state(state: str) -> str:
    """Returns the user_id encoded in a valid, unexpired state. Raises
    ValueError on anything else -- malformed, tampered, or expired."""
    try:
        raw = base64.urlsafe_b64decode(state.encode()).decode()
        user_id, expiry_str, signature = raw.rsplit(":", 2)
    except Exception as exc:
        raise ValueError("Malformed state") from exc
    if not hmac.compare_digest(_sign(f"{user_id}:{expiry_str}"), signature):
        raise ValueError("Invalid state signature")
    if int(expiry_str) < int(time.time()):
        raise ValueError("State expired")
    return user_id


def authorize_url(state: str) -> str:
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_oauth_redirect_uri,
        "scope": "repo",
        "state": state,
        "allow_signup": "false",
    }
    return f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": settings.github_oauth_redirect_uri,
            },
        )
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise GithubApiError(body.get("error_description") or body["error"])
    return body["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": _API_HEADERS_ACCEPT,
        "X-GitHub-Api-Version": _API_VERSION,
    }


async def revoke_grant(token: str) -> None:
    """Revokes this app's entire authorization grant for whichever account
    `token` belongs to (not just this one token) -- called from disconnect
    so GitHub actually forgets the app was ever authorized. Without this,
    disconnecting only forgot the token on our side: GitHub still considered
    the app pre-authorized for that account, so reconnecting while the
    browser still had an active GitHub session silently re-issued a new
    token with no consent screen at all -- no chance to switch accounts,
    since that "not you? sign in as a different user" option only appears
    on GitHub's own consent screen, which a still-valid grant skips
    entirely. Best-effort: a user disconnecting an already-invalid/expired
    token should still succeed locally, so failures here are swallowed by
    the caller, not raised."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(
            "DELETE",
            f"{GITHUB_API}/applications/{settings.github_client_id}/grant",
            auth=(settings.github_client_id, settings.github_client_secret),
            headers={"Accept": _API_HEADERS_ACCEPT, "X-GitHub-Api-Version": _API_VERSION},
            json={"access_token": token},
        )
    # 404 just means GitHub already considers this grant gone -- not an error.
    if resp.status_code not in (204, 404):
        resp.raise_for_status()


def _raise_for_common_errors(resp: httpx.Response, not_found_message: str) -> None:
    if resp.status_code == 401:
        raise GithubAuthError("GitHub token is no longer valid -- please reconnect your account")
    if resp.status_code == 404:
        raise GithubApiError(not_found_message)
    if resp.status_code == 403 and resp.headers.get("X-RateLimit-Remaining") == "0":
        raise GithubApiError("GitHub API rate limit exceeded -- please try again shortly")
    resp.raise_for_status()


async def get_authenticated_username(token: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{GITHUB_API}/user", headers=_headers(token))
    _raise_for_common_errors(resp, "GitHub user not found")
    return resp.json()["login"]


async def list_repos(token: str) -> list[dict]:
    # Capped at 500 repos (5 pages @ 100) -- comfortably covers a real
    # account without unbounded pagination against someone with thousands
    # of repos.
    repos: list[dict] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for page in range(1, 6):
            resp = await client.get(
                f"{GITHUB_API}/user/repos",
                headers=_headers(token),
                params={"per_page": 100, "page": page, "sort": "updated"},
            )
            _raise_for_common_errors(resp, "GitHub repositories not found")
            batch = resp.json()
            repos.extend(batch)
            if len(batch) < 100:
                break
    return [
        {"fullName": r["full_name"], "defaultBranch": r["default_branch"], "private": r["private"]}
        for r in repos
    ]


async def list_branches(token: str, owner: str, repo: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/branches",
            headers=_headers(token),
            params={"per_page": 100},
        )
    _raise_for_common_errors(resp, f"Repository '{owner}/{repo}' not found")
    return [{"name": b["name"]} for b in resp.json()]


async def get_repo_info(token: str, owner: str, repo: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{GITHUB_API}/repos/{owner}/{repo}", headers=_headers(token))
    _raise_for_common_errors(resp, f"Repository '{owner}/{repo}' not found")
    return resp.json()


async def resolve_branch_commit(token: str, owner: str, repo: str, branch: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{GITHUB_API}/repos/{owner}/{repo}/branches/{branch}", headers=_headers(token))
    _raise_for_common_errors(resp, f"Branch '{branch}' not found")
    return resp.json()["commit"]["sha"]


async def download_zipball(token: str, owner: str, repo: str, ref: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.get(f"{GITHUB_API}/repos/{owner}/{repo}/zipball/{ref}", headers=_headers(token))
    _raise_for_common_errors(resp, f"Could not download '{owner}/{repo}' at {ref}")
    return resp.content
