# Skill 426: Wave 5 — Owner Setup & Advanced Analytics

**Status:** Done
**Date:** Feb 23, 2026

## Problem

Post-Wave-4 field observation identified 13 gaps in owner/operator tooling: no setup wizard or onboarding flow, no CSV menu import, no batch printer testing, incomplete report exports, no email report delivery, no consolidated cash/liability view, no daypart or trend analytics, no customer VIP tiers or banning, no email receipts, no buddy-punch prevention, limited 2FA coverage, no keyboard shortcuts, and no quick-service mode for counter operations.

## Solution

### 13 Items Across 5 Focus Areas

| # | ID | Area | Fix Summary |
|---|-----|------|-------------|
| 1 | W5-1 | Setup & Onboarding | Getting-started checklist page at `/admin/setup` — 6-step progress tracker (business info, menu, employees, floor plan, printers, payments) with completion API |
| 2 | W5-2 | Setup & Onboarding | CSV menu import at `/settings/menu/import` — file upload with preview, column mapping, bulk item creation, duplicate detection |
| 3 | W5-3 | Setup & Onboarding | Batch "Test All Printers" button on hardware printers page — pings all configured printers and shows summary |
| 4 | W5-4 | Reporting | CSV export added to sales, shift, tips, voids, employees, hourly, liquor report pages |
| 5 | W5-5 | Reporting | Email report MVP — "Email Report" button on daily report sends key metrics via Resend API |
| 6 | W5-6 | Reporting | Cash-flow & liability rollup report — aggregates cash drawers, house accounts, gift cards, tip payouts |
| 7 | W5-7 | Reporting | Daypart report with configurable boundaries + trends page with day-over-day/week-over-week comparison |
| 8 | W5-8 | Customer & VIP | VIP tiers (silver/gold/platinum via tags), birthday surfacing with upcoming indicator, banned flag with order warnings |
| 9 | W5-9 | Customer & VIP | Email receipt option after payment — ReceiptModal with email input, Resend delivery, optional email save |
| 10 | W5-10 | Security | Buddy-punch prevention — IP/device logging on clock events, suspicious clock detection alerts, screen lock settings |
| 11 | W5-11 | Security | 2FA extension — configurable thresholds for large refunds and voids requiring remote SMS approval |
| 12 | W5-12 | Navigation & QoL | Command palette (Cmd+K/Ctrl+K) with fuzzy search across all admin pages, keyboard shortcuts for common views |
| 13 | W5-13 | Navigation & QoL | Quick-service mode — counter-service button bypassing floor plan for ticket-based ordering |

## Files Modified

| File | IDs | Changes |
|------|-----|---------|
| `src/app/(admin)/setup/page.tsx` | W5-1 | New file (226 lines): getting-started checklist with progress tracking |
| `src/app/api/setup/status/route.ts` | W5-1 | New file (67 lines): setup completion status API |
| `src/app/(admin)/settings/menu/import/page.tsx` | W5-2 | New file (458 lines): CSV import with upload, preview, mapping |
| `src/app/api/import/menu/route.ts` | W5-2 | New file (227 lines): CSV parsing and bulk menu item creation |
| `src/app/(admin)/settings/hardware/printers/page.tsx` | W5-3 | Batch "Test All Printers" button (+62 lines) |
| `src/app/(admin)/reports/sales/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/shift/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/tips/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/voids/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/employees/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/hourly/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/liquor/page.tsx` | W5-4 | CSV export function and button |
| `src/app/(admin)/reports/daily/page.tsx` | W5-5 | Email report button and handler |
| `src/app/api/reports/email/route.ts` | W5-5 | New file (144 lines): report email delivery via Resend |
| `src/app/(admin)/reports/cash-liabilities/page.tsx` | W5-6 | New file (386 lines): consolidated liability view |
| `src/app/api/reports/cash-liabilities/route.ts` | W5-6 | New file (183 lines): cash/liability aggregation API |
| `src/app/(admin)/reports/daypart/page.tsx` | W5-7 | New file (309 lines): daypart analysis report |
| `src/app/api/reports/daypart/route.ts` | W5-7 | New file (132 lines): daypart grouping API |
| `src/app/(admin)/reports/trends/page.tsx` | W5-7 | New file (389 lines): period comparison trends |
| `src/app/(admin)/reports/page.tsx` | W5-4-7 | Links to new report pages |
| `src/app/(admin)/customers/page.tsx` | W5-8 | VIP tier selector, birthday indicator, banned toggle (+221 lines) |
| `src/app/api/customers/route.ts` | W5-8 | VIP/banned tag filtering in API |
| `src/app/api/customers/[id]/route.ts` | W5-8 | isBanned and vipTier in response |
| `src/app/api/orders/[id]/customer/route.ts` | W5-8 | Banned customer warning on order attach |
| `src/components/customers/CustomerLookupModal.tsx` | W5-8 | Banned warning in customer search |
| `src/app/api/receipts/email/route.ts` | W5-9 | New file (273 lines): receipt email composition and delivery |
| `src/components/receipt/ReceiptModal.tsx` | W5-9 | New file (271 lines): post-payment email receipt modal |
| `src/app/api/time-clock/route.ts` | W5-10 | IP/device logging on clock events (+98 lines) |
| `src/app/(admin)/settings/security/page.tsx` | W5-10, W5-11 | Security settings UI: screen lock, buddy-punch, 2FA thresholds (+120 lines) |
| `src/lib/settings.ts` | W5-10, W5-11 | SecuritySettings interface with defaults |
| `src/app/api/orders/[id]/comp-void/route.ts` | W5-11 | 2FA threshold enforcement for large voids |
| `src/app/api/orders/[id]/refund-payment/route.ts` | W5-11 | 2FA threshold enforcement for large refunds |
| `src/components/admin/AdminNav.tsx` | W5-12 | Search button + CommandPalette integration |
| `src/components/admin/CommandPalette.tsx` | W5-12 | New file (380 lines): fuzzy search command palette |
| `src/components/orders/UnifiedPOSHeader.tsx` | W5-13 | Quick-service mode button |
| `src/app/(pos)/orders/page.tsx` | W5-13 | Quick-service order creation flow |

## Testing

1. **W5-1** — Navigate to `/admin/setup`. Verify checklist shows completion status. Click "Set up" to navigate to relevant page.
2. **W5-2** — Navigate to `/settings/menu/import`. Upload a CSV with name, price, category columns. Verify preview, import, and item creation.
3. **W5-3** — Go to printers page. Click "Test All Printers". Verify all printers are pinged and results displayed.
4. **W5-4** — Visit sales, shift, tips, voids, employees, hourly, liquor reports. Verify "Export CSV" button and download.
5. **W5-5** — On daily report, click "Email Report". Enter email. Verify email received via Resend.
6. **W5-6** — Navigate to `/reports/cash-liabilities`. Verify aggregated cash, house accounts, gift cards, tips data.
7. **W5-7** — Visit `/reports/daypart` and `/reports/trends`. Verify daypart grouping and period comparison.
8. **W5-8** — Open customer management. Set VIP tier, toggle banned. Verify warnings when attaching banned customer to order.
9. **W5-9** — Complete a payment. Verify "Email Receipt" option appears. Send receipt and verify email.
10. **W5-10** — Clock in. Verify IP/device logged in AuditLog. Enable buddy-punch detection in security settings.
11. **W5-11** — Enable large refund 2FA. Attempt refund above threshold. Verify remote approval required.
12. **W5-12** — Press Cmd+K. Verify command palette opens. Search for a page. Press Enter to navigate.
13. **W5-13** — Click "Quick Service" button. Verify new order created without table. Add items and pay.
