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
  ModifierGroup:          { direction: 'downstream', owner: 'cloud', priority: 8, batchSize: 100, businessKey: ['locationId', 'name'] },
  Modifier:               { direction: 'downstream', owner: 'cloud', priority: 9, batchSize: 100, businessKey: ['modifierGroupId', 'name'] },
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
  BottleProduct:          { direction: 'bidirectional', owner: 'both', priority: 48, batchSize: 100 },
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
  SpiritCategory:         { direction: 'bidirectional', owner: 'both', priority: 66, batchSize: 50 },
  SpiritModifierGroup:    { direction: 'bidirectional', owner: 'both', priority: 67, batchSize: 50 },
  InventorySettings:      { direction: 'downstream', owner: 'cloud', priority: 68, batchSize: 10 },
  CfdSettings:            { direction: 'downstream', owner: 'cloud', priority: 69, batchSize: 10 },

  // ── Liquor Builder + Spirit Upgrades (NUC → Neon) ────────────────────
  // SpiritCategory, BottleProduct, SpiritModifierGroup moved to bidirectional above
  SpiritUpsellEvent:      { direction: 'upstream', owner: 'nuc', priority: 73, batchSize: 100 },

  // ── Pizza Builder (NUC → Neon) ──────────────────────────────────────
  PizzaConfig:            { direction: 'upstream', owner: 'nuc', priority: 74, batchSize: 10 },
  PizzaSize:              { direction: 'upstream', owner: 'nuc', priority: 75, batchSize: 50 },
  PizzaCrust:             { direction: 'upstream', owner: 'nuc', priority: 76, batchSize: 50 },
  PizzaSauce:             { direction: 'upstream', owner: 'nuc', priority: 77, batchSize: 50 },
  PizzaCheese:            { direction: 'upstream', owner: 'nuc', priority: 78, batchSize: 50 },
  PizzaTopping:           { direction: 'upstream', owner: 'nuc', priority: 79, batchSize: 100 },
  PizzaSpecialty:         { direction: 'upstream', owner: 'nuc', priority: 80, batchSize: 50 },

  // ── Tips + Payroll (NUC → Neon) ─────────────────────────────────────
  PaidInOut:              { direction: 'upstream', owner: 'nuc', priority: 81, batchSize: 100 },
  TipGroupTemplate:       { direction: 'upstream', owner: 'nuc', priority: 82, batchSize: 50 },
  TipGroup:               { direction: 'upstream', owner: 'nuc', priority: 83, batchSize: 50 },
  TipGroupMembership:     { direction: 'upstream', owner: 'nuc', priority: 84, batchSize: 100 },
  TipGroupSegment:        { direction: 'upstream', owner: 'nuc', priority: 85, batchSize: 100 },
  TipAdjustment:          { direction: 'upstream', owner: 'nuc', priority: 86, batchSize: 100 },
  PayrollPeriod:          { direction: 'upstream', owner: 'nuc', priority: 87, batchSize: 50 },
  PayStub:                { direction: 'upstream', owner: 'nuc', priority: 88, batchSize: 100 },
  PayrollSettings:        { direction: 'upstream', owner: 'nuc', priority: 89, batchSize: 10 },

  // ── Inventory + Recipes (NUC → Neon) ────────────────────────────────
  InventoryTransaction:   { direction: 'upstream', owner: 'nuc', priority: 90, batchSize: 100 },
  StockAlert:             { direction: 'upstream', owner: 'nuc', priority: 91, batchSize: 100 },
  InventoryCount:         { direction: 'upstream', owner: 'nuc', priority: 92, batchSize: 50 },
  InventoryCountItem:     { direction: 'upstream', owner: 'nuc', priority: 93, batchSize: 100 },
  InventoryCountEntry:    { direction: 'upstream', owner: 'nuc', priority: 94, batchSize: 100 },
  WasteLog:               { direction: 'upstream', owner: 'nuc', priority: 95, batchSize: 50 },
  WasteLogEntry:          { direction: 'upstream', owner: 'nuc', priority: 96, batchSize: 100 },
  RecipeIngredient:       { direction: 'upstream', owner: 'nuc', priority: 97, batchSize: 100 },
  MenuItemRecipeIngredient: { direction: 'upstream', owner: 'nuc', priority: 98, batchSize: 100 },
  MenuItemIngredient:     { direction: 'upstream', owner: 'nuc', priority: 99, batchSize: 100 },
  IngredientSwapGroup:    { direction: 'upstream', owner: 'nuc', priority: 100, batchSize: 50 },
  IngredientStockAdjustment: { direction: 'upstream', owner: 'nuc', priority: 101, batchSize: 100 },
  IngredientRecipe:       { direction: 'upstream', owner: 'nuc', priority: 102, batchSize: 100 },
  IngredientCostHistory:  { direction: 'upstream', owner: 'nuc', priority: 103, batchSize: 100 },
  VendorOrder:            { direction: 'upstream', owner: 'nuc', priority: 104, batchSize: 50 },
  VendorOrderLineItem:    { direction: 'upstream', owner: 'nuc', priority: 105, batchSize: 100 },
  MarginEdgeProductMapping: { direction: 'upstream', owner: 'nuc', priority: 106, batchSize: 50 },
  PendingDeduction:       { direction: 'upstream', owner: 'nuc', priority: 107, batchSize: 100 },
  DeductionRun:           { direction: 'upstream', owner: 'nuc', priority: 108, batchSize: 50 },

  // ── Orders + Events (NUC → Neon) ────────────────────────────────────
  OrderEvent:             { direction: 'upstream', owner: 'nuc', priority: 109, batchSize: 100 },
  OrderSnapshot:          { direction: 'upstream', owner: 'nuc', priority: 110, batchSize: 50 },
  OrderItemSnapshot:      { direction: 'upstream', owner: 'nuc', priority: 111, batchSize: 100 },

  // ── Seating + Timed Sessions (NUC → Neon) ───────────────────────────
  Seat:                   { direction: 'upstream', owner: 'nuc', priority: 112, batchSize: 100 },
  TimedSession:           { direction: 'upstream', owner: 'nuc', priority: 113, batchSize: 50 },

  // ── Payments + Cards (NUC → Neon) ───────────────────────────────────
  CardProfile:            { direction: 'upstream', owner: 'nuc', priority: 114, batchSize: 100 },
  WalkoutRetry:           { direction: 'upstream', owner: 'nuc', priority: 115, batchSize: 50 },
  PaymentReaderLog:       { direction: 'upstream', owner: 'nuc', priority: 116, batchSize: 100 },
  ChargebackCase:         { direction: 'upstream', owner: 'nuc', priority: 117, batchSize: 50 },
  PmsChargeAttempt:       { direction: 'upstream', owner: 'nuc', priority: 118, batchSize: 50 },

  // ── Scheduling + Shifts (NUC → Neon) ────────────────────────────────
  ShiftSwapRequest:       { direction: 'upstream', owner: 'nuc', priority: 119, batchSize: 50 },
  DailyPrepCount:         { direction: 'upstream', owner: 'nuc', priority: 120, batchSize: 50 },
  DailyPrepCountItem:     { direction: 'upstream', owner: 'nuc', priority: 121, batchSize: 100 },

  // ── Bottle Service + Online Ordering (NUC → Neon) ───────────────────
  BottleServiceTier:      { direction: 'upstream', owner: 'nuc', priority: 122, batchSize: 50 },

  // ── Cake Orders (bidirectional + upstream) ─────────────────────────
  CakeOrder:              { direction: 'bidirectional', owner: 'both', priority: 123, batchSize: 100 },
  CakeQuote:              { direction: 'bidirectional', owner: 'both', priority: 124, batchSize: 100 },
  CakePayment:            { direction: 'upstream', owner: 'nuc', priority: 125, batchSize: 100 },
  CakeOrderChange:        { direction: 'upstream', owner: 'nuc', priority: 126, batchSize: 200 },

  // ── Misc Config (downstream — cloud-owned) ─────────────────────────
  ReasonAccess:           { direction: 'downstream', owner: 'cloud', priority: 70, batchSize: 50 },
  QuickBarPreference:     { direction: 'downstream', owner: 'cloud', priority: 71, batchSize: 50 },
  QuickBarDefault:        { direction: 'downstream', owner: 'cloud', priority: 72, batchSize: 50 },

  // ── Operational Logs (NUC → Neon, lower priority) ───────────────────
  VenueLog:               { direction: 'upstream', owner: 'nuc', priority: 130, batchSize: 100 },
  SevenShiftsDailySalesPush: { direction: 'upstream', owner: 'nuc', priority: 131, batchSize: 50 },

  // ── NUC-local only (device registration, sessions — not synced) ─────
  RegisteredDevice:       { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 },
  MobileSession:          { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 },
  ServerRegistrationToken: { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 },

  // ── Special / None ────────────────────────────────────────────────────
  HardwareCommand:        { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  CloudEventQueue:        { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  SyncAuditEntry:         { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },
  HealthCheck:            { direction: 'none', owner: 'none', priority: 0, batchSize: 0 },

  // ── NUC-local operational tables (not synced to Neon) ───────────────
  FulfillmentEvent:       { direction: 'none', owner: 'nuc', priority: 80, batchSize: 100 },
  BridgeCheckpoint:       { direction: 'none', owner: 'nuc', priority: 81, batchSize: 10 },
  OutageQueueEntry:       { direction: 'none', owner: 'nuc', priority: 82, batchSize: 100 },
  SocketEventLog:         { direction: 'none', owner: 'nuc', priority: 83, batchSize: 0 },
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
  process.env.SYNC_DOWNSTREAM_INTERVAL_MS || '2000',
  10
)

/**
 * SYNC COVERAGE VALIDATOR
 *
 * Called at server startup. Queries the database for all tables and
 * verifies every one is in SYNC_MODELS. If any table is missing,
 * logs a CRITICAL error so it's impossible to miss.
 *
 * This prevents the "58 missing models" problem from ever happening again.
 * New tables added via migration MUST be added to SYNC_MODELS before deploy.
 */
/**
 * SYNC COVERAGE VALIDATOR + AUTO-REGISTER
 *
 * Called at server startup. Queries the database for all tables and
 * verifies every one is in SYNC_MODELS. If any table is missing,
 * it is AUTOMATICALLY added as upstream sync (NUC → Neon) with
 * default settings. No manual intervention needed.
 *
 * This means: add a model to schema.prisma, run migration, deploy.
 * The sync system picks it up automatically. Zero gaps. Ever.
 *
 * Tables that should NOT sync (operational/local-only) are explicitly
 * listed in LOCAL_ONLY_TABLES below.
 */

/** Tables that must NEVER sync — operational/ephemeral NUC-local data */
const LOCAL_ONLY_TABLES = new Set([
  'HardwareCommand', 'CloudEventQueue', 'SyncAuditEntry', 'HealthCheck',
  'FulfillmentEvent', 'BridgeCheckpoint', 'OutageQueueEntry', 'SocketEventLog',
  'RegisteredDevice', 'MobileSession', 'ServerRegistrationToken',
  'PaymentSession', // local payment state machine
])

/** System/internal tables that are not Prisma models */
const SYSTEM_TABLES = new Set([
  '_prisma_migrations', '_gwi_migrations', '_gwi_sync_state',
  '_pending_datacap_sales', '_pending_captures',
])

export async function validateSyncCoverage(db: { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> }): Promise<void> {
  try {
    const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name NOT LIKE '\\_%'`
    )

    const configuredModels = new Set(Object.keys(SYNC_MODELS))
    let autoRegistered = 0

    for (const { table_name } of tables) {
      if (SYSTEM_TABLES.has(table_name)) continue
      if (configuredModels.has(table_name)) continue

      if (LOCAL_ONLY_TABLES.has(table_name)) {
        // Known local-only — register as none
        SYNC_MODELS[table_name] = { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 }
        console.log('[SYNC CONFIG] Registered local-only table:', table_name)
      } else {
        // Unknown table — auto-register as upstream sync (safe default)
        const nextPriority = Math.max(...Object.values(SYNC_MODELS).map(c => c.priority)) + 1
        SYNC_MODELS[table_name] = {
          direction: 'upstream',
          owner: 'nuc',
          priority: nextPriority,
          batchSize: 50,
        }
        autoRegistered++
        console.warn('[SYNC CONFIG] Auto-registered NEW table for sync:', table_name, '(upstream, priority:', nextPriority + ')')
      }
    }

    if (autoRegistered > 0) {
      console.warn('[SYNC CONFIG] ⚠️  ' + autoRegistered + ' table(s) auto-registered. Add them to sync-config.ts for permanent config.')
    }

    const totalSynced = Object.values(SYNC_MODELS).filter(c => c.direction !== 'none').length
    console.log('[SYNC CONFIG] ✓ ' + totalSynced + ' tables syncing, ' + Object.keys(SYNC_MODELS).length + ' total configured')
  } catch (err) {
    console.warn('[SYNC CONFIG] Coverage check failed:', err instanceof Error ? err.message : err)
  }
}
