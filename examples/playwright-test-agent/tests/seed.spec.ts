import { expect, test } from '@playwright/test'

test('seed', async ({ page }) => {
  await page.goto('/?mode=baseline')

  await page.getByTestId('reset-board').click()
  await expect(page.getByRole('heading', { name: 'Task board' })).toBeVisible()
  await expect(page.getByTestId('mode-select')).toHaveValue('baseline')
})
