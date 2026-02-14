# GWI POS - Error Handling Standards

**Version:** 1.0
**Updated:** January 30, 2026
**Status:** Reference Documentation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Error Code Numbering Scheme](#2-error-code-numbering-scheme)
3. [Standard Error Response Format](#3-standard-error-response-format)
4. [Retry Logic Patterns](#4-retry-logic-patterns)
5. [User-Facing Error Messages](#5-user-facing-error-messages)
6. [Logging Standards](#6-logging-standards)
7. [Implementation Examples](#7-implementation-examples)
8. [Error Recovery Workflows](#8-error-recovery-workflows)

---

## 1. Overview

This document defines the standard error handling patterns for GWI POS across:

- **Server-side:** Next.js API routes, Prisma database operations
- **Client-side:** React components, Zustand stores
- **Offline/Sync:** Store-and-forward, conflict resolution
- **Payments:** Transaction processing, PCI-compliant handling
- **Real-time:** WebSocket events, KDS updates

### Design Principles

1. **Consistency:** All errors follow the same structure
2. **Actionability:** Every error tells the user/developer what to do
3. **Security:** Never expose sensitive data in error messages
4. **Recoverability:** Clearly indicate if/how to retry
5. **Traceability:** Every error has a unique code for debugging

---

## 2. Error Code Numbering Scheme

### Code Structure

```
ERR_XXYY

XX = Domain (2 digits)
YY = Specific error within domain (2 digits)
```

### Domain Categories

| Range | Domain | Description |
|-------|--------|-------------|
| **01xx** | Auth | Authentication, authorization, sessions |
| **02xx** | Orders | Order creation, updates, status |
| **03xx** | Payments | Payment processing, refunds, voids |
| **04xx** | Menu | Categories, items, modifiers |
| **05xx** | Tables | Tables, sections, floor plan |
| **06xx** | Employees | Employee CRUD, roles, permissions |
| **07xx** | Customers | Customer profiles, loyalty |
| **08xx** | Reservations | Booking, conflicts, availability |
| **09xx** | Shifts | Shifts, time clock, breaks |
| **10xx** | Gift Cards | Activation, redemption, balance |
| **11xx** | House Accounts | Credit limits, charges, billing |
| **12xx** | Coupons/Discounts | Validation, redemption, limits |
| **13xx** | Events/Tickets | Event management, ticketing |
| **14xx** | Combos | Combo templates, selections |
| **15xx** | Liquor Builder | Bottles, recipes, pour tracking |
| **16xx** | Entertainment | Timed sessions, waitlist |
| **17xx** | Tabs | Bar tabs, pre-auth |
| **18xx** | Tips | Tip-out rules, distributions |
| **19xx** | Inventory | Stock levels, alerts |
| **20xx** | Hardware | Printers, KDS, terminals |
| **21xx** | Reports | Report generation, exports |
| **22xx** | Sync | Cloud sync, conflicts |
| **23xx** | Settings | Configuration, preferences |
| **24xx** | Database | Prisma, PostgreSQL |
| **25xx** | Network | Connectivity, timeouts |
| **99xx** | System | Unexpected, generic errors |

---

### Complete Error Code Reference

#### 01xx - Authentication

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0101` | INVALID_PIN | PIN is incorrect | Yes |
| `ERR_0102` | PIN_TOO_SHORT | PIN must be at least 4 digits | No |
| `ERR_0103` | EMPLOYEE_INACTIVE | Employee account is inactive | No |
| `ERR_0104` | SESSION_EXPIRED | Session has expired, please log in again | Yes |
| `ERR_0105` | INSUFFICIENT_PERMISSION | You don't have permission for this action | No |
| `ERR_0106` | DEVICE_NOT_PAIRED | Device is not paired with this location | No |
| `ERR_0107` | PAIRING_CODE_EXPIRED | Pairing code has expired | Yes |
| `ERR_0108` | PAIRING_CODE_INVALID | Invalid pairing code | Yes |
| `ERR_0109` | IP_NOT_ALLOWED | Device IP not authorized | No |

#### 02xx - Orders

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0201` | ORDER_NOT_FOUND | Order not found | No |
| `ERR_0202` | ORDER_ALREADY_PAID | Order has already been paid | No |
| `ERR_0203` | ORDER_ALREADY_CLOSED | Order is closed and cannot be modified | No |
| `ERR_0204` | INVALID_ORDER_TYPE | Invalid order type specified | No |
| `ERR_0205` | TABLE_REQUIRED | Table selection is required for this order type | No |
| `ERR_0206` | CUSTOMER_REQUIRED | Customer is required for this order type | No |
| `ERR_0207` | EMPTY_ORDER | Cannot process an order with no items | No |
| `ERR_0208` | INVALID_GUEST_COUNT | Guest count must be at least 1 | No |
| `ERR_0209` | ORDER_LOCKED | Order is currently being edited by another user | Yes (after 30s) |
| `ERR_0210` | ITEM_NOT_AVAILABLE | One or more items are no longer available | No |
| `ERR_0211` | SPLIT_FAILED | Unable to split order | No |
| `ERR_0212` | MERGE_FAILED | Unable to merge orders | No |
| `ERR_0213` | TRANSFER_FAILED | Unable to transfer order | No |
| `ERR_0214` | VOID_REQUIRES_APPROVAL | Void requires manager approval | No |
| `ERR_0215` | COMP_REQUIRES_APPROVAL | Comp requires manager approval | No |

#### 03xx - Payments

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0301` | PAYMENT_FAILED | Payment processing failed | **No** |
| `ERR_0302` | CARD_DECLINED | Card was declined | **No** |
| `ERR_0303` | INSUFFICIENT_FUNDS | Insufficient funds | **No** |
| `ERR_0304` | CARD_EXPIRED | Card has expired | **No** |
| `ERR_0305` | INVALID_CARD | Invalid card number | **No** |
| `ERR_0306` | AMOUNT_MISMATCH | Payment amount doesn't match balance | No |
| `ERR_0307` | TERMINAL_OFFLINE | Payment terminal is offline | Yes |
| `ERR_0308` | TERMINAL_BUSY | Payment terminal is busy | Yes (after 5s) |
| `ERR_0309` | TERMINAL_TIMEOUT | Payment terminal timed out | Yes |
| `ERR_0310` | REFUND_EXCEEDS_ORIGINAL | Refund amount exceeds original payment | No |
| `ERR_0311` | VOID_WINDOW_EXPIRED | Payment has settled, use refund instead | No |
| `ERR_0312` | REFUND_NOT_ALLOWED | Refunds not allowed for this payment type | No |
| `ERR_0313` | TIP_ADJUSTMENT_FAILED | Unable to adjust tip amount | Yes |
| `ERR_0314` | PRE_AUTH_EXPIRED | Pre-authorization has expired | No |
| `ERR_0315` | PRE_AUTH_CAPTURE_FAILED | Unable to capture pre-authorized payment | Yes |
| `ERR_0316` | OFFLINE_LIMIT_EXCEEDED | Offline payment limit exceeded | No |

#### 04xx - Menu

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0401` | CATEGORY_NOT_FOUND | Category not found | No |
| `ERR_0402` | ITEM_NOT_FOUND | Menu item not found | No |
| `ERR_0403` | MODIFIER_NOT_FOUND | Modifier not found | No |
| `ERR_0404` | MODIFIER_GROUP_NOT_FOUND | Modifier group not found | No |
| `ERR_0405` | DUPLICATE_ITEM_NAME | An item with this name already exists | No |
| `ERR_0406` | INVALID_PRICE | Price must be zero or greater | No |
| `ERR_0407` | CATEGORY_HAS_ITEMS | Cannot delete category with items | No |
| `ERR_0408` | MODIFIER_IN_USE | Modifier is in use and cannot be deleted | No |
| `ERR_0409` | ITEM_UNAVAILABLE | This item is currently unavailable | No |
| `ERR_0410` | TIME_RESTRICTION | Item not available at this time | No |

#### 05xx - Tables

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0501` | TABLE_NOT_FOUND | Table not found | No |
| `ERR_0502` | SECTION_NOT_FOUND | Section not found | No |
| `ERR_0503` | TABLE_OCCUPIED | Table is currently occupied | No |
| `ERR_0504` | TABLE_RESERVED | Table is reserved | No |
| `ERR_0505` | DUPLICATE_TABLE_NAME | A table with this name already exists | No |
| `ERR_0506` | CAPACITY_EXCEEDED | Party size exceeds table capacity | No |
| `ERR_0507` | COMBINE_FAILED | Unable to combine tables | No |
| `ERR_0508` | UNCOMBINE_FAILED | Unable to separate combined tables | No |
| `ERR_0509` | SEAT_NOT_FOUND | Seat not found | No |

#### 06xx - Employees

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0601` | EMPLOYEE_NOT_FOUND | Employee not found | No |
| `ERR_0602` | ROLE_NOT_FOUND | Role not found | No |
| `ERR_0603` | DUPLICATE_PIN | PIN is already in use by another employee | No |
| `ERR_0604` | INVALID_HOURLY_RATE | Hourly rate must be zero or greater | No |
| `ERR_0605` | ROLE_IN_USE | Cannot delete role with assigned employees | No |
| `ERR_0606` | CANNOT_DEACTIVATE_SELF | Cannot deactivate your own account | No |
| `ERR_0607` | DUPLICATE_EMAIL | Email is already in use | No |

#### 07xx - Customers

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0701` | CUSTOMER_NOT_FOUND | Customer not found | No |
| `ERR_0702` | DUPLICATE_EMAIL | A customer with this email already exists | No |
| `ERR_0703` | DUPLICATE_PHONE | A customer with this phone already exists | No |
| `ERR_0704` | INSUFFICIENT_POINTS | Customer doesn't have enough loyalty points | No |
| `ERR_0705` | MIN_POINTS_NOT_MET | Minimum points required for redemption | No |
| `ERR_0706` | MAX_REDEMPTION_EXCEEDED | Exceeds maximum points redemption limit | No |

#### 08xx - Reservations

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0801` | RESERVATION_NOT_FOUND | Reservation not found | No |
| `ERR_0802` | TIME_SLOT_UNAVAILABLE | This time slot is not available | No |
| `ERR_0803` | TABLE_CONFLICT | Table has a conflicting reservation | No |
| `ERR_0804` | EVENT_CONFLICT | Conflicts with a scheduled event | No |
| `ERR_0805` | PARTY_SIZE_INVALID | Invalid party size | No |
| `ERR_0806` | PAST_RESERVATION | Cannot create reservation in the past | No |
| `ERR_0807` | CANCELLATION_TOO_LATE | Cancellation deadline has passed | No |

#### 09xx - Shifts & Time Clock

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_0901` | SHIFT_NOT_FOUND | Shift not found | No |
| `ERR_0902` | SHIFT_ALREADY_OPEN | Employee already has an open shift | No |
| `ERR_0903` | NO_OPEN_SHIFT | Employee is not clocked in | No |
| `ERR_0904` | ALREADY_CLOCKED_IN | Employee is already clocked in | No |
| `ERR_0905` | ALREADY_ON_BREAK | Employee is already on break | No |
| `ERR_0906` | NOT_ON_BREAK | Employee is not currently on break | No |
| `ERR_0907` | ENTRY_CLOSED | Time clock entry is already closed | No |
| `ERR_0908` | INVALID_STARTING_CASH | Invalid starting cash amount | No |

#### 10xx - Gift Cards

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1001` | GIFT_CARD_NOT_FOUND | Gift card not found | No |
| `ERR_1002` | GIFT_CARD_INACTIVE | Gift card is not active | No |
| `ERR_1003` | GIFT_CARD_EXPIRED | Gift card has expired | No |
| `ERR_1004` | GIFT_CARD_DEPLETED | Gift card has no remaining balance | No |
| `ERR_1005` | INSUFFICIENT_BALANCE | Gift card has insufficient balance | No |
| `ERR_1006` | INVALID_AMOUNT | Gift card amount must be positive | No |

#### 11xx - House Accounts

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1101` | HOUSE_ACCOUNT_NOT_FOUND | House account not found | No |
| `ERR_1102` | ACCOUNT_INACTIVE | House account is not active | No |
| `ERR_1103` | CREDIT_LIMIT_EXCEEDED | Charge would exceed credit limit | No |
| `ERR_1104` | ACCOUNT_SUSPENDED | House account is suspended | No |
| `ERR_1105` | DUPLICATE_ACCOUNT_NAME | Account name already exists | No |
| `ERR_1106` | ACCOUNT_PAST_DUE | Account has past due balance | No |

#### 12xx - Coupons & Discounts

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1201` | COUPON_NOT_FOUND | Invalid coupon code | No |
| `ERR_1202` | COUPON_EXPIRED | Coupon has expired | No |
| `ERR_1203` | COUPON_NOT_YET_VALID | Coupon is not yet valid | No |
| `ERR_1204` | COUPON_USAGE_EXCEEDED | Coupon usage limit reached | No |
| `ERR_1205` | MINIMUM_NOT_MET | Order doesn't meet minimum requirement | No |
| `ERR_1206` | DISCOUNT_NOT_FOUND | Discount rule not found | No |
| `ERR_1207` | DISCOUNT_NOT_APPLICABLE | Discount doesn't apply to this order | No |
| `ERR_1208` | DISCOUNT_STACKABLE_CONFLICT | Cannot combine with existing discount | No |
| `ERR_1209` | DISCOUNT_REQUIRES_APPROVAL | Discount requires manager approval | No |

#### 13xx - Events & Tickets

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1301` | EVENT_NOT_FOUND | Event not found | No |
| `ERR_1302` | TICKET_NOT_FOUND | Ticket not found | No |
| `ERR_1303` | EVENT_NOT_ON_SALE | Event is not currently on sale | No |
| `ERR_1304` | EVENT_SOLD_OUT | Event is sold out | No |
| `ERR_1305` | TICKETS_UNAVAILABLE | Requested tickets not available | No |
| `ERR_1306` | TICKET_ALREADY_USED | Ticket has already been checked in | No |
| `ERR_1307` | TICKET_CANCELLED | Ticket has been cancelled | No |
| `ERR_1308` | HOLD_EXPIRED | Ticket hold has expired | No |
| `ERR_1309` | MAX_TICKETS_EXCEEDED | Exceeds maximum tickets per order | No |
| `ERR_1310` | SEAT_ALREADY_TAKEN | Seat is already taken | No |

#### 14xx - Combos

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1401` | COMBO_NOT_FOUND | Combo not found | No |
| `ERR_1402` | INVALID_SELECTION | Invalid combo selection | No |
| `ERR_1403` | REQUIRED_SELECTION_MISSING | Required combo selection missing | No |
| `ERR_1404` | SELECTION_LIMIT_EXCEEDED | Combo selection limit exceeded | No |

#### 15xx - Liquor Builder

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1501` | BOTTLE_NOT_FOUND | Bottle product not found | No |
| `ERR_1502` | SPIRIT_CATEGORY_NOT_FOUND | Spirit category not found | No |
| `ERR_1503` | INVALID_TIER | Invalid spirit tier | No |
| `ERR_1504` | INVALID_BOTTLE_SIZE | Invalid bottle size | No |
| `ERR_1505` | RECIPE_NOT_FOUND | Recipe not found | No |

#### 16xx - Entertainment

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1601` | ITEM_NOT_AVAILABLE | Entertainment item is not available | No |
| `ERR_1602` | ITEM_IN_USE | Entertainment item is currently in use | No |
| `ERR_1603` | ITEM_IN_MAINTENANCE | Entertainment item is under maintenance | No |
| `ERR_1604` | SESSION_NOT_FOUND | Session not found | No |
| `ERR_1605` | SESSION_ALREADY_ENDED | Session has already ended | No |
| `ERR_1606` | WAITLIST_FULL | Waitlist is full | No |

#### 17xx - Tabs

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1701` | TAB_NOT_FOUND | Tab not found | No |
| `ERR_1702` | TAB_ALREADY_CLOSED | Tab has already been closed | No |
| `ERR_1703` | CARD_ON_FILE_REQUIRED | Card on file required to open tab | No |
| `ERR_1704` | TAB_LIMIT_EXCEEDED | Tab amount exceeds pre-auth limit | No |
| `ERR_1705` | TRANSFER_NOT_ALLOWED | Tab transfer not allowed | No |

#### 18xx - Tips

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1801` | TIP_RULE_NOT_FOUND | Tip-out rule not found | No |
| `ERR_1802` | DUPLICATE_RULE | Tip-out rule already exists for this combination | No |
| `ERR_1803` | INVALID_PERCENTAGE | Percentage must be between 0 and 100 | No |
| `ERR_1804` | SAME_ROLE | From and to role cannot be the same | No |
| `ERR_1805` | TIP_SHARE_NOT_FOUND | Tip share record not found | No |

#### 19xx - Inventory

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_1901` | ITEM_NOT_FOUND | Inventory item not found | No |
| `ERR_1902` | INSUFFICIENT_STOCK | Insufficient stock level | No |
| `ERR_1903` | NEGATIVE_QUANTITY | Quantity cannot be negative | No |
| `ERR_1904` | INGREDIENT_NOT_FOUND | Ingredient not found | No |

#### 20xx - Hardware

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_2001` | PRINTER_NOT_FOUND | Printer not found | No |
| `ERR_2002` | PRINTER_OFFLINE | Printer is offline | Yes |
| `ERR_2003` | PRINTER_PAPER_OUT | Printer is out of paper | No |
| `ERR_2004` | PRINT_FAILED | Print job failed | Yes |
| `ERR_2005` | KDS_NOT_FOUND | KDS screen not found | No |
| `ERR_2006` | KDS_OFFLINE | KDS screen is offline | Yes |
| `ERR_2007` | DRAWER_OPEN_FAILED | Unable to open cash drawer | Yes |
| `ERR_2008` | NO_BACKUP_PRINTER | No backup printer configured | No |

#### 21xx - Reports

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_2101` | INVALID_DATE_RANGE | Invalid date range | No |
| `ERR_2102` | REPORT_TOO_LARGE | Report data exceeds size limit | No |
| `ERR_2103` | EXPORT_FAILED | Report export failed | Yes |
| `ERR_2104` | NO_DATA | No data found for selected criteria | No |

#### 22xx - Sync

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_2201` | CLOUD_UNREACHABLE | Cloud service is unreachable | Yes |
| `ERR_2202` | AUTH_FAILED | Cloud authentication failed | No |
| `ERR_2203` | VALIDATION_ERROR | Data validation error | No |
| `ERR_2204` | FOREIGN_KEY_MISSING | Related record not found | Yes |
| `ERR_2205` | TRANSACTION_TIMEOUT | Sync transaction timed out | Yes |
| `ERR_2206` | CONFLICT_UNRESOLVABLE | Conflict requires manual resolution | No |
| `ERR_2207` | DISK_FULL | Insufficient disk space | No |
| `ERR_2208` | RATE_LIMITED | Sync rate limit exceeded | Yes (wait) |

#### 23xx - Settings

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_2301` | INVALID_SETTINGS | Invalid settings configuration | No |
| `ERR_2302` | TAX_RULE_NOT_FOUND | Tax rule not found | No |
| `ERR_2303` | ORDER_TYPE_NOT_FOUND | Order type not found | No |
| `ERR_2304` | SYSTEM_ORDER_TYPE | Cannot delete system order type | No |
| `ERR_2305` | PREP_STATION_NOT_FOUND | Prep station not found | No |

#### 24xx - Database

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_2401` | CONNECTION_FAILED | Database connection failed | Yes |
| `ERR_2402` | TRANSACTION_FAILED | Database transaction failed | Yes |
| `ERR_2403` | CONSTRAINT_VIOLATION | Database constraint violation | No |
| `ERR_2404` | DEADLOCK | Database deadlock detected | Yes (immediate) |
| `ERR_2405` | TIMEOUT | Database query timed out | Yes |
| `ERR_2406` | MIGRATION_REQUIRED | Database migration required | No |

#### 25xx - Network

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_2501` | NETWORK_OFFLINE | No network connection | Yes |
| `ERR_2502` | REQUEST_TIMEOUT | Request timed out | Yes |
| `ERR_2503` | SERVICE_UNAVAILABLE | Service temporarily unavailable | Yes |
| `ERR_2504` | RATE_LIMITED | Too many requests | Yes (with delay) |
| `ERR_2505` | WEBSOCKET_DISCONNECTED | Real-time connection lost | Yes |

#### 99xx - System

| Code | Name | Message | Retryable |
|------|------|---------|-----------|
| `ERR_9901` | INTERNAL_ERROR | An unexpected error occurred | Yes |
| `ERR_9902` | MAINTENANCE_MODE | System is under maintenance | Yes |
| `ERR_9903` | FEATURE_DISABLED | This feature is not enabled | No |
| `ERR_9904` | LOCATION_NOT_FOUND | Location not found | No |
| `ERR_9905` | INVALID_REQUEST | Invalid request format | No |
| `ERR_9999` | UNKNOWN | Unknown error | Yes |

---

## 3. Standard Error Response Format

### TypeScript Interfaces

```typescript
// src/types/errors.ts

/**
 * Standard error response format for all API endpoints
 */
interface ErrorResponse {
  success: false
  error: {
    /** Unique error code (e.g., "ERR_0201") */
    code: string

    /** User-friendly error message */
    message: string

    /** Additional context (development only) */
    details?: ErrorDetails

    /** Whether the operation can be retried */
    retryable: boolean

    /** Suggested retry delay in milliseconds */
    retryAfter?: number

    /** Additional data relevant to the error */
    data?: Record<string, unknown>
  }
}

interface ErrorDetails {
  /** Stack trace (dev only, never in production) */
  stack?: string

  /** Original error message (dev only) */
  originalMessage?: string

  /** Database constraint that failed */
  constraint?: string

  /** Field that caused validation error */
  field?: string

  /** Timestamp of error */
  timestamp: string

  /** Request ID for tracing */
  requestId?: string
}

/**
 * Success response format for consistency
 */
interface SuccessResponse<T = unknown> {
  success: true
  data: T
}

/**
 * Combined API response type
 */
type ApiResponse<T = unknown> = SuccessResponse<T> | ErrorResponse
```

### Error Class Implementation

```typescript
// src/lib/errors.ts

import { ERROR_CODES, ERROR_MESSAGES, RETRY_CONFIG } from './error-codes'

export class AppError extends Error {
  public readonly code: string
  public readonly retryable: boolean
  public readonly retryAfter?: number
  public readonly data?: Record<string, unknown>
  public readonly httpStatus: number

  constructor(
    code: string,
    message?: string,
    options?: {
      retryable?: boolean
      retryAfter?: number
      data?: Record<string, unknown>
      httpStatus?: number
    }
  ) {
    const errorDef = ERROR_CODES[code]

    super(message || errorDef?.message || 'An error occurred')

    this.code = code
    this.retryable = options?.retryable ?? errorDef?.retryable ?? false
    this.retryAfter = options?.retryAfter
    this.data = options?.data
    this.httpStatus = options?.httpStatus ?? errorDef?.httpStatus ?? 500

    // Maintain proper stack trace
    Error.captureStackTrace(this, AppError)
  }

  /**
   * Convert to API response format
   */
  toResponse(includeDetails: boolean = false): ErrorResponse {
    const response: ErrorResponse = {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
      },
    }

    if (this.retryAfter) {
      response.error.retryAfter = this.retryAfter
    }

    if (this.data) {
      response.error.data = this.data
    }

    if (includeDetails && process.env.NODE_ENV === 'development') {
      response.error.details = {
        stack: this.stack,
        timestamp: new Date().toISOString(),
      }
    }

    return response
  }
}

/**
 * Helper to create common errors
 */
export const Errors = {
  // Auth
  invalidPin: () => new AppError('ERR_0101', undefined, { httpStatus: 401 }),
  insufficientPermission: (action: string) =>
    new AppError('ERR_0105', `You don't have permission to ${action}`, { httpStatus: 403 }),

  // Orders
  orderNotFound: (id: string) =>
    new AppError('ERR_0201', `Order ${id} not found`, { httpStatus: 404 }),
  orderAlreadyPaid: () =>
    new AppError('ERR_0202', undefined, { httpStatus: 400 }),

  // Payments
  paymentFailed: (reason?: string) =>
    new AppError('ERR_0301', reason || 'Payment processing failed', {
      httpStatus: 402,
      retryable: false, // NEVER auto-retry payments
    }),
  cardDeclined: (reason?: string) =>
    new AppError('ERR_0302', reason || 'Card was declined', {
      httpStatus: 402,
      retryable: false,
    }),

  // Database
  databaseError: (originalError?: Error) =>
    new AppError('ERR_2401', 'Database connection failed', {
      retryable: true,
      retryAfter: 1000,
    }),

  // Network
  networkOffline: () =>
    new AppError('ERR_2501', undefined, {
      retryable: true,
      retryAfter: 5000,
    }),

  // Generic
  validationError: (message: string, field?: string) =>
    new AppError('ERR_9905', message, {
      httpStatus: 400,
      data: field ? { field } : undefined,
    }),

  internal: (originalError?: Error) =>
    new AppError('ERR_9901', 'An unexpected error occurred', {
      retryable: true,
      retryAfter: 1000,
    }),
}
```

### API Route Helper

```typescript
// src/lib/api-error-handler.ts

import { NextResponse } from 'next/server'
import { AppError, Errors } from './errors'
import { logError } from './logger'

/**
 * Wrap API route handlers with standard error handling
 */
export function withErrorHandler<T>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  return handler()
    .then((data) => {
      return NextResponse.json({ success: true, data })
    })
    .catch((error) => {
      // Convert to AppError if not already
      const appError = error instanceof AppError
        ? error
        : mapToAppError(error)

      // Log the error
      logError(appError, {
        originalError: error instanceof AppError ? undefined : error,
      })

      // Return standardized response
      const response = appError.toResponse(process.env.NODE_ENV === 'development')

      return NextResponse.json(response, { status: appError.httpStatus })
    })
}

/**
 * Map common errors to AppError
 */
function mapToAppError(error: unknown): AppError {
  if (error instanceof Error) {
    // Prisma errors
    if (error.message.includes('Unique constraint')) {
      return new AppError('ERR_2403', 'A record with this value already exists', {
        httpStatus: 409,
      })
    }

    if (error.message.includes('Foreign key constraint')) {
      return new AppError('ERR_2403', 'Referenced record does not exist', {
        httpStatus: 400,
      })
    }

    if (error.message.includes('deadlock') || error.message.includes('could not serialize')) {
      return new AppError('ERR_2404', undefined, {
        retryable: true,
        retryAfter: 100,
      })
    }

    // Network errors
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
      return Errors.networkOffline()
    }
  }

  return Errors.internal(error instanceof Error ? error : undefined)
}
```

---

## 4. Retry Logic Patterns

### 4.1 Retry Configuration

```typescript
// src/lib/retry.ts

export const RETRY_STRATEGIES = {
  /**
   * Network failures - exponential backoff
   * Delays: 1s, 2s, 4s, 8s, 16s (max 30s)
   */
  network: {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterPercent: 0.3,
  },

  /**
   * Database locks - immediate retry
   * Quick retries for transient locks
   */
  databaseLock: {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 500,
    backoffMultiplier: 1.5,
    jitterPercent: 0.1,
  },

  /**
   * Rate limits - respect Retry-After header
   */
  rateLimit: {
    maxAttempts: 3,
    useRetryAfter: true,
    defaultDelayMs: 60000, // 1 minute if no header
    maxDelayMs: 300000,    // 5 minutes max
  },

  /**
   * Sync operations
   */
  sync: {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterPercent: 0.3,
  },

  /**
   * PAYMENTS - NO AUTOMATIC RETRY
   * Must always be explicit user action
   */
  payment: {
    maxAttempts: 1, // NO RETRY
    retryable: false,
  },

  /**
   * Printer operations
   */
  printer: {
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 10000,
    backoffMultiplier: 1.5,
  },
} as const
```

### 4.2 Exponential Backoff Implementation

```typescript
// src/lib/retry.ts

interface RetryOptions {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitterPercent?: number
  onRetry?: (attempt: number, delay: number, error: Error) => void
  shouldRetry?: (error: Error, attempt: number) => boolean
}

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if we should retry
      if (attempt >= options.maxAttempts) {
        break
      }

      if (options.shouldRetry && !options.shouldRetry(lastError, attempt)) {
        break
      }

      // Calculate delay with exponential backoff
      const baseDelay = options.baseDelayMs *
        Math.pow(options.backoffMultiplier, attempt - 1)

      // Add jitter to prevent thundering herd
      const jitter = options.jitterPercent
        ? (Math.random() * 2 - 1) * options.jitterPercent * baseDelay
        : 0

      const delay = Math.min(baseDelay + jitter, options.maxDelayMs)

      // Notify of retry
      options.onRetry?.(attempt, delay, lastError)

      // Wait before retry
      await sleep(delay)
    }
  }

  throw lastError || new Error('Retry failed')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate retry delay for given attempt
 */
export function calculateRetryDelay(
  attempt: number,
  strategy: keyof typeof RETRY_STRATEGIES
): number {
  const config = RETRY_STRATEGIES[strategy]

  if ('useRetryAfter' in config) {
    return config.defaultDelayMs
  }

  if (!('baseDelayMs' in config)) {
    return 0
  }

  const baseDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1)
  const jitter = config.jitterPercent
    ? Math.random() * config.jitterPercent * baseDelay
    : 0

  return Math.min(baseDelay + jitter, config.maxDelayMs)
}
```

### 4.3 Retry Pattern Examples

#### Network Request with Retry

```typescript
// Example: Fetching data with retry
async function fetchWithRetry(url: string): Promise<Response> {
  return withRetry(
    async () => {
      const response = await fetch(url)
      if (!response.ok && response.status >= 500) {
        throw new Error(`Server error: ${response.status}`)
      }
      return response
    },
    {
      ...RETRY_STRATEGIES.network,
      shouldRetry: (error) => {
        // Only retry on network/server errors
        return error.message.includes('Server error') ||
               error.message.includes('ECONNREFUSED') ||
               error.message.includes('ETIMEDOUT')
      },
      onRetry: (attempt, delay, error) => {
        console.warn(`Retry attempt ${attempt} after ${delay}ms: ${error.message}`)
      },
    }
  )
}
```

#### Database Operation with Immediate Retry

```typescript
// Example: Database operation with deadlock handling
async function saveWithRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  return withRetry(
    operation,
    {
      ...RETRY_STRATEGIES.databaseLock,
      shouldRetry: (error) => {
        // Only retry on lock/deadlock errors
        return error.message.includes('deadlock') ||
               error.message.includes('could not serialize')
      },
    }
  )
}
```

#### Sync Conflict Handling (No Auto-Retry)

```typescript
// Sync conflicts are queued for manual resolution, NOT auto-retried
async function handleSyncConflict(
  local: SyncRecord,
  cloud: SyncRecord
): Promise<void> {
  // Create conflict record for manual resolution
  await db.syncConflict.create({
    data: {
      tableName: local.tableName,
      recordId: local.id,
      localData: local,
      cloudData: cloud,
      status: 'pending',
      createdAt: new Date(),
    }
  })

  // Notify admin
  await notifyAdmin({
    type: 'SYNC_CONFLICT',
    message: `Sync conflict detected for ${local.tableName}:${local.id}`,
    requiresAction: true,
  })

  // Do NOT auto-retry - human must decide
}
```

#### Payment Processing (NEVER Auto-Retry)

```typescript
// CRITICAL: Payments are NEVER automatically retried
async function processPayment(payment: PaymentInput): Promise<PaymentResult> {
  try {
    const result = await paymentProcessor.charge(payment)
    return { success: true, transactionId: result.id }
  } catch (error) {
    // Log for investigation, but NEVER auto-retry
    logError(error, {
      context: 'payment',
      paymentId: payment.id,
      amount: payment.amount,
      // Never log full card number
    })

    // Return failure to user - they must explicitly retry
    throw new AppError('ERR_0301', getPaymentErrorMessage(error), {
      retryable: false, // User can manually retry, but no auto-retry
      data: {
        canRetryManually: true,
        suggestedAction: 'Try a different card or payment method',
      }
    })
  }
}
```

### 4.4 Retry Decision Matrix

| Error Type | Auto-Retry | Max Attempts | Strategy |
|------------|------------|--------------|----------|
| Network timeout | Yes | 5 | Exponential backoff |
| 5xx Server error | Yes | 5 | Exponential backoff |
| 4xx Client error | No | 0 | Fix request |
| Database lock | Yes | 3 | Immediate retry |
| Validation error | No | 0 | Fix input |
| Rate limit | Yes | 3 | Respect Retry-After |
| **Payment failure** | **No** | **0** | **User action** |
| Sync conflict | No | 0 | Manual resolution |
| Auth failure | No | 0 | Re-authenticate |

---

## 5. User-Facing Error Messages

### 5.1 Message Guidelines

**DO:**
- Use plain language, not technical jargon
- Be specific about what happened
- Provide actionable next steps
- Keep messages concise (under 100 characters for toasts)

**DON'T:**
- Expose stack traces or internal errors
- Show database error messages
- Display technical codes (ERR_0201)
- Blame the user

### 5.2 Toast Notifications

For recoverable, non-blocking errors:

```typescript
// src/lib/toast-messages.ts

