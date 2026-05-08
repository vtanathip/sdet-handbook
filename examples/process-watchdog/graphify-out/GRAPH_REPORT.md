# Graph Report - .  (2026-05-08)

## Corpus Check
- Corpus is ~284 words - fits in a single context window. You may not need a graph.

## Summary
- 18 nodes · 16 edges · 6 communities
- Extraction: 75% EXTRACTED · 25% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.88)
- Token cost: 21,533 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_App Setup and Prerequisites|App Setup and Prerequisites]]
- [[_COMMUNITY_Claude Agent Skills|Claude Agent Skills]]
- [[_COMMUNITY_Build Output Artifacts|Build Output Artifacts]]

## God Nodes (most connected - your core abstractions)
1. `Process Watchdog Application` - 6 edges
2. `Process Watchdog CLAUDE.md` - 4 edges
3. `ProcessWatchdog.csproj` - 3 edges
4. `net8.0 Debug Target Framework` - 3 edges
5. `systematic-debugging Skill` - 2 edges
6. `improve-codebase-architecture Skill` - 2 edges
7. `.NET 8 SDK` - 2 edges
8. `ProcessWatchdog.exe (Debug Build Output)` - 2 edges
9. `ProcessWatchdog.dll (Debug Build Output)` - 2 edges
10. `karpathy-guidelines Skill` - 1 edges

## Surprising Connections (you probably didn't know these)
- `.NET 8 SDK` --semantically_similar_to--> `net8.0 Debug Target Framework`  [INFERRED] [semantically similar]
  README.md → ProcessWatchdog/obj/Debug/net8.0/ProcessWatchdog.csproj.FileListAbsolute.txt
- `ProcessWatchdog.csproj` --references--> `ProcessWatchdog.exe (Debug Build Output)`  [INFERRED]
  README.md → ProcessWatchdog/obj/Debug/net8.0/ProcessWatchdog.csproj.FileListAbsolute.txt
- `ProcessWatchdog.csproj` --references--> `ProcessWatchdog.dll (Debug Build Output)`  [INFERRED]
  README.md → ProcessWatchdog/obj/Debug/net8.0/ProcessWatchdog.csproj.FileListAbsolute.txt

## Hyperedges (group relationships)
- **ProcessWatchdog Debug Build Artifacts** — readme_processwatchdog_csproj, filelist_processwatchdog_exe, filelist_processwatchdog_dll, filelist_net8_target [INFERRED 0.95]
- **CLAUDE.md Agent Skills Registry** — claude_md_process_watchdog, claude_md_skill_karpathy_guidelines, claude_md_skill_playwright_cli, claude_md_skill_systematic_debugging, claude_md_skill_improve_codebase_architecture [EXTRACTED 1.00]

## Communities (6 total, 0 thin omitted)

### Community 0 - "App Setup and Prerequisites"
Cohesion: 0.33
Nodes (6): .NET 8 SDK, Process Watchdog README, Process Watchdog Application, Program.cs Entry Point, process-watchdog.sln Solution File, VS Code C# Dev Kit Extension

### Community 1 - "Claude Agent Skills"
Cohesion: 0.5
Nodes (5): Process Watchdog CLAUDE.md, improve-codebase-architecture Skill, karpathy-guidelines Skill, playwright-cli Skill, systematic-debugging Skill

### Community 2 - "Build Output Artifacts"
Cohesion: 0.67
Nodes (4): net8.0 Debug Target Framework, ProcessWatchdog.dll (Debug Build Output), ProcessWatchdog.exe (Debug Build Output), ProcessWatchdog.csproj

## Knowledge Gaps
- **6 isolated node(s):** `karpathy-guidelines Skill`, `playwright-cli Skill`, `Process Watchdog README`, `Program.cs Entry Point`, `process-watchdog.sln Solution File` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Process Watchdog Application` connect `App Setup and Prerequisites` to `Build Output Artifacts`?**
  _High betweenness centrality (0.199) - this node is a cross-community bridge._
- **Why does `ProcessWatchdog.csproj` connect `Build Output Artifacts` to `App Setup and Prerequisites`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `ProcessWatchdog.csproj` (e.g. with `ProcessWatchdog.exe (Debug Build Output)` and `ProcessWatchdog.dll (Debug Build Output)`) actually correct?**
  _`ProcessWatchdog.csproj` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `karpathy-guidelines Skill`, `playwright-cli Skill`, `Process Watchdog README` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._