#!/usr/bin/env tsx
/**
 * seed-gwi-admin-dev.ts
 *
 * Fully seeds the GWI-ADMIN-DEV org/location in:
 *   1. LOCAL PostgreSQL (gwi_pos_dev) — full menu, employees, hardware
 *   2. NEON (production MC) — org, location, employees only
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-gwi-admin-dev.ts
 *
 * Or with explicit DBs:
 *   LOCAL_URL=... NEON_URL=... npx tsx scripts/seed-gwi-admin-dev.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const ORG_ID  = 'cmm7zv5y0000604js1umry0ch'
const LOC_ID  = 'cmm802vg50001ceud43jxhtnl'
const SOURCE  = 'loc-1'   // copy menu from this existing local location

const LOCAL_URL = process.env.LOCAL_DB_URL  || process.env.DATABASE_URL!
const NEON_URL  = process.env.NEON_DB_URL   ||
  'postgresql://neondb_owner:npg_oFx7hM6sTSwy@ep-withered-forest-ahcqgqj7.c-3.us-east-1.aws.neon.tech/gwi_pos?sslmode=require'

// ─── helpers ────────────────────────────────────────────────────────────────

function client(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
}

function log(msg: string) { console.log(`  ${msg}`) }

// ─── 1. Core org + location (both DBs) ──────────────────────────────────────

async function seedCore(db: PrismaClient, label: string) {
  console.log(`\n[${label}] org + location`)

  await db.organization.upsert({
    where:  { id: ORG_ID },
    update: { name: 'GWI-ADMIN-DEV' },
    create: { id: ORG_ID, name: 'GWI-ADMIN-DEV' },
  })
  log('org upserted')

  await db.location.upsert({
    where:  { id: LOC_ID },
    update: {},
    create: {
      id:             LOC_ID,
      organizationId: ORG_ID,
      name:           'GWI-ADMIN-DEV',
      slug:           'gwi-admin-dev',
      timezone:       'America/Denver',
      address:        '1167, Fruita CO 81521',
      phone:          '9704172930',
      settings:       {},
    },
  })
  log('location upserted')
}

// ─── 2. Roles + employees ────────────────────────────────────────────────────

async function seedEmployees(db: PrismaClient, label: string) {
  console.log(`\n[${label}] roles + employees`)

  const roleNames = ['Super Admin', 'Manager', 'Server', 'Bartender', 'Barback']
  const roleMap: Record<string, string> = {}

  for (const name of roleNames) {
    const existing = await db.role.findFirst({ where: { name, locationId: LOC_ID } })
    if (existing) {
      roleMap[name] = existing.id
    } else {
      const r = await db.role.create({ data: { locationId: LOC_ID, name } })
      roleMap[name] = r.id
    }
  }
  log(`roles: ${roleNames.join(', ')}`)

  const employees = [
    { name: 'Dev Admin',     firstName: 'Dev',   lastName: 'Admin',   pin: '0000', role: 'Super Admin' },
    { name: 'Demo Manager',  firstName: 'Demo',  lastName: 'Manager', pin: '1234', role: 'Manager' },
    { name: 'Sarah S.',      firstName: 'Sarah', lastName: 'S.',      pin: '2345', role: 'Server' },
    { name: 'Mike B.',       firstName: 'Mike',  lastName: 'B.',      pin: '3456', role: 'Bartender' },
    { name: 'Barback Demo',  firstName: 'Barback',lastName: 'Demo',   pin: '9999', role: 'Barback' },
  ]

  for (const e of employees) {
    const existing = await db.employee.findFirst({ where: { locationId: LOC_ID, pin: e.pin } })
    if (!existing) {
      await db.employee.create({
        data: {
          locationId: LOC_ID,
          roleId:     roleMap[e.role],
          firstName:  e.firstName,
          lastName:   e.lastName,
          pin:        e.pin,
          isActive:   true,
        },
      })
    }
  }
  log(`employees: ${employees.map(e => `${e.name} (${e.pin})`).join(', ')}`)
}

// ─── 3. Order types ──────────────────────────────────────────────────────────

async function seedOrderTypes(db: PrismaClient) {
  console.log('\n[local] order types')
  const types = [
    { name: 'Dine In',  slug: 'dine-in',  color: '#22c55e' },
    { name: 'Bar Tab',  slug: 'bar-tab',  color: '#3b82f6' },
    { name: 'To Go',    slug: 'to-go',    color: '#f59e0b' },
    { name: 'Delivery', slug: 'delivery', color: '#8b5cf6' },
  ]
  for (const t of types) {
    const existing = await db.orderType.findFirst({ where: { locationId: LOC_ID, name: t.name } })
    if (!existing) {
      await db.orderType.create({ data: { locationId: LOC_ID, name: t.name, slug: t.slug, color: t.color } })
    }
  }
  log(types.map(t => t.name).join(', '))
}

// ─── 4. Tables ───────────────────────────────────────────────────────────────

async function seedTables(db: PrismaClient) {
  console.log('\n[local] tables')
  const tables = [
    { name: 'Table 1', capacity: 4 }, { name: 'Table 2', capacity: 4 },
    { name: 'Table 3', capacity: 6 }, { name: 'Table 4', capacity: 6 },
    { name: 'Bar 1',   capacity: 2 }, { name: 'Bar 2',   capacity: 2 },
    { name: 'Bar 3',   capacity: 2 }, { name: 'Patio 1', capacity: 4 },
  ]
  for (const t of tables) {
    const existing = await db.table.findFirst({ where: { locationId: LOC_ID, name: t.name } })
    if (!existing) {
      await db.table.create({ data: { locationId: LOC_ID, name: t.name, capacity: t.capacity } })
    }
  }
  log(`${tables.length} tables`)
}

// ─── 5. Drawers ──────────────────────────────────────────────────────────────

async function seedDrawers(db: PrismaClient) {
  console.log('\n[local] drawers')
  const drawers = ['Bar Drawer 1', 'Bar Drawer 2', 'Register 1']
  for (const name of drawers) {
    const existing = await db.drawer.findFirst({ where: { locationId: LOC_ID, name } })
    if (!existing) {
      await db.drawer.create({ data: { locationId: LOC_ID, name } })
    }
  }
  log(drawers.join(', '))
}

// ─── 6. Payment reader + terminal ────────────────────────────────────────────

async function seedHardware(db: PrismaClient) {
  console.log('\n[local] payment reader + terminal')

  const reader = await db.paymentReader.upsert({
    where:  { serialNumber: 'DEV-001' },
    update: { communicationMode: 'local', isActive: true },
    create: {
      locationId:        LOC_ID,
      name:              'Dev Card Reader',
      serialNumber:      'DEV-001',
      ipAddress:         '127.0.0.1',
      port:              8080,
      verificationType:  'IP_ONLY',
      communicationMode: 'local',
      isActive:          true,
      isOnline:          false,
    },
  })
  log(`reader: ${reader.name}`)

  const existing = await db.terminal.findFirst({ where: { locationId: LOC_ID, name: 'Dev Terminal 1' } })
  if (!existing) {
    const term = await db.terminal.create({
      data: {
        locationId:      LOC_ID,
        name:            'Dev Terminal 1',
        paymentReaderId: reader.id,
      },
    })
    log(`terminal: ${term.name}`)
  } else {
    log('terminal already exists')
  }
}

// ─── 7. Copy full menu from loc-1 ────────────────────────────────────────────

async function copyMenu(db: PrismaClient) {
  console.log('\n[local] copying menu from loc-1')

  // Check source exists
  const source = await db.location.findUnique({ where: { id: SOURCE } })
  if (!source) {
    log('⚠ loc-1 not found — skipping menu copy (run main seed first)')
    return
  }

  // Categories
  const cats = await db.category.findMany({ where: { locationId: SOURCE, deletedAt: null } })
  const catIdMap: Record<string, string> = {}

  for (const cat of cats) {
    const existing = await db.category.findFirst({ where: { locationId: LOC_ID, name: cat.name } })
    if (existing) {
      catIdMap[cat.id] = existing.id
    } else {
      const { id: _id, locationId: _loc, createdAt: _ca, updatedAt: _ua, deletedAt: _da, syncedAt: _sa, ...rest } = cat as any
      const created = await db.category.create({ data: { ...rest, locationId: LOC_ID } })
      catIdMap[cat.id] = created.id
    }
  }
  log(`${cats.length} categories`)

  // Modifier groups + modifiers
  const mgs = await db.modifierGroup.findMany({
    where: { locationId: SOURCE, deletedAt: null },
    include: { modifiers: { where: { deletedAt: null } } },
  })
  const mgIdMap: Record<string, string> = {}

  for (const mg of mgs) {
    const existing = await db.modifierGroup.findFirst({ where: { locationId: LOC_ID, name: mg.name } })
    if (existing) {
      mgIdMap[mg.id] = existing.id
    } else {
      const { id: _id, locationId: _loc, createdAt: _ca, updatedAt: _ua, deletedAt: _da, syncedAt: _sa, modifiers: _mods, ...mgRest } = mg as any
      const created = await db.modifierGroup.create({ data: { ...mgRest, locationId: LOC_ID } })
      mgIdMap[mg.id] = created.id

      for (const mod of mg.modifiers) {
        const { id: _mid, modifierGroupId: _mgid, createdAt: _mca, updatedAt: _mua, deletedAt: _mda, syncedAt: _msa, linkedMenuItemId: _lmi, parentModifierGroupId: _pmg, ...modRest } = mod as any
        await db.modifier.create({ data: { ...modRest, modifierGroupId: created.id } })
      }
    }
  }
  log(`${mgs.length} modifier groups + modifiers`)

  // Menu items
  const items = await db.menuItem.findMany({
    where: { locationId: SOURCE, deletedAt: null },
    include: { ownedModifierGroups: true },
  })

  let copied = 0
  for (const item of items) {
    const existing = await db.menuItem.findFirst({ where: { locationId: LOC_ID, name: item.name } })
    if (!existing) {
      const { id: _id, locationId: _loc, categoryId: srcCatId, createdAt: _ca, updatedAt: _ua, deletedAt: _da, syncedAt: _sa, ownedModifierGroups: _mgs, ...itemRest } = item as any
      const newCatId = catIdMap[srcCatId] ?? null
      const created = await db.menuItem.create({ data: { ...itemRest, locationId: LOC_ID, categoryId: newCatId } })

      // link modifier groups
      for (const mg of item.ownedModifierGroups) {
        const newMgId = mgIdMap[mg.id]
        if (newMgId) {
          await db.menuItem.update({
            where: { id: created.id },
            data: { ownedModifierGroups: { connect: { id: newMgId } } },
          })
        }
      }
      copied++
    }
  }
  log(`${copied} menu items copied (${items.length - copied} already existed)`)
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════')
  console.log(' GWI-ADMIN-DEV Setup')
  console.log(`  Org:      ${ORG_ID}`)
  console.log(`  Location: ${LOC_ID}`)
  console.log('═══════════════════════════════════════════')

  const local = client(LOCAL_URL)
  const neon  = client(NEON_URL)

  try {
    // ── local DB ──
    await seedCore(local, 'local')
    await seedEmployees(local, 'local')
    await seedOrderTypes(local)
    await seedTables(local)
    await seedDrawers(local)
    await seedHardware(local)
    await copyMenu(local)

    // ── neon (light: org + location + employees only) ──
    await seedCore(neon, 'neon')
    await seedEmployees(neon, 'neon')

    console.log('\n═══════════════════════════════════════════')
    console.log(' Done!')
    console.log('  Local DB: full menu + hardware ready')
    console.log('  Neon:     org + location + employees synced')
    console.log('\n  Dev credentials:')
    console.log('    Manager  PIN: 1234')
    console.log('    Server   PIN: 2345')
    console.log('    Bartender PIN: 3456')
    console.log('\n  NUC address for Android pairing:')
    console.log('    http://172.16.20.126:3005')
    console.log('═══════════════════════════════════════════\n')
  } finally {
    await local.$disconnect()
    await neon.$disconnect()
  }
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })
