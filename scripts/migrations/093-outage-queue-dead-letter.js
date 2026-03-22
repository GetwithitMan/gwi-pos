/** Add DEAD_LETTER to OutageQueueStatus enum */
exports.up = async function up(prisma) {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      ALTER TYPE "OutageQueueStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
}