export const TOAST_MESSAGES = {
  // Auth
  'ERR_0101': {
    title: 'Invalid PIN',
    description: 'Please check your PIN and try again.',
    variant: 'error',
  },
  'ERR_0105': {
    title: 'Permission Denied',
    description: 'Ask a manager for assistance.',
    variant: 'warning',
  },

  // Network
  'ERR_2501': {
    title: 'Connection Lost',
    description: 'Working offline. Changes will sync when connected.',
    variant: 'warning',
  },
  'ERR_2502': {
    title: 'Slow Connection',
    description: 'Request taking longer than expected...',
    variant: 'warning',
  },

  // Orders
  'ERR_0209': {
    title: 'Order Locked',
    description: 'Another user is editing this order. Try again shortly.',
    variant: 'warning',
  },
  'ERR_0210': {
    title: 'Item Unavailable',
    description: 'One or more items are no longer available.',
    variant: 'error',
  },

  // Payments
  'ERR_0307': {
    title: 'Terminal Offline',
    description: 'Payment terminal not responding. Check connection.',
    variant: 'error',
  },
  'ERR_0308': {
    title: 'Terminal Busy',
    description: 'Complete or cancel the current transaction first.',
    variant: 'warning',
  },

  // Hardware
  'ERR_2002': {
    title: 'Printer Offline',
    description: 'Check printer power and connection.',
    variant: 'warning',
  },
  'ERR_2003': {
    title: 'Printer Out of Paper',
    description: 'Please load paper and try again.',
    variant: 'warning',
  },
}
```

### 5.3 Modal Dialogs

For critical errors requiring user action:

```typescript
// src/lib/modal-messages.ts

