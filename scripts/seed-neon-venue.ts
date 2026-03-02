#!/usr/bin/env tsx
/**
 * seed-neon-venue.ts
 *
 * Seeds the gwi_pos_gwi_admin_demo Neon venue DB with the full menu,
 * tables, order types, roles, employees, and drawers from local gwi_pos_dev.
 *
 * After this runs, update .env.local DATABASE_URL to the Neon venue URL
 * and restart the dev server — then localhost:3005 and
 * gwi-admin-demo.ordercontrolcenter.com will share the same database
 * (instant sync, no workers needed).
 *
 * Usage:
 *   npx tsx scripts/seed-neon-venue.ts
 */

import { PrismaClient } from '@prisma/client'

const SOURCE_LOC = 'loc-1'
const TARGET_LOC = 'cmm80xd200002ld04nd39guhn' // GWI-ADMIN-Demo in Neon

const LOCAL_URL =
  process.env.LOCAL_DB_URL ||
  'postgresql://brianlewis@localhost/gwi_pos_dev'

const NEON_VENUE_URL =
  process.env.NEON_VENUE_URL ||
  'postgresql://neondb_owner:npg_oFx7hM6sTSwy@ep-withered-forest-ahcqgqj7-pooler.c-3.us-east-1.aws.neon.tech/gwi_pos_gwi_admin_demo?sslmode=require'

const NEON_VENUE_DIRECT_URL =
  'postgresql://neondb_owner:npg_oFx7hM6sTSwy@ep-withered-forest-ahcqgqj7.c-3.us-east-1.aws.neon.tech/gwi_pos_gwi_admin_demo?sslmode=require'

function client(url: string) {
  return new PrismaClient({ datasources: { db: { url } } })
}
function log(msg: string) { console.log(`  ✓ ${msg}`) }

// ─── Menu (categories, modifier groups, modifiers, items) ───────────────────

