/**
 * Sync Configuration Registry
 *
 * Maps every syncable Prisma model to its ownership, direction, FK priority,
 * and batch size. Drives both upstream and downstream sync workers.
 */

export type SyncDirection = 'upstream' | 'downstream' | 'none'
export type SyncOwner = 'nuc' | 'cloud' | 'none'

export interface SyncModelConfig {
  direction: SyncDirection
  owner: SyncOwner
  /** FK dependency ordering — lower numbers sync first */
  priority: number
  /** Max rows per sync cycle */
  batchSize: number
}

/**
 * Model registry. Every key is a Prisma model name (matches the DB table name).
 *
 * NUC-owned (upstream): transactional data generated on the NUC
 * Cloud-owned (downstream): configuration data managed from admin/cloud
 * None: local-only or special handling
 */
export const SYNC_MODELS: Record<string, SyncModelConfig> = {
  // ── NUC-owned (upstream: NUC → Neon) ──────────────────────────────────
  Order:                  { direction: 'upstream', owner: 'nuc', priority: 10, batchSize: 50 },
  OrderOwnership:         { direction: 'upstream', owner: 'nuc', priority: 12, batchSize: 100 },
  OrderOwnershipEntry:    { direction: 'upstream', owner: 'nuc', priority: 13, batchSize: 100 },
  Ticket:                 { direction: 'upstream', owner: 'nuc', priority: 15, batchSize: 100 },
  OrderItem:              { direction: 'upstream', owner: 'nuc', priority: 20, batchSize: 50 },
  OrderDiscount:          { direction: 'upstream', owner: 'nuc', priority: 22, batchSize: 100 },
  OrderItemDiscount:      { direction: 'upstream', owner: 'nuc', priority: 23, batchSize: 100 },
  OrderCard:              { direction: 'upstream', owner: 'nuc', priority: 24, batchSize: 100 },
  OrderItemModifier:      { direction: 'upstream', owner: 'nuc', priority: 25, batchSize: 100 },
  Payment:                { direction: 'upstream', owner: 'nuc', priority: 30, batchSize: 50 },
  RefundLog:              { direction: 'upstream', owner: 'nuc', priority: 32, batchSize: 100 },
  Shift:                  { direction: 'upstream', owner: 'nuc', priority: 35, batchSize: 100 },
  Drawer:                 { direction: 'upstream', owner: 'nuc', priority: 36, batchSize: 100 },
  TimeClockEntry:         { direction: 'upstream', owner: 'nuc', priority: 40, batchSize: 100 },
  TipLedger:              { direction: 'upstream', owner: 'nuc', priority: 45, batchSize: 100 },
  TipLedgerEntry:         { direction: 'upstream', owner: 'nuc', priority: 46, batchSize: 100 },
  TipTransaction:         { direction: 'upstream', owner: 'nuc', priority: 47, batchSize: 100 },
  TipDebt:                { direction: 'upstream', owner: 'nuc', priority: 48, batchSize: 100 },
  CashTipDeclaration:     { direction: 'upstream', owner: 'nuc', priority: 49, batchSize: 100 },
  InventoryItemTransaction: { direction: 'upstream', owner: 'nuc', priority: 50, batchSize: 100 },
  PrintJob:               { direction: 'upstream', owner: 'nuc', priority: 55, batchSize: 100 },
  VoidLog:                { direction: 'upstream', owner: 'nuc', priority: 60, batchSize: 100 },
  AuditLog:               { direction: 'upstream', owner: 'nuc', priority: 65, batchSize: 100 },
  ErrorLog:               { direction: 'upstream', owner: 'nuc', priority: 66, batchSize: 100 },

  // ── Cloud-owned (downstream: Neon → NUC) ──────────────────────────────
  Organization:           { direction: 'downstream', owner: 'cloud', priority: 1, batchSize: 10 },
  Location:               { direction: 'downstream', owner: 'cloud', priority: 2, batchSize: 10 },
  Role:                   { direction: 'downstream', owner: 'cloud', priority: 3, batchSize: 50 },
  EmployeeRole:           { direction: 'downstream', owner: 'cloud', priority: 4, batchSize: 50 },
  Employee:               { direction: 'downstream', owner: 'cloud', priority: 5, batchSize: 100 },
  Category:               { direction: 'downstream', owner: 'cloud', priority: 6, batchSize: 100 },
  MenuItem:               { direction: 'downstream', owner: 'cloud', priority: 7, batchSize: 100 },
  ModifierGroup:          { direction: 'downstream', owner: 'cloud', priority: 8, batchSize: 100 },
  Modifier:               { direction: 'downstream', owner: 'cloud', priority: 9, batchSize: 100 },
  Table:                  { direction: 'downstream', owner: 'cloud', priority: 10, batchSize: 100 },
  Section:                { direction: 'downstream', owner: 'cloud', priority: 11, batchSize: 50 },
  OrderType:              { direction: 'downstream', owner: 'cloud', priority: 12, batchSize: 50 },
  Printer:                { direction: 'downstream', owner: 'cloud', priority: 13, batchSize: 50 },
  PrintRoute:             { direction: 'downstream', owner: 'cloud', priority: 14, batchSize: 50 },
  PrintRule:              { direction: 'downstream', owner: 'cloud', priority: 15, batchSize: 50 },
  KDSScreen:              { direction: 'downstream', owner: 'cloud', priority: 16, batchSize: 50 },
  KDSScreenStation:       { direction: 'downstream', owner: 'cloud', priority: 17, batchSize: 50 },
  Terminal:               { direction: 'downstream', owner: 'cloud', priority: 18, batchSize: 50 },
  PaymentReader:          { direction: 'downstream', owner: 'cloud', priority: 19, batchSize: 50 },
  Scale:                  { direction: 'downstream', owner: 'cloud', priority: 20, batchSize: 10 },
  Station:                { direction: 'downstream', owner: 'cloud', priority: 21, batchSize: 50 },
  Customer:               { direction: 'downstream', owner: 'cloud', priority: 25, batchSize: 100 },
  Coupon:                 { direction: 'downstream', owner: 'cloud', priority: 26, batchSize: 50 },
  DiscountRule:           { direction: 'downstream', owner: 'cloud', priority: 27, batchSize: 50 },
  GiftCard:               { direction: 'downstream', owner: 'cloud', priority: 28, batchSize: 100 },
  HouseAccount:           { direction: 'downstream', owner: 'cloud', priority: 29, batchSize: 50 },
  Vendor:                 { direction: 'downstream', owner: 'cloud', priority: 30, batchSize: 50 },
  InventoryItem:          { direction: 'downstream', owner: 'cloud', priority: 31, batchSize: 100 },
  InventoryItemStorage:   { direction: 'downstream', owner: 'cloud', priority: 32, batchSize: 100 },
  Ingredient:             { direction: 'downstream', owner: 'cloud', priority: 33, batchSize: 100 },
  IngredientCategory:     { direction: 'downstream', owner: 'cloud', priority: 34, batchSize: 50 },
  MenuItemRecipe:         { direction: 'downstream', owner: 'cloud', priority: 35, batchSize: 100 },
  ComboTemplate:          { direction: 'downstream', owner: 'cloud', priority: 36, batchSize: 50 },
  ComboComponent:         { direction: 'downstream', owner: 'cloud', priority: 37, batchSize: 50 },
  ComboComponentOption:   { direction: 'downstream', owner: 'cloud', priority: 38, batchSize: 50 },
  ModifierGroupTemplate:  { direction: 'downstream', owner: 'cloud', priority: 39, batchSize: 50 },
  ModifierTemplate:       { direction: 'downstream', owner: 'cloud', priority: 40, batchSize: 50 },
  ModifierInventoryLink:  { direction: 'downstream', owner: 'cloud', priority: 41, batchSize: 50 },
  PrepStation:            { direction: 'downstream', owner: 'cloud', priority: 42, batchSize: 50 },
  PrepTrayConfig:         { direction: 'downstream', owner: 'cloud', priority: 43, batchSize: 50 },
  TaxRule:                { direction: 'downstream', owner: 'cloud', priority: 44, batchSize: 50 },
  SectionAssignment:      { direction: 'downstream', owner: 'cloud', priority: 45, batchSize: 50 },

  // ── Special / None ────────────────────────────────────────────────────
  HardwareCommand:        { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  CloudEventQueue:        { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  SyncAuditEntry:         { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  HealthCheck:            { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  PerformanceLog:         { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
}

/** Return upstream models sorted by FK-dependency priority (lowest first) */
export function getUpstreamModels(): [string, SyncModelConfig][] {
  return Object.entries(SYNC_MODELS)
    .filter(([, c]) => c.direction === 'upstream')
    .sort(([, a], [, b]) => a.priority - b.priority)
}

/** Return downstream models sorted by FK-dependency priority (lowest first) */
export function getDownstreamModels(): [string, SyncModelConfig][] {
  return Object.entries(SYNC_MODELS)
    .filter(([, c]) => c.direction === 'downstream')
    .sort(([, a], [, b]) => a.priority - b.priority)
}

export const UPSTREAM_INTERVAL_MS = parseInt(
  process.env.SYNC_UPSTREAM_INTERVAL_MS || '5000',
  10
)

export const DOWNSTREAM_INTERVAL_MS = parseInt(
  process.env.SYNC_DOWNSTREAM_INTERVAL_MS || '15000',
  10
)
