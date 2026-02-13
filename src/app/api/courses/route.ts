import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// Default course configuration
const DEFAULT_COURSES = [
  { courseNumber: 1, name: 'Appetizers', displayName: 'Apps', color: '#3B82F6' },
  { courseNumber: 2, name: 'Soup/Salad', displayName: 'Soup/Salad', color: '#10B981' },
  { courseNumber: 3, name: 'Entrees', displayName: 'Mains', color: '#F59E0B' },
  { courseNumber: 4, name: 'Dessert', displayName: 'Dessert', color: '#EC4899' },
  { courseNumber: 5, name: 'After-Dinner', displayName: 'After', color: '#8B5CF6' },
]

// Special course indicators (not stored in DB, but used in UI)
export const SPECIAL_COURSES = {
  ASAP: 0,   // Fire immediately (no course grouping)
  HOLD: -1,  // Hold until manually released
}

// GET - List course configurations for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get custom course configs or return defaults
    const courseConfigs = await db.courseConfig.findMany({
      where: {
        locationId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    })

    // If no custom configs, return defaults with location context
    if (courseConfigs.length === 0) {
      return NextResponse.json({
        courses: DEFAULT_COURSES.map((c, idx) => ({
          ...c,
          id: `default-${c.courseNumber}`,
          locationId,
          sortOrder: idx,
          isActive: true,
          autoFireDelay: null,
          isDefault: true,
        })),
        isDefault: true,
      })
    }

    return NextResponse.json({
      courses: courseConfigs.map(c => ({
        id: c.id,
        locationId: c.locationId,
        courseNumber: c.courseNumber,
        name: c.name,
        displayName: c.displayName,
        color: c.color,
        autoFireDelay: c.autoFireDelay,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        isDefault: false,
      })),
      isDefault: false,
    })
  } catch (error) {
    console.error('Failed to fetch courses:', error)
    return NextResponse.json(
      { error: 'Failed to fetch courses' },
      { status: 500 }
    )
  }
})

// POST - Create or update course configuration
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      courseNumber,
      name,
      displayName,
      color,
      autoFireDelay,
      sortOrder,
    } = body

    if (!locationId || !courseNumber || !name) {
      return NextResponse.json(
        { error: 'Location ID, course number, and name are required' },
        { status: 400 }
      )
    }

    // Upsert course config
    const courseConfig = await db.courseConfig.upsert({
      where: {
        locationId_courseNumber: {
          locationId,
          courseNumber,
        },
      },
      update: {
        name,
        displayName: displayName || null,
        color: color || null,
        autoFireDelay: autoFireDelay || null,
        sortOrder: sortOrder ?? courseNumber - 1,
        deletedAt: null,
        isActive: true,
      },
      create: {
        locationId,
        courseNumber,
        name,
        displayName: displayName || null,
        color: color || null,
        autoFireDelay: autoFireDelay || null,
        sortOrder: sortOrder ?? courseNumber - 1,
      },
    })

    return NextResponse.json({
      success: true,
      courseConfig,
    })
  } catch (error) {
    console.error('Failed to save course config:', error)
    return NextResponse.json(
      { error: 'Failed to save course config' },
      { status: 500 }
    )
  }
})

// PUT - Initialize location with default courses
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Create all default courses for the location
    const createdConfigs = await Promise.all(
      DEFAULT_COURSES.map((course, idx) =>
        db.courseConfig.upsert({
          where: {
            locationId_courseNumber: {
              locationId,
              courseNumber: course.courseNumber,
            },
          },
          update: {
            name: course.name,
            displayName: course.displayName,
            color: course.color,
            sortOrder: idx,
            isActive: true,
            deletedAt: null,
          },
          create: {
            locationId,
            courseNumber: course.courseNumber,
            name: course.name,
            displayName: course.displayName,
            color: course.color,
            sortOrder: idx,
          },
        })
      )
    )

    return NextResponse.json({
      success: true,
      courses: createdConfigs,
    })
  } catch (error) {
    console.error('Failed to initialize courses:', error)
    return NextResponse.json(
      { error: 'Failed to initialize courses' },
      { status: 500 }
    )
  }
})
