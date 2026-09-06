# PLAN — 24/7 Intelligent Code Reviewer

Source spec: internal project brief (GCP + Gemini + Vertex AI Vector Search + Pub/Sub + Firestore).
This file is the single source of truth for build order. Update checkboxes as work lands; do not
rewrite history in this file — append notes instead of deleting context future-us needs.

## Guiding rules for this build

- Local-first. No GCP resources are created until the sandbox access email arrives (see Phase 10).
  Everything through Phase 9 must run with mocked/local substitutes for Gemini, Vector Search,
  Pub/Sub, and Firestore.
- Every review belongs to an authenticated user; ownership is always derived server-side from the
  auth token, never from a client-supplied `userId`.
- Submitted code is analyzed as text only. It is never executed, imported, or evaluated.
- Submitted code is untrusted input to the LLM prompt (prompt-injection defense required).
- Never log raw source code, secrets, tokens, or full prompts — log IDs and metadata only.
- No feature work ahead of its phase (e.g. no ZIP upload before single-file upload is stable).

## Repo layout

```
intelligent-code-reviewer/
├── frontend/            React + Vite + TS, Monaco editor, dark-first UI
├── backend/             FastAPI: REST API, validation, auth, orchestration
├── worker/              Pub/Sub subscriber: Gemini + Vector Search pipeline
├── scripts/
│   └── ingest_historical_data.py
├── data/
│   └── historical-review-rules.csv
├── docs/
│   └── architecture.md
├── infra/
│   └── cloud-run/
├── tests/
├── .env.example
├── .gitignore
├── Dockerfile (or per-service Dockerfiles under each service dir)
├── PLAN.md
└── README.md
```

## Phase 1 — Foundation (local scaffolding)

- [x] `frontend/` — Vite + React + TS skeleton, routing, dark theme shell
- [x] `backend/` — FastAPI skeleton (`app/main.py`, `app/config.py`), health check route
- [x] Worker — implemented as an in-process asyncio task (`app/workers/review_worker.py`)
      consuming an in-memory queue (`app/services/pubsub_service.py`) standing in for Pub/Sub;
      not split into its own `worker/` Cloud Run service yet since that only makes sense once a
      real Pub/Sub subscription exists to push to it (Phase 5/10) — `review_service.process_review`
      is already the reusable core that split would call
- [x] Dockerfiles for frontend + backend, `docker-compose.yml` for local dev (Docker not available
      in this environment to verify the build — written to the standard pattern, untested)
- [x] `.env.example` (root + `frontend/.env.example`) with every var from the spec (§36), no real
      values
- [x] `.gitignore` covering `.env`, `credentials.json`, `service-account.json`, `node_modules`,
      `__pycache__`, build output, `.venv`

## Phase 2 — UI (build against mocked data)

Pages: LoginPage, DashboardPage, NewReviewPage, ReviewProgressPage, ReviewResultPage, HistoryPage,
SettingsPage.

Components: CodeEditor (Monaco), LanguageSelector, LanguageBadge, ReviewButton, ReviewStatus,
ScoreCard, IssueCard, IssueList, HistoricalInsight, ReviewTimeline, EmptyState, ErrorState.

- [x] Monaco editor integration: syntax highlighting, line numbers, auto-indent, bracket matching,
      search, keyboard shortcuts, dark theme (`@monaco-editor/react`, `vs-dark` theme)
- [x] Three input paths on NewReviewPage: write (inline textarea before first content), paste
      (into the Monaco editor), upload (`.py .js .ts .jsx .tsx .java .c .cpp .go .rs .rb .php` +
      drag-and-drop)
- [x] Client-side language auto-detect (lightweight, extension + keyword heuristics) with a manual
      override dropdown; low-confidence detections (top two candidates within 15% of each other)
      show a picker instead of guessing silently
