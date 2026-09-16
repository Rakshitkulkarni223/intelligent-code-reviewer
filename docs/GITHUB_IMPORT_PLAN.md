# GitHub Import for Project Review -- Plan

Status: **implemented**. Sections below are the original plan; see
"Implementation notes" at the end for where the shipped version deviated
from it and why.

## 1. Scope

Add a third way to get a project into Project Review, alongside the existing
zip/folder/loose-file upload: import directly from a GitHub repository the
user connects via OAuth. The end state (a `ProjectManifest` with an
`uploadToken`, then the existing file-selection screen, then
`create_project_review`) is identical to today's upload flow -- GitHub import
only replaces *how the zip bytes are obtained*, not anything downstream of
that.

## 2. Information architecture

```
New Code Review
├── Code Review          (unchanged -- single-file editor/upload)
└── Project Review
    ├── Upload Project    (existing -- zip / folder / loose files)
    └── Import from GitHub (new)
```

"Upload Project" and "Import from GitHub" become a second-level control
inside the Project Review tab (reuse the existing `.tab-bar`/`.tab-button` or
`.segmented` styling, whichever this second-level nesting reads better with
visually -- not a new top-level tab, per your IA note).

## 3. UI states (Import from GitHub sub-tab)

1. **Not connected**: a `.card` with a short explanation + "Connect GitHub"
   button (`.btn-primary`).
2. **Connecting**: clicking "Connect GitHub" opens GitHub's OAuth consent
   screen in the same tab (full redirect, not a popup -- simpler, no
   popup-blocker edge cases). On return, the page shows a brief
   "Connecting…" spinner state while it re-checks connection status.
3. **Connected, selecting repo**: two `SelectMenu` dropdowns (the component
   already used elsewhere in this app) -- **Repository** (populated from the
   user's repos) and **Branch** (populated once a repo is chosen, defaulted
   to that repo's default branch). "Load Repository" (`.btn-primary`)
   enabled only once both are chosen.
4. **Loading**: spinner while the backend resolves the branch's HEAD commit,
   checks repo size, and downloads+extracts the zipball.
5. **Confirmation preview**: repo, branch, resolved short commit SHA, file
   count -- then **reuses the existing file-selection/manifest screen**
   (tier checkboxes, excluded-entries list, review-mode picker) that zip
   upload already shows, with the header swapped from "yourfile.zip" to
   "`owner/repo` @ `branch` (`a1b2c3d`)". This is a deliberate deviation from
   the wireframe's "straight to Start Project Review" -- going through the
   same selection screen means zero new selection UI to build, and the user
   still gets to exclude files exactly like today. Flagging this as a
   decision to confirm, not something already agreed.
6. **Error states to design for**: OAuth denied/cancelled; token
   expired/revoked (GitHub API 401 → prompt reconnect); repo has no
   branches; empty repo; repo exceeds size limit; GitHub rate-limited (403 +
   `X-RateLimit-Remaining: 0`); network failure mid-download.
7. **Disconnect**: a "Disconnect GitHub" action, most naturally on the
   Settings page (not designed yet -- Settings currently has nothing
   integration-related), revokes the stored token.

## 4. Architecture

### 4.1 OAuth: GitHub OAuth App, not a GitHub App

A classic **OAuth App** is enough for this feature and much simpler than a
GitHub App (no installation/permission-picker flow on GitHub's side, no
webhook infrastructure) -- it matches the wireframe's "connect once, then
pick from a dropdown of all your repos" model directly. A GitHub App's
per-repo installation picker would change the UX (repos come from "which
repos did you install the app on," not a live dropdown of everything the
account can see) -- worth revisiting later if fine-grained per-repo access
control ever matters, but not needed for this scope.

Scope requested: `repo` (needed for private repos; public repos work with no
scope at all, but requesting `repo` up front avoids a second, confusing
re-auth later if the user picks a private one).

### 4.2 New backend endpoints (`app/api/github.py`, new router)

- `GET /api/github/oauth/start` -- redirects to GitHub's authorize URL. The
  CSRF `state` param is a signed token embedding `user_id` + expiry (see
  4.3), so the callback (which GitHub calls directly, with no
  `Authorization` header available) can still identify which app-user to
  attach the resulting token to.
- `GET /api/github/oauth/callback` -- exchanges `code` for an access token,
  verifies `state`, stores the token (4.4), redirects back to
  `/new-review?github=connected`.
- `GET /api/github/status` -- `{connected: bool, githubUsername?: string}`.
- `GET /api/github/repos` -- lists the connected account's repos (GitHub
  `GET /user/repos`, paginated, sorted by `updated`).
- `GET /api/github/repos/{owner}/{repo}/branches` -- lists branches
  (default branch first).
