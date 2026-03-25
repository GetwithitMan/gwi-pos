/**
 * Sync Configuration Registry
 *
 * Maps every syncable Prisma model to its ownership, direction, FK priority,
 * and batch size. Drives both upstream and downstream sync workers.
 */

import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('sync-config')

export type SyncDirection = 'upstream' | 'downstream' | 'bidirectional' | 'none'
export type SyncOwner = 'nuc' | 'cloud' | 'both' | 'none'
export type ConflictStrategy = 'neon-wins' | 'local-wins' | 'latest-wins' | 'quarantine'

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
  /**
   * Fields to skip during downstream sync ON CONFLICT UPDATE.
   * These columns are still INSERTed on first sync (new row), but are NOT
   * overwritten on subsequent downstream upserts. Use for fields that are
   * set locally (e.g., Terminal pairing state) but where the model is
   * otherwise cloud-owned.
   */
  skipFields?: string[]
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
export const SYNC_MODELS: Readonly<Record<string, SyncModelConfig>> = {
  // ── Bidirectional (NUC ↔ Neon, filtered by lastMutatedBy) ─────────────
  // RULE: Cloud routes MUST set lastMutatedBy:'cloud', NUC routes MUST set lastMutatedBy:'local'.
  // Downstream sync only pulls rows WHERE lastMutatedBy='cloud'. See docs/features/offline-sync.md "Bidirectional Sync Protocol".
  Order:                  { direction: 'bidirectional', owner: 'both', priority: 10, batchSize: 200, conflictStrategy: 'quarantine' },
  OrderItem:              { direction: 'bidirectional', owner: 'both', priority: 20, batchSize: 200, conflictStrategy: 'quarantine' },
  OrderDiscount:          { direction: 'bidirectional', owner: 'both', priority: 22, batchSize: 100, conflictStrategy: 'quarantine' },
  OrderCard:              { direction: 'bidirectional', owner: 'both', priority: 24, batchSize: 100, conflictStrategy: 'quarantine' },
  OrderItemModifier:      { direction: 'bidirectional', owner: 'both', priority: 25, batchSize: 100, conflictStrategy: 'quarantine' },
  Payment:                { direction: 'bidirectional', owner: 'both', priority: 30, batchSize: 200, conflictStrategy: 'quarantine' },

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
  EmployeePermissionOverride: { direction: 'upstream', owner: 'nuc', priority: 51, batchSize: 100 },
  PrintJob:               { direction: 'upstream', owner: 'nuc', priority: 55, batchSize: 100 },
  VoidLog:                { direction: 'upstream', owner: 'nuc', priority: 60, batchSize: 100 },
  AuditLog:               { direction: 'upstream', owner: 'nuc', priority: 65, batchSize: 100 },
  ErrorLog:               { direction: 'upstream', owner: 'nuc', priority: 66, batchSize: 100 },
  TipShare:                  { direction: 'upstream', owner: 'nuc', priority: 67, batchSize: 100 },
  TipOutRule:                 { direction: 'bidirectional', owner: 'both', priority: 68, batchSize: 50 },
  TipPool:                    { direction: 'bidirectional', owner: 'both', priority: 69, batchSize: 50 },
  GiftCardTransaction:        { direction: 'upstream', owner: 'nuc', priority: 70, batchSize: 100 },
  HouseAccountTransaction:    { direction: 'upstream', owner: 'nuc', priority: 71, batchSize: 100 },
  RemoteVoidApproval:         { direction: 'upstream', owner: 'nuc', priority: 72, batchSize: 100 },
  DailyPrepCountTransaction:  { direction: 'upstream', owner: 'nuc', priority: 73, batchSize: 100 },
  DigitalReceipt:             { direction: 'upstream', owner: 'nuc', priority: 74, batchSize: 100 },
  BergDispenseEvent:          { direction: 'upstream', owner: 'nuc', priority: 75, batchSize: 100 },
  CouponRedemption:           { direction: 'upstream', owner: 'nuc', priority: 76, batchSize: 100 },
  Break:                      { direction: 'upstream', owner: 'nuc', priority: 41, batchSize: 100 },

  // ── Cloud-owned (downstream: Neon → NUC) ──────────────────────────────
  Organization:           { direction: 'downstream', owner: 'cloud', priority: 201, batchSize: 10 },
  Location:               { direction: 'downstream', owner: 'cloud', priority: 202, batchSize: 10 },
  Role:                   { direction: 'downstream', owner: 'cloud', priority: 203, batchSize: 50 },
  EmployeeRole:           { direction: 'downstream', owner: 'cloud', priority: 204, batchSize: 50 },
  Employee:               { direction: 'downstream', owner: 'cloud', priority: 205, batchSize: 100 },
  Category:               { direction: 'downstream', owner: 'cloud', priority: 206, batchSize: 200, businessKey: ['locationId', 'name'] },
  MenuItem:               { direction: 'downstream', owner: 'cloud', priority: 207, batchSize: 200, businessKey: ['categoryId', 'name'] },
  ModifierGroup:          { direction: 'downstream', owner: 'cloud', priority: 208, batchSize: 200, businessKey: ['locationId', 'name'] },
  Modifier:               { direction: 'downstream', owner: 'cloud', priority: 209, batchSize: 200, businessKey: ['modifierGroupId', 'name'] },
  Table:                  { direction: 'downstream', owner: 'cloud', priority: 210, batchSize: 100, businessKey: ['locationId', 'name'], skipFields: ['status', 'isLocked', 'version'] },
  Section:                { direction: 'downstream', owner: 'cloud', priority: 211, batchSize: 50, businessKey: ['locationId', 'name'] },
  OrderType:              { direction: 'downstream', owner: 'cloud', priority: 212, batchSize: 50 },
  Printer:                { direction: 'downstream', owner: 'cloud', priority: 213, batchSize: 50, skipFields: ['lastPingAt', 'lastPingOk'] },
  PrintRoute:             { direction: 'downstream', owner: 'cloud', priority: 214, batchSize: 50 },
  PrintRule:              { direction: 'downstream', owner: 'cloud', priority: 215, batchSize: 50 },
  KDSScreen:              { direction: 'downstream', owner: 'cloud', priority: 216, batchSize: 50, skipFields: ['isPaired', 'deviceToken', 'lastKnownIp', 'deviceInfo', 'lastSeenAt', 'isOnline'] },
  KDSScreenStation:       { direction: 'downstream', owner: 'cloud', priority: 217, batchSize: 50 },
  // CRITICAL: Terminal is bidirectional — any cloud/Vercel API route that mutates Terminal MUST set lastMutatedBy: 'cloud'.
  // Without it, downstream sync will never deliver the change to the NUC. See docs/features/offline-sync.md "Bidirectional Sync Protocol".
  Terminal:               { direction: 'bidirectional', owner: 'cloud', priority: 218, batchSize: 50, skipFields: ['isPaired', 'deviceToken', 'deviceFingerprint', 'deviceInfo', 'platform', 'appVersion', 'osVersion', 'pushToken', 'lastKnownIp', 'lastSeenAt', 'isOnline'] },
  PaymentReader:          { direction: 'downstream', owner: 'cloud', priority: 219, batchSize: 50, skipFields: ['isOnline', 'lastSeenAt', 'lastErrorAt', 'lastError', 'avgResponseTime', 'successRate', 'firmwareVersion', 'lastSequenceNo'] },
  Scale:                  { direction: 'downstream', owner: 'cloud', priority: 220, batchSize: 10, skipFields: ['isConnected', 'lastSeenAt', 'lastError'] },
  Station:                { direction: 'downstream', owner: 'cloud', priority: 221, batchSize: 50, skipFields: ['lastPingAt', 'lastPingOk'] },
  KDSScreenLink:          { direction: 'downstream', owner: 'cloud', priority: 222, batchSize: 50 },
  PricingOptionGroup:     { direction: 'downstream', owner: 'cloud', priority: 223, batchSize: 100 },
  PricingOption:          { direction: 'downstream', owner: 'cloud', priority: 224, batchSize: 100 },
  CourseConfig:           { direction: 'downstream', owner: 'cloud', priority: 225, batchSize: 50 },
  Customer:               { direction: 'bidirectional', owner: 'both', priority: 226, batchSize: 100, businessKey: ['locationId', 'phone'] },
  Coupon:                 { direction: 'downstream', owner: 'cloud', priority: 227, batchSize: 50 },
  DiscountRule:           { direction: 'downstream', owner: 'cloud', priority: 228, batchSize: 50 },
  GiftCard:               { direction: 'bidirectional', owner: 'both', priority: 229, batchSize: 100 },
  HouseAccount:           { direction: 'bidirectional', owner: 'both', priority: 230, batchSize: 50 },
  Vendor:                 { direction: 'downstream', owner: 'cloud', priority: 231, batchSize: 50 },
  InventoryItem:          { direction: 'downstream', owner: 'cloud', priority: 232, batchSize: 100 },
  InventoryItemStorage:   { direction: 'downstream', owner: 'cloud', priority: 233, batchSize: 100 },
  Ingredient:             { direction: 'downstream', owner: 'cloud', priority: 234, batchSize: 100, skipFields: ['is86d', 'last86dAt', 'last86dBy', 'currentPrepStock', 'lastCountedAt', 'needsVerification', 'verifiedAt', 'verifiedBy'] },
  IngredientCategory:     { direction: 'downstream', owner: 'cloud', priority: 235, batchSize: 50 },
  MenuItemRecipe:         { direction: 'bidirectional', owner: 'both', priority: 236, batchSize: 100 },
  ComboTemplate:          { direction: 'downstream', owner: 'cloud', priority: 237, batchSize: 50 },
  ComboComponent:         { direction: 'downstream', owner: 'cloud', priority: 238, batchSize: 50 },
  ComboComponentOption:   { direction: 'downstream', owner: 'cloud', priority: 239, batchSize: 50 },
  ModifierGroupTemplate:  { direction: 'downstream', owner: 'cloud', priority: 240, batchSize: 50 },
  ModifierTemplate:       { direction: 'downstream', owner: 'cloud', priority: 241, batchSize: 50 },
  ModifierInventoryLink:  { direction: 'downstream', owner: 'cloud', priority: 242, batchSize: 50 },
  PrepStation:            { direction: 'downstream', owner: 'cloud', priority: 243, batchSize: 50 },
  PrepTrayConfig:         { direction: 'downstream', owner: 'cloud', priority: 244, batchSize: 50 },
  TaxRule:                { direction: 'downstream', owner: 'cloud', priority: 245, batchSize: 50 },
  SectionAssignment:      { direction: 'downstream', owner: 'cloud', priority: 246, batchSize: 50 },
  BergDevice:             { direction: 'downstream', owner: 'cloud', priority: 247, batchSize: 50 },
  BergPluMapping:         { direction: 'downstream', owner: 'cloud', priority: 248, batchSize: 100 },
  BottleProduct:          { direction: 'bidirectional', owner: 'both', priority: 33, batchSize: 100 },
  Invoice:                { direction: 'downstream', owner: 'cloud', priority: 250, batchSize: 100 },
  InvoiceLineItem:        { direction: 'downstream', owner: 'cloud', priority: 251, batchSize: 100 },
  Schedule:               { direction: 'downstream', owner: 'cloud', priority: 252, batchSize: 50 },
  ScheduledShift:         { direction: 'downstream', owner: 'cloud', priority: 253, batchSize: 100 },
  Event:                  { direction: 'downstream', owner: 'cloud', priority: 254, batchSize: 100 },
  EventPricingTier:       { direction: 'downstream', owner: 'cloud', priority: 255, batchSize: 50 },
  EventTableConfig:       { direction: 'downstream', owner: 'cloud', priority: 256, batchSize: 50 },
  Reservation:            { direction: 'bidirectional', owner: 'both', priority: 261, batchSize: 100 },
  ItemBarcode:            { direction: 'downstream', owner: 'cloud', priority: 262, batchSize: 100 },
  VoidReason:             { direction: 'downstream', owner: 'cloud', priority: 263, batchSize: 50 },
  CompReason:             { direction: 'downstream', owner: 'cloud', priority: 264, batchSize: 50 },
  FloorPlanElement:       { direction: 'downstream', owner: 'cloud', priority: 265, batchSize: 100 },
  EntertainmentWaitlist:  { direction: 'bidirectional', owner: 'both', priority: 266, batchSize: 100 },
  StorageLocation:        { direction: 'downstream', owner: 'cloud', priority: 267, batchSize: 50 },
  PrepItem:               { direction: 'downstream', owner: 'cloud', priority: 268, batchSize: 100 },
  PrepItemIngredient:     { direction: 'downstream', owner: 'cloud', priority: 269, batchSize: 100 },
  PricingOptionInventoryLink: { direction: 'downstream', owner: 'cloud', priority: 270, batchSize: 100 },
  SpiritCategory:         { direction: 'bidirectional', owner: 'both', priority: 34, batchSize: 50 },
  SpiritModifierGroup:    { direction: 'bidirectional', owner: 'both', priority: 37, batchSize: 50 },
  InventorySettings:      { direction: 'downstream', owner: 'cloud', priority: 273, batchSize: 10 },
  CfdSettings:            { direction: 'downstream', owner: 'cloud', priority: 274, batchSize: 10 },

  // ── Liquor Builder + Spirit Upgrades (NUC → Neon) ────────────────────
  // SpiritCategory, BottleProduct, SpiritModifierGroup moved to bidirectional above
  SpiritUpsellEvent:      { direction: 'upstream', owner: 'nuc', priority: 140, batchSize: 100 },

  // ── Pizza Builder (Cloud ↔ NUC — bidirectional for cloud settings page) ──
  // IMPORTANT: Cloud routes mutating pizza models MUST set lastMutatedBy: 'cloud'
  // See docs/features/offline-sync.md § Bidirectional Sync Protocol
  PizzaConfig:            { direction: 'bidirectional', owner: 'cloud', priority: 141, batchSize: 10 },
  PizzaSize:              { direction: 'bidirectional', owner: 'cloud', priority: 142, batchSize: 50 },
  PizzaCrust:             { direction: 'bidirectional', owner: 'cloud', priority: 143, batchSize: 50 },
  PizzaSauce:             { direction: 'bidirectional', owner: 'cloud', priority: 144, batchSize: 50 },
  PizzaCheese:            { direction: 'bidirectional', owner: 'cloud', priority: 145, batchSize: 50 },
  PizzaTopping:           { direction: 'bidirectional', owner: 'cloud', priority: 146, batchSize: 100 },
  PizzaSpecialty:         { direction: 'bidirectional', owner: 'cloud', priority: 147, batchSize: 50 },

  // ── Tips + Payroll (NUC → Neon) ─────────────────────────────────────
  PaidInOut:              { direction: 'upstream', owner: 'nuc', priority: 81, batchSize: 100 },
  TipGroupTemplate:       { direction: 'bidirectional', owner: 'both', priority: 82, batchSize: 50 },
  TipGroup:               { direction: 'upstream', owner: 'nuc', priority: 83, batchSize: 50 },
  TipGroupMembership:     { direction: 'upstream', owner: 'nuc', priority: 84, batchSize: 100 },
  TipGroupSegment:        { direction: 'upstream', owner: 'nuc', priority: 85, batchSize: 100 },
  TipAdjustment:          { direction: 'upstream', owner: 'nuc', priority: 86, batchSize: 100 },
  PayrollPeriod:          { direction: 'bidirectional', owner: 'both', priority: 87, batchSize: 50 },
  PayStub:                { direction: 'bidirectional', owner: 'both', priority: 88, batchSize: 100 },
  PayrollSettings:        { direction: 'upstream', owner: 'nuc', priority: 89, batchSize: 10 },

  // ── Inventory + Recipes (NUC → Neon) ────────────────────────────────
  InventoryTransaction:   { direction: 'upstream', owner: 'nuc', priority: 90, batchSize: 100 },
  StockAlert:             { direction: 'upstream', owner: 'nuc', priority: 91, batchSize: 100 },
  InventoryCount:         { direction: 'bidirectional', owner: 'both', priority: 92, batchSize: 50 },
  InventoryCountItem:     { direction: 'bidirectional', owner: 'both', priority: 93, batchSize: 100 },
  InventoryCountEntry:    { direction: 'bidirectional', owner: 'both', priority: 94, batchSize: 100 },
  WasteLog:               { direction: 'bidirectional', owner: 'both', priority: 95, batchSize: 50 },
  WasteLogEntry:          { direction: 'bidirectional', owner: 'both', priority: 96, batchSize: 100 },
  RecipeIngredient:       { direction: 'bidirectional', owner: 'both', priority: 97, batchSize: 100 },
  MenuItemRecipeIngredient: { direction: 'bidirectional', owner: 'both', priority: 98, batchSize: 100 },
  MenuItemIngredient:     { direction: 'bidirectional', owner: 'both', priority: 99, batchSize: 100 },
  IngredientSwapGroup:    { direction: 'bidirectional', owner: 'both', priority: 100, batchSize: 50 },
  IngredientStockAdjustment: { direction: 'bidirectional', owner: 'both', priority: 101, batchSize: 100 },
  IngredientRecipe:       { direction: 'bidirectional', owner: 'both', priority: 102, batchSize: 100 },
  IngredientCostHistory:  { direction: 'bidirectional', owner: 'both', priority: 103, batchSize: 100 },
  VendorOrder:            { direction: 'bidirectional', owner: 'both', priority: 104, batchSize: 50 },
  VendorOrderLineItem:    { direction: 'bidirectional', owner: 'both', priority: 105, batchSize: 100 },
  MarginEdgeProductMapping: { direction: 'bidirectional', owner: 'both', priority: 106, batchSize: 50 },
  PendingDeduction:       { direction: 'upstream', owner: 'nuc', priority: 107, batchSize: 100 },
  DeductionRun:           { direction: 'upstream', owner: 'nuc', priority: 108, batchSize: 50 },

  // ── Orders + Events (NUC → Neon) ────────────────────────────────────
  OrderEvent:             { direction: 'upstream', owner: 'nuc', priority: 109, batchSize: 100 },
  OrderSnapshot:          { direction: 'upstream', owner: 'nuc', priority: 110, batchSize: 50 },
  OrderItemSnapshot:      { direction: 'upstream', owner: 'nuc', priority: 111, batchSize: 100 },

  // ── Seating + Timed Sessions (NUC → Neon) ───────────────────────────
  Seat:                   { direction: 'bidirectional', owner: 'both', priority: 112, batchSize: 100 },
  TimedSession:           { direction: 'upstream', owner: 'nuc', priority: 113, batchSize: 50 },

  // ── Payments + Cards (NUC → Neon) ───────────────────────────────────
  CardProfile:            { direction: 'upstream', owner: 'nuc', priority: 114, batchSize: 100 },
  WalkoutRetry:           { direction: 'upstream', owner: 'nuc', priority: 115, batchSize: 50 },
  PaymentReaderLog:       { direction: 'upstream', owner: 'nuc', priority: 116, batchSize: 100 },
  ChargebackCase:         { direction: 'bidirectional', owner: 'both', priority: 117, batchSize: 50 },
  PmsChargeAttempt:       { direction: 'upstream', owner: 'nuc', priority: 118, batchSize: 50 },

  // ── Scheduling + Shifts (NUC → Neon) ────────────────────────────────
  ShiftSwapRequest:       { direction: 'bidirectional', owner: 'both', priority: 119, batchSize: 50 },
  DailyPrepCount:         { direction: 'bidirectional', owner: 'both', priority: 120, batchSize: 50 },
  DailyPrepCountItem:     { direction: 'bidirectional', owner: 'both', priority: 121, batchSize: 100 },

  // ── Bottle Service + Online Ordering (NUC → Neon) ───────────────────
  BottleServiceTier:      { direction: 'bidirectional', owner: 'both', priority: 122, batchSize: 50 },

  // ── Reservations (NUC → Neon) ─────────────────────────────────────
  ReservationBlock:       { direction: 'bidirectional', owner: 'both', priority: 257, batchSize: 100 },
  ReservationDeposit:     { direction: 'bidirectional', owner: 'both', priority: 258, batchSize: 100 },
  ReservationEvent:       { direction: 'bidirectional', owner: 'both', priority: 259, batchSize: 100 },
  ReservationTable:       { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 },

  // ── Loyalty (MC creates programs/tiers, NUC earns/redeems transactions) ──
  LoyaltyProgram:         { direction: 'bidirectional', owner: 'both', priority: 278, batchSize: 50 },
  LoyaltyTier:            { direction: 'bidirectional', owner: 'both', priority: 279, batchSize: 50 },
  LoyaltyTransaction:     { direction: 'upstream', owner: 'nuc', priority: 280, batchSize: 100 },

  // ── Misc Config (downstream — cloud-owned) ─────────────────────────
  ReasonAccess:           { direction: 'downstream', owner: 'cloud', priority: 275, batchSize: 50 },
  QuickBarPreference:     { direction: 'downstream', owner: 'cloud', priority: 276, batchSize: 50 },
  QuickBarDefault:        { direction: 'downstream', owner: 'cloud', priority: 277, batchSize: 50 },

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
} as const

