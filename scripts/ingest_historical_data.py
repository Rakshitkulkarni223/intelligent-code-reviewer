"""Ingest data/historical-review-rules.csv into Vertex AI Vector Search (Phase 3/10).

Pipeline: CSV -> embed each rule with Vertex AI Embeddings -> JSONL -> Cloud Storage
-> Vector Search index (built from that GCS data) -> deployed to an index endpoint.

This is a manual, explicitly-invoked admin script, not part of the FastAPI app --
historical_data.py only ever *reads* from the index/endpoint this script produces.

Run stages one at a time and read the printed output before moving to the next:

  1. --dry-run         Embed rows, write embeddings.json locally. No GCS/Vector
                        Search side effects. Safe to re-run any time.
  2. --upload          Also upload embeddings.json to gs://HISTORICAL_BUCKET/...
                        (pass --create-bucket if that bucket doesn't exist yet).
  3. --create-index     ONE-TIME setup: build a new Vector Search Index from the
                        uploaded data, create an Index Endpoint, and deploy the
                        index to it. This creates resources billed hourly for as
                        long as they stay deployed (see the printed cost note) --
                        review before running, and undeploy when you don't need
                        the index live (endpoint.undeploy_index in a Python
                        shell, or `gcloud ai index-endpoints undeploy-index`).
  4. --update-index     Re-run after editing the CSV to refresh an EXISTING
                        index from the latest GCS data (needs --index-resource-name).

Requires Application Default Credentials for a project with the Vertex AI API
enabled (`gcloud auth application-default login`, or GOOGLE_APPLICATION_CREDENTIALS
pointing at a service account key) and the env vars in .env.example populated:
GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, EMBEDDING_MODEL, HISTORICAL_BUCKET.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env")

import os  # noqa: E402 -- after load_dotenv so os.environ reflects .env

DEFAULT_CSV = REPO_ROOT / "data" / "historical-review-rules.csv"
DEFAULT_OUTPUT = REPO_ROOT / "scripts" / "embeddings.json"
GCS_PREFIX = "historical-review-rules/embeddings/"

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "")
BUCKET = os.environ.get("HISTORICAL_BUCKET", "")


def _require(value: str, name: str) -> str:
    if not value:
        sys.exit(f"Missing {name} -- set it in .env before running this script.")
    return value


def load_rows(csv_path: Path) -> list[dict]:
    rows = []
    skipped = 0
    with csv_path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rid = (row.get("id") or "").strip()
            rtype = (row.get("type") or "").strip()
            desc = (row.get("description") or "").strip()
            if not rid or not rtype or not desc:
                skipped += 1
                continue
            rows.append({"id": rid, "type": rtype, "description": desc})
    print(f"Loaded {len(rows)} rules from {csv_path} ({skipped} skipped as malformed)")
    return rows


def embed_rows(rows: list[dict]) -> list[dict]:
    from google import genai

    _require(PROJECT, "GOOGLE_CLOUD_PROJECT")
    _require(LOCATION, "GOOGLE_CLOUD_LOCATION")
    _require(EMBEDDING_MODEL, "EMBEDDING_MODEL")

    client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
    texts = [f"{r['type']}: {r['description']}" for r in rows]

    datapoints = []
    batch_size = 25
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        response = client.models.embed_content(model=EMBEDDING_MODEL, contents=batch)
        for row, embedding in zip(rows[start : start + batch_size], response.embeddings):
            datapoints.append({"id": row["id"], "embedding": list(embedding.values)})
        print(f"Embedded {min(start + batch_size, len(texts))}/{len(texts)} rules")

    return datapoints


def write_jsonl(datapoints: list[dict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as f:
        for dp in datapoints:
            f.write(json.dumps(dp) + "\n")
    dim = len(datapoints[0]["embedding"]) if datapoints else 0
    print(f"Wrote {len(datapoints)} embeddings (dimension={dim}) to {output_path}")


def upload_to_gcs(jsonl_path: Path, create_bucket: bool) -> str:
    from google.cloud import storage

    bucket_name = _require(BUCKET, "HISTORICAL_BUCKET")
    client = storage.Client(project=PROJECT)
    bucket = client.bucket(bucket_name)
    if not bucket.exists():
        if not create_bucket:
            sys.exit(
                f"Bucket gs://{bucket_name} does not exist. Create it yourself, or re-run with "
                f"--create-bucket to have this script create it (in {LOCATION})."
            )
        client.create_bucket(bucket, location=LOCATION)
        print(f"Created bucket gs://{bucket_name} in {LOCATION}")

    blob_path = f"{GCS_PREFIX}{jsonl_path.name}"
    blob = bucket.blob(blob_path)
    blob.upload_from_filename(str(jsonl_path))
    gcs_uri = f"gs://{bucket_name}/{GCS_PREFIX}"
    print(f"Uploaded to gs://{bucket_name}/{blob_path} (index data folder: {gcs_uri})")
    return gcs_uri


def create_index(gcs_data_uri: str, dimensions: int, machine_type: str, min_replicas: int) -> None:
    from google.cloud import aiplatform, aiplatform_v1

    print(
        "\nAbout to create a Vertex AI Vector Search Index + Index Endpoint and deploy the index "
        f"to it (machine_type={machine_type}, min_replica_count={min_replicas}).\n"
        "This bills per hour for as long as the index stays deployed, independent of query volume. "
        "Undeploy it when you don't need it live.\n"
    )
    answer = input("Type 'yes' to proceed: ")
    if answer.strip().lower() != "yes":
        print("Aborted -- no resources created.")
        return

    project = _require(PROJECT, "GOOGLE_CLOUD_PROJECT")
    location = _require(LOCATION, "GOOGLE_CLOUD_LOCATION")
    aiplatform.init(project=project, location=location)

    # aiplatform.MatchingEngineIndex.create_tree_ah_index() reliably fails with
    # "algorithmConfig is required but missing from the metadata" regardless of
    # SDK version or which optional args are passed -- the bug is in that
    # convenience wrapper's request building, not in our call. Building the
    # Index resource directly against the documented REST/proto shape (metadata
    # is a free-form struct: contentsDeltaUri + config.algorithmConfig) sidesteps
    # the wrapper entirely.
    #
    # Brute-force (exact nearest neighbor, no tree partitioning), not Tree-AH:
    # Tree-AH is an *approximate* search meant for corpora of many thousands to
    # millions of vectors; historical-review-rules.csv here is a few dozen rows,
    # nowhere near enough for a tree partitioning to make sense (this is also
    # what a FAILED_PRECONDITION during the async build step -- as opposed to a
    # request-validation error -- turned out to mean when we hit it). Brute
    # force has no minimum dataset size and, at this scale, is also faster.
    index_client = aiplatform_v1.IndexServiceClient(
        client_options={"api_endpoint": f"{location}-aiplatform.googleapis.com"}
    )
    index_obj = aiplatform_v1.Index(
        display_name="historical-review-rules",
        metadata={
            "contentsDeltaUri": gcs_data_uri,
            "config": {
                "dimensions": dimensions,
                "distanceMeasureType": "COSINE_DISTANCE",
                "algorithmConfig": {"bruteForceConfig": {}},
            },
        },
        index_update_method=aiplatform_v1.Index.IndexUpdateMethod.BATCH_UPDATE,
    )

    print("Creating index (this can take up to ~30-60 minutes for a batch-updated index)...")
    operation = index_client.create_index(parent=f"projects/{project}/locations/{location}", index=index_obj)
    created_index = operation.result()
    index = aiplatform.MatchingEngineIndex(created_index.name)
    print(f"Index created: {index.resource_name}")

    print("Creating index endpoint...")
    endpoint = aiplatform.MatchingEngineIndexEndpoint.create(
        display_name="historical-review-rules-endpoint",
        public_endpoint_enabled=True,
    )
    print(f"Endpoint created: {endpoint.resource_name}")

    deployed_index_id = "historical_review_rules_v1"
    print(f"Deploying index to endpoint as deployed_index_id={deployed_index_id} (this also takes a while)...")
    endpoint.deploy_index(
        index=index,
        deployed_index_id=deployed_index_id,
        machine_type=machine_type,
        min_replica_count=min_replicas,
        max_replica_count=min_replicas,
    )

    print("\nDone. Set these in your backend .env:")
    print(f"  VECTOR_SEARCH_INDEX={deployed_index_id}")
    print(f"  VECTOR_SEARCH_ENDPOINT={endpoint.resource_name}")
    print(f"\nKeep this for future --update-index runs: --index-resource-name {index.resource_name}")


def update_index(gcs_data_uri: str, index_resource_name: str) -> None:
    from google.cloud import aiplatform

    aiplatform.init(project=_require(PROJECT, "GOOGLE_CLOUD_PROJECT"), location=_require(LOCATION, "GOOGLE_CLOUD_LOCATION"))
    index = aiplatform.MatchingEngineIndex(index_resource_name)
    print(f"Re-importing {gcs_data_uri} into {index_resource_name}...")
    index.update_embeddings(contents_delta_uri=gcs_data_uri)
    print("Update submitted. This applies asynchronously; check the index in the console for progress.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true", help="Embed and write local JSONL only (default if no other stage flag given)")
    parser.add_argument("--upload", action="store_true", help="Also upload the JSONL to Cloud Storage")
    parser.add_argument("--create-bucket", action="store_true", help="Create HISTORICAL_BUCKET if it doesn't exist (used with --upload)")
    parser.add_argument("--create-index", action="store_true", help="ONE-TIME: create + deploy a new Vector Search index from the uploaded data (billed hourly; asks to confirm)")
    parser.add_argument("--update-index", action="store_true", help="Re-import the uploaded data into an existing index")
    parser.add_argument("--index-resource-name", help="Full Index resource name, required with --update-index")
    # e2-standard-2 is only valid for SHARD_SIZE_SMALL; a brute-force index over
    # 768-dim embeddings gets auto-assigned SHARD_SIZE_MEDIUM regardless of how
    # few rows there are, which requires at least e2-standard-16.
    parser.add_argument("--machine-type", default="e2-standard-16", help="Endpoint deploy machine type (default: e2-standard-16)")
    parser.add_argument("--min-replicas", type=int, default=1)
    args = parser.parse_args()

    rows = load_rows(args.csv)
    if not rows:
        sys.exit("No valid rows to embed.")

    datapoints = embed_rows(rows)
    write_jsonl(datapoints, args.output)

    if not (args.upload or args.create_index or args.update_index):
        return  # dry-run is the default outcome when no further stage is requested

    gcs_data_uri = upload_to_gcs(args.output, args.create_bucket)

    if args.create_index:
        create_index(gcs_data_uri, dimensions=len(datapoints[0]["embedding"]), machine_type=args.machine_type, min_replicas=args.min_replicas)
    elif args.update_index:
        if not args.index_resource_name:
            sys.exit("--update-index requires --index-resource-name")
        update_index(gcs_data_uri, args.index_resource_name)


if __name__ == "__main__":
    main()
