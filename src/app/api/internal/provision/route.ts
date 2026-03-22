import { NextRequest } from 'next/server'
import { db, masterClient, buildVenueDatabaseUrl, buildVenueDirectUrl, venueDbName } from '@/lib/db'
import { PrismaClient, CashHandlingMode, CategoryType } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { hash } from 'bcryptjs'
import { randomInt } from 'crypto'
import { Pool } from '@neondatabase/serverless'
import fs from 'fs'
import path from 'path'
import { withVenue } from '@/lib/with-venue'

// Allow up to 60s for seed (schema push via direct SQL is fast)
export const maxDuration = 60

/**
 * Load schema SQL from the best available source.
 * Priority:
 *   1. public/schema.sql (static file, always matches deployed version)
 *   2. prisma/schema.sql (build artifact, may be stale on Vercel)
 * Throws if neither exists.
 */
async function loadSchemaSql(): Promise<string> {
  // Try public/schema.sql first (served as static file, always current)
  const publicPath = path.join(process.cwd(), 'public/schema.sql')
  try {
    await fs.promises.access(publicPath)
    return await fs.promises.readFile(publicPath, 'utf-8')
  } catch {
    // File doesn't exist — try fallback
  }
  // Fallback to prisma/schema.sql (build artifact)
  const prismaPath = path.join(process.cwd(), 'prisma/schema.sql')
  try {
    await fs.promises.access(prismaPath)
    return await fs.promises.readFile(prismaPath, 'utf-8')
  } catch {
    // File doesn't exist either
  }
  throw new Error(
    'Cannot push schema: neither public/schema.sql nor prisma/schema.sql found. ' +
    'These files are generated at build time by generate-schema-sql.mjs.'
  )
}

