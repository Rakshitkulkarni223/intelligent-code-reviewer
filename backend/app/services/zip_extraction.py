"""The ONLY place zip bytes are touched (docs/PROJECT_ZIP_REVIEW_PLAN.md §8) --
mirrors how app/security/validation.py is the one place single-file input is
checked. Every guard here must run, in order, BEFORE a single byte of any
entry is decoded as text and handed to anything downstream.

No disk writes, ever: the upload is read into memory (io.BytesIO), opened
with zipfile.ZipFile, and each wanted entry's bytes are read directly
(ZipFile.read(name)) into a string -- never extractall()/extract() to a real
path. This sidesteps zip-slip/path-traversal and symlink-following risks
almost entirely, since nothing is ever written to a filesystem path derived
from untrusted entry names.
"""

import zipfile
from dataclasses import dataclass, field

from app.config import settings

# Directories whose contents are never useful to review -- excluded outright,
# not just defaulted off like a PriorityTier. Matched against any path
# segment, not just a prefix, so e.g. "backend/.venv/lib/..." is caught too.
NOISE_DIRECTORIES = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build",
    ".next", "target", "vendor", ".pytest_cache", ".mypy_cache", ".tox",
    ".idea", ".vscode", "coverage", ".DS_Store",
}

# Generated/derived files -- reviewing them has no value regardless of
# review mode, so (unlike PriorityTier's config/test/docs) they never reach
# tiering at all.
LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Gemfile.lock",
    "poetry.lock", "Cargo.lock", "composer.lock", "Pipfile.lock",
}

NESTED_ARCHIVE_EXTENSIONS = {
    "zip", "tar", "gz", "tgz", "bz2", "7z", "rar", "xz", "jar", "war",
}

# Allowlist, not a denylist -- mirrors frontend/src/lib/languageDetect.ts's
# EXTENSION_MAP plus a few text formats worth reviewing that aren't code
# (kept out of PriorityTier's "source" catch-all by file_prioritizer.py).
TEXT_EXTENSIONS = {
    "py", "js", "jsx", "ts", "tsx", "java", "c", "h", "cpp", "cc", "hpp",
    "go", "rs", "rb", "php", "sql", "html", "css", "scss", "yaml", "yml",
    "json", "md", "txt", "env", "toml", "cfg", "ini",
}

# Manifest filenames project_detector.py looks for -- always included even
# though some (e.g. package.json) would otherwise fall in the "config" tier,
# since detection needs to see them regardless of the user's review mode.
MANIFEST_FILENAMES = {
    "package.json", "requirements.txt", "pyproject.toml", "Pipfile",
    "pom.xml", "build.gradle", "go.mod", "Gemfile", "Cargo.toml",
}


class ZipValidationError(Exception):
    """Archive-level violation -- surfaced as a 400 with this exact message,
    before any extraction happens (§4.1)."""


@dataclass
class ExtractedFile:
    path: str
    text: str
    size: int


@dataclass
class ExcludedEntry:
    path: str
    reason: str


@dataclass
class ExtractionResult:
    files: list[ExtractedFile] = field(default_factory=list)
    excluded: list[ExcludedEntry] = field(default_factory=list)


def _normalized_segments(name: str) -> list[str]:
    return [seg for seg in name.replace("\\", "/").split("/") if seg not in ("", ".")]


def _is_path_safe(name: str) -> bool:
    """Rejects traversal outright as defense in depth -- the displayed path
    is still untrusted text even though nothing is ever written to a real
    filesystem path derived from it (see module docstring)."""
    if name.startswith("/") or name.startswith("\\"):
        return False
    if len(name) >= 2 and name[1] == ":":  # drive letter, e.g. "C:\\"
        return False
    segments = name.replace("\\", "/").split("/")
    if ".." in segments:
        return False
    return True


def _is_noise_path(segments: list[str]) -> str | None:
    for seg in segments[:-1]:
        if seg in NOISE_DIRECTORIES:
            return seg
    return None


def _extension(filename: str) -> str | None:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else None


def validate_archive_bytes(data: bytes) -> None:
    """Cheap, whole-archive checks that don't require opening it as a zip at
    all -- run first, before zipfile even parses the central directory."""
    if len(data) > settings.max_zip_bytes:
        raise ZipValidationError(f"Archive exceeds the {settings.max_zip_bytes // (1024 * 1024)} MB limit")
    if not data:
        raise ZipValidationError("Archive is empty")