export const MODAL_MESSAGES = {
  // Payment failures
  'ERR_0302': {
    title: 'Card Declined',
    message: 'The card was declined by the bank.',
    actions: [
      { label: 'Try Different Card', action: 'retry_different' },
      { label: 'Use Cash', action: 'switch_to_cash' },
      { label: 'Cancel', action: 'cancel', variant: 'secondary' },
    ],
  },

  'ERR_0303': {
    title: 'Insufficient Funds',
    message: 'The card doesn\'t have enough funds for this transaction.',
    actions: [
      { label: 'Split Payment', action: 'split' },
      { label: 'Try Different Card', action: 'retry_different' },
      { label: 'Cancel', action: 'cancel', variant: 'secondary' },
    ],
  },

  // Session expired
  'ERR_0104': {
    title: 'Session Expired',
    message: 'For security, you\'ve been logged out due to inactivity.',
    actions: [
      { label: 'Log In Again', action: 'login', variant: 'primary' },
    ],
    blocking: true, // Cannot dismiss
  },

  // Sync conflicts
  'ERR_2206': {
    title: 'Sync Conflict',
    message: 'This record was modified in multiple places. Manager review required.',
    actions: [
      { label: 'Notify Manager', action: 'notify' },
      { label: 'View Details', action: 'details' },
    ],
  },

  // Order locked
  'ERR_0209': {
    title: 'Order In Use',
    message: 'This order is being edited by another user.',
    waitTime: 30000, // Show countdown
    actions: [
      { label: 'Try Again', action: 'retry' },
      { label: 'Cancel', action: 'cancel', variant: 'secondary' },
    ],
  },
}
```

### 5.4 Inline Error Messages

For form validation and field-level errors:

```typescript
// src/lib/inline-messages.ts

