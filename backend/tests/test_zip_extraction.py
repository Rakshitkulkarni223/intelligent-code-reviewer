import io
import zipfile

import pytest

from app.config import settings
from app.services import zip_extraction as ze


def _make_zip(entries: dict[str, bytes], **zip_kwargs) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", **zip_kwargs) as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _paths(result: ze.ExtractionResult) -> set[str]:
    return {f.path for f in result.files}


def _excluded_reasons(result: ze.ExtractionResult) -> dict[str, str]:
    return {e.path: e.reason for e in result.excluded}


# ---- Happy path ----


def test_normal_small_project_accepted():
    data = _make_zip({
        "src/main.py": b"def main():\n    return 1\n",
        "src/utils/helpers.py": b"def helper():\n    pass\n",
        "README.md": b"# Hello\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"src/main.py", "src/utils/helpers.py", "README.md"}
    assert result.excluded == []


def test_included_file_text_is_decoded_correctly():
    data = _make_zip({"a.py": b"x = 1\n"})
    result = ze.extract_project(data)
    assert result.files[0].text == "x = 1\n"
    assert result.files[0].size == len(b"x = 1\n")


# ---- Path traversal / zip-slip ----


def test_path_traversal_rejected():
    data = _make_zip({"../../etc/passwd": b"evil"})
    with pytest.raises(ze.ZipValidationError, match="escapes the archive root"):
        ze.extract_project(data)


def test_absolute_path_rejected():
    data = _make_zip({"/etc/passwd": b"evil"})
    with pytest.raises(ze.ZipValidationError, match="escapes the archive root"):
        ze.extract_project(data)


def test_dotdot_in_middle_of_path_rejected():
    data = _make_zip({"shared/../../etc/passwd": b"evil"})
    with pytest.raises(ze.ZipValidationError, match="escapes the archive root"):
        ze.extract_project(data)


def test_windows_drive_letter_path_rejected():
    data = _make_zip({"C:/Windows/System32/evil.py": b"evil"})
    with pytest.raises(ze.ZipValidationError, match="escapes the archive root"):
        ze.extract_project(data)


# ---- Zip bomb guards ----


def test_oversized_single_entry_excluded_not_fatal():
    data = _make_zip({
        "big.py": b"x" * (settings.max_zip_entry_bytes + 1),
        "small.py": b"y = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"small.py"}
    assert _excluded_reasons(result)["big.py"] == "too large"


def test_absurd_compression_ratio_rejected():
    # Highly compressible content (all zeros) at max compression, kept under
    # the per-entry size cap so it reaches the ratio check rather than the
    # "too large" one -- a realistic zip-bomb shape: tiny on disk, huge
    # decompressed, well past the 100x ratio cap.
    almost_max = bytes(settings.max_zip_entry_bytes - 1024)
    data = _make_zip({"bomb.py": almost_max}, compression=zipfile.ZIP_DEFLATED, compresslevel=9)
    with pytest.raises(ze.ZipValidationError, match="suspicious compression ratio"):
        ze.extract_project(data)


def test_total_uncompressed_size_cap_rejected(monkeypatch):
    # Decoupled from real compression behavior: ZIP_STORED makes compressed
    # size == uncompressed size (ratio 1, never trips the ratio cap), and
    # max_zip_bytes is raised so the whole-archive byte-size gate doesn't
    # fire before the uncompressed-total one under test does.
    monkeypatch.setattr(settings, "max_zip_bytes", 10 * 1024 * 1024)
    monkeypatch.setattr(settings, "max_zip_total_uncompressed_bytes", 1000)
    monkeypatch.setattr(settings, "max_zip_entry_bytes", 400)
    entries = {f"file_{i}.py": b"x" * 300 for i in range(5)}
    data = _make_zip(entries, compression=zipfile.ZIP_STORED)
    with pytest.raises(ze.ZipValidationError, match="uncompressed content exceeds"):
        ze.extract_project(data)


def test_entry_count_cap_rejected():
    entries = {f"f{i}.py": b"x" for i in range(settings.max_zip_entry_count + 1)}
    data = _make_zip(entries)
    with pytest.raises(ze.ZipValidationError, match="more than .* entries"):
        ze.extract_project(data)


# ---- Nested archives ----


def test_nested_zip_entry_skipped_not_opened():
    data = _make_zip({
        "inner.zip": b"PK\x03\x04not-really-a-valid-zip-but-should-never-be-opened",
        "main.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"main.py"}
    assert _excluded_reasons(result)["inner.zip"] == "nested archive"


# ---- Binary / type filtering ----


def test_image_excluded_by_extension_before_reading_content():
    data = _make_zip({
        "image.png": b"\x89PNG\r\n\x1a\n\x00\x00\x00",
        "main.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"main.py"}
    assert _excluded_reasons(result)["image.png"] == "unsupported file type"


def test_null_byte_in_text_extension_file_excluded_as_binary():
    # A text-extension file (passes the allowlist) whose content is actually
    # binary -- the null-byte check (mirroring validate_code's) is what
    # catches this, not the extension allowlist.
    data = _make_zip({
        "corrupted.py": b"import os\x00\x01\x02garbage",
        "main.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"main.py"}
    assert _excluded_reasons(result)["corrupted.py"] == "binary content"


def test_unsupported_extension_excluded():
    data = _make_zip({
        "binary.exe": b"MZfake-exe-content",
        "main.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"main.py"}
    assert _excluded_reasons(result)["binary.exe"] == "unsupported file type"


def test_non_utf8_text_excluded():
    data = _make_zip({
        "latin1.py": "café".encode("latin-1"),
        "main.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"main.py"}
    assert _excluded_reasons(result)["latin1.py"] == "not valid UTF-8 text"


# ---- Noise directories & lockfiles ----


def test_noise_directories_excluded():
    data = _make_zip({
        "node_modules/left-pad/index.js": b"module.exports = 1;",
        ".git/HEAD": b"ref: refs/heads/main",
        "backend/.venv/lib/foo.py": b"x = 1",
        "src/app.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"src/app.py"}
    reasons = _excluded_reasons(result)
    assert reasons["node_modules/left-pad/index.js"] == "inside node_modules/"
    assert reasons[".git/HEAD"] == "inside .git/"
    assert reasons["backend/.venv/lib/foo.py"] == "inside .venv/"


def test_lockfiles_excluded():
    data = _make_zip({
        "package-lock.json": b"{}",
        "yarn.lock": b"",
        "poetry.lock": b"",
        "app.py": b"x = 1\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"app.py"}
    reasons = _excluded_reasons(result)
    assert reasons["package-lock.json"] == "lockfile"
    assert reasons["yarn.lock"] == "lockfile"
    assert reasons["poetry.lock"] == "lockfile"


def test_manifest_files_always_included_even_though_config_like():
    data = _make_zip({
        "package.json": b'{"name": "app", "dependencies": {"react": "^18.0.0"}}',
        "requirements.txt": b"fastapi==0.115.6\n",
    })
    result = ze.extract_project(data)
    assert _paths(result) == {"package.json", "requirements.txt"}


# ---- Archive-level checks ----


def test_archive_too_large_rejected():
    oversized = b"x" * (settings.max_zip_bytes + 1)
    with pytest.raises(ze.ZipValidationError, match="exceeds the .* MB limit"):
        ze.extract_project(oversized)


def test_empty_bytes_rejected():
    with pytest.raises(ze.ZipValidationError, match="empty"):
        ze.extract_project(b"")


def test_not_a_zip_file_rejected():
    with pytest.raises(ze.ZipValidationError, match="not a valid zip"):
        ze.extract_project(b"this is definitely not a zip file, just plain bytes")


def test_zero_reviewable_files_returns_empty_not_raises():
    # Everything excluded (all noise) -- extract_project itself doesn't raise
    # for this; the 422 is the API layer's job (§4.1), so it can distinguish
    # "archive was invalid" (400) from "archive was fine, nothing to review" (422).
    data = _make_zip({"node_modules/x.js": b"1", ".git/HEAD": b"ref"})
    result = ze.extract_project(data)
    assert result.files == []
