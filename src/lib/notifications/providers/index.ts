/**
 * Provider Factory — Registry pattern
 *
 * `getProvider(providerType, config)` returns the correct provider implementation
 * based on the provider type string.
 *
 * Phase 5A providers (LRS, Retekess, Display) are registered below.
 * Phase 5B providers (Voice, Kiosk) are also registered.
 */

import type { NotificationProvider, ProviderType } from '../types'
import { jtechProvider } from './jtech'
import { smsProvider } from './sms'
import { simulatorProvider } from './simulator'
import { lrsProvider } from './lrs'
import { retekessProvider } from './retekess'
import { displayProvider } from './display'
import { voiceProvider } from './voice'
import { kioskProvider } from './kiosk'

// ─── Provider Registry ──────────────────────────────────────────────────────

type ProviderFactory = (config: Record<string, unknown>) => NotificationProvider

const registry = new Map<string, ProviderFactory>()

// Register built-in providers (Phase 1)
registry.set('jtech', () => jtechProvider)
registry.set('sms', () => smsProvider)
registry.set('simulator', () => simulatorProvider)

// Phase 5A providers
registry.set('lrs', () => lrsProvider)
registry.set('retekess', () => retekessProvider)
registry.set('display', () => displayProvider)

// Phase 5B providers
registry.set('voice', () => voiceProvider)
registry.set('kiosk', () => kioskProvider)

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get a notification provider implementation by type.
 *
 * @param providerType - The provider type identifier (e.g., 'jtech', 'sms', 'simulator')
 * @param config - Provider-specific configuration object
 * @returns The matching NotificationProvider implementation
 * @throws Error if the provider type is not registered
 */
export function getProvider(
  providerType: ProviderType | string,
  config: Record<string, unknown>
): NotificationProvider {
  // Check for simulator mode override
  if (config.simulator === true || providerType === 'simulator') {
    return simulatorProvider
  }

  const factory = registry.get(providerType)
  if (!factory) {
    // W10: Unimplemented provider types (e.g. 'shelf') fall back to simulator with a warning
    console.warn(`[notification-providers] No provider registered for type "${providerType}" — falling back to simulator. Registered: ${Array.from(registry.keys()).join(', ')}`)
    return simulatorProvider
  }

  return factory(config)
}

/**
 * Register a custom provider at runtime.
 * Used for Phase 5 providers (LRS, Retekess, voice, display).
 */
export function registerProvider(
  providerType: string,
  factory: ProviderFactory
): void {
  registry.set(providerType, factory)
}

/**
 * List all registered provider types.
 */
export function getRegisteredProviderTypes(): string[] {
  return Array.from(registry.keys())
}
