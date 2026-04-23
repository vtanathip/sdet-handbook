# Project Workflow

> How plain-English test steps become real browser interactions via AI.

---

## What is this project?

Instead of writing Playwright selectors by hand, you write test steps in natural language. The AI figures out *what* to click, *where* it is on the page, and *how* to interact with it — automatically.

```ts
// What you write
await step('Enter user@example.com in the email field');
await step('Click the Sign In button');
await step('Verify the dashboard heading is visible');
```

No selectors. No `page.locator(...)`. The AI handles it.

---

## Big Picture — Component Map

```mermaid
graph TD
    SPEC["📝 Test Spec\n(.spec.ts)"]
    FIXTURE["🔧 nl-test.fixture\nstep()"]
    CACHE["🗃️ Locator Cache\nin-memory map"]
    DOM["🌐 DOM Serializer\npage snapshot"]
    RESOLVER["🤖 Action Resolver\nAI orchestrator"]
    CLASSIFIER["⚡ Classifier\ngpt-4o-mini"]
    DOM_AI["🔍 DOM Resolver\ngpt-4o-mini"]
    VISION_AI["👁️ Vision Resolver\ngpt-4o + screenshot"]
    EXECUTOR["⚙️ Action Executor\nPlaywright calls"]
    REPORTER["📊 Quality Reporter\nJSON reports"]
    PHOENIX["🔭 Arize Phoenix\nOTel traces"]

    SPEC -->|"await step(text)"| FIXTURE
    FIXTURE -->|"cache hit?"| CACHE
    FIXTURE -->|"capture page"| DOM
    FIXTURE -->|"resolve action"| RESOLVER
    RESOLVER -->|"classify intent"| CLASSIFIER
    CLASSIFIER -->|"needsVision=false"| DOM_AI
    CLASSIFIER -->|"needsVision=true\nor chart/canvas"| VISION_AI
    DOM_AI -->|"low confidence"| VISION_AI
    RESOLVER -->|"ResolvedAction"| FIXTURE
    FIXTURE -->|"execute"| EXECUTOR
    EXECUTOR -->|"StepResult attachment"| REPORTER
    RESOLVER -->|"auto-instrumented spans"| PHOENIX
```

---

## Step-by-Step Flow — What Happens When You Call `step()`

```mermaid
flowchart TD
    A([step called with plain-English text]) --> B{Cache hit?}

    B -->|Yes| C[Use cached ResolvedAction]
    C --> D[Execute via Playwright]
    D --> E{Success?}
    E -->|Yes| Z([✅ Done — attach StepResult])
    E -->|No — stale locator| F

    B -->|No| F[Capture page context\nurl · title · DOM snapshot · frames]
    F --> G[AI: Classify intent\ngpt-4o-mini]
    G --> H{Needs vision?\nor chart/canvas?}

    H -->|No| I[AI: DOM Resolver\ngpt-4o-mini + DOM snapshot]
    I --> J{Confidence ≥ 0.6?}
    J -->|Yes| K[ResolvedAction returned]
    J -->|No| L

    H -->|Yes| L[Capture viewport screenshot]
    L --> M[AI: Vision Resolver\ngpt-4o + screenshot]
    M --> K

    K --> N[Write to cache]
    N --> D
```

---

## AI Decision Tree — Which Model Gets Called?

```mermaid
flowchart LR
    TEXT["Plain-English Step"]

    TEXT --> CL["Classifier\ngpt-4o-mini\n~50ms · cheap"]

    CL -->|"simple DOM element\nneedsVision=false"| DM["DOM Resolver\ngpt-4o-mini\n~300ms · cheap"]
    CL -->|"chart · canvas · SVG\nneedsVision=true"| VM["Vision Resolver\ngpt-4o\n~1-2s · expensive"]

    DM -->|"confidence ≥ 0.6"| OK["✅ ResolvedAction"]
    DM -->|"confidence < 0.6\nupgrade to vision"| VM
    VM --> OK
```

---

