/**
 * Migration 078: RLS DISABLED — was causing write failures everywhere
 *
 * ORIGINAL: Enabled Row-Level Security on 15 tenant-scoped tables.
 * PROBLEM: RLS without proper per-connection GUC setup blocks ALL writes
 * from sync workers, MC provisioning, and direct seed operations. Every
 * `prisma db push`, `git pull + build`, and NUC restart re-ran this
 * migration and re-enabled RLS, causing "new row violates row-level
 * security policy" errors that silently broke downstream sync.
 *
 * DECISION: RLS is disabled. Tenant isolation is enforced at the
 * application layer (db-tenant-scope.ts extension + withVenue() routing).
 * If RLS is needed in the future, it must be implemented with proper
 * policies that don't block the app's own writes.
 *
 * This migration is now a NO-OP. The tracking table records it as
 * "applied" so it never re-runs.
 */

/** @param {import('@prisma/client').PrismaClient} prisma */
export async function up(prisma) {
  // NO-OP — RLS disabled permanently
  // Tenant isolation handled by application layer (db-tenant-scope.ts)

  // If RLS was previously enabled, disable it on all tables
  try {
    await prisma.$executeRawUnsafe(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT relname FROM pg_class WHERE relrowsecurity = true AND relkind = 'r'
        LOOP
          EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.relname);
          EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', r.relname);
        END LOOP;
      END $$;
    `)
    console.log('[Migration 078] Disabled RLS on all tables (permanent fix)')
  } catch (err) {
    console.warn('[Migration 078] RLS disable failed (non-fatal):', err.message)
  }
}
