/**
 * Migration 124 — Add 'tags' column to SocketEventLog
 *
 * Support for tag-based routing in the transactional outbox.
 * Allows dispatching KDS events ('kds:order-received') via the durable outbox pattern.
 */

exports.up = async (db) => {
  // Add tags column as nullable JSONB (stores string array)
  await db.$executeRawUnsafe(`
    ALTER TABLE "SocketEventLog"
    ADD COLUMN IF NOT EXISTS "tags" JSONB;
  `)

  // Add index for tag-based lookup (GIN) to support future catch-up performance
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_socket_event_log_tags" ON "SocketEventLog" USING GIN ("tags");
  `)
}

exports.down = async (db) => {
  await db.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "idx_socket_event_log_tags";
    ALTER TABLE "SocketEventLog" DROP COLUMN IF EXISTS "tags";
  `)
}
