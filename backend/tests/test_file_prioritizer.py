from app.services import file_prioritizer as fp


def test_auth_tier():
    assert fp.assign_tier("src/auth/login.py") == "auth"
    assert fp.assign_tier("src/session_manager.py") == "auth"
    assert fp.assign_tier("api/jwt_utils.py") == "auth"


def test_api_tier():
    assert fp.assign_tier("src/api/users.py") == "api"
    assert fp.assign_tier("routes/orders.js") == "api"
    assert fp.assign_tier("UserController.java") == "api"


def test_data_tier():
    assert fp.assign_tier("models/user.py") == "data"
    assert fp.assign_tier("src/repository/order_repository.py") == "data"
    assert fp.assign_tier("migrations/0001_init.py") == "data"


def test_util_tier():
    assert fp.assign_tier("src/utils/format.py") == "util"
    assert fp.assign_tier("lib/helpers.js") == "util"


def test_config_tier():
    assert fp.assign_tier("settings.py") == "config"
    assert fp.assign_tier("config.yaml") == "config"
    assert fp.assign_tier(".env.example") == "config"


def test_test_tier():
    assert fp.assign_tier("tests/test_users.py") == "test"
    assert fp.assign_tier("src/components/Button.test.tsx") == "test"
    assert fp.assign_tier("__tests__/app.spec.js") == "test"


def test_docs_tier():
    assert fp.assign_tier("README.md") == "docs"
    assert fp.assign_tier("docs/CHANGELOG.md") == "docs"


def test_source_is_the_fallback_for_ordinary_files():
    assert fp.assign_tier("src/components/Button.tsx") == "source"
    assert fp.assign_tier("main.py") == "source"


def test_auth_wins_over_api_when_both_could_match():
    # An auth-flavored file living under api/ should still tier as auth --
    # auth is checked first.
    assert fp.assign_tier("src/api/auth.py") == "auth"


def test_auth_does_not_false_positive_on_words_containing_it_as_a_prefix():
    # "auth" is a literal prefix of "author"/"authoritative" -- a naive
    # substring match would mis-tier these as auth. "author.py" still lands
    # in "data" here because it also sits in a /models/ directory; the point
    # is specifically that the AUTH pattern itself doesn't fire on it.
    assert not fp._AUTH_PATTERN.search("author.py")
    assert not fp._AUTH_PATTERN.search("authoritative_source.py")
    assert fp.assign_tier("src/components/AuthorBadge.tsx") == "source"


def test_auth_matches_common_real_world_filename_shapes():
    # snake_case, kebab-case, camelCase, PascalCase, and a plural -- the
    # custom boundary (not plain \b, which treats "_" as a word char) has to
    # accept all of these, not just "auth.py" in isolation.
    assert fp.assign_tier("src/auth_service.py") == "auth"
    assert fp.assign_tier("src/auth-service.py") == "auth"
    assert fp.assign_tier("src/authService.ts") == "auth"
    assert fp.assign_tier("src/AuthController.java") == "auth"
    assert fp.assign_tier("src/permissions.py") == "auth"
    assert fp.assign_tier("src/authorization.py") == "auth"


def test_standard_mode_default_selection():
    assert fp.default_selected("auth", "standard") is True
    assert fp.default_selected("api", "standard") is True
    assert fp.default_selected("data", "standard") is True
    assert fp.default_selected("source", "standard") is True
    assert fp.default_selected("util", "standard") is True
    assert fp.default_selected("config", "standard") is False
    assert fp.default_selected("test", "standard") is False
    assert fp.default_selected("docs", "standard") is False


def test_comprehensive_mode_selects_everything():
    for tier in ("auth", "api", "data", "source", "util", "config", "test", "docs"):
        assert fp.default_selected(tier, "comprehensive") is True


def test_detect_language_for_path_uses_extension():
    assert fp.detect_language_for_path("src/main.py", "x = 1\n") == "python"
    assert fp.detect_language_for_path("src/app.ts", "const x: number = 1;\n") == "typescript"
