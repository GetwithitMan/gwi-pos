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

# Cache bust: changes every commit so COPY and next build are never stale
ARG CACHE_BUST
COPY . .

# Generate Prisma client (outputs to src/generated/prisma/ per schema config)
RUN npx prisma generate

# Install deploy-tools dependencies (pg only, for schema migrations)
RUN cd deploy-tools && npm install --omit=dev && cd ..

# Build Next.js + custom server (CI handles version bumps, schema SQL, artifacts)
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# CACHE_BUST is set to git SHA — forces fresh build on every commit.
# Without this, BuildX content-addressable cache can reuse stale next build output.
RUN echo "build:${CACHE_BUST:-dev}" && npx next build && node scripts/build-server.mjs

# ==============================================================================
# Stage 3: Runner (Production)
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

RUN apk add --no-cache postgresql-client curl tzdata docker-cli bash

ENV TZ=America/New_York

# Copy the full built app. The custom server.ts imports socket.io, pg, pino,
# and dozens of other packages that Next.js standalone tracing doesn't capture.
# Larger image (~400MB vs ~150MB) but guaranteed to have everything.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/preload.js ./preload.js
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/deploy-tools ./deploy-tools
COPY --from=builder /app/scripts/migrations ./scripts/migrations
# migrate.js looks for migrations at deploy-tools/migrations (path.join(__dirname, '..', 'migrations'))
COPY --from=builder /app/scripts/migrations ./deploy-tools/migrations
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /app/uploads
RUN chown -R nextjs:nodejs /app

USER nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000}/api/health/ready || exit 1

CMD ["node", "-r", "./preload.js", "server.js"]
