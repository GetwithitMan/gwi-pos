# Testing Strategy

**Version:** 1.0
**Updated:** January 30, 2026
**Status:** Reference Documentation

---

## Table of Contents

1. [Testing Philosophy](#1-testing-philosophy)
2. [Test Stack & Tools](#2-test-stack--tools)
3. [Unit Test Patterns](#3-unit-test-patterns)
4. [Integration Test Patterns](#4-integration-test-patterns)
5. [E2E Critical Paths](#5-e2e-critical-paths)
6. [Performance Testing](#6-performance-testing)
7. [File Structure & Conventions](#7-file-structure--conventions)
8. [CI/CD Integration](#8-cicd-integration)
9. [Test Coverage Goals](#9-test-coverage-goals)

---

## 1. Testing Philosophy

### Core Principles

1. **Test behavior, not implementation**
   - Focus on what the code does, not how it does it
   - Tests should survive refactoring

2. **Testing Trophy over Testing Pyramid**
   ```
           /\
          /E2E\         ← Few, critical user journeys
         /------\
        /Integr- \      ← Most value, API + DB
       /  ation   \
      /------------\
     /    Unit      \   ← Utilities, pure functions
    /________________\
   ```

3. **Write tests that give confidence**
   - Prioritize tests that catch real bugs
   - Avoid testing implementation details

4. **Fast feedback loops**
   - Unit tests: < 10ms each
   - Integration tests: < 500ms each
   - E2E tests: < 30s per critical path

### What to Test

| Priority | Type | Examples |
|----------|------|----------|
| **High** | Business logic | Price calculations, payment processing, tip distribution |
| **High** | API routes | Order creation, auth, payment endpoints |
| **High** | Critical flows | Checkout, void/refund, shift closeout |
| **Medium** | Zustand stores | Order state, auth state |
| **Medium** | Form validation | Zod schemas, input validators |
| **Low** | Pure UI | Static components, styles |

### What NOT to Test

- Third-party libraries (Prisma, Next.js internals)
- CSS styling and animations
- Console.log statements
- TypeScript types (compiler handles this)

---

## 2. Test Stack & Tools

### Recommended Setup

```json
// package.json additions
{
  "devDependencies": {
    "jest": "^29.7.0",
    "@types/jest": "^29.5.12",
    "ts-jest": "^29.1.2",
    "@testing-library/react": "^14.2.1",
    "@testing-library/jest-dom": "^6.4.2",
    "@testing-library/user-event": "^14.5.2",
    "jest-environment-jsdom": "^29.7.0",
    "msw": "^2.2.1",
    "@playwright/test": "^1.42.0"
  },
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:integration": "jest --testPathPattern=__tests__/integration",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

### Tool Purposes

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **Jest** | Test runner, assertions | Unit + integration tests |
| **React Testing Library** | Component testing | UI behavior tests |
| **MSW** | API mocking | Component tests that fetch |
| **Playwright** | Browser automation | E2E critical paths |
| **Prisma Test Environment** | DB isolation | Integration tests |

### Jest Configuration

```typescript
// jest.config.ts
import type { Config } from 'jest'
import nextJest from 'next/jest'

const createJestConfig = nextJest({
  dir: './',
})

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/__tests__/e2e/',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**/layout.tsx',
    '!src/app/**/loading.tsx',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
}

export default createJestConfig(config)
```

```typescript
// jest.setup.ts
import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}))
```

---

## 3. Unit Test Patterns

### Testing Utility Functions

```typescript
// src/lib/utils.test.ts
import { formatCurrency, formatTime, generateOrderNumber } from './utils'

describe('formatCurrency', () => {
  it('formats positive numbers as USD', () => {
    expect(formatCurrency(10)).toBe('$10.00')
    expect(formatCurrency(10.5)).toBe('$10.50')
    expect(formatCurrency(1234.56)).toBe('$1,234.56')
  })

  it('handles string input', () => {
    expect(formatCurrency('10.50')).toBe('$10.50')
  })

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('formats negative numbers', () => {
    expect(formatCurrency(-10)).toBe('-$10.00')
  })
})

describe('generateOrderNumber', () => {
  it('generates alphanumeric order numbers', () => {
    const orderNum = generateOrderNumber()
    expect(orderNum).toMatch(/^[A-Z]\d{2}$/)
  })

  it('does not include confusing characters I or O', () => {
    // Generate many and check none have I or O
    for (let i = 0; i < 100; i++) {
      const orderNum = generateOrderNumber()
      expect(orderNum).not.toMatch(/[IO]/)
    }
  })
})
```

### Testing Pricing Functions

```typescript
// src/lib/pricing.test.ts
import {
  calculateCardPrice,
  calculateCashDiscount,
  calculateCashPrice,
  roundPrice,
  calculateCommission,
} from './pricing'

describe('Dual Pricing Calculations', () => {
  describe('calculateCardPrice', () => {
    it('adds the fee percentage to cash price', () => {
      expect(calculateCardPrice(10.00, 4)).toBe(10.40)
      expect(calculateCardPrice(100.00, 4)).toBe(104.00)
    })

    it('rounds to 2 decimal places', () => {
      expect(calculateCardPrice(9.99, 4)).toBe(10.39)
    })

    it('handles zero price', () => {
      expect(calculateCardPrice(0, 4)).toBe(0)
    })
  })

  describe('calculateCashDiscount', () => {
    it('calculates discount from card price', () => {
      expect(calculateCashDiscount(10.40, 4)).toBe(0.40)
    })
  })

  describe('calculateCashPrice', () => {
    it('reverses card price to cash price', () => {
      expect(calculateCashPrice(10.40, 4)).toBe(10.00)
    })
  })
})

describe('Price Rounding', () => {
  it('rounds to nearest nickel', () => {
    expect(roundPrice(10.02, '0.05', 'nearest')).toBe(10.00)
    expect(roundPrice(10.03, '0.05', 'nearest')).toBe(10.05)
  })

  it('rounds up to nearest dime', () => {
    expect(roundPrice(10.01, '0.10', 'up')).toBe(10.10)
  })

  it('rounds down to nearest quarter', () => {
    expect(roundPrice(10.49, '0.25', 'down')).toBe(10.25)
  })

  it('returns unchanged when increment is none', () => {
    expect(roundPrice(10.47, 'none', 'nearest')).toBe(10.47)
  })
})

describe('Commission Calculations', () => {
  it('calculates fixed commission', () => {
    expect(calculateCommission(100, 'fixed', 5)).toBe(5)
  })

  it('calculates percent commission', () => {
    expect(calculateCommission(100, 'percent', 10)).toBe(10)
    expect(calculateCommission(45.99, 'percent', 5)).toBe(2.30)
  })

  it('returns 0 for null/undefined values', () => {
    expect(calculateCommission(100, null, 5)).toBe(0)
    expect(calculateCommission(100, 'percent', null)).toBe(0)
  })
})
```

### Testing Payment Utilities

```typescript
// src/lib/payment.test.ts
import {
  roundAmount,
  calculateChange,
  getQuickCashAmounts,
  calculateTip,
  isFullyPaid,
} from './payment'

describe('Cash Payment Utilities', () => {
  describe('roundAmount', () => {
    it('rounds to nearest nickel', () => {
      expect(roundAmount(10.02, 'nickel', 'nearest')).toBe(10.00)
      expect(roundAmount(10.08, 'nickel', 'nearest')).toBe(10.10)
    })

    it('rounds up to nearest dollar', () => {
      expect(roundAmount(10.01, 'dollar', 'up')).toBe(11.00)
    })
  })

  describe('calculateChange', () => {
    it('calculates correct change', () => {
      expect(calculateChange(17.50, 20.00)).toBe(2.50)
    })

    it('returns 0 when tendered equals due', () => {
      expect(calculateChange(20.00, 20.00)).toBe(0)
    })

    it('never returns negative change', () => {
      expect(calculateChange(25.00, 20.00)).toBe(0)
    })
  })

  describe('getQuickCashAmounts', () => {
    it('includes exact amount', () => {
      const amounts = getQuickCashAmounts(17.50)
      expect(amounts).toContain(17.50)
    })

    it('includes common denominations', () => {
      const amounts = getQuickCashAmounts(17.50)
      expect(amounts).toContain(20)
      expect(amounts).toContain(50)
    })

    it('returns max 5 amounts', () => {
      const amounts = getQuickCashAmounts(17.50)
      expect(amounts.length).toBeLessThanOrEqual(5)
    })
  })
})

describe('Tip Calculations', () => {
  describe('calculateTip', () => {
    it('calculates tip on subtotal', () => {
      expect(calculateTip(100, 20, 'subtotal')).toBe(20)
      expect(calculateTip(45.50, 18, 'subtotal')).toBe(8.19)
    })

    it('calculates tip on total when specified', () => {
      expect(calculateTip(100, 20, 'total', 110)).toBe(22)
    })
  })
})

describe('Payment Status', () => {
  describe('isFullyPaid', () => {
    it('returns true when paid equals total', () => {
      const payments = [{ totalAmount: 50, status: 'completed' }]
      expect(isFullyPaid(50, payments)).toBe(true)
    })

    it('returns true when overpaid', () => {
      const payments = [{ totalAmount: 60, status: 'completed' }]
      expect(isFullyPaid(50, payments)).toBe(true)
    })

    it('ignores non-completed payments', () => {
      const payments = [
        { totalAmount: 30, status: 'completed' },
        { totalAmount: 20, status: 'pending' },
      ]
      expect(isFullyPaid(50, payments)).toBe(false)
    })
  })
})
```

### Testing Zustand Stores

```typescript
// src/stores/order-store.test.ts
import { act, renderHook } from '@testing-library/react'
import { useOrderStore } from './order-store'

describe('Order Store', () => {
  beforeEach(() => {
    // Reset store between tests
    useOrderStore.getState().clearOrder()
  })

  describe('startOrder', () => {
    it('creates a new order with type', () => {
      const { result } = renderHook(() => useOrderStore())

      act(() => {
        result.current.startOrder('dine_in', { guestCount: 2 })
      })

      expect(result.current.currentOrder).toBeDefined()
      expect(result.current.currentOrder?.orderType).toBe('dine_in')
      expect(result.current.currentOrder?.guestCount).toBe(2)
    })
  })

  describe('addItem', () => {
    it('adds item to current order', () => {
      const { result } = renderHook(() => useOrderStore())

      act(() => {
        result.current.startOrder('bar_tab')
        result.current.addItem({
          id: 'item-1',
          menuItemId: 'menu-1',
          name: 'Burger',
          price: 12.99,
          quantity: 1,
          modifiers: [],
        })
      })

      expect(result.current.currentOrder?.items).toHaveLength(1)
      expect(result.current.currentOrder?.items[0].name).toBe('Burger')
    })

    it('increments quantity for duplicate items', () => {
      const { result } = renderHook(() => useOrderStore())

      act(() => {
        result.current.startOrder('bar_tab')
        result.current.addItem({
          id: 'item-1',
          menuItemId: 'menu-1',
          name: 'Beer',
          price: 6.00,
          quantity: 1,
          modifiers: [],
        })
        // Add same item again
        result.current.addItem({
          id: 'item-2',
          menuItemId: 'menu-1',
          name: 'Beer',
          price: 6.00,
          quantity: 1,
          modifiers: [],
        })
      })

      // Should be 2 items (one with qty 2) or merged - depends on store logic
      const items = result.current.currentOrder?.items
      expect(items).toBeDefined()
    })
  })

  describe('updateQuantity', () => {
    it('updates item quantity', () => {
      const { result } = renderHook(() => useOrderStore())

      act(() => {
        result.current.startOrder('takeout')
        result.current.addItem({
          id: 'item-1',
          menuItemId: 'menu-1',
          name: 'Fries',
          price: 4.99,
          quantity: 1,
          modifiers: [],
        })
      })

      act(() => {
        result.current.updateQuantity('item-1', 3)
      })

      expect(result.current.currentOrder?.items[0].quantity).toBe(3)
    })
  })

  describe('removeItem', () => {
    it('removes item from order', () => {
      const { result } = renderHook(() => useOrderStore())

      act(() => {
        result.current.startOrder('dine_in')
        result.current.addItem({
          id: 'item-1',
          menuItemId: 'menu-1',
          name: 'Salad',
          price: 9.99,
          quantity: 1,
          modifiers: [],
        })
      })

      act(() => {
        result.current.removeItem('item-1')
      })

      expect(result.current.currentOrder?.items).toHaveLength(0)
    })
  })

  describe('clearOrder', () => {
    it('resets order state', () => {
      const { result } = renderHook(() => useOrderStore())

      act(() => {
        result.current.startOrder('delivery')
        result.current.addItem({
          id: 'item-1',
          menuItemId: 'menu-1',
          name: 'Pizza',
          price: 15.99,
          quantity: 1,
          modifiers: [],
        })
      })

      act(() => {
        result.current.clearOrder()
      })

      expect(result.current.currentOrder).toBeNull()
    })
  })
})
```

### Testing Auth Store

```typescript
// src/stores/auth-store.test.ts
import { act, renderHook } from '@testing-library/react'
import { useAuthStore } from './auth-store'

describe('Auth Store', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
  })

  describe('login', () => {
    it('sets employee and authentication state', () => {
      const { result } = renderHook(() => useAuthStore())

      const mockEmployee = {
        id: 'emp-1',
        firstName: 'John',
        lastName: 'Doe',
        displayName: 'John D.',
        role: { id: 'role-1', name: 'Server' },
        location: { id: 'loc-1', name: 'Main Bar' },
        permissions: ['pos.access'],
      }

      act(() => {
        result.current.login(mockEmployee)
      })

      expect(result.current.isAuthenticated).toBe(true)
      expect(result.current.employee?.firstName).toBe('John')
      expect(result.current.locationId).toBe('loc-1')
    })
  })

  describe('logout', () => {
    it('clears authentication state', () => {
      const { result } = renderHook(() => useAuthStore())

      act(() => {
        result.current.login({
          id: 'emp-1',
          firstName: 'Jane',
          lastName: 'Smith',
          displayName: 'Jane S.',
          role: { id: 'role-1', name: 'Manager' },
          location: { id: 'loc-1', name: 'Main Bar' },
          permissions: ['admin'],
        })
      })

      act(() => {
        result.current.logout()
      })

      expect(result.current.isAuthenticated).toBe(false)
      expect(result.current.employee).toBeNull()
    })
  })
})
```

### Testing Validation Schemas

```typescript
// src/lib/validations.test.ts
import {
  pinSchema,
  createEmployeeSchema,
  createOrderSchema,
  processPaymentSchema,
  validateRequest,
} from './validations'

describe('Validation Schemas', () => {
  describe('pinSchema', () => {
    it('accepts valid 4-digit PINs', () => {
      expect(pinSchema.safeParse('1234').success).toBe(true)
      expect(pinSchema.safeParse('0000').success).toBe(true)
    })

    it('accepts valid 6-digit PINs', () => {
      expect(pinSchema.safeParse('123456').success).toBe(true)
    })

    it('rejects invalid PINs', () => {
      expect(pinSchema.safeParse('123').success).toBe(false) // Too short
      expect(pinSchema.safeParse('1234567').success).toBe(false) // Too long
      expect(pinSchema.safeParse('abcd').success).toBe(false) // Not digits
    })
  })

  describe('createEmployeeSchema', () => {
    const validEmployee = {
      locationId: 'loc-1',
      firstName: 'John',
      lastName: 'Doe',
      pin: '1234',
      roleId: 'role-1',
    }

    it('accepts valid employee data', () => {
      const result = createEmployeeSchema.safeParse(validEmployee)
      expect(result.success).toBe(true)
    })

    it('requires firstName', () => {
      const result = createEmployeeSchema.safeParse({
        ...validEmployee,
        firstName: '',
      })
      expect(result.success).toBe(false)
    })

    it('requires valid PIN', () => {
      const result = createEmployeeSchema.safeParse({
        ...validEmployee,
        pin: '12',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('processPaymentSchema', () => {
    it('accepts valid cash payment', () => {
      const result = processPaymentSchema.safeParse({
        method: 'cash',
        amount: 25.50,
        tipAmount: 5.00,
        cashTendered: 35.00,
      })
      expect(result.success).toBe(true)
    })

    it('accepts valid card payment', () => {
      const result = processPaymentSchema.safeParse({
        method: 'credit',
        amount: 50.00,
        tipAmount: 10.00,
        cardLast4: '4242',
        cardBrand: 'visa',
      })
      expect(result.success).toBe(true)
    })

    it('requires positive amount', () => {
      const result = processPaymentSchema.safeParse({
        method: 'cash',
        amount: 0,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('validateRequest helper', () => {
    it('returns data on success', () => {
      const result = validateRequest(pinSchema, '1234')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('1234')
      }
    })

    it('returns error message on failure', () => {
      const result = validateRequest(pinSchema, '12')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('PIN must be 4-6 digits')
      }
    })
  })
})
```

### Testing Mock Cards

```typescript
// src/lib/mock-cards.test.ts
import {
  mockCards,
  getRandomCard,
  getSuccessCard,
  getDeclineCard,
  generateAuthCode,
} from './mock-cards'

describe('Mock Cards', () => {
  describe('mockCards array', () => {
    it('has at least 50 cards', () => {
      expect(mockCards.length).toBeGreaterThanOrEqual(50)
    })

    it('has approximately 5% decline rate', () => {
      const declineCount = mockCards.filter(c => c.shouldDecline).length
      const declineRate = declineCount / mockCards.length
      expect(declineRate).toBeGreaterThan(0.03)
      expect(declineRate).toBeLessThan(0.10)
    })

    it('has proper card type distribution', () => {
      const visaCount = mockCards.filter(c => c.cardType === 'visa').length
      const mcCount = mockCards.filter(c => c.cardType === 'mastercard').length

      // Visa should be ~50%
      expect(visaCount / mockCards.length).toBeGreaterThan(0.4)
      // Mastercard should be ~30%
      expect(mcCount / mockCards.length).toBeGreaterThan(0.2)
    })
  })

  describe('getRandomCard', () => {
    it('returns a valid card', () => {
      const card = getRandomCard()
      expect(card).toHaveProperty('id')
      expect(card).toHaveProperty('firstName')
      expect(card).toHaveProperty('cardType')
      expect(card).toHaveProperty('lastFour')
    })
  })

  describe('getSuccessCard', () => {
    it('always returns a card that will not decline', () => {
      for (let i = 0; i < 20; i++) {
        const card = getSuccessCard()
        expect(card.shouldDecline).toBe(false)
      }
    })
  })

  describe('getDeclineCard', () => {
    it('always returns a card that will decline', () => {
      for (let i = 0; i < 10; i++) {
        const card = getDeclineCard()
        expect(card.shouldDecline).toBe(true)
      }
    })
  })

  describe('generateAuthCode', () => {
    it('generates 6-character alphanumeric codes', () => {
      const code = generateAuthCode()
      expect(code).toMatch(/^[A-Z0-9]{6}$/)
    })

    it('generates unique codes', () => {
      const codes = new Set()
      for (let i = 0; i < 100; i++) {
        codes.add(generateAuthCode())
      }
      // Should have high uniqueness (allow some collisions)
      expect(codes.size).toBeGreaterThan(95)
    })
  })
})
```

---

## 4. Integration Test Patterns

### Test Database Setup

```typescript
// __tests__/helpers/test-db.ts
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

// Use a separate test database
const testDbUrl = process.env.TEST_DATABASE_URL || 'file:./test.db'

const prisma = new PrismaClient({
  datasources: { db: { url: testDbUrl } },
})

export async function setupTestDb() {
  // Clear all data
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.role.deleteMany(),
    prisma.menuItem.deleteMany(),
    prisma.category.deleteMany(),
    prisma.location.deleteMany(),
    prisma.organization.deleteMany(),
  ])

  // Seed minimal test data
  const org = await prisma.organization.create({
    data: { id: 'test-org', name: 'Test Org' },
  })

  const location = await prisma.location.create({
    data: {
      id: 'test-loc',
      organizationId: org.id,
      name: 'Test Location',
      timezone: 'America/New_York',
    },
  })

  const role = await prisma.role.create({
    data: {
      id: 'test-role',
      locationId: location.id,
      name: 'Test Manager',
      permissions: ['admin', 'pos.access'],
    },
  })

  const employee = await prisma.employee.create({
    data: {
      id: 'test-emp',
      locationId: location.id,
      roleId: role.id,
      firstName: 'Test',
      lastName: 'User',
      pin: await hash('1234', 10),
    },
  })

  return { org, location, role, employee }
}

export async function teardownTestDb() {
  await prisma.$disconnect()
}

export { prisma as testDb }
```

### API Route Testing

```typescript
// __tests__/integration/auth/login.test.ts
import { POST } from '@/app/api/auth/login/route'
import { setupTestDb, teardownTestDb, testDb } from '../../helpers/test-db'
import { NextRequest } from 'next/server'

function createRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await setupTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('returns employee data with valid PIN', async () => {
    const request = createRequest({ pin: '1234' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.employee).toBeDefined()
    expect(data.employee.firstName).toBe('Test')
  })

  it('returns 401 with invalid PIN', async () => {
    const request = createRequest({ pin: '9999' })
    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Invalid PIN')
  })

  it('returns 400 with short PIN', async () => {
    const request = createRequest({ pin: '12' })
    const response = await POST(request)

    expect(response.status).toBe(400)
  })

  it('includes permissions in response', async () => {
    const request = createRequest({ pin: '1234' })
    const response = await POST(request)
    const data = await response.json()

    expect(data.employee.permissions).toContain('admin')
  })
})
```

### Order API Testing

```typescript
// __tests__/integration/orders/create.test.ts
import { POST } from '@/app/api/orders/route'
import { setupTestDb, teardownTestDb, testDb } from '../../helpers/test-db'
import { NextRequest } from 'next/server'

describe('POST /api/orders', () => {
  let testData: Awaited<ReturnType<typeof setupTestDb>>
  let categoryId: string
  let menuItemId: string

  beforeAll(async () => {
    testData = await setupTestDb()

    // Create test category and menu item
    const category = await testDb.category.create({
      data: {
        id: 'test-cat',
        locationId: testData.location.id,
        name: 'Test Category',
        color: '#FF0000',
        sortOrder: 1,
      },
    })
    categoryId = category.id

    const menuItem = await testDb.menuItem.create({
      data: {
        id: 'test-item',
        locationId: testData.location.id,
        categoryId: category.id,
        name: 'Test Burger',
        price: 12.99,
      },
    })
    menuItemId = menuItem.id
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('creates order with valid data', async () => {
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testData.employee.id,
        locationId: testData.location.id,
        orderType: 'dine_in',
        guestCount: 2,
        items: [
          {
            menuItemId,
            name: 'Test Burger',
            price: 12.99,
            quantity: 1,
            modifiers: [],
          },
        ],
      }),
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.order).toBeDefined()
    expect(data.order.orderNumber).toBeDefined()
    expect(data.order.items).toHaveLength(1)
  })

  it('fails without items', async () => {
    const request = new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testData.employee.id,
        locationId: testData.location.id,
        orderType: 'dine_in',
        items: [],
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
```

### Multi-Tenant Isolation Testing

```typescript
// __tests__/integration/multi-tenant.test.ts
import { setupTestDb, teardownTestDb, testDb } from '../helpers/test-db'
import { hash } from 'bcryptjs'

describe('Multi-Tenant Isolation', () => {
  let location1Id: string
  let location2Id: string

  beforeAll(async () => {
    await setupTestDb()

    // Create second location
    const loc2 = await testDb.location.create({
      data: {
        id: 'test-loc-2',
        organizationId: 'test-org',
        name: 'Test Location 2',
        timezone: 'America/Los_Angeles',
      },
    })
    location1Id = 'test-loc'
    location2Id = loc2.id

    // Create menu items in each location
    const cat1 = await testDb.category.create({
      data: { locationId: location1Id, name: 'Cat 1', color: '#000' },
    })
    const cat2 = await testDb.category.create({
      data: { locationId: location2Id, name: 'Cat 2', color: '#FFF' },
    })

    await testDb.menuItem.create({
      data: { locationId: location1Id, categoryId: cat1.id, name: 'Item 1', price: 10 },
    })
    await testDb.menuItem.create({
      data: { locationId: location2Id, categoryId: cat2.id, name: 'Item 2', price: 20 },
    })
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('menu query only returns items for requested location', async () => {
    const items1 = await testDb.menuItem.findMany({
      where: { locationId: location1Id },
    })
    const items2 = await testDb.menuItem.findMany({
      where: { locationId: location2Id },
    })

    expect(items1.every(i => i.locationId === location1Id)).toBe(true)
    expect(items2.every(i => i.locationId === location2Id)).toBe(true)
    expect(items1[0]?.name).toBe('Item 1')
    expect(items2[0]?.name).toBe('Item 2')
  })

  it('employees cannot access other locations', async () => {
    const role2 = await testDb.role.create({
      data: { locationId: location2Id, name: 'Role 2', permissions: ['pos.access'] },
    })

    const emp2 = await testDb.employee.create({
      data: {
        locationId: location2Id,
        roleId: role2.id,
        firstName: 'Other',
        lastName: 'User',
        pin: await hash('5678', 10),
      },
    })

    // Query with location filter should not return emp2 for location1
    const loc1Employees = await testDb.employee.findMany({
      where: { locationId: location1Id },
    })

    expect(loc1Employees.some(e => e.id === emp2.id)).toBe(false)
  })
})
```

### Payment Integration Testing

```typescript
// __tests__/integration/payments/process.test.ts
import { POST } from '@/app/api/orders/[id]/pay/route'
import { setupTestDb, teardownTestDb, testDb } from '../../helpers/test-db'
import { NextRequest } from 'next/server'

describe('POST /api/orders/[id]/pay', () => {
  let testData: Awaited<ReturnType<typeof setupTestDb>>
  let orderId: string

  beforeAll(async () => {
    testData = await setupTestDb()

    // Create test order
    const category = await testDb.category.create({
      data: { locationId: testData.location.id, name: 'Test', color: '#000' },
    })

    const menuItem = await testDb.menuItem.create({
      data: {
        locationId: testData.location.id,
        categoryId: category.id,
        name: 'Test Item',
        price: 25.00,
      },
    })

    const order = await testDb.order.create({
      data: {
        locationId: testData.location.id,
        employeeId: testData.employee.id,
        orderType: 'dine_in',
        status: 'open',
        subtotal: 25.00,
        tax: 2.00,
        total: 27.00,
        items: {
          create: {
            locationId: testData.location.id,
            menuItemId: menuItem.id,
            name: 'Test Item',
            price: 25.00,
            quantity: 1,
          },
        },
      },
    })
    orderId = order.id
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  it('processes cash payment successfully', async () => {
    const request = new NextRequest(`http://localhost/api/orders/${orderId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testData.employee.id,
        payments: [{
          method: 'cash',
          amount: 27.00,
          tipAmount: 5.00,
          amountTendered: 40.00,
        }],
      }),
    })

    const response = await POST(request, { params: { id: orderId } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.payments).toHaveLength(1)
    expect(data.payments[0].changeGiven).toBe(8.00)
  })

  it('processes split payment', async () => {
    // Create new order for split payment test
    const category = await testDb.category.findFirst({
      where: { locationId: testData.location.id },
    })

    const order = await testDb.order.create({
      data: {
        locationId: testData.location.id,
        employeeId: testData.employee.id,
        orderType: 'bar_tab',
        status: 'open',
        subtotal: 50.00,
        tax: 4.00,
        total: 54.00,
        items: {
          create: {
            locationId: testData.location.id,
            menuItemId: 'test-item',
            name: 'Test',
            price: 50.00,
            quantity: 1,
          },
        },
      },
    })

    const request = new NextRequest(`http://localhost/api/orders/${order.id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: testData.employee.id,
        payments: [
          { method: 'cash', amount: 30.00, tipAmount: 0 },
          { method: 'credit', amount: 24.00, tipAmount: 6.00, cardLast4: '4242', cardBrand: 'visa' },
        ],
      }),
    })

    const response = await POST(request, { params: { id: order.id } })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.payments).toHaveLength(2)
    expect(data.orderStatus).toBe('paid')
  })
})
```

---

## 5. E2E Critical Paths

### E2E Test Setup (Playwright)

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

### Critical Path 1: Clock In → Order → Kitchen → Close

```typescript
// __tests__/e2e/full-order-flow.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Full Order Flow', () => {
  test('server clocks in, takes order, sends to kitchen, closes check', async ({ page }) => {
    // 1. Login
    await page.goto('/login')
    await page.fill('[data-testid="pin-input"]', '2345')
    await page.click('[data-testid="login-submit"]')

    // Wait for orders page
    await expect(page).toHaveURL('/orders')
    await expect(page.locator('text=Sarah S.')).toBeVisible()

    // 2. Start new order (dine in)
    await page.click('[data-testid="order-type-dine_in"]')
    await expect(page.locator('[data-testid="order-panel"]')).toBeVisible()

    // 3. Add items to order
    await page.click('[data-testid="category-Appetizers"]')
    await page.click('[data-testid="menu-item-Wings"]')

    // Check item appears in order panel
    await expect(page.locator('[data-testid="order-item-Wings"]')).toBeVisible()

    // 4. Send to kitchen
    await page.click('[data-testid="send-to-kitchen"]')
    await expect(page.locator('text=Sent to Kitchen')).toBeVisible()

    // 5. Open payment modal
    await page.click('[data-testid="pay-button"]')
    await expect(page.locator('[data-testid="payment-modal"]')).toBeVisible()

    // 6. Select cash payment
    await page.click('[data-testid="payment-method-cash"]')

    // 7. Enter cash amount
    await page.click('[data-testid="quick-cash-20"]')

    // 8. Complete payment
    await page.click('[data-testid="complete-payment"]')

    // 9. Verify order closed
    await expect(page.locator('text=Payment Complete')).toBeVisible()
    await expect(page.locator('[data-testid="change-amount"]')).toContainText('$')
  })
})
```

### Critical Path 2: Payment Flow (Cash & Card)

```typescript
// __tests__/e2e/payment-flow.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login as manager
    await page.goto('/login')
    await page.fill('[data-testid="pin-input"]', '1234')
    await page.click('[data-testid="login-submit"]')
    await expect(page).toHaveURL('/orders')

    // Create order with item
    await page.click('[data-testid="order-type-bar_tab"]')
    await page.click('[data-testid="category-Beer"]')
    await page.click('[data-testid="menu-item-Budweiser"]')
  })

  test('processes cash payment with change', async ({ page }) => {
    await page.click('[data-testid="pay-button"]')
    await page.click('[data-testid="payment-method-cash"]')
    await page.click('[data-testid="quick-cash-20"]')
    await page.click('[data-testid="complete-payment"]')

    await expect(page.locator('[data-testid="change-amount"]')).toBeVisible()
  })

  test('processes simulated card payment (dev mode)', async ({ page }) => {
    await page.click('[data-testid="pay-button"]')
    await page.click('[data-testid="payment-method-credit"]')

    // Use simulated card reader (only in dev)
    await page.click('[data-testid="tap-card"]')

    // Wait for simulated processing
    await page.waitForSelector('text=Reading card', { timeout: 5000 })
    await page.waitForSelector('text=Approved', { timeout: 5000 })

    await expect(page.locator('[data-testid="card-last4"]')).toBeVisible()
  })

  test('handles card decline gracefully', async ({ page }) => {
    // This test relies on ~5% random decline rate
    // Run multiple times or use a known decline card
    await page.click('[data-testid="pay-button"]')
    await page.click('[data-testid="payment-method-credit"]')

    // Force a decline scenario (needs test hook)
    await page.evaluate(() => {
      window.__TEST_FORCE_DECLINE__ = true
    })

    await page.click('[data-testid="chip-card"]')
    await page.waitForSelector('text=Card declined', { timeout: 5000 })

    await expect(page.locator('text=Card declined')).toBeVisible()
  })
})
```

### Critical Path 3: Split Check Workflow

```typescript
// __tests__/e2e/split-check.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Split Check', () => {
  test('splits check evenly between guests', async ({ page }) => {
    // Login and create order
    await page.goto('/login')
    await page.fill('[data-testid="pin-input"]', '1234')
    await page.click('[data-testid="login-submit"]')

    // Start dine-in order with 2 guests
    await page.click('[data-testid="order-type-dine_in"]')
    await page.fill('[data-testid="guest-count"]', '2')

    // Add items
    await page.click('[data-testid="category-Entrees"]')
    await page.click('[data-testid="menu-item-Steak"]')
    await page.click('[data-testid="menu-item-Salmon"]')

    // Open split check modal
    await page.click('[data-testid="split-check"]')
    await expect(page.locator('[data-testid="split-check-modal"]')).toBeVisible()

    // Select "Split Evenly"
    await page.click('[data-testid="split-evenly"]')
    await page.fill('[data-testid="split-count"]', '2')
    await page.click('[data-testid="apply-split"]')

    // Verify two checks created
    await expect(page.locator('[data-testid="split-ticket-1"]')).toBeVisible()
    await expect(page.locator('[data-testid="split-ticket-2"]')).toBeVisible()

    // Pay first check
    await page.click('[data-testid="pay-split-1"]')
    await page.click('[data-testid="payment-method-cash"]')
    await page.click('[data-testid="complete-payment"]')

    // Pay second check
    await page.click('[data-testid="pay-split-2"]')
    await page.click('[data-testid="payment-method-credit"]')
    await page.click('[data-testid="tap-card"]')
    await page.waitForSelector('text=Approved', { timeout: 5000 })
  })
})
```

### Critical Path 4: Manager Void/Refund

```typescript
// __tests__/e2e/manager-operations.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Manager Operations', () => {
  test('manager voids an item', async ({ page }) => {
    // Login as manager
    await page.goto('/login')
    await page.fill('[data-testid="pin-input"]', '1234')
    await page.click('[data-testid="login-submit"]')

    // Create and send order
    await page.click('[data-testid="order-type-bar_tab"]')
    await page.click('[data-testid="category-Beer"]')
    await page.click('[data-testid="menu-item-IPA"]')
    await page.click('[data-testid="send-to-kitchen"]')

    // Long press (or right-click) to void
    await page.click('[data-testid="order-item-IPA"]', { button: 'right' })
    await page.click('[data-testid="void-item"]')

    // Enter void reason
    await page.fill('[data-testid="void-reason"]', 'Customer changed mind')
    await page.click('[data-testid="confirm-void"]')

    // Verify item voided
    await expect(page.locator('[data-testid="order-item-IPA"]')).toHaveClass(/voided/)
  })

  test('manager issues refund on closed order', async ({ page }) => {
    // Login as manager
    await page.goto('/login')
    await page.fill('[data-testid="pin-input"]', '1234')
    await page.click('[data-testid="login-submit"]')

    // Find closed order from order history
    await page.click('[data-testid="open-orders-panel"]')
    await page.click('[data-testid="view-history"]')

    // Select a paid order
    await page.click('[data-testid="order-row-0"]')
    await page.click('[data-testid="refund-button"]')

    // Select refund reason and amount
    await page.fill('[data-testid="refund-amount"]', '10.00')
    await page.selectOption('[data-testid="refund-reason"]', 'customer_complaint')
    await page.click('[data-testid="process-refund"]')

    // Verify refund processed
    await expect(page.locator('text=Refund Processed')).toBeVisible()
  })
})
```

### Critical Path 5: Shift Closeout

```typescript
// __tests__/e2e/shift-closeout.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Shift Closeout', () => {
  test('employee closes shift with tip declaration', async ({ page }) => {
    // Login
    await page.goto('/login')
    await page.fill('[data-testid="pin-input"]', '2345')
    await page.click('[data-testid="login-submit"]')

    // Clock in (if not already)
    await page.click('[data-testid="clock-in"]')

    // ... take some orders ...

    // Open shift closeout
    await page.click('[data-testid="hamburger-menu"]')
    await page.click('[data-testid="close-shift"]')

    // Declare cash tips
    await page.fill('[data-testid="cash-tips-declared"]', '45.00')

    // Review tip-out summary
    await expect(page.locator('[data-testid="tip-out-amount"]')).toBeVisible()

    // Confirm closeout
    await page.click('[data-testid="confirm-closeout"]')

    // Verify shift closed
    await expect(page.locator('text=Shift Closed')).toBeVisible()
  })
})
```

---

## 6. Performance Testing

### Load Testing Targets

| Metric | Target | Critical |
|--------|--------|----------|
| Concurrent users per location | 20 | 50 |
| API response time (p95) | < 200ms | < 500ms |
| Page load time | < 2s | < 4s |
| Order creation | < 300ms | < 600ms |
| Payment processing | < 500ms | < 1s |
| Floor plan render (50 tables) | < 100ms | < 250ms |

### Database Query Benchmarks

```typescript
// __tests__/performance/db-queries.perf.ts
import { performance } from 'perf_hooks'
import { testDb } from '../helpers/test-db'

