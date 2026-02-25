# LLM Evaluation with DeepEval

A minimal demonstration project for evaluating LLM outputs using the [DeepEval](https://github.com/confident-ai/deepeval) framework.

## What is DeepEval?

DeepEval is an open-source LLM evaluation framework similar to Pytest but specialized for testing LLM outputs. It uses LLM-as-a-judge and NLP models to evaluate responses based on metrics like correctness, relevancy, faithfulness, and safety.

## How LLM-as-Judge Works

LLM evaluation involves **two LLMs** working together:

| Role | Description | Examples |
|------|-------------|----------|
| **LLM Being Tested** | Your application that generates responses | Your chatbot, RAG pipeline, AI assistant |
| **Judge LLM** | Evaluates if those responses are good | GPT-4, Ollama, Azure OpenAI |

### Evaluation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. YOUR LLM APP generates a response                               │
│     Input: "What is the refund policy?"                             │
│     Output: "You can get a full refund within 30 days."             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. JUDGE LLM evaluates the response                                │
│     "Is this relevant? Is it correct? Is it faithful to context?"  │
│     Using metrics: AnswerRelevancy, Faithfulness, G-Eval, etc.      │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. Returns evaluation score (0.0 - 1.0)                            │
│     Score: 0.85 → Threshold: 0.7 → ✅ PASS                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Code Example

```python
from deepeval import evaluate
from deepeval.metrics import AnswerRelevancyMetric
from deepeval.test_case import LLMTestCase

# 1. Capture output from YOUR LLM app (hardcoded here for demo)
test_case = LLMTestCase(
    input="What is the refund policy?",
    actual_output="You can get a full refund within 30 days.",  # ← Your app's response
    retrieval_context=["Refund Policy: 30-day full refund available."],
)

# 2. Judge LLM evaluates if the response is relevant
metric = AnswerRelevancyMetric(threshold=0.7)  # Uses GPT-4 by default

# 3. Run evaluation
metric.measure(test_case)
print(f"Score: {metric.score}")  # e.g., 0.85
print(f"Passed: {metric.is_successful()}")  # True if score >= threshold
```

### Choosing a Judge LLM

| Provider | Accuracy | Cost | Privacy | Setup |
|----------|----------|------|---------|-------|
| **OpenAI GPT-4** | ⭐⭐⭐ Best | $$ | Cloud | `OPENAI_API_KEY` |
| **Azure OpenAI** | ⭐⭐⭐ Best | $$ | Enterprise | Azure config |
| **Ollama (Local)** | ⭐⭐ Good | Free | ✅ Private | Install Ollama |

## Quick Start

### Prerequisites

- Python 3.9+
- [UV](https://docs.astral.sh/uv/) package manager
- OpenAI API key (or Azure OpenAI / Ollama for alternatives)

### Installation

```bash
# Clone and navigate to project
cd llm-evaluation

# Install dependencies with UV
uv sync

# Copy environment template and add your API key
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

### Run Tests

```bash
# Run all evaluation tests
uv run deepeval test run tests/

# Run specific test file
uv run deepeval test run tests/test_geval.py

# Run tests in parallel (faster)
uv run deepeval test run tests/ -n 4

# Run with verbose output
uv run deepeval test run tests/ -v
```

### Run Examples

```bash
# Basic evaluation without Pytest
uv run python examples/basic_evaluation.py

# Azure OpenAI evaluation (requires Azure config)
uv run python examples/azure_openai_evaluation.py

# Local model evaluation (requires Ollama)
uv run python examples/local_model_evaluation.py
```

## Metrics Overview

### G-Eval (Custom Criteria)

The most flexible metric - define any evaluation criteria using natural language.

```python
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCaseParams

correctness = GEval(
    name="Correctness",
    criteria="Is the output factually correct?",
    evaluation_params=[LLMTestCaseParams.ACTUAL_OUTPUT],
    threshold=0.7,
)
```

**Use cases:** Custom quality checks, domain-specific evaluation, style assessment

### Answer Relevancy

Measures whether the LLM output is relevant to the input query.

```python
from deepeval.metrics import AnswerRelevancyMetric

relevancy = AnswerRelevancyMetric(threshold=0.7)
```

**Use cases:** RAG systems, chatbots, Q&A applications

### Faithfulness

Checks if the output is factually consistent with the provided context.

```python
from deepeval.metrics import FaithfulnessMetric

faithfulness = FaithfulnessMetric(threshold=0.7)
```

**Use cases:** RAG systems, preventing hallucinations, fact-checking

### Hallucination

Detects fabricated or unsupported information in outputs.

```python
from deepeval.metrics import HallucinationMetric

hallucination = HallucinationMetric(threshold=0.5)
```

**Use cases:** Fact verification, content validation

### Toxicity & Bias

Safety metrics for detecting harmful or biased content.

```python
from deepeval.metrics import ToxicityMetric, BiasMetric

toxicity = ToxicityMetric(threshold=0.5)
bias = BiasMetric(threshold=0.5)
```

**Use cases:** Content moderation, safety guardrails, fairness checks

## Project Structure

```text
llm-evaluation/
├── pyproject.toml          # Project configuration (UV/pip)
├── .env.example            # Environment variables template
├── src/
│   └── llm_evaluation/
│       ├── sample_data.py    # Sample test cases
│       └── custom_models.py  # Azure/Ollama LLM implementations
├── tests/
│   ├── conftest.py           # Pytest fixtures
│   ├── test_geval.py         # G-Eval examples
│   ├── test_rag_metrics.py   # RAG metric examples
│   └── test_quality_metrics.py # Safety metric examples
└── examples/
    ├── basic_evaluation.py         # Standalone evaluation
    ├── azure_openai_evaluation.py  # Azure OpenAI integration
    └── local_model_evaluation.py   # Ollama/local model integration
```

## LLM Provider Configuration

### OpenAI (Default)

```bash
export OPENAI_API_KEY="sk-..."
```

### Azure OpenAI

```bash
export AZURE_OPENAI_API_KEY="your-key"
export AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/"
export AZURE_OPENAI_DEPLOYMENT_NAME="gpt-4"
```

### Ollama (Local)

```bash
# Install Ollama: https://ollama.ai
ollama pull llama3.2
ollama serve

# Optional: customize
export OLLAMA_BASE_URL="http://localhost:11434"
export OLLAMA_MODEL="llama3.2"
```

## Resources

- [DeepEval Documentation](https://deepeval.com/docs/getting-started)
- [DeepEval GitHub](https://github.com/confident-ai/deepeval)
- [Metrics Reference](https://deepeval.com/docs/metrics-introduction)
- [Confident AI Platform](https://confident-ai.com/) (optional cloud dashboard)

## License

MIT
