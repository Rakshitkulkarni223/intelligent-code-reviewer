from fastapi import APIRouter, Depends, Header, HTTPException

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
        review = await review_service.create_review(user_id, body.code, body.language, idempotency_key)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CreateReviewResponse(reviewId=review.id, status=review.status)


@router.get("", response_model=list[Review])
async def list_reviews(user_id: str = Depends(get_current_user_id)):
    return await firestore_service.list_reviews(user_id)


@router.get("/{review_id}", response_model=Review)
async def get_review(review_id: str, user_id: str = Depends(get_current_user_id)):
    review = await firestore_service.get_review(user_id, review_id)
    if not review:
        # Ownership is enforced by only ever looking up reviews scoped to the
        # caller's own user_id, so a review that belongs to someone else 404s
        # exactly like one that doesn't exist -- it never leaks existence.
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.post("/{review_id}/retry", response_model=CreateReviewResponse)
async def retry_review(review_id: str, user_id: str = Depends(get_current_user_id)):
    review = await firestore_service.get_review(user_id, review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.status != "FAILED":
        raise HTTPException(status_code=409, detail="Only a failed review can be retried")
    updated = await review_service.retry_review(user_id, review_id)
    return CreateReviewResponse(reviewId=updated.id, status=updated.status)
