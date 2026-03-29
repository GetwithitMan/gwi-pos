// Location Settings — Default Values and mergeWithDefaults()
// Split from src/lib/settings.ts for maintainability

import { DEFAULT_GLOBAL_RECEIPT_SETTINGS, mergeGlobalReceiptSettings } from '@/types/print'
import { createChildLogger } from '@/lib/logger'

import type {
  PricingProgram,
  BreakComplianceSettings,
  AutoGratuitySettings,
  MarginEdgeSettings,
  HotelPmsSettings,
  SevenShiftsSettings,
  EodSettings,
  SpeedOfServiceSettings,
  WalkoutSettings,
  AgeVerificationSettings,
  PayrollExportSettings,
  CateringSettings,
  CakeOrderingSettings,
  VenuePortalSettings,
  EntertainmentSettings,
  MembershipSettings,
  BarOperationsSettings,
  ReservationSettings,
  DepositRules,
  ReservationMessageTemplates,
  ReservationIntegration,
  ReservationPlatform,
  TextToPaySettings,
  HostViewSettings,
  DeliveryDispatchPolicy,
  DeliverySettings,
  DeliveryMarkupSettings,
  ThirdPartyDeliverySettings,
  MarketingSettings,
  UpsellPromptSettings,
  InvoicingCompanyInfo,
  InvoicingSettings,
  PrinterFailoverSettings,
  ReservationDepositSettings,
  CardOnFileSettings,
  WaitlistSettings,
  MenuRestorePointSettings,
  CashManagementSettings,
  LoginMessageSettings,
  TrainingSettings,
  EmployeeMealSettings,
  ServerBankingSettings,
  PreOrderSettings,
  CoverChargeSettings,
  HardwareLimitsSettings,
  QrOrderingSettings,
  KdsSettings,
  AccountingGLMapping,
  AccountingSettings,
  CustomerFeedbackSettings,
  PourControlSettings,
  ConvenienceFeeSettings,
  CfdDisplaySettings,
  PassiveCardDetectionSettings,
  LocationSettings,
  POSLayoutSettings,
  PricingRule,
} from './types'

// Lazy logger — avoids module-scope side effects that inflate middleware bundles
let _log: ReturnType<typeof createChildLogger> | null = null
function log(): ReturnType<typeof createChildLogger> {
  if (!_log) { _log = createChildLogger('settings') }
  return _log!
}

// ─── Default Constants ──────────────────────────────────────────────────────

export const DEFAULT_PRICING_PROGRAM: PricingProgram = {
  model: 'standard',
  enabled: false,
  creditMarkupPercent: 4,
  debitMarkupPercent: 0,
}

export const DEFAULT_CONVENIENCE_FEES: ConvenienceFeeSettings = {
  enabled: false,
  fees: { online: 0, phone: 0, delivery: 0, kiosk: 0, pos: 0 },
  showFeeAsLineItem: true,
  disclosureText: '',
  refundPolicy: 'full_refund',
}

export const DEFAULT_BREAK_COMPLIANCE: BreakComplianceSettings = {
  complianceMode: 'off',
  minShiftForBreak: 5,
  breakDurationMinutes: 30,
  overtimeThresholdHours: 8,
}

export const DEFAULT_AUTO_GRATUITY: AutoGratuitySettings = {
  enabled: false,
  minimumPartySize: 6,
  percent: 18,
  allowRemoval: true,
}

export const DEFAULT_MARGIN_EDGE_SETTINGS: MarginEdgeSettings = {
  enabled: false,
  apiKey: '',
  environment: 'production',
  syncOptions: {
    syncInvoices: true,
    syncProducts: true,
    autoUpdateCosts: true,
    costChangeAlertThreshold: 5,
  }
}

export const DEFAULT_HOTEL_PMS_SETTINGS: HotelPmsSettings = {
  enabled: false,
  baseUrl: '',
  clientId: '',
  clientSecret: '',
  appKey: '',
  hotelId: '',
  environment: 'cert',
  chargeCode: '',
  allowGuestLookup: true,
}

export const DEFAULT_SEVEN_SHIFTS_SETTINGS: SevenShiftsSettings = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  companyId: 0,
  companyGuid: '',
  locationId7s: 0,
  webhookSecret: '',
  environment: 'sandbox',
  syncOptions: {
    pushSales: true,
    pushTimePunches: true,
    pullSchedule: true,
  },
  lastSalesPushAt: null,
  lastSalesPushStatus: null,
  lastSalesPushError: null,
  lastPunchPushAt: null,
  lastPunchPushStatus: null,
  lastPunchPushError: null,
  lastSchedulePullAt: null,
  lastSchedulePullStatus: null,
  lastSchedulePullError: null,
  webhooksRegisteredAt: null,
}

export const DEFAULT_EOD_SETTINGS: EodSettings = {
  autoBatchClose: true,
  batchCloseTime: '04:00',
  autoCaptureTabs: false,
  autoGratuityPercent: 20,
}

export const DEFAULT_SPEED_OF_SERVICE: SpeedOfServiceSettings = {
  goalMinutes: 15,
  warningMinutes: 20,
  alertEnabled: false,
}

export const DEFAULT_WALKOUT_SETTINGS: WalkoutSettings = {
  autoDetectMinutes: 120,
  autoDetectEnabled: true,
  maxCaptureRetries: 10,
}

export const DEFAULT_AGE_VERIFICATION: AgeVerificationSettings = {
  enabled: true,
  minimumAge: 21,
  verifyOnce: true,
}

export const DEFAULT_PAYROLL_EXPORT: PayrollExportSettings = {
  enabled: false,
  provider: 'none',
  includeTimeClock: true,
  includeTips: true,
  includeBreaks: true,
  exportFormat: 'csv',
  payPeriod: 'biweekly',
}

export const DEFAULT_CATERING: CateringSettings = {
  enabled: false,
  minAdvanceDays: 3,
  minOrderAmount: 100.00,
  requireDeposit: true,
  depositPercent: 25,
  serviceFeePercent: 18,
  deliveryFee: 0,
  maxGuestCount: 500,
}

export const DEFAULT_CAKE_ORDERING: CakeOrderingSettings = {
  enabled: false,
  allowPublicOrdering: false,
  cakeCategoryIds: [],
  requireDeposit: true,
  depositPercent: 50,
  rushFeeAmount: 50,
  rushFeeDays: 3,
  hardMinimumLeadTimeHours: 24,
  minimumLeadTimeHours: 72,
  setupFeeAmount: 0,
  deliveryEnabled: false,
  deliveryFixedFee: 0,
  deliveryFeePerMile: 0,
  deliveryMaxMiles: 25,
  deliveryFeeTaxable: false,
  maxCapacityPerDay: 10,
  forfeitDaysBefore: 7,
  depositForfeitPercent: 100,
  lateCancelPolicyText: 'Deposits are non-refundable for cancellations within 7 days of event date.',
  quoteExpiryDays: 14,
  externalPaymentManagerThreshold: 500,
  messageChargeAmount: 0,
  wallDisplayToken: null,
}

export const DEFAULT_VENUE_PORTAL: VenuePortalSettings = {
  enabled: false,
  slug: '',
  brandColor: '#3B82F6',
  rewardsPageEnabled: false,
  orderHistoryEnabled: false,
  cakeOrderingOnPortal: false,
  siteEnabled: false,
  themePreset: 'modern' as const,
  showHero: true,
  showAbout: true,
  showHours: true,
  showFeaturedItems: true,
  showReservations: false,
  showContact: true,
  showRewardsOnSite: false,
  showGiftCards: false,
  aboutText: '',
  socialLinks: {},
  featuredItemSource: 'first_n' as const,
}

export const DEFAULT_ENTERTAINMENT_SETTINGS: EntertainmentSettings = {
  allowExtendWithWaitlist: true,
  overtimeGracePeriodMinutes: 2,
  overtimeRatePerMinute: 0.50,
  finishGameExtensionMinutes: 5,
  finishGameExtensionPrice: 3.00,
}

export const DEFAULT_MEMBERSHIP_SETTINGS: MembershipSettings = {
  enabled: false,
  retryScheduleDays: [0, 3, 7],
  gracePeriodDays: 14,
  sendDeclineEmails: true,
  sendUpcomingChargeEmails: true,
  sendRetryScheduledEmails: true,
  sendAdminDeclineAlerts: true,
}

