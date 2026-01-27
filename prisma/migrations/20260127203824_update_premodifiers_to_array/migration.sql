/*
  Warnings:

  - You are about to drop the column `preModifier` on the `Modifier` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Modifier" DROP COLUMN "preModifier",
ADD COLUMN     "allowedPreModifiers" JSONB,
ADD COLUMN     "extraPrice" DECIMAL(10,2),
ADD COLUMN     "extraUpsellPrice" DECIMAL(10,2);
