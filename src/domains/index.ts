/**
 * GWI POS Domain Index
 *
 * This file re-exports all public APIs from each domain.
 * Import from here for cross-domain access.
 *
 * IMPORTANT: Domains should NOT import from each other directly.
 * Use bridge interfaces for cross-domain communication.
 */

// Domain exports
export * as FloorPlan from './floor-plan'
export * as OrderManagement from './order-management'
export * as Menu from './menu'
export * as Inventory from './inventory'
export * as Employee from './employee'
export * as Reporting from './reporting'
export * as Guest from './guest'
export * as Hardware from './hardware'
export * as Events from './events'
export * as Financial from './financial'

// Bridge exports
export * from '../bridges'
