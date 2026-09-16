# Plan — Whole-Project ZIP Upload & Project-Level Code Review

Status: **planning only, nothing in this file is implemented yet.** This is the design doc for the
feature PLAN.md's "Explicitly deferred" section flags as:

> ZIP upload (only after single-file upload is stable; needs path-traversal / nested-zip / size /
> file-count / binary-file guards per §29 when it lands)

Single-file upload has been stable since Phase 2/3, so this is the next step. Once a build starts,
this becomes "Phase 13" in `PLAN.md` with checkboxes; this file stays as the detailed reference
`PLAN.md` links to, the same way Phase 12 links to `docs/REVIEW_VERSION_METRICS_PROMPT.md`.

Revision note: this version folds in a round of review feedback aimed at cost/scale/UX before any
code exists — project-type detection, file prioritization, token budgeting, retry-with-backoff,
partial results, cancellation, and a lightweight project-summary pass are now part of the plan
(§4.3–§4.7, §5.4–§5.5), not just fast-follow ideas. What's still deferred is narrower and listed
in §10.

Second revision note: a cross-check against the actual codebase (not just a read-through of this
doc) surfaced five places where earlier wording claimed more reuse or existing infrastructure than
the code actually has. Corrected in §4.1, §4.8, §5.5, and §8 below, each marked
**Cross-check correction**.

## 0. Objective

Let a user upload a `.zip` of a project (not just one file) and get back a **project-level**
review: a project profile, a prioritized per-file breakdown, a lightweight cross-file summary, and
an aggregate score — while reusing as much of the existing single-review pipeline and UI as
possible (`ScoreCard`, `IssueList`, `IssueCard`, `CodeEditor`, the `GeminiAnalysis` schema, the
LOCAL_MODE-dispatch pattern, the async QUEUED→ANALYZING→COMPLETED worker model).

**MVP scope**: upload → validate & extract → detect project type → filter + prioritize files →
per-file Gemini review (reusing `gemini_service.analyze_code` unchanged) with bounded concurrency,
retry-with-backoff, and per-file token/line budgeting → aggregate score over reviewed source files
→ a compact project-summary pass over per-file metadata (not full source) → project dashboard with
partial results while still running, cancellation, and per-file drill-down.

**Explicitly not MVP** (see §10): a single combined-prompt cross-file analysis over full source,
GitHub repo import (vs. a local zip), incremental re-review of a changed project, line-weighted
score aggregation, re-zipping a patched project for download.

## 1. How this differs from single-file review

This is the question that has to be answered before anything else, since it drives almost every
other decision below. They are **not** the same flow with a bigger input — they diverge at the
input step and only reconverge at the per-file result view.

| | Single file (existing) | Whole project (new) |
|---|---|---|
| Input | Paste / type into Monaco, or upload **one** text file | Upload **one `.zip`** (binary, multipart) |
| Client-side step before submit | Language auto-detect + optional manual override | Extract & list files, detect project type, auto-select by priority tier, let the user override |
| What gets edited | The code itself, live, in the editor | Nothing — a project upload reviews *existing* files as-is; there's no "type your project into a textbox" step. Editing a fix happens later, per-file, via the existing "Apply Fix" flow (§6) |
| Unit of review | One `Review` (one code blob, one score) | One `ProjectReview` (many per-file sub-reviews + one aggregate score + one lightweight summary) |
| Backend call | 1 Gemini call | N Gemini calls (one per included file, bounded concurrency, retried on transient failure) + 1 small summary call |
| Progress UI | Fixed list of product-level steps ("Gemini analyzing…") | The same step list, **plus** a live grouped counter (queued/analyzing/completed/failed), a cancel action, and a way to view completed files before the rest finish |
| Result UI | `ScoreCard` + Overview/Issues/Code/History tabs for the one file | A project dashboard (score, "needs attention first", a short project summary, then the file table) that drills into **the existing single-file result view, unmodified**, per file |
| History | One row per `Review` | A distinct row type ("Project · 42 files · 7.2 avg") — not mixed into the per-file list, see §5.6 |
| New validation surface | `validate_code`: empty/size/line/binary checks on one string | All of that, per included file, **plus** archive-level guards (path traversal, zip bombs, nested zips, symlinks, total file count/size — §8) and per-file token/line budgeting (§4.6) |

The two flows share the same *destination* (a `GeminiAnalysis` result rendered by the same
components) but need genuinely different input, validation, and progress UX. They should **not**
be forced into one identical UI just to reuse code — reuse the parts that are actually the same
(scoring, issue rendering, the fix-preview flow) and let the parts that are actually different
(upload widget, progress detail, result shape) be different components.

## 2. Where this plugs into the existing app

No existing single-file behavior changes. This is additive:

- New Firestore-shaped collection (own document type, not a variant of `Review`) — see §4.2.
- New API routes under `/api/projects` — a new resource, not an overload of `/api/reviews`, since
  the shape (files, aggregate, progress) is fundamentally different from one review.
- New worker path that reuses `review_service`'s existing per-file primitives (language detection,
  `validate_code`, `gemini_service.analyze_code`) rather than duplicating them.
- New frontend routes reusing `ScoreCard`, `IssueList`, `IssueCard`, `CodeEditor`, `ReviewButton`,
  toast/empty/error states, and the `chartColors.ts` palette — no new design system, just new
  screens built from the existing one.

