"""Centralized configuration loaded from environment variables."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field

from dotenv import load_dotenv


@dataclass
class Config:
    """Application configuration backed by environment variables."""

    # LLM provider selection
    llm_provider: str = "ollama"

    # Ollama settings
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.2"

    # Azure OpenAI settings
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_deployment_name: str = "gpt-4"
    azure_openai_api_version: str = "2024-02-15-preview"

    # Phoenix / OpenTelemetry settings
    phoenix_collector_endpoint: str = "http://phoenix:4317"
    otel_service_name: str = "llm-observability-chatbot"

    # Chatbot settings
    system_prompt: str = "You are a helpful AI assistant. Be concise and informative."

    # Resolved at runtime
    _errors: list[str] = field(default_factory=list, repr=False)

    @classmethod
    def from_env(cls) -> Config:
        """Load configuration from environment variables."""
        load_dotenv()

        cfg = cls(
            llm_provider=os.getenv("LLM_PROVIDER", "ollama").lower().strip(),
            ollama_base_url=os.getenv(
                "OLLAMA_BASE_URL", "http://host.docker.internal:11434"
            ),
            ollama_model=os.getenv("OLLAMA_MODEL", "llama3.2"),
            azure_openai_api_key=os.getenv("AZURE_OPENAI_API_KEY", ""),
            azure_openai_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            azure_openai_deployment_name=os.getenv(
                "AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4"
            ),
            azure_openai_api_version=os.getenv(
                "AZURE_OPENAI_API_VERSION", "2024-02-15-preview"
            ),
            phoenix_collector_endpoint=os.getenv(
                "PHOENIX_COLLECTOR_ENDPOINT", "http://phoenix:4317"
            ),
            otel_service_name=os.getenv(
                "OTEL_SERVICE_NAME", "llm-observability-chatbot"
            ),
            system_prompt=os.getenv(
                "SYSTEM_PROMPT",
                "You are a helpful AI assistant. Be concise and informative.",
            ),
        )
        cfg.validate()
        return cfg

    def validate(self) -> None:
        """Validate configuration and exit on errors."""
        if self.llm_provider not in ("ollama", "azure_openai"):
            self._errors.append(
                f"LLM_PROVIDER must be 'ollama' or 'azure_openai', "
                f"got '{self.llm_provider}'"
            )

        if self.llm_provider == "azure_openai":
            if not self.azure_openai_api_key:
                self._errors.append(
                    "AZURE_OPENAI_API_KEY is required when LLM_PROVIDER=azure_openai"
                )
            if not self.azure_openai_endpoint:
                self._errors.append(
                    "AZURE_OPENAI_ENDPOINT is required when LLM_PROVIDER=azure_openai"
                )

        if self._errors:
            print("Configuration errors:", file=sys.stderr)
            for err in self._errors:
                print(f"  - {err}", file=sys.stderr)
            sys.exit(1)
