import { test, expect } from '@playwright/test'

test('debug login page', async ({ page }) => {
  await page.goto('/login')

  // Wait for page to load
  await page.waitForSelector('text=Enter your PIN', { timeout: 10000 })

  // Log all button elements
  const buttons = await page.locator('button').all()
  console.log(`Found ${buttons.length} buttons`)

  for (const btn of buttons) {
    const text = await btn.textContent()
    const testId = await btn.getAttribute('data-testid')
    console.log(`Button: "${text}" testid="${testId}"`)
  }

  // Try to find the digit 1 button specifically
  const digit1 = page.locator('[data-testid="pin-digit-1"]')
  const isVisible = await digit1.isVisible()
  console.log(`Digit 1 button visible: ${isVisible}`)

  if (isVisible) {
    // Try clicking with JavaScript instead
    await digit1.evaluate((el) => (el as HTMLButtonElement).click())
    await page.waitForTimeout(500)

    // Check if PIN dot changed
    const dots = await page.locator('.bg-blue-600').count()
    console.log(`Filled PIN dots after clicking 1: ${dots}`)
  }

  // Take screenshot for inspection
  await page.screenshot({ path: 'test-results/debug-login.png' })
})
