module.exports.up = async function up(prisma) {
  // B2: Partial unique index — only one active clock-in per employee
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "TimeClockEntry_employeeId_active_unique"
    ON "TimeClockEntry" ("employeeId")
    WHERE "clockOut" IS NULL AND "deletedAt" IS NULL;
  `)

  // B5: Defense-in-depth — ensure Payment.amount is always >= 0
  // Primary refund-max check is in API route code; this is a safety net.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Payment_amount_positive'
      ) THEN
        ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive"
          CHECK (amount >= 0);
      END IF;
    END
    $$;
  `)
}
