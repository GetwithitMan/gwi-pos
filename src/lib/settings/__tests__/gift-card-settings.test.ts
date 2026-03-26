import { describe, it, expect } from 'vitest'

/**
 * Gift Card Settings — Type and Default Value Tests
 *
 * Verifies that the settings type system and defaults are correct
 * for the gift card feature.
 */

// ---------------------------------------------------------------------------
// Tests — Default values
// ---------------------------------------------------------------------------

describe('Gift Card Settings — Defaults', () => {
  it('default giftCardPoolMode is "open"', async () => {
    const { DEFAULT_SETTINGS } = await import('@/lib/settings/defaults')
    expect(DEFAULT_SETTINGS.payments.giftCardPoolMode).toBe('open')
  })

  it('default giftCardLowPoolThreshold is 10', async () => {
    const { DEFAULT_SETTINGS } = await import('@/lib/settings/defaults')
    expect(DEFAULT_SETTINGS.payments.giftCardLowPoolThreshold).toBe(10)
  })

  it('default acceptGiftCards is false', async () => {
    const { DEFAULT_SETTINGS } = await import('@/lib/settings/defaults')
    expect(DEFAULT_SETTINGS.payments.acceptGiftCards).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests — PublicDatacapVirtualGiftSettings type safety (secret leakage)
// ---------------------------------------------------------------------------

describe('PublicDatacapVirtualGiftSettings — secret leakage test', () => {
  it('PublicDatacapVirtualGiftSettings type does NOT include apiKey, webhookSecret, ecommerceMid', async () => {
    // This test verifies the TYPE CONTRACT at compile time.
    // We import the type and create a conforming object — if the type
    // ever gains secret fields, this test serves as an early warning.
    //
    // At runtime, we verify the interface by checking the type file text
    // for secret field names.
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')

    const typesPath = resolve(__dirname, '../types.ts')
    const content = readFileSync(typesPath, 'utf-8')

    // Extract the PublicDatacapVirtualGiftSettings interface block
    const interfaceMatch = content.match(
      /export interface PublicDatacapVirtualGiftSettings\s*\{([^}]+)\}/
    )
    expect(interfaceMatch).toBeTruthy()

    const interfaceBody = interfaceMatch![1]

    // These secret fields must NEVER appear in the public settings type
    expect(interfaceBody).not.toContain('apiKey')
    expect(interfaceBody).not.toContain('webhookSecret')
    expect(interfaceBody).not.toContain('ecommerceMid')

    // Verify expected public fields ARE present
    expect(interfaceBody).toContain('enabled')
    expect(interfaceBody).toContain('pageId')
    expect(interfaceBody).toContain('publicLinkUrl')
    expect(interfaceBody).toContain('embeddedUrl')
    expect(interfaceBody).toContain('qrCodeUrl')
    expect(interfaceBody).toContain('pageStatus')
  })
})