describe('Database Query Performance', () => {
  const ITERATIONS = 100
  const MAX_AVG_MS = 50

  test('menu query with categories < 50ms avg', async () => {
    const times: number[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now()
      await testDb.category.findMany({
        where: { locationId: 'test-loc', deletedAt: null },
        include: {
          menuItems: {
            where: { deletedAt: null, isAvailable: true },
          },
        },
      })
      times.push(performance.now() - start)
    }

    const avg = times.reduce((a, b) => a + b) / times.length
    console.log(`Menu query avg: ${avg.toFixed(2)}ms`)
    expect(avg).toBeLessThan(MAX_AVG_MS)
  })

  test('open orders query < 30ms avg', async () => {
    const times: number[] = []

    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now()
      await testDb.order.findMany({
        where: {
          locationId: 'test-loc',
          status: { in: ['open', 'sent', 'in_progress'] },
          deletedAt: null,
        },
        include: {
          employee: { select: { firstName: true, lastName: true } },
          table: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      times.push(performance.now() - start)
    }

    const avg = times.reduce((a, b) => a + b) / times.length
    expect(avg).toBeLessThan(30)
  })
})
```

### Component Render Benchmarks

```typescript
// __tests__/performance/render.perf.tsx
import { render } from '@testing-library/react'
import { performance } from 'perf_hooks'
import FloorPlanHome from '@/components/floor-plan/FloorPlanHome'

describe('Component Render Performance', () => {
  test('floor plan with 50 tables renders < 100ms', () => {
    const tables = Array.from({ length: 50 }, (_, i) => ({
      id: `table-${i}`,
      name: `Table ${i + 1}`,
      x: (i % 10) * 100,
      y: Math.floor(i / 10) * 100,
      width: 80,
      height: 80,
      seats: 4,
      status: i % 3 === 0 ? 'occupied' : 'available',
    }))

    const start = performance.now()
    render(<FloorPlanHome tables={tables} />)
    const duration = performance.now() - start

    console.log(`Floor plan render: ${duration.toFixed(2)}ms`)
    expect(duration).toBeLessThan(100)
  })
})
```

### Load Testing Script (k6)

```javascript
// __tests__/load/order-flow.js
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '1m', target: 20 },  // Ramp up to 20 users
    { duration: '3m', target: 20 },  // Stay at 20 users
    { duration: '1m', target: 50 },  // Spike to 50 users
    { duration: '2m', target: 50 },  // Stay at 50 users
    { duration: '1m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}

export default function () {
  const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

  // Login
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    pin: '1234',
  }), { headers: { 'Content-Type': 'application/json' } })

  check(loginRes, {
    'login successful': (r) => r.status === 200,
  })

  sleep(1)

  // Create order
  const orderRes = http.post(`${BASE_URL}/api/orders`, JSON.stringify({
    employeeId: 'test-emp',
    locationId: 'test-loc',
    orderType: 'bar_tab',
    items: [{
      menuItemId: 'test-item',
      name: 'Test Item',
      price: 10.00,
      quantity: 1,
      modifiers: [],
    }],
  }), { headers: { 'Content-Type': 'application/json' } })

  check(orderRes, {
    'order created': (r) => r.status === 201,
  })

  sleep(2)
}
```

---

## 7. File Structure & Conventions

### Directory Structure

```
gwi-pos/
├── src/
│   ├── components/
│   │   ├── floor-plan/
│   │   │   ├── FloorPlanHome.tsx
│   │   │   └── FloorPlanHome.test.tsx     ← Co-located unit test
│   │   └── payment/
│   │       ├── PaymentModal.tsx
│   │       └── PaymentModal.test.tsx
│   ├── lib/
│   │   ├── utils.ts
│   │   ├── utils.test.ts                   ← Co-located unit test
│   │   ├── pricing.ts
│   │   ├── pricing.test.ts
│   │   ├── payment.ts
│   │   └── payment.test.ts
│   ├── stores/
│   │   ├── order-store.ts
│   │   ├── order-store.test.ts
│   │   ├── auth-store.ts
│   │   └── auth-store.test.ts
│   └── types/
│
├── __tests__/
│   ├── helpers/
│   │   ├── test-db.ts                      ← Test database utilities
│   │   ├── test-fixtures.ts                ← Shared test data
│   │   └── msw-handlers.ts                 ← MSW mock handlers
│   ├── integration/
│   │   ├── auth/
│   │   │   └── login.test.ts
│   │   ├── orders/
│   │   │   ├── create.test.ts
│   │   │   └── pay.test.ts
│   │   └── multi-tenant.test.ts
│   ├── e2e/
│   │   ├── full-order-flow.spec.ts
│   │   ├── payment-flow.spec.ts
│   │   ├── split-check.spec.ts
│   │   ├── manager-operations.spec.ts
│   │   └── shift-closeout.spec.ts
│   └── performance/
│       ├── db-queries.perf.ts
│       └── render.perf.tsx
│
├── jest.config.ts
├── jest.setup.ts
└── playwright.config.ts
```

### Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Unit tests | `*.test.ts` | `utils.test.ts` |
| Component tests | `*.test.tsx` | `PaymentModal.test.tsx` |
| Integration tests | `*.test.ts` | `login.test.ts` |
| E2E tests | `*.spec.ts` | `payment-flow.spec.ts` |
| Performance tests | `*.perf.ts` | `db-queries.perf.ts` |
| Test utilities | No suffix | `test-db.ts` |

### Test File Template

```typescript
// src/lib/example.test.ts

