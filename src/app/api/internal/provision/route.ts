import { NextRequest } from 'next/server'
import { db, buildVenueDatabaseUrl, buildVenueDirectUrl, venueDbName } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import { neon, Pool } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import path from 'path'
import { withVenue } from '@/lib/with-venue'

// Allow up to 60s for seed (schema push via direct SQL is fast)
export const maxDuration = 60

/**
 * POST /api/internal/provision
 *
 * Creates a new Neon database for a venue, pushes the Prisma schema,
 * and seeds it with default data (org, location, roles, employee, order types,
 * categories, section, tables).
 *
 * Called by Mission Control when a new location is created.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *
 * Body:
 *   { slug: "joes-bar", name: "Joe's Bar & Grill" }
 *
 * Response:
 *   { success: true, databaseName: "gwi_pos_joes_bar", slug: "joes-bar" }
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

  // ── Validate slug ────────────────────────────────────────────────────
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return Response.json(
      { error: 'Invalid slug. Use lowercase alphanumeric with hyphens.' },
      { status: 400 }
    )
  }

  const dbName = venueDbName(slug)
  const venueDbUrl = buildVenueDatabaseUrl(slug)
  const venueDirectUrl = buildVenueDirectUrl(slug)

  try {
    // ── 1. Create database on Neon ─────────────────────────────────────
    const existing = await db.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = $1`,
      dbName
    )

    if (existing.length === 0) {
      // CREATE DATABASE cannot use parameterized queries.
      // SAFETY: slug is validated by /^[a-z0-9]+(-[a-z0-9]+)*$/ regex above,
      // and venueDbName() only adds a safe prefix. No user-controlled characters
      // can escape the double-quoted identifier.
      await db.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`)
      if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Created database: ${dbName}`)
    } else {
      if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Database already exists: ${dbName}`)
    }

    // ── 2. Push schema via direct SQL (no execSync needed) ─────────────
    try {
      const venueSQL = neon(venueDirectUrl)

      // Check if tables already exist (idempotency)
      const tableCheck = await venueSQL`
        SELECT COUNT(*)::int as count
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `

      if (tableCheck[0].count > 0) {
        if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Schema already exists in ${dbName}, skipping push`)
      } else {
        // Read pre-generated schema SQL (built at deploy time by generate-schema-sql.mjs)
        const schemaSql = readFileSync(
          path.join(process.cwd(), 'prisma/schema.sql'),
          'utf-8'
        )
        // Use Pool for raw multi-statement SQL (neon() tagged template can't accept raw strings)
        const pool = new Pool({ connectionString: venueDirectUrl })
        try {
          await pool.query(schemaSql)
        } finally {
          await pool.end()
        }
        if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Schema pushed to ${dbName}`)
      }
    } catch (pushErr) {
      console.error('[Provision] Schema push failed:', pushErr)
      return Response.json(
        { error: 'Schema push failed. Database was created but tables were not.' },
        { status: 500 }
      )
    }

    // ── 3. Seed default data ───────────────────────────────────────────
    const venueDb = new PrismaClient({
      datasources: { db: { url: venueDbUrl } },
    })

    let posLocationId: string
    try {
      posLocationId = await seedVenueDefaults(venueDb, name)
      if (process.env.NODE_ENV !== 'production') console.log(`[Provision] Seeded defaults for ${slug} (locationId: ${posLocationId})`)
    } finally {
      await venueDb.$disconnect()
    }

    return Response.json({
      success: true,
      databaseName: dbName,
      posLocationId,
      slug,
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

async function seedVenueDefaults(venueDb: PrismaClient, venueName: string): Promise<string> {
  // Organization
  const org = await venueDb.organization.create({
    data: { name: venueName },
  })

  // Location
  const location = await venueDb.location.create({
    data: {
      organizationId: org.id,
      name: venueName,
    },
  })

  const locationId = location.id

  // Roles
  const roles = [
    {
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
        'staff.view', 'staff.edit', 'staff.create', 'staff.manage_roles', 'staff.manage_schedule',
        'tables.view', 'tables.edit', 'tables.manage_sections',
        'settings.view', 'settings.edit', 'settings.manage_hardware', 'settings.manage_payments',
        'tips.view_own', 'tips.view_all', 'tips.share', 'tips.manage_rules', 'tips.manage_bank',
      ],
      isTipped: false,
      cashHandlingMode: 'none',
    },
    {
      name: 'Server',
      permissions: [
        'pos.access', 'pos.create_order', 'pos.modify_order', 'pos.process_payment',
        'menu.view', 'tables.view', 'tips.view_own', 'tips.share', 'reports.view_tips',
      ],
      isTipped: true,
      cashHandlingMode: 'purse',
    },
    {
      name: 'Bartender',
      permissions: [
        'pos.access', 'pos.create_order', 'pos.modify_order', 'pos.process_payment',
        'pos.open_drawer', 'menu.view', 'tables.view', 'tips.view_own', 'tips.share',
        'reports.view_tips',
      ],
      isTipped: true,
      cashHandlingMode: 'drawer',
    },
    {
      name: 'Host',
      permissions: ['pos.access', 'tables.view', 'menu.view'],
      isTipped: false,
      cashHandlingMode: 'none',
    },
  ]

  const createdRoles: Record<string, string> = {}
  for (let i = 0; i < roles.length; i++) {
    const r = roles[i]
    const role = await venueDb.role.create({
      data: {
        locationId,
        name: r.name,
        permissions: r.permissions,
        isTipped: r.isTipped,
        cashHandlingMode: r.cashHandlingMode,
      },
    })
    createdRoles[r.name] = role.id
  }

  // Owner employee (PIN: 1234)
  const pinHash = await hash('1234', 10)
  const owner = await venueDb.employee.create({
    data: {
      locationId,
      roleId: createdRoles['Manager'],
      firstName: 'Owner',
      lastName: 'Manager',
      pin: pinHash,
      isActive: true,
    },
  })

  await venueDb.employeeRole.create({
    data: {
      locationId,
      employeeId: owner.id,
      roleId: createdRoles['Manager'],
      isPrimary: true,
    },
  })

  // Order types
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

  // Default categories
  const categories = [
    { name: 'Appetizers', categoryType: 'food', color: '#F59E0B', sortOrder: 0 },
    { name: 'Entrees', categoryType: 'food', color: '#EF4444', sortOrder: 1 },
    { name: 'Sides', categoryType: 'food', color: '#10B981', sortOrder: 2 },
    { name: 'Desserts', categoryType: 'food', color: '#EC4899', sortOrder: 3 },
    { name: 'Soft Drinks', categoryType: 'drinks', color: '#06B6D4', sortOrder: 4 },
    { name: 'Beer', categoryType: 'drinks', color: '#F97316', sortOrder: 5 },
    { name: 'Cocktails', categoryType: 'liquor', color: '#8B5CF6', sortOrder: 6 },
  ]

  for (const cat of categories) {
    await venueDb.category.create({
      data: { locationId, ...cat },
    })
  }

  // Default section + 6 tables
  const section = await venueDb.section.create({
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

  return locationId
}
