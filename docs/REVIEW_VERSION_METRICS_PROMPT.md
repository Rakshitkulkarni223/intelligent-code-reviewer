# Review Re-Submission, Code Versioning & Metrics Implementation Prompt

## Objective

Implement a robust review re-submission, code-version comparison, failure handling, and metrics system in the Intelligent Code Reviewer application.

The system must distinguish between:

1. A completely new code submission
2. A changed version of previously reviewed code
3. The exact same code being submitted again
4. A failed review attempt
5. A successful review
6. A retry of a previously failed review

The goal is to prevent duplicate submissions from artificially changing user metrics while allowing users to retry genuinely failed reviews and track improvement when code changes.

---

# 1. Inspect the Existing Application First

Before making any changes:

- Inspect the complete repository structure.
- Identify the existing:
  - React editor
  - Review Code button
  - Review API
  - FastAPI routes
  - Gemini/Vertex AI review service
  - Firestore models/collections
  - Review result schema
  - History page
  - Dashboard metrics
  - Authentication/user ID handling
  - Loading/error states
- Reuse existing architecture and conventions.
- Do not create duplicate services or APIs.
- Do not break existing review functionality.
- Do not remove existing review history.

First explain:
- Which files need to change
- Which files need to be added
- How the new flow will integrate with the existing implementation

Then implement the feature.

---

# 2. Core Product Rule

The most important rule is:

```text
FAILED + SAME CODE
    → Retry is allowed if the previous attempt did not produce a score

SUCCESS + SAME CODE
    → Do NOT call Gemini again

ANY PREVIOUS RESULT + CHANGED CODE
    → Create a new code version and review it

SUCCESSFUL NEW REVIEW
    → Compare with the previous successful version

FAILED REVIEW
    → Do not create/update score metrics

SYNTAX VALIDATION FAILURE
    → User must fix the code before AI review

COMPILE/RUNTIME FAILURE
    → AI review may still proceed
```

# 3. Code Hashing

Every submitted code must receive a deterministic hash.

Use SHA-256 or the existing secure hashing utility if the project already has one.

Normalize only what is appropriate.

Do NOT arbitrarily modify the user's code before hashing.

Recommended:

```text
normalizedCode + language
        ↓
SHA-256
        ↓
codeHash
```

The language must be included.

For example:

```text
python + code
javascript + code
```

must not accidentally produce the same logical identity.

Store:

```json
{
  "codeHash": "sha256...",
  "language": "python"
}
```

# 4. Why Language Must Be Part of the Hash

The following should be treated as different submissions:

```text
Language: Python
Code:
print("hello")
```

and:

```text
Language: JavaScript
Code:
print("hello")
```

Therefore use:

```text
hash(language + normalizedCode)
```

rather than hashing only the source code.

# 5. Review Attempt vs Successful Review

Separate the concepts of:

## Review Attempt

Every actual review request initiated by the user.

Example:

```text
Attempt 1 → SUCCESS
Attempt 2 → FAILED
Attempt 3 → SUCCESS
```

## Successful Review

Only a completed review that produced a valid score.

Example:

```text
Successful reviews = 2
```

Do not count failed attempts as scored reviews.

# 6. Review Status

Use explicit statuses.

Recommended:

```text
IDLE
VALIDATING
INVALID
VALID
VALIDATION_UNAVAILABLE
REVIEWING
SUCCESS
FAILED
```

For failure, store a reason:

```text
SYNTAX_ERROR
VALIDATION_ERROR
COMPILE_ERROR
RUNTIME_ERROR
REVIEW_SERVICE_ERROR
GEMINI_ERROR
TIMEOUT
INTERNAL_ERROR
UNKNOWN_ERROR
```

Adapt these to the existing application if equivalent enums already exist.

# 7. Successful First Review

Example:

```python
def add(a, b):
    return a + b
```

Review:

```text
Status: SUCCESS
Score: 7
```

Create:

```text
Version 1
Code Hash: ABC
Score: 7
Status: SUCCESS
```

Metrics:

```text
Reviews: 1
Average: 7
Latest Score: 7
Best Score: 7
Improvement: 0
```

# 8. Same Code After Successful Review

Suppose the user clicks:

```text
Review Code
```

