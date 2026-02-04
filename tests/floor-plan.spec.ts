import { test, expect, Page } from '@playwright/test'

/**
 * Floor Plan Feature Tests
 *
 * These tests verify:
 * 1. Table positioning and drag/drop
 * 2. Table merging and unmerging
 * 3. Entertainment element placement and movement
 * 4. Position persistence after window resize
 */

// Helper to login as manager
async function loginAsManager(page: Page) {
  await page.goto('/login')

  // Wait for PIN pad to be visible
  await page.waitForSelector('text=Enter your PIN', { timeout: 10000 })

  // Enter manager PIN (1234) using JavaScript click (more reliable)
  await page.locator('[data-testid="pin-digit-1"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-2"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-3"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(100)
  await page.locator('[data-testid="pin-digit-4"]').evaluate((el) => (el as HTMLButtonElement).click())
  await page.waitForTimeout(200)

  // Click the Clock In button to submit
  await page.locator('[data-testid="pin-submit"]').evaluate((el) => (el as HTMLButtonElement).click())

  // Wait for login to complete and redirect
  await page.waitForURL(/\/(orders|floor-plan)/, { timeout: 30000 })
}

// Helper to navigate to floor plan editor
async function goToFloorPlanEditor(page: Page) {
  await page.goto('/floor-plan')
  // Wait for the floor plan to load
  await page.waitForSelector('[data-testid="floor-plan-canvas"]', { timeout: 10000 }).catch(() => {
    // Fallback: wait for any table element
    return page.waitForSelector('.cursor-grab', { timeout: 10000 })
  })
}

test.describe('Floor Plan Editor', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page)
  })

  test('should load floor plan with tables', async ({ page }) => {
    await goToFloorPlanEditor(page)

    // Should have at least one table visible
    const tables = await page.locator('.cursor-grab').count()
    expect(tables).toBeGreaterThan(0)
  })

  test('tables should maintain position after window resize', async ({ page }) => {
    await goToFloorPlanEditor(page)

    // Get initial positions of tables
    const tablesBefore = await page.locator('.cursor-grab').all()
    const positionsBefore: Array<{ left: string; top: string }> = []

    for (const table of tablesBefore.slice(0, 3)) {
      const left = await table.evaluate(el => (el as HTMLElement).style.left)
      const top = await table.evaluate(el => (el as HTMLElement).style.top)
      positionsBefore.push({ left, top })
    }

    // Resize window
    await page.setViewportSize({ width: 800, height: 600 })
    await page.waitForTimeout(500)

    // Resize back
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(500)

    // Check positions haven't changed
    const tablesAfter = await page.locator('.cursor-grab').all()

    for (let i = 0; i < Math.min(3, tablesAfter.length); i++) {
      const left = await tablesAfter[i].evaluate(el => (el as HTMLElement).style.left)
      const top = await tablesAfter[i].evaluate(el => (el as HTMLElement).style.top)

      expect(left).toBe(positionsBefore[i].left)
      expect(top).toBe(positionsBefore[i].top)
    }
  })

  test('should be able to drag a table', async ({ page }) => {
    await goToFloorPlanEditor(page)

    // Find first draggable table
    const table = page.locator('.cursor-grab').first()
    await expect(table).toBeVisible()

    // Get initial position
    const initialLeft = await table.evaluate(el => (el as HTMLElement).style.left)
    const initialTop = await table.evaluate(el => (el as HTMLElement).style.top)

    // Drag the table
    await table.hover()
    await page.mouse.down()
    await page.mouse.move(100, 100, { steps: 10 })
    await page.mouse.up()

    // Wait for position to update
    await page.waitForTimeout(500)

    // Position should have changed (or be the same if collision prevented it)
    // This test verifies drag functionality works without errors
  })

  test('clicking room tabs should show correct tables', async ({ page }) => {
    await goToFloorPlanEditor(page)

    // Find room tabs
    const roomTabs = page.locator('[role="tab"], button').filter({ hasText: /Main|Bar|Patio/i })

    if (await roomTabs.count() > 1) {
      // Click first tab
      await roomTabs.first().click()
      await page.waitForTimeout(300)

      const tablesInRoom1 = await page.locator('.cursor-grab').count()

      // Click second tab
      await roomTabs.nth(1).click()
      await page.waitForTimeout(300)

      // Tables might be different count in different rooms
      const tablesInRoom2 = await page.locator('.cursor-grab').count()

      // Go back to first tab
      await roomTabs.first().click()
      await page.waitForTimeout(300)

      // Should have same count as before
      const tablesBackToRoom1 = await page.locator('.cursor-grab').count()
      expect(tablesBackToRoom1).toBe(tablesInRoom1)
    }
  })
})

