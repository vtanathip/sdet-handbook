"""G-Eval metric examples - the most flexible LLM evaluation metric.

G-Eval uses LLM-as-a-judge to evaluate outputs based on custom criteria.
This is useful when you need evaluation metrics specific to your use case.

Reference: https://deepeval.com/docs/metrics-llm-evals
"""

import pytest
from deepeval import assert_test
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

from llm_evaluation.custom_models import OllamaModel


class TestGEvalCorrectness:
    """Test suite demonstrating G-Eval for correctness evaluation."""

    def test_correctness_basic(self, simple_test_case: LLMTestCase, ollama_model: OllamaModel):
        """Evaluate if actual output is correct based on expected output."""
        correctness_metric = GEval(
            name="Correctness",
            criteria="Determine if the 'actual output' is correct based on the 'expected output'.",
            evaluation_params=[
                LLMTestCaseParams.ACTUAL_OUTPUT,
                LLMTestCaseParams.EXPECTED_OUTPUT,
            ],
            threshold=0.5,
            model=ollama_model,
        )
        assert_test(simple_test_case, [correctness_metric])

    def test_correctness_with_input_context(self, ollama_model: OllamaModel):
        """Evaluate correctness considering the original question."""
        test_case = LLMTestCase(
            input="What programming language is best for beginners?",
            actual_output="Python is often recommended for beginners due to its readable syntax and extensive learning resources.",
            expected_output="Python is good for beginners because of its simple syntax.",
        )

        correctness_metric = GEval(
            name="Correctness",
            criteria="""Evaluate if the actual output correctly answers the input question 
            and aligns with the expected output. Consider:
            1. Does it answer the question asked?
            2. Is the information accurate?
            3. Does it convey similar meaning to the expected output?""",
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
                LLMTestCaseParams.EXPECTED_OUTPUT,
            ],
            threshold=0.5,
            model=ollama_model,
        )
        assert_test(test_case, [correctness_metric])


class TestGEvalCustomCriteria:
    """Test suite demonstrating custom G-Eval criteria for various use cases."""

    def test_helpfulness(self, ollama_model: OllamaModel):
        """Evaluate how helpful a response is."""
        test_case = LLMTestCase(
            input="How do I improve my code quality?",
            actual_output="""Here are key practices to improve code quality:
            1. Write unit tests for your code
            2. Use meaningful variable and function names
            3. Follow consistent coding standards
            4. Conduct code reviews with peers
            5. Refactor regularly to reduce technical debt""",
        )

        helpfulness_metric = GEval(
            name="Helpfulness",
            criteria="""Evaluate how helpful the response is:
            1. Does it provide actionable advice?
            2. Is the information practical and applicable?
            3. Does it address the user's question comprehensively?""",
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
            ],
            threshold=0.6,
            model=ollama_model,
        )
        assert_test(test_case, [helpfulness_metric])

    def test_clarity(self, ollama_model: OllamaModel):
        """Evaluate clarity and readability of response."""
        test_case = LLMTestCase(
            input="Explain what an API is.",
            actual_output="An API (Application Programming Interface) is like a waiter in a restaurant. Just as a waiter takes your order to the kitchen and brings back food, an API takes your request to a system and returns the response. It's a way for different software applications to communicate with each other.",
        )

        clarity_metric = GEval(
            name="Clarity",
            criteria="""Evaluate the clarity of the response:
            1. Is the explanation easy to understand?
            2. Does it use appropriate analogies or examples?
            3. Is it free of unnecessary jargon?
            4. Is it well-structured?""",
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
            ],
            threshold=0.7,
            model=ollama_model,
        )
        assert_test(test_case, [clarity_metric])

    def test_conciseness(self, ollama_model: OllamaModel):
        """Evaluate if response is appropriately concise."""
        test_case = LLMTestCase(
            input="What is 2 + 2?",
            actual_output="4",
        )

        conciseness_metric = GEval(
            name="Conciseness",
            criteria="""Evaluate conciseness:
            1. Is the response appropriately brief for the question?
            2. Does it avoid unnecessary elaboration?
            3. Does it still provide a complete answer?""",
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
            ],
            threshold=0.7,
            model=ollama_model,
        )
        assert_test(test_case, [conciseness_metric])


class TestGEvalWithContext:
    """Test G-Eval with retrieval context for RAG systems."""

    def test_contextual_correctness(self, rag_test_case: LLMTestCase, ollama_model: OllamaModel):
        """Evaluate if response correctly uses the provided context."""
        contextual_correctness = GEval(
            name="Contextual Correctness",
            criteria="""Evaluate if the actual output correctly uses information from the retrieval context:
            1. Is the answer grounded in the provided context?
            2. Does it accurately represent the information from context?
            3. Does it avoid adding information not present in context?""",
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
                LLMTestCaseParams.RETRIEVAL_CONTEXT,
            ],
            threshold=0.6,
            model=ollama_model,
        )
        assert_test(rag_test_case, [contextual_correctness])