/**
 * Effective runtime registry — starts as a shallow copy of SYNC_MODELS.
 * validateSyncCoverage() may add local-only entries here.
 * All getter functions read from this, never from SYNC_MODELS.
 */
let effectiveSyncModels: Record<string, SyncModelConfig> = { ...SYNC_MODELS }

/** Return upstream models sorted by FK-dependency priority (lowest first).
 *  Includes bidirectional models (they sync upstream with lastMutatedBy filter). */
export function getUpstreamModels(): [string, SyncModelConfig][] {
  return Object.entries(effectiveSyncModels)
    .filter(([, c]) => c.direction === 'upstream' || c.direction === 'bidirectional')
    .sort(([, a], [, b]) => a.priority - b.priority)
}

/** Return downstream models sorted by FK-dependency priority (lowest first).
 *  Includes bidirectional models (they sync downstream with lastMutatedBy filter). */
export function getDownstreamModels(): [string, SyncModelConfig][] {
  return Object.entries(effectiveSyncModels)
    .filter(([, c]) => c.direction === 'downstream' || c.direction === 'bidirectional')
    .sort(([, a], [, b]) => a.priority - b.priority)
}

/** Return only bidirectional model names */
export function getBidirectionalModelNames(): Set<string> {
  return new Set(
    Object.entries(effectiveSyncModels)
      .filter(([, c]) => c.direction === 'bidirectional')
      .map(([name]) => name)
  )
}

