-- Add composite (locationId, updatedAt) indexes to 18 sync-critical tables.
-- The upstream sync worker queries WHERE "updatedAt" > COALESCE("syncedAt", ...)
-- ORDER BY "updatedAt" ASC, scoped by locationId. Without these indexes,
-- every sync tick does a full table scan.

-- CreateIndex
CREATE INDEX "TimeClockEntry_locationId_updatedAt_idx" ON "TimeClockEntry"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Shift_locationId_updatedAt_idx" ON "Shift"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Drawer_locationId_updatedAt_idx" ON "Drawer"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Modifier_locationId_updatedAt_idx" ON "Modifier"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Order_locationId_updatedAt_idx" ON "Order"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderItemModifier_locationId_updatedAt_idx" ON "OrderItemModifier"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Payment_locationId_updatedAt_idx" ON "Payment"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderDiscount_locationId_updatedAt_idx" ON "OrderDiscount"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "VoidLog_locationId_updatedAt_idx" ON "VoidLog"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_locationId_updatedAt_idx" ON "AuditLog"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "TipLedger_locationId_updatedAt_idx" ON "TipLedger"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "TipLedgerEntry_locationId_updatedAt_idx" ON "TipLedgerEntry"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "TipTransaction_locationId_updatedAt_idx" ON "TipTransaction"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderItemIngredient_locationId_updatedAt_idx" ON "OrderItemIngredient"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "PrintJob_locationId_updatedAt_idx" ON "PrintJob"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderItemPizza_locationId_updatedAt_idx" ON "OrderItemPizza"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrderCard_locationId_updatedAt_idx" ON "OrderCard"("locationId", "updatedAt");

-- CreateIndex
CREATE INDEX "RefundLog_locationId_updatedAt_idx" ON "RefundLog"("locationId", "updatedAt");
