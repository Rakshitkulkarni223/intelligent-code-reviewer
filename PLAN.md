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
- [x] Review Again button on completed results → immediately resubmits the same code+language as a
      new review (`ReviewResultPage.handleReviewAgain`) and navigates to its progress page; never
      mutates the old review. Originally linked to a blank NewReviewPage instead — changed since a
      blank form isn't "again." This surfaced a real idempotency-key bug: the key was
      `sha256(code:language)`, a content hash, so resubmitting identical code collided with the old
      review and silently returned it instead of creating a new one — exactly the behavior §95 below
      says must not happen. Fixed by generating the key as a fresh `crypto.randomUUID()` per submit
      action instead of from content, in both `NewReviewPage` and `ReviewResultPage`; an idempotency
      key should dedupe retries of *one* attempt, not different attempts with the same content.
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

## Phase 4 — Gemini integration (verified working end-to-end against real Vertex AI)

- [x] `backend/app/services/gemini_service.py`: `analyze_code()` now dispatches on
      `settings.local_mode` — `true` keeps the regex-based mock (`_analyze_code_mock`), `false` calls
      real Gemini on Vertex AI via `google-genai` (`_analyze_with_gemini`, `client.aio.models.generate_content`
      with `response_schema=GeminiModelOutput`). **Verified working**: ran the full app locally with
      `LOCAL_MODE=false` against the `qwiklabs-gcp-01-a7e8659adaae` project (`GEMINI_MODEL=gemini-2.5-flash`)
      and drove it with Playwright end to end — submitted a SQL-injection snippet through the real UI and
      got back a real Gemini-generated score, summary, dimensions, issue, and recommendations.
- [x] System prompt (`_SYSTEM_INSTRUCTIONS`) explicitly states the submitted code is untrusted data
      wrapped in `--- BEGIN/END UNTRUSTED CODE UNDER REVIEW ---` markers, and that embedded
      instructions in it must never override the system prompt — mirrors the existing prompt-injection
      test's intent (`tests/test_review_flow.py::test_prompt_injection_in_code_does_not_change_scoring_path`),
      which still only exercises the mock path and should be re-run in real mode once credentials exist.
- [ ] Handle: timeout, rate limit, service unavailable, malformed JSON, safety refusal — the FAILED
      state + retry plumbing exists (`review_service.process_review`) and covers any exception from
      `_analyze_with_gemini` generically, but no real-API error has been observed/tested yet since
      there's no live project to call.
- [x] Quality score computed from the weighted dimensions in §16, capped 1–10, always paired with
      an explanation, never presented as an exact measurement

## Phase 5 — Async processing (verified working end-to-end against a real subscription)

- [x] `app/services/pubsub_service.py` dispatches on `settings.local_mode` — `true` keeps the
      in-process `asyncio.Queue`; `false` calls real `google-cloud-pubsub`: `publish()` publishes to
      `PUBSUB_TOPIC`, `consume()` pulls one message at a time from `PUBSUB_SUBSCRIPTION`. Ack/nack is
      tracked via a single "pending" ack_id, since `task_done()`/`republish()` are called the same
      way the local Queue version was (no message argument on `task_done()`) — whichever of the two
      runs first resolves the message (ack or nack); the other becomes a no-op, since a real message
      can't be both. **Verified working** against a real subscription end to end.
- [x] Worker subscribes, processes, writes result + status back to the store (`app/workers/review_worker.py`);
      `task_done()` is now `await`ed since acking a real message is a network call.
