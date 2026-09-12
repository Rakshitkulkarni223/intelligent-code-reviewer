# Build context is the repo root (see docker-compose.yml), because this image
# needs both backend/ and the shared data/ directory.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY data /data

ENV HISTORICAL_DATA_PATH=/data/historical-review-rules.csv
EXPOSE 8080

# Cloud Run injects $PORT (8080) and expects the container to listen on it;
# local docker-compose maps 8000:8000 so PORT there is set to 8000 explicitly.
# Shell form (not exec array form) so ${PORT} actually expands.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