export const DEFAULT_BAR_OPERATIONS: BarOperationsSettings = {
  quickPreModifiers: ['No', 'Lite', 'Extra', 'On Side', 'Neat', 'Rocks', 'Up', 'Dirty', 'Dry', 'Wet', 'Twist', 'Splash', 'Muddle', 'Float'],
  quickPreModifiersEnabled: true,
  repeatLastOrderEnabled: true,
  lastCallEnabled: true,
  lastCallAutoGratuityPercent: 20,
}

export const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  defaultTurnTimeMinutes: 90,
  slotIntervalMinutes: 15,
  maxPartySize: 20,
  maxFutureBookingDays: 60,
  noShowGraceMinutes: 15,
  noShowBlacklistAfterCount: 3,
  modificationCutoffHours: 2,
  cancellationCutoffHours: 2,
  serviceEndHour: 4,
  allowOnlineBooking: false,
  autoConfirmNoDeposit: true,
}

export const DEFAULT_DEPOSIT_RULES: DepositRules = {
  enabled: false,
  requirementMode: 'disabled',
  defaultAmountCents: 2500,
  partySizeThreshold: 0,
  perGuestAmountCents: 0,
  depositMode: 'flat',
  percentageOfEstimated: 0,
  refundableBefore: 'cutoff',
  refundCutoffHours: 24,
  nonRefundablePercent: 0,
  forceForOnline: false,
  forceForLargeParty: false,
  largePartyThreshold: 8,
  paymentMethods: ['card', 'text_to_pay'],
  expirationMinutes: 60,
}

export const DEFAULT_TEXT_TO_PAY: TextToPaySettings = {
  enabled: false,
  defaultExpirationMinutes: 60,
  allowTipOnLink: true,
  requireCustomerPhone: false,
  smsTemplate: 'Pay your bill at {venue}: {link}',
}

export const DEFAULT_HOST_VIEW: HostViewSettings = {
  enabled: false,
  showWaitTimes: true,
  showServerLoad: true,
  autoRotateServers: true,
  sectionBased: true,
  quotedWaitMultiplier: 1.2,
}

export const DEFAULT_DISPATCH_POLICY: DeliveryDispatchPolicy = {
  assignmentStrategy: 'manual',
  driverAcceptanceRequired: false,
  cashOnDeliveryAllowed: true,
  requirePrepaymentAboveAmount: 0,
  maxLateThresholdMinutes: 15,
  maxCashBeforeForcedDrop: 100,
  maxOrdersPerDriverByTimeOfDay: { peak: 3, offPeak: 5 },
  blockDispatchWithoutValidZone: true,
  voidAfterDispatchRequiresManager: true,
  cashShortageApprovalRequired: true,
  proofRequiredForFlaggedCustomers: true,
  proofRequiredForCashOrders: false,
  proofRequiredAboveAmount: 0,
  proofRequiredForAlcohol: false,
  proofRequiredForApartments: false,
  driverCannotEndShiftWithOpenRun: true,
  cannotDispatchSuspendedWithoutOverride: true,
  cannotMarkDeliveredWithoutRequiredProof: true,
  holdReadyUntilAllItemsComplete: true,
}

export const DEFAULT_DELIVERY: DeliverySettings = {
  enabled: false,
  deliveryFee: 5.00,
  freeDeliveryMinimum: 0,
  maxDeliveryRadius: 10,
  estimatedDeliveryMinutes: 45,
  requirePhone: true,
  requireAddress: true,
  maxActiveDeliveries: 20,
  feeMode: 'flat',
  locationCoordinates: null,
  dispatchPolicy: DEFAULT_DISPATCH_POLICY,
  multiRunEnabled: false,
  maxOrdersPerRun: 4,
  mileageTrackingMode: 'none',
  mileageReimbursementRate: 0.70,
  driverPayMode: 'hourly',
  perDeliveryPayAmount: 3.00,
  cashDropThreshold: 100,
  requireStartingBank: false,
  defaultStartingBank: 50,
  requireCashReconciliation: true,
  smsNotificationsEnabled: false,
  smsTemplates: {
    orderConfirmed: 'Your order #{orderNumber} from {venue} is being prepared! Estimated delivery: {eta} minutes.',
    outForDelivery: 'Your order from {venue} is on the way! Track: {trackingUrl}',
    delivered: 'Your order from {venue} has been delivered. Thank you!',
  },
  smsMaxRetries: 2,
  smsRetryAfterSeconds: 30,
  customerTrackingEnabled: false,
  shareDriverInfo: false,
  hideDriverLocationUntilNearby: false,
  nearbyThresholdMeters: 500,
  proofOfDeliveryMode: 'none',
  deferredOrdersEnabled: false,
  maxDeferredDaysAhead: 7,
  driverScreenEnabled: false,
  driverSelfAssignEnabled: false,
  deliveryPrintOnAssign: false,
  deliveryPrinterId: null,
  driverTipMode: 'driver_keeps_100',
  driverTipSplitPercent: 80,
  kitchenTipSplitPercent: 20,
  deliveryAutoGratuityEnabled: false,
  deliveryAutoGratuityPercent: 0,
  peakHours: [],
  dispatchProvider: 'in_house',
}

export const DEFAULT_DELIVERY_MARKUP: DeliveryMarkupSettings = {
  enabled: false,
  defaultPercent: 0,
  roundingRule: 'none',
  applyToModifiers: true,
  platformOverrides: {},
}

export const DEFAULT_THIRD_PARTY_DELIVERY: ThirdPartyDeliverySettings = {
  doordash: {
    enabled: false,
    storeId: '',
    webhookSecret: '',
    autoAccept: false,
    prepTimeMinutes: 20,
  },
  ubereats: {
    enabled: false,
    storeId: '',
    clientId: '',
    webhookSecret: '',
    autoAccept: false,
    prepTimeMinutes: 20,
  },
  grubhub: {
    enabled: false,
    storeId: '',
    webhookSecret: '',
    autoAccept: false,
    prepTimeMinutes: 20,
  },
  autoPrintTicket: true,
  alertOnNewOrder: true,
  defaultTaxRate: 0,
}

export const DEFAULT_MARKETING: MarketingSettings = {
  enabled: false,
  smsEnabled: false,
  emailEnabled: true,
  senderName: '',
  unsubscribeUrl: '',
  maxSmsPerDay: 500,
  maxEmailsPerDay: 2000,
  defaultSegments: ['all', 'vip', 'new', 'inactive', 'birthday'],
}

export const DEFAULT_UPSELL_PROMPTS: UpsellPromptSettings = {
  enabled: false,
  maxPromptsPerOrder: 3,
  showOnItemAdd: true,
  showBeforeSend: false,
  dismissCooldownMinutes: 0,
}

export const DEFAULT_INVOICING_COMPANY_INFO: InvoicingCompanyInfo = {
  name: '',
  address: '',
  phone: '',
  email: '',
  taxId: '',
}

export const DEFAULT_INVOICING: InvoicingSettings = {
  enabled: false,
  defaultPaymentTermsDays: 30,
  defaultTaxRate: 0,
  autoNumberPrefix: 'INV',
  nextInvoiceNumber: 1001,
  companyInfo: { ...DEFAULT_INVOICING_COMPANY_INFO },
  lateFeePercent: 0,
  reminderDays: [7, 3, 1],
}

export const DEFAULT_PRINTER_FAILOVER: PrinterFailoverSettings = {
  enabled: true,
  maxRetries: 3,
  alertOnFailure: true,
  showStatusIndicator: true,
}

export const DEFAULT_RESERVATION_DEPOSIT: ReservationDepositSettings = {
  enabled: false,
  defaultAmount: 50.00,
  refundableBeforeHours: 24,
  requireForPartySize: 6,
  nonRefundablePercent: 0,
}

export const DEFAULT_CARD_ON_FILE: CardOnFileSettings = {
  enabled: false,
  allowSaveCard: true,
  requireConsent: true,
  maxCardsPerCustomer: 5,
}

export const DEFAULT_WAITLIST_SETTINGS: WaitlistSettings = {
  enabled: false,
  maxPartySize: 20,
  estimateMinutesPerTurn: 45,
  smsNotifications: true,
  maxWaitlistSize: 50,
  autoRemoveAfterMinutes: 15,
  depositEnabled: false,
  depositAmount: 25,
  allowCashDeposit: true,
  applyDepositToOrder: true,
  forfeitOnNoShow: true,
}

