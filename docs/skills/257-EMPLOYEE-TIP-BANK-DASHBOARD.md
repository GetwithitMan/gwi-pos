# Skill 257: Employee Tip Bank Dashboard

**Status:** DONE
**Domain:** Tips & Tip Bank
**Date:** 2026-02-10
**Dependencies:** Skill 250 (Tip Ledger Foundation), Skill 252 (Dynamic Tip Groups)
**Phase:** Tip Bank Phase 8

## Overview

Self-service tip bank page where employees view their current balance, ledger entries in bank-statement format, with date range and source type filters.

## What Was Built

### UI Page (src/app/(pos)/crew/tip-bank/page.tsx, ~347 lines)
- **Balance Hero Card** — Large emerald-green display of current balance (4xl/5xl text)
- **Filters** — Date range picker (dateFrom, dateTo) + source type dropdown
- **Ledger Entries** — Bank-statement style list:
  - Color-coded badges per sourceType (green for credits, red for debits)
  - Human-readable source labels (e.g., "Direct Tip", "Group Pool", "Cash Payout")
  - Amount with +/- prefix
  - Memo text when present
  - Timestamp
- **Pagination** — Load More button, 50 entries per page
- **Auth Guard** — Redirects to /login if not authenticated
- **Navigation** — Back button to /crew

### Helper Functions
- `humanizeSourceType()` — Converts sourceType codes to readable labels
- `sourceTypeBadgeClasses()` — Returns Tailwind classes per sourceType

### Data Flow
```
Employee opens /crew/tip-bank
    ↓
Auth check (employeeId from auth store)
    ↓
GET /api/tips/ledger/{employeeId}?locationId=...&filters
    ↓
Displays balance + entries in glassmorphism UI
```

### Design
- Dark glassmorphism theme (bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900)
- Cards: bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl
- Emerald accent for positive balance, red for negative

## Files Created
- `src/app/(pos)/crew/tip-bank/page.tsx`

## Verification
1. Employee sees current balance prominently
2. Ledger entries display in bank-statement format
3. Date range filter narrows results
4. Source type filter works
5. Pagination loads more entries
6. No permission needed to view own ledger
