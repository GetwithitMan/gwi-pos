import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

const DEMO_LOCATION_ID = 'loc-demo-001'

// GET /api/modifier-templates - Get all modifier group templates
export const GET = withVenue(async function GET() {
  try {
    const templates = await db.modifierGroupTemplate.findMany({
      where: {
        locationId: DEMO_LOCATION_ID,
        deletedAt: null,
        isActive: true,
      },
      include: {
        modifiers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        minSelections: t.minSelections,
        maxSelections: t.maxSelections,
        isRequired: t.isRequired,
        modifierCount: t.modifiers.length,
        modifiers: t.modifiers.map(m => ({
          id: m.id,
          name: m.name,
          price: Number(m.price),
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: Number(m.extraPrice),
          isDefault: m.isDefault,
        })),
      })),
    })
  } catch (error) {
    console.error('Error fetching modifier templates:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
})

// POST /api/modifier-templates - Create a new template
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      description,
      minSelections = 0,
      maxSelections = 1,
      isRequired = false,
      modifiers = [],
    } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Get max sort order
    const maxSort = await db.modifierGroupTemplate.aggregate({
      where: { locationId: DEMO_LOCATION_ID },
      _max: { sortOrder: true },
    })

    const template = await db.modifierGroupTemplate.create({
      data: {
        locationId: DEMO_LOCATION_ID,
        name: name.trim(),
        description: description?.trim() || null,
        minSelections,
        maxSelections,
        isRequired,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        modifiers: modifiers.length > 0
          ? {
              create: modifiers.map((m: {
                name: string
                price?: number
                allowNo?: boolean
                allowLite?: boolean
                allowOnSide?: boolean
                allowExtra?: boolean
                extraPrice?: number
                isDefault?: boolean
              }, index: number) => ({
                name: m.name,
                price: m.price || 0,
                allowNo: m.allowNo ?? true,
                allowLite: m.allowLite ?? false,
                allowOnSide: m.allowOnSide ?? false,
                allowExtra: m.allowExtra ?? false,
                extraPrice: m.extraPrice || 0,
                isDefault: m.isDefault ?? false,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: {
        modifiers: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({
      data: {
        id: template.id,
        name: template.name,
        description: template.description,
        minSelections: template.minSelections,
        maxSelections: template.maxSelections,
        isRequired: template.isRequired,
        modifiers: template.modifiers.map(m => ({
          id: m.id,
          name: m.name,
          price: Number(m.price),
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: Number(m.extraPrice),
          isDefault: m.isDefault,
        })),
      },
    })
  } catch (error) {
    console.error('Error creating modifier template:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
})