again without changing the code.

Hash:

```text
Previous hash == Current hash
```

Do NOT call Gemini.

Do NOT create another scored review.

Do NOT modify:

```text
Reviews
Average
Latest Score
Best Score
Improvement
```

Show a useful message:

```text
This code hasn't changed since your last review.
```

Provide:

```text
[View Previous Review]
[Edit Code]
```

Optionally:

```text
[Review Again]
```

should not be shown for an unchanged successful review unless there is a deliberate force-refresh feature.

# 9. Failed Review With Same Code

This is an important exception.

Suppose:

```text
Code Hash: ABC
Status: FAILED
Failure Reason: REVIEW_SERVICE_ERROR
Score: null
```

The user clicks:

```text
Retry Review
```

The code is unchanged:

```text
ABC == ABC
```

ALLOW the retry.

Why?

Because the previous attempt did not produce a valid review result.

If the retry succeeds:

```text
Status: SUCCESS
Score: 8
```

Then this becomes a successful review and should be included in metrics.

Do NOT treat the failed attempt as a scored review.

# 10. Failed Syntax Validation

Example:

```python
def
```

Validation result:

```text
Status: INVALID
Reason: SYNTAX_ERROR
Score: null
```

Do NOT send this code to Gemini.

Do NOT create a successful review.

Show:

```text
Syntax error: the function definition is incomplete.
Please fix the code before requesting an AI review.
```

Button:

```text
[Edit Code]
```

The user should not be able to request an AI review until the code becomes valid.

# 11. Failed Compile / Run

A compile or runtime failure is NOT automatically an AI review failure.

Example:

```python
def divide(a, b):
    return a / b

print(divide(10, 0))
```

Compile/syntax validation:

```text
PASS
```

Runtime:

```text
FAILED
ZeroDivisionError
```

The user should still be allowed to click:

```text
Review Code
```

because runtime errors are valuable information for the AI reviewer.

The review can identify the problem.

# 12. Failed Gemini / Review Service

If:

```text
Gemini API fails
Backend timeout
Vertex AI unavailable
Network failure
Internal review error
```

store:

```json
{
  "status": "FAILED",
  "score": null,
  "failureReason": "REVIEW_SERVICE_ERROR"
}
```

Do NOT:

```text
set score to 0
include it in average
update best score
update improvement
count it as a successful review
```

Allow:

```text
[Retry Review]
[Edit Code]
```

# 13. Changed Code After Successful Review

Previous:

```python
def add(a, b):
    return a + b
```

Version 1:

```text
Hash: ABC
Score: 6
```

User changes code:

```python
def add_numbers(a, b):
    return a + b
```

New hash:

```text
XYZ
```

Because:

```text
ABC != XYZ
```

create:

```text
Version 2
Previous Version: Version 1
Previous Review ID: review_123
Code Hash: XYZ
```

Run a new review.

# 14. Compare New Review With Previous Successful Review

After the new review succeeds, compare:

```text
Previous successful version
        ↓
Current successful version
```

Compare:

## Score

```text
Previous: 6
Current: 8

Improvement: +2
```

## Issues

Compare:

```text
resolved issues
remaining issues
new issues
severity changes
category changes
```

Example:

```text
Previous:
3 issues

Current:
1 issue

Resolved: 2
Remaining: 1
New: 0
```

# 15. Score Decrease

Previous:

```text
9
```

New:

```text
6
```

Calculate:

```text
Improvement = -3
```

Do NOT clamp to zero.

Display:

```text
Improvement
-3.0
```

Also identify why possible issues increased.

# 16. Score Unchanged

Previous:

```text
7
```

New:

```text
7
```

Display:

```text
Improvement
0.0
```

Still compare individual issues.

For example:

```text
Security issue resolved
Performance issue introduced
Correctness unchanged
```

A score of 7 → 7 does NOT mean no code-level changes occurred.

# 17. Score Increased

Previous:

```text
6
```

Current:

```text
9
```

Display:

```text
Improvement
+3.0
```

Also show:

```text
Issues Resolved: 3
New Issues: 0
Remaining Issues: 1
```

# 18. New Score Is Better But New Critical Issue Appears

Do not rely only on score.

Example:

```text
Previous Score: 6
Current Score: 8
```

But current code introduces:

```text
CRITICAL security vulnerability
```

Show:

```text
Score Improvement: +2

⚠ New Critical Issue
SQL injection vulnerability detected.
```

Issue comparison must remain visible even when the overall score improves.

# 19. Previous Review Failed, New Code Changes

Example:

```text
Version 1
Status: FAILED
Score: null
Hash: ABC
```

User changes code:

```text
Hash: XYZ
```

New submission:

```text
Version 2
Hash: XYZ
```

Review the new code.

If successful:

```text
Version 2
Status: SUCCESS
Score: 8
```

Do not calculate improvement against a failed review because there is no valid previous score.

For the first successful score:

```text
Reviews: 1
Average: 8
Latest: 8
Best: 8
Improvement: 0
```

# 20. Previous Successful Review, New Review Fails

Example:

```text
Version 1
Score: 7
Status: SUCCESS
```

User changes code.

```text
Version 2
Status: FAILED
Score: null
```

Do NOT overwrite the previous score.

Metrics remain:

```text
Latest Successful Score: 7
Best Score: 7
Average: 7
```

History should still show:

```text
Version 2
Status: FAILED
Reason: REVIEW_SERVICE_ERROR
```

Clearly distinguish:

```text
Current Attempt: Failed
Latest Successful Score: 7
```

# 21. Metrics Rules

Implement metrics using only successful scored reviews.

## Reviews

Number of successful reviews that produced a score.

Do NOT count:

```text
syntax validation failures
Gemini failures
backend failures
compile-only attempts
runtime-only attempts
unchanged successful resubmissions
```

## Overall Average

Calculate:

```text
sum(successful review scores)
/
number of successful reviews
```

Example:

```text
Scores:
6, 7, 8, 5, 9

Average:
7.0
```

Never include:

```text
null
failed
```

Do not use 0 as a substitute for failed reviews.

## Latest Score

The score from the most recent successful review.

If the most recent attempt failed:

```text
Latest Score = previous successful score
```

But UI should clearly indicate:

```text
Current Review: Failed
Latest Successful Score: 7
```

## Best Score

Maximum score among successful reviews.

Example:

```text
6, 8, 7, 9, 5

Best = 9
```

A failed review must never change the best score.

## Improvement

For the user's overall progress:

```text
Latest Successful Score - First Successful Review Score
```

Example:

```text
First successful review = 6
Latest successful review = 9

Improvement = +3
```

Do not use failed reviews in this calculation.

# 22. Code Versions

Maintain a separate concept from review attempts.

Example:

```text
Version 1 → code hash ABC → score 6
Version 2 → code hash XYZ → score 8
Version 3 → code hash DEF → FAILED
Version 4 → code hash GHI → score 9
```

Then:

```text
Code Versions = 4
Successful Reviews = 3
Review Attempts = 4
```

If the user submits Version 2 again without changes:

```text
Hash XYZ already exists
```

Do not create another code version.

# 23. Deduplication Rules

Same code means:

```text
same normalized code
+
same language
```

If both match:

```text
same code version
```

Do not create another version.

If either changes:

```text
new version
```

Example:

```text
Python + ABC → Version 1
Python + ABC → Same version

Python + XYZ → Version 2

JavaScript + ABC → New version
```

# 24. Review History

History should show both successful and failed attempts.

Example:

```text
Review History

Version 4
Python
Score: 9
Status: SUCCESS
Improvement: +2
Issues Resolved: 3
2 minutes ago

Version 3
Python
Status: FAILED
Reason: Gemini timeout
5 minutes ago

Version 2
Python
Score: 7
Status: SUCCESS
10 minutes ago

Version 1
Python
Score: 5
Status: SUCCESS
15 minutes ago
```

Do not hide failed attempts.

They are useful for debugging and user transparency.

# 25. Review Result UI

For successful review:

```text
┌─────────────────────────────────┐
│ Review Complete                 │
│                                 │
│ Score              9 / 10       │
│ Status             ✓ Success    │
│ Improvement        +2.0         │
│                                 │
│ Issues Resolved      3           │
│ New Issues          0           │
│ Remaining Issues    1           │
│                                 │
│ [Edit Code] [Review Again]      │
└─────────────────────────────────┘
```