- [x] **Found and fixed a serious bug**: `run_worker()`'s `while True` loop called `pubsub_service.consume()`
      *outside* its try/except. In real mode, `consume()` makes a live network call to Pub/Sub roughly
      once a second while idle; any transient failure from that call (a realistic occurrence over time,
      not hypothetical) propagated out of the loop and silently killed the worker for good — the task is
      fire-and-forget (`asyncio.create_task` in `main.py`'s lifespan, nothing ever awaits it), so nothing
      noticed. The API kept serving 200s throughout, so this was invisible short of noticing reviews had
      stopped completing. Reproduced: a review submitted stayed unprocessed for over an hour with zero
      worker log activity in between. Fixed by wrapping `consume()` in its own try/except (log + backoff
      + `continue`, never let it escape the loop) and adding a `worker_task.add_done_callback` in
      `main.py` that logs CRITICAL immediately if the task ever exits unexpectedly, so a future regression
      is caught in seconds instead of discovered by hand hours later.
- [x] Retry (`POST /api/reviews/{id}/retry`) also had a frontend-only bug: `ReviewProgressPage`'s polling
      loop deliberately stops recursing once a review reaches `FAILED` (no point polling a dead end), but
      its `useEffect` only re-runs on `[reviewId, navigate]` — neither changes on retry, so clicking Retry
      updated the status to `QUEUED` once (optimistically) and then nothing ever polled for what happened
      next; the screen looked stuck until a manual page refresh. Fixed with a `pollGeneration` counter,
      bumped on retry and added to the effect's dependency array, to force the polling loop to restart.
- [x] Retry with backoff, max delivery attempts before FAILED — in real mode, `delivery_attempt`
      comes from Pub/Sub's own redelivery count (`ReceivedMessage.delivery_attempt`, only populated
      when the subscription has a dead-letter policy — `infra/setup-gcp-resources.sh` sets one up,
      with Pub/Sub's own dead-letter kicking in at 5 attempts as a backstop beyond the app's
      `MAX_DELIVERY_ATTEMPTS` default of 3).
- [x] Frontend polls status through QUEUED → ANALYZING → COMPLETED / FAILED (+ CANCELLED status
      value modeled but no UI path cancels a QUEUED review yet — not in the MVP checklist)
- [x] Retry action on FAILED reviews (`POST /api/reviews/{id}/retry`, wired to the UI)

## Phase 6 — Historical learning (RAG; verified working end-to-end against a real deployed index)

