-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RegistrationTokenStatus" AS ENUM ('PENDING', 'USED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "tags" JSONB,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "averageTicket" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastVisit" TIMESTAMP(3),
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "birthday" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "tipWeight" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "cashHandlingMode" TEXT NOT NULL DEFAULT 'drawer',
    "trackLaborCost" BOOLEAN NOT NULL DEFAULT true,
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
    "hourlyRate" DECIMAL(65,30),
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "federalFilingStatus" TEXT,
    "federalAllowances" INTEGER NOT NULL DEFAULT 0,
    "additionalFederalWithholding" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "stateFilingStatus" TEXT,
    "stateAllowances" INTEGER NOT NULL DEFAULT 0,
    "additionalStateWithholding" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isExemptFromFederalTax" BOOLEAN NOT NULL DEFAULT false,
    "isExemptFromStateTax" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethod" TEXT,
    "bankName" TEXT,
    "bankRoutingNumber" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountType" TEXT,
    "bankAccountLast4" TEXT,
    "ytdGrossEarnings" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdGrossWages" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdTips" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdCommission" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdTaxesWithheld" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdFederalTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdStateTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdLocalTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdSocialSecurity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdMedicare" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ytdNetPay" DECIMAL(65,30) NOT NULL DEFAULT 0,
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
    "regularHours" DECIMAL(65,30),
    "overtimeHours" DECIMAL(65,30),
    "drawerCountIn" JSONB,
    "drawerCountOut" JSONB,
    "notes" TEXT,
    "workingRoleId" TEXT,
    "selectedTipGroupId" TEXT,
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
    "startingCash" DECIMAL(65,30) NOT NULL,
    "expectedCash" DECIMAL(65,30),
    "actualCash" DECIMAL(65,30),
    "variance" DECIMAL(65,30),
    "totalSales" DECIMAL(65,30),
    "cashSales" DECIMAL(65,30),
    "cardSales" DECIMAL(65,30),
    "tipsDeclared" DECIMAL(65,30),
    "grossTips" DECIMAL(65,30),
    "tipOutTotal" DECIMAL(65,30),
    "netTips" DECIMAL(65,30),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
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
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
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
    "categoryType" TEXT NOT NULL DEFAULT 'food',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "categoryShow" TEXT NOT NULL DEFAULT 'all',
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
    "price" DECIMAL(65,30) NOT NULL,
    "priceCC" DECIMAL(65,30),
    "cost" DECIMAL(65,30),
    "taxRate" DECIMAL(65,30),
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
    "itemType" TEXT NOT NULL DEFAULT 'standard',
    "comboPrintMode" TEXT,
    "timedPricing" JSONB,
    "ratePerMinute" DECIMAL(65,30),
    "minimumCharge" DECIMAL(65,30),
    "incrementMinutes" INTEGER DEFAULT 15,
    "minimumMinutes" INTEGER,
    "graceMinutes" INTEGER,
    "prepaidPackages" JSONB,
    "happyHourEnabled" BOOLEAN DEFAULT false,
    "happyHourDiscount" INTEGER DEFAULT 50,
    "happyHourStart" TEXT,
    "happyHourEnd" TEXT,
    "happyHourDays" JSONB,
    "entertainmentStatus" TEXT,
    "currentOrderId" TEXT,
    "currentOrderItemId" TEXT,
    "blockTimeMinutes" INTEGER,
    "maxConcurrentUses" INTEGER DEFAULT 1,
    "currentUseCount" INTEGER DEFAULT 0,
    "availableFrom" TEXT,
    "availableTo" TEXT,
    "availableDays" TEXT,
    "commissionType" TEXT,
    "commissionValue" DECIMAL(65,30),
    "pourSizes" JSONB,
    "defaultPourSize" TEXT,
    "applyPourToModifiers" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "linkedBottleProductId" TEXT,

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
    "tieredPricingConfig" JSONB,
    "exclusionGroupKey" TEXT,
    "hasOnlineOverride" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSpiritGroup" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "priceType" TEXT NOT NULL DEFAULT 'upcharge',
    "upsellPrice" DECIMAL(65,30),
    "cost" DECIMAL(65,30),
    "allowNo" BOOLEAN NOT NULL DEFAULT true,
    "allowLite" BOOLEAN NOT NULL DEFAULT false,
    "allowOnSide" BOOLEAN NOT NULL DEFAULT false,
    "allowExtra" BOOLEAN NOT NULL DEFAULT false,
    "extraPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allowedPreModifiers" JSONB,
    "extraUpsellPrice" DECIMAL(65,30),
    "ingredientId" TEXT,
    "childModifierGroupId" TEXT,
    "commissionType" TEXT,
    "commissionValue" DECIMAL(65,30),
    "linkedMenuItemId" TEXT,
    "spiritTier" TEXT,
    "linkedBottleProductId" TEXT,
    "pourSizeOz" DECIMAL(65,30),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "isLabel" BOOLEAN NOT NULL DEFAULT false,
    "printerRouting" TEXT NOT NULL DEFAULT 'follow',
    "printerIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemModifierGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboTemplate" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "basePrice" DECIMAL(65,30) NOT NULL,
    "comparePrice" DECIMAL(65,30),
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
    "itemPriceOverride" DECIMAL(65,30),
    "modifierPriceOverrides" JSONB,
    "modifierGroupId" TEXT,
    "priceOverride" DECIMAL(65,30),
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
    "upcharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ComboComponentOption_pkey" PRIMARY KEY ("id")
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
    "status" TEXT NOT NULL DEFAULT 'available',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultPosX" INTEGER,
    "defaultPosY" INTEGER,
    "defaultSectionId" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
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
    "elementType" TEXT NOT NULL DEFAULT 'entertainment',
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
    "status" TEXT NOT NULL DEFAULT 'available',
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
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "position" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "seatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "EntertainmentWaitlist_pkey" PRIMARY KEY ("id")
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
    "employeeId" TEXT NOT NULL,
    "customerId" TEXT,
    "orderNumber" INTEGER NOT NULL,
    "displayNumber" TEXT,
    "parentOrderId" TEXT,
    "splitIndex" INTEGER,
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
    "tabStatus" TEXT,
    "customFields" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxFromInclusive" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxFromExclusive" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tipTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "primaryPaymentMethod" TEXT,
    "commissionTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "preAuthId" TEXT,
    "preAuthAmount" DECIMAL(65,30),
    "preAuthLast4" TEXT,
    "preAuthCardBrand" TEXT,
    "preAuthExpiresAt" TIMESTAMP(3),
    "preAuthRecordNo" TEXT,
    "preAuthReaderId" TEXT,
    "isBottleService" BOOLEAN NOT NULL DEFAULT false,
    "bottleServiceTierId" TEXT,
    "bottleServiceDeposit" DECIMAL(65,30),
    "bottleServiceMinSpend" DECIMAL(65,30),
    "isWalkout" BOOLEAN NOT NULL DEFAULT false,
    "walkoutAt" TIMESTAMP(3),
    "walkoutMarkedBy" TEXT,
    "rolledOverAt" TIMESTAMP(3),
    "rolledOverFrom" TEXT,
    "captureDeclinedAt" TIMESTAMP(3),
    "captureRetryCount" INTEGER NOT NULL DEFAULT 0,
    "lastCaptureError" TEXT,
    "currentCourse" INTEGER NOT NULL DEFAULT 1,
    "courseMode" TEXT NOT NULL DEFAULT 'off',
    "offlineId" TEXT,
    "offlineLocalId" TEXT,
    "offlineTimestamp" TIMESTAMP(3),
    "offlineTerminalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "cardPrice" DECIMAL(65,30),
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "categoryType" TEXT,
    "seatNumber" INTEGER,
    "sourceTableId" TEXT,
    "courseNumber" INTEGER,
    "courseStatus" TEXT NOT NULL DEFAULT 'pending',
    "isHeld" BOOLEAN NOT NULL DEFAULT false,
    "holdUntil" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "delayMinutes" INTEGER,
    "delayStartedAt" TIMESTAMP(3),
    "kitchenStatus" TEXT NOT NULL DEFAULT 'pending',
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastResentAt" TIMESTAMP(3),
    "resendNote" TEXT,
    "blockTimeMinutes" INTEGER,
    "blockTimeStartedAt" TIMESTAMP(3),
    "blockTimeExpiresAt" TIMESTAMP(3),
    "specialNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidReason" TEXT,
    "wasMade" BOOLEAN,
    "modifierTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "itemTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commissionAmount" DECIMAL(65,30),
    "addedByEmployeeId" TEXT,
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
    "price" DECIMAL(65,30) NOT NULL,
    "preModifier" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "commissionAmount" DECIMAL(65,30),
    "linkedMenuItemId" TEXT,
    "linkedMenuItemName" TEXT,
    "linkedMenuItemPrice" DECIMAL(65,30),
    "spiritTier" TEXT,
    "linkedBottleProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

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
    "amount" DECIMAL(65,30) NOT NULL,
    "tipAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "amountTendered" DECIMAL(65,30),
    "changeGiven" DECIMAL(65,30),
    "roundingAdjustment" DECIMAL(65,30),
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "authCode" TEXT,
    "transactionId" TEXT,
    "paymentReaderId" TEXT,
    "datacapRefNumber" TEXT,
    "datacapRecordNo" TEXT,
    "datacapSequenceNo" TEXT,
    "entryMethod" TEXT,
    "amountRequested" DECIMAL(65,30),
    "amountAuthorized" DECIMAL(65,30),
    "signatureData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "refundedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "offlineIntentId" TEXT,
    "idempotencyKey" TEXT,
    "isOfflineCapture" BOOLEAN NOT NULL DEFAULT false,
    "offlineCapturedAt" TIMESTAMP(3),
    "offlineTerminalId" TEXT,
    "cashDiscountAmount" DECIMAL(65,30),
    "priceBeforeDiscount" DECIMAL(65,30),
    "pricingMode" TEXT,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "wasDuplicateBlocked" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

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
    "amount" DECIMAL(65,30) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "localIntentId" TEXT,
    "status" TEXT NOT NULL,
    "statusNote" TEXT,
    "cardLast4" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "discountValue" DECIMAL(65,30) NOT NULL,
    "freeItemId" TEXT,
    "minimumOrder" DECIMAL(65,30),
    "maximumDiscount" DECIMAL(65,30),
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
    "discountAmount" DECIMAL(65,30) NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "specialRequests" TEXT,
    "internalNotes" TEXT,
    "customerId" TEXT,
    "orderId" TEXT,
    "createdBy" TEXT,
    "seatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
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
    "name" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "percent" DECIMAL(65,30),
    "appliedBy" TEXT,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "OrderDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellConfig" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerItemId" TEXT,
    "triggerCategoryId" TEXT,
    "triggerCondition" JSONB,
    "suggestionType" TEXT NOT NULL,
    "suggestionItemId" TEXT,
    "suggestionCategoryId" TEXT,
    "promptText" TEXT NOT NULL,
    "displayMode" TEXT NOT NULL DEFAULT 'inline',
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "triggerOnAdd" BOOLEAN NOT NULL DEFAULT true,
    "triggerBeforeSend" BOOLEAN NOT NULL DEFAULT false,
    "triggerAtPayment" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "UpsellConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellEvent" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "upsellConfigId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "wasShown" BOOLEAN NOT NULL DEFAULT true,
    "wasAccepted" BOOLEAN NOT NULL DEFAULT false,
    "wasDismissed" BOOLEAN NOT NULL DEFAULT false,
    "addedAmount" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "UpsellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoidLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "voidType" TEXT NOT NULL,
    "itemId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
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
    "amount" DECIMAL(65,30) NOT NULL,
    "itemName" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "managerId" TEXT NOT NULL,
    "managerPhone" TEXT NOT NULL,
    "twilioMessageSid" TEXT,
    "approvalToken" TEXT NOT NULL,
    "approvalTokenExpiry" TIMESTAMP(3) NOT NULL,
    "approvalCode" TEXT,
    "approvalCodeExpiry" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipPoolEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tipPoolId" TEXT NOT NULL,
    "shiftDate" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "distributions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipPoolEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipOutRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fromRoleId" TEXT NOT NULL,
    "toRoleId" TEXT NOT NULL,
    "percentage" DECIMAL(65,30) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "basisType" TEXT NOT NULL DEFAULT 'tips_earned',
    "salesCategoryIds" JSONB,
    "maxPercentage" DECIMAL(65,30),
    "effectiveDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
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
    "amount" DECIMAL(65,30) NOT NULL,
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
    "currentBalanceCents" INTEGER NOT NULL DEFAULT 0,
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
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "memo" TEXT,
    "adjustmentId" TEXT,
    "shiftId" TEXT,
    "orderId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "amountCents" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'tip',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "primaryEmployeeId" TEXT,
    "ccFeeAmountCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "defaultSplitMode" TEXT NOT NULL DEFAULT 'equal',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
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
    "status" TEXT NOT NULL DEFAULT 'active',
    "splitMode" TEXT NOT NULL DEFAULT 'equal',
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
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "TipGroupSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipDebt" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "originalAmountCents" INTEGER NOT NULL,
    "remainingCents" INTEGER NOT NULL,
    "sourcePaymentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'CHARGEBACK',
    "memo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
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
    "orderOwnershipId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sharePercent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "OrderOwnershipEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipAdjustment" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustmentType" TEXT NOT NULL,
    "contextJson" TEXT NOT NULL,
    "autoRecalcRan" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "amountCents" INTEGER NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'employee',
    "overrideReason" TEXT,
    "overrideBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "initialBalance" DECIMAL(65,30) NOT NULL,
    "currentBalance" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "amount" DECIMAL(65,30) NOT NULL,
    "balanceBefore" DECIMAL(65,30) NOT NULL,
    "balanceAfter" DECIMAL(65,30) NOT NULL,
    "orderId" TEXT,
    "employeeId" TEXT,
    "notes" TEXT,
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
    "creditLimit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paymentTerms" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "lastBilledAt" TIMESTAMP(3),
    "nextBillDate" TIMESTAMP(3),
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "taxId" TEXT,
    "customerId" TEXT,
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
    "amount" DECIMAL(65,30) NOT NULL,
    "balanceBefore" DECIMAL(65,30) NOT NULL,
    "balanceAfter" DECIMAL(65,30) NOT NULL,
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
    "totalCharge" DECIMAL(65,30),
    "rateType" TEXT NOT NULL DEFAULT 'hourly',
    "rateAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "seatType" TEXT NOT NULL DEFAULT 'standard',
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,
    "sourceOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "currentOrderItemId" TEXT,
    "lastOccupiedAt" TIMESTAMP(3),
    "lastOccupiedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "status" TEXT NOT NULL DEFAULT 'draft',
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
    "price" DECIMAL(65,30) NOT NULL,
    "serviceFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
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
    "basePrice" DECIMAL(65,30) NOT NULL,
    "serviceFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
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
    "refundAmount" DECIMAL(65,30),
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
    "rate" DECIMAL(65,30) NOT NULL,
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
    "unitCost" DECIMAL(65,30),
    "totalCost" DECIMAL(65,30),
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
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "purchaseSize" DECIMAL(65,30) NOT NULL,
    "purchaseCost" DECIMAL(65,30) NOT NULL,
    "defaultVendorId" TEXT,
    "storageUnit" TEXT NOT NULL,
    "unitsPerPurchase" DECIMAL(65,30) NOT NULL,
    "costPerUnit" DECIMAL(65,30) NOT NULL,
    "costingMethod" TEXT NOT NULL DEFAULT 'weighted_average',
    "lastPriceUpdate" TIMESTAMP(3),
    "priceSource" TEXT NOT NULL DEFAULT 'manual',
    "yieldPercent" DECIMAL(65,30) NOT NULL DEFAULT 100,
    "yieldCostPerUnit" DECIMAL(65,30),
    "spiritCategoryId" TEXT,
    "pourSizeOz" DECIMAL(65,30),
    "proofPercent" DECIMAL(65,30),
    "currentStock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "parLevel" DECIMAL(65,30),
    "reorderPoint" DECIMAL(65,30),
    "reorderQty" DECIMAL(65,30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
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
    "currentStock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "parLevel" DECIMAL(65,30),
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
    "batchYield" DECIMAL(65,30) NOT NULL,
    "batchUnit" TEXT NOT NULL,
    "costPerUnit" DECIMAL(65,30),
    "shelfLifeHours" INTEGER,
    "storageNotes" TEXT,
    "isDailyCountItem" BOOLEAN NOT NULL DEFAULT false,
    "currentPrepStock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastCountedAt" TIMESTAMP(3),
    "lowStockThreshold" DECIMAL(65,30),
    "criticalStockThreshold" DECIMAL(65,30),
    "onlineStockThreshold" DECIMAL(65,30),
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
    "quantity" DECIMAL(65,30) NOT NULL,
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
    "totalCost" DECIMAL(65,30),
    "foodCostPct" DECIMAL(65,30),
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
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "cost" DECIMAL(65,30),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
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
    "usageQuantity" DECIMAL(65,30) NOT NULL,
    "usageUnit" TEXT NOT NULL,
    "calculatedCost" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ModifierInventoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "storageLocationId" TEXT,
    "startedById" TEXT,
    "completedById" TEXT,
    "reviewedById" TEXT,
    "expectedValue" DECIMAL(65,30),
    "countedValue" DECIMAL(65,30),
    "varianceValue" DECIMAL(65,30),
    "variancePct" DECIMAL(65,30),
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
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
    "expectedQty" DECIMAL(65,30) NOT NULL,
    "countedQty" DECIMAL(65,30),
    "variance" DECIMAL(65,30),
    "varianceValue" DECIMAL(65,30),
    "variancePct" DECIMAL(65,30),
    "countedAt" TIMESTAMP(3),
    "notes" TEXT,
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
    "quantityBefore" DECIMAL(65,30) NOT NULL,
    "quantityChange" DECIMAL(65,30) NOT NULL,
    "quantityAfter" DECIMAL(65,30) NOT NULL,
    "unitCost" DECIMAL(65,30),
    "totalCost" DECIMAL(65,30),
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "dueDate" TIMESTAMP(3),
    "receivedDate" TIMESTAMP(3),
    "subtotal" DECIMAL(65,30) NOT NULL,
    "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidDate" TIMESTAMP(3),
    "updateCosts" BOOLEAN NOT NULL DEFAULT true,
    "addToInventory" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "enteredById" TEXT,
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
    "description" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitCost" DECIMAL(65,30) NOT NULL,
    "totalCost" DECIMAL(65,30) NOT NULL,
    "previousCost" DECIMAL(65,30),
    "costChange" DECIMAL(65,30),
    "costChangePct" DECIMAL(65,30),
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
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "costImpact" DECIMAL(65,30),
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "employeeId" TEXT,
    "wasteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "varianceAlertPct" DECIMAL(65,30) NOT NULL DEFAULT 5,
    "costChangeAlertPct" DECIMAL(65,30) NOT NULL DEFAULT 10,
    "targetFoodCostPct" DECIMAL(65,30),
    "targetLiquorCostPct" DECIMAL(65,30),
    "multiplierLite" DECIMAL(65,30) NOT NULL DEFAULT 0.5,
    "multiplierExtra" DECIMAL(65,30) NOT NULL DEFAULT 2.0,
    "multiplierTriple" DECIMAL(65,30) NOT NULL DEFAULT 3.0,
    "defaultPourSizeOz" DECIMAL(65,30) NOT NULL DEFAULT 1.5,
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
    "breakType" TEXT NOT NULL DEFAULT 'unpaid',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "displayName" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "bottleSizeOz" DECIMAL(65,30),
    "unitCost" DECIMAL(65,30) NOT NULL,
    "pourSizeOz" DECIMAL(65,30),
    "poursPerBottle" INTEGER,
    "pourCost" DECIMAL(65,30),
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "lowStockAlert" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "bottleProductId" TEXT NOT NULL,
    "pourCount" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "pourSizeOz" DECIMAL(65,30),
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isSubstitutable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
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
    "priceDifference" DECIMAL(65,30) NOT NULL,
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
    "standardQuantity" DECIMAL(65,30),
    "standardUnit" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'delivered',
    "purchaseUnit" TEXT,
    "purchaseCost" DECIMAL(65,30),
    "unitsPerPurchase" DECIMAL(65,30),
    "allowNo" BOOLEAN NOT NULL DEFAULT true,
    "allowLite" BOOLEAN NOT NULL DEFAULT true,
    "allowExtra" BOOLEAN NOT NULL DEFAULT true,
    "allowOnSide" BOOLEAN NOT NULL DEFAULT false,
    "extraPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "liteMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 0.5,
    "extraMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 2.0,
    "allowSwap" BOOLEAN NOT NULL DEFAULT false,
    "swapGroupId" TEXT,
    "swapUpcharge" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'visible',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentIngredientId" TEXT,
    "preparationType" TEXT,
    "yieldPercent" DECIMAL(65,30),
    "batchYield" DECIMAL(65,30),
    "inputQuantity" DECIMAL(65,30),
    "inputUnit" TEXT,
    "outputQuantity" DECIMAL(65,30) DEFAULT 1,
    "outputUnit" TEXT DEFAULT 'each',
    "recipeYieldQuantity" DECIMAL(65,30),
    "recipeYieldUnit" TEXT,
    "portionSize" DECIMAL(65,30),
    "portionUnit" TEXT,
    "isDailyCountItem" BOOLEAN NOT NULL DEFAULT false,
    "currentPrepStock" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "lastCountedAt" TIMESTAMP(3),
    "countPrecision" TEXT NOT NULL DEFAULT 'whole',
    "lowStockThreshold" DECIMAL(65,30),
    "criticalStockThreshold" DECIMAL(65,30),
    "onlineStockThreshold" DECIMAL(65,30),
    "resetDailyToZero" BOOLEAN NOT NULL DEFAULT true,
    "varianceHandling" TEXT NOT NULL DEFAULT 'auto_adjust',
    "varianceThreshold" DECIMAL(65,30) NOT NULL DEFAULT 10,
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
    "quantityBefore" DECIMAL(65,30) NOT NULL,
    "quantityChange" DECIMAL(65,30) NOT NULL,
    "quantityAfter" DECIMAL(65,30) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(65,30),
    "totalCostImpact" DECIMAL(65,30),
    "employeeId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
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
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "batchSize" DECIMAL(65,30),
    "batchUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
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
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "quantity" DECIMAL(65,30),
    "unit" TEXT,
    "allowNo" BOOLEAN,
    "allowLite" BOOLEAN,
    "allowExtra" BOOLEAN,
    "allowOnSide" BOOLEAN,
    "extraPrice" DECIMAL(65,30),
    "isBase" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
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
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allowNo" BOOLEAN NOT NULL DEFAULT true,
    "allowLite" BOOLEAN NOT NULL DEFAULT false,
    "allowOnSide" BOOLEAN NOT NULL DEFAULT false,
    "allowExtra" BOOLEAN NOT NULL DEFAULT false,
    "extraPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "priceAdjustment" DECIMAL(65,30) NOT NULL DEFAULT 0,
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
    "printerType" TEXT NOT NULL,
    "model" TEXT,
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "printerRole" TEXT NOT NULL DEFAULT 'kitchen',
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
    "type" TEXT NOT NULL,
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
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'FIXED_STATION',
    "staticIp" TEXT,
    "deviceToken" TEXT,
    "pairingCode" TEXT,
    "pairingCodeExpiresAt" TIMESTAMP(3),
    "isPaired" BOOLEAN NOT NULL DEFAULT false,
    "deviceFingerprint" TEXT,
    "lastKnownIp" TEXT,
    "deviceInfo" JSONB,
    "receiptPrinterId" TEXT,
    "roleSkipRules" JSONB,
    "forceAllPrints" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "backupTerminalId" TEXT,
    "failoverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failoverTimeout" INTEGER NOT NULL DEFAULT 45000,
    "paymentReaderId" TEXT,
    "paymentProvider" TEXT NOT NULL DEFAULT 'SIMULATED',
    "backupPaymentReaderId" TEXT,
    "readerFailoverTimeout" INTEGER NOT NULL DEFAULT 10000,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReader" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 8080,
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
    "successRate" DECIMAL(65,30),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentReader_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintRule" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT,
    "ruleLevel" TEXT NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'pending',
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
    "sectionOptions" JSONB NOT NULL DEFAULT '[1, 2, 4, 8]',
    "pricingMode" TEXT NOT NULL DEFAULT 'fractional',
    "hybridPricing" JSONB,
    "freeToppingsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "freeToppingsCount" INTEGER NOT NULL DEFAULT 0,
    "freeToppingsMode" TEXT NOT NULL DEFAULT 'per_pizza',
    "extraToppingPrice" DECIMAL(65,30),
    "showVisualBuilder" BOOLEAN NOT NULL DEFAULT true,
    "showToppingList" BOOLEAN NOT NULL DEFAULT true,
    "defaultToListView" BOOLEAN NOT NULL DEFAULT false,
    "builderMode" TEXT NOT NULL DEFAULT 'both',
    "defaultBuilderMode" TEXT NOT NULL DEFAULT 'quick',
    "allowModeSwitch" BOOLEAN NOT NULL DEFAULT true,
    "printerIds" JSONB,
    "printSettings" JSONB,
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
    "basePrice" DECIMAL(65,30) NOT NULL,
    "priceMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "toppingMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "freeToppings" INTEGER NOT NULL DEFAULT 0,
    "inventoryMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(65,30),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allowLight" BOOLEAN NOT NULL DEFAULT true,
    "allowExtra" BOOLEAN NOT NULL DEFAULT true,
    "extraPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(65,30),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "price" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "allowLight" BOOLEAN NOT NULL DEFAULT true,
    "allowExtra" BOOLEAN NOT NULL DEFAULT true,
    "extraPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(65,30),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "price" DECIMAL(65,30) NOT NULL,
    "extraPrice" DECIMAL(65,30),
    "color" TEXT,
    "iconUrl" TEXT,
    "inventoryItemId" TEXT,
    "usageQuantity" DECIMAL(65,30),
    "usageUnit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
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
    "toppingsData" JSONB NOT NULL,
    "cookingInstructions" TEXT,
    "cutStyle" TEXT,
    "sizePrice" DECIMAL(65,30) NOT NULL,
    "crustPrice" DECIMAL(65,30) NOT NULL,
    "saucePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cheesePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "toppingsPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "totalRegularHours" DECIMAL(65,30),
    "totalOvertimeHours" DECIMAL(65,30),
    "totalWages" DECIMAL(65,30),
    "totalTips" DECIMAL(65,30),
    "totalCommissions" DECIMAL(65,30),
    "totalBankedTips" DECIMAL(65,30),
    "grandTotal" DECIMAL(65,30),
    "notes" TEXT,
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
    "regularHours" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "regularPay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "declaredTips" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tipSharesGiven" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "tipSharesReceived" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bankedTipsCollected" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "netTips" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "federalTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "stateTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "socialSecurityTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "medicareTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "localTax" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "deductions" JSONB,
    "netPay" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "checkNumber" TEXT,
    "shiftCount" INTEGER NOT NULL DEFAULT 0,
    "shiftIds" JSONB,
    "timeEntryIds" JSONB,
    "paymentMethod" TEXT,
    "paymentRef" TEXT,
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
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
    "status" TEXT NOT NULL DEFAULT 'draft',
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
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "actualStartTime" TIMESTAMP(3),
    "actualEndTime" TIMESTAMP(3),
    "actualHours" DECIMAL(65,30),
    "originalEmployeeId" TEXT,
    "swappedAt" TIMESTAMP(3),
    "swapApprovedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "availableFrom" TEXT,
    "availableTo" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "preference" TEXT NOT NULL DEFAULT 'available',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "AvailabilityEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "payPeriodType" TEXT NOT NULL DEFAULT 'biweekly',
    "payDayOfWeek" INTEGER,
    "payDayOfMonth1" INTEGER,
    "payDayOfMonth2" INTEGER,
    "overtimeThresholdDaily" DECIMAL(65,30) NOT NULL DEFAULT 8,
    "overtimeThresholdWeekly" DECIMAL(65,30) NOT NULL DEFAULT 40,
    "overtimeMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.5,
    "doubleTimeThreshold" DECIMAL(65,30),
    "doubleTimeMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 2.0,
    "stateTaxState" TEXT,
    "stateTaxRate" DECIMAL(65,30),
    "localTaxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "localTaxRate" DECIMAL(65,30),
    "localTaxName" TEXT,
    "socialSecurityRate" DECIMAL(65,30) NOT NULL DEFAULT 6.2,
    "medicareRate" DECIMAL(65,30) NOT NULL DEFAULT 1.45,
    "socialSecurityWageBase" DECIMAL(65,30) NOT NULL DEFAULT 168600,
    "minimumWage" DECIMAL(65,30) NOT NULL DEFAULT 7.25,
    "tippedMinimumWage" DECIMAL(65,30) NOT NULL DEFAULT 2.13,
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
    "capacity" DECIMAL(65,30) NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
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
    "totalCounted" DECIMAL(65,30) NOT NULL,
    "expectedQuantity" DECIMAL(65,30),
    "variance" DECIMAL(65,30),
    "variancePercent" DECIMAL(65,30),
    "costPerUnit" DECIMAL(65,30),
    "totalCost" DECIMAL(65,30),
    "notes" TEXT,
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
    "quantityBefore" DECIMAL(65,30) NOT NULL,
    "quantityChange" DECIMAL(65,30) NOT NULL,
    "quantityAfter" DECIMAL(65,30) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(65,30),
    "totalCost" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    "authAmount" DECIMAL(65,30) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'authorized',
    "capturedAmount" DECIMAL(65,30),
    "capturedAt" TIMESTAMP(3),
    "tipAmount" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

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
    "amount" DECIMAL(65,30) NOT NULL,
    "chargebackDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "reasonCode" TEXT,
    "responseDeadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "responseNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
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
    "totalSpend" DECIMAL(65,30) NOT NULL DEFAULT 0,
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
    "amount" DECIMAL(65,30) NOT NULL,
    "nextRetryAt" TIMESTAMP(3) NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'pending',
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
    "depositAmount" DECIMAL(65,30) NOT NULL,
    "minimumSpend" DECIMAL(65,30) NOT NULL,
    "autoGratuityPercent" DECIMAL(65,30),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "BottleServiceTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
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
    "status" TEXT NOT NULL DEFAULT 'NEW',
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
CREATE TABLE "PerformanceLog" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "context" TEXT,
    "stackTrace" TEXT,
    "path" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "PerformanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseTime" INTEGER,
    "errorMessage" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
CREATE INDEX "Shift_locationId_idx" ON "Shift"("locationId");

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
CREATE INDEX "Drawer_locationId_idx" ON "Drawer"("locationId");

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
CREATE INDEX "Category_locationId_idx" ON "Category"("locationId");

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
CREATE INDEX "MenuItem_locationId_idx" ON "MenuItem"("locationId");

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
CREATE INDEX "MenuItemModifierGroup_locationId_idx" ON "MenuItemModifierGroup"("locationId");

-- CreateIndex
CREATE INDEX "MenuItemModifierGroup_modifierGroupId_idx" ON "MenuItemModifierGroup"("modifierGroupId");

-- CreateIndex
CREATE INDEX "MenuItemModifierGroup_menuItemId_idx" ON "MenuItemModifierGroup"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemModifierGroup_menuItemId_modifierGroupId_key" ON "MenuItemModifierGroup"("menuItemId", "modifierGroupId");

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
CREATE INDEX "Section_locationId_idx" ON "Section"("locationId");

-- CreateIndex
CREATE INDEX "SectionAssignment_locationId_idx" ON "SectionAssignment"("locationId");

-- CreateIndex
CREATE INDEX "SectionAssignment_sectionId_idx" ON "SectionAssignment"("sectionId");

-- CreateIndex
CREATE INDEX "SectionAssignment_employeeId_idx" ON "SectionAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "SectionAssignment_sectionId_unassignedAt_deletedAt_idx" ON "SectionAssignment"("sectionId", "unassignedAt", "deletedAt");

-- CreateIndex
CREATE INDEX "Table_locationId_idx" ON "Table"("locationId");

-- CreateIndex
CREATE INDEX "Table_sectionId_idx" ON "Table"("sectionId");

-- CreateIndex
CREATE INDEX "Table_status_idx" ON "Table"("status");

-- CreateIndex
CREATE INDEX "Table_locationId_status_idx" ON "Table"("locationId", "status");

-- CreateIndex
CREATE INDEX "Table_locationId_isActive_deletedAt_idx" ON "Table"("locationId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "Table_locationId_sectionId_idx" ON "Table"("locationId", "sectionId");

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
CREATE INDEX "OrderType_locationId_idx" ON "OrderType"("locationId");

-- CreateIndex
CREATE INDEX "OrderType_sortOrder_idx" ON "OrderType"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "OrderType_locationId_slug_key" ON "OrderType"("locationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Order_offlineId_key" ON "Order"("offlineId");

-- CreateIndex
CREATE INDEX "Order_locationId_idx" ON "Order"("locationId");

-- CreateIndex
CREATE INDEX "Order_employeeId_idx" ON "Order"("employeeId");

-- CreateIndex
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_openedAt_idx" ON "Order"("openedAt");

-- CreateIndex
CREATE INDEX "Order_orderNumber_locationId_idx" ON "Order"("orderNumber", "locationId");

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
CREATE INDEX "OrderItemModifier_locationId_idx" ON "OrderItemModifier"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_orderItemId_idx" ON "OrderItemModifier"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_spiritTier_idx" ON "OrderItemModifier"("spiritTier");

-- CreateIndex
CREATE INDEX "OrderItemModifier_linkedMenuItemId_idx" ON "OrderItemModifier"("linkedMenuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_offlineIntentId_key" ON "Payment"("offlineIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_locationId_idx" ON "Payment"("locationId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_processedAt_idx" ON "Payment"("processedAt");

-- CreateIndex
CREATE INDEX "Payment_employeeId_idx" ON "Payment"("employeeId");

-- CreateIndex
CREATE INDEX "Payment_isOfflineCapture_idx" ON "Payment"("isOfflineCapture");

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
CREATE INDEX "SyncAuditEntry_locationId_idx" ON "SyncAuditEntry"("locationId");

-- CreateIndex
CREATE INDEX "SyncAuditEntry_orderId_idx" ON "SyncAuditEntry"("orderId");

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
CREATE INDEX "Coupon_locationId_idx" ON "Coupon"("locationId");

-- CreateIndex
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_isActive_idx" ON "Coupon"("isActive");

-- CreateIndex
CREATE INDEX "Coupon_locationId_isActive_validUntil_idx" ON "Coupon"("locationId", "isActive", "validUntil");

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
CREATE INDEX "Reservation_locationId_idx" ON "Reservation"("locationId");

-- CreateIndex
CREATE INDEX "Reservation_reservationDate_idx" ON "Reservation"("reservationDate");

-- CreateIndex
CREATE INDEX "Reservation_status_idx" ON "Reservation"("status");

-- CreateIndex
CREATE INDEX "Reservation_tableId_idx" ON "Reservation"("tableId");

-- CreateIndex
CREATE INDEX "Reservation_customerId_idx" ON "Reservation"("customerId");

-- CreateIndex
CREATE INDEX "Reservation_locationId_reservationDate_status_idx" ON "Reservation"("locationId", "reservationDate", "status");

-- CreateIndex
CREATE INDEX "DiscountRule_locationId_idx" ON "DiscountRule"("locationId");

-- CreateIndex
CREATE INDEX "DiscountRule_isActive_isAutomatic_idx" ON "DiscountRule"("isActive", "isAutomatic");

-- CreateIndex
CREATE INDEX "DiscountRule_locationId_isActive_idx" ON "DiscountRule"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "OrderDiscount_locationId_idx" ON "OrderDiscount"("locationId");

-- CreateIndex
CREATE INDEX "OrderDiscount_orderId_idx" ON "OrderDiscount"("orderId");

-- CreateIndex
CREATE INDEX "UpsellConfig_locationId_idx" ON "UpsellConfig"("locationId");

-- CreateIndex
CREATE INDEX "UpsellEvent_locationId_idx" ON "UpsellEvent"("locationId");

-- CreateIndex
CREATE INDEX "UpsellEvent_upsellConfigId_idx" ON "UpsellEvent"("upsellConfigId");

-- CreateIndex
CREATE INDEX "UpsellEvent_createdAt_idx" ON "UpsellEvent"("createdAt");

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
CREATE INDEX "TipPool_locationId_idx" ON "TipPool"("locationId");

-- CreateIndex
CREATE INDEX "TipPoolEntry_locationId_idx" ON "TipPoolEntry"("locationId");

-- CreateIndex
CREATE INDEX "TipPoolEntry_tipPoolId_idx" ON "TipPoolEntry"("tipPoolId");

-- CreateIndex
CREATE INDEX "TipPoolEntry_shiftDate_idx" ON "TipPoolEntry"("shiftDate");

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
CREATE UNIQUE INDEX "TipLedger_employeeId_key" ON "TipLedger"("employeeId");

-- CreateIndex
CREATE INDEX "TipLedger_locationId_idx" ON "TipLedger"("locationId");

-- CreateIndex
CREATE INDEX "TipLedger_employeeId_idx" ON "TipLedger"("employeeId");

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
CREATE INDEX "GiftCard_locationId_idx" ON "GiftCard"("locationId");

-- CreateIndex
CREATE INDEX "GiftCard_cardNumber_idx" ON "GiftCard"("cardNumber");

-- CreateIndex
CREATE INDEX "GiftCard_status_idx" ON "GiftCard"("status");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_locationId_idx" ON "GiftCardTransaction"("locationId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_giftCardId_idx" ON "GiftCardTransaction"("giftCardId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_orderId_idx" ON "GiftCardTransaction"("orderId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_createdAt_idx" ON "GiftCardTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "HouseAccount_locationId_idx" ON "HouseAccount"("locationId");

-- CreateIndex
CREATE INDEX "HouseAccount_status_idx" ON "HouseAccount"("status");

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
CREATE INDEX "InventoryItemTransaction_locationId_idx" ON "InventoryItemTransaction"("locationId");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_inventoryItemId_idx" ON "InventoryItemTransaction"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_type_idx" ON "InventoryItemTransaction"("type");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_createdAt_idx" ON "InventoryItemTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryItemTransaction_inventoryItemId_createdAt_idx" ON "InventoryItemTransaction"("inventoryItemId", "createdAt");

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
CREATE UNIQUE INDEX "BottleProduct_inventoryItemId_key" ON "BottleProduct"("inventoryItemId");

-- CreateIndex
CREATE INDEX "BottleProduct_locationId_idx" ON "BottleProduct"("locationId");

-- CreateIndex
CREATE INDEX "BottleProduct_spiritCategoryId_idx" ON "BottleProduct"("spiritCategoryId");

-- CreateIndex
CREATE INDEX "BottleProduct_tier_idx" ON "BottleProduct"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "BottleProduct_locationId_name_key" ON "BottleProduct"("locationId", "name");

-- CreateIndex
CREATE INDEX "RecipeIngredient_locationId_idx" ON "RecipeIngredient"("locationId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_menuItemId_idx" ON "RecipeIngredient"("menuItemId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_bottleProductId_idx" ON "RecipeIngredient"("bottleProductId");

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
CREATE UNIQUE INDEX "MenuItemIngredient_menuItemId_ingredientId_key" ON "MenuItemIngredient"("menuItemId", "ingredientId");

-- CreateIndex
CREATE INDEX "ModifierGroupTemplate_locationId_idx" ON "ModifierGroupTemplate"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroupTemplate_locationId_name_key" ON "ModifierGroupTemplate"("locationId", "name");

-- CreateIndex
CREATE INDEX "ModifierTemplate_templateId_idx" ON "ModifierTemplate"("templateId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_locationId_idx" ON "OrderItemIngredient"("locationId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_orderItemId_idx" ON "OrderItemIngredient"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_modificationType_idx" ON "OrderItemIngredient"("modificationType");

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
CREATE UNIQUE INDEX "Terminal_deviceToken_key" ON "Terminal"("deviceToken");

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
CREATE UNIQUE INDEX "Terminal_locationId_name_key" ON "Terminal"("locationId", "name");

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
CREATE UNIQUE INDEX "PaymentReader_locationId_ipAddress_key" ON "PaymentReader"("locationId", "ipAddress");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReader_locationId_name_key" ON "PaymentReader"("locationId", "name");

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
CREATE INDEX "AvailabilityEntry_locationId_idx" ON "AvailabilityEntry"("locationId");

-- CreateIndex
CREATE INDEX "AvailabilityEntry_employeeId_idx" ON "AvailabilityEntry"("employeeId");

-- CreateIndex
CREATE INDEX "AvailabilityEntry_dayOfWeek_idx" ON "AvailabilityEntry"("dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityEntry_employeeId_dayOfWeek_effectiveFrom_key" ON "AvailabilityEntry"("employeeId", "dayOfWeek", "effectiveFrom");

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
CREATE UNIQUE INDEX "DigitalReceipt_orderId_key" ON "DigitalReceipt"("orderId");

-- CreateIndex
CREATE INDEX "DigitalReceipt_locationId_idx" ON "DigitalReceipt"("locationId");

-- CreateIndex
CREATE INDEX "DigitalReceipt_locationId_createdAt_idx" ON "DigitalReceipt"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalReceipt_paymentId_idx" ON "DigitalReceipt"("paymentId");

-- CreateIndex
CREATE INDEX "ChargebackCase_locationId_idx" ON "ChargebackCase"("locationId");

-- CreateIndex
CREATE INDEX "ChargebackCase_cardLast4_idx" ON "ChargebackCase"("cardLast4");

-- CreateIndex
CREATE INDEX "ChargebackCase_status_idx" ON "ChargebackCase"("status");

-- CreateIndex
CREATE INDEX "ChargebackCase_chargebackDate_idx" ON "ChargebackCase"("chargebackDate");

-- CreateIndex
CREATE INDEX "CardProfile_locationId_cardLast4_idx" ON "CardProfile"("locationId", "cardLast4");

-- CreateIndex
CREATE INDEX "CardProfile_locationId_idx" ON "CardProfile"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CardProfile_locationId_cardholderIdHash_key" ON "CardProfile"("locationId", "cardholderIdHash");

-- CreateIndex
CREATE INDEX "WalkoutRetry_locationId_idx" ON "WalkoutRetry"("locationId");

-- CreateIndex
CREATE INDEX "WalkoutRetry_status_idx" ON "WalkoutRetry"("status");

-- CreateIndex
CREATE INDEX "WalkoutRetry_nextRetryAt_idx" ON "WalkoutRetry"("nextRetryAt");

-- CreateIndex
CREATE INDEX "BottleServiceTier_locationId_idx" ON "BottleServiceTier"("locationId");

-- CreateIndex
CREATE INDEX "BottleServiceTier_locationId_isActive_idx" ON "BottleServiceTier"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "ErrorLog_locationId_idx" ON "ErrorLog"("locationId");

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
CREATE INDEX "PerformanceLog_locationId_idx" ON "PerformanceLog"("locationId");

-- CreateIndex
CREATE INDEX "PerformanceLog_operation_idx" ON "PerformanceLog"("operation");

-- CreateIndex
CREATE INDEX "PerformanceLog_duration_idx" ON "PerformanceLog"("duration");

-- CreateIndex
CREATE INDEX "PerformanceLog_createdAt_idx" ON "PerformanceLog"("createdAt");

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

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboTemplate" ADD CONSTRAINT "ComboTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorPlanElement" ADD CONSTRAINT "FloorPlanElement_linkedMenuItemId_fkey" FOREIGN KEY ("linkedMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentWaitlist" ADD CONSTRAINT "EntertainmentWaitlist_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentWaitlist" ADD CONSTRAINT "EntertainmentWaitlist_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "FloorPlanElement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntertainmentWaitlist" ADD CONSTRAINT "EntertainmentWaitlist_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderType" ADD CONSTRAINT "OrderType_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderTypeId_fkey" FOREIGN KEY ("orderTypeId") REFERENCES "OrderType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sourceTableId_fkey" FOREIGN KEY ("sourceTableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncAuditEntry" ADD CONSTRAINT "SyncAuditEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRule" ADD CONSTRAINT "DiscountRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellConfig" ADD CONSTRAINT "UpsellConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellConfig" ADD CONSTRAINT "UpsellConfig_triggerItemId_fkey" FOREIGN KEY ("triggerItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellConfig" ADD CONSTRAINT "UpsellConfig_suggestionItemId_fkey" FOREIGN KEY ("suggestionItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellEvent" ADD CONSTRAINT "UpsellEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellEvent" ADD CONSTRAINT "UpsellEvent_upsellConfigId_fkey" FOREIGN KEY ("upsellConfigId") REFERENCES "UpsellConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_remoteApprovalId_fkey" FOREIGN KEY ("remoteApprovalId") REFERENCES "RemoteVoidApproval"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemoteVoidApproval" ADD CONSTRAINT "RemoteVoidApproval_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPool" ADD CONSTRAINT "TipPool_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPoolEntry" ADD CONSTRAINT "TipPoolEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPoolEntry" ADD CONSTRAINT "TipPoolEntry_tipPoolId_fkey" FOREIGN KEY ("tipPoolId") REFERENCES "TipPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "TipTransaction" ADD CONSTRAINT "TipTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroupTemplate" ADD CONSTRAINT "TipGroupTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipGroup" ADD CONSTRAINT "TipGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "OrderOwnership" ADD CONSTRAINT "OrderOwnership_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderOwnership" ADD CONSTRAINT "OrderOwnership_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccount" ADD CONSTRAINT "HouseAccount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccount" ADD CONSTRAINT "HouseAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccountTransaction" ADD CONSTRAINT "HouseAccountTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseAccountTransaction" ADD CONSTRAINT "HouseAccountTransaction_houseAccountId_fkey" FOREIGN KEY ("houseAccountId") REFERENCES "HouseAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimedSession" ADD CONSTRAINT "TimedSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidReason" ADD CONSTRAINT "VoidReason_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "InventorySettings" ADD CONSTRAINT "InventorySettings_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Break" ADD CONSTRAINT "Break_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_bottleProductId_fkey" FOREIGN KEY ("bottleProductId") REFERENCES "BottleProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritModifierGroup" ADD CONSTRAINT "SpiritModifierGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritModifierGroup" ADD CONSTRAINT "SpiritModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritModifierGroup" ADD CONSTRAINT "SpiritModifierGroup_spiritCategoryId_fkey" FOREIGN KEY ("spiritCategoryId") REFERENCES "SpiritCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpiritUpsellEvent" ADD CONSTRAINT "SpiritUpsellEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "ModifierGroupTemplate" ADD CONSTRAINT "ModifierGroupTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierTemplate" ADD CONSTRAINT "ModifierTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ModifierGroupTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_receiptPrinterId_fkey" FOREIGN KEY ("receiptPrinterId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_backupTerminalId_fkey" FOREIGN KEY ("backupTerminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_paymentReaderId_fkey" FOREIGN KEY ("paymentReaderId") REFERENCES "PaymentReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_backupPaymentReaderId_fkey" FOREIGN KEY ("backupPaymentReaderId") REFERENCES "PaymentReader"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReader" ADD CONSTRAINT "PaymentReader_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "PrintRoute" ADD CONSTRAINT "PrintRoute_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaConfig" ADD CONSTRAINT "PizzaConfig_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSize" ADD CONSTRAINT "PizzaSize_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCrust" ADD CONSTRAINT "PizzaCrust_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCrust" ADD CONSTRAINT "PizzaCrust_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSauce" ADD CONSTRAINT "PizzaSauce_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaSauce" ADD CONSTRAINT "PizzaSauce_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCheese" ADD CONSTRAINT "PizzaCheese_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaCheese" ADD CONSTRAINT "PizzaCheese_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PizzaTopping" ADD CONSTRAINT "PizzaTopping_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "OrderItemPizza" ADD CONSTRAINT "OrderItemPizza_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "AvailabilityEntry" ADD CONSTRAINT "AvailabilityEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityEntry" ADD CONSTRAINT "AvailabilityEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "DigitalReceipt" ADD CONSTRAINT "DigitalReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargebackCase" ADD CONSTRAINT "ChargebackCase_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardProfile" ADD CONSTRAINT "CardProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkoutRetry" ADD CONSTRAINT "WalkoutRetry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottleServiceTier" ADD CONSTRAINT "BottleServiceTier_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorLog" ADD CONSTRAINT "ErrorLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceLog" ADD CONSTRAINT "PerformanceLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthCheck" ADD CONSTRAINT "HealthCheck_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerRegistrationToken" ADD CONSTRAINT "ServerRegistrationToken_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

