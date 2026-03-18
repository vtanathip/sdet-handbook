"""Phoenix observability tracing setup.

Configures OpenTelemetry with the Arize Phoenix OTEL helper
and instruments LangChain for automatic span capture.
"""

from __future__ import annotations

from phoenix.otel import register
from openinference.instrumentation.langchain import LangChainInstrumentor


def setup_tracing(endpoint: str, service_name: str) -> None:
    """Initialise Phoenix tracing and instrument LangChain.

    Args:
        endpoint: OTLP gRPC collector endpoint (e.g. http://phoenix:4317).
        service_name: Logical service name shown in Phoenix UI.
    """
    # Register the OpenTelemetry TracerProvider with Phoenix OTLP exporter
    tracer_provider = register(
        endpoint=endpoint,
        project_name=service_name,
    )

    # Auto-instrument all LangChain components (LLM calls, chains, etc.)
    LangChainInstrumentor().instrument(tracer_provider=tracer_provider)
