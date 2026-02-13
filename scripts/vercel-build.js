#!/usr/bin/env node
/**
 * Vercel Build Script
 *
 * Pushes schema to PostgreSQL (Neon) and builds the app.
 * Both dev and prod use the same PostgreSQL engine.
 */
const { execSync } = require('child_process')

try {
  // Generate Prisma client
  console.log('[vercel-build] Running prisma generate...')
  execSync('npx prisma generate', { stdio: 'inherit' })

  // Push schema to Neon PostgreSQL (creates/updates tables)
  console.log('[vercel-build] Running prisma db push...')
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' })

  // Build Next.js
  console.log('[vercel-build] Running next build...')
  execSync('npx next build', { stdio: 'inherit' })

  console.log('[vercel-build] Build complete!')
} catch (err) {
  console.error('[vercel-build] Build failed:', err.message)
  process.exit(1)
}
