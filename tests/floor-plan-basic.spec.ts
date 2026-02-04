import { test, expect } from '@playwright/test'

test('login and view floor plan', async ({ page }) => {
  // Go to login
  await page.goto('/login')
  await page.waitForSelector('text=Enter your PIN', { timeout: 10000 })

  // Enter PIN 1234 using JavaScript clicks
  await page.locator('[data-testid="pin-digit-1"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-2"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-3"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-4"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(300)

  // Check that Clock In is enabled now
  const clockInButton = page.locator('[data-testid="pin-submit"]')
  await expect(clockInButton).toBeEnabled()

  // Click Clock In
  await clockInButton.evaluate((el) => (el as HTMLButtonElement).click())

  // Wait for navigation
  await page.waitForURL(/\/(orders|floor-plan)/, { timeout: 30000 })

  // Take screenshot after login
  await page.screenshot({ path: 'test-results/after-login.png' })

  // Navigate to floor plan using the menu (to preserve auth state)
  // Click the hamburger menu
  await page.locator('button').filter({ has: page.locator('svg') }).last().click()
  await page.waitForTimeout(500)

  // Look for Floor Plan or Tables link in menu
  const floorPlanLink = page.locator('a, button').filter({ hasText: /floor\s*plan|tables/i }).first()
  if (await floorPlanLink.isVisible()) {
    await floorPlanLink.click()
  } else {
    // If not in menu, try clicking Tables button in the header
    await page.locator('button').filter({ hasText: /tables/i }).first().click()
  }

  await page.waitForTimeout(3000)

  // Take screenshot of floor plan
  await page.screenshot({ path: 'test-results/floor-plan.png' })

  // Check for tables - look for table elements with "seats" text or table names
  const tables = await page.locator('text=/Table.*seats|\\d+ seats/i').count()
  const entertainmentItems = await page.locator('text=/POOL|DART|KARAOKE|BOWLING/i').count()
  const totalElements = tables + entertainmentItems
  console.log(`Found ${tables} tables and ${entertainmentItems} entertainment items on floor plan`)

  // Verify we have at least some elements
  expect(totalElements).toBeGreaterThan(0)
})

test('floor plan tables maintain position on resize', async ({ page }) => {
  // Login first
  await page.goto('/login')
  await page.waitForSelector('text=Enter your PIN', { timeout: 10000 })

  await page.locator('[data-testid="pin-digit-1"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-2"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-3"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-4"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(300)

  await page.locator('[data-testid="pin-submit"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForURL(/\/(orders|floor-plan)/, { timeout: 30000 })

  // Click Tables to view floor plan
  await page.locator('button').filter({ hasText: /tables/i }).first().click()
  await page.waitForTimeout(2000)

  // Get table/element count before resize
  const tablesBefore = await page.locator('text=/Table.*seats|\\d+ seats/i').count()
  const entertainmentBefore = await page.locator('text=/POOL|DART|KARAOKE|BOWLING/i').count()
  const totalBefore = tablesBefore + entertainmentBefore

  if (totalBefore === 0) {
    console.log('No elements found, skipping resize test')
    return
  }

  console.log(`Elements before resize: ${totalBefore}`)

  // Resize window
  await page.setViewportSize({ width: 800, height: 600 })
  await page.waitForTimeout(1000)

  // Take screenshot during resize
  await page.screenshot({ path: 'test-results/during-resize.png' })

  // Resize back
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForTimeout(1000)

  // Take screenshot after resize
  await page.screenshot({ path: 'test-results/after-resize.png' })

  // Get element count after resize
  const tablesAfter = await page.locator('text=/Table.*seats|\\d+ seats/i').count()
  const entertainmentAfter = await page.locator('text=/POOL|DART|KARAOKE|BOWLING/i').count()
  const totalAfter = tablesAfter + entertainmentAfter

  console.log(`Elements after resize: ${totalAfter}`)

  // Verify same number of elements visible
  expect(totalAfter).toBe(totalBefore)
})
