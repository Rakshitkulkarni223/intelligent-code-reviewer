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

- [ ] `frontend/` — Vite + React + TS skeleton, routing, dark theme shell
- [ ] `backend/` — FastAPI skeleton (`app/main.py`, `app/config.py`), health check route
- [ ] `worker/` — standalone service skeleton, local queue stub (in-memory or Redis list) standing
      in for Pub/Sub until Phase 5
- [ ] Dockerfiles for frontend, backend, worker + `docker-compose.yml` for local dev
- [ ] `.env.example` with every var from the spec (§36), no real values
- [ ] `.gitignore` covering `.env`, `credentials.json`, `service-account.json`, `node_modules`,
      `__pycache__`, build output

## Phase 2 — UI (build against mocked data)

Pages: LoginPage, DashboardPage, NewReviewPage, ReviewProgressPage, ReviewResultPage, HistoryPage,
SettingsPage.

Components: CodeEditor (Monaco), LanguageSelector, LanguageBadge, ReviewButton, ReviewStatus,
ScoreCard, IssueCard, IssueList, HistoricalInsight, ReviewTimeline, EmptyState, ErrorState.

- [ ] Monaco editor integration: syntax highlighting, line numbers, auto-indent, bracket matching,
      search, keyboard shortcuts, dark theme
- [ ] Three input paths on NewReviewPage: write, paste, upload (`.py .js .ts .jsx .tsx .java .c
      .cpp .go .rs .rb .php`)
- [ ] Client-side language auto-detect (lightweight, extension + keyword heuristics) with a manual
      override dropdown; low-confidence detections show a picker instead of guessing silently
- [ ] Clear/reset with confirmation dialog ("Completed reviews will remain in your history")
- [ ] Review Again button on completed results → creates a new review, never mutates the old one
- [ ] Progress UI shows product-level steps (code received / language detected / historical
      patterns retrieved / Gemini analyzing / generating recommendations), never infra terms like
      "Pub/Sub"
- [ ] Accessibility: keyboard nav, visible focus states, labeled controls, severity shown as
      icon + text (never color alone), skeleton loading states, empty states, error states
- [ ] Dashboard: review count, average score, improvement delta, recent reviews, language
      distribution — framed as observations, not statistically strong claims on small N

## Phase 3 — Backend, synchronous with a fake reviewer

- [ ] `POST /api/reviews`, `GET /api/reviews/{id}`, `GET /api/reviews` (auth-scoped)
- [ ] Request validation: size/line limits (§28), reject empty/binary input
- [ ] Fake review service returns a deterministic mock result so the full frontend flow works
      end-to-end before Gemini is wired in
- [ ] Idempotency: `Idempotency-Key` header + `SHA-256(code + language)` dedup check

## Phase 4 — Gemini integration

- [ ] `backend/app/services/gemini_service.py` (or `worker/` once Phase 5 lands): build prompt,
      call Vertex AI Gemini, parse JSON, validate against the response schema (§15)
- [ ] System prompt explicitly states submitted code is untrusted data whose embedded instructions
      must never override system instructions
- [ ] Handle: timeout, rate limit, service unavailable, malformed JSON, safety refusal — all map to
      a retryable `FAILED` state, never a lost review
- [ ] Quality score computed from the weighted dimensions in §16, capped 1–10, always paired with
      an explanation, never presented as an exact measurement

## Phase 5 — Async processing (Pub/Sub)

- [ ] Backend publishes to Pub/Sub on review creation instead of calling Gemini inline
- [ ] Worker subscribes, processes, writes result + status back to Firestore
- [ ] Retry with backoff, dead-letter queue after max delivery attempts, ack only after success
- [ ] Frontend polls/streams status through DRAFT → SUBMITTED → QUEUED → ANALYZING → COMPLETED /
      FAILED (+ optional CANCELLED while QUEUED)
- [ ] Retry action on FAILED reviews

## Phase 6 — Historical learning (RAG)

- [ ] `scripts/ingest_historical_data.py`: CSV → validate rows → normalize text → embed → upsert to
      Vector Search; malformed rows are skipped with a summary (`✓ N indexed, ⚠ M skipped`), never
      crash the run
- [ ] `embedding_service.py` (Vertex AI Embeddings) and `vector_search_service.py`
- [ ] Worker generates an embedding for submitted code, retrieves top-k historical rules, injects
      them into the Gemini prompt as context (not fine-tuning)
- [ ] Result includes which historical rules matched → renders as "Historical Insight" in the UI

## Phase 7 — Firestore persistence

- [ ] Data model: `users/{userId}/reviews/{reviewId}` per §26
- [ ] History page: search + filter by language/score/category/date, click-through to full result
- [ ] Ownership check on every read: authenticated identity only, never trust client-supplied IDs

## Phase 8 — Production UX polish

- [ ] Toasts, responsive layout, loading/empty/error states everywhere they're missing
- [ ] Confirm Clear/Review Again/Retry all behave per §21/§22/§31 (no destructive surprises)

## Phase 9 — Security pass

- [ ] Auth required on every endpoint; authorization scoped to the caller's own reviews
- [ ] Prompt-injection test cases (code comments telling the model to ignore instructions / inflate
      score) — must not affect output
- [ ] Secret-pattern scan on submitted code before it's sent to Gemini or logged
- [ ] Oversized input, malformed ZIP (if implemented), path traversal, duplicate submission,
      cross-user access attempts — all covered by tests (§39)
- [ ] Confirm no raw code/secrets/tokens/prompts ever hit logs

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