For failed review:

```text
┌─────────────────────────────────┐
│ Review Failed                   │
│                                 │
│ We couldn't complete the review.│
│                                 │
│ Reason: Gemini timeout          │
│                                 │
│ [Retry Review] [Edit Code]      │
└─────────────────────────────────┘
```

For unchanged successful code:

```text
┌─────────────────────────────────┐
│ No Code Changes                 │
│                                 │
│ This code is unchanged from     │
│ your previous successful review.│
│                                 │
│ Score: 9 / 10                  │
│                                 │
│ [View Previous Review]          │
│ [Edit Code]                     │
└─────────────────────────────────┘
```

# 26. Data Model

Adapt to the existing Firestore structure.

A review should contain something similar to:

```json
{
  "reviewId": "review_123",
  "userId": "user_456",

  "version": 3,
  "codeHash": "sha256...",
  "language": "python",

  "status": "SUCCESS",
  "failureReason": null,

  "score": 9,

  "issues": [
    {
      "id": "issue_1",
      "category": "performance",
      "severity": "LOW",
      "title": "Repeated database query",
      "line": 15
    }
  ],

  "previousReviewId": "review_122",
  "previousSuccessfulReviewId": "review_120",

  "comparison": {
    "previousScore": 7,
    "scoreChange": 2,
    "issuesResolved": 3,
    "newIssues": 0,
    "remainingIssues": 1
  },

  "createdAt": "..."
}
```

For failed attempts:

```json
{
  "reviewId": "review_124",
  "userId": "user_456",

  "version": 4,
  "codeHash": "sha256...",

  "status": "FAILED",
  "failureReason": "REVIEW_SERVICE_ERROR",

  "score": null,

  "createdAt": "..."
}
```

IMPORTANT:

Failed review score = null

Never:

```text
score = 0
```

# 27. Dashboard Metrics

Dashboard should display:

```text
Reviews
15

Code Versions
8

Overall Average
6.1

Latest Score
9.0

Best Score
9.0

Improvement
+2.0

Most Common Issue
Correctness
```

Definitions:

## Reviews

Successful scored reviews.

## Code Versions

Distinct code + language versions.

## Overall Average

Average of successful review scores.

## Latest Score

Most recent successful review score.

## Best Score

Highest successful review score.

## Improvement

Latest successful score minus first successful review score.

## Most Common Issue

The issue category appearing most frequently across successful reviews.

Do not include failed attempts in score-based metrics.

# 28. Most Common Issue

Count issue categories from successful reviews.

Example:

```text
Correctness: 12
Performance: 8
Security: 5
Formatting: 3
Architecture: 2
```

Then:

```text
Most Common Issue = Correctness
```

If there is a tie, use a deterministic rule:

```text
highest count
then most recent occurrence
```

Do not include failed reviews because they do not contain a valid review result.

# 29. Firestore / Database Efficiency

Do not retrieve every historical code file unnecessarily just to calculate metrics on every page load.

Prefer:

```text
Review created
     ↓
Calculate/update aggregate metrics
     ↓
Store metrics
     ↓
Dashboard reads aggregate metrics
```

Example aggregate document:

```json
{
  "successfulReviews": 15,
  "codeVersions": 8,
  "averageScore": 6.1,
  "latestScore": 9,
  "bestScore": 9,
  "firstScore": 7,
  "improvement": 2,
  "mostCommonIssue": "correctness"
}
```

If the existing architecture calculates metrics dynamically, do not rewrite everything unnecessarily. First understand the current implementation and make the smallest robust change.

# 30. Concurrency / Duplicate Click Protection

Handle cases where the user rapidly clicks:

```text
Review Code
Review Code
Review Code
```

Only one review request should be active for the same submission.

Use:

```text
button disabling
request IDs
AbortController where appropriate
backend idempotency if practical
```

Do not create three identical successful reviews.

# 31. Race Conditions

Handle:

```text
User submits Version 2
        ↓
Review request running

User edits code
        ↓
Version 3

Version 2 response arrives later
```

The Version 2 result must not overwrite Version 3's UI state.

Use:

```text
requestId
version
codeHash
```

and verify the response belongs to the current editor state before updating the UI.

