# GWI POS — Code Review Checklist

Organized by priority: most critical business logic and security first,
supporting code and utilities last. Check off each file as you review it.

---

## TIER 1 — CRITICAL (Security, Money, Data Integrity)
> If anything here is wrong, the whole system is at risk.

### Security & Authentication
- [ ] `src/middleware.ts` — Multi-tenant routing, cloud gate, SMS OTP gate
- [ ] `src/lib/cloud-auth.ts` — JWT sign/verify (HMAC-SHA256, edge-compatible)
- [ ] `src/lib/access-gate.ts` — SMS OTP generation/verification + session tokens
- [ ] `src/lib/auth.ts` — PIN/password hashing (bcrypt)
- [ ] `src/lib/auth-utils.ts` — 60+ permission keys, 9 default roles
- [ ] `src/lib/api-auth.ts` — Server-side permission validation for API routes
- [ ] `src/lib/access-log.ts` — Access logging to Neon DB

### Database & Multi-Tenancy (the most foundational layer)
- [ ] `src/lib/db.ts` — Prisma proxy: AsyncLocalStorage → headers → master fallback
- [ ] `src/lib/with-venue.ts` — Route handler wrapper, sets tenant context
- [ ] `src/lib/request-context.ts` — AsyncLocalStorage per-request tenant isolation
- [ ] `prisma/schema.prisma` — Full data model (Organization → Location → all models)

### Payment Processing — Datacap
- [ ] `src/lib/datacap/client.ts` — Datacap API client
- [ ] `src/lib/datacap/xml-builder.ts` — XML transaction request builder
- [ ] `src/lib/datacap/xml-parser.ts` — XML response parser
- [ ] `src/lib/datacap/sequence.ts` — Transaction sequencing
- [ ] `src/lib/datacap/discovery.ts` — Payment reader discovery
- [ ] `src/lib/datacap/simulator.ts` — Simulated reader (testing only)
- [ ] `src/lib/datacap/types.ts` — All Datacap type definitions
- [ ] `src/lib/datacap/helpers.ts` — Datacap helper utilities
- [ ] `src/lib/datacap/use-cases.ts` — Common transaction patterns
- [ ] `src/lib/datacap/reader-health.ts` — Reader health monitoring
- [ ] `src/lib/payment.ts` — Payment processing utilities
- [ ] `src/lib/payment-intent-manager.ts` — Payment intent state management
- [ ] `src/lib/payment-domain/rounding.ts` — Cash rounding algorithms

### Payment API Routes
- [ ] `src/app/api/datacap/sale/route.ts` — Credit card sale
- [ ] `src/app/api/datacap/capture/route.ts` — Capture pre-auth
- [ ] `src/app/api/datacap/refund/route.ts` — Refund transaction
- [ ] `src/app/api/datacap/void/route.ts` — Void transaction
- [ ] `src/app/api/datacap/preauth/route.ts` — Pre-authorization
- [ ] `src/app/api/datacap/adjust/route.ts` — Tip adjustment
- [ ] `src/app/api/datacap/increment/route.ts` — Tip increment
- [ ] `src/app/api/datacap/walkout-retry/route.ts` — Retry walkout payment
- [ ] `src/app/api/orders/[id]/pay/route.ts` — Process payment on order
- [ ] `src/app/api/orders/[id]/void-payment/route.ts` — Void payment
- [ ] `src/app/api/orders/[id]/refund-payment/route.ts` — Refund payment
- [ ] `src/app/api/simulated-reader/process/route.ts` — Simulated reader

---

## TIER 2 — CORE BUSINESS LOGIC (Orders, Inventory, Tips)
> The daily operations that must be correct.

### Order Engine
- [ ] `src/stores/order-store.ts` — Order state (items, totals, payments)
- [ ] `src/lib/order-calculations.ts` — Totals, tax, tip calculations
- [ ] `src/lib/order-utils.ts` — Order helper functions
- [ ] `src/lib/order-router.ts` — Order routing logic
- [ ] `src/lib/pricing.ts` — Price computation including modifiers
- [ ] `src/lib/split-pricing.ts` — Split ticket price distribution
- [ ] `src/lib/split-order-loader.ts` — Split order data fetching

