-- AddColumn: roleType and accessLevel to Role table
-- UX metadata only — never used for authorization

ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "roleType" TEXT NOT NULL DEFAULT 'FOH';
ALTER TABLE "Role" ADD COLUMN IF NOT EXISTS "accessLevel" TEXT NOT NULL DEFAULT 'STAFF';
