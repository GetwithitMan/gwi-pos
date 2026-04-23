-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'open', 'in_progress', 'sent', 'received', 'pending', 'split', 'paid', 'closed', 'completed', 'voided', 'merged', 'cancelled');

-- CreateEnum
CREATE TYPE "OrderCourseMode" AS ENUM ('off', 'manual', 'auto');

-- CreateEnum
CREATE TYPE "TabStatus" AS ENUM ('pending_auth', 'open', 'no_card', 'closed', 'closing', 'declined_capture', 'auth_failed');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('active', 'voided', 'comped', 'removed');

-- CreateEnum
CREATE TYPE "KitchenStatus" AS ENUM ('pending', 'sent', 'fired', 'cooking', 'ready', 'delivered');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('pending', 'fired', 'ready', 'served');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'credit', 'debit', 'ach', 'gift_card', 'house_account', 'loyalty', 'loyalty_points', 'room_charge');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'processing', 'completed', 'declined', 'failed', 'refunded', 'voided', 'cancelled');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('food', 'drinks', 'liquor', 'entertainment', 'combos', 'pizza', 'retail');

-- CreateEnum
CREATE TYPE "CategoryShow" AS ENUM ('bar', 'food', 'entertainment', 'all');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('standard', 'combo', 'pizza', 'timed_rental');

-- CreateEnum
CREATE TYPE "ModifierPriceType" AS ENUM ('upcharge', 'override', 'from_item');

-- CreateEnum
CREATE TYPE "ModifierPrinterRouting" AS ENUM ('follow', 'also', 'only');