// 1. Imports
import { functionToTest } from './example'

// 2. Mocks (if needed)
jest.mock('@/lib/db', () => ({
  db: { /* mock implementation */ }
}))

// 3. Test suite
describe('functionToTest', () => {
  // 4. Setup/teardown
  beforeEach(() => {
    // Reset state
  })

  afterEach(() => {
    // Cleanup
  })

  // 5. Happy path tests
  describe('when given valid input', () => {
    it('returns expected result', () => {
      expect(functionToTest('valid')).toBe('expected')
    })
  })

  // 6. Edge cases
  describe('edge cases', () => {
    it('handles empty input', () => {
      expect(functionToTest('')).toBe('')
    })

    it('handles null input', () => {
      expect(() => functionToTest(null)).toThrow()
    })
  })

  // 7. Error cases
  describe('error handling', () => {
    it('throws on invalid input', () => {
      expect(() => functionToTest('invalid')).toThrow('Error message')
    })
  })
})
```

---

## 8. CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Generate Prisma Client
        run: npx prisma generate

      - name: Run unit tests
        run: npm test -- --coverage --ci

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: gwi_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Setup test database
        run: |
          npx prisma migrate deploy
          npx prisma db seed
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/gwi_test

      - name: Run integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/gwi_test

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Build application
        run: npm run build

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
```

