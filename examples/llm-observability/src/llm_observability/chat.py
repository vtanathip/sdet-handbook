"""Interactive CLI chatbot with Phoenix observability tracing."""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.theme import Theme

from llm_observability.config import Config
from llm_observability.llm_backend import get_chat_model
from llm_observability.tracing import setup_tracing

# ── Rich console theme ──────────────────────────────────────────────────────

custom_theme = Theme(
    {
        "user": "bold cyan",
        "assistant": "bold green",
        "system": "dim yellow",
        "error": "bold red",
        "info": "dim white",
    }
)

console = Console(theme=custom_theme)

# ── Constants ────────────────────────────────────────────────────────────────

BANNER = r"""
╔══════════════════════════════════════════════════════════════╗
║          LLM Observability Chatbot  (Phoenix Tracing)       ║
╠══════════════════════════════════════════════════════════════╣
║  Commands:                                                   ║
║    /quit   – Exit the chatbot                                ║
║    /clear  – Clear conversation history                      ║
║    /traces – Show Phoenix UI URL                             ║
║    /config – Show current configuration                      ║
╚══════════════════════════════════════════════════════════════╝
"""

PHOENIX_UI_URL = "http://localhost:6006"


# ── Chat loop ────────────────────────────────────────────────────────────────


def print_banner(config: Config) -> None:
    """Print the welcome banner and current configuration summary."""
    console.print(BANNER, style="bold blue")
    console.print(
        f"  Provider : [bold]{config.llm_provider}[/bold]",
        style="info",
    )
    if config.llm_provider == "ollama":
        console.print(
            f"  Model    : [bold]{config.ollama_model}[/bold]",
            style="info",
        )
        console.print(
            f"  Ollama   : {config.ollama_base_url}",
            style="info",
        )
    else:
        console.print(
            f"  Model    : [bold]{config.azure_openai_deployment_name}[/bold]",
            style="info",
        )
        console.print(
            f"  Endpoint : {config.azure_openai_endpoint}",
            style="info",
        )
    console.print(
        f"  Phoenix  : {PHOENIX_UI_URL}",
        style="info",
    )
    console.print()


def handle_command(command: str, history: list, config: Config) -> bool:
    """Handle slash commands. Returns True if the chat loop should continue."""
    cmd = command.strip().lower()

    if cmd == "/quit":
        console.print("\nGoodbye! 👋\n", style="system")
        return False

    if cmd == "/clear":
        history.clear()
        console.print("Conversation history cleared.\n", style="system")
        return True

    if cmd == "/traces":
        console.print(
            Panel(
                f"Open Phoenix UI: [link={PHOENIX_UI_URL}]{PHOENIX_UI_URL}[/link]",
                title="Phoenix Traces",
                border_style="green",
            )
        )
        return True

    if cmd == "/config":
        console.print(
            Panel(
                f"Provider  : {config.llm_provider}\n"
                f"Model     : {config.ollama_model if config.llm_provider == 'ollama' else config.azure_openai_deployment_name}\n"
                f"Phoenix   : {config.phoenix_collector_endpoint}\n"
                f"Service   : {config.otel_service_name}",
                title="Current Configuration",
                border_style="cyan",
            )
        )
        return True

    console.print(f"Unknown command: {cmd}", style="error")
    return True


def chat_loop(config: Config) -> None:
    """Run the interactive multi-turn chat loop."""
    llm = get_chat_model(config)

    # Conversation history as LangChain messages
    history: list[SystemMessage | HumanMessage | AIMessage] = [
        SystemMessage(content=config.system_prompt),
    ]

    print_banner(config)

    while True:
        try:
            user_input = console.input("[user]You:[/user] ").strip()
        except (EOFError, KeyboardInterrupt):
            console.print("\nGoodbye! 👋\n", style="system")
            break

        if not user_input:
            continue

        # Handle slash commands
        if user_input.startswith("/"):
            should_continue = handle_command(user_input, history, config)
            if not should_continue:
                break
            continue

        # Append user message to history
        history.append(HumanMessage(content=user_input))

        # Call LLM with full conversation history
        with console.status("Thinking...", spinner="dots"):
            try:
                response = llm.invoke(history)
            except Exception as e:
                console.print(f"\n[error]Error:[/error] {e}\n")
                # Remove the failed user message from history
                history.pop()
                continue

        # Extract response content
        assistant_text = (
            response.content if isinstance(
                response, AIMessage) else str(response)
        )

        # Append assistant response to history
        history.append(AIMessage(content=assistant_text))

        # Render response as Markdown
        console.print()
        console.print(
            Panel(
                Markdown(assistant_text),
                title="[assistant]Assistant[/assistant]",
                border_style="green",
                padding=(1, 2),
            )
        )
        console.print()


# ── Entry point ──────────────────────────────────────────────────────────────


def main() -> None:
    """Application entry point."""
    config = Config.from_env()

    # Initialise Phoenix tracing before any LLM calls
    console.print("Initialising Phoenix tracing...", style="system")
    setup_tracing(
        endpoint=config.phoenix_collector_endpoint,
        service_name=config.otel_service_name,
    )
    console.print(
        "Tracing active. Spans are being sent to Phoenix.\n", style="system")

    chat_loop(config)


if __name__ == "__main__":
    main()
