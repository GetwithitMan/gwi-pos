# GWI POS - Build Plan

**Version:** 2.0
**Created:** January 27, 2026
**Updated:** January 30, 2026
**Domain:** https://barpos.restaurant

---

## System Architecture Overview

GWI POS is a **hybrid SaaS** point-of-sale system with local servers at each location for speed and offline capability.

```
┌─────────────────────────────────────────────────────────────────┐
│                    GWI ADMIN CONSOLE (Cloud)                     │
│  • Onboard new locations        • Push updates                  │
│  • Manage subscriptions         • Aggregate reporting           │
│  • Monitor all locations        • License enforcement           │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Sync when online
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                LOCAL SERVER (Ubuntu Mini PC)                     │
│  Docker Compose:                                                │
│  ├── GWI POS (Next.js)           ├── SQLite/PostgreSQL         │
│  ├── Socket.io (real-time)       └── Watchtower (auto-updates) │
│                                                                 │
│  • Manages all terminals + devices                              │
│  • Works 100% offline                                           │
│  • Sub-10ms response times                                      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Local network (WiFi/Ethernet)
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │Terminal │    │Terminal │    │ Phone/  │
         │   #1    │    │   #2    │    │  iPad   │
         │(browser)│    │(browser)│    │  (PWA)  │
         └─────────┘    └─────────┘    └─────────┘
```

**Full architecture details:** See `/docs/GWI-ARCHITECTURE.md`

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 16.1.5 | React framework with App Router |
| **React** | 19.2.3 | UI Library |
| **TypeScript** | 5.x | Type safety |
| **Tailwind CSS** | 4.x | Styling |
| **Zustand** | 5.x | State management |
| **Zod** | 4.x | Runtime validation |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js API Routes** | 16.x | Primary API |
| **Prisma** | 6.19.2 | ORM with type-safe queries |
| **SQLite** | - | Development database |
| **PostgreSQL** | 15+ | Production database (optional) |
| **Socket.io** | 4.x | Real-time communication |

### Database Strategy

| Environment | Database | File/Connection |
|-------------|----------|-----------------|
| **Development** | SQLite | `prisma/pos.db` (local file) |
| **Local Production** | SQLite or PostgreSQL | Per-location choice |
| **Cloud Admin** | PostgreSQL | Neon/Supabase (planned) |

**Why SQLite for Development?**
- Zero configuration required
- Single file database, easy to backup/restore
- Fast for development iteration
- Works great for single-server deployments
- Can migrate to PostgreSQL when needed

### Infrastructure

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Local Server** | Ubuntu 24 LTS | Headless Linux server per location |
| **Containerization** | Docker Compose | Deployment + auto-restart |
| **Auto-Updates** | Watchtower | Pull new images automatically |
| **Cloud Hosting** | Vercel | Admin console only (Phase 2) |
| **Cloud Database** | Neon/Supabase | Admin console + aggregated data |

---

## Database Architecture

### Multi-Environment Support

```
DEVELOPMENT (Your Mac)
├── DATABASE_URL="file:./pos.db"
├── SQLite via better-sqlite3
└── Fast iteration, easy reset

LOCAL PRODUCTION (Restaurant Server)
├── Option A: SQLite (simpler)
│   └── DATABASE_URL="file:/data/pos.db"
├── Option B: PostgreSQL (more robust)
│   └── DATABASE_URL="postgresql://pos:pass@localhost:5432/pos"
└── Docker Compose handles either

CLOUD ADMIN (Vercel)
├── PostgreSQL (Neon/Supabase)
├── DATABASE_URL from Vercel env
└── Aggregated data from all locations
```

### Schema Requirements

Every table (except Organization/Location) must have:

```prisma
model ExampleTable {
  id         String    @id @default(cuid())
  locationId String                           // Multi-tenancy
  location   Location  @relation(...)

  // Business fields...

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  // Sync fields (REQUIRED)
  deletedAt  DateTime?                        // Soft deletes
  syncedAt   DateTime?                        // Cloud sync tracking

  @@index([locationId])
}
```

### Current Status