### Order API Routes
- [ ] `src/app/api/orders/route.ts` — Create / list orders
- [ ] `src/app/api/orders/[id]/route.ts` — Get / update order metadata
- [ ] `src/app/api/orders/[id]/items/route.ts` — Add / update items (atomic)
- [ ] `src/app/api/orders/[id]/items/[itemId]/route.ts` — Single item update
- [ ] `src/app/api/orders/[id]/send/route.ts` — Send to kitchen
- [ ] `src/app/api/orders/[id]/discount/route.ts` — Apply discount
- [ ] `src/app/api/orders/[id]/adjust-tip/route.ts` — Adjust tip
- [ ] `src/app/api/orders/[id]/split/route.ts` — Split order
- [ ] `src/app/api/orders/[id]/comp-void/route.ts` — Comp / void item
- [ ] `src/app/api/orders/[id]/close-tab/route.ts` — Close tab
- [ ] `src/app/api/orders/[id]/reopen/route.ts` — Reopen closed order
- [ ] `src/app/api/orders/open/route.ts` — List open orders (cached)
- [ ] `src/app/api/orders/closed/route.ts` — List closed orders
- [ ] `src/app/api/orders/eod-cleanup/route.ts` — End-of-day cleanup
- [ ] `src/app/api/voids/remote-approval/request/route.ts` — Void approval request
- [ ] `src/app/api/voids/remote-approval/[token]/approve/route.ts` — Approve void
- [ ] `src/app/api/voids/remote-approval/[token]/reject/route.ts` — Reject void

### Inventory & Deduction Engine
- [ ] `src/lib/inventory-calculations.ts` — Main deduction engine
- [ ] `src/lib/inventory/order-deduction.ts` — Deduct on sale
- [ ] `src/lib/inventory/void-waste.ts` — Track voided items as waste
- [ ] `src/lib/inventory/recipe-costing.ts` — Recipe cost calculation
- [ ] `src/lib/inventory/unit-conversion.ts` — Unit conversion engine
- [ ] `src/lib/inventory/theoretical-usage.ts` — Expected vs actual usage
- [ ] `src/lib/inventory/helpers.ts` — Inventory helpers
- [ ] `src/lib/inventory/prep-stock.ts` — Prep station stock
- [ ] `src/lib/liquor-inventory.ts` — Liquor-specific inventory
- [ ] `src/lib/stock-status.ts` — Stock availability checking

### Tips & Payroll
- [ ] `src/lib/domain/tips/tip-allocation.ts` — Allocate tips to pool members
- [ ] `src/lib/domain/tips/tip-groups.ts` — Tip group management
- [ ] `src/lib/domain/tips/tip-ledger.ts` — Tip ledger tracking
- [ ] `src/lib/domain/tips/tip-payouts.ts` — Tip payout processing
- [ ] `src/lib/domain/tips/tip-chargebacks.ts` — Tip chargeback handling
- [ ] `src/lib/domain/tips/tip-compliance.ts` — Compliance checks
- [ ] `src/lib/domain/tips/tip-recalculation.ts` — Recalculate after adjustments
- [ ] `src/lib/domain/tips/table-ownership.ts` — Table ownership for tips
- [ ] `src/lib/domain/tips/tip-payroll-export.ts` — Payroll export
- [ ] `src/lib/payroll/tax-calculator.ts` — Tax & deduction calculation
- [ ] `src/lib/payroll/pay-stub-pdf.ts` — Pay stub PDF generation