- `POST /api/github/import` -- body `{owner, repo, branch}`. Resolves the
  branch's HEAD commit SHA, checks the repo's reported size against
  `max_zip_bytes` *before* downloading, downloads the zipball
  (`GET /repos/{owner}/{repo}/zipball/{sha}`, using the stored token), then
  calls the **existing** `project_review_service.preview_project(user_id,
  filename, data)` unchanged -- returns the same `ProjectManifest` shape zip
  upload returns, plus `{repoFullName, branch, commitSha}` for the
  confirmation header.
- `DELETE /api/github/disconnect` -- deletes the stored token.

### 4.3 CSRF state storage

An in-process TTL dict (`{state: (user_id, expiry)}`), matching this
codebase's existing pragmatic in-process patterns (the `asyncio.Queue`-based
review/project queues, the dev-stub bearer-token auth). Good enough for a
single backend instance; would need to move to Firestore or Redis if this
backend ever runs multiple instances behind a load balancer -- noting that
now so it isn't a surprise later, not proposing to build it now.

### 4.4 Token storage

New Firestore doc `users/{uid}/integrations/github` with fields
`{accessToken, githubUsername, connectedAt}`. Never returned in any API
response (only `/api/github/status`'s derived boolean + username), never
logged. Stored as plaintext in Firestore for now, matching this project's
current security posture for its other secret (the GCP service-account key
lives in `.env`, gitignored, single-project scope) -- flagging plaintext
token storage as something to revisit (e.g. KMS envelope encryption) before
this is anything other than a personal/demo project.

### 4.5 Reusing the existing pipeline (the key architectural point)

`preview_project(user_id, filename, data)` already takes arbitrary zip bytes
and a filename and returns a `ProjectManifest` -- it doesn't care where the
bytes came from. GitHub import's entire backend job is: *turn a
(owner, repo, branch) into zip bytes*, then hand them to code that already
exists and is already tested. Nothing in `zip_extraction.py`,
`file_prioritizer.py`, `project_detector.py`, `create_project_review`, or the
worker changes.

One real adaptation needed: a GitHub zipball wraps every file under a single
top-level `{repo}-{sha}/` directory (e.g. `myrepo-a1b2c3d/src/index.js`).
`zip_extraction.py` currently has no "strip the common leading directory"
step, so paths would display with that ugly prefix and tier/pattern matching
that happens to key off full paths (rather than basenames) could behave
oddly. Plan: detect a single common top-level directory across all entries
and strip it before the existing extraction logic runs -- a small, isolated
change in `zip_extraction.py`, not a new code path.

### 4.6 Repo size pre-check

GitHub's `GET /repos/{owner}/{repo}` response includes a `size` field (KB,
approximate on-disk size of the repo). Check this against `max_zip_bytes`
*before* downloading the zipball, so an oversized repo fails fast with a
clear error instead of downloading tens of MB just to reject it after the
fact. The downloaded zipball still goes through every existing
`zip_extraction.py` guard (entry count, per-entry size, total uncompressed
size, compression ratio, path traversal) regardless -- this pre-check is
purely a fast-fail UX improvement, not a replacement for those guards.

### 4.7 Config additions (`app/config.py`, `.env`)

`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI` --
same pattern as every other env-backed setting already in `config.py`.
**Must** go in `.env` (gitignored) exactly like the existing GCP key and
Gemini settings -- never committed.

### 4.8 Data model additions

`ProjectManifest` and `ProjectReview`/`ProjectReviewSummary` gain optional
`source: 'upload' | 'github'` and, when `'github'`,
`{repoFullName, branch, commitSha}` -- purely for display (History/Dashboard
cards can show "from GitHub: owner/repo @ a1b2c3d" instead of a filename).
No behavior depends on this field.

## 5. Security considerations

- OAuth `state` param is mandatory and verified (CSRF protection on the
  callback).
- Token never leaves the backend -- not in any JSON response, not logged.
- Callback route is the one GitHub-facing endpoint with no `Authorization`
  header; user identity comes only from the verified signed `state`, never
  from anything else in the request.
- Rate limits: GitHub's 5,000 req/hr (authenticated) is far more than this
  feature needs per import (repo list, branch list, one commit lookup, one
  zipball download) -- no special handling needed beyond surfacing a 403
  rate-limit error to the user if it ever happens.
