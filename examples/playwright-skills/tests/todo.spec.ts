import { test, expect } from '@playwright/test';

test.describe('Todo List App', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ================================================================
  // SKILL: scaffold-playwright-test.md
  // Rule: Use getByRole / getByPlaceholder — never CSS selectors
  // Rule: Assert with toBeVisible() / toBeEmpty() (web-first)
  // ================================================================
  test('[skill: scaffold-playwright-test] should show the page heading', async ({ page }) => {
    await test.step('Skill applied: use getByRole instead of h1 CSS selector', async () => {
      await expect(page.getByRole('heading', { name: 'Todo List' })).toBeVisible();
    });
  });

  test('[skill: scaffold-playwright-test] should add a new task', async ({ page }) => {
    await test.step('Skill applied: locate input by placeholder text', async () => {
      await page.getByPlaceholder('Enter a new task').fill('Buy milk');
    });

    await test.step('Skill applied: locate button by visible role + name', async () => {
      await page.getByRole('button', { name: 'Add Task' }).click();
    });

    await test.step('Skill applied: assert with toBeVisible() — web-first assertion', async () => {
      await expect(page.getByRole('listitem').filter({ hasText: 'Buy milk' })).toBeVisible();
    });

    await test.step('Skill applied: assert input cleared with toBeEmpty()', async () => {
      await expect(page.getByPlaceholder('Enter a new task')).toBeEmpty();
    });
  });

  test('[skill: scaffold-playwright-test] should add multiple tasks', async ({ page }) => {
    const tasks = ['Buy milk', 'Walk the dog', 'Read a book'];

    await test.step('Skill applied: loop using semantic locators for each task', async () => {
      for (const task of tasks) {
        await page.getByPlaceholder('Enter a new task').fill(task);
        await page.getByRole('button', { name: 'Add Task' }).click();
      }
    });

    await test.step('Skill applied: assert all items visible via listitem role', async () => {
      for (const task of tasks) {
        await expect(page.getByRole('listitem').filter({ hasText: task })).toBeVisible();
      }
    });
  });

  test('[skill: scaffold-playwright-test] should not add an empty task', async ({ page }) => {
    await test.step('Skill applied: click Add Task with empty input', async () => {
      await page.getByRole('button', { name: 'Add Task' }).click();
    });

    await test.step('Skill applied: assert list count with toHaveCount()', async () => {
      await expect(page.getByRole('listitem')).toHaveCount(0);
    });
  });

  // ================================================================
  // SKILL: debug-test.md
  // Rule: Use keyboard interactions to cover user-journey scenarios
  // ================================================================
  test('[skill: debug-test] should support adding a task via Enter key', async ({ page }) => {
    await test.step('Skill applied: fill input and trigger via keyboard press', async () => {
      await page.getByPlaceholder('Enter a new task').fill('Feed the cat');
      await page.getByPlaceholder('Enter a new task').press('Enter');
    });

    await test.step('Skill applied: confirm task appears with web-first assertion', async () => {
      await expect(page.getByRole('listitem').filter({ hasText: 'Feed the cat' })).toBeVisible();
    });
  });

});
