# Build context is the repo root (see docker-compose.yml), because this image
# needs both backend/ and the shared data/ directory.
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY data /data

ENV HISTORICAL_DATA_PATH=/data/historical-review-rules.csv
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
