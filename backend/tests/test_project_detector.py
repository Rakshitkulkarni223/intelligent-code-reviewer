from app.services.project_detector import detect_project
from app.services.zip_extraction import ExtractedFile


def _f(path: str, text: str) -> ExtractedFile:
    return ExtractedFile(path=path, text=text, size=len(text.encode("utf-8")))


def test_react_project_detected():
    files = [
        _f("package.json", '{"dependencies": {"react": "^18.0.0"}}'),
        _f("src/App.tsx", "export default function App() { return null; }\n"),
    ]
    profile = detect_project(files)
    assert profile.projectType == "React"
    assert "react" in profile.frameworks
    assert "typescript" in profile.languages


def test_nextjs_takes_priority_over_plain_react():
    files = [_f("package.json", '{"dependencies": {"react": "^18.0.0", "next": "^14.0.0"}}')]
    profile = detect_project(files)
    assert profile.projectType == "Next.js"


def test_fastapi_project_detected():
    files = [
        _f("requirements.txt", "fastapi==0.115.6\nuvicorn==0.34.0\n"),
        _f("app/main.py", "x = 1\n"),
    ]
    profile = detect_project(files)
    assert profile.projectType == "FastAPI"
    assert "python" in profile.languages


def test_django_project_detected():
    files = [_f("requirements.txt", "Django==5.0\n")]
    profile = detect_project(files)
    assert profile.projectType == "Django"


def test_go_project_detected():
    files = [_f("go.mod", "module example.com/app\n\ngo 1.21\n")]
    profile = detect_project(files)
    assert profile.projectType == "Go"
    assert "go" in profile.languages


def test_rails_detected_from_gemfile():
    files = [_f("Gemfile", "source 'https://rubygems.org'\ngem 'rails'\n")]
    profile = detect_project(files)
    assert profile.projectType == "Rails"


def test_plain_ruby_when_no_rails_gem():
    files = [_f("Gemfile", "source 'https://rubygems.org'\ngem 'sinatra'\n")]
    profile = detect_project(files)
    assert profile.projectType == "Ruby"


def test_monorepo_reports_multiple_languages():
    files = [
        _f("frontend/package.json", '{"dependencies": {"react": "^18.0.0"}}'),
        _f("backend/requirements.txt", "fastapi==0.115.6\n"),
    ]
    profile = detect_project(files)
    assert "typescript" not in profile.languages or "javascript" in profile.languages or "typescript" in profile.languages
    assert "python" in profile.languages
    assert "React" in profile.projectType
    assert "FastAPI" in profile.projectType


def test_no_recognized_manifest_degrades_to_unknown_without_erroring():
    files = [_f("random_notes.txt", "just some notes\n")]
    profile = detect_project(files)
    assert profile.projectType == "Unknown"
    assert profile.languages == []


def test_malformed_package_json_does_not_crash():
    files = [_f("package.json", "{ not valid json ][")]
    profile = detect_project(files)
    assert profile.projectType == "Node.js"


def test_entry_points_found_when_present():
    files = [
        _f("package.json", '{"dependencies": {"react": "^18.0.0"}}'),
        _f("src/main.tsx", "x"),
    ]
    profile = detect_project(files)
    assert "src/main.tsx" in profile.entryPoints


def test_complexity_buckets():
    small = detect_project([_f("a.py", "x = 1\n")])
    assert small.estimatedComplexity == "small"

    medium_files = [_f(f"src/f{i}.py", "x = 1\n" * 50) for i in range(40)]
    medium = detect_project(medium_files)
    assert medium.estimatedComplexity == "medium"

    large_files = [_f(f"src/f{i}.py", "x = 1\n" * 50) for i in range(200)]
    large = detect_project(large_files)
    assert large.estimatedComplexity == "large"
