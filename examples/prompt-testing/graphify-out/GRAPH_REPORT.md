# Graph Report - .  (2026-05-05)

## Corpus Check
- Corpus is ~12,649 words - fits in a single context window. You may not need a graph.

## Summary
- 135 nodes · 230 edges · 14 communities (9 shown, 5 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Core AI Execution Pipeline|Core AI Execution Pipeline]]
- [[_COMMUNITY_ActionExecutor Implementation|ActionExecutor Implementation]]
- [[_COMMUNITY_NL Test Integration|NL Test Integration]]
- [[_COMMUNITY_AI Resolver Logic|AI Resolver Logic]]
- [[_COMMUNITY_Config and Fixtures|Config and Fixtures]]
- [[_COMMUNITY_Cache and Reporting|Cache and Reporting]]
- [[_COMMUNITY_DOM Snapshot Utilities|DOM Snapshot Utilities]]
- [[_COMMUNITY_Test Reporting Layer|Test Reporting Layer]]
- [[_COMMUNITY_Table Handler|Table Handler]]
- [[_COMMUNITY_Resolution Strategy|Resolution Strategy]]
- [[_COMMUNITY_AI Client and Telemetry|AI Client and Telemetry]]
- [[_COMMUNITY_Cache Key Strategy|Cache Key Strategy]]
- [[_COMMUNITY_Cache Fallback Pattern|Cache Fallback Pattern]]

## God Nodes (most connected - your core abstractions)
1. `Prompt Testing README` - 15 edges
2. `ActionResolver` - 10 edges
3. `NL Test Fixture (step)` - 10 edges
4. `ActionExecutor` - 10 edges
5. `nl-test.fixture (step() Playwright Fixture)` - 10 edges
6. `ActionResolver` - 9 edges
7. `LocatorCache` - 7 edges
8. `ActionResolver` - 6 edges
9. `ActionExecutor` - 6 edges
10. `writeDomDebug()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Login Flow Test Spec` --references--> `NL Test Fixture (step)`  [EXTRACTED]
  tests/login.spec.ts → src/fixtures/nl-test.fixture.ts
- `Dashboard Charts Test Spec` --references--> `Config (Env Loader)`  [EXTRACTED]
  tests/dashboard-charts.spec.ts → config/index.ts
- `Data Table Test Spec` --references--> `Config (Env Loader)`  [EXTRACTED]
  tests/data-table.spec.ts → config/index.ts
- `Login Flow Test Spec` --references--> `Config (Env Loader)`  [EXTRACTED]
  tests/login.spec.ts → config/index.ts
- `Dashboard Charts Test Spec` --conceptually_related_to--> `VISION_RESOLVER_SYSTEM Prompt`  [INFERRED]
  tests/dashboard-charts.spec.ts → src/ai/prompts.ts

## Hyperedges (group relationships)
- **Natural Language Step Resolution Pipeline** — nltestfixture_test, actionresolver_actionresolver, actionexecutor_actionexecutor, locatorcache_locatorcache [EXTRACTED 0.95]
- **AI Dual-Path Resolution (DOM vs Vision)** — actionresolver_actionresolver, azureclient_chatmini, azureclient_chatfull, prompts_domresolversystem, prompts_visionresolversystem [EXTRACTED 0.95]
- **Per-Step Evidence Capture (snapshot, debug, highlight)** — domsnapshotwriter_writedomsnapshot, domdebugwriter_writedomdebug, domhighlight_highlightelement [INFERRED 0.95]
- **AI Resolution Pipeline (Classify -> DOM/Vision -> Cache)** — api_action_resolver, api_azure_client, api_prompts, api_locator_cache, api_dom_serializer, api_screenshot [EXTRACTED 1.00]
- **Pre-Action Evidence Capture (DOM Debug + Snapshot + Highlight)** — api_dom_debug_writer, api_dom_snapshot_writer, api_dom_highlight, api_nl_test_fixture [EXTRACTED 1.00]
- **Observability Stack (Azure OpenAI + OTel + Phoenix)** — api_azure_client, api_instrumentation, arize_phoenix, docker_compose_phoenix_service [EXTRACTED 1.00]

## Communities (14 total, 5 thin omitted)

### Community 0 - "Core AI Execution Pipeline"
Cohesion: 0.14
Nodes (30): ActionExecutor, ActionResolver, AzureClient (chatMini / chatFull), ChartHandler, Runtime Config (config/index.ts), DOM Debug Writer (writeDomDebug), DOM Highlight (highlightElement), DOM Serializer (PageContextCapture) (+22 more)

### Community 1 - "ActionExecutor Implementation"
Cohesion: 0.15
Nodes (9): ActionExecutor, ChartHandler, IframeHandler, resolveElementInfo(), resolveFrameLocator(), resolveLocatorForDebug(), toSafeFilename(), writeDomDebug() (+1 more)

### Community 2 - "NL Test Integration"
Cohesion: 0.17
Nodes (20): ActionExecutor, ActionResolver, chatFull (GPT-4o call), chatMini (GPT-4o-mini call), ChartHandler, Dashboard Charts Test Spec, Data Table Test Spec, writeDomDebug (+12 more)

### Community 3 - "AI Resolver Logic"
Cohesion: 0.24
Nodes (8): ActionResolver, chatFull(), chatMini(), makeClient(), CLASSIFIER_USER(), DOM_RESOLVER_USER(), VISION_RESOLVER_USER(), captureScreenshotBase64()

### Community 4 - "Config and Fixtures"
Cohesion: 0.24
Nodes (3): Config (Env Loader), Login Flow Test Spec, PageContextCapture

### Community 6 - "DOM Snapshot Utilities"
Cohesion: 0.39
Nodes (5): captureFullDomTree(), resolveFrame(), resolveTravelPath(), toSafeFilename(), writeDomSnapshot()

### Community 7 - "Test Reporting Layer"
Cohesion: 0.5
Nodes (4): Playwright Config, QualityReporter, StepResult Interface, TestSuiteReport Interface

### Community 9 - "Resolution Strategy"
Cohesion: 1.0
Nodes (3): Confidence Gate (DOM to Vision Escalation), DOM Resolution Path, Vision Resolution Path

## Knowledge Gaps
- **17 isolated node(s):** `Playwright Config`, `OpenTelemetry Instrumentation Setup`, `Azure OpenAI Client Module`, `CLASSIFIER_SYSTEM Prompt`, `TestSuiteReport Interface` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Config (Env Loader)` connect `Config and Fixtures` to `NL Test Integration`?**
  _High betweenness centrality (0.191) - this node is a cross-community bridge._
- **Why does `NL Test Fixture (step)` connect `NL Test Integration` to `Config and Fixtures`, `Test Reporting Layer`?**
  _High betweenness centrality (0.140) - this node is a cross-community bridge._
- **Why does `Dashboard Charts Test Spec` connect `NL Test Integration` to `Config and Fixtures`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `Playwright Config`, `OpenTelemetry Instrumentation Setup`, `Azure OpenAI Client Module` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Core AI Execution Pipeline` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._