export const DEFAULT_CFD_DISPLAY: CfdDisplaySettings = {
  displayMode: 'full',
  showModifiers: true,
  showModifierPrices: true,
  showDualPricing: true,
  totalOnlyDelaySeconds: 0,
  showTotalOnPaymentMethod: true,
  showUpsellSuggestions: true,
  upsellMessage: 'While you wait...',
  idleScreenMessage: 'Welcome!',
  idleScreenImageUrl: '',
}

export const DEFAULT_PASSIVE_CARD_DETECTION: PassiveCardDetectionSettings = {
  enabled: false,
  mode: 'manual_only',
  autoLoadExistingTabOnIdle: false,
  allowSaveCardWithoutPreauth: false,
  allowCardReuseAcrossOpenOrders: false,
  duplicateReadSuppressionSeconds: 15,
  listenTimeoutSeconds: 300,
  readerErrorBackoffSeconds: 30,
}

export const DEFAULT_MENU_RESTORE_POINT_SETTINGS: MenuRestorePointSettings = {
  enabled: true,
  maxSnapshots: 10,
  autoSnapshotOnBulkEdit: true,
}

export const DEFAULT_CASH_MANAGEMENT: CashManagementSettings = {
  varianceWarningThreshold: 5.00,
  varianceCriticalThreshold: 25.00,
  requireWitnessForDrops: false,
  requireReasonForNoSale: true,
  maxDropAmount: 500.00,
  paidOutApprovalThreshold: 100.00,
}

export const DEFAULT_LOGIN_MESSAGES: LoginMessageSettings = {
  enabled: false,
  messages: [],
}

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  enabled: false,
  trainingEmployeeIds: [],
  suppressInventory: true,
  suppressPayments: true,
  suppressPrinting: true,
}

export const DEFAULT_EMPLOYEE_MEAL_SETTINGS: EmployeeMealSettings = {
  enabled: false,
  maxMealValue: 15.00,
  mealAllowancePerShift: 1,
  trackForPayroll: false,
  requireManagerApproval: false,
}

export const DEFAULT_SERVER_BANKING: ServerBankingSettings = {
  enabled: false,
  defaultBankAmount: 100.00,
  requireExactBuyIn: false,
  trackOverShort: true,
}

export const DEFAULT_PRE_ORDER: PreOrderSettings = {
  enabled: false,
  maxAdvanceHours: 72,
  minAdvanceMinutes: 30,
  allowedOrderTypes: ['pickup', 'delivery'],
}

export const DEFAULT_COVER_CHARGE: CoverChargeSettings = {
  enabled: false,
  defaultAmount: 10.00,
  vipBypass: true,
  trackDoorCount: true,
  maxCapacity: 0,
}

export const DEFAULT_HARDWARE_LIMITS: HardwareLimitsSettings = {
  maxPOSTerminals: 20,
  maxHandhelds: 4,
  maxCellularDevices: 2,
  maxKDSScreens: 4,
  maxPrinters: 6,
  maxSingleTransactionAmount: 9999.99,
  maxCashPaymentAmount: 500,
  maxOpenTabAmount: 1000,
  maxDiscountDollarAmount: 0,
  handheldMaxPaymentAmount: 500,
  handheldAllowVoids: true,
  handheldAllowComps: true,
  handheldAllowDiscounts: true,
  handheldAllowRefunds: false,
  handheldAllowCashPayments: false,
  handheldAllowTabClose: true,
  cellularMaxOrderAmount: 200,
  cellularAllowVoids: false,
  cellularAllowComps: false,
  maxOrdersPerHour: 0,
  maxVoidsPerShift: 0,
  maxCompsPerShift: 0,
}

export const DEFAULT_QR_ORDERING: QrOrderingSettings = {
  enabled: false,
  requireTableAssignment: true,
  allowPayment: false,
  showPrices: true,
  maxItemsPerOrder: 50,
  menuCategoryFilter: [],
}

export const DEFAULT_KDS_SETTINGS: KdsSettings = {
  orderAgeWarningMinutes: 10,
  orderAgeCriticalMinutes: 20,
}

export const DEFAULT_GL_MAPPING: AccountingGLMapping = {
  salesRevenue: '4000',
  cashPayments: '1000',
  cardPayments: '1100',
  giftCardPayments: '1200',
  houseAccountPayments: '1300',
  taxCollected: '2100',
  tipsPayable: '2200',
  discounts: '4100',
  refunds: '4200',
  comps: '5000',
  cogs: '5100',
  laborCost: '6000',
}

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettings = {
  enabled: false,
  provider: 'none',
  autoExportDaily: false,
  exportTime: '04:00',
  glMapping: { ...DEFAULT_GL_MAPPING },
}

export const DEFAULT_CUSTOMER_FEEDBACK: CustomerFeedbackSettings = {
  enabled: false,
  promptAfterPayment: true,
  sendSmsRequest: false,
  sendEmailRequest: false,
  feedbackUrl: '',
  ratingScale: 5,
  requireComment: false,
}

export const DEFAULT_POUR_CONTROL: PourControlSettings = {
  enabled: false,
  provider: 'none',
  defaultPourOz: 1.5,
  overPourThresholdPercent: 15,
  trackWaste: true,
  alertOnOverPour: false,
}

// Default layout settings
export const DEFAULT_LAYOUT_SETTINGS: POSLayoutSettings = {
  currentMode: 'bar',
  defaultMode: 'bar',
  rememberLastMode: true,

  barFavorites: [],
  foodFavorites: [],
  maxFavorites: 8,

  quickBar: [],
  quickBarEnabled: true,
  maxQuickBarItems: 12,

  barCategoryOrder: [],
  foodCategoryOrder: [],

  barHiddenCategories: [],
  foodHiddenCategories: [],

  categoryColors: {},
  menuItemColors: {},

  showFavoritesBar: true,
  compactCategoryBar: true,
  autoCollapseCategories: true,

  quickPickEnabled: true,

  coursingCourseCount: 5,
  coursingDefaultDelay: 0,
}

// ─── Reservation Templates ──────────────────────────────────────────────────

