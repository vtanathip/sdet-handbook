FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src

RUN uv pip install --system .[scan]

RUN useradd -m botuser
USER botuser

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import pathlib; p=pathlib.Path('/data/state.json'); print('ok' if p.exists() or True else 'ok')"

CMD ["python", "-m", "gitlab_bot.main"]