export const INLINE_MESSAGES = {
  // Form validation
  required: (fieldName: string) => `${fieldName} is required`,
  minLength: (fieldName: string, min: number) =>
    `${fieldName} must be at least ${min} characters`,
  maxLength: (fieldName: string, max: number) =>
    `${fieldName} cannot exceed ${max} characters`,
  invalidFormat: (fieldName: string) => `Please enter a valid ${fieldName}`,
  numberRange: (fieldName: string, min: number, max: number) =>
    `${fieldName} must be between ${min} and ${max}`,

  // Specific fields
  pin: {
    tooShort: 'PIN must be at least 4 digits',
    invalid: 'PIN can only contain numbers',
    duplicate: 'This PIN is already in use',
  },
  email: {
    invalid: 'Please enter a valid email address',
    duplicate: 'This email is already registered',
  },
  phone: {
    invalid: 'Please enter a valid phone number',
    duplicate: 'This phone number is already registered',
  },
  price: {
    invalid: 'Price must be a positive number',
    tooHigh: 'Price exceeds maximum allowed',
  },
}
```

### 5.5 Offline Indicators

For connectivity and sync status:

```typescript
// src/components/OfflineIndicator.tsx

interface OfflineState {
  isOnline: boolean
  lastSyncAt: Date | null
  pendingChanges: number
  syncStatus: 'idle' | 'syncing' | 'error'
}