```
backend/app/
├── api/
│   ├── reviews.py            (unchanged)
│   └── projects.py           (new) — POST /api/projects, GET /api/projects, GET /api/projects/{id},
│                                       GET /api/projects/{id}/files/{fileId},
│                                       POST /api/projects/{id}/cancel
├── schemas/
│   ├── review.py             (unchanged)
│   └── project_review.py     (new) — ProjectReview, ProjectFile, ProjectProfile, PriorityTier
├── services/
│   ├── review_service.py     (unchanged; project_review_service calls into gemini_service the same
│   │                           way this does, not a copy of it)
│   ├── project_review_service.py   (new) — create/list/get/cancel, drives per-file analysis
│   ├── zip_extraction.py     (new) — the ONLY place zip bytes are touched; see §8
│   ├── project_detector.py   (new) — manifest-based project-type/profile detection, §4.3
│   ├── file_prioritizer.py   (new) — priority-tier assignment + default selection, §4.4
│   ├── code_storage_service.py     (new) — ponytail: in-memory dict under LOCAL_MODE, real
│   │                                 Cloud Storage otherwise; see §7
│   └── firestore_service.py  (extended with project_review_* functions, same
│                               dispatch-on-settings.local_mode pattern as every other service here)
└── workers/
    └── project_review_worker.py   (new) — same fire-and-forget asyncio-task shape as
                                     review_worker.py, own queue/topic so a slow project batch
                                     can never head-of-line-block single-file reviews;
                                     concurrency + retry + cancellation live here (§4.8)

frontend/src/
├── pages/
│   ├── NewReviewPage.tsx           (extended — adds the Single File / Project mode switch, §5.1)
│   ├── ProjectProgressPage.tsx     (new) — also serves partial results, §5.4
│   ├── ProjectResultPage.tsx       (new) — aggregate dashboard, delegates per-file drill-down to...
│   └── ReviewResultPage.tsx        (extended to also render when backed by a ProjectFile, not just
│                                     a Review — see §5.5)
├── components/
│   ├── ProjectFileTree.tsx         (new) — checkbox tree with tier-based defaults, §5.2
│   ├── ProjectFileStatusList.tsx   (new) — grouped, collapsible live progress rows, §5.4
│   └── ProjectScoreTable.tsx       (new) — sortable per-file table, §5.5
└── services/
    └── projects.ts                 (new) — createProjectReview (multipart + upload progress),
                                      getProjectReview, listProjectReviews, cancelProjectReview
```

## 3. End-to-end flow

```
Pick "Project (.zip)" mode on New Review
        │
        ▼
Drop / browse a .zip  ──────────────►  Upload (byte-progress bar)
        │
        ▼
Backend: archive-level validation (§8) — reject outright on the first
violation, before extracting anything, with a specific error
        │
        ▼
Backend: in-memory extraction, path/size/type filtering, noise-directory
exclusion (node_modules/, .git/, dist/, __pycache__/, vendor/, lockfiles, ...)
        │
        ▼
Backend: detect project type from manifest files (§4.3), assign each
remaining file a priority tier (§4.4)
        │
        ▼
Respond with a file manifest (path, language, size, tier, included/excluded + why)
plus the detected project profile
        │
        ▼
Frontend: ProjectFileTree — pre-checked by tier (source/API/auth/db tiers on,
tests/docs/config off by default), user can override either direction,
sees a live "N files · M lines · K KB selected" summary
        │
        ▼
"Review Project" ─────────────────►  POST /api/projects  (creates ProjectReview,
                                       status=QUEUED, one ProjectFile doc per
                                       selected file, status=QUEUED each)
        │
        ▼
Worker: analyzes files with bounded concurrency (e.g. 4 at a time),
applying per-file token/line budgeting (§4.6), retrying transient
failures with backoff (§4.8), reusing gemini_service.analyze_code per
file, updating each ProjectFile's status/result and the parent's
filesAnalyzed counter as it goes — checks for a cancellation flag
between files
        │
        ▼
Frontend polls GET /api/projects/{id} — progress page shows grouped
counts, can jump to partial results any time, or cancel
        │
        ▼
All files terminal (COMPLETED, FAILED, or SKIPPED-by-cancel) →
aggregate score over successfully-reviewed source-tier files (§4.5)
        │
        ▼
Backend: lightweight project-summary pass — per-file summaries +
top issues + the project profile (not full source) → a short
cross-file summary (§4.7)
        │
        ▼
ProjectReview status=COMPLETED
        │
        ▼
ProjectResultPage: score, "needs attention first", project summary,
issue breakdown, full sortable file table → click a file → same
Overview/Issues/Code tabs single-file reviews already use, bound to
that ProjectFile
```

## 4. Backend design

### 4.1 API

```
POST   /api/projects                 multipart/form-data, field "file" = the .zip
                                      → 201 { projectId, status: "QUEUED", fileCount, excludedCount }
                                      → 400 on an archive-level violation (§8), with a specific
                                        message ("Archive exceeds the 25 MB limit", "Entry
                                        'shared/../../etc/passwd' escapes the archive root", ...)
                                      → 422 if, after filtering, zero reviewable files remain

GET    /api/projects                 → list[ProjectReviewSummary] (no per-file code, same
                                        "list is light, detail is not" split as GET /api/reviews)

GET    /api/projects/{id}            → ProjectReview incl. all ProjectFile summaries (path,
                                        language, tier, status, score, issue count) but not each
                                        file's full code/result — keeps the poll payload small.
                                        Valid (and expected) to call this while status=ANALYZING —
                                        it's how partial results are read, not just a terminal-state
                                        endpoint (§5.4)

GET    /api/projects/{id}/files/{fileId}
                                      → the one ProjectFile's full code (fetched from
                                        code_storage_service, §7) + GeminiAnalysis result, i.e.
                                        exactly the shape ReviewResultPage already renders

POST   /api/projects/{id}/cancel     → sets status=CANCELLING; the worker observes this between
                                        files and stops scheduling new ones (§4.8) → the project
                                        settles into CANCELLED once in-flight files finish
```

All are auth-scoped exactly like `/api/reviews` — ownership derived from `get_current_user_id`,
404 (never a leaked "exists but isn't yours") on someone else's project. `get_current_user_id` is a
plain header dependency (`Authorization: Bearer ...`), content-type agnostic, so it works unchanged
on a multipart route — verified against `backend/app/security/auth.py`.

**Cross-check correction:** `POST /api/projects` would be the *first* multipart/binary endpoint
this backend has ever had. Today's single-file "upload" input mode is client-side only —
`NewReviewPage.tsx` calls `file.text()` and posts the same JSON body as paste/write; the backend
has never parsed a `multipart/form-data` request. Two concrete pieces of new infrastructure follow
from that, neither optional:
- `python-multipart` must be added to `backend/requirements.txt` — FastAPI's `UploadFile`/`File(...)`
  raises at import/request time without it, it isn't bundled with `fastapi` itself.
