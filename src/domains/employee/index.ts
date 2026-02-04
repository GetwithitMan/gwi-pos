/**
 * Employee Domain
 *
 * Manages profiles, scheduling, and time tracking.
 *
 * Modules:
 * - E1: Profiles (employee info, contact)
 * - E2: Roles (permissions, access levels)
 * - E3: Scheduling (shifts, availability)
 * - E4: Time Clock (clock in/out, breaks)
 * - E5: Payroll (wages, tips, reports)
 * - E6: Performance (metrics, reviews)
 */

// Types will be added as we migrate
export type Employee = {
  id: string
  firstName: string
  lastName: string
  pin: string
  roleId: string
  isActive: boolean
}

export type Role = {
  id: string
  name: string
  permissions: string[]
}

export type Shift = {
  id: string
  employeeId: string
  clockInAt: Date
  clockOutAt?: Date
  breakMinutes: number
}

// Constants
export const EMPLOYEE_ROLES = [
  'owner',
  'manager',
  'assistant_manager',
  'server',
  'bartender',
  'host',
  'busser',
  'kitchen',
  'expo',
] as const

export const PERMISSIONS = [
  'pos_access',
  'admin_access',
  'void_items',
  'comp_items',
  'apply_discounts',
  'open_cash_drawer',
  'view_reports',
  'manage_employees',
  'manage_menu',
  'manage_inventory',
] as const
