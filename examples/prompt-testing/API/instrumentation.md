# src/instrumentation.ts

## Purpose
Bootstraps OpenTelemetry tracing and auto-instruments all Azure OpenAI API calls via Arize Phoenix OpenInference. Imported once as a side-effect by `azure-client.ts`.

## How it works
1. Creates a `NodeTracerProvider` with a `SimpleSpanProcessor` that exports spans via OTLP to Phoenix.
2. Registers `OpenAIInstrumentation` — every `chatMini` and `chatFull` call becomes a traced span automatically, including prompts, completions, token counts, and latency.

## Configuration
| Environment Variable | Default | Description |
|---|---|---|
| `PHOENIX_ENDPOINT` | `http://localhost:6006` | Base URL of the Arize Phoenix server |

## What you see in Phoenix per test run
- Full prompt/completion for each AI call
- Token counts (input / output / total)
- Latency per span
- Parent/child span relationships per test step

## Dependency
Must be started before any OpenAI client is constructed. `azure-client.ts` ensures this by importing it at the top of the file.
