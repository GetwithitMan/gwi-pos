# Feature: Invoicing & B2B Billing

> **Status: PLANNED** — Specced in `docs/skills/SPEC-56-INVOICING.md`. Do NOT implement without a planning session.

## Summary
Professional invoicing for catering, corporate events, and B2B accounts. Convert quotes to invoices, track deposits, manage payment terms, and maintain an AR aging dashboard. Integrates with QuickBooks.

## Status
`Planned` — Not yet built.

## Key Capabilities (from SPEC-56)
- **Quote → Invoice workflow** — create quote, convert to invoice on approval
- **Deposit tracking** — % or fixed deposit with payment collection
- **Payment terms** — Net 15/30/60, custom terms
- **AR aging dashboard** — Current / 1-30 / 31-60 / 61-90 / 90+ buckets
- **Corporate account management** — credit limits, monthly statements
- **QuickBooks export** — sync invoices and payments
- **Payment reconciliation** — match incoming payments to open invoices

## Dependencies (anticipated)
- **Customers** — invoices linked to customer/corporate accounts
- **Payments** (`docs/features/payments.md`) — payment collection
- **Orders** — catering orders linked to invoices
- **Reports** — AR reporting, revenue recognition

## SPEC Document
`docs/skills/SPEC-56-INVOICING.md`

*Last updated: 2026-03-03*
