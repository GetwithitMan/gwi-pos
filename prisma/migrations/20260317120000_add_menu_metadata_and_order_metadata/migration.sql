-- Add metadata JSONB to MenuItem, ModifierGroup, Modifier for cake builder extensibility
ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "ModifierGroup" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "Modifier" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Add metadata JSONB to Order for settlement order linkage
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Add allowTips to OrderType for per-type tip control
ALTER TABLE "OrderType" ADD COLUMN IF NOT EXISTS "allowTips" BOOLEAN NOT NULL DEFAULT true;