export const OFFLINE_MESSAGES = {
  offline: {
    banner: 'You\'re offline. Changes will sync when connected.',
    icon: 'wifi-off',
    color: 'yellow',
  },
  syncing: {
    banner: 'Syncing changes...',
    icon: 'refresh',
    color: 'blue',
  },
  syncError: {
    banner: 'Sync error. Some changes may not be saved.',
    icon: 'alert-triangle',
    color: 'red',
  },
  pendingChanges: (count: number) => ({
    banner: `${count} change${count > 1 ? 's' : ''} waiting to sync`,
    icon: 'clock',
    color: 'yellow',
  }),
}
```

---

## 6. Logging Standards

### 6.1 What to Log

**ALWAYS Log:**

| Field | Description | Example |
|-------|-------------|---------|
| `timestamp` | ISO 8601 format | `2026-01-30T15:30:45.123Z` |
| `level` | Log level | `error`, `warn`, `info`, `debug` |
| `code` | Error code | `ERR_0201` |
| `message` | Error message | `Order not found` |
| `locationId` | Multi-tenant identifier | `loc_abc123` |
| `employeeId` | Who triggered the action | `emp_xyz789` |
| `requestId` | Unique request identifier | `req_a1b2c3d4` |
| `endpoint` | API route | `POST /api/orders` |
| `duration` | Request duration (ms) | `245` |
| `userAgent` | Client info | `GWI-POS/1.0 Terminal/iPad` |

**Contextual Fields:**

| Field | When | Example |
|-------|------|---------|
| `orderId` | Order operations | `ord_123` |
| `paymentId` | Payment operations | `pay_456` |
| `tableId` | Table operations | `tbl_789` |
| `customerId` | Customer operations | `cust_012` |
| `itemId` | Menu operations | `item_345` |
| `syncBatchId` | Sync operations | `batch_678` |

### 6.2 What NOT to Log

**NEVER Log (PCI/Security):**

| Data | Reason | Alternative |
|------|--------|-------------|
| Full card number | PCI DSS violation | Log last 4 only: `****1234` |
| CVV/CVC | PCI DSS violation | Never store or log |
| Card expiry | PCI DSS violation | Don't log |
| Magnetic stripe data | PCI DSS violation | Never capture |
| PINs | Security risk | Log as `[REDACTED]` |
| Passwords | Security risk | Log as `[REDACTED]` |
| Full SSN/Tax ID | PII protection | Log last 4: `***-**-1234` |
| Full bank account | Financial data | Log last 4 |

**Redact in Logs:**

| Data | How to Redact |
|------|---------------|
| Email addresses | `j***@example.com` |
| Phone numbers | `***-***-1234` |
| Gift card numbers | `GC-****-****-****-1234` |
| Pre-auth tokens | `tok_****1234` |

### 6.3 Log Levels

```typescript
// src/lib/logger.ts

