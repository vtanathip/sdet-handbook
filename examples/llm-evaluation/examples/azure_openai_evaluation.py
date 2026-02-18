"""LLM Evaluation using Azure OpenAI as the judge model.

This example demonstrates how to use Azure OpenAI instead of OpenAI
for evaluation. This is useful for:
- Enterprise environments with Azure compliance requirements
- Organizations using Azure as their cloud provider
- Leveraging existing Azure OpenAI deployments

Prerequisites:
1. Azure OpenAI resource with a deployed model (e.g., gpt-4)
2. Set environment variables:
   - AZURE_OPENAI_API_KEY
   - AZURE_OPENAI_ENDPOINT
   - AZURE_OPENAI_DEPLOYMENT_NAME

Run: uv run python examples/azure_openai_evaluation.py
"""

from llm_evaluation.custom_models import AzureOpenAIModel
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from deepeval.metrics import AnswerRelevancyMetric, GEval
from deepeval import evaluate
import os
import sys

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


def check_azure_config():
    """Verify Azure OpenAI configuration is set."""
    required_vars = [
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_DEPLOYMENT_NAME",
    ]

    missing = [var for var in required_vars if not os.getenv(var)]

    if missing:
        print("Missing required environment variables:")
        for var in missing:
            print(f"  - {var}")
        print("\nPlease set these variables or copy .env.example to .env")
        return False
    return True


def evaluate_with_azure_geval():
    """Evaluate using G-Eval with Azure OpenAI as judge."""
    print("\n" + "=" * 60)
    print("G-Eval with Azure OpenAI")
    print("=" * 60)

    # Create Azure OpenAI model instance
    azure_model = AzureOpenAIModel()
    print(f"Using model: {azure_model.get_model_name()}")

    test_case = LLMTestCase(
        input="What are the benefits of cloud computing?",
        actual_output="Cloud computing offers scalability, cost savings, and flexibility. You can scale resources up or down based on demand and only pay for what you use.",
        expected_output="Cloud computing provides scalability, cost efficiency, and flexibility.",
    )

    # Create G-Eval metric with Azure OpenAI
    correctness = GEval(
        name="Correctness",
        criteria="Evaluate if the actual output correctly conveys the same information as the expected output.",
        evaluation_params=[
            LLMTestCaseParams.ACTUAL_OUTPUT,
            LLMTestCaseParams.EXPECTED_OUTPUT,
        ],
        threshold=0.6,
        model=azure_model,  # Use Azure OpenAI
    )

    correctness.measure(test_case)

    print(f"\nScore: {correctness.score}")
    print(f"Reason: {correctness.reason}")
    print(f"Passed: {correctness.is_successful()}")


def evaluate_with_azure_relevancy():
    """Evaluate using Answer Relevancy with Azure OpenAI."""
    print("\n" + "=" * 60)
    print("Answer Relevancy with Azure OpenAI")
    print("=" * 60)

    azure_model = AzureOpenAIModel()

    test_cases = [
        LLMTestCase(
            input="How do I reset my password?",
            actual_output="Go to Settings > Security > Reset Password and follow the prompts.",
            retrieval_context=[
                "Password Reset: Navigate to Settings, then Security, click Reset Password."
            ],
        ),
        LLMTestCase(
            input="What is the pricing?",
            actual_output="We offer three plans: Basic at $9/month, Pro at $29/month, and Enterprise with custom pricing.",
            retrieval_context=[
                "Pricing: Basic $9/mo, Pro $29/mo, Enterprise - contact sales"
            ],
        ),
    ]

    # Use Azure OpenAI for evaluation
    relevancy = AnswerRelevancyMetric(
        threshold=0.6,
        model=azure_model,
        include_reason=True,
    )

    results = evaluate(test_cases, [relevancy])
    print(f"\nResults: {results}")


def batch_evaluation_azure():
    """Run batch evaluation with Azure OpenAI."""
    print("\n" + "=" * 60)
    print("Batch Evaluation with Azure OpenAI")
    print("=" * 60)

    azure_model = AzureOpenAIModel()

    test_cases = [
        LLMTestCase(
            input="What programming languages do you support?",
            actual_output="We support Python, JavaScript, TypeScript, Go, and Rust.",
            retrieval_context=[
                "Supported languages: Python, JavaScript, TypeScript, Go, Rust, Java"],
        ),
        LLMTestCase(
            input="How long is the free trial?",
            actual_output="The free trial lasts 14 days with full feature access.",
            retrieval_context=[
                "Free Trial: 14 days, all features included, no credit card required"],
        ),
    ]

    metrics = [
        AnswerRelevancyMetric(threshold=0.5, model=azure_model),
        GEval(
            name="Completeness",
            criteria="Does the response fully answer the question asked?",
            evaluation_params=[LLMTestCaseParams.INPUT,
                               LLMTestCaseParams.ACTUAL_OUTPUT],
            threshold=0.5,
            model=azure_model,
        ),
    ]

    results = evaluate(test_cases, metrics)
    print(f"\nBatch Results: {results}")


if __name__ == "__main__":
    print("DeepEval with Azure OpenAI")
    print("=" * 60)

    if not check_azure_config():
        print("\nExiting due to missing configuration.")
        sys.exit(1)

    # Run examples
    evaluate_with_azure_geval()
    evaluate_with_azure_relevancy()
    batch_evaluation_azure()

    print("\n" + "=" * 60)
    print("Azure OpenAI evaluation completed!")
    print("=" * 60)
