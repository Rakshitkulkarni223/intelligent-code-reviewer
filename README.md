# 24/7 Intelligent Code Reviewer

See [PLAN.md](PLAN.md) for the full phased build plan and architecture.

## Current status

Local-first MVP slice: full UI (auth, dashboard, editor, progress, results, history), a
FastAPI backend with async-style processing (in-process queue standing in for Pub/Sub),
a rule-based mock analyzer standing in for Gemini, and category-based historical rule
retrieval standing in for Vertex AI Vector Search. Every local stand-in is marked with a
`ponytail:` comment at its definition explaining what it replaces and when.

No GCP resources are used yet -- see PLAN.md Phase 10 (blocked on sandbox access).

## Run locally

Requires Node 18+ and Python 3.10+.

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Runs on http://localhost:8000. Health check: `GET /health`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:5173. Sign in with any email (dev-only stub auth -- see
`frontend/src/services/auth.tsx`).

### Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

### Docker Compose

```bash
docker compose up --build
```

Frontend on :4173, backend on :8000.
