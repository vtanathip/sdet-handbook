# Alternative Designs

This document explores alternative architectural approaches that could provide the same capabilities as the current design — AI-driven exploratory browser testing with a CDP observation side-channel and structured artifact output.

---

## Current Design: Imperative Orchestrator + SDK Wrapper

The current system is a **centralized orchestrator** (`runOrchestration` in `runCoordinator.ts`) that owns the entire lifecycle imperatively. It wires all modules together, sequences startup, drives a prompt-per-turn loop, and tears everything down. The LLM session is managed by `@github/copilot-sdk`, browser metrics arrive via a CDP side-channel (`CdpSampler`), and results stream into three append-only JSONL files.

```
index.ts
  └─ runOrchestration()
       ├─ RunArtifacts.create()          (output dir + JSONL writers)
       ├─ selfTestDaemon()               (smoke-test daemon files)
       ├─ SessionRunner.create()         (Copilot SDK session)
       ├─ attachEventRecorder()          (events → events.jsonl)
       ├─ resolveAuthMode() → sendAndWait(firstPrompt)
       ├─ discoverCdpWs() → MonitoringBundle.start()
       ├─ while !stopped: sendAndWait(STEP_PROMPT)
       └─ teardown → buildReport()
```

**Strengths:** simple, low-ceremony, tight control over the entire run.  
**Weaknesses:** tightly coupled to the Copilot SDK; no resumability; hard to parallelize test runs.

---

## Alternative 1: Tool-Calling Loop with Raw LLM API

Replace `@github/copilot-sdk` with a direct OpenAI-compatible chat completions call. You own the conversation loop and tool dispatch instead of delegating to the SDK.

```
index.ts
  └─ runOrchestration()
       ├─ messages = [systemPrompt, firstUserPrompt]
       ├─ while finish_reason !== "stop":
       │    response = openai.chat.completions.create({ tools, messages })
       │    if tool_call: execute playwright-cli → append result to messages
       │    else: append assistant message
       └─ write findings + buildReport()
```

**CDP / artifacts:** unchanged — `CdpSampler`, `StuckDetector`, and JSONL writers are orthogonal to the session layer and require no modification.

**What you gain:** full portability across any OpenAI-compatible model (Azure OpenAI, Anthropic, local Ollama). No SDK dependency; explicit control over context window management and retry logic.

**What you lose:** the SDK handles context compaction, tool approval, and session events automatically. You must re-implement those or accept their absence.

---

## Alternative 2: MCP Server Architecture

Expose the browser as an **MCP (Model Context Protocol) server**. The orchestrator becomes an MCP client — or any MCP-compatible agent (Claude Desktop, VS Code Agent Mode, a custom runner) can drive the testing directly.

```
mcp-browser-server/   (new process)
  tools:
    open_url(url, authStateFile?)
    navigate(url)
    click(selector)
    type(selector, text)
    get_findings() → findings[]
    save_auth_state(path)
  middleware:
    CdpSampler → metrics written server-side
    StuckDetector → server aborts hung tool calls

Any MCP client
  ↓ MCP protocol (stdio or SSE)
  mcp-browser-server → playwright-cli → Chromium
```

**CDP / artifacts:** the MCP server owns both; it starts `CdpSampler` when `open_url` is called and exposes metrics through a `get_metrics` tool or as a resource stream.

**What you gain:** complete portability — the testing capability is usable from any MCP-compatible host. No knowledge of the internal SDK or orchestrator required.

**What you lose:** the closed-loop control (deadline enforcement, `STEP_PROMPT` cadence, run lifecycle) must move to the MCP client or be re-implemented as server-side policy.

---

## Alternative 3: State-Machine / Graph Workflow

Replace the imperative `while` loop with a **directed graph of named nodes** where each node is a pure function `(state) → state`. This is the pattern used by frameworks like LangGraph.

```
Nodes:
  startup → auth → browser_open → explore → teardown → report

State shape:
  {
    messages:      Message[]
    browserAttached: boolean
    findings:      Finding[]
    metrics:       MetricSample[]
    stopReason:    'deadline' | 'stuck' | 'sigint' | undefined
  }

Edges:
  explore  --[next turn]-→  explore
  explore  --[deadline || stuck || sigint]-→  teardown
  teardown --[done]-→  report
```

**CDP / artifacts:** `CdpSampler` runs as a parallel graph branch that writes into `state.metrics`; `StuckDetector` sets `state.stopReason = 'stuck'` as a signal rather than throwing.

**What you gain:** each node is independently testable; the graph can be checkpointed to disk and **resumed** after a crash; parallel branches (agent turn + CDP sampling) are expressed declaratively.

**What you lose:** requires a graph library or a custom state machine; significantly more setup; the linear simplicity of the current design disappears.

---

## Alternative 4: Playwright Test Plugin (Test-Framework-Hosted)

Invert control entirely — embed the agent as a **custom Playwright Test fixture** so that each exploratory session is a first-class Playwright test.

```typescript
// exploratory.test.ts
test('explore checkout flow', async ({ aiAgent }) => {
  await aiAgent.explore({ url: config.url, duration: '10m' });
  expect(aiAgent.findings.filter(f => f.severity === 'critical')).toHaveLength(0);
});
```

The `aiAgent` fixture owns the LLM loop, stuck detection, and findings collection. CDP metrics come from Playwright's built-in `page.metrics()`. Report generation is replaced by the Playwright HTML reporter with a custom findings attachment.

**CDP / artifacts:** `CdpSampler` is replaced by `page.metrics()` calls inside the fixture; `findings.jsonl` becomes a test attachment; `events.jsonl` maps to `testInfo.attach()`.

**What you gain:** Playwright's parallelism, retry, and CI integration (GitHub Actions, Azure DevOps) for free; no custom runner needed.

**What you lose:** long-running sessions conflict with Playwright Test's timeout model; the `playwright-cli` skill design (agent issuing shell commands) conflicts with the direct `page` fixture — you must switch to direct Playwright API calls and lose the agent's tool-call independence.

---

## Comparison

| Design | Portability | Resumability | Agent Control | CI Integration | Complexity |
|---|---|---|---|---|---|
| **Current** (imperative orchestrator) | Low (SDK-tied) | None | High | Manual | Low |
| Raw API loop | High (any LLM) | None | Full | Manual | Medium |
| MCP server | Very high | None | Low (client-defined) | Any MCP host | Medium |
| State machine / graph | Medium | **High** | High | Manual | High |
| Playwright Test plugin | Low (PW-tied) | Via retries | Medium | **Native** | Low |

The current design's primary advantage is **simplicity and tight control** — the orchestrator owns everything in one place and the CDP side-channel is unique to this design. The main reasons to switch:

- **Portability across LLM providers** → Alternative 1 (Raw API)
- **Reuse from any AI toolchain** → Alternative 2 (MCP server)
- **Crash recovery and resumable runs** → Alternative 3 (State machine)
- **Native CI / test-report integration** → Alternative 4 (Playwright Test plugin)
