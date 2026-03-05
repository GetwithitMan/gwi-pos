// src/lib/berg/report-types.ts
// Shared TypeScript response types for Berg report APIs.
// Both API routes and UI pages import from here to guarantee shape alignment.

// ============================================================
// Berg Variance Report — /api/reports/berg-variance
// ============================================================

export interface BergVarianceRow {
  pluNumber: number
  description: string
  menuItemId: string | null
  menuItemName: string | null
  mappingStatus: 'mapped' | 'unknown'
  isActive: boolean
  posRings: number
  bergPours: number
  posOz: number
  bergOz: number
  varCount: number
  varOz: number
  variancePct: number | null
  posRevenue: number
  alert: boolean
}

export interface BergVarianceSummary {
  totalPosRings: number
  totalBergPours: number
  totalPosOz: number
  totalBergOz: number
  itemsOverThreshold: number
  unknownPluCount: number
  dataQualityNote: string | null
}

export interface BergVarianceReportResponse {
  period: { startDate: string | null; endDate: string | null }
  generatedAt: string
  rows: BergVarianceRow[]
  summary: BergVarianceSummary
  alertCount: number
}

// ============================================================
// Berg Unmatched Report — /api/reports/berg-unmatched
// ============================================================

export interface BergUnmatchedEvent {
  id: string
  receivedAt: string
  device: { name: string } | null
  pluNumber: number
  pluMapping: { description: string } | null
  pourSizeOz: string | null
  pourCost: string | null
  status: string
  unmatchedType: string | null
}

export interface BergUnmatchedSummary {
  totalCost: number
  totalPours: number
  byType: Record<string, number>
}

export interface BergUnmatchedReportResponse {
  period: { startDate: string | null; endDate: string | null }
  generatedAt: string
  events: BergUnmatchedEvent[]
  summary: BergUnmatchedSummary
  totalExposure: number
  totalCount: number
  unmatchedTypeLabels: Record<string, string>
}

// ============================================================
// Berg Health Report — /api/reports/berg-health
// ============================================================

export interface BergDeviceStats {
  total: number
  ackCount: number
  nakCount: number
  badLrc: number
  badPacket: number
  overflow: number
  nakRate: number
  lrcErrorRate: number
  dedupedCount: number
  dedupRate: number
  avgAckLatencyMs: number | null
  maxAckLatencyMs: number | null
  p95LatencyMs: number | null
  exceededLatencyCount: number
}

export interface BergDeviceHealthEntry {
  id: string
  name: string
  model: string
  portName: string
  isActive: boolean
  lastSeenAt: string | null
  minutesSinceLastSeen: number | null
  lastError: string | null
  stats: BergDeviceStats
  alerts: string[]
}

export interface BergHealthReportResponse {
  period: { start: string | null; end: string | null }
  devices: BergDeviceHealthEntry[]
  overallAlerts: string[]
  timeSyncWarning: boolean
}

// ============================================================
// Berg Dispense Log — /api/reports/berg-dispense
// ============================================================

export interface BergDispenseEventRecord {
  id: string
  receivedAt: string
  device: { name: string; model: string } | null
  pluNumber: number
  pluMapping: { description: string } | null
  pourSizeOz: string | null
  pourCost: string | null
  status: string
  lrcValid: boolean
  ackLatencyMs: number | null
  orderId: string | null
  unmatchedType: string | null
  errorReason: string | null
  variantLabel: string | null
  resolutionStatus: string
}

export interface BergDispenseLogResponse {
  events: BergDispenseEventRecord[]
  total: number
  page: number
  limit: number
  pages: number
}

// ============================================================
// Berg Mapping Coverage — /api/reports/berg-mapping-coverage
// ============================================================

export interface BergMappingCoveragePlu {
  pluNumber: number
  description: string | null
  isMapped: boolean
  menuItemId: string | null
  pourCount: number
  totalOz: number
  estimatedExposure: number | null
}

export interface BergMappingCoverageSummary {
  totalPours: number
  unmappedPours: number
  unmappedExposure: number
}

export interface BergMappingCoverageResponse {
  period: { startDate: string | null; endDate: string | null }
  generatedAt: string
  coveragePct: number
  mappedCount: number
  unmappedCount: number
  totalActiveMappings: number
  plus: BergMappingCoveragePlu[]
  summary: BergMappingCoverageSummary
}