### Real-Time (Socket.io)
- [ ] `src/lib/socket-server.ts` — Socket.io server (rooms, emitters)
- [ ] `src/lib/shared-socket.ts` — Client-side socket singleton
- [ ] `src/lib/socket-dispatch.ts` — Socket event dispatching
- [ ] `src/lib/cloud-events.ts` — Cloud event publishing
- [ ] `src/lib/cloud-event-queue.ts` — Cloud event queue
- [ ] `src/lib/cloud-notify.ts` — Cloud notification dispatch

---

## TIER 3 — CORE POS PAGES (What staff use every shift)

### POS Interface Pages
- [ ] `src/app/(pos)/orders/page.tsx` — Main POS ordering screen
- [ ] `src/app/(pos)/tabs/page.tsx` — Open tabs management
- [ ] `src/app/(pos)/pay-at-table/page.tsx` — Pay-at-table terminal
- [ ] `src/app/(pos)/tips/page.tsx` — Tip entry
- [ ] `src/app/(pos)/crew/page.tsx` — Crew/employee hub
- [ ] `src/app/(pos)/crew/shift/page.tsx` — Shift management
- [ ] `src/app/(pos)/crew/tip-bank/page.tsx` — Tip bank
- [ ] `src/app/(pos)/crew/commission/page.tsx` — Commission tracking

### Authentication Pages
- [ ] `src/app/(auth)/login/page.tsx` — PIN-based employee login
- [ ] `src/app/auth/cloud/page.tsx` — Cloud token validation
- [ ] `src/app/auth/owner/page.tsx` — Owner login
- [ ] `src/app/admin-login/page.tsx` — Venue admin login (email + password)
- [ ] `src/app/access/page.tsx` — SMS OTP gate

### KDS Pages
- [ ] `src/app/(kds)/kds/page.tsx` — Kitchen Display System
- [ ] `src/app/(kds)/kds/pair/page.tsx` — KDS device pairing
- [ ] `src/app/(kds)/entertainment/page.tsx` — Entertainment KDS

### Customer Facing Display
- [ ] `src/app/(cfd)/cfd/page.tsx` — Customer Facing Display

### Core POS Components
- [ ] `src/components/orders/OrderPanel.tsx` — Order display panel
- [ ] `src/components/orders/OpenOrdersPanel.tsx` — Open orders list
- [ ] `src/components/orders/UnifiedPOSHeader.tsx` — POS top header
- [ ] `src/components/payment/PaymentModal.tsx` — Payment entry
- [ ] `src/components/payment/DatacapPaymentProcessor.tsx` — Datacap UI integration
- [ ] `src/components/payment/steps/PaymentMethodStep.tsx` — Payment method selection
- [ ] `src/components/payment/steps/CardProcessingStep.tsx` — Card processing UI
- [ ] `src/components/payment/steps/CashEntryStep.tsx` — Cash entry UI
- [ ] `src/components/payment/steps/TipEntryStep.tsx` — Tip entry UI
- [ ] `src/components/modifiers/ModifierModal.tsx` — Modifier selection
- [ ] `src/components/orders/SplitCheckScreen.tsx` — Split check UI
- [ ] `src/components/orders/RemoteVoidApprovalModal.tsx` — Void approval
- [ ] `src/components/orders/CompVoidModal.tsx` — Comp/void item
- [ ] `src/components/tabs/TabsPanel.tsx` — Open tabs list
- [ ] `src/components/tabs/CardFirstTabFlow.tsx` — Card-first tab flow
- [ ] `src/stores/auth-store.ts` — Auth state (login, user, roles)

### Core Hooks
- [ ] `src/hooks/useOrderingEngine.ts` — Main ordering logic
- [ ] `src/hooks/usePaymentFlow.ts` — Payment workflow
- [ ] `src/hooks/useActiveOrder.ts` — Active order tracking
- [ ] `src/hooks/useDatacap.ts` — Datacap payment integration
- [ ] `src/hooks/useTabCreation.ts` — Create new tab
- [ ] `src/hooks/useCardTabFlow.ts` — Card-first tab workflow
- [ ] `src/hooks/useSplitCheck.ts` — Split check logic
- [ ] `src/hooks/useAuthGuard.ts` — Route auth guard

