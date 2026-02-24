import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

interface ImportError {
  row: number
  error: string
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip next quote
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  fields.push(current.trim())
  return fields
}

function normalizeHeader(header: string): string {
  const h = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '')
  const headerMap: Record<string, string> = {
    name: 'name',
    itemname: 'name',
    item: 'name',
    menuitem: 'name',
    product: 'name',
    price: 'price',
    itemprice: 'price',
    saleprice: 'price',
    category: 'category',
    categoryname: 'category',
    dept: 'category',
    department: 'category',
    cost: 'cost',
    itemcost: 'cost',
    foodcost: 'cost',
    sku: 'sku',
    itemsku: 'sku',
    barcode: 'sku',
    upc: 'sku',
    description: 'description',
    desc: 'description',
    itemdescription: 'description',
  }
  return headerMap[h] || h
}

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const locationId = formData.get('locationId') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const text = await file.text()
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV must have a header row and at least one data row' },
        { status: 400 }
      )
    }

    // Parse header
    const rawHeaders = parseCSVLine(lines[0])
    const headers = rawHeaders.map(normalizeHeader)

    const nameIdx = headers.indexOf('name')
    const priceIdx = headers.indexOf('price')
    const categoryIdx = headers.indexOf('category')
    const costIdx = headers.indexOf('cost')
    const skuIdx = headers.indexOf('sku')
    const descIdx = headers.indexOf('description')

    if (nameIdx === -1) {
      return NextResponse.json(
        { error: 'CSV must have a "name" column' },
        { status: 400 }
      )
    }

    if (priceIdx === -1) {
      return NextResponse.json(
        { error: 'CSV must have a "price" column' },
        { status: 400 }
      )
    }

    // Cache: category name (lowercase) → category record
    const categoryCache = new Map<string, { id: string }>()

    // Load existing categories
    const existingCategories = await db.category.findMany({
      where: { locationId, deletedAt: null },
      select: { id: true, name: true },
    })
    for (const cat of existingCategories) {
      categoryCache.set(cat.name.toLowerCase(), { id: cat.id })
    }

    // Load existing menu items for duplicate detection
    const existingItems = await db.menuItem.findMany({
      where: { locationId, deletedAt: null },
      select: { name: true, categoryId: true },
    })
    const existingItemKeys = new Set(
      existingItems.map((i) => `${i.name.toLowerCase()}::${i.categoryId}`)
    )

    let imported = 0
    let skipped = 0
    const errors: ImportError[] = []

    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1
      const fields = parseCSVLine(lines[i])

      const name = fields[nameIdx]?.trim()
      const priceStr = fields[priceIdx]?.trim()
      const categoryName = categoryIdx !== -1 ? fields[categoryIdx]?.trim() : ''
      const costStr = costIdx !== -1 ? fields[costIdx]?.trim() : ''
      const sku = skuIdx !== -1 ? fields[skuIdx]?.trim() : ''
      const description = descIdx !== -1 ? fields[descIdx]?.trim() : ''

      if (!name) {
        errors.push({ row: rowNum, error: 'Missing name' })
        continue
      }

      const price = parseFloat(priceStr)
      if (isNaN(price) || price < 0) {
        errors.push({ row: rowNum, error: `Invalid price "${priceStr}"` })
        continue
      }

      // Resolve category
      const catKey = (categoryName || 'Imported').toLowerCase()
      let category = categoryCache.get(catKey)

      if (!category) {
        // Create category
        const newCat = await db.category.create({
          data: {
            locationId,
            name: categoryName || 'Imported',
            categoryType: 'food',
            sortOrder: categoryCache.size,
          },
        })
        category = { id: newCat.id }
        categoryCache.set(catKey, category)
      }

      // Check for duplicates
      const itemKey = `${name.toLowerCase()}::${category.id}`
      if (existingItemKeys.has(itemKey)) {
        skipped++
        continue
      }

      // Parse optional cost
      const cost = costStr ? parseFloat(costStr) : undefined

      // Create menu item
      await db.menuItem.create({
        data: {
          locationId,
          categoryId: category.id,
          name,
          price,
          ...(cost !== undefined && !isNaN(cost) ? { cost } : {}),
          ...(sku ? { sku } : {}),
          ...(description ? { description } : {}),
        },
      })

      existingItemKeys.add(itemKey)
      imported++
    }

    return NextResponse.json({
      data: {
        imported,
        skipped,
        errors,
      },
    })
  } catch (error) {
    console.error('CSV import failed:', error)
    return NextResponse.json({ error: 'CSV import failed' }, { status: 500 })
  }
})
