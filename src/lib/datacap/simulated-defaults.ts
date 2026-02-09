/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  🚨 SIMULATED / DEV-ONLY DEFAULTS — REMOVE BEFORE GO-LIVE 🚨           ║
 * ║                                                                         ║
 * ║  This file contains ALL dummy/placeholder values used when the          ║
 * ║  payment processor is in "simulated" mode. These values allow the       ║
 * ║  POS to function without real Datacap credentials during development.   ║
 * ║                                                                         ║
 * ║  GO-LIVE CHECKLIST:                                                     ║
 * ║  1. Every location MUST have real merchantId + operatorId in settings   ║
 * ║  2. Every PaymentReader MUST have communicationMode = 'local'           ║
 * ║  3. Location settings.payments.processor MUST NOT be 'simulated'        ║
 * ║  4. After confirming the above, DELETE this entire file                 ║
 * ║  5. Remove the import in client.ts (search: simulated-defaults)        ║
 * ║  6. Run `grep -r "SIMULATED_DEFAULTS" src/` to verify zero references  ║
 * ║                                                                         ║
 * ║  Search tag for global cleanup: SIMULATED_DEFAULTS                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

export const SIMULATED_DEFAULTS = {
  /** Placeholder merchantId when no real credentials configured */
  merchantId: 'SIMULATED_MERCHANT',

  /** Placeholder operatorId when no real credentials configured */
  operatorId: 'SIMULATED_OPERATOR',
} as const

/**
 * Returns true if a value is a simulated placeholder that must be
 * replaced before go-live. Use this to add runtime warnings.
 */
export function isSimulatedValue(value: string | undefined | null): boolean {
  if (!value) return false
  return value.startsWith('SIMULATED_')
}
