"""Manifest-based project-type detection (docs/PROJECT_ZIP_REVIEW_PLAN.md §4.3).
Purely deterministic -- never a Gemini call -- run once per project right
after zip_extraction.extract_project() has filtered the archive down to its
reviewable text files.

This is purely additive metadata: it never blocks a review or excludes
files by itself, and an unrecognized project still produces a usable
(if less specific) profile.
"""

import json
import re

from app.schemas.project_review import ProjectProfile
from app.services.zip_extraction import ExtractedFile

_ENTRY_POINT_CANDIDATES = [
    "src/main.tsx", "src/main.ts", "src/index.tsx", "src/index.ts",
    "main.py", "app.py", "backend/app/main.py", "manage.py",
    "Program.cs", "src/main/java/Main.java", "cmd/main.go", "main.go", "src/main.rs",
]


def _find(files_by_path: dict[str, ExtractedFile], name: str) -> ExtractedFile | None:
    # Manifest files matter regardless of which directory they live in for a
    # monorepo (e.g. "backend/requirements.txt"), so match by basename too --
    # exact path first since that's the common case and avoids ambiguity.
    if name in files_by_path:
        return files_by_path[name]
    for path, f in files_by_path.items():
        if path == name or path.endswith(f"/{name}"):
            return f
    return None


def _detect_node(pkg: ExtractedFile) -> tuple[str, list[str]]:
    try:
        data = json.loads(pkg.text)
    except (json.JSONDecodeError, ValueError):
        return "Node.js", []
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    frameworks = []
    project_type = "Node.js"
    if "next" in deps:
        frameworks.append("next.js")
        project_type = "Next.js"
    elif "react" in deps:
        frameworks.append("react")
        project_type = "React"
    if "@angular/core" in deps:
        frameworks.append("angular")
        project_type = "Angular"
    if "vue" in deps:
        frameworks.append("vue")
        project_type = "Vue"
    if "express" in deps:
        frameworks.append("express")
        project_type = f"{project_type} + Express" if frameworks[:-1] else "Express"
    return project_type, frameworks


def _detect_python(files_by_path: dict[str, ExtractedFile]) -> tuple[str, list[str]]:
    text_blobs = []
    for name in ("requirements.txt", "pyproject.toml", "Pipfile"):
        f = _find(files_by_path, name)
        if f:
            text_blobs.append(f.text.lower())
    combined = "\n".join(text_blobs)
    frameworks = []
    project_type = "Python"
    if "fastapi" in combined:
        frameworks.append("fastapi")
        project_type = "FastAPI"
    elif "django" in combined:
        frameworks.append("django")
        project_type = "Django"
    elif "flask" in combined:
        frameworks.append("flask")
        project_type = "Flask"
    return project_type, frameworks


def detect_project(files: list[ExtractedFile]) -> ProjectProfile:
    files_by_path = {f.path: f for f in files}
    languages: set[str] = set()
    frameworks: list[str] = []
    project_types: list[str] = []

    pkg = _find(files_by_path, "package.json")
    if pkg:
        languages.add("typescript" if any(p.endswith((".ts", ".tsx")) for p in files_by_path) else "javascript")
        ptype, fws = _detect_node(pkg)
        project_types.append(ptype)
        frameworks.extend(fws)

    if any(_find(files_by_path, n) for n in ("requirements.txt", "pyproject.toml", "Pipfile")):
        languages.add("python")
        ptype, fws = _detect_python(files_by_path)
        project_types.append(ptype)
        frameworks.extend(fws)

    if any(_find(files_by_path, n) for n in ("pom.xml", "build.gradle")):
        languages.add("java")
        combined = "\n".join(f.text.lower() for n in ("pom.xml", "build.gradle") if (f := _find(files_by_path, n)))
        if "spring-boot" in combined or "springframework.boot" in combined:
            frameworks.append("spring boot")
            project_types.append("Spring Boot")
        else:
            project_types.append("Java")

    if _find(files_by_path, "go.mod"):
        languages.add("go")
        project_types.append("Go")

    if any(p.endswith(".csproj") or p.endswith(".sln") for p in files_by_path):
        languages.add("c#")
        project_types.append(".NET")

    gemfile = _find(files_by_path, "Gemfile")
    if gemfile:
        languages.add("ruby")
        project_types.append("Rails" if re.search(r"gem\s+['\"]rails['\"]", gemfile.text) else "Ruby")

    if _find(files_by_path, "Cargo.toml"):
        languages.add("rust")
        project_types.append("Rust")

    project_type = " + ".join(dict.fromkeys(project_types)) if project_types else "Unknown"

    entry_points = [c for c in _ENTRY_POINT_CANDIDATES if c in files_by_path]

    total_files = len(files)
    total_lines = sum(f.text.count("\n") + 1 for f in files)
    if total_files > 150 or total_lines > 20_000:
        complexity = "large"
    elif total_files > 30 or total_lines > 3_000:
        complexity = "medium"
    else:
        complexity = "small"

    return ProjectProfile(
        projectType=project_type,
        languages=sorted(languages),
        frameworks=frameworks,
        entryPoints=entry_points,
        estimatedComplexity=complexity,
    )
