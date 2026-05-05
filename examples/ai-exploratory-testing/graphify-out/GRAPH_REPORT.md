# Graph Report - .  (2026-05-05)

## Corpus Check
- Corpus is ~13,303 words - fits in a single context window. You may not need a graph.

## Summary
- 159 nodes · 257 edges · 13 communities detected
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 13 edges
2. `runOrchestration()` - 10 edges
3. `SessionRunner` - 10 edges
4. `JsonlWriter` - 10 edges
5. `buildReport()` - 9 edges
6. `discoverCdpWs()` - 8 edges
7. `selfTestDaemon()` - 7 edges
8. `StuckDetector` - 7 edges
9. `CdpSampler` - 6 edges
10. `RunArtifacts` - 6 edges

## Surprising Connections (you probably didn't know these)
- `runOrchestration()` --calls--> `resolveAuthMode()`  [INFERRED]
  src/runCoordinator.ts → src/authMode.ts
- `runOrchestration()` --calls--> `attachEventRecorder()`  [INFERRED]
  src/runCoordinator.ts → src/eventRecorder.ts
- `runOrchestration()` --calls--> `buildFirstPrompt()`  [INFERRED]
  src/runCoordinator.ts → src/promptLibrary.ts
- `runOrchestration()` --calls--> `buildReport()`  [INFERRED]
  src/runCoordinator.ts → src/reportBuilder.ts
- `selfTestDaemon()` --calls--> `log()`  [INFERRED]
  src/daemonDiscovery.ts → src/util/logger.ts

## Hyperedges (group relationships)
- **Main orchestration workflow** — runOrchestration, SessionRunner, MonitoringBundle, CdpSampler, StuckDetector, RunArtifacts, attachEventRecorder [INFERRED]
- **Configuration and startup** — loadConfig, ConfigSchema, resolveAuthMode, AuthMode, selfTestDaemon [INFERRED]
- **Performance monitoring components** — MonitoringBundle, CdpSampler, StuckDetector, JsonlWriter [INFERRED]
- **Prompt generation** — buildSystemPrompt, buildFirstPrompt, STEP_PROMPT, CLOSE_PROMPT [INFERRED]
- **Report generation and analysis** — buildReport, ReportInput, RunArtifacts, JsonlWriter [INFERRED]
- **Browser daemon discovery** — selfTestDaemon, discoverCdpWs, parseDaemonSession, findCdpPort, fetchCdpWsUrl [INFERRED]
- **** — events_jsonl, metrics_jsonl, findings_jsonl, reportBuilder_ts, report_md [INFERRED]
- **** — runCoordinator_ts, sessionRunner_ts, monitoringBundle_ts, eventRecorder_ts [INFERRED]
- **** — playwright_cli_skill, sessionRunner_ts, cdp_protocol, browser_automation [INFERRED]
- **** — yaml_config, config_ts, authMode_ts, promptLibrary_ts [INFERRED]
- **** — storage_state, request_mocking, session_management, test_generation, tracing, video_recording, element_attributes, running_code, playwright_tests [INFERRED]

## Communities (13 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.0
Nodes (29): AuthMode, CLOSE_PROMPT, CdpSampler, Config, ConfigSchema, CoordinatorOpts, CopilotClient, CopilotSession (+21 more)

### Community 1 - "Community 1"
Cohesion: 0.0
Nodes (30): Architecture Documentation, authMode.ts, Authentication Modes, cdpSampler.ts, Chrome DevTools Protocol, config.ts, Copilot SDK, daemonDiscovery.ts (+22 more)

### Community 2 - "Community 2"
Cohesion: 0.0
Nodes (11): discoverCdpWs(), fetchCdpWsUrl(), findCdpPort(), listSessionFiles(), parseDaemonSession(), selfTestDaemon(), MonitoringBundle, buildSystemPrompt() (+3 more)

### Community 3 - "Community 3"
Cohesion: 0.0
Nodes (3): attachEventRecorder(), RunArtifacts, JsonlWriter

### Community 4 - "Community 4"
Cohesion: 0.0
Nodes (13): Browser Automation, Element Attributes Inspection, Exploratory Testing Process, playwright-cli SKILL, Playwright Tests Execution, README.md, Request Mocking, Running Custom Playwright Code (+5 more)

### Community 5 - "Community 5"
Cohesion: 0.0
Nodes (3): resolveAuthMode(), loadConfig(), buildFirstPrompt()

### Community 6 - "Community 6"
Cohesion: 0.0
Nodes (6): buildReport(), extractNarrative(), fmtBytes(), fmtDuration(), listScreenshots(), readJsonl()

## Knowledge Gaps
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.