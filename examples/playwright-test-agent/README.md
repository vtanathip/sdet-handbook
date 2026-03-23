# Playwright Test Agent Self-Healing Demo

This project is a local website that intentionally introduces UI drift so you can demonstrate Playwright Test Agent healing.

## What this demo includes

- Baseline mode with stable selectors and labels.
- Drift mode that introduces all three breakage patterns:
  - Locator text change (`Add task` -> `Create task`)
  - Attribute/test-id rename (`task-input` -> `task-entry`)
  - Flow shift (confirmation modal before task creation)
- Playwright tests that pass in baseline and fail in drift.

## Install

```bash
npm install
npx playwright install chromium
```

## Run app manually

```bash
npm run dev -- --host 127.0.0.1 --port 4173
```

Open:

- `http://127.0.0.1:4173/?mode=baseline`
- `http://127.0.0.1:4173/?mode=drift`

## Verify baseline and drift behavior

Baseline should pass:

```bash
npm run test:e2e
```

Intentional drift failure:

```bash
npm run test:e2e:drift
```

## Playwright Test Agent workflow

```bash
npm run agents:init
```

1. Initialize agent definitions with the command above.
2. Use planner with `tests/seed.spec.ts` in context and ask for a test plan.
3. Use generator on the produced plan in `specs/` to create tests.
4. Switch app to drift mode and run failing test.
5. Invoke healer for the failing test and let it patch locators/steps.

## Suggested live demo script

1. Run `npm run test:e2e` and show green in baseline mode.
2. Run `npm run test:e2e:drift` and show red due to drift changes.
3. Run healer on the failing test.
4. Re-run and show green after healing.
