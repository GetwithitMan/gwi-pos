-- Walk-in table double-claim lock: Prevent two live orders on the same table.
-- Only one non-deleted order with an active status may exist per tableId.
CREATE UNIQUE INDEX "Order_tableId_active_unique"
  ON "Order" ("tableId")
  WHERE "tableId" IS NOT NULL
    AND "status" IN ('draft', 'open', 'in_progress', 'sent', 'split')
    AND "deletedAt" IS NULL;
