-- AlterTable
ALTER TABLE "Modifier" ADD COLUMN     "childModifierGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Modifier_childModifierGroupId_idx" ON "Modifier"("childModifierGroupId");

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_childModifierGroupId_fkey" FOREIGN KEY ("childModifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
