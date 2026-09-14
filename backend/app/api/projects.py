from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import settings
from app.schemas.project_review import CreateProjectRequest, CreateProjectResponse, ProjectManifest, ProjectReview
from app.security.auth import get_current_user_id
from app.services import project_review_service
from app.services.zip_extraction import ZipValidationError

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("/manifest", response_model=ProjectManifest)
async def preview_project(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    data = await file.read()
    # Cross-check correction (§8): request-size ceiling enforced here, before
    # zip_extraction even opens the archive -- max_request_bytes never had a
    # real enforcement point anywhere in this backend before this feature.
    if len(data) > settings.max_zip_bytes:
        raise HTTPException(status_code=400, detail=f"Archive exceeds the {settings.max_zip_bytes // (1024 * 1024)} MB limit")
    try:
        return await project_review_service.preview_project(user_id, file.filename or "upload.zip", data)
    except ZipValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("", response_model=CreateProjectResponse, status_code=201)
async def create_project(
    body: CreateProjectRequest,
    user_id: str = Depends(get_current_user_id),
):
    try:
        project = await project_review_service.create_project_review(
            user_id, body.uploadToken, body.selectedPaths, body.reviewMode
        )
    except project_review_service.UploadNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except project_review_service.NoReviewableFilesError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return CreateProjectResponse(
        projectId=project.id, status=project.status, fileCount=project.fileCount, excludedCount=project.excludedCount
    )


@router.get("")
async def list_projects(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    summaries = await project_review_service.list_project_reviews(user_id)
    return [s.model_dump(mode="json") for s in summaries]


@router.get("/{project_id}", response_model=ProjectReview)
async def get_project(project_id: str, user_id: str = Depends(get_current_user_id)):
    project = await project_review_service.get_project_review(user_id, project_id)
    if not project:
        # Ownership enforced by scoping every lookup to the caller's own
        # user_id -- someone else's project 404s exactly like a nonexistent
        # one, matching /api/reviews's own never-leak-existence pattern.
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/{project_id}/files/{file_id}")
async def get_project_file(project_id: str, file_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    detail = await project_review_service.get_project_file_detail(user_id, project_id, file_id)
    if not detail:
        raise HTTPException(status_code=404, detail="File not found")
    pf, code = detail
    return {**pf.model_dump(mode="json"), "code": code}


@router.post("/{project_id}/cancel", response_model=ProjectReview)
async def cancel_project(project_id: str, user_id: str = Depends(get_current_user_id)):
    project = await project_review_service.cancel_project_review(user_id, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
