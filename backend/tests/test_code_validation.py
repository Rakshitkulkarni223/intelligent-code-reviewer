import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import code_validators as cv

HEADERS = {"Authorization": "Bearer user_a"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _validate(client: TestClient, code: str, language: str):
    return client.post("/api/code/validate", json={"code": code, "language": language}, headers=HEADERS)


# ---- General / API-level ----


def test_missing_auth_rejected(client):
    assert client.post("/api/code/validate", json={"code": "x", "language": "python"}).status_code == 401


def test_empty_string(client):
    r = _validate(client, "", "python")
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert body["status"] == "empty"
    assert body["errorCode"] == "EMPTY_CODE"


def test_whitespace_only(client):
    body = _validate(client, "   \n\t  \n", "python").json()
    assert body["status"] == "empty"


def test_invisible_unicode_whitespace_only(client):
    zero_width_space = chr(0x200B)
    body = _validate(client, zero_width_space * 3, "python").json()
    assert body["status"] == "empty"


def test_comments_only(client):
    body = _validate(client, "# just a comment\n# another one", "python").json()
    assert body["status"] == "empty"


def test_valid_simple_code(client):
    body = _validate(client, "x = 1 + 2", "python").json()
    assert body["valid"] is True
    assert body["status"] == "valid"


def test_very_large_code_rejected(client):
    huge = "a = 1\n" * 200_000  # well over the 500 KB limit
    r = _validate(client, huge, "python")
    assert r.status_code == 413


def test_unsupported_language(client):
    body = _validate(client, "some code", "brainfuck").json()
    assert body["status"] == "unsupported_language"
    assert body["valid"] is False


def test_known_language_without_validator_is_unavailable_not_blocking(client):
    body = _validate(client, "package main", "go").json()
    assert body["status"] == "validation_unavailable"
    assert body["valid"] is False


def test_malformed_request_missing_code(client):
    r = client.post("/api/code/validate", json={"language": "python"}, headers=HEADERS)
    assert r.status_code == 422


def test_missing_language(client):
    r = client.post("/api/code/validate", json={"code": "x = 1"}, headers=HEADERS)
    assert r.status_code == 422


def test_null_code_rejected(client):
    r = client.post("/api/code/validate", json={"code": None, "language": "python"}, headers=HEADERS)
    assert r.status_code == 422


def test_non_string_code_rejected(client):
    r = client.post("/api/code/validate", json={"code": 12345, "language": "python"}, headers=HEADERS)
    assert r.status_code == 422


def test_response_never_exposes_raw_traceback(client, monkeypatch):
    def boom(code, language):
        raise RuntimeError("should never reach the client")

    monkeypatch.setattr("app.api.code_validation.validate_code", boom)
    body = _validate(client, "x = 1", "python").json()
    assert body["status"] == "validation_unavailable"
    assert "RuntimeError" not in body["message"]
    assert "Traceback" not in body["message"]


# ---- Python (direct unit tests against the validator, plus a couple through the API) ----


def test_python_bare_def():
    r = cv.validate_python("def")
    assert r.valid is False


def test_python_def_missing_body():
    r = cv.validate_python("def add(a, b):")
    assert r.status == "incomplete"
    assert r.line == 1


def test_python_valid_function_with_pass():
    r = cv.validate_python("def add(a, b):\n    pass")
    assert r.valid is True and r.status == "valid"


def test_python_valid_function_with_body():
    r = cv.validate_python("def add(a, b):\n    return a + b")
    assert r.valid is True


def test_python_bare_if():
    r = cv.validate_python("if True:")
    assert r.status == "incomplete"


def test_python_incomplete_indentation():
    r = cv.validate_python("def f():\nreturn 1")
    assert r.valid is False


def test_python_unmatched_bracket():
    r = cv.validate_python("x = (1, 2")
    assert r.valid is False
    assert r.errorCode == "UNBALANCED_DELIMITER"


def test_python_unterminated_string():
    r = cv.validate_python('x = "abc')
    assert r.valid is False


def test_python_module_level_return():
    r = cv.validate_python("return 5")
    assert r.valid is False
    assert r.status == "syntax_error"


def test_python_valid_class():
    r = cv.validate_python("class Foo:\n    def bar(self):\n        pass")
    assert r.valid is True


def test_python_valid_async_function():
    r = cv.validate_python("async def foo():\n    await bar()")
    assert r.valid is True


def test_python_valid_decorators():
    r = cv.validate_python("class Foo:\n    @staticmethod\n    def bar():\n        pass")
    assert r.valid is True


def test_python_syntax_error_has_line_and_column():
    r = cv.validate_python("x = 1\ny = (2 + )")
    assert r.valid is False
    assert r.line == 2
    assert r.column is not None


def test_python_never_executes_code():
    # If this ever executed, the file would be created; validation must not do that.
    import os
    import tempfile

    marker = os.path.join(tempfile.gettempdir(), "should_not_exist_from_validation.txt")
    if os.path.exists(marker):
        os.remove(marker)
    cv.validate_python(f"open(r'{marker}', 'w').write('bad')")
    assert not os.path.exists(marker)


# ---- JavaScript ----


def test_js_bare_function():
    assert cv.validate_javascript("function").valid is False


def test_js_const_no_value():
    assert cv.validate_javascript("const x =").valid is False


def test_js_unmatched_brace():
    r = cv.validate_javascript("if (true) {")
    assert r.valid is False
    assert r.status == "incomplete"


def test_js_unterminated_string():
    r = cv.validate_javascript('const x = "abc')
    assert r.valid is False


def test_js_valid_function():
    assert cv.validate_javascript("function add(a, b) { return a + b; }").valid is True


def test_js_valid_arrow_function():
    assert cv.validate_javascript("const add = (a, b) => a + b;").valid is True


def test_js_valid_async_function():
    assert cv.validate_javascript("async function main() { await run(); }").valid is True


# ---- TypeScript ----


def test_ts_incomplete_interface():
    assert cv.validate_typescript("interface Foo {").valid is False


def test_ts_valid_interface():
    assert cv.validate_typescript("interface Foo { name: string; }").valid is True


def test_ts_valid_generic_function():
    assert cv.validate_typescript("function identity<T>(arg: T): T { return arg; }").valid is True


# ---- SQL ----


def test_sql_empty_query():
    assert cv.validate_sql("").status == "empty"


def test_sql_bare_select():
    assert cv.validate_sql("SELECT").valid is False


def test_sql_valid_select():
    assert cv.validate_sql("SELECT * FROM users;").valid is True


def test_sql_unclosed_quote():
    assert cv.validate_sql("SELECT * FROM users WHERE name = 'bob").valid is False


def test_sql_valid_insert():
    assert cv.validate_sql("INSERT INTO users (id, name) VALUES (1, 'bob');").valid is True


# ---- C/C++: no compiler in this environment -- must degrade, not crash ----


def test_cpp_reports_unavailable_not_a_fake_pass(client):
    body = _validate(client, "int main() { return 0; }", "cpp").json()
    assert body["status"] == "validation_unavailable"


def test_c_reports_unavailable_not_a_fake_pass(client):
    body = _validate(client, "#include <stdio.h>", "c").json()
    assert body["status"] == "validation_unavailable"