/** Get the conflict resolution strategy for a model (default: 'neon-wins') */
export function getConflictStrategy(model: string): ConflictStrategy {
  return effectiveSyncModels[model]?.conflictStrategy ?? 'neon-wins'
}

/** Get the business key columns for a cloud-owned downstream model, if declared */
export function getBusinessKey(model: string): string[] | undefined {
  return effectiveSyncModels[model]?.businessKey
}

/** Get the skip fields for a downstream model (fields not overwritten on upsert) */
export function getSkipFields(model: string): Set<string> | undefined {
  const fields = effectiveSyncModels[model]?.skipFields
  return fields && fields.length > 0 ? new Set(fields) : undefined
}

export const UPSTREAM_INTERVAL_MS = parseInt(
  process.env.SYNC_UPSTREAM_INTERVAL_MS || '5000',
  10
)

export const DOWNSTREAM_INTERVAL_MS = parseInt(
  process.env.SYNC_DOWNSTREAM_INTERVAL_MS || '5000',
  10
)

/**
 * SYNC COVERAGE VALIDATOR (Fail-Closed)
 *
 * Called at server startup (blocking). Queries the database for all tables
 * and verifies every one is in SYNC_MODELS. Unknown tables are auto-registered
 * as local-only (direction: 'none') with a warning — they never crash the NUC.
 *
 * Also validates:
 *   - LOCAL_ONLY_TABLES/SYSTEM_TABLES entries exist in actual DB (catch stale names)
 *   - Priority uniqueness for active models (direction !== 'none', priority > 0)
 */

