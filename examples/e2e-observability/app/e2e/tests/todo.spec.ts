import { expect, test } from '@playwright/test';
import { cleanupTodo, e2eHeaders, uniqueTitle } from './helpers';

test.beforeEach(async ({ context, page }, testInfo) => {
  await context.setExtraHTTPHeaders(e2eHeaders(testInfo));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /todo list/i })).toBeVisible();
  await expect(page.getByText(/Error: Server error/i)).toHaveCount(0);
});

test('ui flow: create, toggle, delete todo', async ({ page }) => {
  const title = uniqueTitle('ui-e2e');

  await page.getByLabel('New todo title').fill(title);
  await page.getByRole('button', { name: 'Add' }).click();

  const item = page.locator('li').filter({ hasText: title });
  await expect(item).toBeVisible();

  const checkbox = item.getByRole('checkbox');
  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes('/api/todos/') && res.request().method() === 'PUT' && res.status() === 200
    ),
    checkbox.click(),
  ]);
  await expect(checkbox).toBeChecked();

  await item.getByRole('button', { name: new RegExp(`Delete "${title}"`) }).click();
  await expect(page.locator('li').filter({ hasText: title })).toHaveCount(0);
});

test('api flow: update title and negative cases', async ({ request }, testInfo) => {
  const title = uniqueTitle('api-e2e');

  const createRes = await request.post('/api/todos', {
    headers: {
      ...e2eHeaders(testInfo),
      'content-type': 'application/json',
    },
    data: { title },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: number; title: string; completed: boolean };

  const updatedTitle = `${title}-updated`;
  const updateRes = await request.put(`/api/todos/${created.id}`, {
    headers: {
      ...e2eHeaders(testInfo),
      'content-type': 'application/json',
    },
    data: { title: updatedTitle },
  });
  expect(updateRes.status()).toBe(200);
  const updated = (await updateRes.json()) as { title: string };
  expect(updated.title).toBe(updatedTitle);

  const badBodyRes = await request.post('/api/todos', {
    headers: {
      ...e2eHeaders(testInfo),
      'content-type': 'application/json',
    },
    data: { title: '' },
  });
  expect(badBodyRes.status()).toBe(400);

  const invalidIdRes = await request.put('/api/todos/not-a-number', {
    headers: {
      ...e2eHeaders(testInfo),
      'content-type': 'application/json',
    },
    data: { completed: true },
  });
  expect(invalidIdRes.status()).toBe(400);

  const notFoundRes = await request.delete('/api/todos/999999999', {
    headers: e2eHeaders(testInfo),
  });
  expect(notFoundRes.status()).toBe(404);

  await cleanupTodo(request, created.id, testInfo);
});
