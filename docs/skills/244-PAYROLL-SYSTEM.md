---
skill: 244
title: Payroll System
status: DONE
depends_on: [01, 47, 50]
---

# Skill 240: Payroll System

> **Status:** DONE
> **Domain:** Employees
> **Dependencies:** 01 (Employee Management), 47 (Clock In/Out), 50 (Shift Close)
> **Last Updated:** 2026-02-08

## Overview

Full payroll processing system with tax calculations, pay periods, pay stubs, and PDF generation. Handles federal/state/local taxes, FICA, overtime, tips, and commissions.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/payroll/page.tsx` | Payroll admin dashboard |
| `src/app/(admin)/payroll/pay-stub-pdf.ts` | PDF pay stub generation |
| `src/app/(admin)/payroll/tax-calculator.ts` | Federal/state/FICA tax calculations |
| `src/app/(admin)/payroll/pay-stubs/` | Pay stub views |
| `src/app/(admin)/payroll/periods/` | Pay period management |
| `src/app/api/payroll/` | Payroll API routes |
| `src/lib/payroll/` | Payroll business logic |

## Schema Models

- `PayrollPeriod` -- Pay period with start/end dates, status
- `PayStub` -- Individual pay stubs with gross/net/deductions
- `PayrollSettings` -- Location-level payroll configuration
- `Employee` -- YTD tracking fields (ytdGrossEarnings, ytdTips, ytdFederalTax, etc.)

## Connected Parts

- **Shifts (Skill 50)**: Hours worked feed into payroll calculations
- **Tips (Skill 6/105)**: Tip shares route to payroll
- **Commissions (Skill 29)**: Commission earnings included in gross pay
