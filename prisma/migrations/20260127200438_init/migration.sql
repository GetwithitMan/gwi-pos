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
    "address" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "pin" TEXT NOT NULL,
    "password" TEXT,
    "hourlyRate" DECIMAL(10,2),
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
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
    "regularHours" DECIMAL(5,2),
    "overtimeHours" DECIMAL(5,2),
    "drawerCountIn" JSONB,
    "drawerCountOut" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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

    CONSTRAINT "Drawer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidInOut" (
    "id" TEXT NOT NULL,
    "drawerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "employeeId" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidInOut_pkey" PRIMARY KEY ("id")
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
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "defaultPrinterId" TEXT,
    "courseNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

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
    "cost" DECIMAL(10,2),
    "taxRate" DECIMAL(5,4),
    "isTaxExempt" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "showOnPOS" BOOLEAN NOT NULL DEFAULT true,
    "showOnline" BOOLEAN NOT NULL DEFAULT true,
    "printerId" TEXT,
    "prepTime" INTEGER,
    "courseNumber" INTEGER,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "currentStock" INTEGER,
    "lowStockAlert" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "itemType" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(10,2),
    "preModifier" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemModifierGroup" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MenuItemModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboTemplate" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "comparePrice" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponent" (
    "id" TEXT NOT NULL,
    "comboTemplateId" TEXT NOT NULL,
    "slotName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "minSelections" INTEGER NOT NULL DEFAULT 1,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "defaultItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComboComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponentOption" (
    "id" TEXT NOT NULL,
    "comboComponentId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "upcharge" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ComboComponentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectionAssignment" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "SectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sectionId" TEXT,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "posX" INTEGER NOT NULL DEFAULT 0,
    "posY" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 100,
    "height" INTEGER NOT NULL DEFAULT 100,
    "shape" TEXT NOT NULL DEFAULT 'rectangle',
    "status" TEXT NOT NULL DEFAULT 'available',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "displayNumber" TEXT,
    "orderType" TEXT NOT NULL DEFAULT 'dine_in',
    "tableId" TEXT,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "tabName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tipTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "seatNumber" INTEGER,
    "courseNumber" INTEGER,
    "courseStatus" TEXT NOT NULL DEFAULT 'pending',
    "isHeld" BOOLEAN NOT NULL DEFAULT false,
    "holdUntil" TIMESTAMP(3),
    "firedAt" TIMESTAMP(3),
    "kitchenStatus" TEXT NOT NULL DEFAULT 'pending',
    "specialNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidReason" TEXT,
    "modifierTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "itemTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemModifier" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "modifierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "preModifier" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "tipAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "authCode" TEXT,
    "transactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDiscount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountRuleId" TEXT,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "percent" DECIMAL(5,2),
    "appliedBy" TEXT,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

    CONSTRAINT "UpsellConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellEvent" (
    "id" TEXT NOT NULL,
    "upsellConfigId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "wasShown" BOOLEAN NOT NULL DEFAULT true,
    "wasAccepted" BOOLEAN NOT NULL DEFAULT false,
    "wasDismissed" BOOLEAN NOT NULL DEFAULT false,
    "addedAmount" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpsellEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoidLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "voidType" TEXT NOT NULL,
    "itemId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoidLog_pkey" PRIMARY KEY ("id")
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

    CONSTRAINT "TipPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipPoolEntry" (
    "id" TEXT NOT NULL,
    "tipPoolId" TEXT NOT NULL,
    "shiftDate" DATE NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "distributions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipPoolEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");

-- CreateIndex
CREATE INDEX "Role_locationId_idx" ON "Role"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_locationId_name_key" ON "Role"("locationId", "name");

-- CreateIndex
CREATE INDEX "Employee_locationId_idx" ON "Employee"("locationId");

-- CreateIndex
CREATE INDEX "Employee_roleId_idx" ON "Employee"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_locationId_pin_key" ON "Employee"("locationId", "pin");

-- CreateIndex
CREATE INDEX "TimeClockEntry_locationId_idx" ON "TimeClockEntry"("locationId");

-- CreateIndex
CREATE INDEX "TimeClockEntry_employeeId_idx" ON "TimeClockEntry"("employeeId");

-- CreateIndex
CREATE INDEX "TimeClockEntry_clockIn_idx" ON "TimeClockEntry"("clockIn");

-- CreateIndex
CREATE INDEX "Shift_locationId_idx" ON "Shift"("locationId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_idx" ON "Shift"("employeeId");

-- CreateIndex
CREATE INDEX "Shift_startedAt_idx" ON "Shift"("startedAt");

-- CreateIndex
CREATE INDEX "Drawer_locationId_idx" ON "Drawer"("locationId");

-- CreateIndex
CREATE INDEX "PaidInOut_drawerId_idx" ON "PaidInOut"("drawerId");

-- CreateIndex
CREATE INDEX "PaidInOut_createdAt_idx" ON "PaidInOut"("createdAt");

-- CreateIndex
CREATE INDEX "Category_locationId_idx" ON "Category"("locationId");

-- CreateIndex
CREATE INDEX "Category_sortOrder_idx" ON "Category"("sortOrder");

-- CreateIndex
CREATE INDEX "MenuItem_locationId_idx" ON "MenuItem"("locationId");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_isActive_showOnPOS_idx" ON "MenuItem"("isActive", "showOnPOS");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_locationId_sku_key" ON "MenuItem"("locationId", "sku");

-- CreateIndex
CREATE INDEX "ModifierGroup_locationId_idx" ON "ModifierGroup"("locationId");

-- CreateIndex
CREATE INDEX "Modifier_modifierGroupId_idx" ON "Modifier"("modifierGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemModifierGroup_menuItemId_modifierGroupId_key" ON "MenuItemModifierGroup"("menuItemId", "modifierGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboTemplate_menuItemId_key" ON "ComboTemplate"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponentOption_comboComponentId_menuItemId_key" ON "ComboComponentOption"("comboComponentId", "menuItemId");

-- CreateIndex
CREATE INDEX "Section_locationId_idx" ON "Section"("locationId");

-- CreateIndex
CREATE INDEX "SectionAssignment_sectionId_idx" ON "SectionAssignment"("sectionId");

-- CreateIndex
CREATE INDEX "SectionAssignment_employeeId_idx" ON "SectionAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "Table_locationId_idx" ON "Table"("locationId");

-- CreateIndex
CREATE INDEX "Table_sectionId_idx" ON "Table"("sectionId");

-- CreateIndex
CREATE INDEX "Table_status_idx" ON "Table"("status");

-- CreateIndex
CREATE INDEX "Order_locationId_idx" ON "Order"("locationId");

-- CreateIndex
CREATE INDEX "Order_employeeId_idx" ON "Order"("employeeId");

-- CreateIndex
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_openedAt_idx" ON "Order"("openedAt");

-- CreateIndex
CREATE INDEX "Order_orderNumber_locationId_idx" ON "Order"("orderNumber", "locationId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_menuItemId_idx" ON "OrderItem"("menuItemId");

-- CreateIndex
CREATE INDEX "OrderItem_kitchenStatus_idx" ON "OrderItem"("kitchenStatus");

-- CreateIndex
CREATE INDEX "OrderItemModifier_orderItemId_idx" ON "OrderItemModifier"("orderItemId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_processedAt_idx" ON "Payment"("processedAt");

-- CreateIndex
CREATE INDEX "DiscountRule_locationId_idx" ON "DiscountRule"("locationId");

-- CreateIndex
CREATE INDEX "DiscountRule_isActive_isAutomatic_idx" ON "DiscountRule"("isActive", "isAutomatic");

-- CreateIndex
CREATE INDEX "OrderDiscount_orderId_idx" ON "OrderDiscount"("orderId");

-- CreateIndex
CREATE INDEX "UpsellConfig_locationId_idx" ON "UpsellConfig"("locationId");

-- CreateIndex
CREATE INDEX "UpsellEvent_upsellConfigId_idx" ON "UpsellEvent"("upsellConfigId");

-- CreateIndex
CREATE INDEX "UpsellEvent_createdAt_idx" ON "UpsellEvent"("createdAt");

-- CreateIndex
CREATE INDEX "VoidLog_orderId_idx" ON "VoidLog"("orderId");

-- CreateIndex
CREATE INDEX "VoidLog_employeeId_idx" ON "VoidLog"("employeeId");

-- CreateIndex
CREATE INDEX "VoidLog_createdAt_idx" ON "VoidLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_locationId_idx" ON "AuditLog"("locationId");

-- CreateIndex
CREATE INDEX "AuditLog_employeeId_idx" ON "AuditLog"("employeeId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "TipPool_locationId_idx" ON "TipPool"("locationId");

-- CreateIndex
CREATE INDEX "TipPoolEntry_tipPoolId_idx" ON "TipPoolEntry"("tipPoolId");

-- CreateIndex
CREATE INDEX "TipPoolEntry_shiftDate_idx" ON "TipPoolEntry"("shiftDate");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClockEntry" ADD CONSTRAINT "TimeClockEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drawer" ADD CONSTRAINT "Drawer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidInOut" ADD CONSTRAINT "PaidInOut_drawerId_fkey" FOREIGN KEY ("drawerId") REFERENCES "Drawer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_comboTemplateId_fkey" FOREIGN KEY ("comboTemplateId") REFERENCES "ComboTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_defaultItemId_fkey" FOREIGN KEY ("defaultItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentOption" ADD CONSTRAINT "ComboComponentOption_comboComponentId_fkey" FOREIGN KEY ("comboComponentId") REFERENCES "ComboComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionAssignment" ADD CONSTRAINT "SectionAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRule" ADD CONSTRAINT "DiscountRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellConfig" ADD CONSTRAINT "UpsellConfig_triggerItemId_fkey" FOREIGN KEY ("triggerItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellConfig" ADD CONSTRAINT "UpsellConfig_suggestionItemId_fkey" FOREIGN KEY ("suggestionItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellEvent" ADD CONSTRAINT "UpsellEvent_upsellConfigId_fkey" FOREIGN KEY ("upsellConfigId") REFERENCES "UpsellConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidLog" ADD CONSTRAINT "VoidLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPoolEntry" ADD CONSTRAINT "TipPoolEntry_tipPoolId_fkey" FOREIGN KEY ("tipPoolId") REFERENCES "TipPool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