/**
 * POST /api/internal/provision?mode=full|seed-only|schema-only
 *
 * Creates a new Neon database for a venue, pushes the Prisma schema,
 * and seeds it with default data (org, location, roles, employee, order types,
 * categories, section, tables).
 *
 * Called by Mission Control when a new location is created.
 *
 * Query params:
 *   mode (optional, default "full"):
 *     - "full":        Create DB + push schema + disable RLS + seed defaults
 *     - "seed-only":   Skip DB creation and schema push, only run seed.
 *                      Used by MC provisioning pipeline after it handles schema separately.
 *     - "schema-only": Create DB (if needed) + push schema + disable RLS, skip seed.
 *                      Used for schema upgrades on existing venues.
 *
 *   In "full" and "schema-only" modes, schema is ALWAYS pushed (even if tables
 *   already exist) to prevent schema drift.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *
 * Body:
 *   { slug: "joes-bar", name: "Joe's Bar & Grill" }
 *
 * Response (full/seed-only):
 *   { success: true, databaseName, posLocationId, ownerPin, slug, mode, posUrl }
 * Response (schema-only):
 *   { success: true, databaseName, slug, mode, posUrl }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const slug: string = body.slug
  const name: string = body.name || slug
  const nucBaseUrl: string | undefined = body.nucBaseUrl

  // ── Validate slug ────────────────────────────────────────────────────
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return Response.json(
      { error: 'Invalid slug. Use lowercase alphanumeric with hyphens.' },
      { status: 400 }
    )
  }

  // gwi_pos_ prefix = 8 chars, slug with hyphens→underscores, PG limit = 63
  if (slug.length > 50) {
    return Response.json({ error: 'Slug too long (max 50 characters)' }, { status: 400 })
  }

  const mode = request.nextUrl.searchParams.get('mode') || 'full'
  const VALID_MODES = ['full', 'seed-only', 'schema-only'] as const
  if (!VALID_MODES.includes(mode as any)) {
    return Response.json(
      { error: `Invalid mode "${mode}". Must be one of: ${VALID_MODES.join(', ')}` },
      { status: 400 }
    )
  }

  const dbName = venueDbName(slug)
  const venueDbUrl = buildVenueDatabaseUrl(slug)
  const venueDirectUrl = buildVenueDirectUrl(slug)

  try {
    // ── 1. Create database on Neon (skip for seed-only) ──────────────
    if (mode !== 'seed-only') {
      const existing = await db.$queryRawUnsafe<{ datname: string }[]>(
        `SELECT datname FROM pg_database WHERE datname = $1`,
        dbName
      )

      if (existing.length === 0) {
        // CREATE DATABASE cannot use parameterized queries.
        // SAFETY: slug is validated by /^[a-z0-9]+(-[a-z0-9]+)*$/ regex above,
        // and venueDbName() only adds a safe prefix. No user-controlled characters
        // can escape the double-quoted identifier.
        try {
          await db.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`)
          if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Created database: ${dbName}`)
        } catch (createErr: any) {
          // Race condition: another request created the DB between our SELECT and CREATE.
          // Treat "already exists" as success (idempotent).
          if (createErr?.message?.includes('already exists')) {
            console.log(`[Provision] Database already exists (race): ${dbName}`)
          } else {
            throw createErr
          }
        }
      } else {
        if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Database already exists: ${dbName}`)
      }
    }

    // ── 2. Push schema via direct SQL (full + schema-only; ALWAYS push even if tables exist) ──
    if (mode === 'full' || mode === 'schema-only') {
      try {
        // Load schema SQL from build artifact (multiple fallback sources)
        const schemaSql = await loadSchemaSql()
        // Use Pool for raw multi-statement SQL (neon() tagged template can't accept raw strings)
        const pool = new Pool({ connectionString: venueDirectUrl })
        try {
          await pool.query(schemaSql)
        } finally {
          await pool.end()
        }
        if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Schema pushed to ${dbName}`)

        // Disable RLS on all tables — schema.sql may enable it, but the POS app
        // doesn't have RLS policies configured. RLS blocks sync, menu queries, and login.
        const rlsPool = new Pool({ connectionString: venueDirectUrl })
        try {
          await rlsPool.query(`
            DO $$ DECLARE r RECORD; BEGIN
              FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true LOOP
                EXECUTE 'ALTER TABLE public."' || r.tablename || '" DISABLE ROW LEVEL SECURITY';
              END LOOP;
            END $$;
          `)
          if (process.env.NODE_ENV !== 'production') console.log(`[Provision] RLS disabled in ${dbName}`)
        } finally {
          await rlsPool.end()
        }
      } catch (pushErr) {
        console.error('[Provision] Schema push failed:', pushErr)
        // Cleanup: drop the half-provisioned database so retries start fresh
        try {
          await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`)
          console.log(`[Provision] Cleaned up failed database: ${dbName}`)
        } catch (dropErr) {
          // Don't mask the original schema push error
          console.error('[Provision] Failed to clean up database after schema push failure:', dropErr)
        }
        return Response.json(
          { error: 'Schema push failed. Database has been cleaned up for retry.' },
          { status: 500 }
        )
      }
    } else {
      if (process.env.NODE_ENV !== 'production') console.log(`[Provision] mode=${mode} — skipping schema push for ${slug}`)
    }

    // ── 3. Seed default data (full + seed-only) ──────────────────────
    if (mode === 'full' || mode === 'seed-only') {
      let venueAdapter: any
      if (process.env.VERCEL) {
        venueAdapter = new PrismaPg({ connectionString: venueDbUrl, max: 1, connectionTimeoutMillis: 60000 })
      } else {
        venueAdapter = new PrismaPg({ connectionString: venueDbUrl })
      }
      const venueDb = new PrismaClient({ adapter: venueAdapter })

      let seedResult: { locationId: string; ownerPin: string }
      try {
        seedResult = await seedVenueDefaults(venueDb, name)
        if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Seeded defaults for ${slug} (locationId: ${seedResult.locationId})`)
      } finally {
        await venueDb.$disconnect()
      }

      // Register venue in cron registry (master DB) for multi-tenant cron iteration
      await upsertCronVenueRegistry(slug, dbName, nucBaseUrl)

      return Response.json({
        success: true,
        databaseName: dbName,
        posLocationId: seedResult.locationId,
        ownerPin: seedResult.ownerPin,
        slug,
        mode,
        posUrl: `https://${slug}.ordercontrolcenter.com`,
      })
    }

    // Register venue in cron registry (master DB) for multi-tenant cron iteration
    await upsertCronVenueRegistry(slug, dbName, nucBaseUrl)

    // schema-only response (no seed data to return)
    return Response.json({
      success: true,
      databaseName: dbName,
      slug,
      mode,
      posUrl: `https://${slug}.ordercontrolcenter.com`,
    })
  } catch (error) {
    console.error('[Provision] Error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Provisioning failed' },
      { status: 500 }
    )
  }
})

// ============================================================================
// Default venue seed (minimal — just enough to log in and start building)
// ============================================================================

/**
 * Generate a cryptographically random 4-digit PIN, avoiding easily guessable patterns:
 * - All same digit (0000, 1111, ..., 9999)
 * - Sequential ascending (1234, 2345, ..., 6789)
 * - Sequential descending (9876, 8765, ..., 3210)
 */
