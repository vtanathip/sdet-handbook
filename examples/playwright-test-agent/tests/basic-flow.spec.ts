import { expect, test } from '@playwright/test'

const mode = process.env.DEMO_MODE === 'drift' ? 'drift' : 'baseline'

test('user can add and complete a task', async ({ page }) => {
  await page.goto(`/?mode=${mode}`)

  await page.getByTestId('reset-board').click()
  await page.getByTestId('task-input').fill('Prepare release notes')
  await page.getByRole('button', { name: 'Add task' }).click()

  const item = page.getByRole('listitem').filter({ hasText: 'Prepare release notes' })
  await expect(item).toBeVisible()

  await item.getByRole('checkbox').check()
  await expect(item.getByText('Prepare release notes')).toHaveClass(/done/)
})
