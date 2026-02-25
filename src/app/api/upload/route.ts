import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { PERMISSIONS } from '@/lib/auth'
import { requirePermission } from '@/lib/api-auth'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { validateMagicBytes } from '@/lib/file-validation'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'menu-items')
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // Auth check — require menu.edit_items permission
    const employeeId = formData.get('employeeId') as string | null
    const formLocationId = formData.get('locationId') as string | null

    // Resolve locationId — form data → fallback to cached location
    const locationId = formLocationId || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MENU_EDIT_ITEMS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, WebP, and GIF images are allowed' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Image must be under 5MB' }, { status: 400 })
    }

    // Validate magic bytes match claimed Content-Type (prevents spoofed uploads)
    const fileBytes = await file.arrayBuffer()
    const buffer = Buffer.from(fileBytes)
    if (!validateMagicBytes(buffer, file.type)) {
      return NextResponse.json(
        { error: 'File content does not match declared type. Upload a valid image file.' },
        { status: 400 }
      )
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'jpg'
    const filename = `${crypto.randomUUID()}.${ext}`

    // Ensure directory exists
    await mkdir(UPLOAD_DIR, { recursive: true })

    // Write file (buffer already read above for magic bytes validation)
    await writeFile(path.join(UPLOAD_DIR, filename), buffer)

    const url = `/uploads/menu-items/${filename}`

    return NextResponse.json({ data: { url } })
  } catch (error) {
    console.error('Upload failed:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
})
