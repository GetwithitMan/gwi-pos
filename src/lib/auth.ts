import bcrypt from 'bcryptjs'
import { db } from './db'

const SALT_ROUNDS = 10

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS)
}

export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  return bcrypt.compare(pin, hashedPin)
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export async function authenticateEmployee(locationId: string, pin: string) {
  // Find employee by location (PIN is unique per location)
  const employees = await db.employee.findMany({
    where: {
      locationId,
      isActive: true,
    },
    include: {
      role: true,
      location: true,
    },
  })

  // Check PIN against each employee (since PINs are hashed)
  for (const employee of employees) {
    const isValid = await verifyPin(pin, employee.pin)
    if (isValid) {
      return {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        displayName: employee.displayName || `${employee.firstName} ${employee.lastName.charAt(0)}.`,
        role: employee.role,
        location: employee.location,
        permissions: employee.role.permissions as string[],
      }
    }
  }

  return null
}

export function hasPermission(permissions: string[], requiredPermission: string): boolean {
  // Admin has all permissions
  if (permissions.includes('admin') || permissions.includes('*')) {
    return true
  }
  return permissions.includes(requiredPermission)
}

// Permission constants
export const PERMISSIONS = {
  // Orders
  CREATE_ORDER: 'orders.create',
  VOID_ITEM: 'orders.void_item',
  VOID_ORDER: 'orders.void_order',
  APPLY_DISCOUNT: 'orders.apply_discount',
  TRANSFER_ORDER: 'orders.transfer',

  // Payments
  PROCESS_PAYMENT: 'payments.process',
  REFUND_PAYMENT: 'payments.refund',
  OPEN_DRAWER: 'payments.open_drawer',

  // Menu
  VIEW_MENU: 'menu.view',
  EDIT_MENU: 'menu.edit',
  EDIT_PRICES: 'menu.edit_prices',

  // Employees
  VIEW_EMPLOYEES: 'employees.view',
  EDIT_EMPLOYEES: 'employees.edit',
  CLOCK_OTHERS: 'employees.clock_others',

  // Reports
  VIEW_REPORTS: 'reports.view',
  VIEW_LABOR: 'reports.labor',
  VIEW_SALES: 'reports.sales',

  // Settings
  EDIT_SETTINGS: 'settings.edit',

  // Admin
  ADMIN: 'admin',
} as const