/** Tables that must NEVER sync — operational/ephemeral NUC-local data */
export const LOCAL_ONLY_TABLES = new Set([
  'HardwareCommand', 'CloudEventQueue', 'SyncAuditEntry', 'HealthCheck',
  'FulfillmentEvent', 'BridgeCheckpoint', 'OutageQueueEntry', 'SocketEventLog',
  'RegisteredDevice', 'MobileSession', 'ServerRegistrationToken',
  'SyncConflict', 'SyncWatermark', // quarantine infrastructure
  'LocalSchemaState', 'LocalInstallState', // NUC-owned infrastructure (never synced)
  // Reservation ephemeral tokens + junction table (composite PK, no id column)
  'ReservationIdempotencyKey', 'ReservationDepositToken', 'ReservationTable',
  // Delivery infrastructure
  'DeliveryZone', 'DeliveryDriver', 'DeliveryDriverDocument', 'DeliveryDriverSession',
  'DeliveryRun', 'DeliveryAddress', 'DeliveryProofOfDelivery', 'DeliveryTracking',
  'DeliveryAuditLog', 'DeliveryException', 'DeliveryNotification', 'DeliveryOrder',
  'DeliveryNotificationAttempt',
  // Cake/portal
  'CakeCalendarBlock', 'CustomerPortalSession',
  // Membership
  'MembershipPlan', 'Membership', 'MembershipCharge', 'MembershipEvent',
  // Marketing + upsell
  'MarketingCampaign', 'MarketingRecipient', 'UpsellRule', 'UpsellEvent',
  // Misc operational
  'CoverCharge', 'WaitlistEntry', 'MenuSnapshot', 'CustomerFeedback', 'PourLog',
  'SavedCard', 'CateringOrder', 'CateringOrderItem', 'ServerRotationState',
  'ThirdPartyOrder', 'SharedReport', 'PaymentLink', 'CellularDevice',
  // Lowercase Prisma mapped tables
  'cloud_event_queue', 'order_events', 'order_snapshots', 'order_item_snapshots',
  // NUC infrastructure (no cloud representation)
  'GwiMigrations', 'GwiSyncState',
])

