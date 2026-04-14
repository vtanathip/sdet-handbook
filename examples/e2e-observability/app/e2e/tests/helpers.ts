import type { APIRequestContext, TestInfo } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';

type E2eTraceContext = {
  traceId: string;
  parentId: string;
};

const traceContextByTestId = new Map<string, E2eTraceContext>();

function generateDatadogId(): string {
  // Datadog IDs are positive 63-bit integers represented as decimal strings.
  const raw = randomBytes(8).readBigUInt64BE(0) & 0x7fffffffffffffffn;
  const nonZero = raw === 0n ? 1n : raw;
  return nonZero.toString(10);
}

function getOrCreateTraceContext(testInfo: TestInfo): E2eTraceContext {
  const existing = traceContextByTestId.get(testInfo.testId);
  if (existing) {
    return existing;
  }
  const created = {
    traceId: generateDatadogId(),
    parentId: generateDatadogId(),
  };
  traceContextByTestId.set(testInfo.testId, created);
  return created;
}

export function getRunId(): string {
  return process.env.E2E_RUN_ID ?? `pw-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120);
}

export function e2eHeaders(testInfo: TestInfo) {
  const runId = getRunId();
  const trace = getOrCreateTraceContext(testInfo);
  return {
    'x-e2e-run-id': runId,
    'x-e2e-source': 'playwright-e2e',
    'x-e2e-test-name': sanitizeHeaderValue(testInfo.title),
    'x-e2e-request-id': sanitizeHeaderValue(randomUUID()),
    // Manual Datadog propagation lets backend spans share a trace context per test.
    'x-datadog-trace-id': trace.traceId,
    'x-datadog-parent-id': trace.parentId,
    'x-datadog-sampling-priority': '1',
    'x-datadog-origin': 'synthetics',
  };
}

export function uniqueTitle(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

export async function cleanupTodo(
  request: APIRequestContext,
  id: number,
  testInfo: TestInfo
): Promise<void> {
  await request.delete(`/api/todos/${id}`, {
    headers: e2eHeaders(testInfo),
  });
}