# 32. Browser Refresh

If the review is in progress and the browser refreshes:

```text
Do not create duplicate reviews.
Persist enough server-side state to determine whether the request completed.
If practical, use an idempotency key.
```

Example:

```text
idempotencyKey =
userId + codeHash + review configuration
```

Do not rely only on frontend state for deduplication.

# 33. Authentication

Every review and metric must be associated with the authenticated user.

Never allow:

```text
user A
→ access
→ user B's review history
```

All Firestore reads/writes must enforce ownership.

Do not trust userId supplied directly by the frontend if the backend already has authenticated identity information.

# 34. Important Edge Cases

Handle all of the following:

## Case 1

Empty code.

Expected:

```text
No review
No metrics
```

## Case 2

Whitespace-only code.

Expected:

```text
No review
No metrics
```

## Case 3

Syntax-invalid code.

Expected:

```text
No Gemini review
No score
No metrics
```

## Case 4

Valid code, successful review.

Expected:

```text
New successful review
Update metrics
```

## Case 5

Same valid code after success.

Expected:

```text
No new review
No metric change
Show previous result
```

## Case 6

Same code after failed Gemini request.

Expected:

```text
Allow retry
```

## Case 7

Changed code after success.

Expected:

```text
New version
New review
Compare with previous successful version
Update metrics
```

## Case 8

Changed code after failed attempt.

Expected:

```text
New version
New review
No comparison if no previous successful score exists
```

## Case 9

Changed code + review fails.

Expected:

```text
Store failed attempt
No score
No metric change
Allow retry
```

## Case 10

Score increases.

Expected:

```text
Positive improvement
```

## Case 11

Score decreases.

Expected:

```text
Negative improvement
```

## Case 12

Score unchanged.

Expected:

```text
0 improvement
Still compare issues
```

## Case 13

Compile fails but syntax is valid.

Expected:

```text
Allow AI review
```

## Case 14

Runtime fails.

Expected:

```text
Allow AI review
```

## Case 15

Compiler unavailable.

Expected:

```text
Show warning
Allow AI review
```

## Case 16

User switches language without changing code.

Expected:

```text
Different code identity
because language is part of hash
```

## Case 17

User changes code and changes it back.

Example:

```text
Version 1 = ABC
Version 2 = XYZ
Version 3 = ABC
```

Treat Version 3 as the same code content as Version 1, but do NOT incorrectly attach it as a brand-new unique code version if the product wants deduplication.

However, it may still be a new review context if the user intentionally wants to review it again. Follow the primary product rule:

```text
If a previous successful review already exists for the exact same code/language, reuse it.
If the user explicitly requests force re-review, require an explicit force-review action.
```

# 35. Force Re-Review

Do not add a force re-review option unless necessary.

If implemented, make it explicit:

```text
[Review Again Anyway]
```

Show confirmation:

```text
This code has not changed since the previous review.

Reviewing it again will create another review attempt
but will not create a new code version.

Continue?
```

If the force review succeeds:

```text
Store the review attempt.
Do not treat it as a new code version.
Decide whether it should affect average metrics based on product rules.
```

Preferred default:
Do NOT include forced duplicate reviews in progress/improvement metrics unless explicitly configured.

# 36. Comparison Algorithm

Implement approximately:

```text
currentCodeHash = hash(currentCode, language)

latestSuccessfulReview =
    latest successful review for this user/language/code history

latestAttempt =
    latest attempt for this user

IF current code is empty:
    block

ELSE validate code

IF validation fails:
    block AI review

ELSE IF latest attempt failed AND currentCodeHash == latestAttempt.codeHash:
    allow retry

ELSE IF latest successful review exists
     AND currentCodeHash == latestSuccessfulReview.codeHash:
    show previous successful result
    do not call Gemini

ELSE:
    create new review/version
    call Gemini

    IF Gemini succeeds:
        compare with previous successful review
        update metrics

    IF Gemini fails:
        store failed attempt
        do not update score metrics
```

# 37. Issue Comparison

Use stable issue identifiers where possible.

Do not compare issues only by their exact generated text because Gemini may word the same issue differently.

Prefer:

```text
category
rule ID
issue type
severity
normalized title
```

