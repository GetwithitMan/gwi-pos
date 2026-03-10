# Feature: Invoicing & B2B Billing

> **Status: BUILT** -- B2B customer invoicing with email delivery, partial payments, and overdue detection.

## Summary
Professional invoicing system for billing customers. Create invoices, send via email (Resend), record partial/full payments, detect overdue invoices, and apply late fees. Uses the existing Invoice/InvoiceLineItem Prisma models with `source='api'` to distinguish from vendor/inventory invoices.

## Key Capabilities
- **Invoice CRUD** -- Create, view, edit (draft only), void invoices
- **Auto-numbering** -- Sequential invoice numbers with configurable prefix (e.g., INV-01001)
- **Email delivery** -- Send professional HTML invoices via Resend email service
- **Partial payments** -- Record multiple payments (cash, card, check, transfer) with running balance
- **Status lifecycle** -- draft -> sent -> paid (or voided). Overdue detection based on due date
- **Overdue cron** -- Automated detection, reminder emails, and monthly late fee application
- **Summary dashboard** -- Outstanding, overdue, and paid-this-month totals
- **Customer management** -- Auto-creates Vendor records as billing customers
- **Professional HTML template** -- PAID/OVERDUE watermarks, company info, line items table

## Code Locations

### Settings
- `src/lib/settings.ts` -- `InvoicingSettings` interface and `DEFAULT_INVOICING` constant
  - Fields: enabled, defaultPaymentTermsDays, defaultTaxRate, autoNumberPrefix, nextInvoiceNumber, companyInfo, lateFeePercent, reminderDays

### API Routes
- `src/app/api/billing-invoices/route.ts` -- GET (list with filters + summary) / POST (create)
- `src/app/api/billing-invoices/[id]/route.ts` -- GET (detail) / PUT (update draft) / DELETE (void)
- `src/app/api/billing-invoices/[id]/send/route.ts` -- POST (send via email)
- `src/app/api/billing-invoices/[id]/record-payment/route.ts` -- POST (record payment)
- `src/app/api/cron/invoice-overdue/route.ts` -- GET (overdue detection, reminders, late fees)

### Invoice Generator
- `src/lib/invoice-generator.ts` -- `generateInvoiceHTML(invoice, settings)` function

### Admin UI
- `src/app/(admin)/billing-invoices/page.tsx` -- Full invoice management page with:
  - Summary cards (outstanding / overdue / paid this month)
  - Filterable invoice table with status badges
  - Create Invoice modal with line items
  - Invoice Detail modal with payment history
  - Record Payment modal (partial payment support)
  - Send / Resend / Void actions

### Existing Vendor Invoice Routes (NOT modified)
- `src/app/api/invoices/` -- Vendor/inventory invoice routes (untouched)
- `src/app/(admin)/invoices/` -- Vendor invoice UI (untouched)

## Schema Mapping
Uses existing Invoice/InvoiceLineItem Prisma models. Key field mappings for billing invoices:
- `source = 'api'` -- Distinguishes billing invoices from vendor invoices (`source = 'manual' | 'marginedge'`)
- `vendorId` -> Customer (Vendor record with `notes = 'Billing customer'`)
- `deliveryDate` -> `sentAt` (when invoice was emailed)
- `shippingCost` -> `amountPaid` (running total of payments received)
- `lineItem.unit` -> taxable flag (`'taxable'` or `'nontaxable'`)
- Payment history stored in `notes` field after `---PAYMENTS---` marker as JSON array

## Status Mapping
| UI Status | InvoiceStatus Enum | Description |
|-----------|-------------------|-------------|
| Draft | `draft` | Created but not sent |
| Sent | `pending` | Sent to customer via email |
| Viewed | `approved` | Customer has viewed (future) |
| Paid | `paid` | Fully paid, paidDate set |
| Cancelled | `voided` | Voided/cancelled |
| Overdue | `pending` + past due | Sent but past due date |

## Auth & Permissions
- All routes use `withVenue` + `withAuth` session-based middleware
- Read: `INVENTORY_VIEW` permission
- Write: `INVENTORY_MANAGE` permission

## Dependencies
- **Email Service** (`src/lib/email-service.ts`) -- Resend API for sending invoices
- **Settings** (`src/lib/settings.ts`) -- Location-level invoicing configuration
- **Vendor model** -- Reused as customer entity for billing invoices

## Cross-Feature Dependencies
- **House Accounts** -- B2B customers may also have house accounts
- **Reports** -- AR aging reports (future enhancement)
- **Accounting** -- QuickBooks/Xero invoice sync (future enhancement)

*Last updated: 2026-03-10*
