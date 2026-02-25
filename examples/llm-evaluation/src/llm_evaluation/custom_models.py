"""Custom LLM model implementations for different providers.

This module provides custom LLM classes for use with DeepEval metrics
when you want to use providers other than the default OpenAI.
"""

import os
from typing import Any

from deepeval.models import DeepEvalBaseLLM


class AzureOpenAIModel(DeepEvalBaseLLM):
    """Custom LLM class for Azure OpenAI integration.

    Environment variables required:
        - AZURE_OPENAI_API_KEY
        - AZURE_OPENAI_ENDPOINT
        - AZURE_OPENAI_DEPLOYMENT_NAME
        - AZURE_OPENAI_API_VERSION (optional, defaults to 2024-02-15-preview)
    """

    def __init__(
        self,
        deployment_name: str | None = None,
        api_version: str | None = None,
    ):
        self.deployment_name = deployment_name or os.getenv(
            "AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4")
        self.api_version = api_version or os.getenv(
            "AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
        self._client = None

    def load_model(self) -> Any:
        """Load and return the Azure OpenAI client."""
        if self._client is None:
            from openai import AzureOpenAI

            self._client = AzureOpenAI(
                api_key=os.getenv("AZURE_OPENAI_API_KEY"),
                api_version=self.api_version,
                azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            )
        return self._client

    def generate(self, prompt: str) -> str:
        """Generate a response from Azure OpenAI."""
        client = self.load_model()
        response = client.chat.completions.create(
            model=self.deployment_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
        )
        return response.choices[0].message.content

    async def a_generate(self, prompt: str) -> str:
        """Async generate - falls back to sync for simplicity."""
        return self.generate(prompt)

    def get_model_name(self) -> str:
        """Return the model name."""
        return f"azure/{self.deployment_name}"


class OllamaModel(DeepEvalBaseLLM):
    """Custom LLM class for Ollama (local models) integration.

    Environment variables:
        - OLLAMA_BASE_URL (optional, defaults to http://localhost:11434)
        - OLLAMA_MODEL (optional, defaults to llama3.2)

    Prerequisites:
        1. Install Ollama: https://ollama.ai
        2. Pull a model: ollama pull llama3.2
        3. Start Ollama server: ollama serve
    """

    def __init__(
        self,
        model_name: str | None = None,
        base_url: str | None = None,
        enforce_json: bool = True,
    ):
        self.model_name = model_name or os.getenv("OLLAMA_MODEL", "llama3.2")
        self.base_url = base_url or os.getenv(
            "OLLAMA_BASE_URL", "http://localhost:11434")
        self.enforce_json = enforce_json

    def load_model(self) -> Any:
        """Return model configuration (Ollama uses HTTP API)."""
        return {"model": self.model_name, "base_url": self.base_url}

    def generate(self, prompt: str) -> str:
        """Generate a response from Ollama."""
        import requests

        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
        }

        # Enable JSON mode when the prompt expects JSON output
        # This forces Ollama to generate valid JSON
        if self.enforce_json and self._prompt_expects_json(prompt):
            payload["format"] = "json"

        response = requests.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["response"]

    def _prompt_expects_json(self, prompt: str) -> bool:
        """Check if the prompt expects JSON output."""
        json_indicators = ["json", "JSON", "{", "schema", "format"]
        return any(indicator in prompt for indicator in json_indicators)

    async def a_generate(self, prompt: str) -> str:
        """Async generate - falls back to sync for simplicity."""
        return self.generate(prompt)

    def get_model_name(self) -> str:
        """Return the model name."""
        return f"ollama/{self.model_name}"


def get_azure_model() -> AzureOpenAIModel:
    """Factory function to create an Azure OpenAI model instance."""
    return AzureOpenAIModel()


def get_ollama_model(model_name: str = "llama3.2") -> OllamaModel:
    """Factory function to create an Ollama model instance."""
    return OllamaModel(model_name=model_name)
