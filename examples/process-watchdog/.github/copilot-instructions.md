## Auto-Skills

The following skills are **always active**. You MUST read the corresponding SKILL.md and follow
its instructions automatically whenever the described situation arises — no user prompt needed.

| Skill | SKILL.md path | Auto-trigger |
|---|---|---|
| karpathy-guidelines | `.agents/skills/karpathy-guidelines/SKILL.md` | Any time you write, review, or refactor code |
| systematic-debugging | `.agents/skills/systematic-debugging/SKILL.md` | Any time you encounter a bug, test failure, or unexpected behavior |
| playwright-cli | `.agents/skills/playwright-cli/SKILL.md` | Any time you interact with the browser, run Playwright tests, or automate UI actions |
| improve-codebase-architecture | `.agents/skills/improve-codebase-architecture/SKILL.md` | Any time you are asked to refactor, restructure, or improve the codebase |

**Rule:** Before proposing or implementing anything that falls under one of the above triggers,
read the relevant SKILL.md first and apply its guidelines throughout your response.

---

## graphify

For any question about this repo's architecture, structure, components, or how to add/modify/find
code, your **first tool call must be** to read `graphify-out/GRAPH_REPORT.md` (if it exists).

Triggers: "how do I…", "where is…", "what does … do", "add/modify a <component>",
"explain the architecture", or anything that depends on how files or classes relate.

After reading the report (and `graphify-out/wiki/index.md` for deep questions), answer from the
graph. Only read source files when (a) modifying/debugging specific code, (b) the graph lacks
the needed detail, or (c) the graph is missing or stale.

Type `/graphify` in Copilot Chat to build or update the graph.