export enum LogLevel {
  ERROR = 'error',   // System failures, payment failures, unhandled exceptions
  WARN = 'warn',     // Recoverable issues, deprecation, unusual conditions
  INFO = 'info',     // Business events, audit trail, successful operations
  DEBUG = 'debug',   // Development debugging, verbose data (dev only)
}

// When to use each level
const LOG_LEVEL_GUIDE = {
  error: [
    'Payment processing failures',
    'Database connection failures',
    'Unhandled exceptions',
    'Security violations',
    'Sync failures after all retries',
  ],
  warn: [
    'Payment terminal offline (recoverable)',
    'Printer offline (recoverable)',
    'Rate limit approaching',
    'Deprecated API usage',
    'Unusual data patterns',
  ],
  info: [
    'Order created/paid/closed',
    'Payment processed successfully',
    'Employee clock in/out',
    'Shift opened/closed',
    'Sync completed successfully',
  ],
  debug: [
    'Request/response bodies (dev only)',
    'SQL queries executed',
    'Cache hits/misses',
    'Retry attempts',
    'WebSocket events',
  ],
}
```

### 6.4 Log Entry Structure

```typescript
// src/lib/logger.ts

interface LogEntry {
  // Required fields
  timestamp: string
  level: LogLevel
  message: string
  code?: string

  // Context
  context: {
    locationId?: string
    employeeId?: string
    requestId?: string
    endpoint?: string
  }

  // Error-specific
  error?: {
    code: string
    message: string
    stack?: string // Dev only
  }

  // Performance
  performance?: {
    duration: number
    memory?: number
  }

