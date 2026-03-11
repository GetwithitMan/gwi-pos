/**
 * Sync Configuration Registry
 *
 * Maps every syncable Prisma model to its ownership, direction, FK priority,
 * and batch size. Drives both upstream and downstream sync workers.
 */

export type SyncDirection = 'upstream' | 'downstream' | 'bidirectional' | 'none'
export type SyncOwner = 'nuc' | 'cloud' | 'both' | 'none'
export type ConflictStrategy = 'neon-wins' | 'local-wins' | 'latest-wins'

export interface SyncModelConfig {
  direction: SyncDirection
  owner: SyncOwner
  /** FK dependency ordering — lower numbers sync first */
  priority: number
  /** Max rows per sync cycle */
  batchSize: number
  /** Conflict resolution strategy for bidirectional models (default: 'neon-wins') */
  conflictStrategy?: ConflictStrategy
  /**
   * Business key columns for downstream cloud-owned models.
   * When a Neon row has a different id but matching business key to a local row,
   * the local row is deleted before upserting (Neon is authoritative).
   * This resolves ID divergence from the cloud-primary transition.
   */
  businessKey?: string[]
}

/**
 * Model registry. Every key is a Prisma model name (matches the DB table name).
 *
 * NUC-owned (upstream): transactional data generated on the NUC
 * Cloud-owned (downstream): configuration data managed from admin/cloud
 * Bidirectional: syncs both ways, filtered by lastMutatedBy column
 *   - Upstream: rows WHERE lastMutatedBy != 'cloud' (NUC-originated)
 *   - Downstream: rows WHERE lastMutatedBy = 'cloud' (cloud-originated)
 * None: local-only or special handling
 */
