# GWI POS - Point of Sale System

A modern, fast point-of-sale system built for bars and restaurants with a "fewest clicks" philosophy.

## Live Demo

- **Production**: https://gwi-pos.vercel.app
- **Custom Domain**: https://barpos.restaurant (when DNS configured)

### Demo Login

PIN: `1234` (Demo Manager account)

## Features

### Implemented
- **PIN-based Login** - Fast employee clock-in with 6-digit PIN
- **Order Management** - Create orders with Table, Quick Tab, or Takeout modes
- **Menu Display** - Category-organized menu with availability status (86'd items)
- **Cart Management** - Add/remove items, quantity controls, real-time totals
- **Menu Management** - Full CRUD for categories and items with color coding
- **86 Toggle** - Mark items as unavailable directly from menu management

### Coming Soon
- Kitchen Display System (KDS)
- Payment Processing
- Tip Management
- Reports & Analytics
- Table Management
- Modifiers & Combos

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **ORM**: Prisma 7
- **Database**: PostgreSQL (via Vercel Postgres)
- **Deployment**: Vercel

## Project Structure

```
gwi-pos/
├── src/
│   ├── app/
│   │   ├── (auth)/login/       # Login page
│   │   ├── (pos)/orders/       # Main POS interface
│   │   ├── (admin)/menu/       # Menu management
│   │   └── api/
│   │       ├── auth/login/     # Auth API
│   │       └── menu/           # Menu CRUD APIs
│   ├── components/ui/          # Reusable UI components
│   ├── stores/                 # Zustand state stores
│   └── lib/                    # Utilities and database
└── prisma/
    └── schema.prisma           # Database schema
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

The app runs in demo mode without a database - all data is stored in-memory.

## Database Setup (Vercel Postgres)

To enable persistent data storage:

### 1. Create Vercel Postgres Database

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the gwi-pos project
3. Click **Storage** tab
4. Click **Create Database** → **Postgres**
5. Name it `gwi-pos-db` and create

### 2. Connect Database to Project

1. In the Storage tab, click on your database
2. Click **Connect to Project**
3. Select the gwi-pos project
4. This automatically adds `DATABASE_URL` to environment variables

### 3. Run Migrations

```bash
# Pull environment variables from Vercel
vercel env pull .env.local

# Run migrations
npx prisma migrate deploy
```

### 4. Redeploy

Push any change to trigger a new deployment, or:
```bash
vercel --prod
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/login` | POST | Employee login with PIN |
| `/api/menu` | GET | Get all categories and items |
| `/api/menu/categories` | POST | Create category |
| `/api/menu/categories/[id]` | PUT/DELETE | Update/delete category |
| `/api/menu/items` | POST | Create menu item |
| `/api/menu/items/[id]` | PUT/DELETE | Update/delete item |

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

## License

Proprietary - All rights reserved

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/GetwithitMan/gwi-pos/issues) page.
