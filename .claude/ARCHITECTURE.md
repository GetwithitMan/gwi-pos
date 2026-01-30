# GWI POS Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GWI ADMIN CONSOLE (Cloud)                     │
│  Vercel Hosting • PostgreSQL (Neon) • License Management        │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Sync (HTTPS)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                LOCAL SERVER (Per Location)                       │
│  Ubuntu 24 • Docker • PostgreSQL • Socket.io • Watchtower       │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ GWI POS App │  │ PostgreSQL  │  │ Print Queue │             │
│  │ (Next.js)   │  │ (Local DB)  │  │ (Jobs)      │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Local Network (< 10ms)
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │Terminal │    │  KDS    │    │  Phone  │
         │(Browser)│    │(Browser)│    │  (PWA)  │
         └─────────┘    └─────────┘    └─────────┘
```

## Build Phases

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Build POS application | 🔄 75% |
| **Phase 2** | Build Admin Console | ⏳ Not started |
| **Phase 3** | Deployment Infrastructure | ⏳ Not started |

## Database Architecture

### Multi-Tenancy
Every table (except `Organization` and `Location`) has:
- `locationId` — Required for tenant isolation
- `deletedAt` — Soft delete (never hard delete)
- `syncedAt` — Cloud sync tracking

### Key Models (82 total)
```
Organization (root)
  └── Location
        ├── Employee → Role
        ├── Category → MenuItem → ModifierGroup → Modifier
        ├── Order → OrderItem → OrderItemModifier
        ├── Table → Seat
        ├── Shift → Drawer → PaidInOut
        ├── TipOutRule → TipShare
        └── [75+ more models...]
```

### Schema Rules
```prisma
model ExampleTable {
  id         String    @id @default(cuid())  // UUID-safe
  locationId String                           // Multi-tenancy

  // ... fields ...

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime?                        // Soft delete
  syncedAt   DateTime?                        // Sync tracking

  @@index([locationId])
}
```

## API Architecture

### Route Structure
```
/api
├── /auth/login          POST - PIN authentication
├── /menu
│   ├── /                GET - Full menu
│   ├── /categories      CRUD
│   ├── /items           CRUD
│   └── /modifiers       CRUD
├── /orders
│   ├── /                GET/POST orders
│   ├── /[id]            GET/PATCH/DELETE
│   └── /[id]/items      POST - Add items
├── /employees           CRUD
├── /reports
│   ├── /daily           EOD report
│   ├── /sales           Sales analytics
│   ├── /tips            Tip distribution
│   └── /[10+ more...]
└── /hardware
    ├── /printers        Printer management
    └── /kds-screens     KDS device pairing
```

### Response Format
```typescript
// Success
{ data: T }

// Error
{ error: string }
```

## Performance Targets

| Action | Target | Architecture Support |
|--------|--------|---------------------|
| Button tap | < 50ms | Local server, optimistic UI |
| Add item | < 100ms | Local DB, Zustand state |
| Send to kitchen | < 50ms | Socket.io push |
| Print ticket | < 500ms | Direct printer IP |

## Security Architecture

### Device Authentication
- **Terminals**: Browser sessions with employee PIN
- **KDS Screens**: 256-bit token + httpOnly cookie
- **Mobile (PWA)**: QR code + PIN pairing (planned)

### Data Protection
- All data isolated by `locationId`
- Soft deletes preserve audit trail
- Payments encrypted (PCI compliance)

## Offline Strategy

### Local-First Design
1. All operations work against local PostgreSQL
2. Changes queued with `syncedAt: null`
3. Background sync when online
4. Conflict resolution: Last-write-wins with audit

### Sync Fields
```typescript
// Record needs sync
where: { syncedAt: null, deletedAt: null }

// After successful sync
update: { syncedAt: new Date() }
```

## Deployment Architecture

### Local Server (Docker Compose)
```yaml
services:
  pos-app:
    image: ghcr.io/gwi/pos:latest
    ports: ["3000:3000"]

  db:
    image: postgres:15
    volumes: ["./pgdata:/var/lib/postgresql/data"]

  updater:
    image: containrrr/watchtower
    command: --interval 300
```

### Update Flow
```
Dev pushes code → Docker image built →
Registry updated → Watchtower pulls →
Container restarts → Terminals refresh
```

---
*Last Updated: January 30, 2026*