## Cache — How It Speeds Up Tests

On first run every step calls the AI. On repeated runs (same URL + same step text), the result is served from the in-memory cache — **no AI call, no cost, ~10x faster**.

```mermaid
sequenceDiagram
    participant Spec as Test Spec
    participant Fix  as Fixture
    participant Cache as Locator Cache
    participant AI   as AI Pipeline

    Note over Spec,AI: First run — cache cold
    Spec->>Fix: step("Click Sign In")
    Fix->>Cache: get("click sign in", url)
    Cache-->>Fix: miss
    Fix->>AI: classify → resolve
    AI-->>Fix: ResolvedAction {locator, confidence}
    Fix->>Cache: set("click sign in", url, action)

    Note over Spec,AI: Second run — cache warm
    Spec->>Fix: step("Click Sign In")
    Fix->>Cache: get("click sign in", url)
    Cache-->>Fix: hit ✅
    Fix-->>Spec: execute immediately (no AI call)
```

---

## Executor — Handling Edge Cases

```mermaid
flowchart TD
    R["ResolvedAction received"]

    R --> CT{action.type?}
    CT -->|"chart_click\nchart_hover"| CH["ChartHandler\npage.mouse.click/move\nat pixel coordinates"]

    CT -->|"other"| FR{frameSelector set?}
    FR -->|Yes| IF["IframeHandler\nchain frameLocator()"]
    FR -->|No| SH{shadowHost set?}
    SH -->|Yes| SD["Shadow DOM\nhost.locator(inner)"]
    SH -->|No| PL["Standard Playwright\nlocator"]

    IF --> PL
    SD --> PL

    PL --> ACT["dispatch action\nclick · fill · select · assert…"]
    ACT --> OK{Success?}
    OK -->|Yes| DONE(["✅ Step passed"])
    OK -->|No| FB["Try fallbackLocators\nin order"]
    FB --> OK2{Any succeeded?}
    OK2 -->|Yes| DONE
    OK2 -->|No| ERR(["❌ Step failed\ndescriptive error thrown"])
```

---

## Observability — Every AI Call is Traced

```mermaid
graph LR
    OAI["Azure OpenAI\nAPI calls"]
    INSTR["OpenInference\nInstrumentation\nauto-wraps SDK"]
    PROV["OTel TracerProvider\nSimpleSpanProcessor"]
    EXP["OTLP Exporter"]
    PHOENIX["Arize Phoenix\nlocalhost:6006"]

    OAI -->|"every chatMini/chatFull call"| INSTR
    INSTR --> PROV
    PROV --> EXP
    EXP --> PHOENIX

    PHOENIX -->|"shows per-call"| INFO["prompt · completion\ntokens · latency\nparent/child spans"]
```

---

## Output — What You Get After a Test Run

```mermaid
graph TD
    RUN["npx playwright test"]

    RUN --> HTML["Playwright HTML Report\npass / fail per step"]
    RUN --> QR["results/quality-report.json\nAI confidence per step\nlocator strategy used"]
    RUN --> TR["results/time-report.json\nstep durations\ncache hit rate\nslowest step"]
    RUN --> OTEL["Arize Phoenix\nfull prompt traces\ntoken costs"]
```

---

## Key Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `BASE_URL` | App URL under test | required |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource | required |
| `AZURE_OPENAI_API_KEY` | API key | required |
| `AZURE_OPENAI_DEPLOYMENT` | Full model (gpt-4o) | `gpt-4o` |
| `AZURE_OPENAI_MINI_DEPLOYMENT` | Mini model (gpt-4o-mini) | `gpt-4o-mini` |
| `AI_CONFIDENCE_THRESHOLD` | Escalate DOM→Vision below this | `0.6` |
| `AI_MAX_RETRIES` | Retry attempts per step | `2` |
| `DOM_MAX_TOKENS` | Token budget for DOM snapshot | `4000` |
| `PHOENIX_ENDPOINT` | Arize Phoenix OTel endpoint | `http://localhost:6006` |