- Revoking access: **implemented**. "Disconnect GitHub" calls
  `DELETE /applications/{client_id}/grant` (revokes the whole grant, not
  just one token) before deleting the stored token locally, best-effort
  (a failure there never blocks the local disconnect). This matters beyond
  hygiene: without it, GitHub still considered the app pre-authorized for
  that account, so reconnecting while the browser had an active GitHub
  session silently re-issued a token with no consent screen at all -- no
  "not you? sign in as a different user" option, since that only appears on
  GitHub's own consent screen, which a still-valid grant skips entirely.
  Revoking forces that screen to reappear on the next connect. This still
  can't force a browser-level account switch on its own -- if the user
  wants a genuinely different GitHub account and their browser is still
  logged into the old one on github.com, they still need to use that
  "sign in as a different user" link (or log out of GitHub separately)
  once the consent screen reappears; nothing server-side can do that for
  them.

## 6. Open decisions to confirm before implementing

1. Confirm the file-selection screen is reused as-is after GitHub import
   (section 3, state 5) rather than building the wireframe's more minimal
   "confirm → start" flow.
2. Where does "Disconnect GitHub" live -- Settings page (needs a new
   section there) or inline on the Import from GitHub sub-tab itself?
3. Redirect-based OAuth (full page navigation, simpler) vs. popup-based
   (stays on the New Review page, more setup) -- plan assumes redirect.
4. Should public repos be importable without connecting an account at all
   (GitHub allows anonymous zipball download for public repos)? Plan
   currently always requires connecting, for one consistent flow.

## 7. Testing plan (once implemented)

- Unit tests for the new `zip_extraction.py` common-prefix-stripping logic
  (mirrors the existing test style in `test_zip_extraction.py`).
- Unit tests for the OAuth `state` sign/verify round-trip and expiry.
- Integration test mocking GitHub's API responses (repos, branches, commit,
  zipball) to verify `/api/github/import` produces the same
  `ProjectManifest` shape as the existing zip-upload preview test fixtures.
- No changes needed to existing worker/finalization tests -- confirms the
  "only the input path changes" design actually holds.

## 8. Implementation notes (deviations from the plan above)

- **No `source`/`repoFullName`/`branch`/`commitSha` fields were added to
  `ProjectManifest`/`ProjectReview`** (section 4.8). Instead, the import
  endpoint passes `preview_project` a synthetic filename --
  `"{owner}/{repo} @ {sha[:7]}"` -- which already displays correctly
  everywhere `originalFilename` shows up (History, Dashboard, the summary
  card), with zero schema/persistence changes. `/api/github/import`'s
  response still carries the structured `repoFullName`/`branch`/`commitSha`
  separately, purely for the one-time confirmation banner shown right after
  import (`GithubImportPanel`) -- nothing else needs them.
- **The common-top-level-directory stripping (section 4.5) is opt-in, not
  automatic.** The first version made it unconditional in
  `extract_project()`, which broke an existing test: a project where every
  reviewable file legitimately lives under one shared directory (as trivial
  as a single `src/main.py`) is indistinguishable, from inside the zip
  alone, from an artifact wrapper folder. `extract_project()` and
  `preview_project()` both gained a `strip_common_root: bool = False`
  parameter, and only the GitHub import call site passes `True` -- it alone
  knows for certain the archive is a GitHub zipball.
- **The OAuth start endpoint returns JSON, not a redirect** (a plan
  omission, not a deviation from an explicit decision): `GET
  /api/github/oauth/start` requires the `Authorization` header this app's
  dev-stub auth depends on, but a plain top-level browser navigation to
  GitHub's consent screen can't carry a custom header. It returns
  `{"url": "..."}` from an authenticated `fetch`, and the frontend performs
  the actual `window.location` redirect itself.
- **Reused the existing file-selection screen** (open decision #1) --
  extracted the post-manifest half of `ProjectUploadPanel` into a new
  `ProjectManifestReview` component, parameterized by `onBack`/`backLabel`,
  shared unchanged between zip upload and GitHub import.
- **"Disconnect GitHub" lives on the Settings page** (open decision #2), as
  a small "Integrations" card.
- Open decisions #3 (redirect vs. popup) and #4 (anonymous public-repo
  import) were resolved as: redirect-based OAuth, and always require
  connecting an account (simpler, one consistent flow) -- matching the
  plan's original assumptions.
- **Not yet exercised against a real GitHub account**: this requires a
  registered GitHub OAuth App and three env vars this session cannot
  create -- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `GITHUB_OAUTH_REDIRECT_URI` (e.g.
  `http://localhost:8000/api/github/oauth/callback` for local dev,
  registered at github.com/settings/developers). Everything up to that
  boundary is tested: 12 new backend tests (OAuth state signing/tampering/
  expiry, connect/disconnect, repo/branch/import with GitHub's API mocked,
  the oversized-repo fast-fail), plus live Playwright runs of the real
  (unconfigured) "Connect GitHub" error path and a fully mocked
  connected -> repo -> branch -> import -> file-selection flow.
