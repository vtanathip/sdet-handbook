# ── LLM Observability Chatbot ───────────────────────────────────────────────
# Multi-stage build with uv for fast, reproducible installs.
# ────────────────────────────────────────────────────────────────────────────

FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install uv
RUN pip install --no-cache-dir uv

WORKDIR /app

# ── Dependencies layer (cached unless pyproject.toml / uv.lock change) ─────

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev

# ── Application code ───────────────────────────────────────────────────────

COPY src/ src/

# ── Runtime ────────────────────────────────────────────────────────────────

ENTRYPOINT ["uv", "run", "llm-chat"]