- [x] Historical CSV → validate rows → normalize text → index in memory at startup
      (`app/services/historical_data.py`); malformed rows are skipped with a summary, never crash
      the run (see `historical_data.load`'s return value, logged on startup). Also now kept as an
      `id -> HistoricalRule` map (`_rules_by_id`) so real Vector Search neighbor IDs can resolve
      back to a row.
- [x] `find_matches()` dispatches on `settings.local_mode` — `true` keeps the category-filter +
      keyword-overlap mock (`_find_matches_mock`); `false` calls `_find_matches_vertex`: embeds the
      submitted code with `google-genai` (`EMBEDDING_MODEL`) and queries a deployed
      `MatchingEngineIndexEndpoint` (`google-cloud-aiplatform`) for nearest neighbors. **Verified
      working**: a brute-force (not Tree-AH — see `scripts/ingest_historical_data.py`'s comments)
      index with `SHARD_SIZE_SMALL` is deployed on an `e2-standard-2` endpoint (`SHARD_SIZE_MEDIUM`,
      the default for 768-dim brute-force indexes, requires `e2-standard-16`+ and silently failed to
      deploy on `e2-standard-2` the first time), and returns real semantically-relevant historical
      rules end to end through the UI.
- [x] **Relevance filtering, not just retrieval**: real-mode retrieval alone (top-k by similarity)
      surfaced topically-related but inapplicable rules — e.g. `def c(a, b): x = a*b; return x`
      matched "break up functions longer than 50 lines" and "avoid bare except clauses," neither of
      which the code actually has, purely because "function" and "quality" are broad, similarity-prone
      terms. Fixed by retrieving more candidates (`limit=8` in `review_service.py`, up from 3) and
      having Gemini itself judge which candidates it was shown genuinely apply, with full view of the
      real code, in the same call (`GeminiModelOutput.relevantHistoricalRuleIds`,
      `gemini_service._analyze_with_gemini` filters candidates down to those ids before setting
      `analysis.historicalMatches`) — no extra round-trip needed. `review_service.py` no longer
      overwrites `historicalMatches` after the real-mode Gemini call (mock mode is unaffected: it still
      assigns matches itself, since it has no relevance step of its own). Frontend copy
      (`HistoricalInsight.tsx`) changed from "N historical patterns matched" to "N relevant historical
      rule(s), confirmed by Gemini" to not overstate what retrieval alone proves.
- [x] Worker retrieves top-k historical rules and attaches them to the result as context — in real
      mode this now happens *before* the Gemini call (`review_service.process_review`) so matches
      become prompt context, per §description in `historical_data._find_matches_vertex`; the mock
      path still runs retrieval after analysis since it depends on categories Gemini's mock found.
- [x] Result includes which historical rules matched → renders as "Historical Insight" in the UI

## Phase 7 — Firestore persistence (code wired; real database not created yet)

- [x] `app/services/firestore_service.py` dispatches on `settings.local_mode` — `true` keeps the
      in-memory `{userId: {reviewId: Review}}` dict; `false` calls real `google-cloud-firestore`
      (`AsyncClient`) against `users/{userId}/reviews/{reviewId}` (idempotency keys live alongside
      at `users/{userId}/idempotencyKeys/{key}`), matching §26's shape exactly. **Untested against a
      live database** — no Firestore database exists yet (`infra/setup-gcp-resources.sh` creates one).
- [x] Deviation from §26's example schema: the review record also stores the original `code`
      (excluded from the `GET /api/reviews` list response, still present on `GET /api/reviews/{id}`)
      so the result page can show exactly what was reviewed and a retry can re-run analysis without
      the submission having to be re-sent. Revisit before a real deployment: §42/§27 imply retention
      controls (TTL, or moving the blob to Cloud Storage instead of inline in Firestore) once this
      is backed by a real database rather than an in-memory dict that's wiped on restart anyway.
- [x] History page: search + filter by language/score/sort-by-date-or-score, click-through to full
      result
- [x] Ownership check on every read: authenticated identity only, never trust client-supplied IDs
      (verified in `tests/test_review_flow.py::test_cross_user_review_is_not_found`)

## Phase 8 — Production UX polish

- [x] Toasts, responsive layout (verified in a real headless-Chromium pass, including a mobile
      viewport — see session notes), loading/empty/error states across all pages
- [x] Confirm Clear/Review Again/Retry all behave per §21/§22/§31 (no destructive surprises) —
      verified in browser: Clear requires confirmation and never touches saved reviews, Review
      Again resubmits the same code as a new review (see Phase 2 note — this changed after launch),
      Retry only appears on FAILED reviews (409 otherwise)

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

## Phase 10 — Deployment (project exists; no GCP resources created yet)

The "sandbox access email" blocker is gone — a real GCP project is available — but no billed
resources have actually been created from this repo yet; nothing here has run against live GCP.
Order: enable APIs → Vertex AI + Gemini + Embeddings + Vector Search → Firestore → Pub/Sub →
Cloud Storage bucket → build containers → deploy Cloud Run (frontend/backend/worker) → run
ingestion → end-to-end test.

- [x] `scripts/ingest_historical_data.py` written (Phase 3/10): embeds `historical-review-rules.csv`
      via Vertex AI Embeddings, uploads to Cloud Storage, and (opt-in flags, not run automatically)
      creates+deploys a Vector Search Index/Endpoint or re-imports into an existing one. Only its
      CSV-parsing has actually been exercised end to end so far — `--dry-run`'s embedding call needs
      Application Default Credentials, which this dev machine doesn't have configured; running from
      Cloud Shell (already authenticated) instead.
- [x] `infra/setup-gcp-resources.sh` written: enables the required APIs, creates the Pub/Sub
      topic+subscription (with a dead-letter policy, needed so `delivery_attempt` populates — see
      Phase 5), the Firestore database, the historical-data Cloud Storage bucket, and an Artifact
      Registry Docker repo. Not run yet.
- [x] `infra/cloud-run/deploy-backend.sh` and `deploy-frontend.sh` written: build+push each image and
      `gcloud run deploy`. Backend deploy uses `--min-instances=1 --no-cpu-throttling` since the
      review worker is a background asyncio task inside the API process, not a per-request handler —
      without those flags Cloud Run would stall or kill it between requests. Deploy order matters:
      backend first (frontend needs its URL as a Vite build arg), then frontend, then re-run the
      backend deploy with `CORS_ORIGINS` set to the frontend's URL. Not run yet.
- [x] Both Dockerfiles updated to listen on Cloud Run's `$PORT` (shell-form `CMD` so it expands;
      `docker-compose.yml`'s port mappings updated to match, host ports unchanged).
- Currently using a Qwiklabs/Google Cloud Skills Boost temporary project
  (`qwiklabs-gcp-01-a7e8659adaae`) for hands-on testing — by design, throwaway: whatever gets
  provisioned there (Vector Search index, Pub/Sub, Firestore, Cloud Run services) disappears when
  the lab session ends. Treat it as a place to verify each phase works, not as the final deployment.

## Phase 11 — Pre-review code validation (not in the original spec; added afterward)

- [x] `POST /api/code/validate` (`app/api/code_validation.py`) + `app/services/code_validators.py`:
      checks syntax/completeness *before* Review Code calls Gemini, so obviously incomplete input
      (`def`, `function`, `{`, ...) doesn't spend a review on it. Never executes, imports, or shells
      out to run the submitted code — see the module's own docstring for the full reasoning.
- [x] Python gets a real check: `ast.parse` + `compile(..., "exec")` (compiling to a code object never
      executes it — only `exec()`-ing the result would; this stays a pure syntax check). Using both
      matters: `ast.parse` alone misses semantic-during-compile errors like module-level `return`.
- [x] JavaScript/TypeScript/Java/SQL/HTML get a heuristic (not real-parser) validator — delimiter/
      string/comment balance plus a small set of "obviously still typing this" trailing patterns, each
      clearly labeled `<language>-heuristic` in the response so it's never confused with a real parse.
      No JS/TS parser, Java compiler, or SQL parser is available to the backend (the frontend's
      TypeScript devDependency lives in frontend/node_modules, which the backend container never has —
      shelling out to it would silently break in any deployment that doesn't co-locate the two).
- [x] C/C++ and Go/Rust/Ruby/PHP report `validation_unavailable` rather than a fake pass — this
      environment has no `gcc`/`g++` (matches the same finding from `infra/setup-gcp-resources.sh`'s
      review — see Phase 10), and the other four just don't have a validator built yet. This status
      never blocks Review Code; see `NON_BLOCKING_STATUSES` in `NewReviewPage.tsx`.
- [x] "Compile / Run" is intentionally **not implemented and not shown in the UI** — real sandboxed
      execution (CPU/memory/network/filesystem limits) needs infrastructure this environment doesn't
      have (no Docker, no compilers). A first pass added the button disabled with an explanatory
      tooltip; removed on request rather than leave a permanently-disabled control with no near-term
      path to working. ponytail: add a real sandboxed execution backend (e.g. a Docker-based or hosted
      code-execution service) and the button back together, rather than building unsafe local
      execution to fill the gap in the meantime.
- [x] Frontend: `useCodeValidation` hook (click-triggered, not per-keystroke — debounced
      auto-validation was the other spec-sanctioned option but wasn't built) with `AbortController`-based
      stale-response protection, `ValidationStatus` for the message/line/column display, and Monaco
      error markers via `CodeEditor`'s new `markers` prop. Validation result is cleared automatically
      whenever code or language changes, so Review Code re-disables until the new code is re-validated.
      Review Code stays disabled until a validation result exists and doesn't block it.
- [x] 45 backend tests (`tests/test_code_validation.py`) covering empty/whitespace/invisible-unicode/
      comment-only input, the spec's own per-language examples, oversized payloads (413), malformed
      requests (422), and that a validator crash degrades to `validation_unavailable` instead of a 500
      or a leaked traceback.
- Known limitations: the heuristic validators can't catch a semantically-wrong-but-delimiter-balanced
  mistake (e.g. an invalid TypeScript type annotation) the way a real parser would; Python's message-
  based incomplete/syntax_error/indentation classification depends on CPython's exact wording, stable
  since 3.10 but not a documented guarantee. Recommended next step: a real parser per heuristic
  language (e.g. an embedded tree-sitter grammar) if these gaps prove to matter in practice.

## Phase 12 — Review versioning, comparison & failure classification

Full spec: `docs/REVIEW_VERSION_METRICS_PROMPT.md`. Builds on the resubmission-caching added at the
end of Phase 8 (`isResubmission`/`previousReviewId`).

- [x] `codeHash` (already existed) is reused as the code-identity key everywhere below; `version`
      (`Review.version`, `firestore_service.assign_code_version`) is the 1-based index of a codeHash
      among the distinct code identities a user has submitted, in first-submission order — a
      resubmission (forced or not) keeps the version it was first assigned rather than incrementing.
- [x] `force` on `POST /api/reviews` explicitly bypasses the cached-result short-circuit and reruns
      Gemini on code that already has a COMPLETED review with the same hash ("Review Again Anyway" on
      the resubmission banner). The resulting review is flagged `excludeFromMetrics` so a deliberate
      re-run of unchanged code can't inflate the dashboard's averages — `DashboardPage`'s `completed`
      filter excludes it, `Reviews`/History still show it.
- [x] `FailureReason` (`SYNTAX_ERROR`/`VALIDATION_ERROR`/`COMPILE_ERROR`/`RUNTIME_ERROR`/
      `REVIEW_SERVICE_ERROR`/`GEMINI_ERROR`/`TIMEOUT`/`INTERNAL_ERROR`) is set on a `FAILED` review.
      `review_service._StagedFailure` wraps each pipeline stage (Gemini call vs. Vector Search call)
      individually so the reason reflects which stage actually raised, rather than guessing from the
      exception's own type/message. A FAILED review's codeHash is never treated as "already reviewed"
      (only a COMPLETED review is), so resubmitting the same code after a failure always retries —
      no special-casing needed beyond that existing rule.
- [x] `ReviewComparison` (`previousReviewId`, `previousScore`, `scoreChange`, `issuesResolved`,
      `newIssues`, `remainingIssues`) is computed in `process_review` against
      `firestore_service.find_latest_completed_excluding` — the user's most recent other completed,
      scored review, matching the same "per-user trend, not per-code-lineage" scope the dashboard's
      Latest/Best/Improvement metrics already used. Issue matching uses a stable
      `(category, normalized title)` key (`review_service._issue_key`) rather than exact text, since
      Gemini can reword the same underlying issue between two runs.
- [x] Frontend: `ReviewResultPage` shows a "Compared to your previous review" card when `comparison`
      is present, a "Review Again Anyway" action on the resubmission banner, and a note when a review
      is excluded from metrics; `ReviewProgressPage` shows a human-readable message per
      `FailureReason` instead of the raw backend error string.
- [x] Backend tests (`test_review_flow.py`): version stays stable across resubmission/forced
      resubmission, forced resubmission reruns Gemini and is excluded from metrics, comparison is
      computed correctly (score delta + resolved/new issue counts) against the previous successful
      review, and a FAILED review can be resubmitted/retried with identical code. 64/64 backend tests
      passing; frontend type-checks and builds clean; verified live via Playwright against a running
      local-mode instance (comparison card, force-review button, dashboard averages excluding the
      forced review all render correctly).
- Not implemented from the spec: a separate "code versions" list/UI (version is tracked and stored
  but only surfaced as a number, not its own history view), and per-user aggregate metric documents
  (Firestore efficiency section) — metrics are still computed client-side from `list_reviews` like
  the rest of the dashboard, which is fine at this app's scale.

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