def extract_project(data: bytes) -> ExtractionResult:
    """Runs every §8 guard, in order, and returns only text file contents
    that passed all of them. Raises ZipValidationError on any archive-level
    violation (rejected outright, before any entry is read) -- a per-entry
    problem (binary content, noise directory, one oversized file, ...) is
    never fatal to the whole archive, it's just excluded with a reason.
    """
    validate_archive_bytes(data)

    import io

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ZipValidationError("File is not a valid zip archive") from exc

    infos = zf.infolist()

    # Entry-count cap checked before any other per-entry work, so a zip
    # crafted with millions of tiny entries is rejected immediately rather
    # than iterated (§8).
    if len(infos) > settings.max_zip_entry_count:
        raise ZipValidationError(f"Archive contains more than {settings.max_zip_entry_count} entries")

    total_uncompressed = 0
    result = ExtractionResult()

    for info in infos:
        name = info.filename

        # Directory entries carry no content of their own.
        if name.endswith("/") or info.is_dir():
            continue

        if not _is_path_safe(name):
            raise ZipValidationError(f"Entry '{name}' escapes the archive root")

        # Symlinks: a zip entry's Unix mode is packed into the high 16 bits
        # of external_attr; 0o120000 (S_IFLNK) marks a symlink. Since entries
        # are only ever read via ZipFile.read() -- never extracted to a real
        # path -- a symlink here can't itself escape anywhere, but the text
        # it "points to" would be meaningless to review, so skip it like any
        # other non-regular-file entry.
        unix_mode = info.external_attr >> 16
        if unix_mode and (unix_mode & 0o170000) == 0o120000:
            result.excluded.append(ExcludedEntry(name, "symlink"))
            continue

        segments = _normalized_segments(name)
        if not segments:
            continue
        display_path = "/".join(segments)
        basename = segments[-1]

        # Zip bomb guards, from metadata alone, before a single byte of this
        # entry's content is read.
        if info.file_size > settings.max_zip_entry_bytes:
            result.excluded.append(ExcludedEntry(display_path, "too large"))
            continue
        if info.compress_size > 0:
            ratio = info.file_size / info.compress_size
            if ratio > settings.max_zip_compression_ratio:
                raise ZipValidationError(f"Entry '{display_path}' has a suspicious compression ratio")
        total_uncompressed += info.file_size
        if total_uncompressed > settings.max_zip_total_uncompressed_bytes:
            raise ZipValidationError(
                f"Archive's uncompressed content exceeds the "
                f"{settings.max_zip_total_uncompressed_bytes // (1024 * 1024)} MB limit"
            )

        noise_dir = _is_noise_path(segments)
        if noise_dir:
            result.excluded.append(ExcludedEntry(display_path, f"inside {noise_dir}/"))
            continue

        if basename in LOCKFILES:
            result.excluded.append(ExcludedEntry(display_path, "lockfile"))
            continue

        ext = _extension(basename)
        if ext in NESTED_ARCHIVE_EXTENSIONS:
            result.excluded.append(ExcludedEntry(display_path, "nested archive"))
            continue

        is_manifest = basename in MANIFEST_FILENAMES
        if not is_manifest and (ext is None or ext not in TEXT_EXTENSIONS):
            result.excluded.append(ExcludedEntry(display_path, "unsupported file type"))
            continue

        try:
            raw = zf.read(info)
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
            result.excluded.append(ExcludedEntry(display_path, f"unreadable entry: {exc}"))
            continue

        if b"\x00" in raw:
            result.excluded.append(ExcludedEntry(display_path, "binary content"))
            continue

        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            result.excluded.append(ExcludedEntry(display_path, "not valid UTF-8 text"))
            continue

        if len(result.files) >= settings.max_project_files:
            result.excluded.append(ExcludedEntry(display_path, "project file-count limit reached"))
            continue

        result.files.append(ExtractedFile(path=display_path, text=text, size=info.file_size))

    # Deliberately not raised here: zero reviewable files after filtering is
    # a 422 (§4.1), distinct from a ZipValidationError's 400 -- the archive
    # itself was valid, filtering just left nothing to review. The caller
    # (project_review_service) checks `result.files` and raises the right
    # status for its own layer.
    return result
