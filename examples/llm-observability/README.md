# LLM Observability – Phoenix Tracing Demo

A Dockerised CLI chatbot instrumented with **Arize Phoenix** for LLM observability.
Uses **LangChain** with configurable backends (**Ollama** on host or **Azure OpenAI**).
Phoenix runs as a separate container, collecting OpenTelemetry traces and exposing
a rich UI for exploring LLM spans, token usage, latency, and conversation threads.

## Architecture

```
┌──────────────────────┐     OTLP/gRPC (4317)     ┌──────────────────────┐
│   chatbot (app)      │ ──────────────────────►   │   Phoenix Server     │
│   Python + LangChain │                           │   :6006 (UI)         │
│   + OpenTelemetry    │                           │   :4317 (collector)  │
└──────────┬───────────┘                           └──────────────────────┘
           │ LLM API calls
           ▼
┌──────────────────────┐
│  Ollama (host)       │  ◄── or Azure OpenAI (cloud)
│  host.docker.internal│
│  :11434              │
└──────────────────────┘
```

## Prerequisites

| Requirement              | Notes                                                 |
| ------------------------ | ----------------------------------------------------- |
| Docker & Docker Compose  | v2+ recommended                                       |
| Ollama (on host)         | Required only when `LLM_PROVIDER=ollama`              |
| Azure OpenAI credentials | Required only when `LLM_PROVIDER=azure_openai`        |

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set LLM_PROVIDER and provider-specific variables
```

### 2. Start Phoenix

```bash
docker compose up -d phoenix
```

Phoenix UI is now available at **http://localhost:6006**.

### 3. Run the chatbot

```bash
docker compose run --rm chatbot
```

This builds the image (first time) and drops you into an interactive CLI session.

### 4. Chat & observe

Type messages in the terminal. After a few exchanges, open the Phoenix UI to see
traces with:

- **LLM spans** – model name, prompt/completion tokens, latency
- **Input/output messages** – full conversation payloads
- **Conversation threads** – linked multi-turn interactions
- **Chain spans** – LangChain component hierarchy

## CLI Commands

| Command   | Description                        |
| --------- | ---------------------------------- |
| `/quit`   | Exit the chatbot                   |
| `/clear`  | Clear conversation history         |
| `/traces` | Print Phoenix UI URL               |
| `/config` | Show current configuration summary |

## Environment Variables

| Variable                         | Default                              | Description                     |
| -------------------------------- | ------------------------------------ | ------------------------------- |
| `LLM_PROVIDER`                   | `ollama`                             | `ollama` or `azure_openai`      |
| `OLLAMA_BASE_URL`                | `http://host.docker.internal:11434`  | Ollama server URL               |
| `OLLAMA_MODEL`                   | `llama3.2`                           | Ollama model name               |
| `AZURE_OPENAI_API_KEY`           | –                                    | Azure OpenAI API key            |
| `AZURE_OPENAI_ENDPOINT`          | –                                    | Azure OpenAI resource endpoint  |
| `AZURE_OPENAI_DEPLOYMENT_NAME`   | `gpt-4`                              | Azure OpenAI deployment name    |
| `AZURE_OPENAI_API_VERSION`       | `2024-02-15-preview`                 | Azure OpenAI API version        |
| `PHOENIX_COLLECTOR_ENDPOINT`     | `http://phoenix:4317`                | Phoenix OTLP gRPC endpoint      |
| `OTEL_SERVICE_NAME`              | `llm-observability-chatbot`          | Service name in Phoenix UI      |
| `SYSTEM_PROMPT`                  | `You are a helpful AI assistant...`  | System prompt for the chatbot   |

## Services & Ports

| Service  | Port | Description                              |
| -------- | ---- | ---------------------------------------- |
| Phoenix  | 6006 | Observability UI – traces & analytics    |
| Phoenix  | 4317 | OTLP gRPC collector (internal)           |

## Project Structure

```
llm-observability/
├── .env.example                    # Environment variable template
├── .gitignore
├── docker-compose.yaml             # Phoenix + chatbot services
├── Dockerfile                      # Python app with uv
├── pyproject.toml                  # Project config (hatchling + uv)
├── uv.lock                         # Locked dependencies
├── README.md
└── src/
    └── llm_observability/
        ├── __init__.py
        ├── config.py               # Centralised env-var configuration
        ├── tracing.py              # Phoenix/OTel tracing setup
        ├── llm_backend.py          # LangChain LLM factory (Ollama / Azure)
        └── chat.py                 # Interactive CLI chatbot
```

## What Phoenix Shows You

Once traces flow in, the Phoenix UI provides:

- **Traces view** – Timeline of every LLM call with latency, status, and token counts
- **Span details** – Full input/output payloads for each LangChain component
- **Evaluations** – Built-in or custom evaluators on traced data
- **Embeddings** – Visualise embedding spaces (when using retrieval)
- **Projects** – Organise traces by service/environment

## Stopping

```bash
# Stop all services
docker compose down

# Stop and remove persisted Phoenix data
docker compose down -v
```
