import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// Respect externally-supplied DATABASE_URL first (provisioning, CI, Vercel).
// Only load .env.local as fallback for local dev where no DATABASE_URL is set.
const externalUrl = process.env.DATABASE_URL
if (!externalUrl) {
  config({ path: '.env.local', override: true })
  config({ path: '.env' })
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