- [x] Clear/reset with confirmation dialog ("Completed reviews will remain in your history")
- [x] Review Again button on completed results → links to a fresh NewReviewPage, never mutates
      the old review
- [x] Progress UI shows product-level steps (code received / language detected / historical
      patterns retrieved / Gemini analyzing / generating recommendations), never infra terms like
      "Pub/Sub"
- [x] Accessibility: keyboard nav, visible focus states, labeled controls, severity shown as
      icon + text (never color alone), skeleton loading states, empty states, error states
- [x] Dashboard: review count, average score, improvement delta, recent reviews, most-common-issue
      category, score trend sparkline — improvement/trend only render once ≥2 completed reviews
      exist, otherwise shown as "Not enough data yet"

## Phase 3 — Backend, synchronous with a fake reviewer

- [x] `POST /api/reviews`, `GET /api/reviews/{id}`, `GET /api/reviews`, `POST
      /api/reviews/{id}/retry` — all auth-scoped
- [x] Request validation: size/line limits (§28), reject empty/binary input (`app/security/validation.py`)
- [x] Fake review service returns a deterministic mock result so the full frontend flow works
      end-to-end before Gemini is wired in (`app/services/gemini_service.py` — rule-based, not an
      LLM call; see Phase 4)
- [x] Idempotency: `Idempotency-Key` header dedup (codeHash is stored per review for future use,
      but intentionally does NOT auto-dedupe submissions — "Review Again" on unchanged code must
      still create a new review, not silently return the old one)

## Phase 4 — Gemini integration (BLOCKED on Vertex AI credentials — mocked for now)

- [ ] `backend/app/services/gemini_service.py`: currently a deterministic regex-based analyzer, not
      a real Vertex AI Gemini call — swap requires `GOOGLE_CLOUD_PROJECT` credentials from the
      Phase 10 sandbox. The function signature (`analyze_code(code, language) -> GeminiAnalysis`)
      and the validated response schema (`app/schemas/gemini_response.py`) are already the contract
      a real implementation would fill.
- [ ] System prompt explicitly states submitted code is untrusted data whose embedded instructions
      must never override system instructions (no prompt exists yet since there's no LLM call; the
      mock analyzer is regex-based so it has nothing to be injected into — a test asserting this
      stays true is already in `tests/test_review_flow.py`)
- [ ] Handle: timeout, rate limit, service unavailable, malformed JSON, safety refusal — the FAILED
      state + retry plumbing exists (`review_service.process_review`) and is exercised by the mock
      analyzer's exception path, but the specific real-API failure modes aren't wired up yet
- [x] Quality score computed from the weighted dimensions in §16, capped 1–10, always paired with
      an explanation, never presented as an exact measurement

## Phase 5 — Async processing (implemented locally; Pub/Sub itself is Phase 10)

- [x] Backend publishes to an in-process queue on review creation instead of calling the analyzer
      inline (`app/services/pubsub_service.py` — asyncio.Queue standing in for a Pub/Sub topic)
- [x] Worker subscribes, processes, writes result + status back to the store (`app/workers/review_worker.py`)
- [x] Retry with backoff, max delivery attempts before FAILED (dead-letter queue itself needs real
      Pub/Sub in Phase 10 — locally, exceeding `MAX_DELIVERY_ATTEMPTS` just marks the review FAILED)
- [x] Frontend polls status through QUEUED → ANALYZING → COMPLETED / FAILED (+ CANCELLED status
      value modeled but no UI path cancels a QUEUED review yet — not in the MVP checklist)
- [x] Retry action on FAILED reviews (`POST /api/reviews/{id}/retry`, wired to the UI)

## Phase 6 — Historical learning (RAG; category+keyword retrieval standing in for real Vector Search)

