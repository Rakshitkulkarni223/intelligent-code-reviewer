from fastapi import APIRouter, Depends, Header, HTTPException, Response

from app.schemas.review import CreateReviewRequest, CreateReviewResponse, Review
from app.security.auth import get_current_user_id
from app.security.validation import ValidationError
from app.services import firestore_service, review_service

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


@router.post("", response_model=CreateReviewResponse)
async def create_review(
    body: CreateReviewRequest,
    user_id: str = Depends(get_current_user_id),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    try:
        review = await review_service.create_review(
            user_id, body.code, body.language, idempotency_key, based_on_review_id=body.basedOnReviewId
        )
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CreateReviewResponse(reviewId=review.id, status=review.status)


@router.get("")
async def list_reviews(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    # Full source isn't needed for the history list -- keep that payload light;
    # GET /api/reviews/{id} still returns it for the single-review detail view.
    # (response_model_exclude doesn't apply per-item for a list[Model] response
    # model in this FastAPI version, so excluding is done manually here.)
    reviews = await firestore_service.list_reviews(user_id)
    return [r.model_dump(mode="json", exclude={"code"}) for r in reviews]


@router.get("/{review_id}", response_model=Review)
async def get_review(review_id: str, user_id: str = Depends(get_current_user_id)):
    review = await firestore_service.get_review(user_id, review_id)
    if not review:
        # Ownership is enforced by only ever looking up reviews scoped to the
        # caller's own user_id, so a review that belongs to someone else 404s
        # exactly like one that doesn't exist -- it never leaks existence.
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.delete("/{review_id}", status_code=204)
async def delete_review(review_id: str, user_id: str = Depends(get_current_user_id)):
    deleted = await firestore_service.delete_review(user_id, review_id)
    if not deleted:
        # Same 404 as get_review for a missing/not-owned review -- ownership
        # is enforced by only ever deleting scoped to the caller's user_id.
        raise HTTPException(status_code=404, detail="Review not found")
    return Response(status_code=204)


@router.post("/{review_id}/retry", response_model=CreateReviewResponse)
async def retry_review(review_id: str, user_id: str = Depends(get_current_user_id)):
    review = await firestore_service.get_review(user_id, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.status != "FAILED":
        raise HTTPException(status_code=409, detail="Only a failed review can be retried")
    updated = await review_service.retry_review(user_id, review_id)
    return CreateReviewResponse(reviewId=updated.id, status=updated.status)
