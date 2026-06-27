import { test, expect } from './fixtures.js';

// Each scenario drives a freeze trigger as a tagged step() so the report can attribute the freeze
// to the action. The aggregate sign-off verdict is computed in global-teardown / `npm run signoff`.
// A short gap between steps lets the 250ms pollers drain so incidents stay separate + attributed.
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('freeze sweep — exercises every detection layer', async ({ app }) => {
  const { window, step } = app;

  // L8: kick off a request that never resolves — it stays in-flight the whole run (>stall threshold).
  await step('click Stuck request', () => window.getByTestId('stall-fetch').click());
  await settle(300);

  // L1 + L2: a 4s renderer busy-loop. click() resolves only after the thread frees (~4s),
  // so the action window naturally spans the freeze.
  await step('click Freeze 4s', () => window.getByTestId('renderer-block-4s').click());
  await settle(800);

  await step('click Freeze 2s', () => window.getByTestId('renderer-block-2s').click());
  await settle(800);

  // L3 + L4: main process busy-loops asynchronously; hold the action window open across it.
  await step('click Main busy 3s', async () => {
    await window.getByTestId('main-busy-3s').click();
    await settle(3500);
  });
  await settle(800);

  // L1 + L3: sync IPC into a busy handler blocks both threads; click() resolves after it releases.
  await step('click Sync deadlock', () => window.getByTestId('sync-deadlock').click());
  await settle(800);

  // L7 (+ L1/L3): flood main with 50k IPC sends — the IPC queue can't flush fast enough.
  await step('click IPC flood', async () => {
    await window.getByTestId('ipc-flood').click();
    await settle(2000);
  });
  await settle(800);

  // L1 + L3: a jumbo IPC payload blocks both sides on structured-clone serialization.
  await step('click IPC jumbo', async () => {
    await window.getByTestId('ipc-jumbo').click();
    await settle(1500);
  });
  await settle(800);

  // L4: memory balloon — no UI freeze, just rising workingSetSize. Hold the step open long enough
  // for the 250ms metrics poller to observe the jump and attribute it to this action.
  await step('click Memory balloon', async () => {
    await window.getByTestId('mem-balloon').click();
    await settle(2500);
  });
  await settle(800);

  // L2 + L4: heavy synchronous paint loop (~1.5s).
  await step('click GPU stall', () => window.getByTestId('gpu-stall').click());
  await settle(800);

  // L_storage: write a few MB to localStorage (usage shows in navigator.storage.estimate).
  await step('click Storage fill', () => window.getByTestId('storage-fill').click());
  await settle(800);

  // JS error (no freeze/crash) — advisory signal.
  await step('click JS error', () => window.getByTestId('js-error').click());
  await settle(800);

  // Control: no freeze.
  await step('click No freeze', () => window.getByTestId('no-freeze').click());
  await settle(500);

  // The app recovered from every freeze.
  await expect(window.getByTestId('no-freeze')).toBeEnabled();
});

test('renderer crash → native render-process-gone', async ({ app }) => {
  const { window, step } = app;
  await step('click Crash renderer', () => window.getByTestId('crash').click().catch(() => {}));
  await settle(1500); // let nativeSignals drain the render-process-gone event
});

test('main crash → main-process-gone (harness-side detection)', async ({ app }) => {
  const { window, step } = app;
  await step('click Crash MAIN process', () => window.getByTestId('crash-main').click().catch(() => {}));
  await settle(1500); // the app dies; watchMainDeath records it before teardown builds the report
});