// Professional template pack — formal tone
const PROFESSIONAL_TEMPLATES: ReservationMessageTemplates = {
  confirmation: {
    subject: 'Reservation Confirmed — {{venueName}}',
    smsBody: 'Your reservation at {{venueName}} is confirmed for {{date}} at {{time}}, party of {{partySize}}. Manage: {{manageLink}}',
    emailBody: '<p>Dear {{guestName}},</p><p>Your reservation has been confirmed.</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}<br/><strong>Table:</strong> {{tableName}}</p><p>{{specialRequests}}</p><p>To modify or cancel your reservation, please visit: <a href="{{manageLink}}">Manage Reservation</a></p><p>We look forward to welcoming you.<br/>{{venueName}}</p>',
  },
  reminder24h: {
    subject: 'Reminder: Your Reservation Tomorrow — {{venueName}}',
    smsBody: 'Reminder: You have a reservation at {{venueName}} tomorrow at {{time}}, party of {{partySize}}. Manage: {{manageLink}}',
    emailBody: '<p>Dear {{guestName}},</p><p>This is a friendly reminder of your reservation tomorrow.</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}</p><p>To modify or cancel, please visit: <a href="{{manageLink}}">Manage Reservation</a></p><p>We look forward to seeing you.<br/>{{venueName}}</p>',
  },
  reminder2h: {
    subject: 'Your Reservation is in 2 Hours — {{venueName}}',
    smsBody: '{{guestName}}, your table at {{venueName}} is ready in 2 hours ({{time}}). See you soon!',
    emailBody: '<p>Dear {{guestName}},</p><p>Your reservation at {{venueName}} is coming up in just 2 hours.</p><p><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}</p><p>We look forward to seeing you shortly.<br/>{{venueName}}</p>',
  },
  depositRequest: {
    subject: 'Deposit Required — {{venueName}} Reservation',
    smsBody: 'A deposit of {{depositAmount}} is required for your reservation at {{venueName}} on {{date}}. Pay here: {{depositLink}}',
    emailBody: '<p>Dear {{guestName}},</p><p>A deposit of <strong>{{depositAmount}}</strong> is required to confirm your reservation.</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}</p><p>Please complete your deposit by visiting: <a href="{{depositLink}}">Pay Deposit</a></p><p>This link expires in {{depositExpirationMinutes}} minutes.</p><p>Thank you,<br/>{{venueName}}</p>',
  },
  depositReceived: {
    subject: 'Deposit Received — {{venueName}}',
    smsBody: 'Your deposit of {{depositAmount}} for {{venueName}} on {{date}} has been received. Thank you!',
    emailBody: '<p>Dear {{guestName}},</p><p>We have received your deposit of <strong>{{depositAmount}}</strong> for your reservation.</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}</p><p>Your reservation is now fully confirmed.</p><p>Thank you,<br/>{{venueName}}</p>',
  },
  cancellation: {
    subject: 'Reservation Cancelled — {{venueName}}',
    smsBody: 'Your reservation at {{venueName}} on {{date}} at {{time}} has been cancelled. Questions? Call us at {{venuePhone}}.',
    emailBody: '<p>Dear {{guestName}},</p><p>Your reservation has been cancelled as requested.</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}</p><p>If you have any questions, please contact us at {{venuePhone}}.</p><p>We hope to see you again soon.<br/>{{venueName}}</p>',
  },
  modification: {
    subject: 'Reservation Updated — {{venueName}}',
    smsBody: 'Your reservation at {{venueName}} has been updated to {{date}} at {{time}}, party of {{partySize}}. Manage: {{manageLink}}',
    emailBody: '<p>Dear {{guestName}},</p><p>Your reservation has been updated with the following details:</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}<br/><strong>Table:</strong> {{tableName}}</p><p>To make further changes, visit: <a href="{{manageLink}}">Manage Reservation</a></p><p>Thank you,<br/>{{venueName}}</p>',
  },
  noShow: {
    subject: 'Missed Reservation — {{venueName}}',
    smsBody: 'We missed you at {{venueName}} today. We hope everything is okay. Book again: {{bookingLink}}',
    emailBody: '<p>Dear {{guestName}},</p><p>We noticed you were unable to make your reservation at {{venueName}} on {{date}} at {{time}}.</p><p>We hope everything is alright. If you would like to rebook, please visit: <a href="{{bookingLink}}">Book Again</a></p><p>We look forward to welcoming you next time.<br/>{{venueName}}</p>',
  },
  waitlistPromoted: {
    subject: 'A Table is Available — {{venueName}}',
    smsBody: 'Great news! A table is now available at {{venueName}} on {{date}} at {{time}}. Confirm here: {{manageLink}}',
    emailBody: '<p>Dear {{guestName}},</p><p>Great news — a table has become available for the date and time you requested.</p><p><strong>Date:</strong> {{date}}<br/><strong>Time:</strong> {{time}}<br/><strong>Party Size:</strong> {{partySize}}</p><p>Please confirm your reservation within {{holdMinutes}} minutes: <a href="{{manageLink}}">Confirm Reservation</a></p><p>Thank you,<br/>{{venueName}}</p>',
  },
  thankYou: {
    subject: 'Thank You for Dining with Us — {{venueName}}',
    smsBody: 'Thank you for dining at {{venueName}}! We hope you had a wonderful experience. See you again soon!',
    emailBody: '<p>Dear {{guestName}},</p><p>Thank you for dining with us at {{venueName}}. We hope you had a wonderful experience.</p><p>We would love to see you again. Book your next visit: <a href="{{bookingLink}}">Reserve a Table</a></p><p>Warm regards,<br/>{{venueName}}</p>',
  },
}

// Casual template pack — friendly tone
const CASUAL_TEMPLATES: ReservationMessageTemplates = {
  confirmation: {
    subject: "You're booked at {{venueName}}! \uD83C\uDF89",
    smsBody: "You're all set at {{venueName}}! {{date}} at {{time}}, party of {{partySize}}. Need to change anything? {{manageLink}}",
    emailBody: '<p>Hey {{guestName}}! \uD83D\uDC4B</p><p>Your table is booked and we can\'t wait to see you!</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong><br/>\uD83E\uDE91 <strong>{{tableName}}</strong></p><p>{{specialRequests}}</p><p>Need to make changes? <a href="{{manageLink}}">Tap here</a></p><p>See you soon!<br/>The team at {{venueName}}</p>',
  },
  reminder24h: {
    subject: "See you tomorrow at {{venueName}}! \uD83D\uDE4C",
    smsBody: "Hey {{guestName}}! Just a heads up \u2014 your table at {{venueName}} is ready for you tomorrow at {{time}}. Can't wait! {{manageLink}}",
    emailBody: '<p>Hey {{guestName}}!</p><p>Just a quick reminder \u2014 you\'ve got a table with us tomorrow!</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong></p><p>Need to change plans? No worries: <a href="{{manageLink}}">Manage your reservation</a></p><p>See you soon!<br/>{{venueName}}</p>',
  },
  reminder2h: {
    subject: "Almost time! See you at {{venueName}} in 2 hours \uD83C\uDF7D\uFE0F",
    smsBody: "{{guestName}}, your table at {{venueName}} is just 2 hours away ({{time}})! See you soon! \uD83C\uDF89",
    emailBody: '<p>Hey {{guestName}}!</p><p>Your table is almost ready \u2014 just 2 more hours!</p><p>\u23F0 <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong></p><p>We\'re excited to see you!<br/>{{venueName}}</p>',
  },
  depositRequest: {
    subject: "Quick deposit to lock in your table at {{venueName}} \uD83D\uDCB3",
    smsBody: "Hey! To lock in your table at {{venueName}} on {{date}}, we just need a {{depositAmount}} deposit. Easy-peasy: {{depositLink}}",
    emailBody: '<p>Hey {{guestName}}!</p><p>We just need a quick deposit of <strong>{{depositAmount}}</strong> to lock in your table.</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong></p><p><a href="{{depositLink}}">Pay Deposit</a> (link expires in {{depositExpirationMinutes}} min)</p><p>Thanks!<br/>{{venueName}}</p>',
  },
  depositReceived: {
    subject: "Deposit received! You're locked in at {{venueName}} \u2705",
    smsBody: "Got it! Your {{depositAmount}} deposit for {{venueName}} on {{date}} is confirmed. You're all set! \uD83C\uDF89",
    emailBody: '<p>Hey {{guestName}}!</p><p>We got your deposit of <strong>{{depositAmount}}</strong> \u2014 you\'re all locked in!</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong></p><p>Can\'t wait to see you!<br/>{{venueName}}</p>',
  },
  cancellation: {
    subject: "Reservation cancelled at {{venueName}} \uD83D\uDE22",
    smsBody: "Your reservation at {{venueName}} on {{date}} has been cancelled. We'll miss you! Book again anytime.",
    emailBody: '<p>Hey {{guestName}},</p><p>Your reservation has been cancelled. We\'re sad to miss you!</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong></p><p>Questions? Give us a ring at {{venuePhone}}.</p><p>Hope to see you again soon!<br/>{{venueName}}</p>',
  },
  modification: {
    subject: "Reservation updated at {{venueName}} \u270F\uFE0F",
    smsBody: "Your reservation at {{venueName}} is updated: {{date}} at {{time}}, party of {{partySize}}. {{manageLink}}",
    emailBody: '<p>Hey {{guestName}}!</p><p>Your reservation has been updated:</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong><br/>\uD83E\uDE91 <strong>{{tableName}}</strong></p><p>Need more changes? <a href="{{manageLink}}">Tap here</a></p><p>See you soon!<br/>{{venueName}}</p>',
  },
  noShow: {
    subject: "We missed you at {{venueName}}!",
    smsBody: "Hey {{guestName}}, we missed you at {{venueName}} today! Hope everything's OK. Book again: {{bookingLink}}",
    emailBody: '<p>Hey {{guestName}},</p><p>We missed you at your reservation today! We hope everything is OK.</p><p>Whenever you\'re ready, we\'d love to see you: <a href="{{bookingLink}}">Book Again</a></p><p>Take care!<br/>{{venueName}}</p>',
  },
  waitlistPromoted: {
    subject: "A table just opened up at {{venueName}}! \uD83C\uDF89",
    smsBody: "Hey {{guestName}}! A table just opened at {{venueName}} on {{date}} at {{time}}! Grab it: {{manageLink}}",
    emailBody: '<p>Hey {{guestName}}! \uD83C\uDF89</p><p>A table just became available!</p><p>\uD83D\uDCC5 <strong>{{date}}</strong> at <strong>{{time}}</strong><br/>\uD83D\uDC65 Party of <strong>{{partySize}}</strong></p><p>Grab it before it\'s gone (you have {{holdMinutes}} min): <a href="{{manageLink}}">Confirm Now</a></p><p>{{venueName}}</p>',
  },
  thankYou: {
    subject: "Thanks for coming to {{venueName}}! \uD83D\uDE4F",
    smsBody: "Thanks for dining with us at {{venueName}}! Hope you had an amazing time. Come back soon! \uD83C\uDF7D\uFE0F",
    emailBody: '<p>Hey {{guestName}}!</p><p>Thanks so much for joining us at {{venueName}}! We hope you loved it.</p><p>Ready for round two? <a href="{{bookingLink}}">Book your next visit</a></p><p>Cheers!<br/>The {{venueName}} crew</p>',
  },
}

