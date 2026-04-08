-- Android System Audit: schema fixes
-- Enums, cascade deletes, nullable employeeId, new indexes

-- 1. Add 'fired' to KitchenStatus enum
ALTER TYPE "KitchenStatus" ADD VALUE IF NOT EXISTS 'fired';

-- 2. Add 'CELLULAR' to TerminalCategory enum
ALTER TYPE "TerminalCategory" ADD VALUE IF NOT EXISTS 'CELLULAR';

-- 3. Fix cascade deletes: OrderItemDiscount -> OrderItem
ALTER TABLE "OrderItemDiscount" DROP CONSTRAINT IF EXISTS "OrderItemDiscount_orderItemId_fkey";
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Fix cascade deletes: OrderItemDiscount -> Order
ALTER TABLE "OrderItemDiscount" DROP CONSTRAINT IF EXISTS "OrderItemDiscount_orderId_fkey";
ALTER TABLE "OrderItemDiscount" ADD CONSTRAINT "OrderItemDiscount_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Fix cascade deletes: OrderCard -> Order (Restrict -> Cascade)
ALTER TABLE "OrderCard" DROP CONSTRAINT IF EXISTS "OrderCard_orderId_fkey";
ALTER TABLE "OrderCard" ADD CONSTRAINT "OrderCard_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Fix cascade deletes: OrderItemIngredient -> OrderItem (Restrict -> Cascade)
ALTER TABLE "OrderItemIngredient" DROP CONSTRAINT IF EXISTS "OrderItemIngredient_orderItemId_fkey";
ALTER TABLE "OrderItemIngredient" ADD CONSTRAINT "OrderItemIngredient_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Fix cascade deletes: OrderItemModifier -> OrderItem (Restrict -> Cascade)
ALTER TABLE "OrderItemModifier" DROP CONSTRAINT IF EXISTS "OrderItemModifier_orderItemId_fkey";
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Make Order.employeeId optional
ALTER TABLE "Order" ALTER COLUMN "employeeId" DROP NOT NULL;

-- 9. New indexes for Android sync performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItemDiscount_orderId_orderItemId_idx"
  ON "OrderItemDiscount"("orderId", "orderItemId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OrderItem_locationId_orderId_idx"
  ON "OrderItem"("locationId", "orderId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_locationId_status_deletedAt_idx"
  ON "Order"("locationId", "status", "deletedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_locationId_employeeId_createdAt_idx"
  ON "Payment"("locationId", "employeeId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "VoidLog_locationId_itemId_createdAt_idx"
  ON "VoidLog"("locationId", "itemId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "RemoteVoidApproval_requestingTerminalId_status_idx"
  ON "RemoteVoidApproval"("requestingTerminalId", "status");
