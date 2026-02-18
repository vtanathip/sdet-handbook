"""Pytest configuration and fixtures for LLM evaluation tests."""

import pytest
from deepeval.test_case import LLMTestCase

from llm_evaluation.sample_data import SAMPLE_RAG_CASES, SAMPLE_QUALITY_CASES


@pytest.fixture
def simple_test_case() -> LLMTestCase:
    """A simple test case for basic evaluations."""
    return LLMTestCase(
        input="What is the return policy?",
        actual_output="You can return items within 30 days for a full refund.",
        expected_output="Items can be returned within 30 days.",
    )


@pytest.fixture
def rag_test_case() -> LLMTestCase:
    """A test case with retrieval context for RAG evaluations."""
    data = SAMPLE_RAG_CASES[0]
    return LLMTestCase(
        input=data["input"],
        actual_output=data["actual_output"],
        expected_output=data["expected_output"],
        retrieval_context=data["retrieval_context"],
    )


@pytest.fixture
def rag_test_cases() -> list[LLMTestCase]:
    """Multiple RAG test cases for batch evaluation."""
    return [
        LLMTestCase(
            input=case["input"],
            actual_output=case["actual_output"],
            expected_output=case["expected_output"],
            retrieval_context=case["retrieval_context"],
        )
        for case in SAMPLE_RAG_CASES
    ]


@pytest.fixture
def quality_test_cases() -> dict[str, LLMTestCase]:
    """Test cases for quality metrics (hallucination, toxicity, bias)."""
    return {
        case["name"]: LLMTestCase(
            input=case["input"],
            actual_output=case["actual_output"],
            context=case["context"] if case["context"] else None,
        )
        for case in SAMPLE_QUALITY_CASES
    }