export const DEFAULT_RESERVATION_TEMPLATES: ReservationMessageTemplates = PROFESSIONAL_TEMPLATES

export const TEMPLATE_PACKS: Record<string, ReservationMessageTemplates> = {
  professional: PROFESSIONAL_TEMPLATES,
  casual: CASUAL_TEMPLATES,
}

export const AVAILABLE_PLACEHOLDERS: { key: string; description: string }[] = [
  { key: '{{guestName}}', description: 'Guest full name' },
  { key: '{{date}}', description: 'Reservation date (formatted)' },
  { key: '{{time}}', description: 'Reservation time (formatted)' },
  { key: '{{partySize}}', description: 'Number of guests' },
  { key: '{{tableName}}', description: 'Assigned table name' },
  { key: '{{venueName}}', description: 'Restaurant / venue name' },
  { key: '{{venuePhone}}', description: 'Venue phone number' },
  { key: '{{venueAddress}}', description: 'Venue street address' },
  { key: '{{manageLink}}', description: 'Link to manage/modify reservation' },
  { key: '{{bookingLink}}', description: 'Link to public booking page' },
  { key: '{{depositLink}}', description: 'Link to pay deposit' },
  { key: '{{depositAmount}}', description: 'Deposit amount (formatted with $)' },
  { key: '{{depositExpirationMinutes}}', description: 'Minutes until deposit link expires' },
  { key: '{{holdMinutes}}', description: 'Minutes to confirm waitlist promotion' },
  { key: '{{specialRequests}}', description: 'Guest special requests (if any)' },
  { key: '{{occasion}}', description: 'Occasion (birthday, anniversary, etc.)' },
  { key: '{{confirmationCode}}', description: 'Short confirmation code' },
]

export const DEFAULT_RESERVATION_INTEGRATION: ReservationIntegration = {
  platform: 'custom',
  enabled: false,
  syncDirection: 'pull',
  autoConfirmIncoming: false,
  statusMappings: [],
  syncErrors: [],
}

/** Available reservation platforms for UI display */
export const RESERVATION_PLATFORMS: {
  platform: ReservationPlatform
  name: string
  color: string
  comingSoon?: boolean
}[] = [
  { platform: 'opentable', name: 'OpenTable', color: '#DA3743' },
  { platform: 'resy', name: 'Resy', color: '#2D6DF6' },
  { platform: 'google', name: 'Google Reserve', color: '#34A853' },
  { platform: 'yelp', name: 'Yelp Reservations', color: '#D32323' },
  { platform: 'custom', name: 'Custom API', color: '#6B7280' },
]

// ─── Default settings for new locations ──────────────────────────────────────

export const DEFAULT_SETTINGS: LocationSettings = {
  tax: {
    defaultRate: 8.0,
    calculateAfterDiscount: true,
    taxInclusiveLiquor: false,
    taxInclusiveFood: false,
  },
  dualPricing: {
    enabled: true,
    cashDiscountPercent: 4.0,       // 4% discount for cash payments
    applyToCredit: true,
    applyToDebit: true,
    showSavingsMessage: true,
  },
  priceRounding: {
    enabled: true,
    increment: '1.00',              // none, 0.05, 0.10, 0.25, 0.50, 1.00
    direction: 'nearest',           // nearest, up, down
    applyToCash: true,              // Apply to cash payments
    applyToCard: false,             // Apply to card payments
  },
  tips: {
    enabled: true,
    suggestedPercentages: [18, 20, 22, 25],
    calculateOn: 'subtotal',
  },
  tipShares: {
    payoutMethod: 'payroll',              // Default: tip shares go to payroll
    autoTipOutEnabled: true,              // Auto tip-out based on rules
    requireTipOutAcknowledgment: true,    // Server must acknowledge tip-out
    showTipSharesOnReceipt: true,         // Show on shift receipt
  },
  tipBank: {
    enabled: true,
    allocationMode: 'CHECK_BASED',
    chargebackPolicy: 'BUSINESS_ABSORBS',
    allowNegativeBalances: false,
    allowManagerInPools: false,
    poolCashTips: true,
    tipGuide: {
      basis: 'pre_discount',
      percentages: [15, 18, 20, 25],
      showBasisExplanation: true,
      roundTo: 'quarter',
    },
    deductCCFeeFromTips: false,       // Off by default — business absorbs CC fees on tips
    ccFeePercent: 3.0,                // Common processing fee (only applied if deductCCFeeFromTips=true)
    allowEODCashOut: true,            // Employees can cash out tips at shift close
    requireManagerApprovalForCashOut: false,  // No manager approval needed by default
    defaultPayoutMethod: 'cash',      // Default to cash payout (business doesn't want to hold tips)
    tipAttributionTiming: 'check_closed', // Credit the group active when payment processes (best for bars)
    lateTabTipHandling: 'pool_period',
    attributionModel: 'primary_100',
    tableTipOwnershipMode: 'ITEM_BASED',   // Default: helpers get per-item credit on server tables
    allowStandaloneServers: true,            // Allow "No Group" option at clock-in
    allowEmployeeCreatedGroups: true,        // Allow ad-hoc group creation (legacy behavior)
    noTipQuickButton: false,                 // Off by default to encourage tipping
    tipAttribution: 'tab_closer',            // Default: whoever processes the payment gets the tip
    tipGroupsEnabled: false,                 // Off by default — venues must opt in to tip pooling
    allowEmployeeGroupCreation: false,       // Off by default — only admin templates until enabled
    showTipIndicatorOnPOS: true,             // Show tip badge in POS header by default
    showCCFeeToEmployee: true,              // Show CC fee deduction in closeout by default
    entertainmentTipsEnabled: true,          // Employees earn tips on entertainment/timed rental items by default
  },
  receipts: {
    headerText: 'Thank you for your visit!',
    footerText: '',
    showServerName: true,
    showTableNumber: true,
  },
  payments: {
    acceptCash: true,
    acceptCredit: true,
    acceptDebit: true,
    acceptGiftCards: false,
    giftCardPoolMode: 'open' as const,
    giftCardLowPoolThreshold: 10,
    acceptHouseAccounts: false,
    acceptHotelRoomCharge: false,
    cashRounding: 'none' as const,   // DEPRECATED — use top-level priceRounding
    roundingDirection: 'nearest' as const, // DEPRECATED — use top-level priceRounding
    enablePreAuth: true,
    defaultPreAuthAmount: 100.00,
    preAuthExpirationDays: 7,
    processor: 'none',             // 'none' | 'datacap'
    testMode: true,
    readerTimeoutSeconds: 30,
    autoSwapOnFailure: true,
    // Bar Tab Pre-Auth
    incrementThresholdPercent: 80,
    incrementAmount: 25,
    autoIncrementEnabled: true,
    incrementTipBufferPercent: 25,
    maxTabAlertAmount: 500,
    // Quick Pay / Tips
    quickPayEnabled: true,
    tipDollarAmountThreshold: 15,
    tipDollarSuggestions: [1, 2, 3],
    tipPercentSuggestions: [18, 20, 25],
    requireCustomForZeroTip: true,
    // Walkout Recovery
    walkoutRetryEnabled: true,
    walkoutRetryFrequencyDays: 3,
    walkoutMaxRetryDays: 30,
    walkoutAutoDetectMinutes: 120,
    // Payment Terminal / Customer Split
    allowCustomerSplit: true,
    // Card Recognition
    cardRecognitionEnabled: true,
    cardRecognitionToastEnabled: true,
    // Digital Receipts
    digitalReceiptRetentionDays: 90,
    requireSignatureAbove: 25,
    // Bottle Service
    bottleServiceEnabled: false,
    bottleServiceAutoGratuityPercent: 20,
    bottleServiceReAuthAlertEnabled: true,
    bottleServiceMinSpendEnforced: false,
  },
  loyalty: {
    enabled: false,
    pointsPerDollar: 1,
    earnOnSubtotal: true,
    earnOnTips: false,
    minimumEarnAmount: 0,
    redemptionEnabled: true,
    pointsPerDollarRedemption: 100,
    minimumRedemptionPoints: 100,
    maximumRedemptionPercent: 50,
    showPointsOnReceipt: true,
    welcomeBonus: 0,
  },
  happyHour: {
    enabled: false,
    name: 'Happy Hour',
    schedules: [
      {
        dayOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
        startTime: '16:00',
        endTime: '18:00',
      },
    ],
    discountType: 'percent',
    discountValue: 20,
    appliesTo: 'all',
    categoryIds: [],
    itemIds: [],
    showBadge: true,
    showOriginalPrice: true,
  },
  pricingRules: [],
  barTabs: {
    requireCardForTab: false,        // Don't require card by default
    pullCustomerFromCard: true,      // Auto-fill name when card is used
    allowNameOnlyTab: true,          // Allow tabs with just a name
    tabTimeoutMinutes: 240,          // 4 hours default timeout warning
    requireCloseTabsBeforeShift: true,   // Block shift close with open orders
    managerExemptFromTabClose: true,     // Managers can override
    maxCaptureRetries: 3,                // Max capture retries before walkout
    autoFlagWalkoutAfterDeclines: true,  // Auto-flag walkout after max retries
  },
  posDisplay: {
    menuItemSize: 'normal',
    menuItemsPerRow: 5,
    categorySize: 'md',
    orderPanelWidth: 'normal',
    categoryColorMode: 'solid',
    categoryButtonBgColor: null,
    categoryButtonTextColor: null,
    showPriceOnMenuItems: true,
  },
  clockOut: {
    requireSettledBeforeClockOut: true,    // On by default (safe default — checks for open tabs/orders)
    requireTipsAdjusted: false,            // Off by default (not all locations need this)
    allowTransferOnClockOut: true,         // Allow transfers by default
  },
  businessDay: {
    dayStartTime: '04:00',
    enforceClockOut: true,
    enforceTabClose: true,
    batchAtDayEnd: true,
    graceMinutes: 15,
    warnBeforeClose: true,
  },
  autoReboot: {
    enabled: false,
    delayMinutes: 15,
  },
  receiptDisplay: DEFAULT_GLOBAL_RECEIPT_SETTINGS,
  approvals: {
    requireVoidApproval: true,
    requireDiscountApproval: true,
    discountApprovalThreshold: 20,
    voidApprovalThreshold: 25,
    requireRefundApproval: true,
    requireDrawerOpenApproval: true,
    defaultMaxDiscountPercent: 25,
  },
  alerts: {
    enabled: true,
    largeVoidThreshold: 50,
    largeDiscountThreshold: 50,
    frequentDiscountLimit: 10,
    overtimeWarningMinutes: 30,
    cashDrawerAlertEnabled: true,
  },
  security: {
    requirePinAfterPayment: false,
    idleLockMinutes: 0,
    enableBuddyPunchDetection: false,
    require2FAForLargeRefunds: false,
    refund2FAThreshold: 100,
    require2FAForLargeVoids: false,
    void2FAThreshold: 200,
  },
  localDataRetention: 'monthly',
  cashManagement: DEFAULT_CASH_MANAGEMENT,
  sendBehavior: 'return_to_floor',
  paidInOutCategories: ['Cash Advance', 'Vendor Payment', 'Refund', 'Restock', 'Tip Payout', 'Other'],
}