| Requirement | Status |
|-------------|--------|
| `cuid()` IDs | ✅ All 80+ tables |
| `locationId` on all tables | ✅ All tables (except Org/Location) |
| `deletedAt` (soft deletes) | ✅ All tables |
| `syncedAt` (sync tracking) | ✅ All tables |
| SQLite development setup | ✅ Working |
| PostgreSQL migration path | ✅ Documented |

### SQLite → PostgreSQL Migration

When ready for production PostgreSQL:

```bash
# 1. Update .env
DATABASE_URL="postgresql://user:pass@localhost:5432/gwi_pos"

# 2. Update prisma/schema.prisma
datasource db {
  provider = "postgresql"  // Change from "sqlite"
  url      = env("DATABASE_URL")
}

# 3. Regenerate client and push schema
npx prisma generate
npx prisma db push

# 4. Seed data (if needed)
npm run db:seed
```

**Note:** Some SQLite-specific features (like `@default(autoincrement())` on non-ID fields) may need adjustment for PostgreSQL.

---

## Project Structure

```
gwi-pos/
├── prisma/
│   ├── schema.prisma        # Database schema (80+ models)
│   ├── seed.ts              # Demo data seeder
│   ├── pos.db               # SQLite database file
│   └── backups/             # Database backups
├── src/
│   ├── app/
│   │   ├── (auth)/          # Login page
│   │   ├── (pos)/           # Main POS routes
│   │   │   ├── orders/      # Order management
│   │   │   ├── kds/         # Kitchen Display
│   │   │   └── ...
│   │   ├── (admin)/         # Admin routes
│   │   │   ├── menu/        # Menu programming
│   │   │   ├── employees/   # Staff management
│   │   │   ├── tables/      # Floor plan
│   │   │   ├── reports/     # Reporting
│   │   │   ├── settings/    # Configuration
│   │   │   └── ...
│   │   └── api/             # API routes (40+ domains)
│   ├── components/          # React components
│   ├── hooks/               # Custom hooks
│   ├── lib/                 # Utilities (db, auth, etc.)
│   ├── stores/              # Zustand stores
│   └── types/               # TypeScript types
├── docs/                    # Documentation
│   ├── skills/              # Feature specifications
│   ├── GWI-ARCHITECTURE.md  # System architecture
│   ├── OFFLINE-SYNC-ALGORITHM.md
│   ├── PAYMENT-PROCESSING.md
│   └── ...
├── CLAUDE.md                # AI assistant context
└── package.json
```

---

## Build Phases

### Phase 1: Build the POS ✅ 85% Complete

**Status:** In Progress (Majority Complete)
**Focus:** Feature-complete local POS system

| Feature Area | Status | Notes |
|--------------|--------|-------|
| **Authentication** | ✅ Complete | PIN-based login, role-based access |
| **Database Schema** | ✅ Complete | 80+ models, all sync fields |
| **Menu Management** | ✅ Complete | Categories, items, modifiers, combos |
| **Order Management** | ✅ Complete | Create, edit, split, merge, transfer |
| **Payment Processing** | ✅ Complete | Cash, card, gift cards, house accounts |
| **Table Management** | ✅ Complete | Floor plan, sections, seats |
| **Kitchen Display** | ✅ Complete | KDS with prep stations |
| **Employee Management** | ✅ Complete | CRUD, roles, permissions |
| **Time Clock** | ✅ Complete | Clock in/out, breaks |
| **Tip Management** | ✅ Complete | Tip-out rules, distributions |
| **Customer Management** | ✅ Complete | Profiles, loyalty points |
| **Reservations** | ✅ Complete | Booking, conflicts |
| **Events & Tickets** | ✅ Complete | Event management, ticketing |
| **Reports** | ✅ Complete | Daily, sales, labor, tips |
| **Hardware** | ✅ Complete | Printers, KDS screens |
| **Entertainment** | ✅ Complete | Timed rentals (pool, darts) |
| **Liquor Builder** | ✅ Complete | Recipes, pour costs |
| **Pizza Builder** | ✅ Complete | Specialty pizza config |
| **Combos** | ✅ Complete | Combo templates |
| **Gift Cards** | ✅ Complete | Activation, redemption |
| **House Accounts** | ✅ Complete | Credit limits, billing |
| **Coupons/Discounts** | ✅ Complete | Rules, validation |
| **API Documentation** | ✅ Complete | 40+ endpoint groups |
| **Real-time Updates** | 🔄 Partial | Socket.io planned |
| **Device Registration** | ⏳ Planned | QR + PIN system |
| **PWA Support** | ⏳ Planned | Mobile device support |

