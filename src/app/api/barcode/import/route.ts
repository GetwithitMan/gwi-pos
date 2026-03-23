import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { withAuth } from '@/lib/api-auth-middleware'

interface ImportRow {
  barcode: string
  menuItemName?: string
  inventoryItemName?: string
  packSize?: number
  price?: number
  label?: string
}

interface ImportError {
  row: number
  barcode: string
  reason: string
}

const BATCH_SIZE = 100

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId: bodyLocationId, rows } = body

    const locationId = bodyLocationId || await getLocationId()

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    if (rows.length > 5000) {
      return NextResponse.json({ error: 'Maximum 5000 rows per import' }, { status: 400 })
    }

    // Pre-fetch existing barcodes at this location for dedup
    const existingBarcodes = await db.itemBarcode.findMany({
      where: { locationId, deletedAt: null },
      select: { barcode: true },
    })
    const existingSet = new Set(existingBarcodes.map(b => b.barcode))

    // Pre-fetch menu items and inventory items for name lookups
    const menuItems = await db.menuItem.findMany({
      where: { locationId, deletedAt: null },
      select: { id: true, name: true },
    })
    const inventoryItems = await db.inventoryItem.findMany({
      where: { locationId, deletedAt: null },
      select: { id: true, name: true },
    })

    // Build case-insensitive lookup maps
    const menuItemsByName = new Map<string, { id: string; name: string }>()
    for (const item of menuItems) {
      menuItemsByName.set(item.name.toLowerCase(), item)
    }
    const inventoryItemsByName = new Map<string, { id: string; name: string }>()
    for (const item of inventoryItems) {
      inventoryItemsByName.set(item.name.toLowerCase(), item)
    }

    let created = 0
    let skipped = 0
    const errors: ImportError[] = []
    const toCreate: Array<{
      locationId: string
      barcode: string
      label: string | null
      packSize: number
      price: number | null
      menuItemId: string | null
      inventoryItemId: string | null
    }> = []

    // Validate and prepare each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as ImportRow
      const rowNum = i + 1
      const barcode = (row.barcode || '').trim()

      if (!barcode) {
        errors.push({ row: rowNum, barcode: '', reason: 'Missing barcode' })
        continue
      }

      // Check for duplicate within this import batch
      if (toCreate.some(r => r.barcode === barcode)) {
        skipped++
        continue
      }

      // Check existing at location
      if (existingSet.has(barcode)) {
        skipped++
        continue
      }

      let menuItemId: string | null = null
      let inventoryItemId: string | null = null

      if (row.menuItemName) {
        const match = menuItemsByName.get(row.menuItemName.trim().toLowerCase())
        if (!match) {
          errors.push({ row: rowNum, barcode, reason: `Menu item not found: "${row.menuItemName}"` })
          continue
        }
        menuItemId = match.id
      }

      if (row.inventoryItemName) {
        const match = inventoryItemsByName.get(row.inventoryItemName.trim().toLowerCase())
        if (!match) {
          errors.push({ row: rowNum, barcode, reason: `Inventory item not found: "${row.inventoryItemName}"` })
          continue
        }
        inventoryItemId = match.id
      }

      if (!menuItemId && !inventoryItemId) {
        errors.push({ row: rowNum, barcode, reason: 'No menu item or inventory item specified' })
        continue
      }

      toCreate.push({
        locationId,
        barcode,
        label: row.label?.trim() || null,
        packSize: row.packSize && row.packSize > 0 ? Math.floor(row.packSize) : 1,
        price: row.price != null && row.price >= 0 ? row.price : null,
        menuItemId,
        inventoryItemId,
      })
    }

    // Batch insert
    for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
      const batch = toCreate.slice(i, i + BATCH_SIZE)
      try {
        const result = await db.itemBarcode.createMany({
          data: batch,
          skipDuplicates: true,
        })
        created += result.count
      } catch (err) {
        // Fallback: try individual creates if batch fails
        for (const item of batch) {
          try {
            await db.itemBarcode.create({ data: item })
            created++
          } catch (itemErr) {
            const reason = itemErr instanceof Error ? itemErr.message : 'Database error'
            errors.push({ row: 0, barcode: item.barcode, reason })
          }
        }
      }
    }

    return NextResponse.json({
      created,
      skipped,
      errors,
      total: rows.length,
    })
  } catch (error) {
    console.error('Failed to import barcodes:', error)
    return NextResponse.json({ error: 'Failed to import barcodes' }, { status: 500 })
  }
}))
