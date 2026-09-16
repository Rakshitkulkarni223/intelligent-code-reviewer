#!/usr/bin/env bash
# Builds and deploys the backend (FastAPI API + in-process async worker) to
# Cloud Run. Run infra/setup-gcp-resources.sh first.
#
# IMPORTANT: the review worker (app/workers/review_worker.py) runs as a
# background asyncio task inside the same process as the API, started once
# in FastAPI's lifespan -- it is not triggered per-request. Cloud Run must
# keep at least one instance running with CPU allocated outside of request
# handling, or the worker stalls (or gets killed on scale-to-zero) between
# requests. Hence --min-instances=1 and --no-cpu-throttling below; without
# them, reviews will queue but only get processed while a request happens to
# be in flight. Both mean this service bills continuously, not just per
# request -- a deliberate tradeoff for a 24/7 background worker, not a bug.
#
# Review before running: this builds a container image and deploys a real,
# billed Cloud Run service.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
: "${GOOGLE_CLOUD_LOCATION:?Set GOOGLE_CLOUD_LOCATION first}"
: "${GEMINI_MODEL:?}"
: "${EMBEDDING_MODEL:?}"
: "${VECTOR_SEARCH_INDEX:?Set this to the deployed_index_id printed by scripts/ingest_historical_data.py --create-index}"
: "${VECTOR_SEARCH_ENDPOINT:?Set this to the endpoint resource name printed by scripts/ingest_historical_data.py --create-index}"
: "${PUBSUB_TOPIC:?}"
: "${PUBSUB_SUBSCRIPTION:?}"
: "${HISTORICAL_BUCKET:?}"
# Project review's file/zip storage (code_storage_service.py) reuses this
# same bucket.

SERVICE_NAME="${BACKEND_SERVICE_NAME:-code-reviewer-backend}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AR_HOST="${GOOGLE_CLOUD_LOCATION}-docker.pkg.dev"
IMAGE="${AR_HOST}/${GOOGLE_CLOUD_PROJECT}/code-reviewer/${SERVICE_NAME}"
# CORS_ORIGINS defaults to "*" on first deploy since the frontend URL isn't
# known yet (see deploy-frontend.sh); tighten it and re-run this script once
# the frontend is deployed.
CORS_ORIGINS="${CORS_ORIGINS:-*}"
# GitHub import (docs/GITHUB_IMPORT_PLAN.md) is optional -- left unset, the
# feature just responds 503 "not configured" instead of failing to deploy.
GITHUB_CLIENT_ID="${GITHUB_CLIENT_ID:-}"
GITHUB_CLIENT_SECRET="${GITHUB_CLIENT_SECRET:-}"
GITHUB_OAUTH_REDIRECT_URI="${GITHUB_OAUTH_REDIRECT_URI:-}"
# Project Review's tiered model routing (docs/PROJECT_ZIP_REVIEW_PLAN.md
# §4.7.1) -- independent of GEMINI_MODEL (single-file Code Review's own
# setting). Defaults match app/config.py's own if left unset here.
PROJECT_REVIEW_FLASH_MODEL="${PROJECT_REVIEW_FLASH_MODEL:-gemini-2.5-flash}"
PROJECT_REVIEW_PRO_MODEL="${PROJECT_REVIEW_PRO_MODEL:-gemini-2.5-pro}"
# How many project files are analyzed concurrently -- bounded by Vertex AI's
# actual per-minute quota for GEMINI_MODEL/project/region, not a number
# that's safe to assume transfers to a different one (see app/config.py).
PROJECT_REVIEW_CONCURRENCY="${PROJECT_REVIEW_CONCURRENCY:-8}"

gcloud auth configure-docker "$AR_HOST" --quiet

echo "==> Building backend image"
docker build -f "$REPO_ROOT/backend/Dockerfile" -t "$IMAGE" "$REPO_ROOT"

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

echo "==> Deploying $SERVICE_NAME to Cloud Run ($GOOGLE_CLOUD_LOCATION)"
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$GOOGLE_CLOUD_LOCATION" \
  --allow-unauthenticated \
  --min-instances=1 \
  --no-cpu-throttling \
  --set-env-vars="LOCAL_MODE=false,GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION},GEMINI_MODEL=${GEMINI_MODEL},EMBEDDING_MODEL=${EMBEDDING_MODEL},VECTOR_SEARCH_INDEX=${VECTOR_SEARCH_INDEX},VECTOR_SEARCH_ENDPOINT=${VECTOR_SEARCH_ENDPOINT},PUBSUB_TOPIC=${PUBSUB_TOPIC},PUBSUB_SUBSCRIPTION=${PUBSUB_SUBSCRIPTION},FIRESTORE_DATABASE=${FIRESTORE_DATABASE:-},HISTORICAL_BUCKET=${HISTORICAL_BUCKET},CORS_ORIGINS=${CORS_ORIGINS},GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID},GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET},GITHUB_OAUTH_REDIRECT_URI=${GITHUB_OAUTH_REDIRECT_URI},PROJECT_REVIEW_FLASH_MODEL=${PROJECT_REVIEW_FLASH_MODEL},PROJECT_REVIEW_PRO_MODEL=${PROJECT_REVIEW_PRO_MODEL},PROJECT_REVIEW_CONCURRENCY=${PROJECT_REVIEW_CONCURRENCY}"

URL=$(gcloud run services describe "$SERVICE_NAME" --region "$GOOGLE_CLOUD_LOCATION" --format='value(status.url)')
echo ""
echo "Backend deployed: $URL"
echo "Use this as VITE_API_BASE_URL when running deploy-frontend.sh"