function generateSecurePin(): string {
  const BANNED = new Set([
    '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
    '0123', '1234', '2345', '3456', '4567', '5678', '6789',
    '9876', '8765', '7654', '6543', '5432', '4321', '3210',
  ])
  let pin: string
  do {
    pin = String(randomInt(0, 10000)).padStart(4, '0')
  } while (BANNED.has(pin))
  return pin
}

async function seedVenueDefaults(venueDb: PrismaClient, venueName: string): Promise<{ locationId: string; ownerPin: string }> {
  // Organization — upsert by name for idempotency on retries
  const existingOrg = await venueDb.organization.findFirst({ where: { name: venueName } })
  const org = existingOrg || await venueDb.organization.create({
    data: { name: venueName },
  })

  // Location — upsert: find existing for this org, or create
  const existingLocation = await venueDb.location.findFirst({ where: { organizationId: org.id } })
  const location = existingLocation || await venueDb.location.create({
    data: {
      organizationId: org.id,
      name: venueName,
    },
  })

  const locationId = location.id

  // Roles — use deterministic IDs so upserts are idempotent on retries
  const roles = [
    {
      id: 'role-super-admin',
      name: 'Super Admin',
      permissions: ['all'],
      isTipped: false,
      cashHandlingMode: CashHandlingMode.none,
    },
    {
      id: 'role-mgr',
      name: 'Manager',
      permissions: [
        'pos.access', 'pos.create_order', 'pos.modify_order', 'pos.void_item',
        'pos.comp_item', 'pos.apply_discount', 'pos.process_payment', 'pos.open_drawer',
        'manager.void_approve', 'manager.comp_approve', 'manager.discount_approve',
        'manager.refund', 'manager.reopen_order', 'manager.adjust_tips',
        'manager.view_all_orders', 'manager.close_day', 'manager.override_price',
        'reports.view_daily', 'reports.view_sales', 'reports.view_labor',
        'reports.view_tips', 'reports.view_inventory', 'reports.export',
        'menu.view', 'menu.edit', 'menu.create', 'menu.delete', 'menu.manage_modifiers',
        'staff.view', 'staff.edit_profile', 'staff.create', 'staff.assign_roles', 'staff.manage_schedule',
        'tables.view', 'tables.edit', 'tables.manage_sections',
        'settings.view', 'settings.edit', 'settings.hardware', 'settings.integrations',
        'tips.view_own', 'tips.view_all', 'tips.share', 'tips.manage_rules', 'tips.manage_bank',
      ],
      isTipped: false,
      cashHandlingMode: CashHandlingMode.none,
    },
    {
      id: 'role-server',
      name: 'Server',
      permissions: [
        'pos.access', 'pos.create_order', 'pos.modify_order', 'pos.process_payment',
        'menu.view', 'tables.view', 'tips.view_own', 'tips.share', 'reports.view_tips',
      ],
      isTipped: true,
      cashHandlingMode: CashHandlingMode.purse,
    },
    {
      id: 'role-bartender',
      name: 'Bartender',
      permissions: [
        'pos.access', 'pos.create_order', 'pos.modify_order', 'pos.process_payment',
        'pos.open_drawer', 'menu.view', 'tables.view', 'tips.view_own', 'tips.share',
        'reports.view_tips',
      ],
      isTipped: true,
      cashHandlingMode: CashHandlingMode.drawer,
    },
    {
      id: 'role-host',
      name: 'Host',
      permissions: ['pos.access', 'tables.view', 'menu.view'],
      isTipped: false,
      cashHandlingMode: CashHandlingMode.none,
    },
  ]

  const createdRoles: Record<string, string> = {}
  for (const r of roles) {
    const role = await venueDb.role.upsert({
      where: { id: r.id },
      update: {},  // don't overwrite existing data on retries
      create: {
        id: r.id,
        locationId,
        name: r.name,
        permissions: r.permissions,
        isTipped: r.isTipped,
        cashHandlingMode: r.cashHandlingMode,
      },
    })
    createdRoles[r.name] = role.id
  }

  // Owner employee — random secure PIN (returned to MC for merchant display)
  // Use atomic INSERT ... WHERE NOT EXISTS to prevent duplicate owner creation
  // from concurrent provision requests (no unique constraint on name fields).
  const ownerPin = generateSecurePin()
  const pinHash = await hash(ownerPin, 10)
  const insertResult = await venueDb.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "Employee" ("id", "locationId", "roleId", "firstName", "lastName", "pin", "isActive", "createdAt", "updatedAt")
     SELECT gen_random_uuid()::text, $1, $2, 'Owner', 'Admin', $3, true, NOW(), NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM "Employee"
       WHERE "locationId" = $1 AND "roleId" = $2 AND "deletedAt" IS NULL
     )
     RETURNING "id"`,
    locationId,
    createdRoles['Super Admin'],
    pinHash,
  )
  let owner: { id: string }
  if (insertResult.length > 0) {
    owner = insertResult[0]
  } else {
    // Already exists from a prior or concurrent request — fetch it
    const existingOwner = await venueDb.employee.findFirst({
      where: { locationId, roleId: createdRoles['Super Admin'], deletedAt: null },
      select: { id: true },
    })
    owner = existingOwner!
  }

  // EmployeeRole — upsert by employeeId+roleId natural key
  const existingEmployeeRole = await venueDb.employeeRole.findFirst({
    where: { employeeId: owner.id, roleId: createdRoles['Manager'] },
  })
  if (!existingEmployeeRole) {
    await venueDb.employeeRole.create({
      data: {
        locationId,
        employeeId: owner.id,
        roleId: createdRoles['Manager'],
        isPrimary: true,
      },
    })
  }

  // Order types — upsert by slug (natural key within location)
  const orderTypes = [
    { name: 'Dine In', slug: 'dine_in', icon: '🍽️', color: '#3B82F6', isSystem: true, sortOrder: 0,
      workflowRules: { requireTableSelection: true, allowSplitCheck: true, showOnKDS: true } },
    { name: 'Bar Tab', slug: 'bar_tab', icon: '🍺', color: '#8B5CF6', isSystem: true, sortOrder: 1,
      workflowRules: { requireCustomerName: true, allowSplitCheck: true, showOnKDS: true } },
    { name: 'Takeout', slug: 'takeout', icon: '📦', color: '#F59E0B', isSystem: true, sortOrder: 2,
      workflowRules: { requirePaymentBeforeSend: true, showOnKDS: true } },
    { name: 'Delivery', slug: 'delivery', icon: '🚗', color: '#EF4444', isSystem: true, sortOrder: 3,
      requiredFields: ['customerName', 'phone', 'address'],
      workflowRules: { requirePaymentBeforeSend: true, showOnKDS: true } },
  ]

  for (const ot of orderTypes) {
    const existingOt = await venueDb.orderType.findFirst({
      where: { locationId, slug: ot.slug },
    })
    if (!existingOt) {
      await venueDb.orderType.create({
        data: {
          locationId,
          name: ot.name,
          slug: ot.slug,
          icon: ot.icon,
          color: ot.color,
          isSystem: ot.isSystem,
          sortOrder: ot.sortOrder,
          requiredFields: 'requiredFields' in ot ? ot.requiredFields : undefined,
          workflowRules: ot.workflowRules,
        },
      })
    }
  }

  // Default categories — upsert by name+locationId (natural key)
  const categories = [
    { name: 'Appetizers', categoryType: CategoryType.food, color: '#F59E0B', sortOrder: 0 },
    { name: 'Entrees', categoryType: CategoryType.food, color: '#EF4444', sortOrder: 1 },
    { name: 'Sides', categoryType: CategoryType.food, color: '#10B981', sortOrder: 2 },
    { name: 'Desserts', categoryType: CategoryType.food, color: '#EC4899', sortOrder: 3 },
    { name: 'Soft Drinks', categoryType: CategoryType.drinks, color: '#06B6D4', sortOrder: 4 },
    { name: 'Beer', categoryType: CategoryType.drinks, color: '#F97316', sortOrder: 5 },
    { name: 'Cocktails', categoryType: CategoryType.liquor, color: '#8B5CF6', sortOrder: 6 },
  ]

  for (const cat of categories) {
    const existingCat = await venueDb.category.findFirst({
      where: { locationId, name: cat.name },
    })
    if (!existingCat) {
      await venueDb.category.create({
        data: { locationId, ...cat },
      })
    }
  }

  // Default section + 6 tables — upsert by name+locationId
  const existingSection = await venueDb.section.findFirst({
    where: { locationId, name: 'Main Dining' },
  })
  const section = existingSection || await venueDb.section.create({
    data: { locationId, name: 'Main Dining', sortOrder: 0 },
  })

  const tableGrid = [
    { name: 'Table 1', posX: 100, posY: 100 },
    { name: 'Table 2', posX: 300, posY: 100 },
    { name: 'Table 3', posX: 500, posY: 100 },
    { name: 'Table 4', posX: 100, posY: 300 },
    { name: 'Table 5', posX: 300, posY: 300 },
    { name: 'Table 6', posX: 500, posY: 300 },
  ]

  for (const t of tableGrid) {
    const existingTable = await venueDb.table.findFirst({
      where: { locationId, sectionId: section.id, name: t.name },
    })
    if (!existingTable) {
      await venueDb.table.create({
        data: {
          locationId,
          sectionId: section.id,
          name: t.name,
          capacity: 4,
          shape: 'circle',
          posX: t.posX,
          posY: t.posY,
        },
      })
    }
  }

  return { locationId, ownerPin }
}

// ============================================================================
// Cron venue registry — master DB bookkeeping for multi-tenant cron iteration
// ============================================================================

async function upsertCronVenueRegistry(slug: string, databaseName: string, nucBaseUrl?: string): Promise<void> {
  try {
    await masterClient.$executeRawUnsafe(
      `INSERT INTO "_cron_venue_registry" ("slug", "database_name", "is_active", "nuc_base_url", "created_at", "updated_at")
       VALUES ($1, $2, true, $3, NOW(), NOW())
       ON CONFLICT ("slug") DO UPDATE
       SET "database_name" = EXCLUDED."database_name",
           "is_active" = true,
           "nuc_base_url" = COALESCE(EXCLUDED."nuc_base_url", "_cron_venue_registry"."nuc_base_url"),
           "updated_at" = NOW()`,
      slug,
      databaseName,
      nucBaseUrl || null,
    )
    console.log(`[Provision] Registered venue ${slug} in cron registry${nucBaseUrl ? ` (NUC: ${nucBaseUrl})` : ''}`)
  } catch (err) {
    // Non-fatal: table may not exist yet if migration hasn't run.
    // Cron jobs will still work once migration runs and venues are re-provisioned.
    console.warn(`[Provision] Failed to register ${slug} in cron registry:`, err)
  }
}
