/**
 * Migration 074: Add `flushed` column to SocketEventLog for transactional outbox pattern.
 *
 * Events written inside a domain transaction are inserted with flushed=false.
 * After commit, flushSocketOutbox() reads unflushed rows, emits them, and marks flushed=true.
 * On crash recovery, unflushed rows are replayed via catch-up.
 *
 * Legacy fire-and-forget writes (from recordEvent) continue to use status='sent' and flushed=true (default).
 */
async function up(prisma) {
  // Guard: check if column already exists
  const colExists = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'SocketEventLog'
        AND column_name = 'flushed'
    ) as exists
  `)
  if (colExists[0]?.exists) return

  // Add flushed column — default true so existing rows and legacy fire-and-forget writes are unaffected
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SocketEventLog" ADD COLUMN flushed BOOLEAN NOT NULL DEFAULT true
  `)

  // Partial index on unflushed events per location — used by flushSocketOutbox()
  // Only indexes the tiny number of rows that haven't been emitted yet
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_socket_event_log_unflushed
    ON "SocketEventLog" ("locationId", id)
    WHERE flushed = false
  `)
}

module.exports = { up }