/** System/internal tables that are not Prisma models */
export const SYSTEM_TABLES = new Set([
  '_prisma_migrations', '_gwi_migrations', '_gwi_sync_state',
  '_pending_datacap_sales', '_pending_captures',
])

export async function validateSyncCoverage(
  db: { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> },
): Promise<void> {

  const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
     AND table_type = 'BASE TABLE'
     AND table_name NOT LIKE '\\_%'`
  )

  const actualTableNames = new Set(tables.map(t => t.table_name))
  // Reset effective registry from the immutable canonical source each validation run
  effectiveSyncModels = { ...SYNC_MODELS }

  const configuredModels = new Set(Object.keys(effectiveSyncModels))
  const errors: string[] = []

  // ── 1. Check for unknown tables ─────────────────────────────────────
  for (const { table_name } of tables) {
    if (SYSTEM_TABLES.has(table_name)) continue
    if (configuredModels.has(table_name)) continue

    if (LOCAL_ONLY_TABLES.has(table_name)) {
      // Known local-only — register in effectiveSyncModels (never mutate SYNC_MODELS)
      effectiveSyncModels[table_name] = { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 }
    } else {
      // Auto-register unknown tables as local-only — never crash a running NUC
      effectiveSyncModels[table_name] = { direction: 'none', owner: 'nuc', priority: 0, batchSize: 0 }
      log.warn({ table: table_name }, 'Auto-registered unknown table as local-only: %s — add it to SYNC_MODELS or LOCAL_ONLY_TABLES in sync-config.ts', table_name)
    }
  }

  // ── 2. Validate LOCAL_ONLY_TABLES entries exist ─────────────────────
  for (const name of LOCAL_ONLY_TABLES) {
    if (!actualTableNames.has(name) && !configuredModels.has(name)) {
      log.warn({ table: name }, 'Stale LOCAL_ONLY_TABLES entry — table does not exist in DB')
    }
  }

  // ── 3. Priority uniqueness for active models ───────────────────────
  const priorityMap = new Map<number, string[]>()
  for (const [model, cfg] of Object.entries(effectiveSyncModels)) {
    if (cfg.direction === 'none' || cfg.priority === 0) continue
    const existing = priorityMap.get(cfg.priority) || []
    existing.push(model)
    priorityMap.set(cfg.priority, existing)
  }

  const collisions = [...priorityMap.entries()]
    .filter(([, models]) => models.length > 1)
    .sort(([a], [b]) => a - b)

  if (collisions.length > 0) {
    const collisionDetails = collisions
      .map(([priority, models]) => `  priority ${priority}: ${models.join(', ')}`)
      .join('\n')

    errors.push(
      `Priority collisions detected (models sharing the same priority):\n${collisionDetails}\n` +
      `Fix by assigning unique priorities.`
    )
  }

  // ── 4. Report ──────────────────────────────────────────────────────
  if (errors.length > 0) {
    const errorMessage = `[SYNC CONFIG] FATAL — ${errors.length} validation error(s):\n\n${errors.join('\n\n')}`
    log.error(errorMessage)
    throw new Error(errorMessage)
  }

  const totalSynced = Object.values(effectiveSyncModels).filter(c => c.direction !== 'none').length
  log.info({ totalSynced, totalConfigured: Object.keys(effectiveSyncModels).length }, 'Sync coverage validated')
}
