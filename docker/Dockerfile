# GWI POS - Production Dockerfile
# Multi-stage build for optimized Next.js deployment

# ==============================================================================
# Stage 1: Dependencies
# ==============================================================================
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci

# ==============================================================================
# Stage 2: Builder
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (outputs to src/generated/prisma/ per schema config)
RUN npx prisma generate

# Build Next.js + custom server (CI handles version bumps, schema SQL, artifacts)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx next build && node scripts/build-server.mjs

# ==============================================================================
# Stage 3: Runner (Production)
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN apk add --no-cache postgresql-client curl tzdata

ENV TZ=America/New_York

# Copy standalone Next.js build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy custom server (compiled from server.ts by build-server.mjs)
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/preload.js ./preload.js

# Copy Prisma client (generated to src/generated/prisma/)
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy Prisma schema + migrations for deploy-tools
COPY --from=builder /app/prisma ./prisma

# Copy deploy-tools for schema migrations
COPY --from=builder /app/deploy-tools ./deploy-tools
COPY --from=builder /app/scripts/migrations ./scripts/migrations

RUN mkdir -p /app/uploads
RUN chown -R nextjs:nodejs /app

USER nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "-r", "./preload.js", "server.js"]
