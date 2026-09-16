import os

from dotenv import load_dotenv

load_dotenv()


def _int_env(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


class Settings:
    # LOCAL_MODE=true uses in-process stand-ins (in-memory store, asyncio queue,
    # rule-based mock analyzer) instead of real GCP services. Flip to false once
    # the sandbox GCP project + credentials from Phase 10 are available.
    local_mode: bool = os.environ.get("LOCAL_MODE", "true").lower() == "true"

    google_cloud_project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    google_cloud_location = os.environ.get("GOOGLE_CLOUD_LOCATION", "")
    gemini_model = os.environ.get("GEMINI_MODEL", "")
    embedding_model = os.environ.get("EMBEDDING_MODEL", "")
    vector_search_index = os.environ.get("VECTOR_SEARCH_INDEX", "")
    vector_search_endpoint = os.environ.get("VECTOR_SEARCH_ENDPOINT", "")
    pubsub_topic = os.environ.get("PUBSUB_TOPIC", "")
    pubsub_subscription = os.environ.get("PUBSUB_SUBSCRIPTION", "")
    firestore_database = os.environ.get("FIRESTORE_DATABASE", "")
    historical_bucket = os.environ.get("HISTORICAL_BUCKET", "")
    # Local file path to the historical rules CSV. In Docker this points at the
    # copied /data file; Phase 6/10 replaces this whole lookup with reading the
    # CSV from `historical_bucket` in Cloud Storage during ingestion.
    historical_data_path = os.environ.get("HISTORICAL_DATA_PATH", "")

    cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

    max_code_bytes = _int_env("MAX_CODE_BYTES", 500 * 1024)
    max_code_lines = _int_env("MAX_CODE_LINES", 50_000)
    max_request_bytes = _int_env("MAX_REQUEST_BYTES", 1024 * 1024)

    max_delivery_attempts = _int_env("MAX_DELIVERY_ATTEMPTS", 3)

    # --- Project (ZIP) review, docs/PROJECT_ZIP_REVIEW_PLAN.md ---
    max_zip_bytes = _int_env("MAX_ZIP_BYTES", 25 * 1024 * 1024)
    max_zip_entry_bytes = _int_env("MAX_ZIP_ENTRY_BYTES", 2 * 1024 * 1024)
    max_zip_total_uncompressed_bytes = _int_env("MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES", 50 * 1024 * 1024)
    max_zip_entry_count = _int_env("MAX_ZIP_ENTRY_COUNT", 2000)
    max_zip_compression_ratio = _int_env("MAX_ZIP_COMPRESSION_RATIO", 100)
    max_project_files = _int_env("MAX_PROJECT_FILES", 500)
    project_file_max_lines = _int_env("PROJECT_FILE_MAX_LINES", 1000)
    project_file_max_tokens = _int_env("PROJECT_FILE_MAX_TOKENS", 12_000)
    # Doubled from the original default of 4 after measuring a real 10-file
    # project against this app's own GCP project: ~65s at concurrency=4 vs
    # ~30s at 8, zero rate-limit errors either way. Raise further only after
    # re-measuring -- this is bounded by Vertex AI's actual per-minute quota
    # for the configured Gemini model/project/region, not a number that's
    # safe to assume transfers to a different one.
    project_review_concurrency = _int_env("PROJECT_REVIEW_CONCURRENCY", 8)
    project_file_max_retries = _int_env("PROJECT_FILE_MAX_RETRIES", 2)
    # Tiered model routing (app/schemas/project_review.py's PRO_MODEL_TIERS) --
    # independent of GEMINI_MODEL, which is single-file Code Review's own
    # setting and is never used for Project Review's per-file calls.
    project_review_flash_model = os.environ.get("PROJECT_REVIEW_FLASH_MODEL", "gemini-2.5-flash")
    project_review_pro_model = os.environ.get("PROJECT_REVIEW_PRO_MODEL", "gemini-2.5-pro")

    # --- GitHub import (docs/GITHUB_IMPORT_PLAN.md) ---
    github_client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    github_client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "")
    github_oauth_redirect_uri = os.environ.get("GITHUB_OAUTH_REDIRECT_URI", "")


settings = Settings()