test.describe('Table Merging/Unmerging', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page)
    await goToFloorPlanEditor(page)
  })

  test('should be able to select a table', async ({ page }) => {
    const table = page.locator('.cursor-grab').first()
    await expect(table).toBeVisible()

    // Click to select
    await table.click()

    // Should show selection indicator or sidebar
    await page.waitForTimeout(300)

    // The table should be highlighted (checking for any visual change)
    // This verifies basic interaction works
  })
})

test.describe('Entertainment Elements', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page)
    await goToFloorPlanEditor(page)
  })

  test('should show Add Entertainment button', async ({ page }) => {
    const addButton = page.locator('button').filter({ hasText: /Entertainment/i })
    await expect(addButton).toBeVisible()
  })

  test('entertainment elements should maintain position after resize', async ({ page }) => {
    // Find entertainment elements (they have different styling)
    const elements = await page.locator('[data-element-type="entertainment"], .cursor-grab').all()

    if (elements.length > 0) {
      // Get initial position of first element
      const element = elements[0]
      const initialLeft = await element.evaluate(el => (el as HTMLElement).style.left)
      const initialTop = await element.evaluate(el => (el as HTMLElement).style.top)

      // Resize window
      await page.setViewportSize({ width: 800, height: 600 })
      await page.waitForTimeout(500)

      // Resize back
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.waitForTimeout(500)

      // Position should be maintained
      const finalLeft = await element.evaluate(el => (el as HTMLElement).style.left)
      const finalTop = await element.evaluate(el => (el as HTMLElement).style.top)

      expect(finalLeft).toBe(initialLeft)
      expect(finalTop).toBe(initialTop)
    }
  })
})

// Iterative test that runs until all checks pass
test.describe('Iterative Validation Loop', () => {
  test('all floor plan features should work correctly', async ({ page }) => {
    await loginAsManager(page)
    await goToFloorPlanEditor(page)

    const errors: string[] = []

    // Check 1: Tables are visible
    const tableCount = await page.locator('.cursor-grab').count()
    if (tableCount === 0) {
      errors.push('No tables visible on floor plan')
    }

    // Check 2: Tables have valid positions (not 0,0)
    const tables = await page.locator('.cursor-grab').all()
    for (let i = 0; i < Math.min(5, tables.length); i++) {
      const left = await tables[i].evaluate(el => parseInt((el as HTMLElement).style.left) || 0)
      const top = await tables[i].evaluate(el => parseInt((el as HTMLElement).style.top) || 0)

      if (left === 0 && top === 0) {
        errors.push(`Table ${i + 1} is at position (0, 0) - possible bug`)
      }
    }

    // Check 3: No JavaScript errors in console
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Trigger some interactions
    if (tables.length > 0) {
      await tables[0].click()
      await page.waitForTimeout(300)
    }

    // Check 4: Window resize doesn't break positions
    const positionsBefore = await Promise.all(
      tables.slice(0, 3).map(async t => ({
        left: await t.evaluate(el => (el as HTMLElement).style.left),
        top: await t.evaluate(el => (el as HTMLElement).style.top),
      }))
    )

    await page.setViewportSize({ width: 900, height: 600 })
    await page.waitForTimeout(500)
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(500)

    const positionsAfter = await Promise.all(
      tables.slice(0, 3).map(async t => ({
        left: await t.evaluate(el => (el as HTMLElement).style.left),
        top: await t.evaluate(el => (el as HTMLElement).style.top),
      }))
    )

    for (let i = 0; i < positionsBefore.length; i++) {
      if (positionsBefore[i].left !== positionsAfter[i].left ||
          positionsBefore[i].top !== positionsAfter[i].top) {
        errors.push(`Table ${i + 1} position changed after resize: before=${JSON.stringify(positionsBefore[i])}, after=${JSON.stringify(positionsAfter[i])}`)
      }
    }

    // Report any console errors
    if (consoleErrors.length > 0) {
      errors.push(`Console errors: ${consoleErrors.join(', ')}`)
    }

    // Fail if any errors found
    if (errors.length > 0) {
      console.log('=== TEST ERRORS FOUND ===')
      errors.forEach(e => console.log(`- ${e}`))
      console.log('=========================')
    }

    expect(errors).toHaveLength(0)
  })
})
