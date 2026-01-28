# GWI POS - Point of Sale System

A modern, fast point-of-sale system built for bars and restaurants with a "fewest clicks" philosophy.

## Live Demo

- **Production**: https://gwi-pos.vercel.app

### Demo Login

PIN: `1234` (Demo Manager account)

## Features

### Core POS
- **PIN-based Login** - Fast employee clock-in with 4-6 digit PIN
- **Order Management** - Table, Quick Tab, Takeout, Bar Tab modes
- **Menu Display** - Category-organized with dual pricing (cash/card)
- **Nested Modifiers** - Multi-level modifier groups with pre-modifiers
- **Item Notes** - Special instructions per item
- **Seat & Course Tracking** - Assign items to seats and courses
- **Hold & Fire** - Kitchen timing controls

### Payments
- **Cash & Card** - With tip suggestions
- **Dual Pricing** - Cash discount program (card brand compliant)
- **Price Rounding** - Round to nearest nickel/dime/quarter/dollar
- **Split Checks** - Even, by item, or custom amount
- **Gift Cards** - Purchase, redeem, reload, freeze
- **House Accounts** - Charge to account with credit limits

### Bar Features
- **Bar Tabs** - Create, manage, and close tabs
- **Pre-Authorization** - Card hold on tab open
- **Tab Transfer** - Move tabs between employees
- **Timed Rentals** - Pool tables, dart boards (per 15min/30min/hour)

### Kitchen & Display
- **Kitchen Display System** - Full KDS with station filtering
- **Prep Stations** - Route items by category/station
- **Course Firing** - Multi-course meal management
- **Item Status** - New, Sent, Made, Resend badges

### Management
- **Menu Builder** - Full CRUD with modifiers, combos, pricing
- **Employee Management** - Roles, permissions, PIN management
- **Table Layout** - Floor plan editor with drag & drop
- **Reservations** - Full booking system
- **Inventory** - Stock tracking with low stock alerts
- **Time Clock** - Clock in/out, breaks, shift closeout

### Reports
- **Sales** - By item, category, employee, table, payment method
- **Labor** - Hours, overtime, labor cost percentage
- **Product Mix** - Item performance, pairings
- **Discounts & Comps** - Usage tracking
- **Customer** - Spend tiers, frequency, VIP tracking

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **ORM**: Prisma 7
- **Database**: PostgreSQL (via Vercel Postgres)
- **Validation**: Zod
- **Deployment**: Vercel

## Project Structure

```
gwi-pos/
├── src/
│   ├── app/
│   │   ├── (auth)/login/           # Login page
│   │   ├── (pos)/orders/           # Main POS interface
│   │   ├── (pos)/kds/              # Kitchen display
│   │   ├── (admin)/                # Admin pages
│   │   │   ├── menu/               # Menu management
│   │   │   ├── employees/          # Employee management
│   │   │   ├── tables/             # Table layout
│   │   │   ├── settings/           # System settings
│   │   │   └── reports/            # All reports
│   │   └── api/                    # API routes
│   ├── components/
│   │   ├── ui/                     # Base UI components
│   │   ├── payment/                # Payment modals
│   │   ├── orders/                 # Order components
│   │   ├── modifiers/              # Modifier selection
│   │   └── ...                     # Feature components
│   ├── hooks/                      # Custom React hooks
│   ├── stores/                     # Zustand state stores
│   ├── lib/                        # Utilities
│   │   ├── db.ts                   # Database client
│   │   ├── validations.ts          # Zod schemas
│   │   ├── api-errors.ts           # Error handling
│   │   └── ...                     # Helper functions
│   └── types/                      # Shared TypeScript types
└── prisma/
    └── schema.prisma               # Database schema
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/GetwithitMan/gwi-pos.git
cd gwi-pos
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Open http://localhost:3000

## Database Setup (Vercel Postgres)

### 1. Create Vercel Postgres Database

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the gwi-pos project
3. Click **Storage** tab
4. Click **Create Database** → **Postgres**
5. Name it `gwi-pos-db` and create

### 2. Connect Database to Project

1. In the Storage tab, click on your database
2. Click **Connect to Project**
3. This automatically adds `DATABASE_URL` to environment variables

### 3. Run Migrations

```bash
# Pull environment variables from Vercel
vercel env pull .env.local

# Run migrations
npx prisma migrate deploy
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

## Development

### Build
```bash
npm run build
```

### Lint
```bash
npm run lint
```

### Generate Prisma Client
```bash
npx prisma generate
```

## Documentation

- **CHANGELOG.md** - Detailed session-by-session development log
- **docs/skills/SKILLS-INDEX.md** - Feature index with implementation status

## Skills (93 total)

The system is organized into 93 modular skills. See [SKILLS-INDEX.md](docs/skills/SKILLS-INDEX.md) for the complete list.

### Recently Added (Session 14)
| Skill | Description |
|-------|-------------|
| 93 | Split Ticket View - Create multiple tickets from one order (30-1, 30-2) with hybrid pricing |

### Session 13 Skills
| Skill | Description |
|-------|-------------|
| 89 | Input Validation - Zod schemas for API requests |
| 90 | Error Boundaries - React error handling |
| 91 | API Error Handling - Standardized responses |
| 92 | Query Optimization - N+1 fixes, pagination |

## License

Proprietary - All rights reserved

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/GetwithitMan/gwi-pos/issues) page.