  // Business data (redacted as needed)
  data?: Record<string, unknown>
}

/**
 * Logger implementation
 */
class Logger {
  private static instance: Logger
  private context: Partial<LogEntry['context']> = {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  /**
   * Set context for all subsequent logs
   */
  setContext(ctx: Partial<LogEntry['context']>): void {
    this.context = { ...this.context, ...ctx }
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {}
  }

  /**
   * Log an error
   */
  error(message: string, error?: Error | AppError, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, {
      error: error ? this.formatError(error) : undefined,
      data: this.redactSensitive(data),
    })
  }

  /**
   * Log a warning
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, {
      data: this.redactSensitive(data),
    })
  }

  /**
   * Log info (audit trail)
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, {
      data: this.redactSensitive(data),
    })
  }

  /**
   * Log debug (dev only)
   */
  debug(message: string, data?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development') {
      this.log(LogLevel.DEBUG, message, {
        data: this.redactSensitive(data),
      })
    }
  }

  private log(level: LogLevel, message: string, extra?: Partial<LogEntry>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: this.context,
      ...extra,
    }

    // Output based on environment
    if (process.env.NODE_ENV === 'production') {
      // Structured JSON for log aggregation
      console.log(JSON.stringify(entry))
    } else {
      // Human-readable for development
      const color = this.getColor(level)
      console.log(
        `${color}[${level.toUpperCase()}]${'\x1b[0m'} ${entry.timestamp} ${message}`,
        extra?.data ? JSON.stringify(extra.data, null, 2) : ''
      )
    }
  }

  private formatError(error: Error | AppError): LogEntry['error'] {
    return {
      code: error instanceof AppError ? error.code : 'ERR_9999',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }
  }

  private redactSensitive(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined

    const redacted = { ...data }
    const sensitiveKeys = [
      'pin', 'password', 'cardNumber', 'cvv', 'cvc',
      'expiry', 'expirationDate', 'ssn', 'taxId',
    ]

    for (const key of Object.keys(redacted)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        redacted[key] = '[REDACTED]'
      }
      // Partial redaction for specific fields
      if (key === 'email' && typeof redacted[key] === 'string') {
        redacted[key] = this.redactEmail(redacted[key] as string)
      }
      if (key === 'phone' && typeof redacted[key] === 'string') {
        redacted[key] = this.redactPhone(redacted[key] as string)
      }
      if (key === 'cardLast4') {
        // This is OK to log as-is
      }
    }

    return redacted
  }

  private redactEmail(email: string): string {
    const [local, domain] = email.split('@')
    return `${local.charAt(0)}***@${domain}`
  }

  private redactPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '')
    return `***-***-${digits.slice(-4)}`
  }

  private getColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.ERROR: return '\x1b[31m' // Red
      case LogLevel.WARN: return '\x1b[33m'  // Yellow
      case LogLevel.INFO: return '\x1b[36m'  // Cyan
      case LogLevel.DEBUG: return '\x1b[90m' // Gray
    }
  }
}

export const logger = Logger.getInstance()
export const logError = (error: Error | AppError, data?: Record<string, unknown>) =>
  logger.error(error.message, error, data)
```

### 6.5 Audit Log Requirements

Business-critical actions require audit logging:

```typescript
// src/lib/audit.ts

type AuditAction =
  | 'login'
  | 'logout'
  | 'order_created'
  | 'order_paid'
  | 'order_voided'
  | 'order_comped'
  | 'payment_processed'
  | 'payment_refunded'
  | 'payment_voided'
  | 'tip_adjusted'
  | 'discount_applied'
  | 'employee_created'
  | 'employee_deactivated'
  | 'role_changed'
  | 'permission_granted'
  | 'permission_revoked'
  | 'shift_started'
  | 'shift_ended'
  | 'drawer_opened'
  | 'no_sale'
  | 'price_override'
  | 'sync_conflict'
  | 'settings_changed'

interface AuditEntry {
  action: AuditAction
  locationId: string
  employeeId: string
  entityType: string
  entityId: string
  beforeData?: Record<string, unknown>
  afterData?: Record<string, unknown>
  reason?: string
  approvedBy?: string
  ipAddress?: string
  deviceId?: string
  timestamp: Date
}

async function createAuditLog(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  await db.auditLog.create({
    data: {
      ...entry,
      timestamp: new Date(),
    }
  })
}
```

---

## 7. Implementation Examples

### 7.1 API Route with Error Handling

```typescript
// src/app/api/orders/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AppError, Errors } from '@/lib/errors'
import { logger } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params

  // Set logging context
  logger.setContext({
    endpoint: `GET /api/orders/${orderId}`,
    requestId: crypto.randomUUID(),
  })

  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: true,
      },
    })

    if (!order) {
      throw Errors.orderNotFound(orderId)
    }

    logger.info('Order retrieved', { orderId })

    return NextResponse.json({
      success: true,
      data: order,
    })
  } catch (error) {
    // Handle known errors
    if (error instanceof AppError) {
      logger.warn(error.message, { code: error.code, orderId })

      return NextResponse.json(
        error.toResponse(process.env.NODE_ENV === 'development'),
        { status: error.httpStatus }
      )
    }

    // Handle unknown errors
    logger.error('Unexpected error fetching order', error as Error, { orderId })

    const internalError = Errors.internal(error as Error)
    return NextResponse.json(
      internalError.toResponse(process.env.NODE_ENV === 'development'),
      { status: 500 }
    )
  } finally {
    logger.clearContext()
  }
}
```

### 7.2 React Component with Error Handling

```typescript
// src/components/OrderPayment.tsx

import { useState } from 'react'
import { useToast } from '@/hooks/useToast'
import { useErrorModal } from '@/hooks/useErrorModal'
import { TOAST_MESSAGES, MODAL_MESSAGES } from '@/lib/error-messages'

