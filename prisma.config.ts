import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// Load .env.local first (dev local DB), then fall back to .env
// This ensures `npx prisma migrate/studio/push` always targets
// the local gwi_pos_dev database, never the placeholder in .env
config({ path: '.env.local', override: true })
config({ path: '.env' })

export default defineConfig({
  schema: './prisma/schema.prisma',
})