// ─── mergeWithDefaults ──────────────────────────────────────────────────────

// Merge partial settings with defaults
export function mergeWithDefaults(partial: Partial<LocationSettings> | null | undefined): LocationSettings {
  if (!partial) return { ...DEFAULT_SETTINGS }

  return {
    tax: {
      ...DEFAULT_SETTINGS.tax,
      ...(partial.tax || {}),
    },
    dualPricing: {
      ...DEFAULT_SETTINGS.dualPricing,
      ...(partial.dualPricing || {}),
      // cashDiscountPercent > 0 is authoritative: dual pricing is active whenever a discount is
      // configured, regardless of how the enabled flag is stored. This prevents the legacy state
      // where enabled:false gets stuck in the DB when a cash discount percent is present.
      enabled: ((partial.dualPricing?.cashDiscountPercent ?? DEFAULT_SETTINGS.dualPricing.cashDiscountPercent) > 0)
        || (partial.dualPricing?.enabled ?? DEFAULT_SETTINGS.dualPricing.enabled),
    },
    pricingProgram: partial.pricingProgram ? migratePricingProgram(partial.pricingProgram) : undefined,
    convenienceFees: partial.convenienceFees
      ? { ...DEFAULT_CONVENIENCE_FEES, ...partial.convenienceFees }
      : undefined,
    priceRounding: {
      ...DEFAULT_SETTINGS.priceRounding,
      ...(partial.priceRounding || {}),
    },
    tips: {
      ...DEFAULT_SETTINGS.tips,
      ...(partial.tips || {}),
    },
    tipShares: {
      ...DEFAULT_SETTINGS.tipShares,
      ...(partial.tipShares || {}),
    },
    tipBank: {
      ...DEFAULT_SETTINGS.tipBank,
      ...(partial.tipBank || {}),
      tipGuide: {
        ...DEFAULT_SETTINGS.tipBank.tipGuide,
        ...(partial.tipBank?.tipGuide || {}),
        percentages: (partial.tipBank?.tipGuide?.percentages?.length)
          ? partial.tipBank.tipGuide.percentages
          : DEFAULT_SETTINGS.tipBank.tipGuide.percentages,
      },
    },
    receipts: {
      ...DEFAULT_SETTINGS.receipts,
      ...(partial.receipts || {}),
    },
    payments: {
      ...DEFAULT_SETTINGS.payments,
      ...(partial.payments || {}),
    },
    loyalty: {
      ...DEFAULT_SETTINGS.loyalty,
      ...(partial.loyalty || {}),
    },
    happyHour: {
      ...DEFAULT_SETTINGS.happyHour,
      ...(partial.happyHour || {}),
      schedules: (partial.happyHour?.schedules?.length)
        ? partial.happyHour.schedules
        : DEFAULT_SETTINGS.happyHour.schedules,
    },
    pricingRules: (() => {
      // If pricingRules is an array (even empty), use it — user explicitly set this, don't re-migrate
      if (Array.isArray(partial.pricingRules)) {
        return partial.pricingRules
      }
      // If pricingRules exists but is not an array, treat as empty and warn
      if (partial.pricingRules !== undefined) {
        log().warn('[PricingRules] pricingRules exists but is not an array, defaulting to []')
        return []
      }
      // pricingRules is undefined (never set) — migrate from legacy happyHour if enabled
      const hh = partial.happyHour
      if (hh?.enabled && hh.schedules?.length && hh.discountType && hh.discountValue > 0) {
        try {
          return [{
            id: 'migrated-happy-hour',
            name: hh.name || 'Happy Hour',
            enabled: true,
            color: '#10b981',
            type: 'recurring' as const,
            schedules: hh.schedules,
            adjustmentType: (hh.discountType === 'percent' ? 'percent-off' : 'fixed-off') as PricingRule['adjustmentType'],
            adjustmentValue: hh.discountValue,
            appliesTo: hh.appliesTo || 'all',
            categoryIds: hh.categoryIds || [],
            itemIds: hh.itemIds || [],
            priority: 10,
            showBadge: hh.showBadge ?? true,
            showOriginalPrice: hh.showOriginalPrice ?? true,
            showCfdCountdown: false,
            autoDelete: false,
            createdAt: new Date().toISOString(),
          }] as PricingRule[]
        } catch {
          log().warn('[PricingRules] Invalid legacy happyHour data, falling back to empty rules')
          return []
        }
      }
      return []
    })(),
    barTabs: {
      ...DEFAULT_SETTINGS.barTabs,
      ...(partial.barTabs || {}),
    },
    posDisplay: {
      ...DEFAULT_SETTINGS.posDisplay,
      ...(partial.posDisplay || {}),
    },
    clockOut: {
      ...DEFAULT_SETTINGS.clockOut,
      ...(partial.clockOut || {}),
    },
    businessDay: {
      ...DEFAULT_SETTINGS.businessDay,
      ...(partial.businessDay || {}),
    },
    autoReboot: {
      ...DEFAULT_SETTINGS.autoReboot,
      ...(partial.autoReboot || {}),
    },
    receiptDisplay: mergeGlobalReceiptSettings(partial.receiptDisplay),
    approvals: {
      ...DEFAULT_SETTINGS.approvals,
      ...(partial.approvals || {}),
    },
    alerts: {
      ...DEFAULT_SETTINGS.alerts,
      ...(partial.alerts || {}),
    },
    security: {
      ...DEFAULT_SETTINGS.security,
      ...(partial.security || {}),
    },
    localDataRetention: partial.localDataRetention ?? DEFAULT_SETTINGS.localDataRetention,
    hotelPms: partial.hotelPms
      ? { ...DEFAULT_HOTEL_PMS_SETTINGS, ...partial.hotelPms }
      : undefined,
    sevenShifts: partial.sevenShifts
      ? { ...DEFAULT_SEVEN_SHIFTS_SETTINGS, ...partial.sevenShifts, syncOptions: { ...DEFAULT_SEVEN_SHIFTS_SETTINGS.syncOptions, ...partial.sevenShifts.syncOptions } }
      : undefined,
    marginEdge: partial.marginEdge
      ? { ...DEFAULT_MARGIN_EDGE_SETTINGS, ...partial.marginEdge, syncOptions: { ...DEFAULT_MARGIN_EDGE_SETTINGS.syncOptions, ...partial.marginEdge.syncOptions } }
      : undefined,
    eod: partial.eod
      ? { ...DEFAULT_EOD_SETTINGS, ...partial.eod }
      : undefined,
    walkout: partial.walkout
      ? { ...DEFAULT_WALKOUT_SETTINGS, ...partial.walkout }
      : undefined,
    breaks: partial.breaks
      ? { ...DEFAULT_BREAK_COMPLIANCE, ...partial.breaks }
      : undefined,
    kds: partial.kds
      ? { ...DEFAULT_KDS_SETTINGS, ...partial.kds }
      : undefined,
    autoGratuity: partial.autoGratuity
      ? { ...DEFAULT_AUTO_GRATUITY, ...partial.autoGratuity }
      : undefined,
    ageVerification: partial.ageVerification
      ? { ...DEFAULT_AGE_VERIFICATION, ...partial.ageVerification }
      : undefined,
    speedOfService: partial.speedOfService
      ? { ...DEFAULT_SPEED_OF_SERVICE, ...partial.speedOfService }
      : undefined,
    cashManagement: partial.cashManagement
      ? { ...DEFAULT_CASH_MANAGEMENT, ...partial.cashManagement }
      : DEFAULT_CASH_MANAGEMENT,
    loginMessages: partial.loginMessages
      ? { ...DEFAULT_LOGIN_MESSAGES, ...partial.loginMessages, messages: partial.loginMessages.messages ?? [] }
      : undefined,
    training: partial.training
      ? { ...DEFAULT_TRAINING_SETTINGS, ...partial.training, trainingEmployeeIds: partial.training.trainingEmployeeIds ?? [] }
      : undefined,
    comboAutoSuggest: partial.comboAutoSuggest ?? true,
    sendBehavior: partial.sendBehavior ?? DEFAULT_SETTINGS.sendBehavior,
    paidInOutCategories: partial.paidInOutCategories ?? DEFAULT_SETTINGS.paidInOutCategories,
    serverBanking: partial.serverBanking
      ? { ...DEFAULT_SERVER_BANKING, ...partial.serverBanking }
      : undefined,
    preOrders: partial.preOrders
      ? { ...DEFAULT_PRE_ORDER, ...partial.preOrders, allowedOrderTypes: partial.preOrders.allowedOrderTypes ?? DEFAULT_PRE_ORDER.allowedOrderTypes }
      : undefined,
    coverCharge: partial.coverCharge
      ? { ...DEFAULT_COVER_CHARGE, ...partial.coverCharge }
      : undefined,
    qrOrdering: partial.qrOrdering
      ? { ...DEFAULT_QR_ORDERING, ...partial.qrOrdering, menuCategoryFilter: partial.qrOrdering.menuCategoryFilter ?? DEFAULT_QR_ORDERING.menuCategoryFilter }
      : undefined,
    employeeMeals: partial.employeeMeals
      ? { ...DEFAULT_EMPLOYEE_MEAL_SETTINGS, ...partial.employeeMeals }
      : undefined,
    showNutritionalInfo: partial.showNutritionalInfo ?? false,
    waitlist: partial.waitlist
      ? { ...DEFAULT_WAITLIST_SETTINGS, ...partial.waitlist }
      : undefined,
    menuRestorePoints: partial.menuRestorePoints
      ? { ...DEFAULT_MENU_RESTORE_POINT_SETTINGS, ...partial.menuRestorePoints }
      : undefined,
    reservationDeposits: partial.reservationDeposits
      ? { ...DEFAULT_RESERVATION_DEPOSIT, ...partial.reservationDeposits }
      : undefined,
    cardOnFile: partial.cardOnFile
      ? { ...DEFAULT_CARD_ON_FILE, ...partial.cardOnFile }
      : undefined,
    printerFailover: partial.printerFailover
      ? { ...DEFAULT_PRINTER_FAILOVER, ...partial.printerFailover }
      : undefined,
    accounting: partial.accounting
      ? { ...DEFAULT_ACCOUNTING_SETTINGS, ...partial.accounting, glMapping: { ...DEFAULT_GL_MAPPING, ...partial.accounting.glMapping } }
      : undefined,
    payrollExport: partial.payrollExport
      ? { ...DEFAULT_PAYROLL_EXPORT, ...partial.payrollExport }
      : undefined,
    catering: partial.catering
      ? { ...DEFAULT_CATERING, ...partial.catering }
      : undefined,
    customerFeedback: partial.customerFeedback
      ? { ...DEFAULT_CUSTOMER_FEEDBACK, ...partial.customerFeedback }
      : undefined,
    pourControl: partial.pourControl
      ? { ...DEFAULT_POUR_CONTROL, ...partial.pourControl }
      : undefined,
    hardwareLimits: partial.hardwareLimits
      ? { ...DEFAULT_HARDWARE_LIMITS, ...partial.hardwareLimits }
      : undefined,
    upsellPrompts: partial.upsellPrompts
      ? { ...DEFAULT_UPSELL_PROMPTS, ...partial.upsellPrompts }
      : undefined,
    invoicing: partial.invoicing
      ? { ...DEFAULT_INVOICING, ...partial.invoicing, companyInfo: { ...DEFAULT_INVOICING_COMPANY_INFO, ...partial.invoicing.companyInfo }, reminderDays: partial.invoicing.reminderDays ?? DEFAULT_INVOICING.reminderDays }
      : undefined,
    marketing: partial.marketing
      ? { ...DEFAULT_MARKETING, ...partial.marketing, defaultSegments: partial.marketing.defaultSegments ?? DEFAULT_MARKETING.defaultSegments }
      : undefined,
    thirdPartyDelivery: partial.thirdPartyDelivery
      ? {
          ...DEFAULT_THIRD_PARTY_DELIVERY,
          ...partial.thirdPartyDelivery,
          doordash: { ...DEFAULT_THIRD_PARTY_DELIVERY.doordash, ...partial.thirdPartyDelivery.doordash },
          ubereats: { ...DEFAULT_THIRD_PARTY_DELIVERY.ubereats, ...partial.thirdPartyDelivery.ubereats },
          grubhub: { ...DEFAULT_THIRD_PARTY_DELIVERY.grubhub, ...partial.thirdPartyDelivery.grubhub },
          deliveryMarkup: partial.thirdPartyDelivery.deliveryMarkup
            ? { ...DEFAULT_DELIVERY_MARKUP, ...partial.thirdPartyDelivery.deliveryMarkup, platformOverrides: { ...partial.thirdPartyDelivery.deliveryMarkup.platformOverrides } }
            : undefined,
        }
      : undefined,
    hostView: partial.hostView
      ? { ...DEFAULT_HOST_VIEW, ...partial.hostView }
      : undefined,
    delivery: partial.delivery
      ? {
          ...DEFAULT_DELIVERY,
          ...partial.delivery,
          dispatchPolicy: {
            ...DEFAULT_DISPATCH_POLICY,
            ...(partial.delivery.dispatchPolicy || {}),
            maxOrdersPerDriverByTimeOfDay: {
              ...DEFAULT_DISPATCH_POLICY.maxOrdersPerDriverByTimeOfDay,
              ...(partial.delivery.dispatchPolicy?.maxOrdersPerDriverByTimeOfDay || {}),
            },
          },
          smsTemplates: {
            ...DEFAULT_DELIVERY.smsTemplates,
            ...(partial.delivery.smsTemplates || {}),
          },
          peakHours: partial.delivery.peakHours ?? DEFAULT_DELIVERY.peakHours,
        }
      : undefined,
    deliveryFeatures: partial.deliveryFeatures,  // MC-synced feature flags — pass-through, no defaults
    textToPay: partial.textToPay
      ? { ...DEFAULT_TEXT_TO_PAY, ...partial.textToPay }
      : undefined,
    memberships: partial.memberships
      ? { ...DEFAULT_MEMBERSHIP_SETTINGS, ...partial.memberships }
      : undefined,
    entertainment: partial.entertainment
      ? { ...DEFAULT_ENTERTAINMENT_SETTINGS, ...partial.entertainment }
      : undefined,
    barOperations: partial.barOperations
      ? { ...DEFAULT_BAR_OPERATIONS, ...partial.barOperations }
      : undefined,
    reservationSettings: partial.reservationSettings
      ? { ...DEFAULT_RESERVATION_SETTINGS, ...partial.reservationSettings }
      : undefined,
    depositRules: partial.depositRules
      ? {
          ...DEFAULT_DEPOSIT_RULES,
          ...partial.depositRules,
          paymentMethods: partial.depositRules.paymentMethods ?? DEFAULT_DEPOSIT_RULES.paymentMethods,
          // Backward compat: derive requirementMode from `enabled` if not explicitly set
          requirementMode: partial.depositRules.requirementMode
            ?? (partial.depositRules.enabled === true ? 'required' : partial.depositRules.enabled === false ? 'disabled' : DEFAULT_DEPOSIT_RULES.requirementMode),
        }
      : undefined,
    reservationTemplates: partial.reservationTemplates
      ? {
          ...DEFAULT_RESERVATION_TEMPLATES,
          ...partial.reservationTemplates,
          confirmation: { ...DEFAULT_RESERVATION_TEMPLATES.confirmation, ...partial.reservationTemplates.confirmation },
          reminder24h: { ...DEFAULT_RESERVATION_TEMPLATES.reminder24h, ...partial.reservationTemplates.reminder24h },
          reminder2h: { ...DEFAULT_RESERVATION_TEMPLATES.reminder2h, ...partial.reservationTemplates.reminder2h },
          depositRequest: { ...DEFAULT_RESERVATION_TEMPLATES.depositRequest, ...partial.reservationTemplates.depositRequest },
          depositReceived: { ...DEFAULT_RESERVATION_TEMPLATES.depositReceived, ...partial.reservationTemplates.depositReceived },
          cancellation: { ...DEFAULT_RESERVATION_TEMPLATES.cancellation, ...partial.reservationTemplates.cancellation },
          modification: { ...DEFAULT_RESERVATION_TEMPLATES.modification, ...partial.reservationTemplates.modification },
          noShow: { ...DEFAULT_RESERVATION_TEMPLATES.noShow, ...partial.reservationTemplates.noShow },
          waitlistPromoted: { ...DEFAULT_RESERVATION_TEMPLATES.waitlistPromoted, ...partial.reservationTemplates.waitlistPromoted },
          thankYou: { ...DEFAULT_RESERVATION_TEMPLATES.thankYou, ...partial.reservationTemplates.thankYou },
        }
      : undefined,
    reservationIntegrations: Array.isArray(partial.reservationIntegrations)
      ? partial.reservationIntegrations.map(ri => ({ ...DEFAULT_RESERVATION_INTEGRATION, ...ri }))
      : undefined,
    cakeOrdering: partial.cakeOrdering
      ? { ...DEFAULT_CAKE_ORDERING, ...partial.cakeOrdering }
      : undefined,
    venuePortal: partial.venuePortal
      ? { ...DEFAULT_VENUE_PORTAL, ...partial.venuePortal }
      : undefined,
    cfdDisplay: partial.cfdDisplay
      ? { ...DEFAULT_CFD_DISPLAY, ...partial.cfdDisplay }
      : undefined,
    passiveCardDetection: partial.passiveCardDetection
      ? { ...DEFAULT_PASSIVE_CARD_DETECTION, ...partial.passiveCardDetection }
      : undefined,
  }
}