Example:

```json
{
  "category": "security",
  "ruleId": "SQL_INJECTION",
  "severity": "HIGH"
}
```

This allows:

```text
Version 1:
SQL_INJECTION

Version 2:
SQL_INJECTION resolved
```

even if Gemini describes the issue differently.

# 38. Historical Rules

Historical Vector Search results should NOT be treated as confirmed issues.

The comparison should use actual Gemini-confirmed review issues.

For example:

```text
Vector Search:
5 candidate rules

Gemini:
2 relevant rules

Final review:
1 actual issue
```

Only the final confirmed issue should affect:

```text
Most Common Issue
Issues Resolved
New Issues
Remaining Issues
```

# 39. Security Requirements

Never:

```text
execute user code in the main FastAPI process
use eval
use unrestricted exec
expose GCP credentials
log full source code unnecessarily
trust frontend user IDs
allow one user to access another user's reviews
```

Use existing authentication and authorization mechanisms.

# 40. Testing Requirements

Add comprehensive tests.

## Hash tests

```text
same code → same hash
whitespace normalization behavior
different language → different hash
changed code → different hash
```

## Review tests

```text
first success
same code after success
changed code after success
same code after failed service request
changed code after failed request
syntax failure
compile failure
runtime failure
Gemini timeout
Gemini API failure
score increase
score decrease
score unchanged
```

## Metrics tests

Example:

```text
Scores:
6, 8, 7, 9

Expected:
Reviews = 4
Average = 7.5
Latest = 9
Best = 9
Improvement = +3
```

Failed attempts:

```text
6, FAILED, 8

Expected:

Reviews = 2
Average = 7
Latest = 8
Best = 8
Improvement = +2
```

Duplicate successful submission:

```text
6
same code again
same code again

Expected:

Reviews = 1
Average = 6
Latest = 6
Best = 6
```

Retry failed review:

```text
FAILED
retry → SUCCESS 8

Expected:

Reviews = 1
Average = 8
Latest = 8
Best = 8
```

# 41. Do Not Break Existing Functionality

After implementation verify:

```text
Authentication still works
Code editor works
Language selection works
Validation works
Compile/Run works
Review Code works
Gemini review works
Historical rules work
Firestore history works
Dashboard works
Metrics work
Failed reviews are visible
Previous reviews remain accessible
```

# 42. Final Acceptance Criteria

The feature is complete only when all of these are true:

- [ ] User can edit code after a review.
- [ ] User can re-review changed code.
- [ ] Code hash is generated deterministically.
- [ ] Language is included in code identity.
- [ ] Same successful code does not trigger another Gemini review.
- [ ] Same failed code can be retried.
- [ ] Changed code creates a new version.
- [ ] Failed reviews do not affect score metrics.
- [ ] Successful reviews update metrics.
- [ ] Syntax errors block AI review.
- [ ] Compile/runtime failures do not automatically block AI review.
- [ ] Score increase is tracked.
- [ ] Score decrease is tracked.
- [ ] Score unchanged is tracked.
- [ ] Issue-level changes are tracked.
- [ ] Resolved issues are tracked.
- [ ] New issues are tracked.
- [ ] Remaining issues are tracked.
- [ ] Failed attempts remain in history.
- [ ] Duplicate submissions do not artificially inflate metrics.
- [ ] Latest score is based on latest successful review.
- [ ] Best score is based on successful reviews only.
- [ ] Overall average excludes failed attempts.
- [ ] Improvement uses first successful vs latest successful score.
- [ ] Most common issue uses confirmed review issues.
- [ ] Race conditions are handled.
- [ ] Duplicate requests are prevented.
- [ ] User data remains isolated.
- [ ] Tests cover all important edge cases.
- [ ] Existing functionality remains intact.

# 43. Final Implementation Report

After implementation, provide:

## Files Changed

List every modified/created file.

## Data Model Changes

Explain:

```text
new fields
new collections/documents
migration requirements
```

## Review Flow

Explain:

```text
Edit
→ Validate
→ Compile/Run
→ Review
→ Compare
→ Store
→ Update Metrics
```

## Edge Cases

List all handled edge cases.

## Tests

List:

```text
test commands
test results
build results
lint/type-check results
```
