import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const MODULES_DIR = join(process.cwd(), 'public', 'installer-modules')

const ALLOWED_MODULES = new Set([
  '01-preflight.sh',
  '02-register.sh',
  '03-secrets.sh',
  '04-database.sh',
  '05-deploy-app.sh',
  '06-schema.sh',
  '07-services.sh',
  '08-ha.sh',
  '09-remote-access.sh',
  '10-finalize.sh',
  '11-system-hardening.sh',
])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  // Allowlist only — prevent path traversal
  if (!ALLOWED_MODULES.has(name)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const filePath = join(MODULES_DIR, name)
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const content = await readFile(filePath, 'utf-8')
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
