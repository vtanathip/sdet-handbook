import type { APIRequestContext, TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export function getRunId(): string {
  return process.env.E2E_RUN_ID ?? `pw-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120);
}

export function e2eHeaders(testInfo: TestInfo) {
  const runId = getRunId();
  return {
    'x-e2e-run-id': runId,
    'x-e2e-source': 'playwright-e2e',
    'x-e2e-test-name': sanitizeHeaderValue(testInfo.title),
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