export const SYNC_MODELS: Record<string, SyncModelConfig> = {
  // ── Bidirectional (NUC ↔ Neon, filtered by lastMutatedBy) ─────────────
  Order:                  { direction: 'bidirectional', owner: 'both', priority: 10, batchSize: 50, conflictStrategy: 'neon-wins' },
  OrderItem:              { direction: 'bidirectional', owner: 'both', priority: 20, batchSize: 50, conflictStrategy: 'neon-wins' },
  OrderDiscount:          { direction: 'bidirectional', owner: 'both', priority: 22, batchSize: 100, conflictStrategy: 'neon-wins' },
  OrderCard:              { direction: 'bidirectional', owner: 'both', priority: 24, batchSize: 100, conflictStrategy: 'neon-wins' },
  OrderItemModifier:      { direction: 'bidirectional', owner: 'both', priority: 25, batchSize: 100, conflictStrategy: 'neon-wins' },
  Payment:                { direction: 'bidirectional', owner: 'both', priority: 30, batchSize: 50, conflictStrategy: 'neon-wins' },

  // ── NUC-owned (upstream: NUC → Neon) ──────────────────────────────────
  OrderItemIngredient:    { direction: 'upstream', owner: 'nuc', priority: 26, batchSize: 100 },
  OrderItemPizza:         { direction: 'upstream', owner: 'nuc', priority: 27, batchSize: 100 },
  OrderOwnership:         { direction: 'upstream', owner: 'nuc', priority: 12, batchSize: 100 },
  OrderOwnershipEntry:    { direction: 'upstream', owner: 'nuc', priority: 13, batchSize: 100 },
  Ticket:                 { direction: 'upstream', owner: 'nuc', priority: 15, batchSize: 100 },
  OrderItemDiscount:      { direction: 'upstream', owner: 'nuc', priority: 23, batchSize: 100 },
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
  TipShare:                  { direction: 'upstream', owner: 'nuc', priority: 67, batchSize: 100 },
  TipOutRule:                 { direction: 'upstream', owner: 'nuc', priority: 68, batchSize: 50 },
  TipPool:                    { direction: 'upstream', owner: 'nuc', priority: 69, batchSize: 50 },
  GiftCardTransaction:        { direction: 'upstream', owner: 'nuc', priority: 70, batchSize: 100 },
  HouseAccountTransaction:    { direction: 'upstream', owner: 'nuc', priority: 71, batchSize: 100 },
  RemoteVoidApproval:         { direction: 'upstream', owner: 'nuc', priority: 72, batchSize: 100 },
  DailyPrepCountTransaction:  { direction: 'upstream', owner: 'nuc', priority: 73, batchSize: 100 },
  DigitalReceipt:             { direction: 'upstream', owner: 'nuc', priority: 74, batchSize: 100 },
  BergDispenseEvent:          { direction: 'upstream', owner: 'nuc', priority: 75, batchSize: 100 },
  CouponRedemption:           { direction: 'upstream', owner: 'nuc', priority: 76, batchSize: 100 },
  Break:                      { direction: 'upstream', owner: 'nuc', priority: 41, batchSize: 100 },

  // ── Cloud-owned (downstream: Neon → NUC) ──────────────────────────────
  Organization:           { direction: 'downstream', owner: 'cloud', priority: 1, batchSize: 10 },
  Location:               { direction: 'downstream', owner: 'cloud', priority: 2, batchSize: 10 },
  Role:                   { direction: 'downstream', owner: 'cloud', priority: 3, batchSize: 50 },
  EmployeeRole:           { direction: 'downstream', owner: 'cloud', priority: 4, batchSize: 50 },
  Employee:               { direction: 'downstream', owner: 'cloud', priority: 5, batchSize: 100 },
  Category:               { direction: 'downstream', owner: 'cloud', priority: 6, batchSize: 100, businessKey: ['locationId', 'name'] },
  MenuItem:               { direction: 'downstream', owner: 'cloud', priority: 7, batchSize: 100, businessKey: ['categoryId', 'name'] },
  ModifierGroup:          { direction: 'downstream', owner: 'cloud', priority: 8, batchSize: 100 },
  Modifier:               { direction: 'downstream', owner: 'cloud', priority: 9, batchSize: 100 },
  Table:                  { direction: 'downstream', owner: 'cloud', priority: 10, batchSize: 100, businessKey: ['locationId', 'name'] },
  Section:                { direction: 'downstream', owner: 'cloud', priority: 11, batchSize: 50, businessKey: ['locationId', 'name'] },
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
  PricingOptionGroup:     { direction: 'downstream', owner: 'cloud', priority: 22, batchSize: 100 },
  PricingOption:          { direction: 'downstream', owner: 'cloud', priority: 23, batchSize: 100 },
  CourseConfig:           { direction: 'downstream', owner: 'cloud', priority: 24, batchSize: 50 },
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
  BergDevice:             { direction: 'downstream', owner: 'cloud', priority: 46, batchSize: 50 },
  BergPluMapping:         { direction: 'downstream', owner: 'cloud', priority: 47, batchSize: 100 },
  BottleProduct:          { direction: 'downstream', owner: 'cloud', priority: 48, batchSize: 100 },
  Invoice:                { direction: 'downstream', owner: 'cloud', priority: 49, batchSize: 100 },
  InvoiceLineItem:        { direction: 'downstream', owner: 'cloud', priority: 50, batchSize: 100 },
  Schedule:               { direction: 'downstream', owner: 'cloud', priority: 51, batchSize: 50 },
  ScheduledShift:         { direction: 'downstream', owner: 'cloud', priority: 52, batchSize: 100 },
  Event:                  { direction: 'downstream', owner: 'cloud', priority: 53, batchSize: 100 },
  EventPricingTier:       { direction: 'downstream', owner: 'cloud', priority: 54, batchSize: 50 },
  EventTableConfig:       { direction: 'downstream', owner: 'cloud', priority: 55, batchSize: 50 },
  Reservation:            { direction: 'downstream', owner: 'cloud', priority: 56, batchSize: 100 },
  ItemBarcode:            { direction: 'downstream', owner: 'cloud', priority: 57, batchSize: 100 },
  VoidReason:             { direction: 'downstream', owner: 'cloud', priority: 58, batchSize: 50 },
  CompReason:             { direction: 'downstream', owner: 'cloud', priority: 59, batchSize: 50 },
  FloorPlanElement:       { direction: 'downstream', owner: 'cloud', priority: 60, batchSize: 100 },
  EntertainmentWaitlist:  { direction: 'downstream', owner: 'cloud', priority: 61, batchSize: 100 },
  StorageLocation:        { direction: 'downstream', owner: 'cloud', priority: 62, batchSize: 50 },
  PrepItem:               { direction: 'downstream', owner: 'cloud', priority: 63, batchSize: 100 },
  PrepItemIngredient:     { direction: 'downstream', owner: 'cloud', priority: 64, batchSize: 100 },
  PricingOptionInventoryLink: { direction: 'downstream', owner: 'cloud', priority: 65, batchSize: 100 },
  SpiritCategory:         { direction: 'downstream', owner: 'cloud', priority: 66, batchSize: 50 },
  SpiritModifierGroup:    { direction: 'downstream', owner: 'cloud', priority: 67, batchSize: 50 },
  InventorySettings:      { direction: 'downstream', owner: 'cloud', priority: 68, batchSize: 10 },
  CfdSettings:            { direction: 'downstream', owner: 'cloud', priority: 69, batchSize: 10 },

  // ── Special / None ────────────────────────────────────────────────────
  HardwareCommand:        { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  CloudEventQueue:        { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  SyncAuditEntry:         { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  HealthCheck:            { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },

  // ── NUC-local operational tables (not synced to Neon) ───────────────
  FulfillmentEvent:       { direction: 'none', owner: 'nuc', priority: 80, batchSize: 100 },
  BridgeCheckpoint:       { direction: 'none', owner: 'nuc', priority: 81, batchSize: 10 },
  OutageQueueEntry:       { direction: 'none', owner: 'nuc', priority: 82, batchSize: 100 },
}

/** Return upstream models sorted by FK-dependency priority (lowest first).
 *  Includes bidirectional models (they sync upstream with lastMutatedBy filter). */
export function getUpstreamModels(): [string, SyncModelConfig][] {
  return Object.entries(SYNC_MODELS)
    .filter(([, c]) => c.direction === 'upstream' || c.direction === 'bidirectional')
    .sort(([, a], [, b]) => a.priority - b.priority)
}

/** Return downstream models sorted by FK-dependency priority (lowest first).
 *  Includes bidirectional models (they sync downstream with lastMutatedBy filter). */
export function getDownstreamModels(): [string, SyncModelConfig][] {
  return Object.entries(SYNC_MODELS)
    .filter(([, c]) => c.direction === 'downstream' || c.direction === 'bidirectional')
    .sort(([, a], [, b]) => a.priority - b.priority)
}

/** Return only bidirectional model names */
export function getBidirectionalModelNames(): Set<string> {
  return new Set(
    Object.entries(SYNC_MODELS)
      .filter(([, c]) => c.direction === 'bidirectional')
      .map(([name]) => name)
  )
}

/** Get the conflict resolution strategy for a model (default: 'neon-wins') */
export function getConflictStrategy(model: string): ConflictStrategy {
  return SYNC_MODELS[model]?.conflictStrategy ?? 'neon-wins'
}

/** Get the business key columns for a cloud-owned downstream model, if declared */
export function getBusinessKey(model: string): string[] | undefined {
  return SYNC_MODELS[model]?.businessKey
}

export const UPSTREAM_INTERVAL_MS = parseInt(
  process.env.SYNC_UPSTREAM_INTERVAL_MS || '1000',
  10
)

export const DOWNSTREAM_INTERVAL_MS = parseInt(
  process.env.SYNC_DOWNSTREAM_INTERVAL_MS || '15000',
  10
)
