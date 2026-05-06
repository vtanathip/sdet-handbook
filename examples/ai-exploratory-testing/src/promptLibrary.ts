import type { Config } from './config.js';
import type { AuthMode } from './authMode.js';

// ---------------------------------------------------------------------------
// System prompt — sent once when the session is created
// ---------------------------------------------------------------------------

export function buildSystemPrompt(cfg: Config, findingsPath: string): string {
  return `${cfg.persona.trim()}

## App under test
URL: ${cfg.appUrl}

## Your loop
${cfg.loopIntent.trim()}

After each meaningful action, emit \`session.task_complete\` with a short summary
(one or two sentences). The orchestrator will then prompt you for the next step.

## How to interact with the browser
You have the \`playwright-cli\` skill available via bash. The app uses web
components heavily (Lit / shadow DOM). Prefer \`playwright-cli snapshot\` and
the returned \`ref\` ids; aria-label / role selectors are more reliable than
CSS. CSS selectors often miss through shadow roots.

## How to verify behavior
When you expect an action to produce an outcome:
1. Take a snapshot of the relevant area after the action.
2. Optionally take a screenshot as evidence.
3. Cross-check visual and DOM signals. If they disagree, prefer re-checking
   after a short wait — many mismatches are races, not bugs.
4. Do not treat console log messages or 5xx network responses as bug signals
   on their own; too noisy. Only report when the *user-visible* behavior is
   wrong.

## How to report findings
Append one JSON line per finding to: ${findingsPath}
Use bash like:
  echo '{"ts":"ISO-time","severity":"high|medium|low","title":"...","repro":"...","evidence":{"screenshot":"screenshots/xxx.png"},"agentConfidence":"high|medium|low"}' >> ${findingsPath}

Prioritize by importance: a broken chart load is high; a minor visual glitch
is low. Include enough repro steps for a human to re-verify.
`;
}

// ---------------------------------------------------------------------------
// First prompt — sent after session creation to open the browser / auth
// ---------------------------------------------------------------------------

export function buildFirstPrompt(cfg: Config, mode: AuthMode): string {
  const base = `Use the playwright-cli skill.`;
  switch (mode) {
    case 'reuse':
      return (
        `${base} First, restore the saved auth state: ` +
        `\`playwright-cli state-load ${cfg.authStateFile}\`. ` +
        `Then \`playwright-cli open ${cfg.appUrl}${cfg.headed ?? false ? ' --headed' : ''}\`. ` +
        `You should already be logged in; verify with a snapshot. ` +
        `Emit task_complete when ready.`
      );
    case 'login-then-save': {
      const hint = cfg.authLoginHint?.trim();
      const loginStep = hint
        ? `Log in: ${hint}`
        : `Log in using whatever credentials are available (check PLAYWRIGHT_MCP_SECRETS_FILE for secret names).`;
      return (
        `${base} \`playwright-cli open ${cfg.appUrl}${cfg.headed ?? false ? ' --headed' : ''}\`, wait for load. ` +
        `${loginStep} ` +
        `After login succeeds (you see a logged-in page), emit task_complete.`
      );
    }
    case 'no-auth':
    default:
      return (
        `${base} \`playwright-cli open ${cfg.appUrl}${cfg.headed ?? false ? ' --headed' : ''}\`, wait for load, ` +
        `emit task_complete with a status summary.`
      );
  }
}

// ---------------------------------------------------------------------------
// Step prompt — sent on every iteration of the main loop
// ---------------------------------------------------------------------------

export const STEP_PROMPT =
  'Continue your monitoring routine. When you complete one meaningful action, ' +
  'signal task_complete with a one- or two-sentence summary of what you just did.';

// ---------------------------------------------------------------------------
// Cleanup prompt — sent in the finally block before teardown
// ---------------------------------------------------------------------------

export const CLOSE_PROMPT = 'Close the browser using playwright-cli close.';
