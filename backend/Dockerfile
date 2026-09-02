# Backend image for the hub deployment only. Desktop installs run from source
# via launcher.py and never use this.
#
# Build context is the repo root: docker build -f backend/Dockerfile .
FROM node:22-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Mode "hub" selects .env.hub — same-origin API, wss:// sockets.
RUN npm run build -- --mode hub

FROM python:3.12-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies resolve from uv.lock in their own layer so source edits don't
# trigger a full reinstall.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/ .
COPY --from=frontend /build/dist ./static

ENV PATH="/opt/venv/bin:$PATH" \
    HOST=0.0.0.0 \
    PORT=8000 \
    STORAGE_ROOT=/data/documents

RUN groupadd -r app && useradd -r -g app app \
    && mkdir -p /data/documents \
    && chown -R app:app /data /app

USER app
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