---

## TIER 4 — MENU, PRINTING & HARDWARE (Setup & Operations)

### Menu & Modifiers
- [ ] `src/lib/menu-cache.ts` — Menu cache (60s TTL)
- [ ] `src/lib/kitchen-item-filter.ts` — KDS item routing filter
- [ ] `src/app/(admin)/menu/page.tsx` — Menu builder
- [ ] `src/components/menu/ItemEditor.tsx` — Item editor
- [ ] `src/components/menu/ModifierFlowEditor.tsx` — Modifier group flow
- [ ] `src/components/menu/RecipeBuilder.tsx` — Recipe/ingredient builder
- [ ] `src/components/modifiers/ComboStepFlow.tsx` — Combo step flow
- [ ] `src/app/api/menu/items/route.ts` — Menu items CRUD
- [ ] `src/app/api/menu/items/bulk/route.ts` — Bulk item operations
- [ ] `src/app/api/menu/categories/route.ts` — Categories CRUD
- [ ] `src/app/api/menu/modifiers/route.ts` — Modifiers CRUD
- [ ] `src/app/api/menu/search/route.ts` — Menu search
- [ ] `src/app/api/combos/route.ts` — Combos CRUD
- [ ] `src/app/api/pizza/route.ts` — Pizza builder API

### Printing & ESC/POS
- [ ] `src/lib/print-factory.ts` — Print job factory
- [ ] `src/lib/print-template-factory.ts` — Template factory
- [ ] `src/lib/printer-connection.ts` — Network printer connections
- [ ] `src/lib/escpos/commands.ts` — ESC/POS command set
- [ ] `src/lib/escpos/daily-report-receipt.ts` — Daily report receipt
- [ ] `src/lib/escpos/shift-closeout-receipt.ts` — Shift closeout receipt
- [ ] `src/app/api/print/kitchen/route.ts` — Kitchen print
- [ ] `src/app/api/print/receipt/route.ts` — Receipt print
- [ ] `src/app/api/print/direct/route.ts` — Direct print
- [ ] `src/app/api/print/cash-drawer/route.ts` — Cash drawer

### Hardware Config
- [ ] `src/app/(admin)/settings/hardware/printers/page.tsx` — Printer setup
- [ ] `src/app/(admin)/settings/hardware/payment-readers/page.tsx` — Payment readers
- [ ] `src/app/(admin)/settings/hardware/kds-screens/page.tsx` — KDS screens
- [ ] `src/app/(admin)/settings/hardware/terminals/page.tsx` — Terminals
- [ ] `src/app/(admin)/settings/hardware/routing/page.tsx` — Print routing
- [ ] `src/app/api/hardware/printers/route.ts` — Printers API
- [ ] `src/app/api/hardware/payment-readers/route.ts` — Readers API
- [ ] `src/app/api/hardware/kds-screens/route.ts` — KDS API
- [ ] `src/components/hardware/PrinterSettingsEditor.tsx` — Printer config
- [ ] `src/components/hardware/ReceiptVisualEditor.tsx` — Receipt preview

### Floor Plan
- [ ] `src/domains/floor-plan/services/status-engine.ts` — Table status engine
- [ ] `src/domains/floor-plan/services/table-service.ts` — Table business logic
- [ ] `src/domains/floor-plan/services/seat-service.ts` — Seat business logic
- [ ] `src/domains/floor-plan/admin/FloorPlanEditor.tsx` — Admin editor
- [ ] `src/domains/floor-plan/canvas/FloorCanvas.tsx` — Canvas rendering
- [ ] `src/domains/floor-plan/hooks/useFloorPlan.ts` — Floor plan state
- [ ] `src/app/(admin)/floorplan/editor/page.tsx` — Floor plan editor page
- [ ] `src/app/api/floor-plan/route.ts` — Floor plan snapshot
- [ ] `src/app/api/tables/route.ts` — Tables CRUD
- [ ] `src/app/api/seats/route.ts` — Seats CRUD