async function seedMenu(local: PrismaClient, neon: PrismaClient) {
  console.log('\n[neon] Clearing existing menu data...')
  // Delete in FK-safe order: menu items first (clears junction table), then groups, then categories
  await neon.menuItem.deleteMany({ where: { locationId: TARGET_LOC } })
  // Delete modifiers via their groups
  const existingGroups = await neon.modifierGroup.findMany({
    where: { locationId: TARGET_LOC },
    select: { id: true },
  })
  const groupIds = existingGroups.map((g: any) => g.id)
  if (groupIds.length) {
    await neon.modifier.deleteMany({ where: { modifierGroupId: { in: groupIds } } })
  }
  await neon.modifierGroup.deleteMany({ where: { locationId: TARGET_LOC } })
  await neon.category.deleteMany({ where: { locationId: TARGET_LOC } })
  log('Cleared existing categories, modifier groups, menu items')

  // Categories
  const cats = await local.category.findMany({
    where: { locationId: SOURCE_LOC, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  })
  const catIdMap: Record<string, string> = {}
  for (const cat of cats) {
    const { id: _id, locationId: _loc, createdAt: _ca, updatedAt: _ua,
            deletedAt: _da, syncedAt: _sa, ...rest } = cat as any
    const created = await neon.category.create({
      data: { ...rest, locationId: TARGET_LOC },
    })
    catIdMap[cat.id] = created.id
  }
  log(`${cats.length} categories`)

  // Modifier groups + modifiers
  const mgs = await local.modifierGroup.findMany({
    where: { locationId: SOURCE_LOC, deletedAt: null },
    include: { modifiers: { where: { deletedAt: null } } },
  })
  const mgIdMap: Record<string, string> = {}
  for (const mg of mgs) {
    const { id: _id, locationId: _loc, createdAt: _ca, updatedAt: _ua,
            deletedAt: _da, syncedAt: _sa, modifiers: _mods, ...mgRest } = mg as any
    const created = await neon.modifierGroup.create({
      data: { ...mgRest, locationId: TARGET_LOC },
    })
    mgIdMap[mg.id] = created.id
    for (const mod of mg.modifiers) {
      const { id: _mid, modifierGroupId: _mgid, createdAt: _mca, updatedAt: _mua,
              deletedAt: _mda, syncedAt: _msa, linkedMenuItemId: _lmi,
              parentModifierGroupId: _pmg, childModifierGroupId: _childMg,
              ...modRest } = mod as any
      await neon.modifier.create({
        data: { ...modRest, modifierGroupId: created.id, locationId: TARGET_LOC,
                childModifierGroupId: null },
      })
    }
  }
  log(`${mgs.length} modifier groups + modifiers`)

  // Menu items
  const items = await local.menuItem.findMany({
    where: { locationId: SOURCE_LOC, deletedAt: null },
    include: { ownedModifierGroups: true },
  })
  let count = 0
  for (const item of items) {
    const { id: _id, locationId: _loc, categoryId: srcCatId,
            createdAt: _ca, updatedAt: _ua, deletedAt: _da, syncedAt: _sa,
            ownedModifierGroups: _mgs, ...itemRest } = item as any
    const newCatId = catIdMap[srcCatId] ?? null
    const created = await neon.menuItem.create({
      data: { ...itemRest, locationId: TARGET_LOC, categoryId: newCatId },
    })
    for (const mg of item.ownedModifierGroups) {
      const newMgId = mgIdMap[mg.id]
      if (newMgId) {
        await neon.menuItem.update({
          where: { id: created.id },
          data: { ownedModifierGroups: { connect: { id: newMgId } } },
        })
      }
    }
    count++
  }
  log(`${count} menu items`)
}

// ─── Sections ────────────────────────────────────────────────────────────────

async function seedSections(local: PrismaClient, neon: PrismaClient): Promise<Record<string, string>> {
  console.log('\n[neon] Seeding sections (rooms)...')
  await neon.section.deleteMany({ where: { locationId: TARGET_LOC } })
  const sections = await local.section.findMany({
    where: { locationId: SOURCE_LOC, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  })
  const sectionIdMap: Record<string, string> = {}
  for (const s of sections) {
    const created = await neon.section.create({
      data: {
        locationId: TARGET_LOC,
        name: s.name,
        color: s.color,
        sortOrder: s.sortOrder,
        widthFeet: s.widthFeet,
        heightFeet: s.heightFeet,
        gridSizeFeet: s.gridSizeFeet,
      },
    })
    sectionIdMap[s.id] = created.id
  }
  log(`${sections.length} sections`)
  return sectionIdMap
}

// ─── Tables ─────────────────────────────────────────────────────────────────

async function seedTables(local: PrismaClient, neon: PrismaClient, sectionIdMap: Record<string, string> = {}) {
  console.log('\n[neon] Seeding tables...')
  const sourceTables = await local.table.findMany({
    where: { locationId: SOURCE_LOC, isActive: true, deletedAt: null },
  })
  await neon.table.deleteMany({ where: { locationId: TARGET_LOC } })
  for (const t of sourceTables) {
    const newSectionId = t.sectionId ? (sectionIdMap[t.sectionId] ?? null) : null
    await neon.table.create({
      data: {
        locationId: TARGET_LOC,
        name: t.name,
        capacity: t.capacity,
        sectionId: newSectionId,
        posX: t.posX,
        posY: t.posY,
        rotation: t.rotation,
        shape: t.shape,
        width: t.width,
        height: t.height,
      },
    })
  }
  log(`${sourceTables.length} tables`)
}

// ─── Order types ─────────────────────────────────────────────────────────────

async function seedOrderTypes(local: PrismaClient, neon: PrismaClient) {
  console.log('\n[neon] Seeding order types...')
  await neon.orderType.deleteMany({ where: { locationId: TARGET_LOC } })
  const types = await local.orderType.findMany({ where: { locationId: SOURCE_LOC } })
  for (const t of types) {
    await neon.orderType.create({
      data: { locationId: TARGET_LOC, name: t.name, slug: t.slug, color: t.color },
    })
  }
  log(`${types.length} order types`)
}

// ─── Roles + employees ───────────────────────────────────────────────────────

async function seedRolesAndEmployees(local: PrismaClient, neon: PrismaClient) {
  console.log('\n[neon] Seeding roles + employees...')
  await neon.employeeRole.deleteMany({ where: { employee: { locationId: TARGET_LOC } } })
  await neon.employee.deleteMany({ where: { locationId: TARGET_LOC } })
  await neon.role.deleteMany({ where: { locationId: TARGET_LOC } })

  const roles = await local.role.findMany({ where: { locationId: SOURCE_LOC } })
  const roleIdMap: Record<string, string> = {}
  for (const r of roles) {
    const created = await neon.role.create({
      data: { locationId: TARGET_LOC, name: r.name },
    })
    roleIdMap[r.id] = created.id
  }

  const emps = await local.employee.findMany({
    where: { locationId: SOURCE_LOC, isActive: true },
  })
  for (const e of emps) {
    const mappedRoleId = e.roleId ? roleIdMap[e.roleId] : undefined
    if (!mappedRoleId) continue
    await neon.employee.create({
      data: {
        locationId: TARGET_LOC,
        roleId: mappedRoleId,
        firstName: e.firstName,
        lastName: e.lastName,
        pin: e.pin,
        isActive: true,
      },
    })
  }
  log(`${roles.length} roles, ${emps.length} employees`)
}

// ─── Drawers ─────────────────────────────────────────────────────────────────

async function seedDrawers(local: PrismaClient, neon: PrismaClient) {
  console.log('\n[neon] Seeding drawers...')
  await neon.drawer.deleteMany({ where: { locationId: TARGET_LOC } })
  const drawers = await local.drawer.findMany({ where: { locationId: SOURCE_LOC } })
  for (const d of drawers) {
    await neon.drawer.create({
      data: { locationId: TARGET_LOC, name: d.name },
    })
  }
  log(`${drawers.length} drawers`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log(' Seeding Neon Venue: gwi_pos_gwi_admin_demo')
  console.log(`  Source: ${SOURCE_LOC} (local gwi_pos_dev)`)
  console.log(`  Target: ${TARGET_LOC} (Neon)`)
  console.log('═══════════════════════════════════════════════════')

  const local = client(LOCAL_URL)
  const neon = client(NEON_VENUE_URL)

  try {
    const sectionIdMap = await seedSections(local, neon)
    await seedMenu(local, neon)
    await seedTables(local, neon, sectionIdMap)
    await seedOrderTypes(local, neon)
    await seedRolesAndEmployees(local, neon)
    await seedDrawers(local, neon)

    console.log('\n═══════════════════════════════════════════════════')
    console.log(' Done! gwi_pos_gwi_admin_demo is now fully populated.')
    console.log('\n  Next: update .env.local DATABASE_URL to:')
    console.log(`  ${NEON_VENUE_URL}`)
    console.log('\n  Direct URL (for migrations):')
    console.log(`  ${NEON_VENUE_DIRECT_URL}`)
    console.log('\n  Then restart dev server — localhost:3005 and')
    console.log('  gwi-admin-demo.ordercontrolcenter.com will be')
    console.log('  live on the same database. Any change on one')
    console.log('  is instantly visible on the other.')
    console.log('═══════════════════════════════════════════════════\n')
  } finally {
    await local.$disconnect()
    await neon.$disconnect()
  }
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