export function OrderPayment({ orderId }: { orderId: string }) {
  const [isProcessing, setIsProcessing] = useState(false)
  const { showToast } = useToast()
  const { showErrorModal } = useErrorModal()

  async function handlePayment(paymentData: PaymentInput) {
    setIsProcessing(true)

    try {
      const response = await fetch(`/api/orders/${orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentData),
      })

      const result = await response.json()

      if (!result.success) {
        handlePaymentError(result.error)
        return
      }

      showToast({
        title: 'Payment Complete',
        description: 'Transaction processed successfully.',
        variant: 'success',
      })

      // Navigate to receipt or next order
      onPaymentSuccess(result.data)

    } catch (error) {
      // Network error
      showToast({
        ...TOAST_MESSAGES['ERR_2501'],
      })
    } finally {
      setIsProcessing(false)
    }
  }

  function handlePaymentError(error: ErrorResponse['error']) {
    const { code } = error

    // Check if this error needs a modal
    if (MODAL_MESSAGES[code]) {
      showErrorModal({
        ...MODAL_MESSAGES[code],
        onAction: (action) => handleModalAction(action, error),
      })
      return
    }

    // Fall back to toast
    if (TOAST_MESSAGES[code]) {
      showToast(TOAST_MESSAGES[code])
      return
    }

    // Generic error toast
    showToast({
      title: 'Payment Failed',
      description: error.message,
      variant: 'error',
    })
  }

  function handleModalAction(action: string, error: ErrorResponse['error']) {
    switch (action) {
      case 'retry_different':
        // Open card selection
        break
      case 'switch_to_cash':
        // Switch to cash payment
        break
      case 'split':
        // Open split payment dialog
        break
      case 'cancel':
        // Do nothing
        break
    }
  }

  return (
    // Component JSX
  )
}
```

### 7.3 Zustand Store with Error State

```typescript
// src/stores/orderStore.ts

import { create } from 'zustand'
import { AppError } from '@/lib/errors'

interface OrderStore {
  orders: Order[]
  isLoading: boolean
  error: AppError | null

  fetchOrders: (locationId: string) => Promise<void>
  clearError: () => void
}

export const useOrderStore = create<OrderStore>((set, get) => ({
  orders: [],
  isLoading: false,
  error: null,

  fetchOrders: async (locationId: string) => {
    set({ isLoading: true, error: null })

    try {
      const response = await fetch(`/api/orders?locationId=${locationId}`)
      const result = await response.json()

      if (!result.success) {
        const error = new AppError(
          result.error.code,
          result.error.message,
          {
            retryable: result.error.retryable,
            retryAfter: result.error.retryAfter,
          }
        )
        set({ error, isLoading: false })
        return
      }

      set({ orders: result.data.orders, isLoading: false })

    } catch (error) {
      set({
        error: new AppError('ERR_2501', 'Failed to load orders'),
        isLoading: false,
      })
    }
  },

  clearError: () => set({ error: null }),
}))
```

---

## 8. Error Recovery Workflows

### 8.1 Payment Failure Recovery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PAYMENT FAILURE RECOVERY FLOW                           │
└─────────────────────────────────────────────────────────────────────────────┘

Payment fails
     │
     ▼
┌──────────────────┐
│ Display error    │
│ modal with code  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    ERROR TYPE DETERMINES OPTIONS                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ERR_0302 (Card Declined)     ERR_0303 (Insufficient Funds)          │
│  ┌────────────────────┐       ┌────────────────────┐                 │
│  │ • Try Different    │       │ • Split Payment    │                 │
│  │   Card             │       │ • Try Different    │                 │
│  │ • Use Cash         │       │   Card             │                 │
│  │ • Cancel           │       │ • Cancel           │                 │
│  └────────────────────┘       └────────────────────┘                 │
│                                                                        │
│  ERR_0307 (Terminal Offline)  ERR_0309 (Terminal Timeout)            │
│  ┌────────────────────┐       ┌────────────────────┐                 │
│  │ • Retry (auto 5s)  │       │ • Retry            │                 │
│  │ • Use Cash         │       │ • Use Cash         │                 │
│  │ • Manual Entry     │       │ • Cancel           │                 │
│  └────────────────────┘       └────────────────────┘                 │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘

IMPORTANT: User must ALWAYS take explicit action for payment retry.
           Never auto-retry payment transactions.
```

### 8.2 Sync Conflict Resolution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SYNC CONFLICT RESOLUTION FLOW                          │
└─────────────────────────────────────────────────────────────────────────────┘

Conflict detected during sync
     │
     ▼
┌──────────────────┐
│ Classify         │
│ conflict type    │
└────────┬─────────┘
         │
    ┌────┴────┬─────────────┬─────────────────┐
    │         │             │                 │
    ▼         ▼             ▼                 ▼
┌────────┐ ┌────────┐  ┌────────┐       ┌────────┐
│FINANCIAL│ │REFERENCE│ │CUSTOMER│       │GENERAL │
│(Orders, │ │(Menu,   │ │(Loyalty│       │        │
│Payments)│ │Settings)│ │Profile)│       │        │
└────┬────┘ └────┬────┘ └────┬────┘      └────┬────┘
     │           │           │                │
     ▼           ▼           ▼                ▼
┌──────────┐ ┌──────────┐ ┌──────────┐  ┌──────────┐
│ LOCAL    │ │ CLOUD    │ │ FIELD    │  │ LWW      │
│ WINS     │ │ WINS     │ │ MERGE    │  │(timestamp)│
│(immutable│ │(admin is │ │(additive │  │          │
│financial)│ │ source)  │ │ loyalty) │  │          │
└──────────┘ └────┬─────┘ └──────────┘  └──────────┘
                  │
                  ▼
            ┌──────────┐
            │ Alert    │
            │ User of  │
            │ Override │
            └──────────┘

If ERR_2206 (Conflict Unresolvable):
  → Queue for manual resolution
  → Notify admin via UI and email
  → Do NOT auto-resolve
```

### 8.3 Offline Recovery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OFFLINE RECOVERY FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

Connection lost (ERR_2501)
     │
     ▼
┌──────────────────┐
│ Show offline     │
│ banner indicator │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    OFFLINE OPERATION RULES                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ✅ ALLOWED OFFLINE:              ❌ NOT ALLOWED OFFLINE:             │
│  ┌────────────────────┐          ┌────────────────────┐              │
│  │ • Create orders    │          │ • Card payments    │              │
│  │ • Add items        │          │   (over limit)     │              │
│  │ • Cash payments    │          │ • Sync to cloud    │              │
│  │ • Clock in/out     │          │ • Real-time KDS    │              │
│  │ • Print tickets    │          │ • Event tickets    │              │
│  │   (local printer)  │          │   (real-time)      │              │
│  └────────────────────┘          └────────────────────┘              │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
         │
         │ Connection restored
         ▼
┌──────────────────┐
│ Background sync  │
│ begins           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐      ┌──────────────────┐
│ Sync successful  │──────│ Update banner:   │
│                  │      │ "All synced ✓"   │
└──────────────────┘      └──────────────────┘
         │
         │ (If sync errors)
         ▼
┌──────────────────┐      ┌──────────────────┐
│ Partial sync     │──────│ Show "X pending" │
│                  │      │ indicator        │
└──────────────────┘      └──────────────────┘
```

---

## Appendix A: Quick Reference

### Error Response Template

```json
{
  "success": false,
  "error": {
    "code": "ERR_XXYY",
    "message": "User-friendly message",
    "retryable": false,
    "retryAfter": 5000,
    "data": {
      "field": "email",
      "value": "invalid"
    }
  }
}
```

### HTTP Status Code Mapping

| Error Category | HTTP Status |
|----------------|-------------|
| Validation (ERR_*) | 400 |
| Auth required (ERR_01*) | 401 |
| Permission denied (ERR_0105) | 403 |
| Not found (ERR_*01) | 404 |
| Payment required (ERR_03*) | 402 |
| Conflict/Duplicate (ERR_*) | 409 |
| Rate limited (ERR_2504) | 429 |
| Server error (ERR_99*) | 500 |
| Service unavailable | 503 |

### Retry Decision Quick Check

```typescript
function shouldAutoRetry(code: string): boolean {
  // NEVER auto-retry payments
  if (code.startsWith('ERR_03')) return false

  // NEVER auto-retry conflicts
  if (code === 'ERR_2206') return false

  // Check if retryable
  return ERROR_CODES[code]?.retryable ?? false
}
```

---

*This document is the error handling source of truth for GWI POS.*
*Last Updated: January 30, 2026*