- There is no existing pattern in this codebase for streaming/limiting a large request body (see
  §8's correction below) — this has to be designed fresh, not copied from the JSON review endpoint.

### 4.2 Data model

New top-level collection, `users/{userId}/projectReviews/{projectId}`, with a `files` subcollection
— deliberately not a field holding a list of file objects, so `GET /api/projects/{id}` can be
answered without ever pulling every file's full result.

```json
// users/{userId}/projectReviews/{projectId}
{
  "id": "proj_abc123",
  "userId": "user_456",
  "status": "ANALYZING",              // QUEUED | ANALYZING | CANCELLING | CANCELLED | COMPLETED | FAILED
  "originalFilename": "my-app.zip",
  "zipStorageUri": "local://proj_abc123/original.zip",  // see §7 — never re-parsed after
                                                          // manifest generation, kept only for
                                                          // audit/download-original convenience
  "profile": {                        // §4.3
    "projectType": "React + FastAPI",
    "languages": ["typescript", "python"],
    "frameworks": ["react", "fastapi"],
    "entryPoints": ["src/main.tsx", "backend/app/main.py"],
    "estimatedComplexity": "medium"
  },
  "reviewMode": "standard",           // "standard" | "comprehensive" — §5.1/§4.4
  "fileCount": 48,
  "excludedCount": 612,               // node_modules/etc, shown to the user, never silently hidden
  "filesAnalyzed": 12,                // terminal (completed+failed+skipped) count, for the progress bar
  "totalLines": 9110,
  "totalSize": 284213,
  "overallScore": null,               // set once every file is terminal — mean over source-tier
                                       // COMPLETED files only (§4.5)
  "worstFiles": [],                   // top 3 lowest-scoring source-tier files, denormalized onto
                                       // the parent doc once known
  "mostCommonIssueCategory": null,
  "summary": null,                    // §4.7's short cross-file summary text, set after all files
                                       // are terminal
  "createdAt": "...",
  "completedAt": null,
  "cancelledAt": null,
  "error": null,
  "failureReason": null               // same FailureReason enum reused — e.g. every file failing
                                       // rolls the project up to FAILED too
}

// users/{userId}/projectReviews/{projectId}/files/{fileId}
{
  "id": "file_1",
  "path": "src/api/users.py",         // path within the archive, shown as-is in the tree/table
  "language": "python",
  "tier": "api",                      // §4.4 — source | api | auth | data | config | util | test | docs
  "status": "COMPLETED",              // QUEUED | ANALYZING | COMPLETED | FAILED | SKIPPED
  "codeStorageUri": "local://proj_abc123/files/file_1.txt",   // §7 — code itself lives here, not
                                                                // inline in this document
  "codeSize": 4211,
  "lines": 132,
  "truncated": false,                 // §4.6 — true + truncatedNote set if this file exceeded the
                                       // per-file budget and was reviewed partially
  "truncatedNote": null,
  "score": 6.5,
  "result": { /* GeminiAnalysis — IDENTICAL shape to a single Review's result */ },
  "attempts": 1,                      // §4.8 retry count
  "error": null,
  "failureReason": null
}
```

Reusing `GeminiAnalysis` unchanged for `ProjectFile.result` is still the single most important
reuse decision here — it's what lets `ScoreCard`/`IssueList`/`IssueCard`/the suggested-fix flow
work against a project file with zero changes to those components.

### 4.3 Project type detection

A new `project_detector.py`, run once per project right after extraction/filtering, purely from
well-known manifest files it finds in the archive (never from Gemini — this is cheap, deterministic,
and doesn't need an LLM call):

| Manifest present | Signals |
|---|---|
| `package.json` | Node/JS project; `dependencies`/`devDependencies` keys distinguish React / Next.js / Angular / Express / Vue |
| `requirements.txt`, `pyproject.toml`, `Pipfile` | Python project; dependency names distinguish FastAPI / Django / Flask |
| `pom.xml`, `build.gradle` | Java project; distinguishes Spring Boot from plain Java |
| `go.mod` | Go project |
| `*.csproj`, `*.sln` | .NET project |
| `Gemfile` | Ruby (Rails if `rails` gem present) |
| `Cargo.toml` | Rust project |

Produces the `profile` object stored on `ProjectReview` (§4.2). `entryPoints` is a small heuristic
list (`main.py`, `app.py`, `src/main.tsx`, `src/index.tsx`, `Program.cs`, etc. — whatever's present
at the expected conventional path for the detected stack), not a guarantee. `estimatedComplexity`
is a rough bucket (`small`/`medium`/`large`) from total file count + total lines, used only to set
user expectations on the upload screen ("~48 files, medium project — this usually takes a couple
of minutes"), never to change validation limits.

If no manifest is recognized, `profile.projectType` is `"Unknown"` and everything downstream
(prioritization, summary pass) still works — it just can't label the stack or the tier weighting
loses its "API/auth/data" signal that's normally inferred partly from framework conventions (see
§4.4), falling back to path/filename heuristics alone.

This is purely additive metadata — it never blocks a review or excludes files by itself.

### 4.4 File prioritization & default selection

Every included file (after §8's noise/binary/lockfile exclusion) gets one `tier`:

| Tier | Examples | Default selection |
|---|---|---|
| `auth` | filenames/paths matching `auth`, `login`, `session`, `jwt`, `permission` | **on** |
| `api` | route/controller/handler files (framework-aware where the profile identifies one — e.g. anything under FastAPI's router includes, Express `routes/`, Spring `@RestController` files by simple text match) | **on** |
| `data` | database/repository/model/migration files | **on** |
| `source` | everything else that's a recognized-language source file and isn't caught by a lower tier | **on** |
| `util` | `utils/`, `helpers/`, `lib/` paths | **on** |
| `config` | `.env.example`, `settings.*`, `config.*`, `*.yaml`/`*.yml` outside CI dirs | **off** |
| `test` | `test_*`, `*_test.*`, `*.test.*`, `*.spec.*`, `tests/`, `__tests__/` | **off** |
| `docs` | `README*`, `CHANGELOG*`, `*.md` outside a recognized source tree | **off** |

Tiering is a set of ordered filename/path heuristics (first match wins — `auth` and `api` are
checked before the generic `source` catch-all), not a Gemini call. Lockfiles
(`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `poetry.lock`, `Cargo.lock`)
and other clearly-generated files are excluded entirely upstream in §8's filtering, before tiering
even runs — they're never "a tier the user can turn on," since reviewing a lockfile has no value.

**Review mode** (a single toggle on the upload screen, §5.1) changes only the *default checked
state* fed to the tree, never what's technically excludable:

- **Standard** (default): `auth`/`api`/`data`/`source`/`util` pre-checked, `config`/`test`/`docs`
  pre-unchecked.
- **Comprehensive**: everything pre-checked except files §8 already excludes outright.

The user can still check/uncheck any individual file regardless of mode — the mode only sets the
tree's starting state, exactly like today's file tree design already allows overriding.

This is the direct fix for "don't blindly review every file": a typical repo's noise (lockfiles,
tests, docs, config) stops consuming Gemini calls by default, without ever hiding a file the user
can't still choose to include.

### 4.5 Aggregation rules

- `overallScore` = arithmetic mean of `score` across files with `status == COMPLETED` **and**
  `tier` not in `{config, test, docs}` — i.e. the score represents the reviewed application code,
  not diluted by a README or a config file that happened to also get reviewed under Comprehensive
  mode. (A file in an excluded-by-default tier that the user explicitly opted into still gets a
  full review and shows up in the file table with its own score — it's just not folded into the
  headline number, the same way `README.md` scoring 10/10 for having no bugs shouldn't drag a
  genuinely weak `main.py` up.)
- Files that `FAILED` are excluded from the average — a failure is not a 0, same rule as a single
  `FAILED` `Review` being excluded from dashboard metrics today.
- If **every** eligible file fails, the `ProjectReview` itself rolls up to `FAILED`.
- `worstFiles`: the 3 lowest `score` values among the same eligible (non-excluded-tier, COMPLETED)
  set, ties broken by higher issue count.
- `mostCommonIssueCategory`: same category-tally logic `DashboardPage.tsx` already uses, scoped to
  this project's eligible files.
- **Fast-follow, not v1**: importance-weighted aggregation using the tiers already established
  above — e.g. `auth`/`api`/`data` weight 1.5, `source` 1.0, `util` 0.8 — is a natural next step
  once simple-mean-over-eligible-files has been used on real projects and, if it visibly
  under-weights a bad auth file sitting next to ten clean utility files, the tiers needed for this
  already exist from §4.4 with no new data model change required.

### 4.6 Per-file size/token budgeting

Beyond the existing byte-size cap on inclusion (§8), each file gets an explicit **reviewable**
budget before it's sent to Gemini:

- Max lines actually sent per file: e.g. 1,000 (config `PROJECT_FILE_MAX_LINES`).
- Max estimated tokens per file: e.g. 12,000 (a rough `len(text) / 4` estimate is enough here —
  no need for a real tokenizer just to gate a soft budget).

A file over budget is **not silently truncated**: it's still reviewed, but only its first N lines
(the budget), and both `ProjectFile.truncated=true` and a specific `truncatedNote` are set (e.g.
`"Reviewed the first 1,000 of 2,400 lines — this file exceeded the per-file analysis limit."`),
which the per-file result view (§5.5) surfaces as a visible banner, not a footnote. This matches
the app's existing "never silently drop information" instinct (the same reasoning behind always
showing *why* a file was excluded in §5.2's tree).

True logical chunking (split at function/class boundaries, review each chunk, merge findings with
correct line-number remapping) is meaningfully more complex — real risk of double-counting or
misattributing an issue across chunk boundaries — and is **not v1**. The naive "first N lines,
clearly labeled" approach ships something honest and useful now; revisit chunking if truncation
turns out to bite real projects often enough to matter.

### 4.7 Project summary pass (lightweight, not full-source cross-file analysis)

After every file is terminal, one additional small Gemini call — not one per file, one total —
produces a short cross-file summary, fed **only structured metadata**, never full source:

```json
{
  "profile": { "projectType": "React + FastAPI", "languages": ["typescript", "python"], ... },
  "fileSummaries": [
    { "path": "src/api/users.py", "tier": "api", "score": 6.5, "topIssues": ["Bare except clause", "..."] },
    { "path": "src/auth/login.py", "tier": "auth", "score": 4.0, "topIssues": ["Hardcoded credential"] }
  ]
}
```

This is cheap (the payload is per-file summaries + top issue titles, not source) and answers
things no single file's review can: repeated issues across files, an inconsistent pattern (e.g.
"3 of 4 API files use parameterized queries, one doesn't"), or an overall architectural note tied
to the detected `profile`. It is explicitly **not** the deferred "true cross-file analysis" (§10)
— it never sees source code and can't reason about, say, an actual circular import between two
files; it can only reason over what each file's own review already surfaced. Store the result in
`ProjectReview.summary` (plain text, a few sentences — same register as `GeminiAnalysis.summary`
today) plus reuse `GeminiAnalysis.recommendations`' list shape for a short cross-file
recommendations list if useful; no new schema type needed beyond that.

If this call fails, it degrades to `summary: null` and the dashboard simply omits that section —
it never blocks the project from reaching `COMPLETED`, since every file's own result is already
the substantive part of the review.

### 4.7.1 Tiered model routing (added post-v1, after a real cost/latency issue)

`gemini_service.analyze_code`/`summarize_project` were originally hardcoded to `settings.gemini_model`
for every call — fine for single-file Code Review (one call), but Project Review makes one call
per included file, so switching that one setting to a stronger/slower model (`gemini-2.5-pro`, after
`gemini-2.0-flash-001` turned out to be unavailable on this GCP project) multiplied the latency and
cost across every file in every project, with no quality benefit for a config file or a test
fixture.

Fix: `PRO_MODEL_TIERS` (`app/schemas/project_review.py`) restricts the stronger model
(`settings.project_review_pro_model`) to the two tiers where the extra reasoning is actually worth
it — `auth` (security-sensitive) and `api` (the project's external-facing surface, the most
architecturally significant tier). Every other tier (`data`, `source`, `util`, `config`, `test`,
`docs`) uses the fast model (`settings.project_review_flash_model`). Both settings are independent
of `GEMINI_MODEL`, which remains single-file Code Review's own setting — routing decisions never
touch that call site. The one-per-project summary pass (§4.7) always uses the Pro model, since it's
a single call regardless of project size, so the extra latency there never compounds.

Verified live against a real project with one file per tier: the two Flash-tier files completed
almost immediately while the two Pro-tier files were still processing, confirming both that they
run concurrently (§4.8's bounded concurrency, not blocked on each other) and that the routing
actually restricts the slow model to only the tiers that need it.

### 4.8 Processing / worker

- Reuses the existing fire-and-forget asyncio-task pattern (`review_worker.py`'s shape), on its
  own queue/topic, specifically so a large project can never delay single-file reviews sitting in
  the same queue behind it.
- Per project job: fan out to at most `N` files concurrently (config
  `PROJECT_REVIEW_CONCURRENCY`, default e.g. 4) via a semaphore. Each file's own analysis reuses
  `review_service.process_review`'s existing try/except-and-classify shape.
- **Retry policy**, checked before deciding a file is `FAILED`: retry up to
  `PROJECT_FILE_MAX_RETRIES` (default 2) with exponential backoff (e.g. 2s, then 5s), but **only**
  for failures classified as transient — timeout, HTTP 429, HTTP 5xx from the Gemini call. Never
  retry a failure classified as permanent for that input — validation error, unsupported language,
  or the file being over the hard token/size ceiling — since retrying those wastes a call on
  something guaranteed to fail identically again.

### 4.8.1 Manual retry (added post-v1, for failures that outlast the automatic policy above)

§4.8's automatic retry only covers one in-flight run -- it does nothing once a project has already
reached a terminal state with some files FAILED (e.g. Gemini quota exhausted for an extended
period, well past the couple of backoff attempts above). Three user-triggered actions cover that:

- `POST /api/projects/{id}/retry-files` (body `{fileIds: string[] | null}`) -- retries a specific
  set of currently-FAILED files, or every FAILED file if `fileIds` is omitted. Covers both "retry
  one file" and "retry failed files."
- `POST /api/projects/{id}/retry` -- resets **every** file back to `QUEUED` and re-enqueues. For
  the case where nothing is worth salvaging file-by-file (status is `FAILED`, meaning every file
  failed).
- `POST /api/projects/{id}/retry-summary` -- re-runs only the §4.7 aggregation + summary pass,
  touching no file. For the case every file's own analysis succeeded but the summary call itself
  failed (it degrades to `summary: null` per §4.7, which never blocks `COMPLETED`/`PARTIAL` --
  this is what lets the project reach a retryable terminal state in the first place).

All three reuse the exact same queue/worker path a fresh submission uses, rather than needing a
separate "retry worker": `project_review_worker.py`'s per-project dispatch loop was changed to only
ever process files whose status is `QUEUED` (previously: unconditionally every file in the
project). A retry action's whole job is therefore just "reset the right files back to `QUEUED`,
then re-publish the same `project_id`" -- an already-`COMPLETED` file is never re-touched just
because it happens to share a run with files being retried, and no file is ever re-uploaded: each
file's `codeStorageUri` (persisted the first time its own `put()` succeeds, before that file's
first Gemini call -- see §7) is reused as-is. The one rare edge case -- a file that failed before
its own `put()` ever succeeded, on a project whose pending-upload cache (§5.3) has since expired --
surfaces as a clear "content no longer available" failure on retry rather than silently losing
that file's content; building persistent-upfront storage to close this gap entirely would
reintroduce the exact synchronous-upload responsiveness regression `_PendingUpload` was built to
fix, for a genuinely rare case.

**New project-level status**: `PARTIAL` (some files `FAILED`, at least one `COMPLETED`), distinct
from `COMPLETED` (none failed) and `FAILED` (none succeeded). Every metric derived from files
(`overallScore`, `worstFiles`, `mostCommonIssueCategory`) was already computed only from
`COMPLETED` files (§4.5's `_aggregate`) even before this -- a `FAILED` file was never counted as a
0, so `PARTIAL` only changes the status label shown, not how the score itself is computed.

**Deliberately not built**: a `FileReviewAttempt`/`codeHash`/`projectVersion` ledger for retry
idempotency. That machinery solves "did the source change between attempts," which never applies
here -- a retry always re-reads the exact same stored `codeStorageUri`, never a new upload, so
there's no version to reconcile. The existing (previously unused) `ProjectFile.attempts` counter is
incremented on each manual retry instead, for basic visibility, rather than a full attempt-history
ledger. Likewise, `FailureReason` keeps its existing categories (`GEMINI_ERROR`,
`REVIEW_SERVICE_ERROR`, etc.) rather than fragmenting into network/timeout/rate-limit/quota-specific
values -- worth revisiting only if the UI ever needs to show different guidance per exact cause.

  **Cross-check correction:** this is genuinely new logic, not a light extension of an existing
  shape. `review_worker.py` today retries *every* failure identically — a flat 2s sleep, republish
  to Pub/Sub, no transient/permanent distinction at all — driven by message redelivery in a single
  sequential consumer loop. `review_service._classify_failure` only labels *why* a review ultimately
  failed, after retries are exhausted; it never decides whether a retry happens. The transient/
  permanent gate and the exponential backoff schedule both need to be designed and built for
  `project_review_worker.py` from scratch — scope and estimate this as new work, not reuse.
- **Cancellation**: the worker checks `ProjectReview.status` between dispatching each new file (not
  mid-file — an in-flight Gemini call is allowed to finish rather than aborted mid-request, since
  killing it wastes the call anyway without saving meaningful time). Once `status == CANCELLING`,
  it stops scheduling new files, marks any still-`QUEUED` file `SKIPPED`, and once no file is still
  `ANALYZING`, flips the parent to `CANCELLED`. A cancelled project keeps whatever files already
  completed — those results aren't discarded, matching §5.4's partial-results UX.
- After each file finishes (success, fail, or skip), `firestore_service` increments
  `filesAnalyzed` and updates that file's own doc — so `GET /api/projects/{id}` reflects live
  progress without a separate progress channel, and so partial results are simply "whatever's
  terminal so far," no special-casing needed on read.
- Once every file is terminal (or the project is cancelled), compute §4.5's aggregation, run
  §4.7's summary pass (skipped entirely if cancelled — no point summarizing an intentionally
  incomplete run), and flip the parent to its final status.
- `LOCAL_MODE` dispatch is preserved throughout: in local mode this all runs against the in-memory
  Firestore/storage stand-ins and the mock analyzer, identically to how single reviews already
  work locally.

## 5. Frontend design

### 5.1 Entry point: extend NewReviewPage, don't fork the nav

Add a segmented control at the top of the existing New Review page:

```
┌──────────────────────────────┐
│  ○ Single File   ● Project (.zip)  │
└──────────────────────────────┘
```

rather than a second top-level nav item — a project upload is still "a new review," just a
different input shape. Switching the toggle swaps the panel body between the existing single-file
form and the new project upload flow; it does not touch `ReviewButton`/`CodeEditor`/etc. for the
single-file path.

Once a `.zip` is uploaded and its manifest comes back, a small **Review mode** control (§4.4) sits
above the file tree:

```
Review mode:  [ Standard ]  [ Comprehensive ]
              tests, docs & config skipped by default   ← shown under Standard
```

This is the only new "settings" control in the flow — deliberately not a longer checklist of
toggles, per the same instinct that's kept this app's other settings minimal so far.

### 5.2 Upload & file tree

```
┌─────────────────────────────────────────────────────────┐
│  ⇪  Drop a .zip of your project, or click to browse      │
│      Max 25 MB · up to 500 files                          │
└─────────────────────────────────────────────────────────┘
  ↓ after upload finishes and the backend returns the manifest ↓
┌─────────────────────────────────────────────────────────┐
│ my-app.zip · React + FastAPI · medium project              │
│ 48 files selected · 9,110 lines · 278 KB                    │
│ 612 files auto-excluded (node_modules, .git, lockfiles) [why?] │
│ Review mode:  [ Standard ]  [ Comprehensive ]                │
├─────────────────────────────────────────────────────────┤
│ ☑ ▾ src/                                                  │
│     ☑ ▾ api/                                              │
│         ☑ 🐍 users.py         api    132 lines · 4.1 KB   │
│     ☑ ▾ auth/                                              │
│         ☑ 🐍 login.py         auth    88 lines · 2.9 KB    │
│     ☑ ▾ components/                                        │
│         ☑ 🟦 Button.tsx       source  41 lines · 1.2 KB    │
│         ☐ 🟦 Button.test.tsx  test    60 lines · 1.8 KB    │
│ ☐ 📄 README.md                docs    excluded by default  │
├─────────────────────────────────────────────────────────┤
│  [Select all]  [Deselect all]              [Review Project →] │
└─────────────────────────────────────────────────────────┘
```

- Reuses the same drag-and-drop shell styling as the existing single-file upload zone, just with
  `.zip` in `accept` and different icon/copy for this mode.
- Byte-level upload progress bar while the zip is in flight.
- The tree is generated from the backend's manifest response (path, language, tier, size,
  included/excluded + why), with checkboxes pre-set per §4.4's Standard/Comprehensive default —
  never guessed client-side, and never silently different from what the backend will actually
  accept.
- Every excluded file shows *why* (noise directory, lockfile, unsupported extension, binary
  content, too large) — never a silent drop.

### 5.3 Submit

`POST /api/projects` sends the original zip bytes again plus the user's final include/exclude
selection and chosen review mode as form fields. The backend re-runs its own filtering/tiering
regardless of what the client sends — the client's tree is a preview/convenience, never the
security boundary (§8's guards apply unconditionally, every time, server-side).

### 5.4 Progress — grouped, cancellable, and readable mid-flight

```
┌─────────────────────────────────────────────────────────┐
│  Reviewing my-app.zip                          [Cancel] │
│  ████████████████░░░░░░░░░░░░  32 / 48 files             │
│                                                            │
│  ✓ Completed   27      ⟳ Analyzing   4                    │
│  ○ Queued      16      ✕ Failed      1                    │
│                                                            │
│  [ View partial results → ]                                │
├─────────────────────────────────────────────────────────┤
│  Completed ▾                                              │
│    ✓ src/api/users.py            7.5                       │
│    ✓ src/api/auth.py             4.0                       │
│  Analyzing ▾                                               │
│    ⟳ src/components/Button.tsx   analyzing…                │
│  Failed ▾                                                  │
│    ✗ src/legacy/parser.py        Gemini timeout (retried 2×) │
└─────────────────────────────────────────────────────────┘
```

- Grouped counts up top so a 200-file project reads as four numbers, not a wall of rows; each
  group is collapsible for anyone who does want the detail.
- **"View partial results"** jumps straight to `ProjectResultPage` while still `ANALYZING` — it
  renders exactly the same as the completed dashboard, just with a "still running, 32/48" banner
  at the top and not-yet-terminal files showing a status badge instead of a score in the file
  table (§5.5). This is the direct answer to "don't make the user wait for every file."
  `ProjectProgressPage` and this partial view of `ProjectResultPage` are two routes over the same
  poll of `GET /api/projects/{id}` — there's no separate "partial" API shape to build.
- **Cancel** calls `POST /api/projects/{id}/cancel`; the button becomes "Cancelling…" until the
  project settles into `CANCELLED`, at which point the page shows whatever completed and offers
  the same "view results" link — cancelling never discards work already done (§4.8).

### 5.5 Result — score, then "what should I fix," then everything else

```
┌─────────────────────────────────────────────────────────┐
│  my-app.zip · React + FastAPI                  [Back to History] │
│  ┌───────────┐  48 files reviewed · 9,110 lines           │
│  │   6.8     │  Most common issue: Quality                │
│  │  / 10     │                                             │
│  └───────────┘                                             │
├─────────────────────────────────────────────────────────┤
│  Needs attention first                                     │
│  ⚠ src/legacy/parser.py        3.0   4 issues              │
│  ⚠ src/api/payments.py         4.5   2 issues              │
│  ⚠ src/utils/cache.py          5.0   3 issues              │
├─────────────────────────────────────────────────────────┤
│  Project summary                                            │
│  Three of four API files use parameterized queries;          │
│  src/legacy/parser.py doesn't and is the project's weakest   │
│  file overall. Error handling is inconsistent between the    │
│  auth and API layers.                                        │
├─────────────────────────────────────────────────────────┤
│  All files            [search]  [sort: score ▾]            │
│  src/api/users.py            python   7.5   1 issue    →   │
│  src/api/auth.py             python   4.0   3 issues   →   │
│  src/components/Button.tsx   tsx      9.0   0 issues   →   │
│  ...                                                        │
└─────────────────────────────────────────────────────────┘
```

The order is deliberate: score → "needs attention first" → project summary → the full file table
— because "what should I fix" is what a user opening this page actually wants first, ahead of any
chart or the exhaustive list. Charts (a category breakdown, reusing `CategoryPieChart`/
`DistributionBar` from the single-review dashboard work) belong below the file table for anyone
who wants them, not above the actionable items.

- The aggregate score card reuses `ScoreCard` as-is.
- Clicking any file row navigates to a per-file result view bound to that `ProjectFile`, fetched via
  `GET /api/projects/{id}/files/{fileId}`. The tabs, `IssueList`, and the suggested-fix
  preview/apply flow are shared with `ReviewResultPage` unmodified — see the correction below for
  how that sharing is actually structured.
  A `truncated` file (§4.6) shows its `truncatedNote` as a banner at the top of that view, the same
  visual slot the resubmission banner already uses on a normal review.
  "Edit Code"/"Apply Fix" on a project file's issue navigates to the single-file New Review flow
  pre-filled with that one file's patched code — fixing one file becomes an ordinary single-file
  review from that point on.

  **Cross-check correction:** "extend `ReviewResultPage` to also accept a `ProjectFile`, everything
  below works unmodified" undersells the actual change. The component today hardcodes
  `useParams<{reviewId}>()` + `getReview(reviewId)`, has a `useEffect` that redirects to
  `/reviews/{id}/progress` on any non-`COMPLETED` status (no equivalent route makes sense for one
  file inside an already-`ANALYZING` project), and renders `Review`-only fields — `isResubmission`,
  `comparison`, `secretsDetected` — that have no counterpart in `ProjectFile`'s schema (§4.2).
  Swapping the fetch call alone doesn't work. Two real options, to be decided before
  implementation rather than during it:
  1. Extract a presentational `ReviewResultView` component (tabs, `ScoreCard`, `IssueList`, the
     fix flow — everything that only reads `GeminiAnalysis` + `code` + `language`) that both
     `ReviewResultPage` and the new project-file view render, each doing its own data-fetching and
     Review-only chrome (resubmission banner, comparison card, redirect-while-pending) around it.
  2. Keep one component and add real conditional branches for every Review-only feature, gated on
     which kind of record was fetched.
  (1) keeps `ReviewResultPage` unchanged and matches this doc's general instinct (§1) not to force
  genuinely different things into one component — recommended, but noted here as a decision, not
  assumed.

### 5.6 History

Project reviews get their own row type in History, visually distinct (a folder/archive icon
instead of a language badge, "42 files" instead of a language name). Simplest v1: a small
segmented control at the top of History — "Reviews" / "Projects" — reusing the page's existing
search/sort/pagination shell.

## 6. Suggested-fix flow on project files

Unchanged from the original design: the existing "preview before apply" fix flow applies per-issue
on a known `code`/`line`/`endLine` exactly as it does for a single review. "Apply" lands on a
fresh single-file New Review pre-filled with the patched content — the fix-and-recheck loop is
inherently per-file, not per-project, so it re-enters the ordinary single-file flow rather than
needing a project-aware version of itself.

## 7. Storage architecture — Firestore for metadata, object storage for code

Firestore is not a great fit for potentially dozens of multi-KB code blobs per project on top of
its existing per-document size limits and read-cost model. Split by kind of data:

- **Firestore** (`users/{userId}/projectReviews/{projectId}` + its `files` subcollection):
  everything in §4.2's schema *except* the code itself — status, scores, issues, the profile,
  progress counters, the summary. This is what every list/poll/dashboard read touches, and it
  stays small regardless of project size.
- **Object storage** for the actual code text: `code_storage_service.py`, a new module following
  the exact same `ponytail:`-marked dispatch pattern every other service here already uses —
  `LOCAL_MODE=true` keeps an in-memory `{storageUri: text}` dict (same shape/lifetime as
  `firestore_service`'s local stand-in), `LOCAL_MODE=false` calls real
  `google-cloud-storage`. This isn't a new GCP service for this project: Phase 10 already uses
  Cloud Storage for the historical-rules bucket (`historical_bucket`), so this reuses the same
  client library, credentials, and bucket, just a different prefix
  (`gs://{historical_bucket}/{userId}/{projectId}/files/{fileId}.txt`) written to at runtime
  instead of only by the offline ingestion script.
- `ProjectFile.codeStorageUri` and `ProjectReview.zipStorageUri` are the only pointers Firestore
  holds; `GET /api/projects/{id}/files/{fileId}` is the only place `code_storage_service.get()` is
  called to hydrate the actual text, on demand, only for the one file being viewed.
- This deliberately does **not** change how a single `Review`'s `code` is stored (still inline in
  Firestore, per Phase 7's existing, already-flagged-for-revisit design) — that's a separate,
  smaller-scale concern the existing code explicitly notes as "revisit before a real deployment."
  Project review is large enough by nature (many files, potentially large projects) that it's
  worth doing the more scalable thing from day one instead of inheriting the same TODO.

## 8. Security — archive-handling guards (the part PLAN.md explicitly called out)

All of this lives in one new module, `zip_extraction.py`, so it's the single reviewable surface
for "how does this app handle untrusted zip bytes" — mirroring how `security/validation.py` is
already the one place single-file input gets checked.

- **No disk writes, ever.** Read the upload into memory (`io.BytesIO`), open it with
  `zipfile.ZipFile`, and read each wanted entry's bytes directly (`ZipFile.read(name)`) into a
  string — never `extractall()`/`extract()` to a real path. This sidesteps zip-slip/path-traversal
  and symlink-following risks almost entirely, because nothing is ever written to a filesystem
  path derived from an untrusted entry name.
- **Path validation regardless** (defense in depth, since the *displayed* path still comes from
  the archive and is untrusted text): reject any entry whose name contains `..`, starts with `/`
  or a drive letter, or normalizes outside the archive root.
- **Zip bomb guards**, checked from each entry's `ZipInfo` metadata *before* reading its bytes:
  per-file uncompressed size cap (e.g. 2 MB), a compression-ratio cap, a total uncompressed size
  cap across the whole archive (e.g. 25–50 MB), and a total raw entry-count cap (e.g. 2,000,
  checked before any noise-directory filtering, so a zip crafted with millions of tiny entries is
  rejected immediately rather than iterated).
- **No nested archives** — an entry whose name ends in `.zip`/`.tar`/`.gz`/etc. is skipped (logged
  as excluded, "nested archive"), never recursively opened.
- **Binary detection**: the same null-byte check `validate_code` already applies, plus an
  extension allowlist mirroring `languageDetect.ts`'s `EXTENSION_MAP` — anything else (images,
  compiled binaries, fonts, `.pyc`, `.class`, `.exe`, `.so`, `.dll`) is excluded before it's even
  offered in the file tree.
- **Noise/generated-file exclusion**: `node_modules/`, `.git/`, `__pycache__/`, `.venv/`, `venv/`,
  `dist/`, `build/`, `.next/`, `target/`, `vendor/`, `.pytest_cache/`, `*.egg-info/`, plus lockfiles
  (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `poetry.lock`, `Cargo.lock`)
  and other clearly-generated artifacts — excluded outright, not just defaulted off like §4.4's
  `test`/`docs`/`config` tiers, since there's no scenario where reviewing a lockfile is useful.
- **Request-size ceiling at the API layer**, before any of the above even runs — a new
  `max_zip_bytes` setting for this endpoint.

  **Cross-check correction:** the earlier wording ("distinct from and larger than the existing
  `max_request_bytes` used for JSON review submissions") implied `max_request_bytes` is already
  enforced somewhere. It isn't — `backend/app/config.py` declares it, but nothing in the backend
  actually reads it to reject an oversized request; there's no middleware or body-size check
  anywhere in `main.py` or the review endpoints. `max_zip_bytes` needs real enforcement built for
  this endpoint from scratch, and separately, `max_request_bytes` going unenforced today is worth
  its own fix regardless of this feature — flagging it here since this plan is what surfaced it.
- **Never execute, import, compile-and-run, or shell out on any extracted content** — every file
  is read as text and handed to Gemini as a prompt, exactly like today's single-file flow.
- **Ownership/isolation** unchanged: every `ProjectReview`/`ProjectFile` read is scoped to
  `get_current_user_id()`. Object storage paths (§7) are namespaced by `userId` the same way
  Firestore documents are, and are never served through a public/anonymous URL — only through the
  authenticated `GET /api/projects/{id}/files/{fileId}` route, which fetches server-side and
  returns JSON, not a redirect to a storage URL a token could leak.
- Everything above needs to be true **before** a single Gemini call happens for any file in the
  archive — validation is a gate, not a filter applied alongside processing.

## 9. Testing plan

Mirrors the existing `tests/test_review_flow.py`/`tests/test_code_validation.py` style —
`LOCAL_MODE=true`, no real GCP calls needed to verify the logic.

- `zip_extraction.py`: path traversal / zip-slip rejected, oversized single entry rejected, absurd
  compression ratio rejected, total-size cap rejected, entry-count cap rejected, nested `.zip`
  entry skipped, binary file excluded, noise directories and lockfiles excluded, a normal small
  valid project accepted with the expected included/excluded lists.
- `project_detector.py`: each supported manifest type is correctly identified; an archive with no
  recognized manifest degrades to `"Unknown"` without erroring; a project with multiple manifests
  (e.g. a monorepo with both `package.json` and `requirements.txt`) reports both languages.
- `file_prioritizer.py`: each tier's heuristic matches its intended examples and doesn't
  false-positive on ordinary source files; Standard vs Comprehensive mode produce the expected
  default-checked sets; lockfiles never reach tiering at all (already excluded upstream).
- `project_review_service.py`: mixed outcomes (some succeed, one fails after exhausting retries)
  roll up correctly with the failed file excluded from `overallScore`; a project where every file
  fails rolls up to `FAILED`; `filesAnalyzed` increments correctly; the concurrency cap is
  respected (assert no more than N in-flight via a mock tracking a high-water-mark); a transient
  failure (mocked timeout) is retried up to the configured max with backoff and eventually
  succeeds or gives up correctly; a permanent failure (mocked validation error) is never retried;
  cancelling mid-run stops new scheduling, lets in-flight files finish, preserves their results,
  and settles the project to `CANCELLED`; a file over the line/token budget is reviewed truncated
  with `truncated=true` and a specific note, never silently.
- API tests: `POST /api/projects` 400s with a specific message per guard violation, 422s when
  filtering leaves zero files, `POST /api/projects/{id}/cancel` transitions state correctly,
  ownership enforced on every project/file read (cross-user 404, matching
  `test_cross_user_review_is_not_found`'s existing pattern), `GET /api/projects/{id}` returns a
  coherent partial view while `ANALYZING`.
- Frontend: `ProjectFileTree` renders the manifest with correct tier-based default checkboxes,
  toggling updates the selected-count summary; the progress page's grouped counts and "view
  partial results" link work against a mocked in-flight project; a project file's Overview/
  Issues/Code tabs render via the same `ReviewResultPage` path a single review already has
  coverage for; a `truncated` file shows its banner.

## 10. Explicitly out of scope for v1

Narrower than the previous revision of this plan, now that project-type detection, prioritization,
token budgeting, retry/backoff, partial results, cancellation, and a lightweight summary pass are
in scope (§4.3–§4.8). Still deferred:

- A single combined-prompt cross-file analysis over **full source** (as opposed to §4.7's
  metadata-only summary pass) — circular imports, literal duplicated logic across files. Token
  budget for anything but a small project makes "send everything to Gemini in one call"
  impractical; §4.7's cheaper approximation ships instead.
- Importing directly from a GitHub/GitLab repo URL instead of a local zip upload.
- Incremental re-review of a project (diff against a previous zip, only re-analyze changed files)
  — v1 always does a full fresh analysis of every included file.
- Line-weighted (importance-weighted) score aggregation (§4.5's fast-follow note) — ship simple
  mean-over-eligible-files first.
- A "compare this project review to the previous one" feature analogous to single-review
  comparison (Phase 12) — needs its own design for what "the same project" means across two
  different zip uploads.
- Per-file suggested-fix "apply directly back into the project" (re-zipping and downloading a
  patched archive) — v1's fix flow lands you back in the ordinary single-file New Review page with
  that one file's patched content, per §6.
- A two-model "cheap model for trivial files, strong model for critical files" split — worth
  revisiting if per-project Gemini cost becomes a real constraint, but adds a second prompt/model
  path to maintain for a saving that §4.4's prioritization (fewer files sent at all, by default)
  already captures a good chunk of.