// ─── Pricing Program Migration & Functions ──────────────────────────────────

/**
 * Migrate legacy pricing program model names to the new types.
 * Called during mergeWithDefaults so all consumers see normalized values.
 *
 * Migrations:
 *  - 'none' → 'standard'
 *  - 'cash_discount' → 'dual_price' (+ cashDiscountPercent → creditMarkupPercent)
 *  - 'flat_rate', 'interchange_plus', 'tiered' → 'standard' (MC-only now)
 */
export function migratePricingProgram(program: PricingProgram): PricingProgram {
  const migrated = { ...program }

  switch (migrated.model) {
    case 'none':
      migrated.model = 'standard'
      break
    case 'cash_discount':
      migrated.model = 'dual_price'
      // Migrate cashDiscountPercent → creditMarkupPercent
      if (migrated.cashDiscountPercent != null && migrated.creditMarkupPercent == null) {
        migrated.creditMarkupPercent = migrated.cashDiscountPercent
      }
      if (migrated.debitMarkupPercent == null) {
        // Legacy cash_discount applied the same rate to debit — default debit to 0 (cash price)
        migrated.debitMarkupPercent = 0
      }
      break
    case 'flat_rate':
    case 'interchange_plus':
    case 'tiered':
      // MC-only models — strip to standard (merchant cost tracking moves to MC)
      migrated.model = 'standard'
      migrated.enabled = false
      break
  }

  return migrated
}

