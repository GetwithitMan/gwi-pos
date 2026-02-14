# GWI POS

## Start Project Manager

When the user says "Start Project Manager", "Open Project Manager", or similar:
1. Read this file (`/.claude/PROJECT.md`) for project overview
2. Read `/.claude/TASKS.md` for the current task queue
3. Show active tasks, ready tasks, and blockers
4. Ask what the user wants to work on

---

## What It Is

GWI POS is a hybrid SaaS point-of-sale system designed for bars and restaurants. It emphasizes a "fewest clicks" philosophy for speed in high-volume environments. Each location runs a local server (Ubuntu mini PC) for instant response times and offline capability, while a cloud admin console manages all locations centrally. The system supports 60 modular "skills" (feature domains) that can be developed independently.

## Core Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Next.js 16.x + React 19 | App Router, SSR, PWA |
| **Styling** | Tailwind CSS 4.x | Rapid UI development |
| **State** | Zustand 5.x | Lightweight state management |
| **Backend** | Next.js API Routes | Serverless-ready APIs |
| **Database** | Neon PostgreSQL (database-per-venue) | Local-first data |
| **ORM** | Prisma 6.x | Type-safe queries |
| **Validation** | Zod 4.x | Runtime validation |
| **Real-time** | Socket.io (planned) | KDS/terminal updates |
| **Hosting** | Vercel (cloud) + Ubuntu servers (local) | Hybrid SaaS |

## Current State

**Phase 1 (MVP): 75% Complete**
- [x] Authentication (PIN login)
- [x] Menu programming (categories, items, modifiers)
- [x] Order management (tabs, tables)
- [x] Kitchen Display System (KDS)
- [x] Printing system (Epson ePOS)
- [x] Employee/role management
- [x] Tip system with pooling
- [x] Reporting (14+ report types)
- [x] Tax management
- [x] Gift cards
- [ ] Payment processing (Stripe integration)
- [ ] Offline sync algorithm
- [ ] Local server deployment

**Phase 2 (Full Service): 60% Complete**
- [x] Bar tabs
- [x] Liquor builder
- [x] Floor plan editor
- [ ] Check splitting
- [ ] Coursing system
- [ ] Buzzer/pager integration

## Directory Map

```
gwi-pos/
├── .claude/              # Project management (YOU ARE HERE)
│   ├── PROJECT.md        # This file - what the project IS
│   ├── ARCHITECTURE.md   # How it's built
│   ├── TASKS.md          # Current work queue
│   └── CONVENTIONS.md    # Rules all instances follow
├── prisma/
│   ├── schema.prisma     # Database schema (82 models)
│   ├── seed.ts           # Demo data seeder
│   └── migrations/       # PostgreSQL migration files
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── (auth)/       # Login pages
│   │   ├── (pos)/        # Main POS interface (/orders)
│   │   ├── (admin)/      # Admin pages (menu, settings, reports)
│   │   ├── (kds)/        # Kitchen display screens
│   │   └── api/          # 40+ API route directories
│   ├── components/       # React components
│   │   ├── orders/       # Order management UI
│   │   ├── menu/         # Menu management UI
│   │   ├── hardware/     # Printer/KDS config UI
│   │   └── ui/           # Base components
│   ├── hooks/            # Custom React hooks
│   ├── stores/           # Zustand state stores
│   ├── lib/              # Utilities (db.ts, auth, printing)
│   └── types/            # TypeScript type definitions
├── docs/                 # Feature documentation
│   ├── skills/           # 60 skill specification files
│   ├── REQUIREMENTS.md   # System requirements
│   ├── BUILD-PLAN.md     # Technical roadmap
│   ├── SKILLS-INDEX.md   # Skill status tracker
│   └── GWI-ARCHITECTURE.md # Architecture details
└── public/               # Static assets
```

## Key URLs (Development)

| Route | Purpose |
|-------|---------|
| `/login` | PIN-based authentication |
| `/orders` | Main POS order screen |
| `/kds` | Kitchen display system |
| `/menu` | Menu management |
| `/settings` | System configuration |
| `/reports` | Analytics and reports |

## Demo Credentials

| Role | PIN |
|------|-----|
| Manager | 1234 |
| Server | 2345 |
| Bartender | 3456 |

## Documentation Index

| Document | Purpose |
|----------|---------|
| `/docs/REQUIREMENTS.md` | Business requirements |
| `/docs/BUILD-PLAN.md` | Technical roadmap |
| `/docs/SKILLS-INDEX.md` | 60 skills with status |
| `/docs/GWI-ARCHITECTURE.md` | System architecture |
| `/CLAUDE.md` | Developer reference |

---
*Last Updated: January 30, 2026*
