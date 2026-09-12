#!/usr/bin/env bash
# One-time GCP resource setup for the Intelligent Code Reviewer (Phase 10).
#
# Review this script before running it -- most of these commands create
# billed resources (Pub/Sub, Firestore, Cloud Storage). It does NOT touch
# Vertex AI Vector Search; that's scripts/ingest_historical_data.py's job.
#
# Requires: gcloud CLI, authenticated (`gcloud auth login`) against a project
# with billing enabled, and these env vars set (e.g. `set -a; source .env; set +a`
# from the repo root before running this):
#   GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, PUBSUB_TOPIC,
#   PUBSUB_SUBSCRIPTION, HISTORICAL_BUCKET
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT first}"
: "${GOOGLE_CLOUD_LOCATION:?Set GOOGLE_CLOUD_LOCATION first}"
: "${PUBSUB_TOPIC:?Set PUBSUB_TOPIC first}"
: "${PUBSUB_SUBSCRIPTION:?Set PUBSUB_SUBSCRIPTION first}"
: "${HISTORICAL_BUCKET:?Set HISTORICAL_BUCKET first}"

gcloud config set project "$GOOGLE_CLOUD_PROJECT"

echo "==> Enabling required APIs"
gcloud services enable \
  aiplatform.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com

echo "==> Creating Pub/Sub topic + dead-letter topic"
gcloud pubsub topics create "$PUBSUB_TOPIC" || echo "  (topic already exists, skipping)"
gcloud pubsub topics create "${PUBSUB_TOPIC}-dlq" || echo "  (dlq topic already exists, skipping)"

# The dead-letter policy is what makes Pub/Sub populate delivery_attempt on
# each redelivered message -- app/services/pubsub_service.py reads that field
# to know when to give up and mark a review FAILED (settings.max_delivery_attempts,
# default 3). Pub/Sub itself won't dead-letter until 5 attempts (its minimum),
# acting as a backstop beyond the app's own cutoff.
#
# The Pub/Sub service agent below is created lazily by GCP and may not exist
# yet on a project where the API was just enabled -- force it into existence
# rather than racing it.
echo "==> Ensuring the Pub/Sub service agent exists"
gcloud beta services identity create --service=pubsub.googleapis.com --project="$GOOGLE_CLOUD_PROJECT"

PROJECT_NUMBER=$(gcloud projects describe "$GOOGLE_CLOUD_PROJECT" --format='value(projectNumber)')
PUBSUB_SA="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

echo "==> Granting the Pub/Sub service agent publish rights on the dead-letter topic"
gcloud pubsub topics add-iam-policy-binding "${PUBSUB_TOPIC}-dlq" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/pubsub.publisher"

echo "==> Creating subscription $PUBSUB_SUBSCRIPTION"
gcloud pubsub subscriptions create "$PUBSUB_SUBSCRIPTION" \
  --topic="$PUBSUB_TOPIC" \
  --ack-deadline=60 \
  --dead-letter-topic="${PUBSUB_TOPIC}-dlq" \
  --max-delivery-attempts=5 \
  || echo "  (subscription already exists, skipping)"

echo "==> Granting the Pub/Sub service agent subscribe rights (required for dead-lettering)"
gcloud pubsub subscriptions add-iam-policy-binding "$PUBSUB_SUBSCRIPTION" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/pubsub.subscriber"

echo "==> Creating Firestore database (Native mode) in $GOOGLE_CLOUD_LOCATION"
gcloud firestore databases create --location="$GOOGLE_CLOUD_LOCATION" \
  || echo "  (Firestore database already exists, skipping)"

echo "==> Creating Cloud Storage bucket gs://$HISTORICAL_BUCKET"
gcloud storage buckets create "gs://$HISTORICAL_BUCKET" --location="$GOOGLE_CLOUD_LOCATION" \
  || echo "  (bucket already exists, skipping)"

echo "==> Creating Artifact Registry Docker repository (for Cloud Run deploys)"
gcloud artifacts repositories create code-reviewer \
  --repository-format=docker \
  --location="$GOOGLE_CLOUD_LOCATION" \
  || echo "  (repository already exists, skipping)"

cat <<EOF

Done. Next steps:
  1. scripts/ingest_historical_data.py --dry-run, then --upload, then --create-index
     (builds the Vector Search index this setup script deliberately doesn't touch)
  2. infra/cloud-run/deploy-backend.sh
  3. infra/cloud-run/deploy-frontend.sh
EOF