---

## TIER 5 — ADMIN PAGES (Management & Configuration)

### Core Admin Pages
- [ ] `src/app/(admin)/employees/page.tsx` — Employee roster
- [ ] `src/app/(admin)/roles/page.tsx` — Role / permission management
- [ ] `src/app/(admin)/settings/page.tsx` — Settings hub
- [ ] `src/app/(admin)/settings/payments/page.tsx` — Payment configuration
- [ ] `src/app/(admin)/settings/tips/page.tsx` — Tips settings
- [ ] `src/app/(admin)/settings/tip-outs/page.tsx` — Tip-out rules
- [ ] `src/app/(admin)/settings/tax-rules/page.tsx` — Tax rules
- [ ] `src/app/(admin)/settings/order-types/page.tsx` — Order types
- [ ] `src/app/(admin)/settings/menu/page.tsx` — Menu settings
- [ ] `src/app/(admin)/settings/venue/page.tsx` — Venue settings
- [ ] `src/app/(admin)/settings/security/page.tsx` — Security settings
- [ ] `src/app/(admin)/settings/integrations/sms/page.tsx` — SMS/Twilio config
- [ ] `src/app/(admin)/monitoring/page.tsx` — System health
- [ ] `src/app/(admin)/monitoring/errors/page.tsx` — Error log
- [ ] `src/app/(admin)/gwipos-access/page.tsx` — GWI access log

### Inventory Admin Pages
- [ ] `src/app/(admin)/inventory/page.tsx` — Inventory dashboard
- [ ] `src/app/(admin)/inventory/items/page.tsx` — Inventory items
- [ ] `src/app/(admin)/inventory/counts/page.tsx` — Count tracking
- [ ] `src/app/(admin)/inventory/waste/page.tsx` — Waste tracking
- [ ] `src/app/(admin)/inventory/vendors/page.tsx` — Vendor management
- [ ] `src/app/(admin)/ingredients/page.tsx` — Ingredient library
- [ ] `src/app/(admin)/liquor-builder/page.tsx` — Liquor recipe builder

### Events & Entertainment
- [ ] `src/app/(admin)/events/page.tsx` — Event management
- [ ] `src/app/(admin)/events/[id]/page.tsx` — Event details
- [ ] `src/app/(admin)/events/[id]/sell/page.tsx` — Ticket sales
- [ ] `src/app/(admin)/events/[id]/check-in/page.tsx` — Ticket check-in
- [ ] `src/app/(admin)/timed-rentals/page.tsx` — Timed rental management

### Customers, Gift Cards, House Accounts
- [ ] `src/app/(admin)/customers/page.tsx` — Customer database
- [ ] `src/app/(admin)/gift-cards/page.tsx` — Gift cards
- [ ] `src/app/(admin)/house-accounts/page.tsx` — House accounts
- [ ] `src/app/(admin)/discounts/page.tsx` — Discount rules
- [ ] `src/app/(admin)/coupons/page.tsx` — Coupons

### Staff Management
- [ ] `src/app/(admin)/scheduling/page.tsx` — Staff scheduling
- [ ] `src/app/(admin)/payroll/page.tsx` — Payroll dashboard
- [ ] `src/app/(admin)/tips/payouts/page.tsx` — Tip payouts
- [ ] `src/app/(admin)/tip-groups/page.tsx` — Tip pool groups
- [ ] `src/app/(admin)/86/page.tsx` — 86 / out-of-stock management
- [ ] `src/app/(admin)/reservations/page.tsx` — Reservations

---

## TIER 6 — REPORTS (Analytics & Exports)