### Phase 2: Build Admin Console ⏳ Not Started

**Status:** Not Started (After Phase 1 complete)
**Focus:** Multi-location management

| Feature | Status | Notes |
|---------|--------|-------|
| License key generation | ⏳ | Per-location activation |
| Fleet monitoring | ⏳ | Online/offline status |
| Version tracking | ⏳ | Per-location versions |
| Aggregated reporting | ⏳ | Multi-location analytics |
| Customer billing | ⏳ | Subscriptions, invoicing |
| Menu push | ⏳ | Cloud → Local sync |
| User management | ⏳ | Organization-level admins |

### Phase 3: Deployment Infrastructure ⏳ Not Started

**Status:** Not Started (After Admin Console)
**Focus:** Remote deployment and updates

| Feature | Status | Notes |
|---------|--------|-------|
| Docker image registry | ⏳ | GitHub Container Registry |
| Watchtower integration | ⏳ | Auto-pull new images |
| Server provisioning | ⏳ | Pre-built disk images |
| Backup service | ⏳ | Automated cloud backups |
| Sync service | ⏳ | Local ↔ Cloud sync |
| License enforcement | ⏳ | Grace periods, lockout |

---

## Offline-First Architecture

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL SERVER (Always Running)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Next.js    │───▶│   SQLite/    │───▶│   Sync       │      │
│  │   API        │    │   PostgreSQL │    │   Queue      │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                                       │                │
│         │ Real-time                             │ When online    │
│         ▼                                       ▼                │
│  ┌──────────────┐                       ┌──────────────┐        │
│  │  Socket.io   │                       │    Cloud     │        │
│  │  (local)     │                       │    Sync      │        │
│  └──────────────┘                       └──────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Sync Strategy

| Data Type | Direction | Frequency |
|-----------|-----------|-----------|
| Orders & Payments | Local → Cloud | Every 5 min |
| Time Clock & Shifts | Local → Cloud | Every 5 min |
| Customers | Bidirectional | Real-time when online |
| Menu changes | Cloud → Local | On demand |
| Settings | Cloud → Local | On demand |
| Backups | Local → Cloud | Hourly |

### Offline Capabilities

| Operation | Offline? | Notes |
|-----------|----------|-------|
| Create orders | ✅ Yes | Queued for sync |
| Add items | ✅ Yes | Immediate |
| Cash payments | ✅ Yes | Queued for sync |
| Card payments | ⚠️ Limited | Store-and-forward with limits |
| Print tickets | ✅ Yes | Direct to local printer |
| Clock in/out | ✅ Yes | Queued for sync |
| View reports | ✅ Yes | Local data only |
| KDS updates | ✅ Yes | Local Socket.io |

**Full sync algorithm:** See `/docs/OFFLINE-SYNC-ALGORITHM.md`

---

## Docker Deployment

### Local Server Compose

```yaml
# docker-compose.yml (Local Server)
services:
  pos-app:
    image: ghcr.io/yourorg/gwi-pos:latest
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/prisma  # SQLite database
    environment:
      - DATABASE_URL=file:/app/prisma/pos.db
      - NODE_ENV=production

  updater:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup
```

### PostgreSQL Option

```yaml
# docker-compose.postgres.yml (Alternative)
services:
  pos-app:
    image: ghcr.io/yourorg/gwi-pos:latest
    restart: always
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://pos:password@db:5432/pos
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    restart: always
    volumes:
      - ./pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=pos
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=pos

  updater:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup
```

---

## Performance Targets

Everything stays on the local network = instant.

| Action | Target | Current Status |
|--------|--------|----------------|
| Button tap feedback | < 50ms | ✅ Achieved |
| Add item to order | < 100ms | ✅ Achieved |
| Navigation | < 100ms | ✅ Achieved |
| Search results | < 200ms | ✅ Achieved |
| Print ticket | < 500ms | ✅ Achieved |
| KDS update | < 10ms | ⏳ Socket.io pending |

**Comparison:**