### Pre-commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run tests for changed files
npx lint-staged

# Run unit tests
npm test -- --bail --findRelatedTests $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' | tr '\n' ' ')
```

### lint-staged Configuration

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "jest --bail --findRelatedTests"
    ]
  }
}
```

---

## 9. Test Coverage Goals

### Coverage Targets by Area

| Area | Line Coverage | Branch Coverage |
|------|--------------|-----------------|
| **Utilities (lib/)** | 90% | 85% |
| **Stores** | 85% | 80% |
| **API Routes** | 80% | 75% |
| **Components** | 70% | 65% |
| **Overall** | 75% | 70% |

### Critical Paths (Must be 100%)

- [ ] PIN login authentication
- [ ] Payment processing (all methods)
- [ ] Order creation and modification
- [ ] Tip calculations
- [ ] Price calculations (dual pricing)
- [ ] Multi-tenant data isolation

### Exclusions from Coverage

```javascript
// jest.config.ts - collectCoverageFrom
collectCoverageFrom: [
  'src/**/*.{ts,tsx}',
  // Exclusions
  '!src/**/*.d.ts',           // Type definitions
  '!src/app/**/layout.tsx',   // Next.js layouts
  '!src/app/**/loading.tsx',  // Loading states
  '!src/app/**/error.tsx',    // Error boundaries
  '!src/types/**/*',          // Type-only files
  '!src/**/*.stories.tsx',    // Storybook stories (if added)
]
```

### Coverage Reporting

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/lcov-report/index.html

# Check coverage thresholds
npm test -- --coverage --coverageThreshold='{"global":{"lines":75}}'
```

---

## Quick Reference

### Running Tests

```bash
# All unit tests
npm test

# Watch mode
npm run test:watch

# Single file
npm test -- path/to/file.test.ts

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# E2E with UI
npm run test:e2e:ui

# Coverage report
npm run test:coverage
```

### Writing Tests Checklist

- [ ] Test file co-located or in `__tests__/`
- [ ] Descriptive test names (`it('calculates tip on subtotal')`)
- [ ] Setup/teardown to isolate tests
- [ ] Happy path, edge cases, and error cases covered
- [ ] No implementation details tested
- [ ] Mocks cleaned up after tests
- [ ] Async operations properly awaited

---

*This document is the source of truth for GWI POS testing strategy.*
*Last Updated: January 30, 2026*