- [ ] `src/app/(admin)/reports/page.tsx` — Reports hub
- [ ] `src/app/(admin)/reports/daily/page.tsx` — Daily store report (EOD)
- [ ] `src/app/(admin)/reports/shift/page.tsx` — Shift closeout
- [ ] `src/app/(admin)/reports/sales/page.tsx` — Sales summary
- [ ] `src/app/(admin)/reports/product-mix/page.tsx` — PMIX analysis
- [ ] `src/app/(admin)/reports/labor/page.tsx` — Labor cost
- [ ] `src/app/(admin)/reports/payroll/page.tsx` — Payroll export
- [ ] `src/app/(admin)/reports/tips/page.tsx` — Tip summary
- [ ] `src/app/(admin)/reports/voids/page.tsx` — Void tracking
- [ ] `src/app/(admin)/reports/employees/page.tsx` — Employee performance
- [ ] `src/app/(admin)/reports/order-history/page.tsx` — Order history
- [ ] `src/app/(admin)/reports/liquor/page.tsx` — Liquor report
- [ ] `src/app/(admin)/reports/datacap/page.tsx` — Payment transactions
- [ ] `src/app/(admin)/reports/house-accounts/page.tsx` — House accounts
- [ ] `src/app/(admin)/reports/hourly/page.tsx` — Hourly breakdown
- [ ] `src/app/(admin)/reports/forecasting/page.tsx` — Sales forecasting
- [ ] `src/app/(admin)/reports/server-performance/page.tsx` — Server performance
- [ ] `src/app/(admin)/reports/commission/page.tsx` — Commission
- [ ] `src/app/(admin)/reports/coupons/page.tsx` — Coupon usage
- [ ] `src/app/(admin)/reports/tip-adjustment/page.tsx` — Tip adjustments
- [ ] `src/app/(admin)/reports/reservations/page.tsx` — Reservations
- [ ] `src/app/api/reports/daily/route.ts` — Daily report API
- [ ] `src/app/api/reports/shift/route.ts` — Shift report API
- [ ] `src/app/api/reports/product-mix/route.ts` — PMIX API
- [ ] `src/app/api/reports/labor/route.ts` — Labor API
- [ ] `src/app/api/reports/payroll/route.ts` — Payroll API

---

## TIER 7 — MOBILE & PUBLIC PAGES

- [ ] `src/app/(mobile)/mobile/login/page.tsx` — Mobile login
- [ ] `src/app/(mobile)/mobile/schedule/page.tsx` — Mobile schedule
- [ ] `src/app/(mobile)/mobile/tabs/page.tsx` — Mobile tabs
- [ ] `src/app/(mobile)/mobile/tabs/[id]/page.tsx` — Mobile tab detail
- [ ] `src/app/(public)/order/page.tsx` — Public online ordering
- [ ] `src/app/(public)/approve-void/[token]/page.tsx` — Remote void approval
- [ ] `src/app/[orderCode]/[slug]/page.tsx` — Dynamic order code page
- [ ] `src/app/api/online/menu/route.ts` — Public menu API
- [ ] `src/app/api/online/checkout/route.ts` — Online checkout API
- [ ] `src/app/api/public/resolve-order-code/route.ts` — Order code resolver

---

## TIER 8 — SYSTEM & INFRASTRUCTURE

- [ ] `server.ts` — Custom Node.js server (Socket.io + multi-tenant)
- [ ] `ws-server.ts` — WebSocket server (separate process)
- [ ] `preload.js` — AsyncLocalStorage polyfill
- [ ] `src/lib/health-monitor.ts` — System health monitoring
- [ ] `src/lib/offline-manager.ts` — Offline sync manager
- [ ] `src/lib/offline-db.ts` — IndexedDB offline storage
- [ ] `src/lib/license-enforcement.ts` — License validation
- [ ] `src/app/api/session/bootstrap/route.ts` — Initial session bootstrap
- [ ] `src/app/api/system/exit-kiosk/route.ts` — Kiosk exit
- [ ] `src/app/api/system/cleanup-stale-orders/route.ts` — Stale order cleanup
- [ ] `src/app/api/internal/provision/route.ts` — NUC provisioning
- [ ] `src/app/api/internal/cache-invalidate/route.ts` — Cache invalidation
- [ ] `src/app/api/health/route.ts` — Health check
- [ ] `src/app/api/monitoring/errors/route.ts` — Error tracking
- [ ] `src/components/KioskExitZone.tsx` — Kiosk exit zone
- [ ] `src/components/SystemReloadListener.tsx` — Reload listener
- [ ] `public/installer.run` — NUC provisioning script (~1,454 lines)
- [ ] `public/sync-agent.js` — Cloud sync agent