-- CreateEnum
CREATE TYPE "TerminalPlatform" AS ENUM ('BROWSER', 'ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "TerminalCategory" AS ENUM ('FIXED_STATION', 'HANDHELD', 'CFD_DISPLAY', 'CELLULAR');

-- CreateEnum
CREATE TYPE "HandheldMode" AS ENUM ('TABLE_SERVICE', 'BAR_SERVICE', 'PAYMENT_ONLY');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('DATACAP_DIRECT', 'SIMULATED');

-- CreateEnum
CREATE TYPE "PrinterType" AS ENUM ('thermal', 'impact');

-- CreateEnum
CREATE TYPE "PrinterRole" AS ENUM ('receipt', 'kitchen', 'bar');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('pending', 'queued', 'sent', 'failed', 'failed_permanent');

-- CreateEnum
CREATE TYPE "PrintRuleLevel" AS ENUM ('category', 'item', 'modifier');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('active', 'unactivated', 'depleted', 'expired', 'frozen');

-- CreateEnum
CREATE TYPE "PerformedByType" AS ENUM ('employee', 'system', 'cloud', 'webhook');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('received', 'processed', 'failed', 'ignored');

-- CreateEnum
CREATE TYPE "HouseAccountStatus" AS ENUM ('pending', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('pending', 'confirmed', 'checked_in', 'seated', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "TipGroupStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "TipGroupSplitMode" AS ENUM ('equal', 'custom', 'role_weighted', 'hours_weighted');

-- CreateEnum
CREATE TYPE "CashHandlingMode" AS ENUM ('drawer', 'purse', 'none');

-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('paid', 'unpaid', 'meal');

-- CreateEnum
CREATE TYPE "BreakStatus" AS ENUM ('active', 'completed');

-- CreateEnum
CREATE TYPE "PaidInOutType" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "VoidType" AS ENUM ('item', 'order');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ErrorLogStatus" AS ENUM ('NEW', 'INVESTIGATING', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "HealthCheckStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('draft', 'on_sale', 'sold_out', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('available', 'held', 'sold', 'checked_in', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('available', 'occupied', 'reserved', 'dirty', 'in_use');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('available', 'occupied', 'reserved');

-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('standard', 'premium', 'accessible', 'booth_end');

-- CreateEnum
CREATE TYPE "OrderCardStatus" AS ENUM ('authorized', 'declined', 'captured', 'voided', 'released');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('open', 'responded', 'won', 'lost');

-- CreateEnum
CREATE TYPE "WalkoutRetryStatus" AS ENUM ('pending', 'collected', 'exhausted', 'written_off');

-- CreateEnum
CREATE TYPE "RemoteVoidApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'used');

-- CreateEnum
CREATE TYPE "TipDebtStatus" AS ENUM ('open', 'partial', 'recovered', 'written_off');

-- CreateEnum
CREATE TYPE "DailyPrepCountStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('PRINTER', 'KDS');

-- CreateEnum
CREATE TYPE "FloorPlanElementType" AS ENUM ('entertainment', 'decoration', 'barrier', 'stage');

-- CreateEnum
CREATE TYPE "FloorPlanElementStatus" AS ENUM ('available', 'in_use', 'reserved', 'maintenance');

-- CreateEnum
CREATE TYPE "TipLedgerEntryType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TipTransactionSourceType" AS ENUM ('CARD', 'CASH', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EntertainmentWaitlistStatus" AS ENUM ('waiting', 'notified', 'seated', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "EntertainmentSessionState" AS ENUM ('pre_start', 'running', 'overtime', 'stopped', 'voided', 'comped', 'cancelled');

-- CreateEnum
CREATE TYPE "EntertainmentSessionEventType" AS ENUM ('created', 'started', 'extended', 'overtime_entered', 'stopped', 'voided', 'comped', 'cancelled', 'transferred', 'price_updated', 'resource_assigned', 'waitlist_notified');

-- CreateEnum
CREATE TYPE "TimedSessionStatus" AS ENUM ('active', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('in_progress', 'completed', 'reviewed', 'voided');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'pending', 'received', 'approved', 'posted', 'paid', 'voided');

-- CreateEnum
CREATE TYPE "InvoiceSource" AS ENUM ('manual', 'marginedge', 'api');

-- CreateEnum
CREATE TYPE "VendorOrderStatus" AS ENUM ('draft', 'sent', 'confirmed', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('spoilage', 'over_pour', 'spill', 'breakage', 'expired', 'void_comped', 'other');

-- CreateEnum
CREATE TYPE "StockAlertStatus" AS ENUM ('active', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('open', 'processing', 'closed', 'paid');

-- CreateEnum
CREATE TYPE "PayStubStatus" AS ENUM ('pending', 'approved', 'paid', 'void');

-- CreateEnum
CREATE TYPE "ScheduledShiftStatus" AS ENUM ('scheduled', 'confirmed', 'no_show', 'called_off', 'worked');

-- CreateEnum
CREATE TYPE "ShiftSwapRequestStatus" AS ENUM ('pending', 'accepted', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "ShiftRequestType" AS ENUM ('swap', 'cover', 'drop');

-- CreateEnum
CREATE TYPE "TipGroupMembershipStatus" AS ENUM ('active', 'left', 'pending_approval');

-- CreateEnum
CREATE TYPE "DeductionStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'dead', 'cancelled');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('order_deduction', 'liquor_only', 'food_only');

-- CreateEnum
CREATE TYPE "BergInterfaceMethod" AS ENUM ('DIRECT_RING_UP', 'PRE_CHECK', 'FILE_POSTING', 'RING_AND_SLING');

-- CreateEnum
CREATE TYPE "BergPourReleaseMode" AS ENUM ('BEST_EFFORT', 'REQUIRES_OPEN_ORDER');

-- CreateEnum
CREATE TYPE "BergTimeoutPolicy" AS ENUM ('ACK_ON_TIMEOUT', 'NAK_ON_TIMEOUT');

-- CreateEnum
CREATE TYPE "BergAutoRingMode" AS ENUM ('OFF', 'AUTO_RING');

-- CreateEnum
CREATE TYPE "BergDeviceModel" AS ENUM ('MODEL_1504_704', 'LASER', 'ALL_BOTTLE_ABID', 'TAP2', 'FLOW_MONITOR');

-- CreateEnum
CREATE TYPE "BergDispenseStatus" AS ENUM ('ACK', 'NAK', 'ACK_TIMEOUT', 'NAK_TIMEOUT', 'ACK_BEST_EFFORT');

-- CreateEnum
CREATE TYPE "BergParseStatus" AS ENUM ('OK', 'BAD_LRC', 'BAD_PACKET', 'NO_STX', 'OVERFLOW', 'UNMAPPED_PLU');

-- CreateEnum
CREATE TYPE "BergResolutionStatus" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "BergPostProcessStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('SELF_FULFILL', 'KITCHEN_STATION', 'BAR_STATION', 'PREP_STATION', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "OutageQueueStatus" AS ENUM ('PENDING', 'REPLAYED', 'CONFLICT', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "OutageOperation" AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "RegistrationTokenStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PmsAttemptStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "cloudLocationId" TEXT,
    "cloudOrganizationId" TEXT,
    "cloudEnterpriseId" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "allergies" TEXT,
    "favoriteDrink" TEXT,
    "favoriteFood" TEXT,
    "tags" JSONB,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "loyaltyEnrolledAt" TIMESTAMP(3),
    "loyaltyProgramId" TEXT,
    "loyaltyTierId" TEXT,
    "totalSpent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "averageTicket" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lastVisit" TIMESTAMP(3),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "birthday" TIMESTAMP(3),
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "blacklistOverrideUntil" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB,
    "isTipped" BOOLEAN NOT NULL DEFAULT false,
    "tipWeight" DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    "cashHandlingMode" "CashHandlingMode" NOT NULL DEFAULT 'drawer',
    "trackLaborCost" BOOLEAN NOT NULL DEFAULT true,
    "roleType" TEXT NOT NULL DEFAULT 'FOH',
    "accessLevel" TEXT NOT NULL DEFAULT 'STAFF',
    "sessionTimeoutMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "pin" TEXT NOT NULL,
    "password" TEXT,
    "requiresPinChange" BOOLEAN NOT NULL DEFAULT false,
    "hourlyRate" DECIMAL(10,2),
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "federalFilingStatus" TEXT,
    "federalAllowances" INTEGER NOT NULL DEFAULT 0,
    "additionalFederalWithholding" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stateFilingStatus" TEXT,
    "stateAllowances" INTEGER NOT NULL DEFAULT 0,
    "additionalStateWithholding" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isExemptFromFederalTax" BOOLEAN NOT NULL DEFAULT false,
    "isExemptFromStateTax" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethod" TEXT,
    "bankName" TEXT,
    "bankRoutingNumber" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountType" TEXT,
    "bankAccountLast4" TEXT,
    "ytdGrossEarnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdGrossWages" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdTips" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdCommission" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdTaxesWithheld" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdFederalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdStateTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdLocalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdSocialSecurity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdMedicare" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdNetPay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ytdLastUpdated" TIMESTAMP(3),
    "color" TEXT,
    "avatarUrl" TEXT,
    "posLayoutSettings" JSONB,
    "defaultScreen" TEXT DEFAULT 'orders',
    "defaultOrderType" TEXT,
    "preferredRoomOrder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "sevenShiftsUserId" TEXT,
    "sevenShiftsRoleId" TEXT,
    "sevenShiftsDepartmentId" TEXT,
    "sevenShiftsLocationId" TEXT,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRole" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClockEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clockOut" TIMESTAMP(3),
    "breakStart" TIMESTAMP(3),
    "breakEnd" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "regularHours" DECIMAL(6,2),
    "overtimeHours" DECIMAL(6,2),
    "drawerCountIn" JSONB,
    "drawerCountOut" JSONB,
    "notes" TEXT,
    "workingRoleId" TEXT,
    "selectedTipGroupId" TEXT,
    "sevenShiftsTimePunchId" TEXT,
    "sevenShiftsPushedAt" TIMESTAMP(3),
    "sevenShiftsPushError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TimeClockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startingCash" DECIMAL(10,2) NOT NULL,
    "expectedCash" DECIMAL(10,2),
    "actualCash" DECIMAL(10,2),
    "variance" DECIMAL(10,2),
    "totalSales" DECIMAL(10,2),
    "cashSales" DECIMAL(10,2),
    "cardSales" DECIMAL(10,2),
    "tipsDeclared" DECIMAL(10,2),
    "grossTips" DECIMAL(10,2),
    "tipOutTotal" DECIMAL(10,2),
    "netTips" DECIMAL(10,2),
    "notes" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "timeClockEntryId" TEXT,
    "workingRoleId" TEXT,
    "drawerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drawer" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Drawer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidInOut" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "drawerId" TEXT NOT NULL,
    "type" "PaidInOutType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "employeeId" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PaidInOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepStation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "color" TEXT,
    "stationType" TEXT NOT NULL DEFAULT 'kitchen',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showAllItems" BOOLEAN NOT NULL DEFAULT false,
    "autoComplete" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PrepStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "courseNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "color" TEXT,
    "autoFireDelay" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CourseConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "color" TEXT,
    "imageUrl" TEXT,
    "categoryType" "CategoryType" NOT NULL DEFAULT 'food',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "categoryShow" "CategoryShow" NOT NULL DEFAULT 'all',
    "prepStationId" TEXT,
    "courseNumber" INTEGER,
    "printerIds" JSONB,
    "routeTags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "sku" TEXT,
    "imageUrl" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "priceCC" DECIMAL(10,2),
    "cost" DECIMAL(10,2),
    "onlinePrice" DECIMAL(10,2),
    "taxRate" DECIMAL(10,4),
    "isTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "prepStationId" TEXT,
    "prepTime" INTEGER,
    "courseNumber" INTEGER,
    "printerIds" JSONB,
    "backupPrinterIds" JSONB,
    "routeTags" JSONB,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "currentStock" INTEGER,
    "lowStockAlert" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "itemType" "MenuItemType" NOT NULL DEFAULT 'standard',
    "comboPrintMode" TEXT,
    "timedPricing" JSONB,
    "ratePerMinute" DECIMAL(10,2),
    "minimumCharge" DECIMAL(10,2),
    "incrementMinutes" INTEGER DEFAULT 15,
    "minimumMinutes" INTEGER,
    "graceMinutes" INTEGER,
    "prepaidPackages" JSONB,
    "happyHourEnabled" BOOLEAN DEFAULT false,
    "happyHourDiscount" INTEGER DEFAULT 50,
    "happyHourStart" TEXT,
    "happyHourEnd" TEXT,
    "happyHourDays" JSONB,
    "overtimeEnabled" BOOLEAN DEFAULT false,
    "overtimeMode" TEXT,
    "overtimeMultiplier" DECIMAL(10,4),
    "overtimePerMinuteRate" DECIMAL(10,2),
    "overtimeFlatFee" DECIMAL(10,2),
    "overtimeGraceMinutes" INTEGER DEFAULT 5,
    "entertainmentStatus" TEXT,
    "currentOrderId" TEXT,
    "currentOrderItemId" TEXT,
    "blockTimeMinutes" INTEGER,
    "maxConcurrentUses" INTEGER DEFAULT 1,
    "currentUseCount" INTEGER DEFAULT 0,
    "availableFrom" TEXT,
    "availableTo" TEXT,
    "availableDays" TEXT,
    "availableFromDate" TIMESTAMP(3),
    "availableUntilDate" TIMESTAMP(3),
    "commissionType" TEXT,
    "commissionValue" DECIMAL(10,2),
    "pourSizes" JSONB,
    "defaultPourSize" TEXT,
    "applyPourToModifiers" BOOLEAN NOT NULL DEFAULT false,
    "soldByWeight" BOOLEAN NOT NULL DEFAULT false,
    "weightUnit" TEXT,
    "pricePerWeightUnit" DECIMAL(10,2),
    "isFeaturedCfd" BOOLEAN NOT NULL DEFAULT false,
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'KITCHEN_STATION',
    "fulfillmentStationId" TEXT,
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isAgeRestricted" BOOLEAN NOT NULL DEFAULT false,
    "alwaysOpenModifiers" BOOLEAN NOT NULL DEFAULT false,
    "tipExempt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "linkedBottleProductId" TEXT,
    "linkedPourSizeOz" DECIMAL(6,3),
    "metadata" JSONB,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "modifierTypes" JSONB NOT NULL DEFAULT '["universal"]',
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowStacking" BOOLEAN NOT NULL DEFAULT false,
    "stackDisplayMode" TEXT NOT NULL DEFAULT 'individual',
    "tieredPricingConfig" JSONB,
    "exclusionGroupKey" TEXT,
    "hasOnlineOverride" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "allowOpenEntry" BOOLEAN NOT NULL DEFAULT false,
    "allowNone" BOOLEAN NOT NULL DEFAULT false,
    "nonePrintsToKitchen" BOOLEAN NOT NULL DEFAULT false,
    "noneShowOnReceipt" BOOLEAN NOT NULL DEFAULT false,
    "autoAdvance" BOOLEAN NOT NULL DEFAULT false,
    "isSpiritGroup" BOOLEAN NOT NULL DEFAULT false,
    "sourceTemplateId" TEXT,
    "sourceTemplateName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "priceType" "ModifierPriceType" NOT NULL DEFAULT 'upcharge',
    "upsellPrice" DECIMAL(10,2),
    "cost" DECIMAL(10,2),
    "allowNo" BOOLEAN NOT NULL DEFAULT true,
    "allowLite" BOOLEAN NOT NULL DEFAULT false,
    "allowOnSide" BOOLEAN NOT NULL DEFAULT false,
    "allowExtra" BOOLEAN NOT NULL DEFAULT false,
    "extraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "liteMultiplier" DECIMAL(10,4),
    "extraMultiplier" DECIMAL(10,4),
    "allowedPreModifiers" JSONB,
    "extraUpsellPrice" DECIMAL(10,2),
    "ingredientId" TEXT,
    "childModifierGroupId" TEXT,
    "commissionType" TEXT,
    "commissionValue" DECIMAL(10,2),
    "linkedMenuItemId" TEXT,
    "spiritTier" TEXT,
    "linkedBottleProductId" TEXT,
    "pourSizeOz" DECIMAL(6,3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "showAsHotButton" BOOLEAN NOT NULL DEFAULT false,
    "isLabel" BOOLEAN NOT NULL DEFAULT false,
    "printerRouting" "ModifierPrinterRouting" NOT NULL DEFAULT 'follow',
    "printerIds" JSONB,
    "swapEnabled" BOOLEAN NOT NULL DEFAULT false,
    "swapTargets" JSONB,
    "customPreModifiers" JSONB,
    "inventoryDeductionAmount" DECIMAL(10,4),
    "inventoryDeductionUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboTemplate" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "comparePrice" DECIMAL(10,2),
    "allowUpcharges" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ComboTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "comboTemplateId" TEXT NOT NULL,
    "slotName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "minSelections" INTEGER NOT NULL DEFAULT 1,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "menuItemId" TEXT,
    "itemPriceOverride" DECIMAL(10,2),
    "modifierPriceOverrides" JSONB,
    "modifierGroupId" TEXT,
    "priceOverride" DECIMAL(10,2),
    "defaultItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ComboComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponentOption" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "comboComponentId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "upcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ComboComponentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemComboSelection" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "comboComponentId" TEXT,
    "comboComponentOptionId" TEXT,
    "menuItemId" TEXT NOT NULL,
    "optionName" TEXT NOT NULL,
    "upchargeApplied" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,

    CONSTRAINT "OrderItemComboSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "posX" INTEGER NOT NULL DEFAULT 0,
    "posY" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 400,
    "height" INTEGER NOT NULL DEFAULT 300,
    "shape" TEXT NOT NULL DEFAULT 'rectangle',
    "coordinates" JSONB,
    "widthFeet" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "heightFeet" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "gridSizeFeet" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAssignment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "SectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sectionId" TEXT,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "posX" INTEGER NOT NULL DEFAULT 0,
    "posY" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 80,
    "height" INTEGER NOT NULL DEFAULT 80,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "shape" TEXT NOT NULL DEFAULT 'rectangle',
    "seatPattern" TEXT NOT NULL DEFAULT 'all_around',
    "isTimedRental" BOOLEAN NOT NULL DEFAULT false,
    "timedItemId" TEXT,
    "status" "TableStatus" NOT NULL DEFAULT 'available',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultPosX" INTEGER,
    "defaultPosY" INTEGER,
    "defaultSectionId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "minCapacity" INTEGER NOT NULL DEFAULT 1,
    "maxCapacity" INTEGER,
    "isReservable" BOOLEAN NOT NULL DEFAULT true,
    "combinableWithTableIds" JSONB NOT NULL DEFAULT '[]',
    "turnTimeOverrideMinutes" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorPlanElement" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sectionId" TEXT,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "elementType" "FloorPlanElementType" NOT NULL DEFAULT 'entertainment',
    "visualType" TEXT NOT NULL,
    "linkedMenuItemId" TEXT,
    "posX" INTEGER NOT NULL DEFAULT 100,
    "posY" INTEGER NOT NULL DEFAULT 100,
    "width" INTEGER NOT NULL DEFAULT 120,
    "height" INTEGER NOT NULL DEFAULT 80,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "geometry" JSONB,
    "thickness" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "fillColor" TEXT,
    "strokeColor" TEXT,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "status" "FloorPlanElementStatus" NOT NULL DEFAULT 'available',
    "currentOrderId" TEXT,
    "sessionStartedAt" TIMESTAMP(3),
    "sessionExpiresAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "FloorPlanElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntertainmentWaitlist" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "elementId" TEXT,
    "visualType" TEXT,
    "tableId" TEXT,
    "customerName" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "phone" TEXT,
    "status" "EntertainmentWaitlistStatus" NOT NULL DEFAULT 'waiting',
    "position" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "depositAmount" DECIMAL(10,2),
    "depositMethod" TEXT,
    "depositRecordNo" TEXT,
    "depositCardLast4" TEXT,
    "depositCardBrand" TEXT,
    "depositStatus" TEXT,
    "depositCollectedBy" TEXT,
    "depositRefundedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EntertainmentWaitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntertainmentSession" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "sessionState" "EntertainmentSessionState" NOT NULL DEFAULT 'pre_start',
    "version" INTEGER NOT NULL DEFAULT 1,
    "scheduledMinutes" INTEGER,
    "startedAt" TIMESTAMP(3),
    "bookedEndAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "overtimeStartedAt" TIMESTAMP(3),
    "lastExtendedAt" TIMESTAMP(3),
    "totalExtendedMinutes" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB,
    "finalPriceCents" INTEGER,
    "finalPriceDollars" DECIMAL(10,2),
    "createdBy" TEXT,
    "stoppedBy" TEXT,
    "stopReason" TEXT,
    "sourceTerminalId" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EntertainmentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntertainmentSessionEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" "EntertainmentSessionEventType" NOT NULL,
    "payload" JSONB,
    "actorId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntertainmentSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntertainmentResource" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'available',
    "linkedMenuItemId" TEXT,
    "linkedFloorPlanElementId" TEXT,
    "activeSessionId" TEXT,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "defaultPricingPolicyId" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EntertainmentResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderType" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "allowTips" BOOLEAN NOT NULL DEFAULT true,
    "requiredFields" JSONB,
    "optionalFields" JSONB,
    "fieldDefinitions" JSONB,
    "workflowRules" JSONB,
    "kdsConfig" JSONB,
    "printConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "customerId" TEXT,
    "orderNumber" INTEGER NOT NULL,
    "displayNumber" TEXT,
    "parentOrderId" TEXT,
    "splitIndex" INTEGER,
    "splitClass" TEXT,
    "splitMode" TEXT,
    "splitFamilyRootId" TEXT,
    "splitFamilyTotal" DECIMAL(65,30),
    "splitResolution" TEXT,
    "supersededBy" TEXT,
    "supersededAt" TIMESTAMP(3),
    "orderType" TEXT NOT NULL DEFAULT 'dine_in',
    "orderTypeId" TEXT,
    "tableId" TEXT,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "baseSeatCount" INTEGER NOT NULL DEFAULT 1,
    "extraSeatCount" INTEGER NOT NULL DEFAULT 0,
    "seatVersion" INTEGER NOT NULL DEFAULT 0,
    "seatTimestamps" JSONB,
    "tabName" TEXT,
    "tabNickname" TEXT,
    "tabStatus" "TabStatus",
    "customFields" JSONB,
    "status" "OrderStatus" NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxFromInclusive" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxFromExclusive" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "inclusiveTaxRate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "exclusiveTaxRate" DECIMAL(10,4),
    "tipTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "donationAmount" DECIMAL(10,2),
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "primaryPaymentMethod" TEXT,
    "commissionTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "convenienceFee" DECIMAL(10,2),
    "notes" TEXT,
    "preAuthId" TEXT,
    "preAuthAmount" DECIMAL(10,2),
    "preAuthLast4" TEXT,
    "preAuthCardBrand" TEXT,
    "preAuthExpiresAt" TIMESTAMP(3),
    "preAuthRecordNo" TEXT,
    "preAuthReaderId" TEXT,
    "isBottleService" BOOLEAN NOT NULL DEFAULT false,
    "bottleServiceTierId" TEXT,
    "bottleServiceDeposit" DECIMAL(10,2),
    "bottleServiceMinSpend" DECIMAL(10,2),
    "bottleServiceCurrentSpend" DECIMAL(10,2) DEFAULT 0,
    "incrementAuthFailed" BOOLEAN NOT NULL DEFAULT false,
    "isWalkout" BOOLEAN NOT NULL DEFAULT false,
    "walkoutAt" TIMESTAMP(3),
    "walkoutMarkedBy" TEXT,
    "rolledOverAt" TIMESTAMP(3),
    "rolledOverFrom" TEXT,
    "captureDeclinedAt" TIMESTAMP(3),
    "captureRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastCaptureError" TEXT,
    "currentCourse" INTEGER NOT NULL DEFAULT 1,
    "courseMode" "OrderCourseMode" NOT NULL DEFAULT 'off',
    "offlineId" TEXT,
    "offlineLocalId" TEXT,
    "offlineTimestamp" TIMESTAMP(3),
    "offlineTerminalId" TEXT,
    "businessDayDate" TIMESTAMP(3),
    "source" TEXT,
    "isTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "taxExemptReason" TEXT,
    "taxExemptId" TEXT,
    "taxExemptApprovedBy" TEXT,
    "taxExemptSavedAmount" DECIMAL(10,2),
    "claimedByEmployeeId" TEXT,
    "claimedByTerminalId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "isTraining" BOOLEAN NOT NULL DEFAULT false,
    "lastMutatedBy" TEXT,
    "originTerminalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "pagerNumber" TEXT,
    "fulfillmentMode" TEXT,
    "readyCycleCounter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pourSize" TEXT,
    "pourMultiplier" DECIMAL(10,4),
    "cardPrice" DECIMAL(10,2),
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "categoryType" TEXT,
    "seatNumber" INTEGER,
    "sourceTableId" TEXT,
    "courseNumber" INTEGER,
    "courseStatus" "CourseStatus" NOT NULL DEFAULT 'pending',
    "isHeld" BOOLEAN NOT NULL DEFAULT false,
    "holdUntil" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "delayMinutes" INTEGER,
    "delayStartedAt" TIMESTAMP(3),
    "kitchenStatus" "KitchenStatus" NOT NULL DEFAULT 'pending',
    "kitchenSentAt" TIMESTAMP(3),
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "kdsForwardedToScreenId" TEXT,
    "kdsFinalCompleted" BOOLEAN NOT NULL DEFAULT false,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResentAt" TIMESTAMP(3),
    "resendNote" TEXT,
    "blockTimeMinutes" INTEGER,
    "blockTimeStartedAt" TIMESTAMP(3),
    "blockTimeExpiresAt" TIMESTAMP(3),
    "specialNotes" TEXT,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'active',
    "voidReason" TEXT,
    "wasMade" BOOLEAN,
    "soldByWeight" BOOLEAN NOT NULL DEFAULT false,
    "weight" DECIMAL(10,4),
    "weightUnit" TEXT,
    "unitPrice" DECIMAL(10,2),
    "grossWeight" DECIMAL(10,4),
    "tareWeight" DECIMAL(10,4),
    "modifierTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "itemTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(10,2),
    "idempotencyKey" TEXT,
    "pricingOptionId" TEXT,
    "pricingOptionLabel" TEXT,
    "costAtSale" DECIMAL(10,2),
    "tipExempt" BOOLEAN NOT NULL DEFAULT false,
    "pricingRuleApplied" JSONB,
    "addedByEmployeeId" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemModifier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "modifierId" TEXT,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "preModifier" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "stackDisplayMode" TEXT NOT NULL DEFAULT 'individual',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "commissionAmount" DECIMAL(10,2),
    "linkedMenuItemId" TEXT,
    "linkedMenuItemName" TEXT,
    "linkedMenuItemPrice" DECIMAL(10,2),
    "spiritTier" TEXT,
    "linkedBottleProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "isCustomEntry" BOOLEAN NOT NULL DEFAULT false,
    "customEntryName" TEXT,
    "customEntryPrice" DECIMAL(10,2),
    "isNoneSelection" BOOLEAN NOT NULL DEFAULT false,
    "noneShowOnReceipt" BOOLEAN NOT NULL DEFAULT false,
    "swapTargetName" TEXT,
    "swapTargetItemId" TEXT,
    "swapPricingMode" TEXT,
    "swapEffectivePrice" DECIMAL(10,2),

    CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT,
    "drawerId" TEXT,
    "shiftId" TEXT,
    "terminalId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "tipAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "amountTendered" DECIMAL(10,2),
    "changeGiven" DECIMAL(10,2),
    "roundingAdjustment" DECIMAL(10,2),
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "authCode" TEXT,
    "transactionId" TEXT,
    "paymentReaderId" TEXT,
    "datacapRefNumber" TEXT,
    "datacapRecordNo" TEXT,
    "datacapSequenceNo" TEXT,
    "entryMethod" TEXT,
    "acqRefData" TEXT,
    "processData" TEXT,
    "aid" TEXT,
    "cvmResult" TEXT,
    "avsResult" TEXT,
    "level2Status" TEXT,
    "tokenFrequency" TEXT,
    "amountRequested" DECIMAL(10,2),
    "amountAuthorized" DECIMAL(10,2),
    "signatureData" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'completed',
    "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "settledAt" TIMESTAMP(3),
    "offlineIntentId" TEXT,
    "idempotencyKey" TEXT,
    "isOfflineCapture" BOOLEAN NOT NULL DEFAULT false,
    "offlineCapturedAt" TIMESTAMP(3),
    "offlineTerminalId" TEXT,
    "safStatus" TEXT,
    "safUploadedAt" TIMESTAMP(3),
    "safError" TEXT,
    "cashDiscountAmount" DECIMAL(10,2),
    "priceBeforeDiscount" DECIMAL(10,2),
    "pricingMode" TEXT,
    "detectedCardType" TEXT,
    "appliedPricingTier" TEXT NOT NULL DEFAULT 'cash',
    "walletType" TEXT,
    "pricingProgramSnapshot" JSONB,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "wasDuplicateBlocked" BOOLEAN NOT NULL DEFAULT false,
    "lastMutatedBy" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "roomNumber" TEXT,
    "guestName" TEXT,
    "pmsReservationId" TEXT,
    "pmsTransactionId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncAuditEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "terminalId" TEXT NOT NULL,
    "terminalName" TEXT NOT NULL,
    "employeeId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "localIntentId" TEXT,
    "status" TEXT NOT NULL,
    "statusNote" TEXT,
    "cardLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "SyncAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "freeItemId" TEXT,
    "minimumOrder" DECIMAL(10,2),
    "maximumDiscount" DECIMAL(10,2),
    "appliesTo" TEXT NOT NULL DEFAULT 'order',
    "categoryIds" JSONB,
    "itemIds" JSONB,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER,
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isStackable" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestPhone" TEXT,
    "guestEmail" TEXT,
    "partySize" INTEGER NOT NULL,
    "reservationDate" TIMESTAMP(3) NOT NULL,
    "reservationTime" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 90,
    "tableId" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'confirmed',
    "specialRequests" TEXT,
    "internalNotes" TEXT,
    "customerId" TEXT,
    "orderId" TEXT,
    "bottleServiceTierId" TEXT,
    "occasion" TEXT,
    "dietaryRestrictions" TEXT,
    "source" TEXT DEFAULT 'staff',
    "externalId" TEXT,
    "sectionPreference" TEXT,
    "confirmationSentAt" TIMESTAMP(3),
    "reminder24hSentAt" TIMESTAMP(3),
    "reminder2hSentAt" TIMESTAMP(3),
    "thankYouSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "manageToken" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "serviceDate" DATE,
    "holdExpiresAt" TIMESTAMP(3),
    "depositStatus" TEXT DEFAULT 'not_required',
    "depositAmountCents" INTEGER,
    "depositRulesSnapshot" JSONB,
    "statusUpdatedAt" TIMESTAMP(3),
    "sourceMetadata" JSONB,
    "smsOptInSnapshot" BOOLEAN,
    "depositRequired" BOOLEAN,
    "depositAmount" DECIMAL(10,2),
    "createdBy" TEXT,
    "seatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayText" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "discountConfig" JSONB NOT NULL,
    "scheduleConfig" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isStackable" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "maxPerOrder" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "isEmployeeDiscount" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDiscount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountRuleId" TEXT,
    "couponId" TEXT,
    "couponCode" TEXT,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "percent" DECIMAL(8,4),
    "appliedBy" TEXT,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,

    CONSTRAINT "OrderDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoidLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "voidType" "VoidType" NOT NULL,
    "itemId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "wasMade" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "remoteApprovalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "VoidLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteVoidApproval" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "requestedById" TEXT NOT NULL,
    "voidReason" TEXT NOT NULL,
    "voidType" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "itemName" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "managerId" TEXT NOT NULL,
    "managerPhone" TEXT NOT NULL,
    "twilioMessageSid" TEXT,
    "approvalToken" TEXT NOT NULL,
    "approvalTokenExpiry" TIMESTAMP(3) NOT NULL,
    "approvalCode" TEXT,
    "approvalCodeExpiry" TIMESTAMP(3),
    "status" "RemoteVoidApprovalStatus" NOT NULL DEFAULT 'pending',
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "usedAt" TIMESTAMP(3),
    "requestingTerminalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "RemoteVoidApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipPool" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "distributionType" TEXT NOT NULL,
    "eligibleRoles" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipOutRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fromRoleId" TEXT NOT NULL,
    "toRoleId" TEXT NOT NULL,
    "percentage" DECIMAL(8,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "basisType" TEXT NOT NULL DEFAULT 'tips_earned',
    "salesCategoryIds" JSONB,
    "maxPercentage" DECIMAL(8,4),
    "effectiveDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipOutRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipShare" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftId" TEXT,
    "fromEmployeeId" TEXT NOT NULL,
    "toEmployeeId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "shareType" TEXT NOT NULL,
    "ruleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "collectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipLedger" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "currentBalanceCents" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipLedgerEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TipLedgerEntryType" NOT NULL,
    "amountCents" DECIMAL(10,2) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "memo" TEXT,
    "adjustmentId" TEXT,
    "shiftId" TEXT,
    "orderId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipTransaction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "tipGroupId" TEXT,
    "segmentId" TEXT,
    "amountCents" DECIMAL(10,2) NOT NULL,
    "sourceType" "TipTransactionSourceType" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'tip',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "primaryEmployeeId" TEXT,
    "ccFeeAmountCents" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipGroupTemplate" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allowedRoleIds" JSONB NOT NULL,
    "defaultSplitMode" "TipGroupSplitMode" NOT NULL DEFAULT 'equal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipGroupTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "registerId" TEXT,
    "templateId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "status" "TipGroupStatus" NOT NULL DEFAULT 'active',
    "splitMode" "TipGroupSplitMode" NOT NULL DEFAULT 'equal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipGroupMembership" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "role" TEXT,
    "approvedBy" TEXT,
    "status" "TipGroupMembershipStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipGroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipGroupSegment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "memberCount" INTEGER NOT NULL,
    "splitJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipGroupSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipDebt" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "originalAmountCents" DECIMAL(10,2) NOT NULL,
    "remainingCents" DECIMAL(10,2) NOT NULL,
    "sourcePaymentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'CHARGEBACK',
    "memo" TEXT,
    "status" "TipDebtStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "recoveredAt" TIMESTAMP(3),
    "writtenOffAt" TIMESTAMP(3),
    "writtenOffBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipDebt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderOwnership" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderOwnershipEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderOwnershipId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sharePercent" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderOwnershipEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipAdjustment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "contextJson" JSONB,
    "autoRecalcRan" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTipDeclaration" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT,
    "amountCents" DECIMAL(10,2) NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'employee',
    "overrideReason" TEXT,
    "overrideBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CashTipDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "pin" TEXT,
    "initialBalance" DECIMAL(10,2) NOT NULL,
    "currentBalance" DECIMAL(10,2) NOT NULL,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'active',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "frozenReason" TEXT,
    "purchasedById" TEXT,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "purchaserName" TEXT,
    "message" TEXT,
    "orderId" TEXT,
    "source" TEXT,
    "batchId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedById" TEXT,
    "externalProvider" TEXT,
    "externalTransactionId" TEXT,
    "externalPageId" TEXT,
    "deliveryStatus" "DeliveryStatus",
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAttemptAt" TIMESTAMP(3),
    "deliveryFailureReason" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardTransaction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceBefore" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "orderId" TEXT,
    "employeeId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "externalReference" TEXT,
    "performedByType" "PerformedByType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseAccount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "creditLimit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "status" "HouseAccountStatus" NOT NULL DEFAULT 'pending',
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "lastBilledAt" TIMESTAMP(3),
    "nextBillDate" TIMESTAMP(3),
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "taxId" TEXT,
    "customerId" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "HouseAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseAccountTransaction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "houseAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceBefore" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "orderId" TEXT,
    "employeeId" TEXT,
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "HouseAccountTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimedSession" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "tableId" TEXT,
    "orderId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalMinutes" INTEGER,
    "totalCharge" DECIMAL(10,2),
    "rateType" TEXT NOT NULL DEFAULT 'hourly',
    "rateAmount" DECIMAL(10,2) NOT NULL,
    "status" "TimedSessionStatus" NOT NULL DEFAULT 'active',
    "startedById" TEXT,
    "endedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TimedSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "relativeX" INTEGER NOT NULL DEFAULT 0,
    "relativeY" INTEGER NOT NULL DEFAULT 0,
    "angle" INTEGER NOT NULL DEFAULT 0,
    "originalRelativeX" INTEGER,
    "originalRelativeY" INTEGER,
    "originalAngle" INTEGER,
    "seatType" "SeatType" NOT NULL DEFAULT 'standard',
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,
    "sourceOrderId" TEXT,
    "status" "SeatStatus" NOT NULL DEFAULT 'available',
    "currentOrderItemId" TEXT,
    "lastOccupiedAt" TIMESTAMP(3),
    "lastOccupiedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'dinner_show',
    "eventDate" TIMESTAMP(3) NOT NULL,
    "doorsOpen" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "ticketingMode" TEXT NOT NULL DEFAULT 'per_seat',
    "allowOnlineSales" BOOLEAN NOT NULL DEFAULT true,
    "allowPOSSales" BOOLEAN NOT NULL DEFAULT true,
    "maxTicketsPerOrder" INTEGER,
    "totalCapacity" INTEGER NOT NULL,
    "reservedCapacity" INTEGER NOT NULL DEFAULT 0,
    "salesStartAt" TIMESTAMP(3),
    "salesEndAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'draft',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "reservationConflictsHandled" BOOLEAN NOT NULL DEFAULT false,
    "reservationConflictNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPricingTier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "serviceFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "quantityAvailable" INTEGER,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "maxPerOrder" INTEGER,
    "sectionIds" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EventPricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTableConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "bookingMode" TEXT NOT NULL DEFAULT 'inherit',
    "pricingTierId" TEXT,
    "minPartySize" INTEGER,
    "maxPartySize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EventTableConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "pricingTierId" TEXT NOT NULL,
    "tableId" TEXT,
    "seatId" TEXT,
    "ticketNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "customerId" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "serviceFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'available',
    "heldAt" TIMESTAMP(3),
    "heldUntil" TIMESTAMP(3),
    "heldBySessionId" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "purchaseChannel" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundAmount" DECIMAL(10,2),
    "refundedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'all',
    "categoryIds" JSONB,
    "itemIds" JSONB,
    "isInclusive" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isCompounded" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantityBefore" INTEGER NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "employeeId" TEXT,
    "vendorName" TEXT,
    "invoiceNumber" TEXT,
    "reason" TEXT,
    "unitCost" DECIMAL(10,2),
    "totalCost" DECIMAL(10,2),
    "businessDate" TIMESTAMP(3),
    "source" TEXT,
    "wasteLogId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "status" "StockAlertStatus" NOT NULL DEFAULT 'active',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoidReason" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deductInventory" BOOLEAN NOT NULL DEFAULT false,
    "requiresManager" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "VoidReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompReason" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deductInventory" BOOLEAN NOT NULL DEFAULT false,
    "requiresManager" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CompReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReasonAccess" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reasonType" TEXT NOT NULL,
    "reasonId" TEXT NOT NULL,
    "accessType" TEXT NOT NULL DEFAULT 'allow',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReasonAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "department" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "revenueCenter" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "brand" TEXT,
    "purchaseUnit" TEXT NOT NULL,
    "purchaseSize" DECIMAL(10,4) NOT NULL,
    "purchaseCost" DECIMAL(10,2) NOT NULL,
    "defaultVendorId" TEXT,
    "storageUnit" TEXT NOT NULL,
    "unitsPerPurchase" DECIMAL(10,4) NOT NULL,
    "costPerUnit" DECIMAL(10,4) NOT NULL,
    "costingMethod" TEXT NOT NULL DEFAULT 'weighted_average',
    "lastPriceUpdate" TIMESTAMP(3),
    "priceSource" TEXT NOT NULL DEFAULT 'manual',
    "yieldPercent" DECIMAL(8,4) NOT NULL DEFAULT 100,
    "yieldCostPerUnit" DECIMAL(10,4),
    "spiritCategoryId" TEXT,
    "pourSizeOz" DECIMAL(6,3),
    "proofPercent" DECIMAL(6,2),
    "currentStock" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "parLevel" DECIMAL(10,4),
    "reorderPoint" DECIMAL(10,4),
    "reorderQty" DECIMAL(10,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastInvoiceCost" DECIMAL(10,4),
    "lastInvoiceDate" TIMESTAMP(3),
    "marginEdgeProductId" TEXT,
    "averageCost" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemStorage" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "storageLocationId" TEXT NOT NULL,
    "currentStock" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "parLevel" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryItemStorage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "outputUnit" TEXT NOT NULL,
    "batchYield" DECIMAL(10,4) NOT NULL,
    "batchUnit" TEXT NOT NULL,
    "costPerUnit" DECIMAL(10,4),
    "shelfLifeHours" INTEGER,
    "storageNotes" TEXT,
    "isDailyCountItem" BOOLEAN NOT NULL DEFAULT false,
    "currentPrepStock" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "lastCountedAt" TIMESTAMP(3),
    "lowStockThreshold" DECIMAL(10,4),
    "criticalStockThreshold" DECIMAL(10,4),
    "onlineStockThreshold" DECIMAL(10,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PrepItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepItemIngredient" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "prepItemId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PrepItemIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemRecipe" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "totalCost" DECIMAL(10,2),
    "foodCostPct" DECIMAL(8,4),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemRecipeIngredient" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "prepItemId" TEXT,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DECIMAL(10,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemRecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierInventoryLink" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "modifierId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "prepItemId" TEXT,
    "usageQuantity" DECIMAL(10,4) NOT NULL,
    "usageUnit" TEXT NOT NULL,
    "calculatedCost" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ModifierInventoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingOptionGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "showAsQuickPick" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PricingOptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingOption" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "price" DECIMAL(10,2),
    "priceCC" DECIMAL(10,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "showOnPos" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PricingOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingOptionInventoryLink" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "pricingOptionId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "prepItemId" TEXT,
    "ingredientId" TEXT,
    "usageQuantity" DECIMAL(10,4) NOT NULL,
    "usageUnit" TEXT NOT NULL,
    "calculatedCost" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PricingOptionInventoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countType" TEXT NOT NULL,
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'in_progress',
    "storageLocationId" TEXT,
    "startedById" TEXT,
    "completedById" TEXT,
    "reviewedById" TEXT,
    "expectedValue" DECIMAL(10,2),
    "countedValue" DECIMAL(10,2),
    "varianceValue" DECIMAL(10,2),
    "variancePct" DECIMAL(8,4),
    "totalVarianceCost" DECIMAL(10,2),
    "categoryFilter" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "expectedQty" DECIMAL(10,4) NOT NULL,
    "countedQty" DECIMAL(10,4),
    "variance" DECIMAL(10,4),
    "varianceValue" DECIMAL(10,2),
    "variancePct" DECIMAL(8,4),
    "countedAt" TIMESTAMP(3),
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemTransaction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantityBefore" DECIMAL(10,4) NOT NULL,
    "quantityChange" DECIMAL(10,4) NOT NULL,
    "quantityAfter" DECIMAL(10,4) NOT NULL,
    "unitCost" DECIMAL(10,2),
    "totalCost" DECIMAL(10,2),
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "deductionJobId" TEXT,
    "notes" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryItemTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountNum" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "paymentTerms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "receivedDate" TIMESTAMP(3),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
    "source" "InvoiceSource" NOT NULL DEFAULT 'manual',
    "paidDate" TIMESTAMP(3),
    "marginEdgeInvoiceId" TEXT,
    "updateCosts" BOOLEAN NOT NULL DEFAULT true,
    "addToInventory" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "enteredById" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "marginEdgeProductId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(10,2) NOT NULL,
    "totalCost" DECIMAL(10,2) NOT NULL,
    "previousCost" DECIMAL(10,2),
    "costChange" DECIMAL(10,2),
    "costChangePct" DECIMAL(8,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteLogEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "costImpact" DECIMAL(10,2),
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "employeeId" TEXT,
    "wasteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "WasteLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySettings" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "trackingMode" TEXT NOT NULL DEFAULT 'usage_only',
    "deductionTiming" TEXT NOT NULL DEFAULT 'on_send',
    "trackPrepStock" BOOLEAN NOT NULL DEFAULT true,
    "deductPrepOnSend" BOOLEAN NOT NULL DEFAULT true,
    "restorePrepOnVoid" BOOLEAN NOT NULL DEFAULT true,
    "defaultCountFrequency" TEXT NOT NULL DEFAULT 'weekly',
    "countReminderDay" TEXT,
    "countReminderTime" TEXT,
    "requireManagerReview" BOOLEAN NOT NULL DEFAULT true,
    "varianceAlertPct" DECIMAL(8,4) NOT NULL DEFAULT 5,
    "costChangeAlertPct" DECIMAL(8,4) NOT NULL DEFAULT 10,
    "targetFoodCostPct" DECIMAL(8,4),
    "targetLiquorCostPct" DECIMAL(8,4),
    "multiplierLite" DECIMAL(10,4) NOT NULL DEFAULT 0.5,
    "multiplierExtra" DECIMAL(10,4) NOT NULL DEFAULT 2.0,
    "multiplierTriple" DECIMAL(10,4) NOT NULL DEFAULT 3.0,
    "defaultPourSizeOz" DECIMAL(6,3) NOT NULL DEFAULT 1.5,
    "exportEnabled" BOOLEAN NOT NULL DEFAULT false,
    "exportTarget" TEXT,
    "exportApiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "InventorySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Break" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "timeClockEntryId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "breakType" "BreakType" NOT NULL DEFAULT 'unpaid',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "status" "BreakStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Break_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpiritCategory" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryType" TEXT NOT NULL DEFAULT 'spirit',
    "displayName" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "SpiritCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BottleProduct" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "displayName" TEXT,
    "spiritCategoryId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "bottleSizeMl" INTEGER NOT NULL,
    "bottleSizeOz" DECIMAL(10,4),
    "unitCost" DECIMAL(10,2) NOT NULL,
    "pourSizeOz" DECIMAL(6,3),
    "poursPerBottle" INTEGER,
    "pourCost" DECIMAL(10,2),
    "containerType" TEXT NOT NULL DEFAULT 'bottle',
    "alcoholSubtype" TEXT,
    "vintage" INTEGER,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "lowStockAlert" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "inventoryItemId" TEXT,

    CONSTRAINT "BottleProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "bottleProductId" TEXT,
    "ingredientId" TEXT,
    "pourCount" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "pourSizeOz" DECIMAL(6,3),
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isSubstitutable" BOOLEAN NOT NULL DEFAULT true,
    "quantity" DECIMAL(10,4),
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "RecipeIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpiritModifierGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "spiritCategoryId" TEXT NOT NULL,
    "upsellEnabled" BOOLEAN NOT NULL DEFAULT true,
    "upsellPromptText" TEXT,
    "defaultTier" TEXT NOT NULL DEFAULT 'well',
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "SpiritModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpiritUpsellEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "baseModifierId" TEXT NOT NULL,
    "baseTier" TEXT NOT NULL,
    "baseBottleName" TEXT NOT NULL,
    "upsellModifierId" TEXT NOT NULL,
    "upsellTier" TEXT NOT NULL,
    "upsellBottleName" TEXT NOT NULL,
    "priceDifference" DECIMAL(10,2) NOT NULL,
    "wasShown" BOOLEAN NOT NULL DEFAULT true,
    "wasAccepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "SpiritUpsellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCategory" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "IngredientCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientSwapGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "IngredientSwapGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "categoryId" TEXT,
    "inventoryItemId" TEXT,
    "prepItemId" TEXT,
    "standardQuantity" DECIMAL(10,4),
    "standardUnit" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'delivered',
    "purchaseUnit" TEXT,
    "purchaseCost" DECIMAL(10,2),
    "unitsPerPurchase" DECIMAL(10,4),
    "allowNo" BOOLEAN NOT NULL DEFAULT true,
    "allowLite" BOOLEAN NOT NULL DEFAULT true,
    "allowExtra" BOOLEAN NOT NULL DEFAULT true,
    "allowOnSide" BOOLEAN NOT NULL DEFAULT false,
    "extraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "liteMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 0.5,
    "extraMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 2.0,
    "allowSwap" BOOLEAN NOT NULL DEFAULT false,
    "swapGroupId" TEXT,
    "swapUpcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'visible',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentIngredientId" TEXT,
    "preparationType" TEXT,
    "yieldPercent" DECIMAL(10,4),
    "batchYield" DECIMAL(10,4),
    "inputQuantity" DECIMAL(10,4),
    "inputUnit" TEXT,
    "outputQuantity" DECIMAL(10,4) DEFAULT 1,
    "outputUnit" TEXT DEFAULT 'each',
    "recipeYieldQuantity" DECIMAL(10,4),
    "recipeYieldUnit" TEXT,
    "portionSize" DECIMAL(10,4),
    "portionUnit" TEXT,
    "isDailyCountItem" BOOLEAN NOT NULL DEFAULT false,
    "currentPrepStock" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "lastCountedAt" TIMESTAMP(3),
    "countPrecision" TEXT NOT NULL DEFAULT 'whole',
    "lowStockThreshold" DECIMAL(10,4),
    "criticalStockThreshold" DECIMAL(10,4),
    "onlineStockThreshold" DECIMAL(10,4),
    "resetDailyToZero" BOOLEAN NOT NULL DEFAULT true,
    "varianceHandling" TEXT NOT NULL DEFAULT 'auto_adjust',
    "varianceThreshold" DECIMAL(8,4) NOT NULL DEFAULT 10,
    "isBaseIngredient" BOOLEAN NOT NULL DEFAULT true,
    "is86d" BOOLEAN NOT NULL DEFAULT false,
    "last86dAt" TIMESTAMP(3),
    "last86dBy" TEXT,
    "showOnQuick86" BOOLEAN NOT NULL DEFAULT false,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientStockAdjustment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantityBefore" DECIMAL(10,4) NOT NULL,
    "quantityChange" DECIMAL(10,4) NOT NULL,
    "quantityAfter" DECIMAL(10,4) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(10,2),
    "totalCostImpact" DECIMAL(10,2),
    "employeeId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "IngredientStockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientRecipe" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "batchSize" DECIMAL(10,4),
    "batchUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "IngredientRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemIngredient" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "pricingOptionId" TEXT,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "quantity" DECIMAL(10,4),
    "unit" TEXT,
    "allowNo" BOOLEAN,
    "allowLite" BOOLEAN,
    "allowExtra" BOOLEAN,
    "allowOnSide" BOOLEAN,
    "extraPrice" DECIMAL(10,2),
    "isBase" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroupTemplate" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowStacking" BOOLEAN NOT NULL DEFAULT false,
    "modifierTypes" JSONB NOT NULL DEFAULT '["food"]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ModifierGroupTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierTemplate" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allowNo" BOOLEAN NOT NULL DEFAULT true,
    "allowLite" BOOLEAN NOT NULL DEFAULT false,
    "allowOnSide" BOOLEAN NOT NULL DEFAULT false,
    "allowExtra" BOOLEAN NOT NULL DEFAULT false,
    "extraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ingredientId" TEXT,
    "ingredientName" TEXT,
    "inventoryDeductionAmount" DECIMAL(10,4),
    "inventoryDeductionUnit" TEXT,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ModifierTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemIngredient" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "modificationType" TEXT NOT NULL DEFAULT 'standard',
    "priceAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "swappedToModifierId" TEXT,
    "swappedToModifierName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderItemIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "printerType" "PrinterType" NOT NULL,
    "model" TEXT,
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "printerRole" "PrinterRole" NOT NULL DEFAULT 'kitchen',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "supportsCut" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastPingAt" TIMESTAMP(3),
    "lastPingOk" BOOLEAN NOT NULL DEFAULT false,
    "printSettings" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "type" "StationType" NOT NULL,
    "ipAddress" TEXT,
    "port" INTEGER DEFAULT 9100,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "isExpo" BOOLEAN NOT NULL DEFAULT false,
    "templateType" TEXT NOT NULL DEFAULT 'STANDARD_KITCHEN',
    "printerType" TEXT,
    "printerModel" TEXT,
    "paperWidth" INTEGER DEFAULT 80,
    "supportsCut" BOOLEAN NOT NULL DEFAULT true,
    "printSettings" JSONB,
    "columns" INTEGER DEFAULT 4,
    "fontSize" TEXT DEFAULT 'normal',
    "colorScheme" TEXT DEFAULT 'dark',
    "agingWarning" INTEGER DEFAULT 8,
    "lateWarning" INTEGER DEFAULT 15,
    "playSound" BOOLEAN NOT NULL DEFAULT true,
    "flashOnNew" BOOLEAN NOT NULL DEFAULT true,
    "showReferenceItems" BOOLEAN NOT NULL DEFAULT true,
    "atomicPrintConfig" JSONB,
    "backupStationId" TEXT,
    "failoverTimeout" INTEGER DEFAULT 5000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastPingAt" TIMESTAMP(3),
    "lastPingOk" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KDSScreen" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "screenType" TEXT NOT NULL DEFAULT 'kds',
    "columns" INTEGER NOT NULL DEFAULT 4,
    "fontSize" TEXT NOT NULL DEFAULT 'normal',
    "colorScheme" TEXT NOT NULL DEFAULT 'dark',
    "agingWarning" INTEGER NOT NULL DEFAULT 8,
    "lateWarning" INTEGER NOT NULL DEFAULT 15,
    "playSound" BOOLEAN NOT NULL DEFAULT true,
    "flashOnNew" BOOLEAN NOT NULL DEFAULT true,
    "deviceToken" TEXT,
    "pairingCode" TEXT,
    "pairingCodeExpiresAt" TIMESTAMP(3),
    "isPaired" BOOLEAN NOT NULL DEFAULT false,
    "staticIp" TEXT,
    "enforceStaticIp" BOOLEAN NOT NULL DEFAULT false,
    "lastKnownIp" TEXT,
    "deviceInfo" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "displayMode" TEXT NOT NULL DEFAULT 'tiled',
    "transitionTimes" JSONB,
    "orderBehavior" JSONB,
    "orderTypeFilters" JSONB,

    CONSTRAINT "KDSScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KDSScreenStation" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kdsScreenId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "KDSScreenStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KDSScreenLink" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceScreenId" TEXT NOT NULL,
    "targetScreenId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL DEFAULT 'send_to_next',
    "bumpAction" TEXT NOT NULL DEFAULT 'bump',
    "resetStrikethroughsOnSend" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KDSScreenLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TerminalCategory" NOT NULL DEFAULT 'FIXED_STATION',
    "defaultMode" "HandheldMode",
    "staticIp" TEXT,
    "deviceToken" TEXT,
    "pairingCode" TEXT,
    "pairingCodeExpiresAt" TIMESTAMP(3),
    "isPaired" BOOLEAN NOT NULL DEFAULT false,
    "deviceFingerprint" TEXT,
    "lastKnownIp" TEXT,
    "deviceInfo" JSONB,
    "platform" "TerminalPlatform" NOT NULL DEFAULT 'BROWSER',
    "appVersion" TEXT,
    "osVersion" TEXT,
    "pushToken" TEXT,
    "receiptPrinterId" TEXT,
    "kitchenPrinterId" TEXT,
    "barPrinterId" TEXT,
    "roleSkipRules" JSONB,
    "forceAllPrints" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "backupTerminalId" TEXT,
    "failoverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failoverTimeout" INTEGER NOT NULL DEFAULT 45000,
    "paymentReaderId" TEXT,
    "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'SIMULATED',
    "backupPaymentReaderId" TEXT,
    "readerFailoverTimeout" INTEGER NOT NULL DEFAULT 10000,
    "scaleId" TEXT,
    "cfdTerminalId" TEXT,
    "cfdIpAddress" TEXT,
    "cfdConnectionMode" TEXT DEFAULT 'usb',
    "cfdSerialNumber" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfdSettings" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tipMode" TEXT NOT NULL DEFAULT 'pre_tap',
    "tipStyle" TEXT NOT NULL DEFAULT 'percent',
    "tipOptions" TEXT NOT NULL DEFAULT '18,20,22,25',
    "tipShowNoTip" BOOLEAN NOT NULL DEFAULT true,
    "signatureEnabled" BOOLEAN NOT NULL DEFAULT true,
    "signatureThresholdCents" INTEGER NOT NULL DEFAULT 2500,
    "receiptEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "receiptSmsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "receiptPrintEnabled" BOOLEAN NOT NULL DEFAULT true,
    "receiptTimeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "tabMode" TEXT NOT NULL DEFAULT 'token_only',
    "tabPreAuthAmountCents" INTEGER NOT NULL DEFAULT 100,
    "idlePromoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "idleWelcomeText" TEXT DEFAULT 'Welcome!',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CfdSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scale" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scaleType" TEXT NOT NULL DEFAULT 'CAS_PD_II',
    "portPath" TEXT,
    "baudRate" INTEGER NOT NULL DEFAULT 9600,
    "dataBits" INTEGER NOT NULL DEFAULT 7,
    "parity" TEXT NOT NULL DEFAULT 'even',
    "stopBits" INTEGER NOT NULL DEFAULT 1,
    "connectionType" TEXT NOT NULL DEFAULT 'serial',
    "networkHost" TEXT,
    "networkPort" INTEGER,
    "maxCapacity" DECIMAL(10,4),
    "weightUnit" TEXT NOT NULL DEFAULT 'lb',
    "precision" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Scale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReader" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL DEFAULT '127.0.0.1',
    "port" INTEGER NOT NULL DEFAULT 8080,
    "connectionType" TEXT NOT NULL DEFAULT 'IP',
    "merchantId" TEXT,
    "terminalId" TEXT,
    "lastSequenceNo" TEXT NOT NULL DEFAULT '0010010010',
    "deviceType" TEXT NOT NULL DEFAULT 'PAX',
    "communicationMode" TEXT NOT NULL DEFAULT 'local',
    "cloudUsername" TEXT,
    "cloudPassword" TEXT,
    "verificationType" TEXT NOT NULL DEFAULT 'SERIAL_HANDSHAKE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "firmwareVersion" TEXT,
    "avgResponseTime" INTEGER,
    "successRate" DECIMAL(6,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "leaseTerminalId" TEXT,
    "leaseSessionId" TEXT,
    "leaseVersion" INTEGER NOT NULL DEFAULT 0,
    "leasedUntil" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastDetectionFingerprint" TEXT,
    "lastDetectionAt" TIMESTAMP(3),
    "readerState" TEXT NOT NULL DEFAULT 'idle',

    CONSTRAINT "PaymentReader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReaderLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "readerId" TEXT NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "tranType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReaderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT,
    "ruleLevel" "PrintRuleLevel" NOT NULL,
    "categoryId" TEXT,
    "menuItemId" TEXT,
    "modifierId" TEXT,
    "printerId" TEXT,
    "kdsScreenId" TEXT,
    "additionalPrinterIds" JSONB,
    "additionalKDSIds" JSONB,
    "printCopies" INTEGER NOT NULL DEFAULT 1,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "printOnSend" BOOLEAN NOT NULL DEFAULT true,
    "showOnKDS" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PrintRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintRoute" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "routeType" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "categoryIds" JSONB,
    "itemTypes" JSONB,
    "stationId" TEXT,
    "printerId" TEXT,
    "backupPrinterId" TEXT,
    "failoverTimeout" INTEGER DEFAULT 5000,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PrintRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "orderId" TEXT,
    "printerId" TEXT NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "maxSections" INTEGER NOT NULL DEFAULT 8,
    "defaultSections" INTEGER NOT NULL DEFAULT 2,
    "sectionOptions" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 6, 8]',
    "pricingMode" TEXT NOT NULL DEFAULT 'fractional',
    "hybridPricing" JSONB,
    "freeToppingsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "freeToppingsCount" INTEGER NOT NULL DEFAULT 0,
    "freeToppingsMode" TEXT NOT NULL DEFAULT 'per_pizza',
    "extraToppingPrice" DECIMAL(10,2),
    "showVisualBuilder" BOOLEAN NOT NULL DEFAULT true,
    "showToppingList" BOOLEAN NOT NULL DEFAULT true,
    "defaultToListView" BOOLEAN NOT NULL DEFAULT false,
    "builderMode" TEXT NOT NULL DEFAULT 'both',
    "defaultBuilderMode" TEXT NOT NULL DEFAULT 'quick',
    "allowModeSwitch" BOOLEAN NOT NULL DEFAULT true,
    "printerIds" JSONB,
    "printSettings" JSONB,
    "allowCondimentSections" BOOLEAN NOT NULL DEFAULT false,
    "condimentDivisionMax" INTEGER NOT NULL DEFAULT 1,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaSize" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "inches" INTEGER,
    "slices" INTEGER NOT NULL DEFAULT 8,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "priceMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    "toppingMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    "freeToppings" INTEGER NOT NULL DEFAULT 0,
    "inventoryMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 1.0,
    "ingredientId" TEXT,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(10,4),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaCrust" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ingredientId" TEXT,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(10,4),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaCrust_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaSauce" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allowLight" BOOLEAN NOT NULL DEFAULT true,
    "allowExtra" BOOLEAN NOT NULL DEFAULT true,
    "extraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ingredientId" TEXT,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(10,4),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaSauce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaCheese" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allowLight" BOOLEAN NOT NULL DEFAULT true,
    "allowExtra" BOOLEAN NOT NULL DEFAULT true,
    "extraPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ingredientId" TEXT,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(10,4),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaCheese_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaTopping" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'standard',
    "price" DECIMAL(10,2) NOT NULL,
    "extraPrice" DECIMAL(10,2),
    "color" TEXT,
    "iconUrl" TEXT,
    "ingredientId" TEXT,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(10,4),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaTopping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PizzaSpecialty" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "defaultCrustId" TEXT,
    "defaultSauceId" TEXT,
    "defaultCheeseId" TEXT,
    "sauceAmount" TEXT NOT NULL DEFAULT 'regular',
    "cheeseAmount" TEXT NOT NULL DEFAULT 'regular',
    "toppings" JSONB NOT NULL DEFAULT '[]',
    "allowSizeChange" BOOLEAN NOT NULL DEFAULT true,
    "allowCrustChange" BOOLEAN NOT NULL DEFAULT true,
    "allowSauceChange" BOOLEAN NOT NULL DEFAULT true,
    "allowCheeseChange" BOOLEAN NOT NULL DEFAULT true,
    "allowToppingMods" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PizzaSpecialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemPizza" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "crustId" TEXT NOT NULL,
    "sauceId" TEXT,
    "sauceAmount" TEXT NOT NULL DEFAULT 'regular',
    "cheeseId" TEXT,
    "cheeseAmount" TEXT NOT NULL DEFAULT 'regular',
    "sauceSections" JSONB,
    "cheeseSections" JSONB,
    "toppingsData" JSONB NOT NULL,
    "cookingInstructions" TEXT,
    "cutStyle" TEXT,
    "sizePrice" DECIMAL(10,2) NOT NULL,
    "crustPrice" DECIMAL(10,2) NOT NULL,
    "saucePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cheesePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "toppingsPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "freeToppingsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderItemPizza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "periodType" TEXT NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "totalRegularHours" DECIMAL(10,2),
    "totalOvertimeHours" DECIMAL(10,2),
    "totalWages" DECIMAL(10,2),
    "totalTips" DECIMAL(10,2),
    "totalCommissions" DECIMAL(10,2),
    "totalBankedTips" DECIMAL(10,2),
    "grandTotal" DECIMAL(10,2),
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayStub" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "payrollPeriodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "regularHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "regularPay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "declaredTips" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tipSharesGiven" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tipSharesReceived" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "bankedTipsCollected" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netTips" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "federalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stateTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "socialSecurityTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "medicareTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "localTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deductions" JSONB,
    "netPay" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "checkNumber" TEXT,
    "shiftCount" INTEGER NOT NULL DEFAULT 0,
    "shiftIds" JSONB,
    "timeEntryIds" JSONB,
    "paymentMethod" TEXT,
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "status" "PayStubStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PayStub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledShift" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "roleId" TEXT,
    "sectionId" TEXT,
    "status" "ScheduledShiftStatus" NOT NULL DEFAULT 'scheduled',
    "actualStartTime" TIMESTAMP(3),
    "actualEndTime" TIMESTAMP(3),
    "actualHours" DECIMAL(6,2),
    "originalEmployeeId" TEXT,
    "swappedAt" TIMESTAMP(3),
    "swapApprovedBy" TEXT,
    "notes" TEXT,
    "sevenShiftsShiftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "requestedByEmployeeId" TEXT NOT NULL,
    "requestedToEmployeeId" TEXT,
    "type" "ShiftRequestType" NOT NULL DEFAULT 'swap',
    "status" "ShiftSwapRequestStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "managerNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByEmployeeId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "declineReason" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "payPeriodType" TEXT NOT NULL DEFAULT 'biweekly',
    "payDayOfWeek" INTEGER,
    "payDayOfMonth1" INTEGER,
    "payDayOfMonth2" INTEGER,
    "overtimeThresholdDaily" DECIMAL(10,4) NOT NULL DEFAULT 8,
    "overtimeThresholdWeekly" DECIMAL(10,4) NOT NULL DEFAULT 40,
    "overtimeMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 1.5,
    "doubleTimeThreshold" DECIMAL(10,4),
    "doubleTimeMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 2.0,
    "stateTaxState" TEXT,
    "stateTaxRate" DECIMAL(10,4),
    "localTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "localTaxRate" DECIMAL(10,4),
    "localTaxName" TEXT,
    "socialSecurityRate" DECIMAL(10,4) NOT NULL DEFAULT 6.2,
    "medicareRate" DECIMAL(10,4) NOT NULL DEFAULT 1.45,
    "socialSecurityWageBase" DECIMAL(10,2) NOT NULL DEFAULT 168600,
    "minimumWage" DECIMAL(10,2) NOT NULL DEFAULT 7.25,
    "tippedMinimumWage" DECIMAL(10,2) NOT NULL DEFAULT 2.13,
    "mealBreakThreshold" INTEGER NOT NULL DEFAULT 360,
    "mealBreakDuration" INTEGER NOT NULL DEFAULT 30,
    "restBreakInterval" INTEGER NOT NULL DEFAULT 240,
    "restBreakDuration" INTEGER NOT NULL DEFAULT 10,
    "paidMealBreaks" BOOLEAN NOT NULL DEFAULT false,
    "paidRestBreaks" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrepTrayConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "prepItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" DECIMAL(10,4) NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PrepTrayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPrepCount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DailyPrepCountStatus" NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "DailyPrepCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPrepCountItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dailyCountId" TEXT NOT NULL,
    "prepItemId" TEXT NOT NULL,
    "trayBreakdown" JSONB,
    "totalCounted" DECIMAL(10,4) NOT NULL,
    "expectedQuantity" DECIMAL(10,4),
    "variance" DECIMAL(10,4),
    "variancePercent" DECIMAL(8,4),
    "costPerUnit" DECIMAL(10,4),
    "totalCost" DECIMAL(10,2),
    "notes" TEXT,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "DailyPrepCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPrepCountTransaction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dailyCountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prepItemId" TEXT,
    "inventoryItemId" TEXT,
    "quantityBefore" DECIMAL(10,4) NOT NULL,
    "quantityChange" DECIMAL(10,4) NOT NULL,
    "quantityAfter" DECIMAL(10,4) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(10,2),
    "totalCost" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "DailyPrepCountTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCard" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "readerId" TEXT NOT NULL,
    "recordNo" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "cardholderName" TEXT,
    "authAmount" DECIMAL(10,2) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "tokenFrequency" TEXT,
    "acqRefData" TEXT,
    "processData" TEXT,
    "aid" TEXT,
    "cvm" TEXT,
    "avsResult" TEXT,
    "authCode" TEXT,
    "refNo" TEXT,
    "status" "OrderCardStatus" NOT NULL DEFAULT 'authorized',
    "capturedAmount" DECIMAL(10,2),
    "capturedAt" TIMESTAMP(3),
    "tipAmount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,

    CONSTRAINT "OrderCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalReceipt" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptData" JSONB NOT NULL,
    "signatureData" TEXT,
    "signatureSource" TEXT,
    "archivedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DigitalReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargebackCase" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "cardLast4" TEXT NOT NULL,
    "cardBrand" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "chargebackDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "reasonCode" TEXT,
    "responseDeadline" TIMESTAMP(3),
    "status" "ChargebackStatus" NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "responseNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ChargebackCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardProfile" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "cardholderIdHash" TEXT NOT NULL,
    "cardType" TEXT NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "cardholderName" TEXT,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "CardProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkoutRetry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderCardId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "nextRetryAt" TIMESTAMP(3) NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 10,
    "status" "WalkoutRetryStatus" NOT NULL DEFAULT 'pending',
    "lastRetryAt" TIMESTAMP(3),
    "lastRetryError" TEXT,
    "collectedAt" TIMESTAMP(3),
    "writtenOffAt" TIMESTAMP(3),
    "writtenOffBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "WalkoutRetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BottleServiceTier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#D4AF37',
    "depositAmount" DECIMAL(10,2) NOT NULL,
    "minimumSpend" DECIMAL(10,2) NOT NULL,
    "autoGratuityPercent" DECIMAL(10,4),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "BottleServiceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "severity" "ErrorSeverity" NOT NULL,
    "errorType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "errorCode" TEXT,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "path" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "component" TEXT,
    "orderId" TEXT,
    "tableId" TEXT,
    "paymentId" TEXT,
    "customerId" TEXT,
    "userAgent" TEXT,
    "browserInfo" TEXT,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "queryParams" TEXT,
    "responseTime" INTEGER,
    "status" "ErrorLogStatus" NOT NULL DEFAULT 'NEW',
    "groupId" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstOccurred" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOccurred" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "notes" TEXT,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "alertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "source" TEXT NOT NULL DEFAULT 'server',
    "category" TEXT NOT NULL DEFAULT 'system',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "employeeId" TEXT,
    "deviceId" TEXT,
    "stackTrace" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "status" "HealthCheckStatus" NOT NULL,
    "responseTime" INTEGER,
    "errorMessage" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "HealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerRegistrationToken" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "RegistrationTokenStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByFingerprint" TEXT,
    "usedByServerNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ServerRegistrationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_event_queue" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "cloud_event_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "refundAmount" DECIMAL(10,2) NOT NULL,
    "originalAmount" DECIMAL(10,2) NOT NULL,
    "refundReason" TEXT NOT NULL,
    "notes" TEXT,
    "datacapRecordNo" TEXT,
    "datacapRefNo" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "receiptPrinted" BOOLEAN NOT NULL DEFAULT false,
    "receiptPrintedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "RefundLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemDiscount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "discountRuleId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "percent" DECIMAL(8,4),
    "appliedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderItemDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisteredDevice" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'phone',
    "deviceFingerprint" TEXT,
    "registeredById" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "RegisteredDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileSession" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "MobileSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HardwareCommand" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "targetDeviceId" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultPayload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "HardwareCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceCounter" INTEGER NOT NULL,
    "serverSequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "correlationId" TEXT,
    "deviceCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_snapshots" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'dine_in',
    "tableId" TEXT,
    "tableName" TEXT,
    "tabName" TEXT,
    "tabStatus" TEXT,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "orderNumber" INTEGER NOT NULL DEFAULT 0,
    "displayNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "hasPreAuth" BOOLEAN NOT NULL DEFAULT false,
    "cardLast4" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "tipTotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paidAmountCents" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "hasHeldItems" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "lastEventSequence" INTEGER NOT NULL,
    "customerId" TEXT,
    "source" TEXT,
    "parentOrderId" TEXT,
    "splitIndex" INTEGER,
    "orderTypeId" TEXT,
    "customFields" JSONB,
    "baseSeatCount" INTEGER NOT NULL DEFAULT 0,
    "extraSeatCount" INTEGER NOT NULL DEFAULT 0,
    "seatVersion" INTEGER NOT NULL DEFAULT 0,
    "seatTimestamps" JSONB,
    "tabNickname" TEXT,
    "primaryPaymentMethod" TEXT,
    "commissionTotal" INTEGER NOT NULL DEFAULT 0,
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "openedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "preAuthId" TEXT,
    "preAuthAmount" INTEGER,
    "preAuthLast4" TEXT,
    "preAuthCardBrand" TEXT,
    "preAuthExpiresAt" TIMESTAMP(3),
    "preAuthRecordNo" TEXT,
    "isBottleService" BOOLEAN NOT NULL DEFAULT false,
    "bottleServiceCurrentSpend" INTEGER,
    "isWalkout" BOOLEAN NOT NULL DEFAULT false,
    "walkoutAt" TIMESTAMP(3),
    "walkoutMarkedBy" TEXT,
    "rolledOverAt" TIMESTAMP(3),
    "rolledOverFrom" TEXT,
    "captureDeclinedAt" TIMESTAMP(3),
    "captureRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastCaptureError" TEXT,
    "currentCourse" INTEGER NOT NULL DEFAULT 0,
    "courseMode" TEXT NOT NULL DEFAULT 'off',
    "offlineId" TEXT,
    "offlineLocalId" TEXT,
    "offlineTimestamp" TIMESTAMP(3),
    "offlineTerminalId" TEXT,
    "businessDayDate" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "order_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "modifiersJson" JSONB,
    "specialNotes" TEXT,
    "seatNumber" INTEGER,
    "courseNumber" INTEGER,
    "isHeld" BOOLEAN NOT NULL DEFAULT false,
    "kitchenStatus" TEXT,
    "kitchenSentAt" TIMESTAMP(3),
    "soldByWeight" BOOLEAN NOT NULL DEFAULT false,
    "weight" DOUBLE PRECISION,
    "weightUnit" TEXT,
    "unitPriceCents" INTEGER,
    "grossWeight" DOUBLE PRECISION,
    "tareWeight" DOUBLE PRECISION,
    "status" TEXT DEFAULT 'active',
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "delayMinutes" INTEGER,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "pricingOptionId" TEXT,
    "pricingOptionLabel" TEXT,
    "costAtSaleCents" INTEGER,
    "pourSize" TEXT,
    "pourMultiplier" DOUBLE PRECISION,
    "itemDiscountsJson" JSONB,
    "holdUntil" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "delayStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastResentAt" TIMESTAMP(3),
    "resendNote" TEXT,
    "blockTimeMinutes" INTEGER,
    "blockTimeStartedAt" TIMESTAMP(3),
    "blockTimeExpiresAt" TIMESTAMP(3),
    "courseStatus" TEXT,
    "wasMade" BOOLEAN,
    "modifierTotal" INTEGER NOT NULL DEFAULT 0,
    "itemTotal" INTEGER NOT NULL DEFAULT 0,
    "cardPrice" INTEGER,
    "commissionAmount" INTEGER,
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "addedByEmployeeId" TEXT,
    "categoryType" TEXT,
    "voidReason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "order_item_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBarPreference" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBarPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickBarDefault" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemIds" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickBarDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SevenShiftsDailySalesPush" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "revenueType" TEXT NOT NULL,
    "sevenShiftsReceiptId" TEXT,
    "netTotalCents" INTEGER NOT NULL,
    "tipsAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "pushedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SevenShiftsDailySalesPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PmsChargeAttempt" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "chargeCode" TEXT NOT NULL,
    "status" "PmsAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "operaTransactionId" TEXT,
    "providerRequestId" TEXT,
    "employeeId" TEXT,
    "lastErrorMessage" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PmsChargeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientCostHistory" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "oldCostPerUnit" DECIMAL(10,4) NOT NULL,
    "newCostPerUnit" DECIMAL(10,4) NOT NULL,
    "changePercent" DECIMAL(6,2) NOT NULL,
    "source" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceNumber" TEXT,
    "vendorName" TEXT,
    "recordedById" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngredientCostHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorOrder" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "status" "VendorOrderStatus" NOT NULL DEFAULT 'draft',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDelivery" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "totalEstimated" DECIMAL(10,2),
    "totalActual" DECIMAL(10,2),
    "notes" TEXT,
    "createdById" TEXT,
    "receivedById" TEXT,
    "linkedInvoiceId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorOrderLineItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "estimatedCost" DECIMAL(10,4),
    "actualCost" DECIMAL(10,4),
    "receivedQty" DECIMAL(10,4),
    "notes" TEXT,
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VendorOrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryCountId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "expectedQty" DECIMAL(10,4),
    "countedQty" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "variance" DECIMAL(10,4),
    "unitCost" DECIMAL(10,4) NOT NULL,
    "varianceCost" DECIMAL(10,2),
    "notes" TEXT,
    "countedById" TEXT,
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "bottleProductId" TEXT,
    "quantity" DECIMAL(10,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DECIMAL(10,2) NOT NULL,
    "reason" "WasteReason" NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WasteLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginEdgeProductMapping" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "marginEdgeProductId" TEXT NOT NULL,
    "marginEdgeProductName" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "marginEdgeVendorId" TEXT,
    "marginEdgeVendorName" TEXT,
    "marginEdgeUnit" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarginEdgeProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingDeduction" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "deductionType" "DeductionType" NOT NULL DEFAULT 'order_deduction',
    "status" "DeductionStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeductionRun" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "pendingDeductionId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "success" BOOLEAN,
    "resultSummary" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingLoyaltyEarn" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pointsEarned" INTEGER NOT NULL,
    "loyaltyEarningBase" DECIMAL(10,2) NOT NULL,
    "tierMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1.000,
    "employeeId" TEXT,
    "orderNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingLoyaltyEarn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BergPluMapping" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "mappingScopeKey" TEXT NOT NULL,
    "pluNumber" INTEGER NOT NULL,
    "bottleProductId" TEXT,
    "inventoryItemId" TEXT,
    "menuItemId" TEXT,
    "description" TEXT,
    "pourSizeOzOverride" DECIMAL(6,3),
    "modifierRule" JSONB,
    "trailerRule" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BergPluMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BergDevice" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "terminalId" TEXT,
    "name" TEXT NOT NULL,
    "model" "BergDeviceModel" NOT NULL DEFAULT 'MODEL_1504_704',
    "portName" TEXT NOT NULL,
    "baudRate" INTEGER NOT NULL DEFAULT 9600,
    "isPluBased" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "interfaceMethod" "BergInterfaceMethod" NOT NULL DEFAULT 'DIRECT_RING_UP',
    "pourReleaseMode" "BergPourReleaseMode" NOT NULL DEFAULT 'BEST_EFFORT',
    "timeoutPolicy" "BergTimeoutPolicy" NOT NULL DEFAULT 'ACK_ON_TIMEOUT',
    "autoRingMode" "BergAutoRingMode" NOT NULL DEFAULT 'AUTO_RING',
    "ackTimeoutMs" INTEGER NOT NULL DEFAULT 3000,
    "deductInventoryWhenNoOrder" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "bridgeSecretHash" TEXT,
    "bridgeSecretEncrypted" TEXT,
    "bridgeSecretKeyVersion" INTEGER DEFAULT 1,
    "autoRingOnlyWhenSingleOpenOrder" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BergDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BergDispenseEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "pluMappingId" TEXT,
    "pluNumber" INTEGER NOT NULL,
    "rawPacket" TEXT NOT NULL,
    "modifierBytes" TEXT,
    "trailerBytes" TEXT,
    "parseStatus" "BergParseStatus" NOT NULL,
    "lrcReceived" TEXT NOT NULL,
    "lrcCalculated" TEXT NOT NULL,
    "lrcValid" BOOLEAN NOT NULL,
    "status" "BergDispenseStatus" NOT NULL,
    "unmatchedType" TEXT,
    "pourSizeOz" DECIMAL(6,3),
    "pourCost" DECIMAL(10,2),
    "orderId" TEXT,
    "orderItemId" TEXT,
    "employeeId" TEXT,
    "terminalId" TEXT,
    "ackLatencyMs" INTEGER,
    "ackTimeoutMs" INTEGER NOT NULL,
    "errorReason" TEXT,
    "businessDate" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "variantKey" TEXT,
    "variantLabel" TEXT,
    "resolutionStatus" "BergResolutionStatus" NOT NULL DEFAULT 'NONE',
    "postProcessStatus" "BergPostProcessStatus" NOT NULL DEFAULT 'PENDING',
    "postProcessError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BergDispenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemBarcode" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "label" TEXT,
    "packSize" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(10,2),
    "menuItemId" TEXT,
    "inventoryItemId" TEXT,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ItemBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stationId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeCheckpoint" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL,
    "lastFulfillmentAt" TIMESTAMP(3),
    "fulfillmentLag" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BridgeCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutageQueueEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "operation" "OutageOperation" NOT NULL,
    "payload" JSONB NOT NULL,
    "localSeq" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutageQueueStatus" NOT NULL DEFAULT 'PENDING',
    "outageId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "replayedAt" TIMESTAMP(3),

    CONSTRAINT "OutageQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationBlock" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "blockDate" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "reducedCapacityPercent" INTEGER,
    "blockedTableIds" JSONB NOT NULL DEFAULT '[]',
    "blockedSectionIds" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT,
    "syncedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationTable" (
    "reservationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationTable_pkey" PRIMARY KEY ("reservationId","tableId")
);

-- CreateTable
CREATE TABLE "ReservationEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reservationId" TEXT,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationIdempotencyKey" (
    "key" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'booking',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationIdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ReservationDepositToken" (
    "token" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationDepositToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "ReservationDeposit" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'deposit',
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "cardLast4" TEXT,
    "cardBrand" TEXT,
    "datacapRecordNo" TEXT,
    "datacapRefNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "refundedAmount" DECIMAL(10,2),
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "employeeId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePermissionOverride" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "setBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_gwi_migrations" (
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_gwi_migrations_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "SyncWatermark" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "lastAcknowledgedDownstreamAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAcknowledgedUpstreamAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncWatermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "localVersion" TEXT NOT NULL,
    "cloudVersion" TEXT NOT NULL,
    "localData" JSONB NOT NULL DEFAULT '{}',
    "cloudData" JSONB NOT NULL DEFAULT '{}',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_gwi_sync_state" (
    "table_name" TEXT NOT NULL,
    "high_water_mark" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_gwi_sync_state_pkey" PRIMARY KEY ("table_name")
);

-- CreateTable
CREATE TABLE "SocketEventLog" (
    "id" BIGSERIAL NOT NULL,
    "locationId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "room" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "flushed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocketEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellularEvent" (
    "id" BIGSERIAL NOT NULL,
    "locationId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CellularEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Loyalty Program',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerDollar" INTEGER NOT NULL DEFAULT 1,
    "pointValueCents" INTEGER NOT NULL DEFAULT 1,
    "minimumRedeemPoints" INTEGER NOT NULL DEFAULT 100,
    "roundingMode" TEXT NOT NULL DEFAULT 'floor',
    "excludedCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedItemTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minimumPoints" INTEGER NOT NULL DEFAULT 0,
    "pointsMultiplier" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
    "perks" JSONB NOT NULL DEFAULT '{}',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastMutatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL DEFAULT 0,
    "balanceAfter" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "employeeId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardDetection" (
    "id" TEXT NOT NULL,
    "detectionId" TEXT NOT NULL,
    "readerId" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordNo" TEXT,
    "cardType" TEXT,
    "cardLast4" TEXT,
    "cardholderName" TEXT,
    "entryMethod" TEXT,
    "walletType" TEXT,
    "matchKind" TEXT NOT NULL,
    "matchedOrderId" TEXT,
    "decisionExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actionTaken" TEXT,
    "actionResult" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedByTerminalId" TEXT,
    "leaseVersion" INTEGER,
    "suppressedReason" TEXT,
    "errorCode" TEXT,
    "promptShownAt" TIMESTAMP(3),
    "promptDismissedAt" TIMESTAMP(3),
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardDetection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentAttempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "terminalResult" TEXT,
    "dispatchOrigin" TEXT NOT NULL,
    "businessStage" TEXT NOT NULL,
    "executionStage" TEXT NOT NULL,
    "routingRuleId" TEXT,
    "providerId" TEXT NOT NULL,
    "fallbackProviderId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executionZone" TEXT NOT NULL DEFAULT 'any',
    "claimedByWorkerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "processingTimeoutAt" TIMESTAMP(3),
    "contextSnapshot" JSONB NOT NULL,
    "messageTemplate" TEXT,
    "messageRendered" TEXT,
    "policySnapshot" JSONB NOT NULL,
    "ruleExplainSnapshot" JSONB,
    "subjectVersion" INTEGER NOT NULL,
    "isProbe" BOOLEAN NOT NULL DEFAULT false,
    "sourceSystem" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceEventVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "parentJobId" TEXT,
    "notificationEngine" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "messageRendered" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "result" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "rawResponse" TEXT,
    "providerMessageId" TEXT,
    "providerStatusCode" TEXT,
    "deliveryConfidence" TEXT,
    "errorCode" TEXT,
    "normalizedError" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isRetry" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationProvider" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "executionZone" TEXT NOT NULL DEFAULT 'any',
    "config" JSONB NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationResult" TEXT,
    "capabilities" JSONB NOT NULL,
    "healthStatus" TEXT NOT NULL DEFAULT 'healthy',
    "lastHealthCheckAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "circuitBreakerOpenUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDevice" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "deviceNumber" TEXT NOT NULL,
    "humanLabel" TEXT,
    "deviceType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedToSubjectType" TEXT,
    "assignedToSubjectId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "batteryLevel" INTEGER,
    "lastSeenAt" TIMESTAMP(3),
    "lastSignalState" TEXT,
    "capcode" TEXT,
    "firmwareVersion" TEXT,
    "dockId" TEXT,
    "dockSlot" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "employeeId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTargetAssignment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "providerId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdByEmployeeId" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTargetAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRoutingRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "messageTemplateId" TEXT,
    "condFulfillmentMode" TEXT,
    "condHasPager" BOOLEAN,
    "condHasPhone" BOOLEAN,
    "condMinPartySize" INTEGER,
    "condOrderTypes" TEXT[],
    "condDuringBusinessHours" BOOLEAN,
    "retryMaxAttempts" INTEGER NOT NULL DEFAULT 2,
    "retryDelayMs" INTEGER NOT NULL DEFAULT 2000,
    "retryBackoffMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "retryOnTimeout" BOOLEAN NOT NULL DEFAULT false,
    "fallbackProviderId" TEXT,
    "escalateToStaff" BOOLEAN NOT NULL DEFAULT false,
    "alsoEmitDisplayProjection" BOOLEAN NOT NULL DEFAULT false,
    "stopProcessingAfterMatch" BOOLEAN NOT NULL DEFAULT false,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 0,
    "allowManualOverride" BOOLEAN NOT NULL DEFAULT true,
    "criticalityClass" TEXT NOT NULL DEFAULT 'standard',
    "effectiveStartAt" TIMESTAMP(3),
    "effectiveEndAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "maxLength" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "requiredVariables" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrder" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT,
    "employeeId" TEXT,
    "driverId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 45,
    "scheduledFor" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "zoneId" TEXT,
    "runId" TEXT,
    "runSequence" INTEGER,
    "trackingToken" TEXT,
    "addressId" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "geocodePrecision" TEXT,
    "geocodeConfidence" DECIMAL(3,2),
    "smsNotificationsSent" JSONB DEFAULT '[]',
    "confirmedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "enRouteAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "promisedAt" TIMESTAMP(3),
    "quotedMinutes" INTEGER,
    "serviceRecoveryReason" TEXT,
    "exceptionId" TEXT,
    "addressSnapshotJson" JSONB,
    "proofMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'received',
    "ignoredReason" TEXT,
    "relatedGiftCardId" TEXT,
    "providerPageId" TEXT,
    "providerMerchantId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ExternalWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemShare" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceOrderId" TEXT NOT NULL,
    "targetOrderId" TEXT NOT NULL,
    "shareIndex" INTEGER NOT NULL,
    "totalShares" INTEGER NOT NULL,
    "allocatedAmount" DECIMAL(10,2) NOT NULL,
    "allocatedTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allocatedDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByPaymentId" TEXT,
    "splitResolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ItemShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationRetryEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationRetryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeripheralSnapshot" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "lastMutatedBy" TEXT,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PeripheralSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "Customer_locationId_idx" ON "Customer"("locationId");

-- CreateIndex
CREATE INDEX "Customer_lastName_firstName_idx" ON "Customer"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Customer_locationId_isActive_deletedAt_idx" ON "Customer"("locationId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Customer_loyaltyProgramId_idx" ON "Customer"("loyaltyProgramId");

-- CreateIndex
CREATE INDEX "Customer_loyaltyTierId_idx" ON "Customer"("loyaltyTierId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_locationId_email_key" ON "Customer"("locationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_locationId_phone_key" ON "Customer"("locationId", "phone");

-- CreateIndex
CREATE INDEX "Role_locationId_idx" ON "Role"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_locationId_name_key" ON "Role"("locationId", "name");

-- CreateIndex
CREATE INDEX "Employee_locationId_idx" ON "Employee"("locationId");

-- CreateIndex
CREATE INDEX "Employee_roleId_idx" ON "Employee"("roleId");

-- CreateIndex
CREATE INDEX "Employee_locationId_isActive_idx" ON "Employee"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "Employee_locationId_isActive_deletedAt_idx" ON "Employee"("locationId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Employee_locationId_updatedAt_idx" ON "Employee"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_locationId_pin_key" ON "Employee"("locationId", "pin");

-- CreateIndex
CREATE INDEX "EmployeeRole_locationId_idx" ON "EmployeeRole"("locationId");

-- CreateIndex
CREATE INDEX "EmployeeRole_employeeId_idx" ON "EmployeeRole"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeRole_roleId_idx" ON "EmployeeRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRole_employeeId_roleId_key" ON "EmployeeRole"("employeeId", "roleId");

-- CreateIndex
CREATE INDEX "TimeClockEntry_locationId_idx" ON "TimeClockEntry"("locationId");

-- CreateIndex
CREATE INDEX "TimeClockEntry_employeeId_idx" ON "TimeClockEntry"("employeeId");

-- CreateIndex
CREATE INDEX "TimeClockEntry_clockIn_idx" ON "TimeClockEntry"("clockIn");

-- CreateIndex
CREATE INDEX "TimeClockEntry_locationId_employeeId_clockOut_idx" ON "TimeClockEntry"("locationId", "employeeId", "clockOut");

-- CreateIndex
CREATE INDEX "TimeClockEntry_locationId_clockIn_idx" ON "TimeClockEntry"("locationId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeClockEntry_employeeId_clockOut_idx" ON "TimeClockEntry"("employeeId", "clockOut");

-- CreateIndex
CREATE INDEX "TimeClockEntry_locationId_updatedAt_idx" ON "TimeClockEntry"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Shift_employeeId_idx" ON "Shift"("employeeId");

-- CreateIndex
CREATE INDEX "Shift_startedAt_idx" ON "Shift"("startedAt");

-- CreateIndex
CREATE INDEX "Shift_timeClockEntryId_idx" ON "Shift"("timeClockEntryId");

-- CreateIndex
CREATE INDEX "Shift_drawerId_idx" ON "Shift"("drawerId");

-- CreateIndex
CREATE INDEX "Shift_locationId_status_idx" ON "Shift"("locationId", "status");

-- CreateIndex
CREATE INDEX "Shift_locationId_startedAt_idx" ON "Shift"("locationId", "startedAt");

-- CreateIndex
CREATE INDEX "Shift_locationId_employeeId_status_idx" ON "Shift"("locationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "Shift_locationId_updatedAt_idx" ON "Shift"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Drawer_locationId_idx" ON "Drawer"("locationId");

-- CreateIndex
CREATE INDEX "Drawer_locationId_updatedAt_idx" ON "Drawer"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "PaidInOut_locationId_idx" ON "PaidInOut"("locationId");

-- CreateIndex
CREATE INDEX "PaidInOut_drawerId_idx" ON "PaidInOut"("drawerId");

-- CreateIndex
CREATE INDEX "PaidInOut_createdAt_idx" ON "PaidInOut"("createdAt");

-- CreateIndex
CREATE INDEX "PrepStation_locationId_idx" ON "PrepStation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepStation_locationId_name_key" ON "PrepStation"("locationId", "name");

-- CreateIndex
CREATE INDEX "CourseConfig_locationId_idx" ON "CourseConfig"("locationId");

-- CreateIndex
CREATE INDEX "CourseConfig_sortOrder_idx" ON "CourseConfig"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CourseConfig_locationId_courseNumber_key" ON "CourseConfig"("locationId", "courseNumber");

-- CreateIndex
CREATE INDEX "Category_prepStationId_idx" ON "Category"("prepStationId");

-- CreateIndex
CREATE INDEX "Category_sortOrder_idx" ON "Category"("sortOrder");

-- CreateIndex
CREATE INDEX "Category_categoryType_idx" ON "Category"("categoryType");

-- CreateIndex
CREATE INDEX "Category_locationId_isActive_deletedAt_idx" ON "Category"("locationId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Category_locationId_sortOrder_idx" ON "Category"("locationId", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_locationId_updatedAt_idx" ON "Category"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_locationId_name_key" ON "Category"("locationId", "name");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_prepStationId_idx" ON "MenuItem"("prepStationId");

-- CreateIndex
CREATE INDEX "MenuItem_isActive_showOnPOS_idx" ON "MenuItem"("isActive", "showOnPOS");

-- CreateIndex
CREATE INDEX "MenuItem_locationId_isActive_deletedAt_idx" ON "MenuItem"("locationId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "MenuItem_locationId_isActive_idx" ON "MenuItem"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "MenuItem_locationId_categoryId_idx" ON "MenuItem"("locationId", "categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_locationId_updatedAt_idx" ON "MenuItem"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_locationId_sku_key" ON "MenuItem"("locationId", "sku");

-- CreateIndex
CREATE INDEX "ModifierGroup_locationId_idx" ON "ModifierGroup"("locationId");

-- CreateIndex
CREATE INDEX "ModifierGroup_menuItemId_idx" ON "ModifierGroup"("menuItemId");

-- CreateIndex
CREATE INDEX "Modifier_locationId_idx" ON "Modifier"("locationId");

-- CreateIndex
CREATE INDEX "Modifier_modifierGroupId_idx" ON "Modifier"("modifierGroupId");

-- CreateIndex
CREATE INDEX "Modifier_childModifierGroupId_idx" ON "Modifier"("childModifierGroupId");

-- CreateIndex
CREATE INDEX "Modifier_linkedBottleProductId_idx" ON "Modifier"("linkedBottleProductId");

-- CreateIndex
CREATE INDEX "Modifier_linkedMenuItemId_idx" ON "Modifier"("linkedMenuItemId");

-- CreateIndex
CREATE INDEX "Modifier_locationId_linkedMenuItemId_idx" ON "Modifier"("locationId", "linkedMenuItemId");

-- CreateIndex
CREATE INDEX "Modifier_locationId_updatedAt_idx" ON "Modifier"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Modifier_modifierGroupId_name_key" ON "Modifier"("modifierGroupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ComboTemplate_menuItemId_key" ON "ComboTemplate"("menuItemId");

-- CreateIndex
CREATE INDEX "ComboTemplate_locationId_idx" ON "ComboTemplate"("locationId");

-- CreateIndex
CREATE INDEX "ComboComponent_locationId_idx" ON "ComboComponent"("locationId");

-- CreateIndex
CREATE INDEX "ComboComponent_modifierGroupId_idx" ON "ComboComponent"("modifierGroupId");

-- CreateIndex
CREATE INDEX "ComboComponent_menuItemId_idx" ON "ComboComponent"("menuItemId");

-- CreateIndex
CREATE INDEX "ComboComponentOption_locationId_idx" ON "ComboComponentOption"("locationId");

-- CreateIndex
CREATE INDEX "ComboComponentOption_menuItemId_idx" ON "ComboComponentOption"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponentOption_comboComponentId_menuItemId_key" ON "ComboComponentOption"("comboComponentId", "menuItemId");

-- CreateIndex
CREATE INDEX "OrderItemComboSelection_orderItemId_idx" ON "OrderItemComboSelection"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemComboSelection_locationId_idx" ON "OrderItemComboSelection"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemComboSelection_menuItemId_idx" ON "OrderItemComboSelection"("menuItemId");

-- CreateIndex
CREATE INDEX "OrderItemComboSelection_orderItemId_sortIndex_idx" ON "OrderItemComboSelection"("orderItemId", "sortIndex");

-- CreateIndex
CREATE INDEX "OrderItemComboSelection_comboComponentId_idx" ON "OrderItemComboSelection"("comboComponentId");

-- CreateIndex
CREATE INDEX "Section_locationId_idx" ON "Section"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_locationId_name_key" ON "Section"("locationId", "name");

-- CreateIndex
CREATE INDEX "SectionAssignment_locationId_idx" ON "SectionAssignment"("locationId");

-- CreateIndex
CREATE INDEX "SectionAssignment_sectionId_idx" ON "SectionAssignment"("sectionId");

-- CreateIndex
CREATE INDEX "SectionAssignment_employeeId_idx" ON "SectionAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "SectionAssignment_sectionId_unassignedAt_deletedAt_idx" ON "SectionAssignment"("sectionId", "unassignedAt", "deletedAt");

-- CreateIndex
CREATE INDEX "Table_sectionId_idx" ON "Table"("sectionId");

-- CreateIndex
CREATE INDEX "Table_locationId_status_idx" ON "Table"("locationId", "status");

-- CreateIndex
CREATE INDEX "Table_locationId_isActive_deletedAt_idx" ON "Table"("locationId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Table_locationId_sectionId_idx" ON "Table"("locationId", "sectionId");

-- CreateIndex
CREATE INDEX "Table_locationId_updatedAt_idx" ON "Table"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Table_locationId_name_key" ON "Table"("locationId", "name");

-- CreateIndex
CREATE INDEX "FloorPlanElement_locationId_idx" ON "FloorPlanElement"("locationId");

-- CreateIndex
CREATE INDEX "FloorPlanElement_sectionId_idx" ON "FloorPlanElement"("sectionId");

-- CreateIndex
CREATE INDEX "FloorPlanElement_linkedMenuItemId_idx" ON "FloorPlanElement"("linkedMenuItemId");

-- CreateIndex
CREATE INDEX "FloorPlanElement_status_idx" ON "FloorPlanElement"("status");

-- CreateIndex
CREATE INDEX "FloorPlanElement_locationId_elementType_isVisible_idx" ON "FloorPlanElement"("locationId", "elementType", "isVisible");

-- CreateIndex
CREATE INDEX "EntertainmentWaitlist_locationId_idx" ON "EntertainmentWaitlist"("locationId");

-- CreateIndex
CREATE INDEX "EntertainmentWaitlist_elementId_idx" ON "EntertainmentWaitlist"("elementId");

-- CreateIndex
CREATE INDEX "EntertainmentWaitlist_visualType_idx" ON "EntertainmentWaitlist"("visualType");

-- CreateIndex
CREATE INDEX "EntertainmentWaitlist_status_idx" ON "EntertainmentWaitlist"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EntertainmentSession_orderItemId_key" ON "EntertainmentSession"("orderItemId");

-- CreateIndex
CREATE INDEX "EntertainmentSession_locationId_idx" ON "EntertainmentSession"("locationId");

-- CreateIndex
CREATE INDEX "EntertainmentSession_orderId_idx" ON "EntertainmentSession"("orderId");

-- CreateIndex
CREATE INDEX "EntertainmentSession_resourceId_idx" ON "EntertainmentSession"("resourceId");

-- CreateIndex
CREATE INDEX "EntertainmentSession_sessionState_idx" ON "EntertainmentSession"("sessionState");

-- CreateIndex
CREATE INDEX "EntertainmentSession_locationId_sessionState_idx" ON "EntertainmentSession"("locationId", "sessionState");

-- CreateIndex
CREATE INDEX "EntertainmentSessionEvent_sessionId_idx" ON "EntertainmentSessionEvent"("sessionId");

-- CreateIndex
CREATE INDEX "EntertainmentSessionEvent_locationId_createdAt_idx" ON "EntertainmentSessionEvent"("locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntertainmentSessionEvent_sessionId_idempotencyKey_key" ON "EntertainmentSessionEvent"("sessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EntertainmentResource_activeSessionId_key" ON "EntertainmentResource"("activeSessionId");

-- CreateIndex
CREATE INDEX "EntertainmentResource_locationId_idx" ON "EntertainmentResource"("locationId");

-- CreateIndex
CREATE INDEX "EntertainmentResource_linkedMenuItemId_idx" ON "EntertainmentResource"("linkedMenuItemId");

-- CreateIndex
CREATE INDEX "EntertainmentResource_linkedFloorPlanElementId_idx" ON "EntertainmentResource"("linkedFloorPlanElementId");

-- CreateIndex
CREATE INDEX "EntertainmentResource_status_idx" ON "EntertainmentResource"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EntertainmentResource_locationId_name_key" ON "EntertainmentResource"("locationId", "name");

-- CreateIndex
CREATE INDEX "OrderType_locationId_idx" ON "OrderType"("locationId");

-- CreateIndex
CREATE INDEX "OrderType_sortOrder_idx" ON "OrderType"("sortOrder");

-- CreateIndex
CREATE INDEX "OrderType_locationId_updatedAt_idx" ON "OrderType"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderType_locationId_slug_key" ON "OrderType"("locationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Order_offlineId_key" ON "Order"("offlineId");

-- CreateIndex
CREATE INDEX "Order_employeeId_idx" ON "Order"("employeeId");

-- CreateIndex
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_openedAt_idx" ON "Order"("openedAt");

-- CreateIndex
CREATE INDEX "Order_orderType_idx" ON "Order"("orderType");

-- CreateIndex
CREATE INDEX "Order_orderTypeId_idx" ON "Order"("orderTypeId");

-- CreateIndex
CREATE INDEX "Order_parentOrderId_idx" ON "Order"("parentOrderId");

-- CreateIndex
CREATE INDEX "Order_offlineId_idx" ON "Order"("offlineId");

-- CreateIndex
CREATE INDEX "Order_locationId_status_idx" ON "Order"("locationId", "status");

-- CreateIndex
CREATE INDEX "Order_locationId_status_createdAt_idx" ON "Order"("locationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_locationId_createdAt_idx" ON "Order"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tableId_status_deletedAt_idx" ON "Order"("tableId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "Order_locationId_status_openedAt_idx" ON "Order"("locationId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "Order_locationId_tabStatus_idx" ON "Order"("locationId", "tabStatus");

-- CreateIndex
CREATE INDEX "Order_locationId_status_closedAt_idx" ON "Order"("locationId", "status", "closedAt");

-- CreateIndex
CREATE INDEX "Order_locationId_orderType_status_idx" ON "Order"("locationId", "orderType", "status");

-- CreateIndex
CREATE INDEX "Order_locationId_paidAt_idx" ON "Order"("locationId", "paidAt");

-- CreateIndex
CREATE INDEX "Order_locationId_createdAt_status_idx" ON "Order"("locationId", "createdAt", "status");

-- CreateIndex
CREATE INDEX "Order_locationId_businessDayDate_idx" ON "Order"("locationId", "businessDayDate");

-- CreateIndex
CREATE INDEX "Order_locationId_status_businessDayDate_idx" ON "Order"("locationId", "status", "businessDayDate");

-- CreateIndex
CREATE INDEX "Order_claimedByEmployeeId_claimedAt_idx" ON "Order"("claimedByEmployeeId", "claimedAt");

-- CreateIndex
CREATE INDEX "Order_id_version_idx" ON "Order"("id", "version");

-- CreateIndex
CREATE INDEX "Order_splitFamilyRootId_idx" ON "Order"("splitFamilyRootId");

-- CreateIndex
CREATE INDEX "Order_splitResolution_idx" ON "Order"("splitResolution");

-- CreateIndex
CREATE INDEX "Order_locationId_updatedAt_idx" ON "Order"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Order_locationId_status_deletedAt_idx" ON "Order"("locationId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "OrderItem_locationId_idx" ON "OrderItem"("locationId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_menuItemId_idx" ON "OrderItem"("menuItemId");

-- CreateIndex
CREATE INDEX "OrderItem_kitchenStatus_idx" ON "OrderItem"("kitchenStatus");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_kitchenStatus_idx" ON "OrderItem"("orderId", "kitchenStatus");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_status_idx" ON "OrderItem"("orderId", "status");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_status_deletedAt_idx" ON "OrderItem"("orderId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "OrderItem_locationId_status_kitchenStatus_idx" ON "OrderItem"("locationId", "status", "kitchenStatus");

-- CreateIndex
CREATE INDEX "OrderItem_menuItemId_createdAt_idx" ON "OrderItem"("menuItemId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_pricingOptionId_idx" ON "OrderItem"("pricingOptionId");

-- CreateIndex
CREATE INDEX "OrderItem_menuItemId_pricingOptionId_idx" ON "OrderItem"("menuItemId", "pricingOptionId");

-- CreateIndex
CREATE INDEX "OrderItem_locationId_status_updatedAt_idx" ON "OrderItem"("locationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderItem_kdsForwardedToScreenId_kdsFinalCompleted_idx" ON "OrderItem"("kdsForwardedToScreenId", "kdsFinalCompleted");

-- CreateIndex
CREATE INDEX "OrderItem_locationId_orderId_idx" ON "OrderItem"("locationId", "orderId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_locationId_idx" ON "OrderItemModifier"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_orderItemId_idx" ON "OrderItemModifier"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_spiritTier_idx" ON "OrderItemModifier"("spiritTier");

-- CreateIndex
CREATE INDEX "OrderItemModifier_linkedMenuItemId_idx" ON "OrderItemModifier"("linkedMenuItemId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_locationId_updatedAt_idx" ON "OrderItemModifier"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_offlineIntentId_key" ON "Payment"("offlineIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_processedAt_idx" ON "Payment"("processedAt");

-- CreateIndex
CREATE INDEX "Payment_employeeId_idx" ON "Payment"("employeeId");

-- CreateIndex
CREATE INDEX "Payment_isOfflineCapture_idx" ON "Payment"("isOfflineCapture");

-- CreateIndex
CREATE INDEX "Payment_safStatus_idx" ON "Payment"("safStatus");

-- CreateIndex
CREATE INDEX "Payment_needsReconciliation_idx" ON "Payment"("needsReconciliation");

-- CreateIndex
CREATE INDEX "Payment_locationId_createdAt_idx" ON "Payment"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_locationId_paymentMethod_createdAt_idx" ON "Payment"("locationId", "paymentMethod", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_locationId_status_createdAt_idx" ON "Payment"("locationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

-- CreateIndex
CREATE INDEX "Payment_drawerId_idx" ON "Payment"("drawerId");

-- CreateIndex
CREATE INDEX "Payment_idempotencyKey_idx" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_offlineIntentId_idx" ON "Payment"("offlineIntentId");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE INDEX "Payment_employeeId_processedAt_idx" ON "Payment"("employeeId", "processedAt");

-- CreateIndex
CREATE INDEX "Payment_locationId_updatedAt_idx" ON "Payment"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Payment_locationId_employeeId_createdAt_idx" ON "Payment"("locationId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_orderId_idx" ON "SyncAuditEntry"("orderId");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_paymentId_idx" ON "SyncAuditEntry"("paymentId");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_terminalId_idx" ON "SyncAuditEntry"("terminalId");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_status_idx" ON "SyncAuditEntry"("status");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_createdAt_idx" ON "SyncAuditEntry"("createdAt");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_idempotencyKey_idx" ON "SyncAuditEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_locationId_idempotencyKey_idx" ON "SyncAuditEntry"("locationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Coupon_locationId_isActive_validUntil_idx" ON "Coupon"("locationId", "isActive", "validUntil");

-- CreateIndex
CREATE INDEX "Coupon_locationId_code_idx" ON "Coupon"("locationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_locationId_code_key" ON "Coupon"("locationId", "code");

-- CreateIndex
CREATE INDEX "CouponRedemption_locationId_idx" ON "CouponRedemption"("locationId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");

-- CreateIndex
CREATE INDEX "CouponRedemption_orderId_idx" ON "CouponRedemption"("orderId");

-- CreateIndex
CREATE INDEX "CouponRedemption_customerId_idx" ON "CouponRedemption"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_manageToken_key" ON "Reservation"("manageToken");

-- CreateIndex
CREATE INDEX "Reservation_reservationDate_idx" ON "Reservation"("reservationDate");

-- CreateIndex
CREATE INDEX "Reservation_status_idx" ON "Reservation"("status");

-- CreateIndex
CREATE INDEX "Reservation_tableId_idx" ON "Reservation"("tableId");

-- CreateIndex
CREATE INDEX "Reservation_customerId_idx" ON "Reservation"("customerId");

-- CreateIndex
CREATE INDEX "Reservation_bottleServiceTierId_idx" ON "Reservation"("bottleServiceTierId");

-- CreateIndex
CREATE INDEX "Reservation_locationId_reservationDate_status_idx" ON "Reservation"("locationId", "reservationDate", "status");

-- CreateIndex
CREATE INDEX "Reservation_source_idx" ON "Reservation"("source");

-- CreateIndex
CREATE INDEX "Reservation_locationId_serviceDate_idx" ON "Reservation"("locationId", "serviceDate");

-- CreateIndex
CREATE INDEX "Reservation_holdExpiresAt_idx" ON "Reservation"("holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_locationId_source_externalId_key" ON "Reservation"("locationId", "source", "externalId");

-- CreateIndex
CREATE INDEX "DiscountRule_locationId_idx" ON "DiscountRule"("locationId");

-- CreateIndex
CREATE INDEX "DiscountRule_isActive_isAutomatic_idx" ON "DiscountRule"("isActive", "isAutomatic");

-- CreateIndex
CREATE INDEX "DiscountRule_locationId_isActive_idx" ON "DiscountRule"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_locationId_name_key" ON "DiscountRule"("locationId", "name");

-- CreateIndex
CREATE INDEX "OrderDiscount_locationId_idx" ON "OrderDiscount"("locationId");

-- CreateIndex
CREATE INDEX "OrderDiscount_orderId_idx" ON "OrderDiscount"("orderId");

-- CreateIndex
CREATE INDEX "OrderDiscount_couponId_idx" ON "OrderDiscount"("couponId");

-- CreateIndex
CREATE INDEX "OrderDiscount_locationId_updatedAt_idx" ON "OrderDiscount"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "VoidLog_locationId_idx" ON "VoidLog"("locationId");

-- CreateIndex
CREATE INDEX "VoidLog_orderId_idx" ON "VoidLog"("orderId");

-- CreateIndex
CREATE INDEX "VoidLog_employeeId_idx" ON "VoidLog"("employeeId");

-- CreateIndex
CREATE INDEX "VoidLog_createdAt_idx" ON "VoidLog"("createdAt");

-- CreateIndex
CREATE INDEX "VoidLog_locationId_createdAt_idx" ON "VoidLog"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "VoidLog_locationId_updatedAt_idx" ON "VoidLog"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "VoidLog_locationId_itemId_createdAt_idx" ON "VoidLog"("locationId", "itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteVoidApproval_approvalToken_key" ON "RemoteVoidApproval"("approvalToken");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_locationId_idx" ON "RemoteVoidApproval"("locationId");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_status_idx" ON "RemoteVoidApproval"("status");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_approvalToken_idx" ON "RemoteVoidApproval"("approvalToken");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_approvalCode_status_idx" ON "RemoteVoidApproval"("approvalCode", "status");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_managerPhone_status_idx" ON "RemoteVoidApproval"("managerPhone", "status");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_managerId_idx" ON "RemoteVoidApproval"("managerId");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_requestedById_idx" ON "RemoteVoidApproval"("requestedById");

-- CreateIndex
CREATE INDEX "RemoteVoidApproval_requestingTerminalId_status_idx" ON "RemoteVoidApproval"("requestingTerminalId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_locationId_idx" ON "AuditLog"("locationId");

-- CreateIndex
CREATE INDEX "AuditLog_employeeId_idx" ON "AuditLog"("employeeId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_locationId_createdAt_idx" ON "AuditLog"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_locationId_action_createdAt_idx" ON "AuditLog"("locationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_locationId_updatedAt_idx" ON "AuditLog"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "TipPool_locationId_idx" ON "TipPool"("locationId");

-- CreateIndex
CREATE INDEX "TipOutRule_locationId_idx" ON "TipOutRule"("locationId");

-- CreateIndex
CREATE INDEX "TipOutRule_fromRoleId_idx" ON "TipOutRule"("fromRoleId");

-- CreateIndex
CREATE INDEX "TipOutRule_toRoleId_idx" ON "TipOutRule"("toRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "TipOutRule_locationId_fromRoleId_toRoleId_key" ON "TipOutRule"("locationId", "fromRoleId", "toRoleId");

-- CreateIndex
CREATE INDEX "TipShare_locationId_idx" ON "TipShare"("locationId");

-- CreateIndex
CREATE INDEX "TipShare_shiftId_idx" ON "TipShare"("shiftId");

-- CreateIndex
CREATE INDEX "TipShare_fromEmployeeId_idx" ON "TipShare"("fromEmployeeId");

-- CreateIndex
CREATE INDEX "TipShare_toEmployeeId_idx" ON "TipShare"("toEmployeeId");

-- CreateIndex
CREATE INDEX "TipShare_status_idx" ON "TipShare"("status");

-- CreateIndex
CREATE INDEX "TipShare_createdAt_idx" ON "TipShare"("createdAt");

-- CreateIndex
CREATE INDEX "TipLedger_employeeId_idx" ON "TipLedger"("employeeId");

-- CreateIndex
CREATE INDEX "TipLedger_locationId_updatedAt_idx" ON "TipLedger"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TipLedger_locationId_employeeId_key" ON "TipLedger"("locationId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "TipLedgerEntry_idempotencyKey_key" ON "TipLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_locationId_idx" ON "TipLedgerEntry"("locationId");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_ledgerId_idx" ON "TipLedgerEntry"("ledgerId");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_employeeId_idx" ON "TipLedgerEntry"("employeeId");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_sourceType_idx" ON "TipLedgerEntry"("sourceType");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_shiftId_idx" ON "TipLedgerEntry"("shiftId");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_createdAt_idx" ON "TipLedgerEntry"("createdAt");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_locationId_sourceType_createdAt_idx" ON "TipLedgerEntry"("locationId", "sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_locationId_employeeId_createdAt_idx" ON "TipLedgerEntry"("locationId", "employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_locationId_type_sourceType_createdAt_idx" ON "TipLedgerEntry"("locationId", "type", "sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_locationId_updatedAt_idx" ON "TipLedgerEntry"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TipTransaction_idempotencyKey_key" ON "TipTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TipTransaction_locationId_idx" ON "TipTransaction"("locationId");

-- CreateIndex
CREATE INDEX "TipTransaction_orderId_idx" ON "TipTransaction"("orderId");

-- CreateIndex
CREATE INDEX "TipTransaction_tipGroupId_idx" ON "TipTransaction"("tipGroupId");

-- CreateIndex
CREATE INDEX "TipTransaction_collectedAt_idx" ON "TipTransaction"("collectedAt");

-- CreateIndex
CREATE INDEX "TipTransaction_locationId_updatedAt_idx" ON "TipTransaction"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "TipGroupTemplate_locationId_idx" ON "TipGroupTemplate"("locationId");

-- CreateIndex
CREATE INDEX "TipGroupTemplate_active_idx" ON "TipGroupTemplate"("active");

-- CreateIndex
CREATE INDEX "TipGroup_locationId_idx" ON "TipGroup"("locationId");

-- CreateIndex
CREATE INDEX "TipGroup_status_idx" ON "TipGroup"("status");

-- CreateIndex
CREATE INDEX "TipGroup_startedAt_idx" ON "TipGroup"("startedAt");

-- CreateIndex
CREATE INDEX "TipGroup_ownerId_idx" ON "TipGroup"("ownerId");

-- CreateIndex
CREATE INDEX "TipGroup_templateId_idx" ON "TipGroup"("templateId");

-- CreateIndex
CREATE INDEX "TipGroupMembership_groupId_idx" ON "TipGroupMembership"("groupId");

-- CreateIndex
CREATE INDEX "TipGroupMembership_employeeId_idx" ON "TipGroupMembership"("employeeId");

-- CreateIndex
CREATE INDEX "TipGroupMembership_status_idx" ON "TipGroupMembership"("status");

-- CreateIndex
CREATE INDEX "TipGroupMembership_locationId_idx" ON "TipGroupMembership"("locationId");

-- CreateIndex
CREATE INDEX "TipGroupMembership_locationId_status_idx" ON "TipGroupMembership"("locationId", "status");

-- CreateIndex
CREATE INDEX "TipGroupSegment_groupId_idx" ON "TipGroupSegment"("groupId");

-- CreateIndex
CREATE INDEX "TipGroupSegment_startedAt_idx" ON "TipGroupSegment"("startedAt");

-- CreateIndex
CREATE INDEX "TipGroupSegment_locationId_idx" ON "TipGroupSegment"("locationId");

-- CreateIndex
CREATE INDEX "TipDebt_locationId_idx" ON "TipDebt"("locationId");

-- CreateIndex
CREATE INDEX "TipDebt_employeeId_idx" ON "TipDebt"("employeeId");

-- CreateIndex
CREATE INDEX "TipDebt_status_idx" ON "TipDebt"("status");

-- CreateIndex
CREATE INDEX "OrderOwnership_orderId_idx" ON "OrderOwnership"("orderId");

-- CreateIndex
CREATE INDEX "OrderOwnership_locationId_idx" ON "OrderOwnership"("locationId");

-- CreateIndex
CREATE INDEX "OrderOwnershipEntry_locationId_idx" ON "OrderOwnershipEntry"("locationId");

-- CreateIndex
CREATE INDEX "OrderOwnershipEntry_orderOwnershipId_idx" ON "OrderOwnershipEntry"("orderOwnershipId");

-- CreateIndex
CREATE INDEX "OrderOwnershipEntry_employeeId_idx" ON "OrderOwnershipEntry"("employeeId");

-- CreateIndex
CREATE INDEX "TipAdjustment_locationId_idx" ON "TipAdjustment"("locationId");

-- CreateIndex
CREATE INDEX "TipAdjustment_createdById_idx" ON "TipAdjustment"("createdById");

-- CreateIndex
CREATE INDEX "TipAdjustment_createdAt_idx" ON "TipAdjustment"("createdAt");

-- CreateIndex
CREATE INDEX "CashTipDeclaration_locationId_idx" ON "CashTipDeclaration"("locationId");

-- CreateIndex
CREATE INDEX "CashTipDeclaration_employeeId_idx" ON "CashTipDeclaration"("employeeId");

-- CreateIndex
CREATE INDEX "CashTipDeclaration_shiftId_idx" ON "CashTipDeclaration"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_cardNumber_key" ON "GiftCard"("cardNumber");

-- CreateIndex
CREATE INDEX "GiftCard_cardNumber_idx" ON "GiftCard"("cardNumber");

-- CreateIndex
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");

-- CreateIndex
CREATE INDEX "GiftCard_locationId_cardNumber_idx" ON "GiftCard"("locationId", "cardNumber");

-- CreateIndex
CREATE INDEX "GiftCard_locationId_status_idx" ON "GiftCard"("locationId", "status");

-- CreateIndex
CREATE INDEX "GiftCard_locationId_status_source_idx" ON "GiftCard"("locationId", "status", "source");

-- CreateIndex
CREATE INDEX "GiftCard_batchId_idx" ON "GiftCard"("batchId");

-- CreateIndex
CREATE INDEX "GiftCard_externalProvider_externalTransactionId_idx" ON "GiftCard"("externalProvider", "externalTransactionId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_locationId_idx" ON "GiftCardTransaction"("locationId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_giftCardId_idx" ON "GiftCardTransaction"("giftCardId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_orderId_idx" ON "GiftCardTransaction"("orderId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_createdAt_idx" ON "GiftCardTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_externalReference_idx" ON "GiftCardTransaction"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardTransaction_giftCardId_idempotencyKey_key" ON "GiftCardTransaction"("giftCardId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "HouseAccount_status_idx" ON "HouseAccount"("status");

-- CreateIndex
CREATE INDEX "HouseAccount_locationId_status_idx" ON "HouseAccount"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HouseAccount_locationId_name_key" ON "HouseAccount"("locationId", "name");

-- CreateIndex
CREATE INDEX "HouseAccountTransaction_locationId_idx" ON "HouseAccountTransaction"("locationId");

-- CreateIndex
CREATE INDEX "HouseAccountTransaction_houseAccountId_idx" ON "HouseAccountTransaction"("houseAccountId");

-- CreateIndex
CREATE INDEX "HouseAccountTransaction_orderId_idx" ON "HouseAccountTransaction"("orderId");

-- CreateIndex
CREATE INDEX "HouseAccountTransaction_createdAt_idx" ON "HouseAccountTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "TimedSession_locationId_idx" ON "TimedSession"("locationId");

-- CreateIndex
CREATE INDEX "TimedSession_menuItemId_idx" ON "TimedSession"("menuItemId");

-- CreateIndex
CREATE INDEX "TimedSession_tableId_idx" ON "TimedSession"("tableId");

-- CreateIndex
CREATE INDEX "TimedSession_orderId_idx" ON "TimedSession"("orderId");

-- CreateIndex
CREATE INDEX "TimedSession_status_idx" ON "TimedSession"("status");

-- CreateIndex
CREATE INDEX "TimedSession_startedAt_idx" ON "TimedSession"("startedAt");

-- CreateIndex
CREATE INDEX "Seat_locationId_idx" ON "Seat"("locationId");

-- CreateIndex
CREATE INDEX "Seat_tableId_idx" ON "Seat"("tableId");

-- CreateIndex
CREATE INDEX "Seat_sourceOrderId_idx" ON "Seat"("sourceOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_tableId_seatNumber_key" ON "Seat"("tableId", "seatNumber");

-- CreateIndex
CREATE INDEX "Event_locationId_idx" ON "Event"("locationId");

-- CreateIndex
CREATE INDEX "Event_eventDate_idx" ON "Event"("eventDate");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "EventPricingTier_locationId_idx" ON "EventPricingTier"("locationId");

-- CreateIndex
CREATE INDEX "EventPricingTier_eventId_idx" ON "EventPricingTier"("eventId");

-- CreateIndex
CREATE INDEX "EventTableConfig_locationId_idx" ON "EventTableConfig"("locationId");

-- CreateIndex
CREATE INDEX "EventTableConfig_eventId_idx" ON "EventTableConfig"("eventId");

-- CreateIndex
CREATE INDEX "EventTableConfig_tableId_idx" ON "EventTableConfig"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTableConfig_eventId_tableId_key" ON "EventTableConfig"("eventId", "tableId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNumber_key" ON "Ticket"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_barcode_key" ON "Ticket"("barcode");

-- CreateIndex
CREATE INDEX "Ticket_locationId_idx" ON "Ticket"("locationId");

-- CreateIndex
CREATE INDEX "Ticket_eventId_idx" ON "Ticket"("eventId");

-- CreateIndex
CREATE INDEX "Ticket_tableId_idx" ON "Ticket"("tableId");

-- CreateIndex
CREATE INDEX "Ticket_seatId_idx" ON "Ticket"("seatId");

-- CreateIndex
CREATE INDEX "Ticket_customerId_idx" ON "Ticket"("customerId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_ticketNumber_idx" ON "Ticket"("ticketNumber");

-- CreateIndex
CREATE INDEX "Ticket_barcode_idx" ON "Ticket"("barcode");

-- CreateIndex
CREATE INDEX "TaxRule_locationId_idx" ON "TaxRule"("locationId");

-- CreateIndex
CREATE INDEX "TaxRule_isActive_idx" ON "TaxRule"("isActive");

-- CreateIndex
CREATE INDEX "TaxRule_locationId_isActive_isInclusive_idx" ON "TaxRule"("locationId", "isActive", "isInclusive");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_locationId_name_key" ON "TaxRule"("locationId", "name");

-- CreateIndex
CREATE INDEX "InventoryTransaction_locationId_idx" ON "InventoryTransaction"("locationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_menuItemId_idx" ON "InventoryTransaction"("menuItemId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_type_idx" ON "InventoryTransaction"("type");

-- CreateIndex
CREATE INDEX "InventoryTransaction_createdAt_idx" ON "InventoryTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "StockAlert_locationId_idx" ON "StockAlert"("locationId");

-- CreateIndex
CREATE INDEX "StockAlert_menuItemId_idx" ON "StockAlert"("menuItemId");

-- CreateIndex
CREATE INDEX "StockAlert_status_idx" ON "StockAlert"("status");

-- CreateIndex
CREATE INDEX "StockAlert_createdAt_idx" ON "StockAlert"("createdAt");

-- CreateIndex
CREATE INDEX "VoidReason_locationId_idx" ON "VoidReason"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "VoidReason_locationId_name_key" ON "VoidReason"("locationId", "name");

-- CreateIndex
CREATE INDEX "CompReason_locationId_idx" ON "CompReason"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompReason_locationId_name_key" ON "CompReason"("locationId", "name");

-- CreateIndex
CREATE INDEX "ReasonAccess_locationId_idx" ON "ReasonAccess"("locationId");

-- CreateIndex
CREATE INDEX "ReasonAccess_locationId_subjectType_subjectId_idx" ON "ReasonAccess"("locationId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ReasonAccess_locationId_subjectType_subjectId_reasonType_re_key" ON "ReasonAccess"("locationId", "subjectType", "subjectId", "reasonType", "reasonId");

-- CreateIndex
CREATE INDEX "StorageLocation_locationId_idx" ON "StorageLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_locationId_name_key" ON "StorageLocation"("locationId", "name");

-- CreateIndex
CREATE INDEX "InventoryItem_locationId_idx" ON "InventoryItem"("locationId");

-- CreateIndex
CREATE INDEX "InventoryItem_department_idx" ON "InventoryItem"("department");

-- CreateIndex
CREATE INDEX "InventoryItem_itemType_idx" ON "InventoryItem"("itemType");

-- CreateIndex
CREATE INDEX "InventoryItem_revenueCenter_idx" ON "InventoryItem"("revenueCenter");

-- CreateIndex
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");

-- CreateIndex
CREATE INDEX "InventoryItem_locationId_category_idx" ON "InventoryItem"("locationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_locationId_name_key" ON "InventoryItem"("locationId", "name");

-- CreateIndex
CREATE INDEX "InventoryItemStorage_locationId_idx" ON "InventoryItemStorage"("locationId");

-- CreateIndex
CREATE INDEX "InventoryItemStorage_storageLocationId_idx" ON "InventoryItemStorage"("storageLocationId");

-- CreateIndex
CREATE INDEX "InventoryItemStorage_inventoryItemId_idx" ON "InventoryItemStorage"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItemStorage_inventoryItemId_storageLocationId_key" ON "InventoryItemStorage"("inventoryItemId", "storageLocationId");

-- CreateIndex
CREATE INDEX "PrepItem_locationId_idx" ON "PrepItem"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepItem_locationId_name_key" ON "PrepItem"("locationId", "name");

-- CreateIndex
CREATE INDEX "PrepItemIngredient_locationId_idx" ON "PrepItemIngredient"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepItemIngredient_prepItemId_inventoryItemId_key" ON "PrepItemIngredient"("prepItemId", "inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemRecipe_menuItemId_key" ON "MenuItemRecipe"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemRecipe_locationId_idx" ON "MenuItemRecipe"("locationId");

-- CreateIndex
CREATE INDEX "MenuItemRecipe_menuItemId_idx" ON "MenuItemRecipe"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemRecipeIngredient_locationId_idx" ON "MenuItemRecipeIngredient"("locationId");

-- CreateIndex
CREATE INDEX "MenuItemRecipeIngredient_recipeId_idx" ON "MenuItemRecipeIngredient"("recipeId");

-- CreateIndex
CREATE INDEX "MenuItemRecipeIngredient_inventoryItemId_idx" ON "MenuItemRecipeIngredient"("inventoryItemId");

-- CreateIndex
CREATE INDEX "MenuItemRecipeIngredient_prepItemId_idx" ON "MenuItemRecipeIngredient"("prepItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierInventoryLink_modifierId_key" ON "ModifierInventoryLink"("modifierId");

-- CreateIndex
CREATE INDEX "ModifierInventoryLink_locationId_idx" ON "ModifierInventoryLink"("locationId");

-- CreateIndex
CREATE INDEX "ModifierInventoryLink_inventoryItemId_idx" ON "ModifierInventoryLink"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ModifierInventoryLink_prepItemId_idx" ON "ModifierInventoryLink"("prepItemId");

-- CreateIndex
CREATE INDEX "PricingOptionGroup_locationId_idx" ON "PricingOptionGroup"("locationId");

-- CreateIndex
CREATE INDEX "PricingOptionGroup_menuItemId_idx" ON "PricingOptionGroup"("menuItemId");

-- CreateIndex
CREATE INDEX "PricingOptionGroup_locationId_menuItemId_deletedAt_idx" ON "PricingOptionGroup"("locationId", "menuItemId", "deletedAt");

-- CreateIndex
CREATE INDEX "PricingOptionGroup_locationId_updatedAt_idx" ON "PricingOptionGroup"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PricingOptionGroup_menuItemId_name_key" ON "PricingOptionGroup"("menuItemId", "name");

-- CreateIndex
CREATE INDEX "PricingOption_locationId_idx" ON "PricingOption"("locationId");

-- CreateIndex
CREATE INDEX "PricingOption_groupId_idx" ON "PricingOption"("groupId");

-- CreateIndex
CREATE INDEX "PricingOption_groupId_deletedAt_idx" ON "PricingOption"("groupId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PricingOption_groupId_label_key" ON "PricingOption"("groupId", "label");

-- CreateIndex
CREATE INDEX "PricingOptionInventoryLink_locationId_idx" ON "PricingOptionInventoryLink"("locationId");

-- CreateIndex
CREATE INDEX "PricingOptionInventoryLink_pricingOptionId_idx" ON "PricingOptionInventoryLink"("pricingOptionId");

-- CreateIndex
CREATE INDEX "PricingOptionInventoryLink_inventoryItemId_idx" ON "PricingOptionInventoryLink"("inventoryItemId");

-- CreateIndex
CREATE INDEX "PricingOptionInventoryLink_prepItemId_idx" ON "PricingOptionInventoryLink"("prepItemId");

-- CreateIndex
CREATE INDEX "PricingOptionInventoryLink_ingredientId_idx" ON "PricingOptionInventoryLink"("ingredientId");

-- CreateIndex
CREATE INDEX "InventoryCount_locationId_idx" ON "InventoryCount"("locationId");

-- CreateIndex
CREATE INDEX "InventoryCount_storageLocationId_idx" ON "InventoryCount"("storageLocationId");

-- CreateIndex
CREATE INDEX "InventoryCount_countDate_idx" ON "InventoryCount"("countDate");

-- CreateIndex
CREATE INDEX "InventoryCount_status_idx" ON "InventoryCount"("status");

-- CreateIndex
CREATE INDEX "InventoryCountItem_locationId_idx" ON "InventoryCountItem"("locationId");

-- CreateIndex
CREATE INDEX "InventoryCountItem_inventoryCountId_idx" ON "InventoryCountItem"("inventoryCountId");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_inventoryItemId_idx" ON "InventoryItemTransaction"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_type_idx" ON "InventoryItemTransaction"("type");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_createdAt_idx" ON "InventoryItemTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_inventoryItemId_createdAt_idx" ON "InventoryItemTransaction"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_locationId_type_createdAt_idx" ON "InventoryItemTransaction"("locationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_locationId_deductionJobId_idx" ON "InventoryItemTransaction"("locationId", "deductionJobId");

-- CreateIndex
CREATE INDEX "Vendor_locationId_idx" ON "Vendor"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_locationId_name_key" ON "Vendor"("locationId", "name");

-- CreateIndex
CREATE INDEX "Invoice_locationId_idx" ON "Invoice"("locationId");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_idx" ON "Invoice"("vendorId");

-- CreateIndex
CREATE INDEX "Invoice_invoiceDate_idx" ON "Invoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_locationId_marginEdgeInvoiceId_key" ON "Invoice"("locationId", "marginEdgeInvoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_locationId_idx" ON "InvoiceLineItem"("locationId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_inventoryItemId_idx" ON "InvoiceLineItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "WasteLogEntry_locationId_idx" ON "WasteLogEntry"("locationId");

-- CreateIndex
CREATE INDEX "WasteLogEntry_wasteDate_idx" ON "WasteLogEntry"("wasteDate");

-- CreateIndex
CREATE INDEX "WasteLogEntry_reason_idx" ON "WasteLogEntry"("reason");

-- CreateIndex
CREATE INDEX "WasteLogEntry_inventoryItemId_idx" ON "WasteLogEntry"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySettings_locationId_key" ON "InventorySettings"("locationId");

-- CreateIndex
CREATE INDEX "Break_locationId_idx" ON "Break"("locationId");

-- CreateIndex
CREATE INDEX "Break_timeClockEntryId_idx" ON "Break"("timeClockEntryId");

-- CreateIndex
CREATE INDEX "Break_employeeId_idx" ON "Break"("employeeId");

-- CreateIndex
CREATE INDEX "Break_startedAt_idx" ON "Break"("startedAt");

-- CreateIndex
CREATE INDEX "SpiritCategory_locationId_idx" ON "SpiritCategory"("locationId");

-- CreateIndex
CREATE INDEX "SpiritCategory_sortOrder_idx" ON "SpiritCategory"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SpiritCategory_locationId_name_key" ON "SpiritCategory"("locationId", "name");

-- CreateIndex
CREATE INDEX "BottleProduct_locationId_idx" ON "BottleProduct"("locationId");

-- CreateIndex
CREATE INDEX "BottleProduct_spiritCategoryId_idx" ON "BottleProduct"("spiritCategoryId");

-- CreateIndex
CREATE INDEX "BottleProduct_tier_idx" ON "BottleProduct"("tier");

-- CreateIndex
CREATE INDEX "BottleProduct_inventoryItemId_idx" ON "BottleProduct"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "BottleProduct_locationId_name_key" ON "BottleProduct"("locationId", "name");

-- CreateIndex
CREATE INDEX "RecipeIngredient_locationId_idx" ON "RecipeIngredient"("locationId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_menuItemId_idx" ON "RecipeIngredient"("menuItemId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_bottleProductId_idx" ON "RecipeIngredient"("bottleProductId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_ingredientId_idx" ON "RecipeIngredient"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeIngredient_menuItemId_bottleProductId_key" ON "RecipeIngredient"("menuItemId", "bottleProductId");

-- CreateIndex
CREATE UNIQUE INDEX "SpiritModifierGroup_modifierGroupId_key" ON "SpiritModifierGroup"("modifierGroupId");

-- CreateIndex
CREATE INDEX "SpiritModifierGroup_locationId_idx" ON "SpiritModifierGroup"("locationId");

-- CreateIndex
CREATE INDEX "SpiritModifierGroup_spiritCategoryId_idx" ON "SpiritModifierGroup"("spiritCategoryId");

-- CreateIndex
CREATE INDEX "SpiritUpsellEvent_locationId_idx" ON "SpiritUpsellEvent"("locationId");

-- CreateIndex
CREATE INDEX "SpiritUpsellEvent_orderId_idx" ON "SpiritUpsellEvent"("orderId");

-- CreateIndex
CREATE INDEX "SpiritUpsellEvent_employeeId_idx" ON "SpiritUpsellEvent"("employeeId");

-- CreateIndex
CREATE INDEX "SpiritUpsellEvent_createdAt_idx" ON "SpiritUpsellEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SpiritUpsellEvent_wasAccepted_idx" ON "SpiritUpsellEvent"("wasAccepted");

-- CreateIndex
CREATE INDEX "IngredientCategory_locationId_idx" ON "IngredientCategory"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientCategory_locationId_code_key" ON "IngredientCategory"("locationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientCategory_locationId_name_key" ON "IngredientCategory"("locationId", "name");

-- CreateIndex
CREATE INDEX "IngredientSwapGroup_locationId_idx" ON "IngredientSwapGroup"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientSwapGroup_locationId_name_key" ON "IngredientSwapGroup"("locationId", "name");

-- CreateIndex
CREATE INDEX "Ingredient_locationId_idx" ON "Ingredient"("locationId");

-- CreateIndex
CREATE INDEX "Ingredient_locationId_name_idx" ON "Ingredient"("locationId", "name");

-- CreateIndex
CREATE INDEX "Ingredient_categoryId_idx" ON "Ingredient"("categoryId");

-- CreateIndex
CREATE INDEX "Ingredient_parentIngredientId_idx" ON "Ingredient"("parentIngredientId");

-- CreateIndex
CREATE INDEX "IngredientStockAdjustment_locationId_idx" ON "IngredientStockAdjustment"("locationId");

-- CreateIndex
CREATE INDEX "IngredientStockAdjustment_ingredientId_idx" ON "IngredientStockAdjustment"("ingredientId");

-- CreateIndex
CREATE INDEX "IngredientStockAdjustment_employeeId_idx" ON "IngredientStockAdjustment"("employeeId");

-- CreateIndex
CREATE INDEX "IngredientStockAdjustment_type_idx" ON "IngredientStockAdjustment"("type");

-- CreateIndex
CREATE INDEX "IngredientStockAdjustment_createdAt_idx" ON "IngredientStockAdjustment"("createdAt");

-- CreateIndex
CREATE INDEX "IngredientRecipe_locationId_idx" ON "IngredientRecipe"("locationId");

-- CreateIndex
CREATE INDEX "IngredientRecipe_outputId_idx" ON "IngredientRecipe"("outputId");

-- CreateIndex
CREATE INDEX "IngredientRecipe_componentId_idx" ON "IngredientRecipe"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientRecipe_outputId_componentId_key" ON "IngredientRecipe"("outputId", "componentId");

-- CreateIndex
CREATE INDEX "MenuItemIngredient_locationId_idx" ON "MenuItemIngredient"("locationId");

-- CreateIndex
CREATE INDEX "MenuItemIngredient_menuItemId_idx" ON "MenuItemIngredient"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemIngredient_locationId_ingredientId_idx" ON "MenuItemIngredient"("locationId", "ingredientId");

-- CreateIndex
CREATE INDEX "MenuItemIngredient_menuItemId_deletedAt_idx" ON "MenuItemIngredient"("menuItemId", "deletedAt");

-- CreateIndex
CREATE INDEX "MenuItemIngredient_pricingOptionId_idx" ON "MenuItemIngredient"("pricingOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemIngredient_menuItemId_ingredientId_pricingOptionId_key" ON "MenuItemIngredient"("menuItemId", "ingredientId", "pricingOptionId");

-- CreateIndex
CREATE INDEX "ModifierGroupTemplate_locationId_idx" ON "ModifierGroupTemplate"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroupTemplate_locationId_name_key" ON "ModifierGroupTemplate"("locationId", "name");

-- CreateIndex
CREATE INDEX "ModifierTemplate_locationId_idx" ON "ModifierTemplate"("locationId");

-- CreateIndex
CREATE INDEX "ModifierTemplate_templateId_idx" ON "ModifierTemplate"("templateId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_locationId_idx" ON "OrderItemIngredient"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_orderItemId_idx" ON "OrderItemIngredient"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_ingredientId_idx" ON "OrderItemIngredient"("ingredientId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_modificationType_idx" ON "OrderItemIngredient"("modificationType");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_locationId_updatedAt_idx" ON "OrderItemIngredient"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Printer_locationId_idx" ON "Printer"("locationId");

-- CreateIndex
CREATE INDEX "Printer_printerRole_idx" ON "Printer"("printerRole");

-- CreateIndex
CREATE INDEX "Printer_ipAddress_idx" ON "Printer"("ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Printer_locationId_name_key" ON "Printer"("locationId", "name");

-- CreateIndex
CREATE INDEX "Station_locationId_idx" ON "Station"("locationId");

-- CreateIndex
CREATE INDEX "Station_type_idx" ON "Station"("type");

-- CreateIndex
CREATE INDEX "Station_isExpo_idx" ON "Station"("isExpo");

-- CreateIndex
CREATE UNIQUE INDEX "Station_locationId_name_key" ON "Station"("locationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "KDSScreen_deviceToken_key" ON "KDSScreen"("deviceToken");

-- CreateIndex
CREATE INDEX "KDSScreen_locationId_idx" ON "KDSScreen"("locationId");

-- CreateIndex
CREATE INDEX "KDSScreen_deviceToken_idx" ON "KDSScreen"("deviceToken");

-- CreateIndex
CREATE UNIQUE INDEX "KDSScreen_locationId_name_key" ON "KDSScreen"("locationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "KDSScreen_locationId_slug_key" ON "KDSScreen"("locationId", "slug");

-- CreateIndex
CREATE INDEX "KDSScreenStation_locationId_idx" ON "KDSScreenStation"("locationId");

-- CreateIndex
CREATE INDEX "KDSScreenStation_kdsScreenId_idx" ON "KDSScreenStation"("kdsScreenId");

-- CreateIndex
CREATE INDEX "KDSScreenStation_stationId_idx" ON "KDSScreenStation"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "KDSScreenStation_kdsScreenId_stationId_key" ON "KDSScreenStation"("kdsScreenId", "stationId");

-- CreateIndex
CREATE INDEX "KDSScreenLink_locationId_idx" ON "KDSScreenLink"("locationId");

-- CreateIndex
CREATE INDEX "KDSScreenLink_sourceScreenId_idx" ON "KDSScreenLink"("sourceScreenId");

-- CreateIndex
CREATE INDEX "KDSScreenLink_targetScreenId_idx" ON "KDSScreenLink"("targetScreenId");

-- CreateIndex
CREATE UNIQUE INDEX "KDSScreenLink_sourceScreenId_targetScreenId_linkType_key" ON "KDSScreenLink"("sourceScreenId", "targetScreenId", "linkType");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_deviceToken_key" ON "Terminal"("deviceToken");

-- CreateIndex
CREATE INDEX "Terminal_locationId_name_idx" ON "Terminal"("locationId", "name");

-- CreateIndex
CREATE INDEX "Terminal_locationId_idx" ON "Terminal"("locationId");

-- CreateIndex
CREATE INDEX "Terminal_category_idx" ON "Terminal"("category");

-- CreateIndex
CREATE INDEX "Terminal_staticIp_idx" ON "Terminal"("staticIp");

-- CreateIndex
CREATE INDEX "Terminal_deviceToken_idx" ON "Terminal"("deviceToken");

-- CreateIndex
CREATE INDEX "Terminal_backupTerminalId_idx" ON "Terminal"("backupTerminalId");

-- CreateIndex
CREATE INDEX "Terminal_paymentReaderId_idx" ON "Terminal"("paymentReaderId");

-- CreateIndex
CREATE INDEX "Terminal_scaleId_idx" ON "Terminal"("scaleId");

-- CreateIndex
CREATE INDEX "Terminal_platform_idx" ON "Terminal"("platform");

-- CreateIndex
CREATE INDEX "Terminal_cfdTerminalId_idx" ON "Terminal"("cfdTerminalId");

-- CreateIndex
CREATE UNIQUE INDEX "CfdSettings_locationId_key" ON "CfdSettings"("locationId");

-- CreateIndex
CREATE INDEX "CfdSettings_locationId_idx" ON "CfdSettings"("locationId");

-- CreateIndex
CREATE INDEX "Scale_locationId_idx" ON "Scale"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Scale_locationId_name_key" ON "Scale"("locationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReader_serialNumber_key" ON "PaymentReader"("serialNumber");

-- CreateIndex
CREATE INDEX "PaymentReader_locationId_idx" ON "PaymentReader"("locationId");

-- CreateIndex
CREATE INDEX "PaymentReader_isActive_idx" ON "PaymentReader"("isActive");

-- CreateIndex
CREATE INDEX "PaymentReader_isOnline_idx" ON "PaymentReader"("isOnline");

-- CreateIndex
CREATE INDEX "PaymentReader_serialNumber_idx" ON "PaymentReader"("serialNumber");

-- CreateIndex
CREATE INDEX "PaymentReader_connectionType_idx" ON "PaymentReader"("connectionType");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReader_locationId_name_key" ON "PaymentReader"("locationId", "name");

-- CreateIndex
CREATE INDEX "PaymentReaderLog_locationId_idx" ON "PaymentReaderLog"("locationId");

-- CreateIndex
CREATE INDEX "PaymentReaderLog_readerId_idx" ON "PaymentReaderLog"("readerId");

-- CreateIndex
CREATE INDEX "PaymentReaderLog_readerId_createdAt_idx" ON "PaymentReaderLog"("readerId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentReaderLog_locationId_createdAt_idx" ON "PaymentReaderLog"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintRule_locationId_idx" ON "PrintRule"("locationId");

-- CreateIndex
CREATE INDEX "PrintRule_categoryId_idx" ON "PrintRule"("categoryId");

-- CreateIndex
CREATE INDEX "PrintRule_menuItemId_idx" ON "PrintRule"("menuItemId");

-- CreateIndex
CREATE INDEX "PrintRule_modifierId_idx" ON "PrintRule"("modifierId");

-- CreateIndex
CREATE INDEX "PrintRule_ruleLevel_idx" ON "PrintRule"("ruleLevel");

-- CreateIndex
CREATE INDEX "PrintRoute_locationId_idx" ON "PrintRoute"("locationId");

-- CreateIndex
CREATE INDEX "PrintRoute_routeType_idx" ON "PrintRoute"("routeType");

-- CreateIndex
CREATE INDEX "PrintRoute_priority_idx" ON "PrintRoute"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "PrintRoute_locationId_name_key" ON "PrintRoute"("locationId", "name");

-- CreateIndex
CREATE INDEX "PrintJob_locationId_idx" ON "PrintJob"("locationId");

-- CreateIndex
CREATE INDEX "PrintJob_status_idx" ON "PrintJob"("status");

-- CreateIndex
CREATE INDEX "PrintJob_printerId_idx" ON "PrintJob"("printerId");

-- CreateIndex
CREATE INDEX "PrintJob_createdAt_idx" ON "PrintJob"("createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_locationId_status_idx" ON "PrintJob"("locationId", "status");

-- CreateIndex
CREATE INDEX "PrintJob_locationId_updatedAt_idx" ON "PrintJob"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaConfig_locationId_key" ON "PizzaConfig"("locationId");

-- CreateIndex
CREATE INDEX "PizzaConfig_locationId_idx" ON "PizzaConfig"("locationId");

-- CreateIndex
CREATE INDEX "PizzaSize_locationId_idx" ON "PizzaSize"("locationId");

-- CreateIndex
CREATE INDEX "PizzaSize_sortOrder_idx" ON "PizzaSize"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaSize_locationId_name_key" ON "PizzaSize"("locationId", "name");

-- CreateIndex
CREATE INDEX "PizzaCrust_locationId_idx" ON "PizzaCrust"("locationId");

-- CreateIndex
CREATE INDEX "PizzaCrust_sortOrder_idx" ON "PizzaCrust"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaCrust_locationId_name_key" ON "PizzaCrust"("locationId", "name");

-- CreateIndex
CREATE INDEX "PizzaSauce_locationId_idx" ON "PizzaSauce"("locationId");

-- CreateIndex
CREATE INDEX "PizzaSauce_sortOrder_idx" ON "PizzaSauce"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaSauce_locationId_name_key" ON "PizzaSauce"("locationId", "name");

-- CreateIndex
CREATE INDEX "PizzaCheese_locationId_idx" ON "PizzaCheese"("locationId");

-- CreateIndex
CREATE INDEX "PizzaCheese_sortOrder_idx" ON "PizzaCheese"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaCheese_locationId_name_key" ON "PizzaCheese"("locationId", "name");

-- CreateIndex
CREATE INDEX "PizzaTopping_locationId_idx" ON "PizzaTopping"("locationId");

-- CreateIndex
CREATE INDEX "PizzaTopping_category_idx" ON "PizzaTopping"("category");

-- CreateIndex
CREATE INDEX "PizzaTopping_sortOrder_idx" ON "PizzaTopping"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaTopping_locationId_name_key" ON "PizzaTopping"("locationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PizzaSpecialty_menuItemId_key" ON "PizzaSpecialty"("menuItemId");

-- CreateIndex
CREATE INDEX "PizzaSpecialty_locationId_idx" ON "PizzaSpecialty"("locationId");

-- CreateIndex
CREATE INDEX "PizzaSpecialty_menuItemId_idx" ON "PizzaSpecialty"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemPizza_orderItemId_key" ON "OrderItemPizza"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemPizza_locationId_idx" ON "OrderItemPizza"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemPizza_orderItemId_idx" ON "OrderItemPizza"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemPizza_sizeId_idx" ON "OrderItemPizza"("sizeId");

-- CreateIndex
CREATE INDEX "OrderItemPizza_locationId_updatedAt_idx" ON "OrderItemPizza"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "PayrollPeriod_locationId_idx" ON "PayrollPeriod"("locationId");

-- CreateIndex
CREATE INDEX "PayrollPeriod_status_idx" ON "PayrollPeriod"("status");

-- CreateIndex
CREATE INDEX "PayrollPeriod_periodStart_idx" ON "PayrollPeriod"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_locationId_periodStart_periodEnd_key" ON "PayrollPeriod"("locationId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "PayStub_locationId_idx" ON "PayStub"("locationId");

-- CreateIndex
CREATE INDEX "PayStub_employeeId_idx" ON "PayStub"("employeeId");

-- CreateIndex
CREATE INDEX "PayStub_payrollPeriodId_idx" ON "PayStub"("payrollPeriodId");

-- CreateIndex
CREATE INDEX "PayStub_status_idx" ON "PayStub"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PayStub_payrollPeriodId_employeeId_key" ON "PayStub"("payrollPeriodId", "employeeId");

-- CreateIndex
CREATE INDEX "Schedule_locationId_idx" ON "Schedule"("locationId");

-- CreateIndex
CREATE INDEX "Schedule_weekStart_idx" ON "Schedule"("weekStart");

-- CreateIndex
CREATE INDEX "Schedule_status_idx" ON "Schedule"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_locationId_weekStart_key" ON "Schedule"("locationId", "weekStart");

-- CreateIndex
CREATE INDEX "ScheduledShift_locationId_idx" ON "ScheduledShift"("locationId");

-- CreateIndex
CREATE INDEX "ScheduledShift_scheduleId_idx" ON "ScheduledShift"("scheduleId");

-- CreateIndex
CREATE INDEX "ScheduledShift_employeeId_idx" ON "ScheduledShift"("employeeId");

-- CreateIndex
CREATE INDEX "ScheduledShift_date_idx" ON "ScheduledShift"("date");

-- CreateIndex
CREATE INDEX "ScheduledShift_status_idx" ON "ScheduledShift"("status");

-- CreateIndex
CREATE INDEX "ScheduledShift_sevenShiftsShiftId_idx" ON "ScheduledShift"("sevenShiftsShiftId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_locationId_idx" ON "ShiftSwapRequest"("locationId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_shiftId_idx" ON "ShiftSwapRequest"("shiftId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_requestedByEmployeeId_idx" ON "ShiftSwapRequest"("requestedByEmployeeId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_requestedToEmployeeId_idx" ON "ShiftSwapRequest"("requestedToEmployeeId");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_status_idx" ON "ShiftSwapRequest"("status");

-- CreateIndex
CREATE INDEX "ShiftSwapRequest_type_idx" ON "ShiftSwapRequest"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_locationId_key" ON "PayrollSettings"("locationId");

-- CreateIndex
CREATE INDEX "PayrollSettings_locationId_idx" ON "PayrollSettings"("locationId");

-- CreateIndex
CREATE INDEX "PrepTrayConfig_locationId_idx" ON "PrepTrayConfig"("locationId");

-- CreateIndex
CREATE INDEX "PrepTrayConfig_prepItemId_idx" ON "PrepTrayConfig"("prepItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PrepTrayConfig_prepItemId_name_key" ON "PrepTrayConfig"("prepItemId", "name");

-- CreateIndex
CREATE INDEX "DailyPrepCount_locationId_idx" ON "DailyPrepCount"("locationId");

-- CreateIndex
CREATE INDEX "DailyPrepCount_countDate_idx" ON "DailyPrepCount"("countDate");

-- CreateIndex
CREATE INDEX "DailyPrepCount_status_idx" ON "DailyPrepCount"("status");

-- CreateIndex
CREATE INDEX "DailyPrepCount_createdById_idx" ON "DailyPrepCount"("createdById");

-- CreateIndex
CREATE INDEX "DailyPrepCountItem_locationId_idx" ON "DailyPrepCountItem"("locationId");

-- CreateIndex
CREATE INDEX "DailyPrepCountItem_dailyCountId_idx" ON "DailyPrepCountItem"("dailyCountId");

-- CreateIndex
CREATE INDEX "DailyPrepCountItem_prepItemId_idx" ON "DailyPrepCountItem"("prepItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPrepCountItem_dailyCountId_prepItemId_key" ON "DailyPrepCountItem"("dailyCountId", "prepItemId");

-- CreateIndex
CREATE INDEX "DailyPrepCountTransaction_locationId_idx" ON "DailyPrepCountTransaction"("locationId");

-- CreateIndex
CREATE INDEX "DailyPrepCountTransaction_dailyCountId_idx" ON "DailyPrepCountTransaction"("dailyCountId");

-- CreateIndex
CREATE INDEX "DailyPrepCountTransaction_type_idx" ON "DailyPrepCountTransaction"("type");

-- CreateIndex
CREATE INDEX "DailyPrepCountTransaction_createdAt_idx" ON "DailyPrepCountTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "OrderCard_orderId_idx" ON "OrderCard"("orderId");

-- CreateIndex
CREATE INDEX "OrderCard_locationId_idx" ON "OrderCard"("locationId");

-- CreateIndex
CREATE INDEX "OrderCard_status_idx" ON "OrderCard"("status");

-- CreateIndex
CREATE INDEX "OrderCard_recordNo_idx" ON "OrderCard"("recordNo");

-- CreateIndex
CREATE INDEX "OrderCard_locationId_updatedAt_idx" ON "OrderCard"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalReceipt_orderId_key" ON "DigitalReceipt"("orderId");

-- CreateIndex
CREATE INDEX "DigitalReceipt_locationId_idx" ON "DigitalReceipt"("locationId");

-- CreateIndex
CREATE INDEX "DigitalReceipt_locationId_createdAt_idx" ON "DigitalReceipt"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalReceipt_paymentId_idx" ON "DigitalReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "ChargebackCase_orderId_idx" ON "ChargebackCase"("orderId");

-- CreateIndex
CREATE INDEX "ChargebackCase_paymentId_idx" ON "ChargebackCase"("paymentId");

-- CreateIndex
CREATE INDEX "ChargebackCase_cardLast4_idx" ON "ChargebackCase"("cardLast4");

-- CreateIndex
CREATE INDEX "ChargebackCase_status_idx" ON "ChargebackCase"("status");

-- CreateIndex
CREATE INDEX "ChargebackCase_chargebackDate_idx" ON "ChargebackCase"("chargebackDate");

-- CreateIndex
CREATE INDEX "ChargebackCase_locationId_status_chargebackDate_idx" ON "ChargebackCase"("locationId", "status", "chargebackDate");

-- CreateIndex
CREATE INDEX "CardProfile_locationId_cardLast4_idx" ON "CardProfile"("locationId", "cardLast4");

-- CreateIndex
CREATE INDEX "CardProfile_locationId_idx" ON "CardProfile"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CardProfile_locationId_cardholderIdHash_key" ON "CardProfile"("locationId", "cardholderIdHash");

-- CreateIndex
CREATE INDEX "WalkoutRetry_locationId_idx" ON "WalkoutRetry"("locationId");

-- CreateIndex
CREATE INDEX "WalkoutRetry_orderId_idx" ON "WalkoutRetry"("orderId");

-- CreateIndex
CREATE INDEX "WalkoutRetry_status_idx" ON "WalkoutRetry"("status");

-- CreateIndex
CREATE INDEX "WalkoutRetry_nextRetryAt_idx" ON "WalkoutRetry"("nextRetryAt");

-- CreateIndex
CREATE INDEX "BottleServiceTier_locationId_idx" ON "BottleServiceTier"("locationId");

-- CreateIndex
CREATE INDEX "BottleServiceTier_locationId_isActive_idx" ON "BottleServiceTier"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "ErrorLog_locationId_severity_idx" ON "ErrorLog"("locationId", "severity");

-- CreateIndex
CREATE INDEX "ErrorLog_severity_idx" ON "ErrorLog"("severity");

-- CreateIndex
CREATE INDEX "ErrorLog_errorType_idx" ON "ErrorLog"("errorType");

-- CreateIndex
CREATE INDEX "ErrorLog_status_idx" ON "ErrorLog"("status");

-- CreateIndex
CREATE INDEX "ErrorLog_groupId_idx" ON "ErrorLog"("groupId");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_employeeId_idx" ON "ErrorLog"("employeeId");

-- CreateIndex
CREATE INDEX "ErrorLog_orderId_idx" ON "ErrorLog"("orderId");

-- CreateIndex
CREATE INDEX "ErrorLog_category_idx" ON "ErrorLog"("category");

-- CreateIndex
CREATE INDEX "ErrorLog_locationId_status_createdAt_idx" ON "ErrorLog"("locationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_locationId_category_createdAt_idx" ON "ErrorLog"("locationId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "VenueLog_locationId_createdAt_idx" ON "VenueLog"("locationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VenueLog_level_idx" ON "VenueLog"("level");

-- CreateIndex
CREATE INDEX "VenueLog_source_idx" ON "VenueLog"("source");

-- CreateIndex
CREATE INDEX "VenueLog_category_idx" ON "VenueLog"("category");

-- CreateIndex
CREATE INDEX "VenueLog_expiresAt_idx" ON "VenueLog"("expiresAt");

-- CreateIndex
CREATE INDEX "VenueLog_createdAt_idx" ON "VenueLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "HealthCheck_locationId_idx" ON "HealthCheck"("locationId");

-- CreateIndex
CREATE INDEX "HealthCheck_checkType_idx" ON "HealthCheck"("checkType");

-- CreateIndex
CREATE INDEX "HealthCheck_status_idx" ON "HealthCheck"("status");

-- CreateIndex
CREATE INDEX "HealthCheck_createdAt_idx" ON "HealthCheck"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServerRegistrationToken_token_key" ON "ServerRegistrationToken"("token");

-- CreateIndex
CREATE INDEX "ServerRegistrationToken_locationId_idx" ON "ServerRegistrationToken"("locationId");

-- CreateIndex
CREATE INDEX "ServerRegistrationToken_locationId_status_expiresAt_idx" ON "ServerRegistrationToken"("locationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "cloud_event_queue_locationId_idx" ON "cloud_event_queue"("locationId");

-- CreateIndex
CREATE INDEX "cloud_event_queue_nextRetryAt_idx" ON "cloud_event_queue"("nextRetryAt");

-- CreateIndex
CREATE INDEX "cloud_event_queue_status_idx" ON "cloud_event_queue"("status");

-- CreateIndex
CREATE INDEX "cloud_event_queue_locationId_status_idx" ON "cloud_event_queue"("locationId", "status");

-- CreateIndex
CREATE INDEX "RefundLog_locationId_idx" ON "RefundLog"("locationId");

-- CreateIndex
CREATE INDEX "RefundLog_orderId_idx" ON "RefundLog"("orderId");

-- CreateIndex
CREATE INDEX "RefundLog_paymentId_idx" ON "RefundLog"("paymentId");

-- CreateIndex
CREATE INDEX "RefundLog_employeeId_idx" ON "RefundLog"("employeeId");

-- CreateIndex
CREATE INDEX "RefundLog_createdAt_idx" ON "RefundLog"("createdAt");

-- CreateIndex
CREATE INDEX "RefundLog_locationId_createdAt_idx" ON "RefundLog"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "RefundLog_locationId_updatedAt_idx" ON "RefundLog"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderItemDiscount_locationId_idx" ON "OrderItemDiscount"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemDiscount_orderId_idx" ON "OrderItemDiscount"("orderId");

-- CreateIndex
CREATE INDEX "OrderItemDiscount_orderItemId_idx" ON "OrderItemDiscount"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemDiscount_locationId_createdAt_idx" ON "OrderItemDiscount"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItemDiscount_orderId_orderItemId_idx" ON "OrderItemDiscount"("orderId", "orderItemId");

-- CreateIndex
CREATE INDEX "RegisteredDevice_locationId_idx" ON "RegisteredDevice"("locationId");

-- CreateIndex
CREATE INDEX "RegisteredDevice_locationId_isActive_idx" ON "RegisteredDevice"("locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MobileSession_sessionToken_key" ON "MobileSession"("sessionToken");

-- CreateIndex
CREATE INDEX "MobileSession_locationId_idx" ON "MobileSession"("locationId");

-- CreateIndex
CREATE INDEX "MobileSession_sessionToken_idx" ON "MobileSession"("sessionToken");

-- CreateIndex
CREATE INDEX "MobileSession_employeeId_idx" ON "MobileSession"("employeeId");

-- CreateIndex
CREATE INDEX "HardwareCommand_locationId_status_idx" ON "HardwareCommand"("locationId", "status");

-- CreateIndex
CREATE INDEX "HardwareCommand_locationId_idx" ON "HardwareCommand"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_eventId_key" ON "order_events"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_serverSequence_key" ON "order_events"("serverSequence");

-- CreateIndex
CREATE INDEX "order_events_locationId_idx" ON "order_events"("locationId");

-- CreateIndex
CREATE INDEX "order_events_orderId_idx" ON "order_events"("orderId");

-- CreateIndex
CREATE INDEX "order_events_orderId_serverSequence_idx" ON "order_events"("orderId", "serverSequence");

-- CreateIndex
CREATE INDEX "order_events_locationId_serverSequence_idx" ON "order_events"("locationId", "serverSequence");

-- CreateIndex
CREATE INDEX "order_events_type_idx" ON "order_events"("type");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_idx" ON "order_snapshots"("locationId");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_status_idx" ON "order_snapshots"("locationId", "status");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_isClosed_idx" ON "order_snapshots"("locationId", "isClosed");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_status_createdAt_idx" ON "order_snapshots"("locationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_openedAt_idx" ON "order_snapshots"("locationId", "openedAt");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_tabStatus_idx" ON "order_snapshots"("locationId", "tabStatus");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_parentOrderId_idx" ON "order_snapshots"("locationId", "parentOrderId");

-- CreateIndex
CREATE INDEX "order_snapshots_employeeId_idx" ON "order_snapshots"("employeeId");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_offlineId_idx" ON "order_snapshots"("locationId", "offlineId");

-- CreateIndex
CREATE INDEX "order_snapshots_locationId_businessDayDate_idx" ON "order_snapshots"("locationId", "businessDayDate");

-- CreateIndex
CREATE INDEX "order_item_snapshots_snapshotId_idx" ON "order_item_snapshots"("snapshotId");

-- CreateIndex
CREATE INDEX "order_item_snapshots_locationId_idx" ON "order_item_snapshots"("locationId");

-- CreateIndex
CREATE INDEX "order_item_snapshots_snapshotId_kitchenStatus_idx" ON "order_item_snapshots"("snapshotId", "kitchenStatus");

-- CreateIndex
CREATE INDEX "order_item_snapshots_snapshotId_status_idx" ON "order_item_snapshots"("snapshotId", "status");

-- CreateIndex
CREATE INDEX "order_item_snapshots_locationId_kitchenStatus_idx" ON "order_item_snapshots"("locationId", "kitchenStatus");

-- CreateIndex
CREATE INDEX "order_item_snapshots_menuItemId_createdAt_idx" ON "order_item_snapshots"("menuItemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBarPreference_employeeId_key" ON "QuickBarPreference"("employeeId");

-- CreateIndex
CREATE INDEX "QuickBarPreference_locationId_idx" ON "QuickBarPreference"("locationId");

-- CreateIndex
CREATE INDEX "QuickBarPreference_locationId_deletedAt_idx" ON "QuickBarPreference"("locationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuickBarDefault_locationId_key" ON "QuickBarDefault"("locationId");

-- CreateIndex
CREATE INDEX "SevenShiftsDailySalesPush_locationId_idx" ON "SevenShiftsDailySalesPush"("locationId");

-- CreateIndex
CREATE INDEX "SevenShiftsDailySalesPush_businessDate_idx" ON "SevenShiftsDailySalesPush"("businessDate");

-- CreateIndex
CREATE INDEX "SevenShiftsDailySalesPush_status_idx" ON "SevenShiftsDailySalesPush"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SevenShiftsDailySalesPush_locationId_businessDate_revenueTy_key" ON "SevenShiftsDailySalesPush"("locationId", "businessDate", "revenueType");

-- CreateIndex
CREATE UNIQUE INDEX "PmsChargeAttempt_idempotencyKey_key" ON "PmsChargeAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PmsChargeAttempt_orderId_idx" ON "PmsChargeAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PmsChargeAttempt_reservationId_idx" ON "PmsChargeAttempt"("reservationId");

-- CreateIndex
CREATE INDEX "PmsChargeAttempt_locationId_createdAt_idx" ON "PmsChargeAttempt"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "IngredientCostHistory_locationId_inventoryItemId_effectiveD_idx" ON "IngredientCostHistory"("locationId", "inventoryItemId", "effectiveDate");

-- CreateIndex
CREATE INDEX "IngredientCostHistory_locationId_effectiveDate_idx" ON "IngredientCostHistory"("locationId", "effectiveDate");

-- CreateIndex
CREATE INDEX "VendorOrder_locationId_status_idx" ON "VendorOrder"("locationId", "status");

-- CreateIndex
CREATE INDEX "VendorOrder_locationId_orderDate_idx" ON "VendorOrder"("locationId", "orderDate");

-- CreateIndex
CREATE INDEX "VendorOrderLineItem_locationId_idx" ON "VendorOrderLineItem"("locationId");

-- CreateIndex
CREATE INDEX "VendorOrderLineItem_locationId_vendorOrderId_idx" ON "VendorOrderLineItem"("locationId", "vendorOrderId");

-- CreateIndex
CREATE INDEX "VendorOrderLineItem_locationId_deletedAt_idx" ON "VendorOrderLineItem"("locationId", "deletedAt");

-- CreateIndex
CREATE INDEX "VendorOrderLineItem_vendorOrderId_idx" ON "VendorOrderLineItem"("vendorOrderId");

-- CreateIndex
CREATE INDEX "VendorOrderLineItem_inventoryItemId_idx" ON "VendorOrderLineItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryCountEntry_inventoryCountId_idx" ON "InventoryCountEntry"("inventoryCountId");

-- CreateIndex
CREATE INDEX "InventoryCountEntry_inventoryItemId_idx" ON "InventoryCountEntry"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountEntry_inventoryCountId_inventoryItemId_key" ON "InventoryCountEntry"("inventoryCountId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "WasteLog_locationId_businessDate_idx" ON "WasteLog"("locationId", "businessDate");

-- CreateIndex
CREATE INDEX "WasteLog_locationId_reason_idx" ON "WasteLog"("locationId", "reason");

-- CreateIndex
CREATE INDEX "MarginEdgeProductMapping_locationId_inventoryItemId_idx" ON "MarginEdgeProductMapping"("locationId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "MarginEdgeProductMapping_locationId_deletedAt_idx" ON "MarginEdgeProductMapping"("locationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarginEdgeProductMapping_locationId_marginEdgeProductId_key" ON "MarginEdgeProductMapping"("locationId", "marginEdgeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingDeduction_orderId_key" ON "PendingDeduction"("orderId");

-- CreateIndex
CREATE INDEX "PendingDeduction_locationId_status_availableAt_idx" ON "PendingDeduction"("locationId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "PendingDeduction_status_availableAt_idx" ON "PendingDeduction"("status", "availableAt");

-- CreateIndex
CREATE INDEX "DeductionRun_pendingDeductionId_idx" ON "DeductionRun"("pendingDeductionId");

-- CreateIndex
CREATE INDEX "DeductionRun_locationId_idx" ON "DeductionRun"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingLoyaltyEarn_orderId_key" ON "PendingLoyaltyEarn"("orderId");

-- CreateIndex
CREATE INDEX "PendingLoyaltyEarn_locationId_status_availableAt_idx" ON "PendingLoyaltyEarn"("locationId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "PendingLoyaltyEarn_status_availableAt_idx" ON "PendingLoyaltyEarn"("status", "availableAt");

-- CreateIndex
CREATE INDEX "BergPluMapping_locationId_idx" ON "BergPluMapping"("locationId");

-- CreateIndex
CREATE INDEX "BergPluMapping_locationId_isActive_idx" ON "BergPluMapping"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "BergPluMapping_locationId_deletedAt_idx" ON "BergPluMapping"("locationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BergPluMapping_mappingScopeKey_pluNumber_key" ON "BergPluMapping"("mappingScopeKey", "pluNumber");

-- CreateIndex
CREATE INDEX "BergDevice_locationId_idx" ON "BergDevice"("locationId");

-- CreateIndex
CREATE INDEX "BergDevice_locationId_isActive_idx" ON "BergDevice"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "BergDevice_locationId_deletedAt_idx" ON "BergDevice"("locationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BergDispenseEvent_idempotencyKey_key" ON "BergDispenseEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_locationId_receivedAt_idx" ON "BergDispenseEvent"("locationId", "receivedAt");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_locationId_status_idx" ON "BergDispenseEvent"("locationId", "status");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_locationId_lrcValid_idx" ON "BergDispenseEvent"("locationId", "lrcValid");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_locationId_unmatchedType_idx" ON "BergDispenseEvent"("locationId", "unmatchedType");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_pluMappingId_receivedAt_idx" ON "BergDispenseEvent"("pluMappingId", "receivedAt");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_orderId_idx" ON "BergDispenseEvent"("orderId");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_idempotencyKey_idx" ON "BergDispenseEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_deviceId_receivedAt_idx" ON "BergDispenseEvent"("deviceId", "receivedAt");

-- CreateIndex
CREATE INDEX "BergDispenseEvent_deviceId_businessDate_idx" ON "BergDispenseEvent"("deviceId", "businessDate");

-- CreateIndex
CREATE INDEX "ItemBarcode_barcode_idx" ON "ItemBarcode"("barcode");

-- CreateIndex
CREATE INDEX "ItemBarcode_menuItemId_idx" ON "ItemBarcode"("menuItemId");

-- CreateIndex
CREATE INDEX "ItemBarcode_inventoryItemId_idx" ON "ItemBarcode"("inventoryItemId");

-- CreateIndex
CREATE INDEX "ItemBarcode_locationId_idx" ON "ItemBarcode"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemBarcode_locationId_barcode_key" ON "ItemBarcode"("locationId", "barcode");

-- CreateIndex
CREATE INDEX "FulfillmentEvent_locationId_status_idx" ON "FulfillmentEvent"("locationId", "status");

-- CreateIndex
CREATE INDEX "FulfillmentEvent_claimedBy_status_idx" ON "FulfillmentEvent"("claimedBy", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeCheckpoint_locationId_nodeId_key" ON "BridgeCheckpoint"("locationId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "OutageQueueEntry_idempotencyKey_key" ON "OutageQueueEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutageQueueEntry_locationId_status_idx" ON "OutageQueueEntry"("locationId", "status");

-- CreateIndex
CREATE INDEX "OutageQueueEntry_outageId_idx" ON "OutageQueueEntry"("outageId");

-- CreateIndex
CREATE INDEX "ReservationBlock_locationId_blockDate_idx" ON "ReservationBlock"("locationId", "blockDate");

-- CreateIndex
CREATE INDEX "ReservationTable_locationId_idx" ON "ReservationTable"("locationId");

-- CreateIndex
CREATE INDEX "ReservationEvent_reservationId_idx" ON "ReservationEvent"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationEvent_locationId_createdAt_idx" ON "ReservationEvent"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReservationIdempotencyKey_reservationId_idx" ON "ReservationIdempotencyKey"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationDepositToken_reservationId_idx" ON "ReservationDepositToken"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationDepositToken_expiresAt_idx" ON "ReservationDepositToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ReservationDeposit_locationId_idx" ON "ReservationDeposit"("locationId");

-- CreateIndex
CREATE INDEX "ReservationDeposit_reservationId_idx" ON "ReservationDeposit"("reservationId");

-- CreateIndex
CREATE INDEX "ReservationDeposit_locationId_createdAt_idx" ON "ReservationDeposit"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeePermissionOverride_locationId_idx" ON "EmployeePermissionOverride"("locationId");

-- CreateIndex
CREATE INDEX "EmployeePermissionOverride_locationId_deletedAt_idx" ON "EmployeePermissionOverride"("locationId", "deletedAt");

-- CreateIndex
CREATE INDEX "EmployeePermissionOverride_employeeId_idx" ON "EmployeePermissionOverride"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePermissionOverride_employeeId_permissionKey_key" ON "EmployeePermissionOverride"("employeeId", "permissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "SyncWatermark_locationId_key" ON "SyncWatermark"("locationId");

-- CreateIndex
CREATE INDEX "SyncConflict_resolvedAt_idx" ON "SyncConflict"("resolvedAt");

-- CreateIndex
CREATE INDEX "SyncConflict_detectedAt_idx" ON "SyncConflict"("detectedAt");

-- CreateIndex
CREATE INDEX "SyncConflict_model_recordId_idx" ON "SyncConflict"("model", "recordId");

-- CreateIndex
CREATE INDEX "SocketEventLog_locationId_id_idx" ON "SocketEventLog"("locationId", "id");

-- CreateIndex
CREATE INDEX "CellularEvent_locationId_id_idx" ON "CellularEvent"("locationId", "id");

-- CreateIndex
CREATE INDEX "CellularEvent_createdAt_idx" ON "CellularEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyProgram_locationId_idx" ON "LoyaltyProgram"("locationId");

-- CreateIndex
CREATE INDEX "LoyaltyProgram_locationId_isActive_idx" ON "LoyaltyProgram"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "LoyaltyTier_programId_idx" ON "LoyaltyTier"("programId");

-- CreateIndex
CREATE INDEX "LoyaltyTier_programId_sortOrder_idx" ON "LoyaltyTier"("programId", "sortOrder");

-- CreateIndex
CREATE INDEX "LoyaltyTier_locationId_idx" ON "LoyaltyTier"("locationId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_customerId_idx" ON "LoyaltyTransaction"("customerId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_locationId_idx" ON "LoyaltyTransaction"("locationId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_orderId_idx" ON "LoyaltyTransaction"("orderId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_type_idx" ON "LoyaltyTransaction"("type");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_createdAt_idx" ON "LoyaltyTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_customerId_createdAt_idx" ON "LoyaltyTransaction"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CardDetection_detectionId_key" ON "CardDetection"("detectionId");

-- CreateIndex
CREATE INDEX "CardDetection_readerId_createdAt_idx" ON "CardDetection"("readerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CardDetection_terminalId_createdAt_idx" ON "CardDetection"("terminalId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CardDetection_status_decisionExpiresAt_idx" ON "CardDetection"("status", "decisionExpiresAt");

-- CreateIndex
CREATE INDEX "CardDetection_matchedOrderId_createdAt_idx" ON "CardDetection"("matchedOrderId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CardDetection_locationId_detectionId_idx" ON "CardDetection"("locationId", "detectionId");

-- CreateIndex
CREATE INDEX "NotificationJob_correlationId_idx" ON "NotificationJob"("correlationId");

-- CreateIndex
CREATE INDEX "NotificationJob_subjectType_subjectId_idx" ON "NotificationJob"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationJob_locationId_sourceSystem_sourceEventId_sourc_key" ON "NotificationJob"("locationId", "sourceSystem", "sourceEventId", "sourceEventVersion");

-- CreateIndex
CREATE INDEX "NotificationAttempt_jobId_idx" ON "NotificationAttempt"("jobId");

-- CreateIndex
CREATE INDEX "NotificationAttempt_providerId_startedAt_idx" ON "NotificationAttempt"("providerId", "startedAt");

-- CreateIndex
CREATE INDEX "NotificationProvider_locationId_isActive_idx" ON "NotificationProvider"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "NotificationDeviceEvent_deviceId_createdAt_idx" ON "NotificationDeviceEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationTargetAssignment_subjectType_subjectId_status_idx" ON "NotificationTargetAssignment"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE INDEX "NotificationRoutingRule_locationId_eventType_enabled_idx" ON "NotificationRoutingRule"("locationId", "eventType", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryOrder_trackingToken_key" ON "DeliveryOrder"("trackingToken");

-- CreateIndex
CREATE INDEX "DeliveryOrder_locationId_status_idx" ON "DeliveryOrder"("locationId", "status");

-- CreateIndex
CREATE INDEX "DeliveryOrder_driverId_idx" ON "DeliveryOrder"("driverId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_orderId_idx" ON "DeliveryOrder"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_locationId_createdAt_idx" ON "DeliveryOrder"("locationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "DeliveryOrder_zoneId_idx" ON "DeliveryOrder"("zoneId");

-- CreateIndex
CREATE INDEX "DeliveryOrder_runId_idx" ON "DeliveryOrder"("runId");

-- CreateIndex
CREATE INDEX "ExternalWebhookEvent_provider_processingStatus_idx" ON "ExternalWebhookEvent"("provider", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalWebhookEvent_provider_externalTransactionId_eventTy_key" ON "ExternalWebhookEvent"("provider", "externalTransactionId", "eventType");

-- CreateIndex
CREATE INDEX "ItemShare_sourceItemId_idx" ON "ItemShare"("sourceItemId");

-- CreateIndex
CREATE INDEX "ItemShare_targetOrderId_idx" ON "ItemShare"("targetOrderId");

-- CreateIndex
CREATE INDEX "ItemShare_sourceOrderId_idx" ON "ItemShare"("sourceOrderId");

-- CreateIndex
CREATE INDEX "ItemShare_locationId_idx" ON "ItemShare"("locationId");

-- CreateIndex
CREATE INDEX "IntegrationRetryEntry_locationId_status_nextRetryAt_idx" ON "IntegrationRetryEntry"("locationId", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "IntegrationRetryEntry_integration_status_idx" ON "IntegrationRetryEntry"("integration", "status");

-- CreateIndex
CREATE INDEX "PeripheralSnapshot_locationId_idx" ON "PeripheralSnapshot"("locationId");

-- CreateIndex
CREATE INDEX "PeripheralSnapshot_locationId_updatedAt_idx" ON "PeripheralSnapshot"("locationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PeripheralSnapshot_locationId_deviceType_deviceId_key" ON "PeripheralSnapshot"("locationId", "deviceType", "deviceId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_loyaltyTierId_fkey" FOREIGN KEY ("loyaltyTierId") REFERENCES "LoyaltyTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRole" ADD CONSTRAINT "EmployeeRole_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRole" ADD CONSTRAINT "EmployeeRole_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRole" ADD CONSTRAINT "EmployeeRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_workingRoleId_fkey" FOREIGN KEY ("workingRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_selectedTipGroupId_fkey" FOREIGN KEY ("selectedTipGroupId") REFERENCES "TipGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_timeClockEntryId_fkey" FOREIGN KEY ("timeClockEntryId") REFERENCES "TimeClockEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_workingRoleId_fkey" FOREIGN KEY ("workingRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_drawerId_fkey" FOREIGN KEY ("drawerId") REFERENCES "Drawer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawer" ADD CONSTRAINT "Drawer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidInOut" ADD CONSTRAINT "PaidInOut_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidInOut" ADD CONSTRAINT "PaidInOut_drawerId_fkey" FOREIGN KEY ("drawerId") REFERENCES "Drawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidInOut" ADD CONSTRAINT "PaidInOut_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidInOut" ADD CONSTRAINT "PaidInOut_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepStation" ADD CONSTRAINT "PrepStation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseConfig" ADD CONSTRAINT "CourseConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_prepStationId_fkey" FOREIGN KEY ("prepStationId") REFERENCES "PrepStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_prepStationId_fkey" FOREIGN KEY ("prepStationId") REFERENCES "PrepStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_currentOrderId_fkey" FOREIGN KEY ("currentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_currentOrderItemId_fkey" FOREIGN KEY ("currentOrderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_linkedBottleProductId_fkey" FOREIGN KEY ("linkedBottleProductId") REFERENCES "BottleProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_childModifierGroupId_fkey" FOREIGN KEY ("childModifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_linkedMenuItemId_fkey" FOREIGN KEY ("linkedMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_linkedBottleProductId_fkey" FOREIGN KEY ("linkedBottleProductId") REFERENCES "BottleProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTemplate" ADD CONSTRAINT "ComboTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTemplate" ADD CONSTRAINT "ComboTemplate_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_comboTemplateId_fkey" FOREIGN KEY ("comboTemplateId") REFERENCES "ComboTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_defaultItemId_fkey" FOREIGN KEY ("defaultItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentOption" ADD CONSTRAINT "ComboComponentOption_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentOption" ADD CONSTRAINT "ComboComponentOption_comboComponentId_fkey" FOREIGN KEY ("comboComponentId") REFERENCES "ComboComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentOption" ADD CONSTRAINT "ComboComponentOption_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboSelection" ADD CONSTRAINT "OrderItemComboSelection_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboSelection" ADD CONSTRAINT "OrderItemComboSelection_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboSelection" ADD CONSTRAINT "OrderItemComboSelection_comboComponentId_fkey" FOREIGN KEY ("comboComponentId") REFERENCES "ComboComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboSelection" ADD CONSTRAINT "OrderItemComboSelection_comboComponentOptionId_fkey" FOREIGN KEY ("comboComponentOptionId") REFERENCES "ComboComponentOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboSelection" ADD CONSTRAINT "OrderItemComboSelection_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_timedItemId_fkey" FOREIGN KEY ("timedItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_defaultSectionId_fkey" FOREIGN KEY ("defaultSectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_linkedMenuItemId_fkey" FOREIGN KEY ("linkedMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_currentOrderId_fkey" FOREIGN KEY ("currentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentWaitlist" ADD CONSTRAINT "EntertainmentWaitlist_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentWaitlist" ADD CONSTRAINT "EntertainmentWaitlist_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "FloorPlanElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentWaitlist" ADD CONSTRAINT "EntertainmentWaitlist_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentSession" ADD CONSTRAINT "EntertainmentSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentSession" ADD CONSTRAINT "EntertainmentSession_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentSession" ADD CONSTRAINT "EntertainmentSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentSessionEvent" ADD CONSTRAINT "EntertainmentSessionEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentSessionEvent" ADD CONSTRAINT "EntertainmentSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EntertainmentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentResource" ADD CONSTRAINT "EntertainmentResource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderType" ADD CONSTRAINT "OrderType_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_splitFamilyRootId_fkey" FOREIGN KEY ("splitFamilyRootId") REFERENCES "Order"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderTypeId_fkey" FOREIGN KEY ("orderTypeId") REFERENCES "OrderType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_preAuthReaderId_fkey" FOREIGN KEY ("preAuthReaderId") REFERENCES "PaymentReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_bottleServiceTierId_fkey" FOREIGN KEY ("bottleServiceTierId") REFERENCES "BottleServiceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_claimedByEmployeeId_fkey" FOREIGN KEY ("claimedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sourceTableId_fkey" FOREIGN KEY ("sourceTableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_pricingOptionId_fkey" FOREIGN KEY ("pricingOptionId") REFERENCES "PricingOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_addedByEmployeeId_fkey" FOREIGN KEY ("addedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_drawerId_fkey" FOREIGN KEY ("drawerId") REFERENCES "Drawer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentReaderId_fkey" FOREIGN KEY ("paymentReaderId") REFERENCES "PaymentReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_freeItemId_fkey" FOREIGN KEY ("freeItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_bottleServiceTierId_fkey" FOREIGN KEY ("bottleServiceTierId") REFERENCES "BottleServiceTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRule" ADD CONSTRAINT "DiscountRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_remoteApprovalId_fkey" FOREIGN KEY ("remoteApprovalId") REFERENCES "RemoteVoidApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_requestingTerminalId_fkey" FOREIGN KEY ("requestingTerminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPool" ADD CONSTRAINT "TipPool_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipOutRule" ADD CONSTRAINT "TipOutRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipOutRule" ADD CONSTRAINT "TipOutRule_fromRoleId_fkey" FOREIGN KEY ("fromRoleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipOutRule" ADD CONSTRAINT "TipOutRule_toRoleId_fkey" FOREIGN KEY ("toRoleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipShare" ADD CONSTRAINT "TipShare_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "TipOutRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedger" ADD CONSTRAINT "TipLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedger" ADD CONSTRAINT "TipLedger_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedgerEntry" ADD CONSTRAINT "TipLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedgerEntry" ADD CONSTRAINT "TipLedgerEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "TipLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedgerEntry" ADD CONSTRAINT "TipLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedgerEntry" ADD CONSTRAINT "TipLedgerEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipLedgerEntry" ADD CONSTRAINT "TipLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_tipGroupId_fkey" FOREIGN KEY ("tipGroupId") REFERENCES "TipGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "TipGroupSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_primaryEmployeeId_fkey" FOREIGN KEY ("primaryEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupTemplate" ADD CONSTRAINT "TipGroupTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroup" ADD CONSTRAINT "TipGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroup" ADD CONSTRAINT "TipGroup_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroup" ADD CONSTRAINT "TipGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroup" ADD CONSTRAINT "TipGroup_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroup" ADD CONSTRAINT "TipGroup_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TipGroupTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupMembership" ADD CONSTRAINT "TipGroupMembership_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupMembership" ADD CONSTRAINT "TipGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TipGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupMembership" ADD CONSTRAINT "TipGroupMembership_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupSegment" ADD CONSTRAINT "TipGroupSegment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupSegment" ADD CONSTRAINT "TipGroupSegment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TipGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipDebt" ADD CONSTRAINT "TipDebt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipDebt" ADD CONSTRAINT "TipDebt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipDebt" ADD CONSTRAINT "TipDebt_sourcePaymentId_fkey" FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnership" ADD CONSTRAINT "OrderOwnership_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnership" ADD CONSTRAINT "OrderOwnership_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnership" ADD CONSTRAINT "OrderOwnership_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnershipEntry" ADD CONSTRAINT "OrderOwnershipEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnershipEntry" ADD CONSTRAINT "OrderOwnershipEntry_orderOwnershipId_fkey" FOREIGN KEY ("orderOwnershipId") REFERENCES "OrderOwnership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnershipEntry" ADD CONSTRAINT "OrderOwnershipEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipAdjustment" ADD CONSTRAINT "TipAdjustment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipAdjustment" ADD CONSTRAINT "TipAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTipDeclaration" ADD CONSTRAINT "CashTipDeclaration_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTipDeclaration" ADD CONSTRAINT "CashTipDeclaration_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTipDeclaration" ADD CONSTRAINT "CashTipDeclaration_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccount" ADD CONSTRAINT "HouseAccount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccount" ADD CONSTRAINT "HouseAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccountTransaction" ADD CONSTRAINT "HouseAccountTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccountTransaction" ADD CONSTRAINT "HouseAccountTransaction_houseAccountId_fkey" FOREIGN KEY ("houseAccountId") REFERENCES "HouseAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccountTransaction" ADD CONSTRAINT "HouseAccountTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccountTransaction" ADD CONSTRAINT "HouseAccountTransaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_currentOrderItemId_fkey" FOREIGN KEY ("currentOrderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPricingTier" ADD CONSTRAINT "EventPricingTier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPricingTier" ADD CONSTRAINT "EventPricingTier_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTableConfig" ADD CONSTRAINT "EventTableConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTableConfig" ADD CONSTRAINT "EventTableConfig_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTableConfig" ADD CONSTRAINT "EventTableConfig_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTableConfig" ADD CONSTRAINT "EventTableConfig_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "EventPricingTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "EventPricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidReason" ADD CONSTRAINT "VoidReason_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompReason" ADD CONSTRAINT "CompReason_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasonAccess" ADD CONSTRAINT "ReasonAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultVendorId_fkey" FOREIGN KEY ("defaultVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_spiritCategoryId_fkey" FOREIGN KEY ("spiritCategoryId") REFERENCES "SpiritCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemStorage" ADD CONSTRAINT "InventoryItemStorage_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemStorage" ADD CONSTRAINT "InventoryItemStorage_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemStorage" ADD CONSTRAINT "InventoryItemStorage_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepItem" ADD CONSTRAINT "PrepItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepItemIngredient" ADD CONSTRAINT "PrepItemIngredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepItemIngredient" ADD CONSTRAINT "PrepItemIngredient_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "PrepItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepItemIngredient" ADD CONSTRAINT "PrepItemIngredient_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemRecipe" ADD CONSTRAINT "MenuItemRecipe_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemRecipe" ADD CONSTRAINT "MenuItemRecipe_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemRecipeIngredient" ADD CONSTRAINT "MenuItemRecipeIngredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemRecipeIngredient" ADD CONSTRAINT "MenuItemRecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "MenuItemRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemRecipeIngredient" ADD CONSTRAINT "MenuItemRecipeIngredient_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemRecipeIngredient" ADD CONSTRAINT "MenuItemRecipeIngredient_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "PrepItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierInventoryLink" ADD CONSTRAINT "ModifierInventoryLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierInventoryLink" ADD CONSTRAINT "ModifierInventoryLink_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierInventoryLink" ADD CONSTRAINT "ModifierInventoryLink_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierInventoryLink" ADD CONSTRAINT "ModifierInventoryLink_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "PrepItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionGroup" ADD CONSTRAINT "PricingOptionGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionGroup" ADD CONSTRAINT "PricingOptionGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOption" ADD CONSTRAINT "PricingOption_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOption" ADD CONSTRAINT "PricingOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PricingOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionInventoryLink" ADD CONSTRAINT "PricingOptionInventoryLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionInventoryLink" ADD CONSTRAINT "PricingOptionInventoryLink_pricingOptionId_fkey" FOREIGN KEY ("pricingOptionId") REFERENCES "PricingOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionInventoryLink" ADD CONSTRAINT "PricingOptionInventoryLink_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionInventoryLink" ADD CONSTRAINT "PricingOptionInventoryLink_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "PrepItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingOptionInventoryLink" ADD CONSTRAINT "PricingOptionInventoryLink_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountItem" ADD CONSTRAINT "InventoryCountItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemTransaction" ADD CONSTRAINT "InventoryItemTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemTransaction" ADD CONSTRAINT "InventoryItemTransaction_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemTransaction" ADD CONSTRAINT "InventoryItemTransaction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteLogEntry" ADD CONSTRAINT "WasteLogEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteLogEntry" ADD CONSTRAINT "WasteLogEntry_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteLogEntry" ADD CONSTRAINT "WasteLogEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySettings" ADD CONSTRAINT "InventorySettings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Break" ADD CONSTRAINT "Break_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Break" ADD CONSTRAINT "Break_timeClockEntryId_fkey" FOREIGN KEY ("timeClockEntryId") REFERENCES "TimeClockEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Break" ADD CONSTRAINT "Break_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritCategory" ADD CONSTRAINT "SpiritCategory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottleProduct" ADD CONSTRAINT "BottleProduct_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottleProduct" ADD CONSTRAINT "BottleProduct_spiritCategoryId_fkey" FOREIGN KEY ("spiritCategoryId") REFERENCES "SpiritCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottleProduct" ADD CONSTRAINT "BottleProduct_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_bottleProductId_fkey" FOREIGN KEY ("bottleProductId") REFERENCES "BottleProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritModifierGroup" ADD CONSTRAINT "SpiritModifierGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritModifierGroup" ADD CONSTRAINT "SpiritModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritModifierGroup" ADD CONSTRAINT "SpiritModifierGroup_spiritCategoryId_fkey" FOREIGN KEY ("spiritCategoryId") REFERENCES "SpiritCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritUpsellEvent" ADD CONSTRAINT "SpiritUpsellEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritUpsellEvent" ADD CONSTRAINT "SpiritUpsellEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritUpsellEvent" ADD CONSTRAINT "SpiritUpsellEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCategory" ADD CONSTRAINT "IngredientCategory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientSwapGroup" ADD CONSTRAINT "IngredientSwapGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IngredientCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "PrepItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_swapGroupId_fkey" FOREIGN KEY ("swapGroupId") REFERENCES "IngredientSwapGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_parentIngredientId_fkey" FOREIGN KEY ("parentIngredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStockAdjustment" ADD CONSTRAINT "IngredientStockAdjustment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStockAdjustment" ADD CONSTRAINT "IngredientStockAdjustment_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientStockAdjustment" ADD CONSTRAINT "IngredientStockAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecipe" ADD CONSTRAINT "IngredientRecipe_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecipe" ADD CONSTRAINT "IngredientRecipe_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecipe" ADD CONSTRAINT "IngredientRecipe_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemIngredient" ADD CONSTRAINT "MenuItemIngredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemIngredient" ADD CONSTRAINT "MenuItemIngredient_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemIngredient" ADD CONSTRAINT "MenuItemIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemIngredient" ADD CONSTRAINT "MenuItemIngredient_pricingOptionId_fkey" FOREIGN KEY ("pricingOptionId") REFERENCES "PricingOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroupTemplate" ADD CONSTRAINT "ModifierGroupTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierTemplate" ADD CONSTRAINT "ModifierTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierTemplate" ADD CONSTRAINT "ModifierTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ModifierGroupTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_swappedToModifierId_fkey" FOREIGN KEY ("swappedToModifierId") REFERENCES "Modifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_backupStationId_fkey" FOREIGN KEY ("backupStationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreen" ADD CONSTRAINT "KDSScreen_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreenStation" ADD CONSTRAINT "KDSScreenStation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreenStation" ADD CONSTRAINT "KDSScreenStation_kdsScreenId_fkey" FOREIGN KEY ("kdsScreenId") REFERENCES "KDSScreen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreenStation" ADD CONSTRAINT "KDSScreenStation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "PrepStation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreenLink" ADD CONSTRAINT "KDSScreenLink_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreenLink" ADD CONSTRAINT "KDSScreenLink_sourceScreenId_fkey" FOREIGN KEY ("sourceScreenId") REFERENCES "KDSScreen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KDSScreenLink" ADD CONSTRAINT "KDSScreenLink_targetScreenId_fkey" FOREIGN KEY ("targetScreenId") REFERENCES "KDSScreen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_receiptPrinterId_fkey" FOREIGN KEY ("receiptPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_kitchenPrinterId_fkey" FOREIGN KEY ("kitchenPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_barPrinterId_fkey" FOREIGN KEY ("barPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_backupTerminalId_fkey" FOREIGN KEY ("backupTerminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_paymentReaderId_fkey" FOREIGN KEY ("paymentReaderId") REFERENCES "PaymentReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_backupPaymentReaderId_fkey" FOREIGN KEY ("backupPaymentReaderId") REFERENCES "PaymentReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "Scale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_cfdTerminalId_fkey" FOREIGN KEY ("cfdTerminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CfdSettings" ADD CONSTRAINT "CfdSettings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scale" ADD CONSTRAINT "Scale_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReader" ADD CONSTRAINT "PaymentReader_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReaderLog" ADD CONSTRAINT "PaymentReaderLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReaderLog" ADD CONSTRAINT "PaymentReaderLog_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "PaymentReader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRule" ADD CONSTRAINT "PrintRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRule" ADD CONSTRAINT "PrintRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRule" ADD CONSTRAINT "PrintRule_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRule" ADD CONSTRAINT "PrintRule_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRule" ADD CONSTRAINT "PrintRule_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRule" ADD CONSTRAINT "PrintRule_kdsScreenId_fkey" FOREIGN KEY ("kdsScreenId") REFERENCES "KDSScreen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "PrepStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_backupPrinterId_fkey" FOREIGN KEY ("backupPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaConfig" ADD CONSTRAINT "PizzaConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSize" ADD CONSTRAINT "PizzaSize_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSize" ADD CONSTRAINT "PizzaSize_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSize" ADD CONSTRAINT "PizzaSize_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCrust" ADD CONSTRAINT "PizzaCrust_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCrust" ADD CONSTRAINT "PizzaCrust_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCrust" ADD CONSTRAINT "PizzaCrust_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSauce" ADD CONSTRAINT "PizzaSauce_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSauce" ADD CONSTRAINT "PizzaSauce_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSauce" ADD CONSTRAINT "PizzaSauce_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCheese" ADD CONSTRAINT "PizzaCheese_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCheese" ADD CONSTRAINT "PizzaCheese_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCheese" ADD CONSTRAINT "PizzaCheese_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaTopping" ADD CONSTRAINT "PizzaTopping_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaTopping" ADD CONSTRAINT "PizzaTopping_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaTopping" ADD CONSTRAINT "PizzaTopping_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSpecialty" ADD CONSTRAINT "PizzaSpecialty_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSpecialty" ADD CONSTRAINT "PizzaSpecialty_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSpecialty" ADD CONSTRAINT "PizzaSpecialty_defaultCrustId_fkey" FOREIGN KEY ("defaultCrustId") REFERENCES "PizzaCrust"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSpecialty" ADD CONSTRAINT "PizzaSpecialty_defaultSauceId_fkey" FOREIGN KEY ("defaultSauceId") REFERENCES "PizzaSauce"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSpecialty" ADD CONSTRAINT "PizzaSpecialty_defaultCheeseId_fkey" FOREIGN KEY ("defaultCheeseId") REFERENCES "PizzaCheese"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "PizzaSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_crustId_fkey" FOREIGN KEY ("crustId") REFERENCES "PizzaCrust"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_sauceId_fkey" FOREIGN KEY ("sauceId") REFERENCES "PizzaSauce"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_cheeseId_fkey" FOREIGN KEY ("cheeseId") REFERENCES "PizzaCheese"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayStub" ADD CONSTRAINT "PayStub_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledShift" ADD CONSTRAINT "ScheduledShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledShift" ADD CONSTRAINT "ScheduledShift_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledShift" ADD CONSTRAINT "ScheduledShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledShift" ADD CONSTRAINT "ScheduledShift_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledShift" ADD CONSTRAINT "ScheduledShift_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledShift" ADD CONSTRAINT "ScheduledShift_originalEmployeeId_fkey" FOREIGN KEY ("originalEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "ScheduledShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requestedByEmployeeId_fkey" FOREIGN KEY ("requestedByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requestedToEmployeeId_fkey" FOREIGN KEY ("requestedToEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_approvedByEmployeeId_fkey" FOREIGN KEY ("approvedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepTrayConfig" ADD CONSTRAINT "PrepTrayConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrepTrayConfig" ADD CONSTRAINT "PrepTrayConfig_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCount" ADD CONSTRAINT "DailyPrepCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCount" ADD CONSTRAINT "DailyPrepCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCount" ADD CONSTRAINT "DailyPrepCount_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCount" ADD CONSTRAINT "DailyPrepCount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountItem" ADD CONSTRAINT "DailyPrepCountItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountItem" ADD CONSTRAINT "DailyPrepCountItem_dailyCountId_fkey" FOREIGN KEY ("dailyCountId") REFERENCES "DailyPrepCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountItem" ADD CONSTRAINT "DailyPrepCountItem_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountTransaction" ADD CONSTRAINT "DailyPrepCountTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountTransaction" ADD CONSTRAINT "DailyPrepCountTransaction_dailyCountId_fkey" FOREIGN KEY ("dailyCountId") REFERENCES "DailyPrepCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountTransaction" ADD CONSTRAINT "DailyPrepCountTransaction_prepItemId_fkey" FOREIGN KEY ("prepItemId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPrepCountTransaction" ADD CONSTRAINT "DailyPrepCountTransaction_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCard" ADD CONSTRAINT "OrderCard_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCard" ADD CONSTRAINT "OrderCard_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCard" ADD CONSTRAINT "OrderCard_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "PaymentReader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalReceipt" ADD CONSTRAINT "DigitalReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalReceipt" ADD CONSTRAINT "DigitalReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalReceipt" ADD CONSTRAINT "DigitalReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackCase" ADD CONSTRAINT "ChargebackCase_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackCase" ADD CONSTRAINT "ChargebackCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackCase" ADD CONSTRAINT "ChargebackCase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProfile" ADD CONSTRAINT "CardProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProfile" ADD CONSTRAINT "CardProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkoutRetry" ADD CONSTRAINT "WalkoutRetry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkoutRetry" ADD CONSTRAINT "WalkoutRetry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkoutRetry" ADD CONSTRAINT "WalkoutRetry_orderCardId_fkey" FOREIGN KEY ("orderCardId") REFERENCES "OrderCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottleServiceTier" ADD CONSTRAINT "BottleServiceTier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerRegistrationToken" ADD CONSTRAINT "ServerRegistrationToken_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_event_queue" ADD CONSTRAINT "cloud_event_queue_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLog" ADD CONSTRAINT "RefundLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLog" ADD CONSTRAINT "RefundLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLog" ADD CONSTRAINT "RefundLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLog" ADD CONSTRAINT "RefundLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLog" ADD CONSTRAINT "RefundLog_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredDevice" ADD CONSTRAINT "RegisteredDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredDevice" ADD CONSTRAINT "RegisteredDevice_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "RegisteredDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileSession" ADD CONSTRAINT "MobileSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HardwareCommand" ADD CONSTRAINT "HardwareCommand_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_snapshots" ADD CONSTRAINT "order_snapshots_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_snapshots" ADD CONSTRAINT "order_item_snapshots_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "order_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_snapshots" ADD CONSTRAINT "order_item_snapshots_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickBarPreference" ADD CONSTRAINT "QuickBarPreference_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SevenShiftsDailySalesPush" ADD CONSTRAINT "SevenShiftsDailySalesPush_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCostHistory" ADD CONSTRAINT "IngredientCostHistory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientCostHistory" ADD CONSTRAINT "IngredientCostHistory_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrder" ADD CONSTRAINT "VendorOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrderLineItem" ADD CONSTRAINT "VendorOrderLineItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrderLineItem" ADD CONSTRAINT "VendorOrderLineItem_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "VendorOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorOrderLineItem" ADD CONSTRAINT "VendorOrderLineItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountEntry" ADD CONSTRAINT "InventoryCountEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountEntry" ADD CONSTRAINT "InventoryCountEntry_inventoryCountId_fkey" FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountEntry" ADD CONSTRAINT "InventoryCountEntry_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteLog" ADD CONSTRAINT "WasteLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteLog" ADD CONSTRAINT "WasteLog_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginEdgeProductMapping" ADD CONSTRAINT "MarginEdgeProductMapping_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarginEdgeProductMapping" ADD CONSTRAINT "MarginEdgeProductMapping_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingDeduction" ADD CONSTRAINT "PendingDeduction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionRun" ADD CONSTRAINT "DeductionRun_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionRun" ADD CONSTRAINT "DeductionRun_pendingDeductionId_fkey" FOREIGN KEY ("pendingDeductionId") REFERENCES "PendingDeduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingLoyaltyEarn" ADD CONSTRAINT "PendingLoyaltyEarn_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergPluMapping" ADD CONSTRAINT "BergPluMapping_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergPluMapping" ADD CONSTRAINT "BergPluMapping_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BergDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergDevice" ADD CONSTRAINT "BergDevice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergDispenseEvent" ADD CONSTRAINT "BergDispenseEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergDispenseEvent" ADD CONSTRAINT "BergDispenseEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BergDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergDispenseEvent" ADD CONSTRAINT "BergDispenseEvent_pluMappingId_fkey" FOREIGN KEY ("pluMappingId") REFERENCES "BergPluMapping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergDispenseEvent" ADD CONSTRAINT "BergDispenseEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BergDispenseEvent" ADD CONSTRAINT "BergDispenseEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemBarcode" ADD CONSTRAINT "ItemBarcode_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemBarcode" ADD CONSTRAINT "ItemBarcode_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemBarcode" ADD CONSTRAINT "ItemBarcode_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentEvent" ADD CONSTRAINT "FulfillmentEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeCheckpoint" ADD CONSTRAINT "BridgeCheckpoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutageQueueEntry" ADD CONSTRAINT "OutageQueueEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationBlock" ADD CONSTRAINT "ReservationBlock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationIdempotencyKey" ADD CONSTRAINT "ReservationIdempotencyKey_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDepositToken" ADD CONSTRAINT "ReservationDepositToken_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationDeposit" ADD CONSTRAINT "ReservationDeposit_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePermissionOverride" ADD CONSTRAINT "EmployeePermissionOverride_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePermissionOverride" ADD CONSTRAINT "EmployeePermissionOverride_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncWatermark" ADD CONSTRAINT "SyncWatermark_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTier" ADD CONSTRAINT "LoyaltyTier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTier" ADD CONSTRAINT "LoyaltyTier_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemShare" ADD CONSTRAINT "ItemShare_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemShare" ADD CONSTRAINT "ItemShare_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemShare" ADD CONSTRAINT "ItemShare_targetOrderId_fkey" FOREIGN KEY ("targetOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemShare" ADD CONSTRAINT "ItemShare_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationRetryEntry" ADD CONSTRAINT "IntegrationRetryEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeripheralSnapshot" ADD CONSTRAINT "PeripheralSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

