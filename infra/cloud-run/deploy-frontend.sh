#!/usr/bin/env bash
# Builds and deploys the frontend to Cloud Run. Run deploy-backend.sh first --
# this needs the backend's URL as a BUILD-time argument, since Vite inlines
# VITE_* env vars into the static bundle at build time (see frontend/Dockerfile).
# That also means changing the backend URL later requires rebuilding and
# redeploying the frontend image, not just changing a runtime env var.
#
# Review before running: this builds a container image and deploys a real,
# billed Cloud Run service.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
: "${GOOGLE_CLOUD_LOCATION:?Set GOOGLE_CLOUD_LOCATION first}"
: "${VITE_API_BASE_URL:?Set this to the backend URL printed by deploy-backend.sh}"

SERVICE_NAME="${FRONTEND_SERVICE_NAME:-code-reviewer-frontend}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AR_HOST="${GOOGLE_CLOUD_LOCATION}-docker.pkg.dev"
IMAGE="${AR_HOST}/${GOOGLE_CLOUD_PROJECT}/code-reviewer/${SERVICE_NAME}"

gcloud auth configure-docker "$AR_HOST" --quiet

echo "==> Building frontend image (VITE_API_BASE_URL=$VITE_API_BASE_URL)"
docker build \
  --build-arg VITE_API_BASE_URL="$VITE_API_BASE_URL" \
  -t "$IMAGE" \
  "$REPO_ROOT/frontend"

echo "==> Pushing $IMAGE"
docker push "$IMAGE"

echo "==> Deploying $SERVICE_NAME to Cloud Run ($GOOGLE_CLOUD_LOCATION)"
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$GOOGLE_CLOUD_LOCATION" \
  --allow-unauthenticated

URL=$(gcloud run services describe "$SERVICE_NAME" --region "$GOOGLE_CLOUD_LOCATION" --format='value(status.url)')
echo ""
echo "Frontend deployed: $URL"
echo "Now re-run deploy-backend.sh with CORS_ORIGINS=$URL so the backend accepts requests from it."