export function getPricingProgram(settings: LocationSettings): PricingProgram {
  // If new pricingProgram field exists and is enabled, use it (already migrated in mergeWithDefaults)
  if (settings.pricingProgram?.enabled) return settings.pricingProgram
  // Fall back to legacy dualPricing
  if (settings.dualPricing?.enabled) {
    return {
      model: 'dual_price',
      enabled: true,
      creditMarkupPercent: settings.dualPricing.cashDiscountPercent,
      debitMarkupPercent: 0,
      cashDiscountPercent: settings.dualPricing.cashDiscountPercent,
      applyToCredit: settings.dualPricing.applyToCredit,
      applyToDebit: settings.dualPricing.applyToDebit,
      showSavingsMessage: settings.dualPricing.showSavingsMessage,
    }
  }
  // If pricingProgram exists but is disabled, return it
  if (settings.pricingProgram) return settings.pricingProgram
  return DEFAULT_PRICING_PROGRAM
}

/**
 * Single source of truth for the active pricing model.
 * All pricing code, UI badges, and payment flows must call this — never read dualPricing or pricingProgram directly.
 * Precedence: pricingProgram.enabled > dualPricing.enabled > none
 */
export const effectivePricingProgram = getPricingProgram

/**
 * Resolve the effective deposit requirement mode.
 * If `requirementMode` is set, use it. Otherwise derive from `enabled`.
 */
export function getEffectiveDepositMode(rules: DepositRules): 'required' | 'optional' | 'disabled' {
  if (rules.requirementMode) return rules.requirementMode
  return rules.enabled ? 'required' : 'disabled'
}

// Parse settings from database JSON
export function parseSettings(json: unknown): LocationSettings {
  if (typeof json === 'string') {
    try {
      return mergeWithDefaults(JSON.parse(json))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
  return mergeWithDefaults(json as Partial<LocationSettings>)
}
