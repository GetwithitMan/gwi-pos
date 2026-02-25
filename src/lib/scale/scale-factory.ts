/**
 * Scale Factory
 *
 * Creates the correct ScaleProtocol implementation based on scale type.
 * Extensible for future scale brands/models.
 */

import type { ScaleProtocol, SerialConfig } from './scale-protocol'
import { CasPdIIProtocol } from './cas-pd-ii'

/**
 * Create a ScaleProtocol instance for the given scale type.
 *
 * @param scaleType - The protocol type identifier (matches Scale.scaleType in DB)
 * @param config - Serial port configuration
 * @returns ScaleProtocol implementation
 * @throws Error if scaleType is unknown
 */
export function createScaleProtocol(scaleType: string, config: SerialConfig): ScaleProtocol {
  switch (scaleType) {
    case 'CAS_PD_II':
      return new CasPdIIProtocol(config)
    default:
      throw new Error(`Unknown scale type: ${scaleType}. Supported: CAS_PD_II`)
  }
}