---

## TIER 9 — SUPPORTING CODE (Types, Utilities, Contexts)

### Types
- [ ] `src/types/index.ts` — Core type exports
- [ ] `src/types/orders.ts` — Order / OrderItem types
- [ ] `src/types/payment.ts` — Payment types
- [ ] `src/types/hardware.ts` — Hardware device types
- [ ] `src/types/print/print-settings.ts` — Print configuration types
- [ ] `src/types/multi-surface.ts` — Multi-surface display types

### Shared Utilities
- [ ] `src/lib/utils.ts` — Currency, time formatting, classname helpers
- [ ] `src/lib/constants.ts` — Global constants
- [ ] `src/lib/validations.ts` — Input validation schemas
- [ ] `src/lib/business-day.ts` — Business day calculations
- [ ] `src/lib/unit-conversions.ts` — Unit conversion helpers
- [ ] `src/lib/alert-service.ts` — Alert / notification service
- [ ] `src/lib/email-service.ts` — Email sending
- [ ] `src/lib/twilio.ts` — Twilio SMS service
- [ ] `src/lib/logger.ts` — Structured logging
- [ ] `src/lib/settings.ts` — Settings access layer

### Contexts & Dev
- [ ] `src/contexts/TerminalContext.tsx` — Terminal/device pairing context
- [ ] `src/stores/toast-store.ts` — Toast notification state
- [ ] `src/stores/dev-store.ts` — Dev/debug mode state
- [ ] `src/lib/perf-timing.ts` — Performance timing
- [ ] `src/lib/animations.ts` — Framer Motion presets
- [ ] `src/lib/mock-cards.ts` — Mock payment cards (testing only)

### Scripts
- [ ] `scripts/build-server.mjs` — Server build script
- [ ] `scripts/build-ws-server.mjs` — WebSocket server build
- [ ] `scripts/vercel-build.js` — Vercel build wrapper
- [ ] `scripts/reset-db.sh` — Database reset (DESTRUCTIVE — review carefully)
- [ ] `scripts/cleanup-worktrees.sh` — Git worktree cleanup

---

## Config Files (Quick Review)

- [ ] `next.config.ts` — Standalone output, security headers, backoffice proxy
- [ ] `package.json` — Dependencies + all npm scripts
- [ ] `tsconfig.json` — TypeScript configuration
- [ ] `prisma/schema.prisma` — *(already in Tier 1)*
- [ ] `vercel.json` — Vercel deployment config
- [ ] `playwright.config.ts` — E2E test config
- [ ] `vitest.config.ts` — Unit test config
- [ ] `eslint.config.mjs` — Lint rules
- [ ] `.gitignore` — What's excluded from git
- [ ] `.env.example` — Required environment variables

---

## Review Progress Tracker

| Tier | Files | Reviewed | % |
|------|-------|----------|---|
| 1 — Critical (Security + Payments) | 37 | 0 | 0% |
| 2 — Core Business Logic | 52 | 0 | 0% |
| 3 — Core POS Pages | 42 | 0 | 0% |
| 4 — Menu, Printing, Hardware | 38 | 0 | 0% |
| 5 — Admin Pages | 38 | 0 | 0% |
| 6 — Reports | 26 | 0 | 0% |
| 7 — Mobile & Public | 10 | 0 | 0% |
| 8 — System & Infrastructure | 19 | 0 | 0% |
| 9 — Supporting Code | 22 | 0 | 0% |
| **Total** | **284** | **0** | **0%** |
