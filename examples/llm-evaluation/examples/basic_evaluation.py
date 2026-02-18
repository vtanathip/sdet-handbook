"""Basic LLM Evaluation without Pytest integration.

This example shows how to use DeepEval's evaluate() function directly,
which is useful for:
- Jupyter notebooks
- Quick experiments
- Integration into existing pipelines

Run: uv run python examples/basic_evaluation.py
"""

from deepeval import evaluate
from deepeval.metrics import (
    AnswerRelevancyMetric,
    FaithfulnessMetric,
    GEval,
)
from deepeval.test_case import LLMTestCase, LLMTestCaseParams


def create_sample_test_cases() -> list[LLMTestCase]:
    """Create sample test cases for demonstration."""
    return [
        LLMTestCase(
            input="What is the refund policy?",
            actual_output="You can get a full refund within 30 days of purchase.",
            expected_output="30-day full refund available.",
            retrieval_context=[
                "Refund Policy: All customers are eligible for a 30-day full refund."
            ],
        ),
        LLMTestCase(
            input="How do I contact support?",
            actual_output="You can reach our support team via email at support@example.com or call 1-800-SUPPORT.",
            expected_output="Contact support via email or phone.",
            retrieval_context=[
                "Support: Email support@example.com or call 1-800-SUPPORT (24/7)"
            ],
        ),
        LLMTestCase(
            input="What payment methods are accepted?",
            actual_output="We accept Visa, MasterCard, PayPal, and Apple Pay.",
            expected_output="Credit cards and digital wallets accepted.",
            retrieval_context=[
                "Payment Methods: Visa, MasterCard, American Express, PayPal, Apple Pay, Google Pay"
            ],
        ),
    ]


def evaluate_with_single_metric():
    """Evaluate test cases with a single metric."""
    print("\n" + "=" * 60)
    print("Evaluation with Single Metric (Answer Relevancy)")
    print("=" * 60)

    test_cases = create_sample_test_cases()
    metric = AnswerRelevancyMetric(threshold=0.7)

    results = evaluate(test_cases, [metric])

    print(f"\nTotal test cases: {len(test_cases)}")
    print(f"Results: {results}")


def evaluate_with_multiple_metrics():
    """Evaluate test cases with multiple metrics."""
    print("\n" + "=" * 60)
    print("Evaluation with Multiple Metrics (RAG Suite)")
    print("=" * 60)

    test_cases = create_sample_test_cases()

    metrics = [
        AnswerRelevancyMetric(threshold=0.6),
        FaithfulnessMetric(threshold=0.6),
    ]

    results = evaluate(test_cases, metrics)
    print(f"\nResults: {results}")


def evaluate_with_geval():
    """Evaluate using custom G-Eval criteria."""
    print("\n" + "=" * 60)
    print("Evaluation with Custom G-Eval Metric")
    print("=" * 60)

    test_case = LLMTestCase(
        input="Explain machine learning in simple terms.",
        actual_output="Machine learning is like teaching a computer to learn from examples. Instead of programming exact rules, you show it many examples and it figures out the patterns on its own.",
    )

    clarity_metric = GEval(
        name="Clarity",
        criteria="""Evaluate the clarity of the explanation:
        1. Is it easy to understand for a non-technical person?
        2. Does it use helpful analogies?
        3. Is it free of jargon?""",
        evaluation_params=[
            LLMTestCaseParams.INPUT,
            LLMTestCaseParams.ACTUAL_OUTPUT,
        ],
        threshold=0.7,
    )

    # Measure single test case
    clarity_metric.measure(test_case)

    print(f"\nClarity Score: {clarity_metric.score}")
    print(f"Reason: {clarity_metric.reason}")
    print(f"Passed: {clarity_metric.is_successful()}")


def standalone_metric_usage():
    """Demonstrate using metrics standalone without evaluate()."""
    print("\n" + "=" * 60)
    print("Standalone Metric Usage")
    print("=" * 60)

    test_case = LLMTestCase(
        input="What is Python?",
        actual_output="Python is a programming language.",
        retrieval_context=[
            "Python is a high-level, interpreted programming language."],
    )

    # Use metric directly
    relevancy = AnswerRelevancyMetric(threshold=0.5)
    relevancy.measure(test_case)

    print(f"\nMetric: {relevancy.__class__.__name__}")
    print(f"Score: {relevancy.score}")
    print(f"Threshold: {relevancy.threshold}")
    print(f"Passed: {relevancy.is_successful()}")
    if relevancy.reason:
        print(f"Reason: {relevancy.reason}")


if __name__ == "__main__":
    print("DeepEval Basic Evaluation Examples")
    print("=" * 60)
    print("Make sure OPENAI_API_KEY is set in your environment")

    # Run all examples
    standalone_metric_usage()
    evaluate_with_single_metric()
    evaluate_with_multiple_metrics()
    evaluate_with_geval()

    print("\n" + "=" * 60)
    print("All examples completed!")
    print("=" * 60)