- [x] Historical CSV → validate rows → normalize text → index in memory at startup
      (`app/services/historical_data.py`); malformed rows are skipped with a summary, never crash
      the run (see `historical_data.load`'s return value, logged on startup)
- [ ] Real `embedding_service.py` (Vertex AI Embeddings) and `vector_search_service.py` — not built
      yet; retrieval is currently category-filter + keyword-overlap ranking (see the `ponytail:`
      comment in `historical_data.find_matches` for what real Phase 6/10 replaces this with)
- [x] Worker retrieves top-k historical rules and attaches them to the result as context (real
      Gemini prompt injection is moot until Phase 4 has a real prompt to inject into)
- [x] Result includes which historical rules matched → renders as "Historical Insight" in the UI

## Phase 7 — Firestore persistence (implemented locally as an in-memory store)

- [x] Data model: `{userId: {reviewId: Review}}` in `app/services/firestore_service.py`, matching
      the `users/{userId}/reviews/{reviewId}` shape from §26 so swapping in a real Firestore client
      is a small diff, not a rewrite of callers — not yet backed by real Firestore (Phase 10), and
      not persisted across process restarts (acceptable for local dev, not for the deployed app)
- [x] History page: search + filter by language/score/sort-by-date-or-score, click-through to full
      result
- [x] Ownership check on every read: authenticated identity only, never trust client-supplied IDs
      (verified in `tests/test_review_flow.py::test_cross_user_review_is_not_found`)

## Phase 8 — Production UX polish

- [x] Toasts, responsive layout (verified in a real headless-Chromium pass, including a mobile
      viewport — see session notes), loading/empty/error states across all pages
- [x] Confirm Clear/Review Again/Retry all behave per §21/§22/§31 (no destructive surprises) —
      verified in browser: Clear requires confirmation and never touches saved reviews, Review
      Again links to a fresh NewReviewPage, Retry only appears on FAILED reviews (409 otherwise)

## Phase 9 — Security pass

- [x] Auth required on every endpoint (401 without a bearer token); authorization scoped to the
      caller's own reviews (404, not a leaked "exists but not yours", per `app/api/reviews.py`)
- [x] Prompt-injection test case (`test_prompt_injection_in_code_does_not_change_scoring_path`) —
      passes today because the mock analyzer has no prompt to hijack; must be re-verified once
      Phase 4 wires up a real Gemini call with an actual system prompt
- [x] Secret-pattern scan (`app/security/validation.py::contains_likely_secret`) runs on every
      submission; a match sets `secretsDetected` on the review (shown as a warning banner on the
      result page) and logs a warning with `reviewId` only — never the code or the matched secret
- [x] Oversized input, empty input, duplicate submission (idempotency key), cross-user access —
      covered by tests; malformed ZIP / path traversal not applicable (ZIP upload isn't built, see
      "Explicitly deferred" below)
- [x] No raw code, secrets, or prompts appear in log statements (checked every `logger.*` call by
      hand — they log `reviewId`, `language`, `score`, `attempt`, `errorType` only)

## Phase 10 — Deployment (BLOCKED until sandbox access email arrives)

Do not create billed GCP resources before then. Order once unblocked:
GCP project → enable APIs → Vertex AI + Gemini + Embeddings + Vector Search → Firestore → Pub/Sub →
Cloud Storage bucket → build containers → deploy Cloud Run (frontend/backend/worker) → run
ingestion → end-to-end test.

## Explicitly deferred (not MVP)

- ZIP upload (only after single-file upload is stable; needs path-traversal / nested-zip / size /
  file-count / binary-file guards per §29 when it lands)
- GitHub PR integration, VS Code extension, auto-fix/patch application, repo-level multi-file
  review, team dashboard, org-level custom rules (§56)

## MVP definition of done

See §55/§57 of the spec — auth, all three input modes, language detection + override, async
Gemini-backed review with historical RAG context, 1–10 score with categorized issues, Firestore
history, clear/review-again/retry, user isolation, responsive accessible UI, tests passing, Docker
build succeeding. GCP deployment and end-to-end sandbox demo are the last items, gated on Phase 10.
