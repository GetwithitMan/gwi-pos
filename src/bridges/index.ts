/**
 * Domain Bridge Index
 *
 * Bridges define the communication contracts between domains.
 * Domains NEVER import from each other directly - they use bridges.
 *
 * Each bridge is bidirectional:
 * - Domain A can call methods to get data from Domain B
 * - Domain A can emit events that Domain B listens to
 */

export * from './floor-to-order'
export * from './order-to-menu'
export * from './order-to-inventory'
export * from './order-to-hardware'
export * from './order-to-financial'
export * from './floor-to-guest'
export * from './floor-to-events'
export * from './employee-to-floor'
export * from './events-to-guest'
export * from './events-to-financial'
export * from './financial-to-guest'
export * from './reporting-aggregator'