| Architecture | Latency |
|--------------|---------|
| Cloud-only (Square, Toast) | 100-500ms per action |
| GWI (local server) | < 50ms per action |

---

## Environment Variables

### Development (.env.local)

```env
# Database (SQLite)
DATABASE_URL="file:./pos.db"

# Development
NODE_ENV=development
```

### Local Production

```env
# Database (SQLite)
DATABASE_URL="file:/data/pos.db"

# OR PostgreSQL
DATABASE_URL="postgresql://pos:password@db:5432/pos"

# Production
NODE_ENV=production

# Sync (when cloud is ready)
CLOUD_SYNC_URL=https://admin.gwipos.com/api/sync
LOCATION_API_KEY=loc_xxx
```

### Cloud Admin (Future)

```env
# Database (PostgreSQL)
DATABASE_URL="postgresql://..."

# Hosting
VERCEL_URL=https://admin.gwipos.com

# Stripe (billing)
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

---

## Development Workflow

### Daily Development

```bash
# Start dev server
npm run dev

# View database
npm run db:studio

# Reset with fresh seed data
npm run reset
```

### Before Schema Changes

```bash
# ALWAYS backup first
npm run db:backup

# Push schema changes
npm run db:push

# OR run migration
npm run db:migrate
```

### Building for Production

```bash
# Build
npm run build

# Start production
npm start

# OR with Docker
docker build -t gwi-pos .
docker run -p 3000:3000 gwi-pos
```

---

## Testing Strategy

### Unit Tests

- Components with React Testing Library
- Utility functions with Jest
- API routes with supertest

### Integration Tests

- Database operations
- API workflows
- Authentication flows

### E2E Tests

- Critical user flows with Playwright
- Order creation to payment
- Employee clock in/out

### Performance Tests

- Lighthouse CI
- Custom timing metrics
- Load testing for concurrent users

---

## Immediate Next Steps

### This Week

1. **Socket.io Integration** - Real-time KDS updates
2. **Device Registration** - QR + PIN pairing system
3. **PWA Manifest** - Mobile device support

### Next Sprint

1. **Docker Build** - Production container
2. **Watchtower Setup** - Auto-updates
3. **Backup System** - Automated backups

### Future

1. **Cloud Admin Console** - Phase 2
2. **Sync Service** - Local ↔ Cloud
3. **License System** - Subscription enforcement

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Offline reliability | Local-first architecture, extensive testing |
| Print failures | Queue with retry, fallback display |
| Database corruption | Automatic backups, easy restore |
| Concurrent users | Load testing, optimistic updates |
| Payment failures | Graceful degradation, retry logic |
| Sync conflicts | LWW resolution, manual conflict queue |

---

## Dependencies Summary

### Core

| Package | Version | Purpose |
|---------|---------|---------|
| next | 16.1.5 | Framework |
| react | 19.2.3 | UI |
| typescript | 5.x | Type safety |
| @prisma/client | 6.19.2 | Database ORM |
| better-sqlite3 | - | SQLite driver |

### UI

| Package | Version | Purpose |
|---------|---------|---------|
| tailwindcss | 4.x | Styling |
| zustand | 5.x | State management |
| zod | 4.x | Validation |

### Development

| Package | Purpose |
|---------|---------|
| prisma | Schema management |
| tsx | TypeScript execution |
| eslint | Linting |

### Production (Planned)

| Package | Purpose |
|---------|---------|
| socket.io | Real-time events |
| workbox | Service worker/PWA |

---

## Documentation Index

| Document | Purpose |
|----------|---------|
| `/docs/GWI-ARCHITECTURE.md` | System architecture |
| `/docs/OFFLINE-SYNC-ALGORITHM.md` | Sync strategy |
| `/docs/PAYMENT-PROCESSING.md` | Payment flows |
| `/docs/API-REFERENCE.md` | API documentation |
| `/docs/ERROR-HANDLING-STANDARDS.md` | Error codes and handling |
| `/docs/REQUIREMENTS.md` | Full requirements |
| `/docs/skills/*.md` | Feature specifications |
| `/CLAUDE.md` | AI assistant context |

---

*This document is the build plan source of truth for GWI POS.*
*Last Updated: January 30, 2026*
