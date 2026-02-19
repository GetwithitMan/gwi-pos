/**
 * Inventory Calculations Utility
 *
 * This file is a barrel re-export from the modular inventory/ directory.
 * All logic has been extracted into focused sub-modules:
 *
 * - inventory/types.ts          — Shared types and interfaces
 * - inventory/unit-conversion.ts — Unit conversion system (weight, volume, count)
 * - inventory/helpers.ts        — Shared helpers (toNumber, getEffectiveCost, multipliers, prep explosion)
 * - inventory/theoretical-usage.ts — Theoretical usage calculation for reports
 * - inventory/recipe-costing.ts — Recipe costing and ingredient cost calculation
 * - inventory/order-deduction.ts — Auto-deduction on order paid
 * - inventory/void-waste.ts     — Waste path for voided items that were made
 * - inventory/prep-stock.ts     — Prep stock deduction on send to kitchen
 */

export * from './inventory'
