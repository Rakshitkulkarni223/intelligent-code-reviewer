"""Priority-tier assignment + default selection (docs/PROJECT_ZIP_REVIEW_PLAN.md
§4.4). Ordered filename/path heuristics, first match wins -- never a Gemini
call. Lockfiles and noise directories never reach this at all; they're
excluded upstream in zip_extraction.py, before tiering even runs.
"""

import re

from app.schemas.project_review import STANDARD_DEFAULT_TIERS, PriorityTier, ReviewMode
from app.services import language_detector

# Custom boundary, not plain \b: \b treats "_" as a word character, which
# would reject the very common "auth_service.py"/"auth-service.py" shape.
# Bounded instead on "not preceded by a letter" and "not immediately
# followed by a lowercase letter" -- allows a non-letter separator (._-/)
# or a camelCase capital right after the keyword (authService, AuthRoutes),
# but rejects a same-case run that keeps spelling a different word, which is
# what "auth" as a bare substring would otherwise catch inside
# "author.py"/"authoritative.py". Longer forms are listed explicitly (not
# relied on to fall out of "auth" + lowercase continuation) so genuinely
# auth-related words like "authorization.py" still match.
_AUTH_PATTERN = re.compile(
    r"(?<![A-Za-z])(?i:authentication|authenticated|authenticate|authorization|authorized|authorize|"
    r"permissions|permission|sessions|session|logins|login|auth|jwt)(?![a-z])"
)
_API_PATTERN = re.compile(r"(^|/)(api|routes?|controllers?|handlers?)(/|$)|controller\.|handler\.", re.I)
_DATA_PATTERN = re.compile(r"(^|/)(models?|repositor(y|ies)|migrations?|db|database)(/|$)|model\.|repository\.", re.I)
_UTIL_PATTERN = re.compile(r"(^|/)(utils?|helpers?|lib)(/|$)", re.I)
_CONFIG_PATTERN = re.compile(r"(^|/)(settings|config)\.|\.env\.example$|\.ya?ml$", re.I)
_TEST_PATTERN = re.compile(r"(^|/)(tests?|__tests__)(/|$)|test_.*\.|_test\.|\.test\.|\.spec\.", re.I)
_DOCS_PATTERN = re.compile(r"(^|/)(readme|changelog|license|contributing)", re.I)

# CI config lives under a recognized workflow directory -- kept out of the
# generic "config" tier's YAML catch-all per §4.4's "outside CI dirs" note,
# since a CI pipeline file is closer to "source describing behavior" than
# "app configuration," and either way isn't useful to review as app code.
_CI_DIR_PATTERN = re.compile(r"(^|/)\.github/workflows/|(^|/)\.gitlab-ci\.ya?ml$")


def assign_tier(path: str) -> PriorityTier:
    """First match wins -- order matters. auth/api/data are checked before
    the generic source/util/config/test/docs buckets so e.g.
    'src/api/auth.py' lands in auth, not api."""
    if _AUTH_PATTERN.search(path):
        return "auth"
    if _API_PATTERN.search(path):
        return "api"
    if _DATA_PATTERN.search(path):
        return "data"
    if _TEST_PATTERN.search(path):
        return "test"
    if _DOCS_PATTERN.search(path) and path.lower().endswith(".md"):
        return "docs"
    if _UTIL_PATTERN.search(path):
        return "util"
    if _CI_DIR_PATTERN.search(path):
        return "config"
    if _CONFIG_PATTERN.search(path):
        return "config"
    return "source"


def default_selected(tier: PriorityTier, mode: ReviewMode) -> bool:
    if mode == "comprehensive":
        return True
    return tier in STANDARD_DEFAULT_TIERS


def detect_language_for_path(path: str, text: str) -> str:
    filename = path.rsplit("/", 1)[-1]
    return language_detector.resolve_language("auto", text, filename)
