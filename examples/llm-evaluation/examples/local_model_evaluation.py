"""LLM Evaluation using local models (Ollama) as the judge.

This example demonstrates how to use locally-hosted LLMs for evaluation,
which is useful for:
- Privacy-sensitive evaluations (no data sent to cloud)
- Cost savings (no API fees)
- Offline environments
- Experimenting with different open-source models

Prerequisites:
1. Install Ollama: https://ollama.ai
2. Pull a model: ollama pull llama3.2
3. Start Ollama server: ollama serve (runs on http://localhost:11434)

Run: uv run python examples/local_model_evaluation.py
"""

from llm_evaluation.custom_models import OllamaModel
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from deepeval.metrics import GEval
from deepeval import evaluate
import os
import sys

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


def check_ollama_available():
    """Check if Ollama is running and accessible."""
    import requests

    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

    try:
        response = requests.get(f"{base_url}/api/tags", timeout=5)
        if response.status_code == 200:
            models = response.json().get("models", [])
            print(f"Ollama is running at {base_url}")
            print(f"Available models: {[m['name'] for m in models]}")
            return True
    except requests.exceptions.ConnectionError:
        pass

    print(f"Could not connect to Ollama at {base_url}")
    print("\nTo start Ollama:")
    print("  1. Install Ollama: https://ollama.ai")
    print("  2. Pull a model: ollama pull llama3.2")
    print("  3. Start server: ollama serve")
    return False


def evaluate_with_ollama():
    """Basic evaluation using Ollama."""
    print("\n" + "=" * 60)
    print("G-Eval with Ollama (Local Model)")
    print("=" * 60)

    # Create Ollama model instance
    model_name = os.getenv("OLLAMA_MODEL", "llama3.2")
    ollama_model = OllamaModel(model_name=model_name)
    print(f"Using model: {ollama_model.get_model_name()}")

    test_case = LLMTestCase(
        input="What is Python used for?",
        actual_output="Python is used for web development, data analysis, machine learning, automation, and scripting.",
        expected_output="Python is a versatile programming language used in many domains.",
    )

    # G-Eval with local model
    correctness = GEval(
        name="Correctness",
        criteria="Evaluate if the actual output correctly answers the question and aligns with the expected output.",
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.EXPECTED_OUTPUT,
        ],
        threshold=0.5,
        model=ollama_model,
    )

    print("\nRunning evaluation (this may take a moment with local models)...")
    correctness.measure(test_case)

    print(f"\nScore: {correctness.score}")
    print(f"Reason: {correctness.reason}")
    print(f"Passed: {correctness.is_successful()}")


def evaluate_clarity_local():
    """Evaluate response clarity with local model."""
    print("\n" + "=" * 60)
    print("Clarity Evaluation with Local Model")
    print("=" * 60)

    ollama_model = OllamaModel()

    test_case = LLMTestCase(
        input="Explain what an API is to a beginner.",
        actual_output="An API is like a waiter in a restaurant. You tell the waiter what you want, they go to the kitchen, and bring back your food. Similarly, an API takes your request, sends it to a server, and returns the response.",
    )

    clarity = GEval(
        name="Clarity",
        criteria="""Evaluate the clarity of this explanation for a beginner:
        1. Is it easy to understand?
        2. Does it use a good analogy?
        3. Is it free of technical jargon?""",
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
        ],
        threshold=0.6,
        model=ollama_model,
    )

    print("Running clarity evaluation...")
    clarity.measure(test_case)

    print(f"\nClarity Score: {clarity.score}")
    print(f"Reason: {clarity.reason}")


def compare_responses_local():
    """Compare multiple responses using local model."""
    print("\n" + "=" * 60)
    print("Comparing Responses with Local Model")
    print("=" * 60)

    ollama_model = OllamaModel()

    responses = [
        ("Good", "Machine learning is teaching computers to learn from data."),
        ("Verbose", "Machine learning, which is a subset of artificial intelligence, involves the development of algorithms and statistical models that enable computers to perform specific tasks without explicit instructions, instead relying on patterns and inference derived from data."),
        ("Too Simple", "Computers learn stuff."),
    ]

    for label, response in responses:
        test_case = LLMTestCase(
            input="Explain machine learning simply.",
            actual_output=response,
        )

        quality = GEval(
            name="Response Quality",
            criteria="""Evaluate the response quality:
            1. Is it accurate?
            2. Is it appropriately detailed (not too simple, not too verbose)?
            3. Is it easy to understand?""",
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
            ],
            threshold=0.5,
            model=ollama_model,
        )

        quality.measure(test_case)
        print(f"\n[{label}] Score: {quality.score:.2f} - {response[:50]}...")


def batch_evaluation_local():
    """Run batch evaluation with local model."""
    print("\n" + "=" * 60)
    print("Batch Evaluation with Local Model")
    print("=" * 60)

    ollama_model = OllamaModel()

    test_cases = [
        LLMTestCase(
            input="What is 2 + 2?",
            actual_output="4",
            expected_output="The answer is 4.",
        ),
        LLMTestCase(
            input="What color is the sky?",
            actual_output="The sky is blue during the day.",
            expected_output="Blue",
        ),
    ]

    correctness = GEval(
        name="Correctness",
        criteria="Is the actual output factually correct and aligned with the expected output?",
        evaluation_params=[
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.EXPECTED_OUTPUT,
        ],
        threshold=0.5,
        model=ollama_model,
    )

    print("Running batch evaluation...")
    results = evaluate(test_cases, [correctness])
    print(f"\nResults: {results}")


if __name__ == "__main__":
    print("DeepEval with Local Models (Ollama)")
    print("=" * 60)

    if not check_ollama_available():
        print("\nExiting due to Ollama not being available.")
        sys.exit(1)

    # Run examples
    evaluate_with_ollama()
    evaluate_clarity_local()
    compare_responses_local()
    batch_evaluation_local()

    print("\n" + "=" * 60)
    print("Local model evaluation completed!")
    print("=" * 60)
