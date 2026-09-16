from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.config import settings
from app.schemas.project_review import ProjectManifest
from app.security.auth import get_current_user_id
from app.services import firestore_service, github_service, project_review_service
from app.services.zip_extraction import ZipValidationError

router = APIRouter(prefix="/api/github", tags=["github"])

# Only the frontend's own dev-server origin is a sane fallback if
# CORS_ORIGINS somehow isn't set -- these two redirects (oauth_callback) are
# the only place this backend ever sends a browser back to the frontend
# itself rather than returning JSON.
_FRONTEND_ORIGIN = settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173"


class GithubStatus(BaseModel):
    connected: bool
    githubUsername: str | None = None


@router.get("/status", response_model=GithubStatus)
async def github_status(user_id: str = Depends(get_current_user_id)):
    integration = await firestore_service.get_github_integration(user_id)
    if not integration:
        return GithubStatus(connected=False)
    return GithubStatus(connected=True, githubUsername=integration.get("githubUsername"))


class OAuthStartResponse(BaseModel):
    url: str


@router.get("/oauth/start", response_model=OAuthStartResponse)
async def oauth_start(user_id: str = Depends(get_current_user_id)):
    # Returns the authorize URL as JSON rather than redirecting directly --
    # this route is only reachable with a valid Authorization header, but a
    # plain top-level browser navigation (the only way to reach GitHub's own
    # consent screen) can't carry a custom header. The frontend calls this
    # via fetch (header intact), then does the actual `window.location`
    # navigation itself with the URL this returns.
    if not settings.github_client_id or not settings.github_client_secret or not settings.github_oauth_redirect_uri:
        raise HTTPException(status_code=503, detail="GitHub integration is not configured on this server")
    state = github_service.make_state(user_id)
    return OAuthStartResponse(url=github_service.authorize_url(state))


@router.get("/oauth/callback")
async def oauth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    # This is the one route in the whole backend a browser reaches by a
    # plain GitHub-initiated redirect, with no Authorization header at all
    # -- user identity comes only from the verified `state`, never from
    # anything else in the request (see github_service.make_state).
    if error or not code or not state:
        return RedirectResponse(f"{_FRONTEND_ORIGIN}/reviews/new?github=error")
    try:
        user_id = github_service.verify_state(state)
    except ValueError:
        return RedirectResponse(f"{_FRONTEND_ORIGIN}/reviews/new?github=error")
    try:
        token = await github_service.exchange_code_for_token(code)
        username = await github_service.get_authenticated_username(token)
    except Exception:
        return RedirectResponse(f"{_FRONTEND_ORIGIN}/reviews/new?github=error")
    await firestore_service.set_github_integration(user_id, token, username)
    return RedirectResponse(f"{_FRONTEND_ORIGIN}/reviews/new?github=connected")


@router.delete("/disconnect", status_code=204)
async def disconnect(user_id: str = Depends(get_current_user_id)):
    await firestore_service.delete_github_integration(user_id)
    return Response(status_code=204)


async def _token_or_401(user_id: str) -> str:
    integration = await firestore_service.get_github_integration(user_id)
    if not integration:
        raise HTTPException(status_code=401, detail="GitHub account not connected")
    return integration["accessToken"]


@router.get("/repos")
async def list_repos(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    token = await _token_or_401(user_id)
    try:
        return await github_service.list_repos(token)
    except github_service.GithubAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except github_service.GithubApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/repos/{owner}/{repo}/branches")
async def list_branches(owner: str, repo: str, user_id: str = Depends(get_current_user_id)) -> list[dict]:
    token = await _token_or_401(user_id)
    try:
        return await github_service.list_branches(token, owner, repo)
    except github_service.GithubAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except github_service.GithubApiError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class ImportRequest(BaseModel):
    owner: str
    repo: str
    branch: str


class ImportResponse(BaseModel):
    manifest: ProjectManifest
    repoFullName: str
    branch: str
    commitSha: str


@router.post("/import", response_model=ImportResponse)
async def import_repo(body: ImportRequest, user_id: str = Depends(get_current_user_id)):
    token = await _token_or_401(user_id)
    try:
        repo_info = await github_service.get_repo_info(token, body.owner, body.repo)
        # Fails fast on an oversized repo before spending a download on it --
        # the zipball itself still runs through every zip_extraction.py guard
        # regardless, this is purely a fast-fail UX improvement, not a
        # replacement for those.
        size_bytes = repo_info.get("size", 0) * 1024
        if size_bytes > settings.max_zip_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"Repository exceeds the {settings.max_zip_bytes // (1024 * 1024)} MB limit",
            )
        sha = await github_service.resolve_branch_commit(token, body.owner, body.repo, body.branch)
        data = await github_service.download_zipball(token, body.owner, body.repo, sha)
    except github_service.GithubAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except github_service.GithubApiError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    filename = f"{body.owner}/{body.repo} @ {sha[:7]}"
    try:
        manifest = await project_review_service.preview_project(user_id, filename, data, strip_common_root=True)
    except ZipValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ImportResponse(manifest=manifest, repoFullName=f"{body.owner}/{body.repo}", branch=body.branch, commitSha=sha)
