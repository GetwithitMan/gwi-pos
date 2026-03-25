/**
 * Provider Factory — Registry pattern
 *
 * `getProvider(providerType, config)` returns the correct provider implementation
 * based on the provider type string.
 *
 * New providers (LRS, Retekess, voice, etc.) are added here in later phases.
 */

import type { NotificationProvider, ProviderType } from '../types'
import { jtechProvider } from './jtech'
import { smsProvider } from './sms'
import { simulatorProvider } from './simulator'

// ─── Provider Registry ──────────────────────────────────────────────────────

type ProviderFactory = (config: Record<string, unknown>) => NotificationProvider

const registry = new Map<string, ProviderFactory>()

// Register built-in providers
registry.set('jtech', () => jtechProvider)
registry.set('sms', () => smsProvider)
registry.set('simulator', () => simulatorProvider)

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
    throw new Error(`Unknown notification provider type: ${providerType}. Registered: ${Array.from(registry.keys()).join(', ')}`)
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
