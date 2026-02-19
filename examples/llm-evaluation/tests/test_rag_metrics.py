"""RAG-specific metrics for evaluating Retrieval-Augmented Generation systems.

These metrics evaluate how well your RAG system:
1. Retrieves relevant context (Answer Relevancy)
2. Generates faithful responses based on context (Faithfulness)
3. Uses the right context for the query (Contextual Precision/Recall)

Reference: https://deepeval.com/docs/metrics-answer-relevancy
"""

import pytest
from deepeval import assert_test
from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric
from deepeval.test_case import LLMTestCase

from llm_evaluation.custom_models import OllamaModel


class TestAnswerRelevancy:
    """Test suite for Answer Relevancy metric.

    Answer Relevancy measures whether the LLM output is relevant to the input query.
    It's useful for ensuring your RAG system actually answers what was asked.
    """

    def test_relevant_answer(self, rag_test_case: LLMTestCase, ollama_model: OllamaModel):
        """Test that a relevant answer passes the threshold."""
        answer_relevancy = AnswerRelevancyMetric(
            threshold=0.7,
            include_reason=True,  # Get explanation for the score
            model=ollama_model,
        )
        assert_test(rag_test_case, [answer_relevancy])

    def test_highly_relevant_answer(self, ollama_model: OllamaModel):
        """Test a highly relevant, direct answer."""
        test_case = LLMTestCase(
            input="What time does the store close?",
            actual_output="The store closes at 9 PM on weekdays and 6 PM on weekends.",
            retrieval_context=[
                "Store hours: Monday-Friday 9AM-9PM, Saturday-Sunday 10AM-6PM"
            ],
        )

        answer_relevancy = AnswerRelevancyMetric(
            threshold=0.8, model=ollama_model)
        assert_test(test_case, [answer_relevancy])

    def test_partially_relevant_answer(self, ollama_model: OllamaModel):
        """Test an answer that's related but not fully on topic."""
        test_case = LLMTestCase(
            input="What is the price of the premium plan?",
            actual_output="Our premium plan includes unlimited storage, priority support, and advanced analytics. It's our most popular option for businesses.",
            retrieval_context=[
                "Premium Plan: $49.99/month - Includes unlimited storage, priority support, analytics"
            ],
        )

        # Lower threshold since the answer doesn't mention the price directly
        answer_relevancy = AnswerRelevancyMetric(
            threshold=0.5, model=ollama_model)
        assert_test(test_case, [answer_relevancy])


class TestFaithfulness:
    """Test suite for Faithfulness metric.

    Faithfulness measures whether the LLM output is factually consistent with
    the retrieval context. It helps detect hallucinations in RAG systems.
    """

    def test_faithful_response(self, rag_test_case: LLMTestCase, ollama_model: OllamaModel):
        """Test that a faithful response passes the threshold."""
        faithfulness = FaithfulnessMetric(
            threshold=0.7,
            include_reason=True,
            model=ollama_model,
        )
        assert_test(rag_test_case, [faithfulness])

    def test_grounded_response(self, ollama_model: OllamaModel):
        """Test a response fully grounded in context."""
        test_case = LLMTestCase(
            input="What are the system requirements?",
            actual_output="You need Windows 10 or macOS 12, 8GB RAM, and 2GB free disk space.",
            retrieval_context=[
                "System Requirements: Windows 10+ or macOS 12+, 8GB RAM minimum, 2GB disk space"
            ],
        )

        faithfulness = FaithfulnessMetric(threshold=0.8, model=ollama_model)
        assert_test(test_case, [faithfulness])

    def test_unfaithful_response_detection(self, ollama_model: OllamaModel):
        """Demonstrate detection of unfaithful (hallucinated) content."""
        test_case = LLMTestCase(
            input="What warranty do you offer?",
            actual_output="We offer a lifetime warranty with free repairs and a money-back guarantee.",
            retrieval_context=[
                "Warranty: 1-year limited warranty covering manufacturing defects only."
            ],
        )

        faithfulness = FaithfulnessMetric(threshold=0.7, model=ollama_model)

        # Measure without asserting - this should have a low score
        faithfulness.measure(test_case)
        print(f"Faithfulness Score: {faithfulness.score}")
        print(f"Reason: {faithfulness.reason}")

        # The score should be low because the output contradicts the context
        assert faithfulness.score < 0.5, "Expected low faithfulness for hallucinated content"


class TestMultipleRAGMetrics:
    """Test combining multiple RAG metrics for comprehensive evaluation."""

    def test_combined_rag_evaluation(self, rag_test_case: LLMTestCase, ollama_model: OllamaModel):
        """Run multiple RAG metrics together."""
        metrics = [
            AnswerRelevancyMetric(threshold=0.6, model=ollama_model),
            FaithfulnessMetric(threshold=0.6, model=ollama_model),
        ]
        assert_test(rag_test_case, metrics)

    @pytest.mark.parametrize("case_index", [0, 1, 2])
    def test_rag_metrics_batch(self, rag_test_cases: list[LLMTestCase], case_index: int, ollama_model: OllamaModel):
        """Parametrized test for batch RAG evaluation."""
        test_case = rag_test_cases[case_index]

        metrics = [
            AnswerRelevancyMetric(threshold=0.5, model=ollama_model),
            FaithfulnessMetric(threshold=0.5, model=ollama_model),
        ]
        assert_test(test_case, metrics)
