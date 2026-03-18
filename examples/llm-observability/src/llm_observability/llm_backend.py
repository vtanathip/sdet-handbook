"""LLM backend factory – returns a LangChain chat model based on config."""

from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel

from llm_observability.config import Config


def get_chat_model(config: Config) -> BaseChatModel:
    """Create and return a LangChain chat model for the configured provider.

    Args:
        config: Application configuration.

    Returns:
        A LangChain BaseChatModel instance.

    Raises:
        ValueError: If the provider is not supported.
    """
    if config.llm_provider == "ollama":
        return _create_ollama_model(config)
    elif config.llm_provider == "azure_openai":
        return _create_azure_openai_model(config)
    else:
        raise ValueError(f"Unsupported LLM provider: {config.llm_provider}")


def _create_ollama_model(config: Config) -> BaseChatModel:
    """Create a ChatOllama instance."""
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=config.ollama_model,
        base_url=config.ollama_base_url,
    )


def _create_azure_openai_model(config: Config) -> BaseChatModel:
    """Create an AzureChatOpenAI instance."""
    from langchain_openai import AzureChatOpenAI

    return AzureChatOpenAI(
        azure_deployment=config.azure_openai_deployment_name,
        api_key=config.azure_openai_api_key,
        azure_endpoint=config.azure_openai_endpoint,
        api_version=config.azure_openai_api_version,
    )
