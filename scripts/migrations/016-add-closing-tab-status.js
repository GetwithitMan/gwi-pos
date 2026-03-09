async function up(prisma) {
  // Add 'closing' to TabStatus enum — used as an idempotency gate during close-tab
  // to prevent two terminals from both calling Datacap simultaneously.
  // Guard: only add if not already present.
  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum WHERE enumtypid = '"TabStatus"'::regtype AND enumlabel = 'closing'`
  );
  if (exists.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "TabStatus" ADD VALUE IF NOT EXISTS 'closing'`);
  }
}

module.exports = { up };
