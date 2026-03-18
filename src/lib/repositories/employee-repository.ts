/**
 * Employee Repository -- Tenant-Safe Employee Data Access
 *
 * Every query includes locationId in its WHERE clause to enforce tenant isolation.
 * This replaces the dangerous pattern of `db.employee.findUnique({ where: { id } })`
 * which has no tenant guard and could leak data across locations.
 *
 * Usage:
 *   import { EmployeeRepository } from '@/lib/repositories'
 *   const emp = await EmployeeRepository.getEmployeeById(id, locationId)
 *   const emp = await EmployeeRepository.getEmployeeByPin(pin, locationId, tx)
 */

import { getClient, type TxClient } from './base-repository'
import type { Prisma } from '@/generated/prisma/client'

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Get an employee by ID, scoped to locationId.
 * Returns null if not found. Excludes soft-deleted employees.
 */
export async function getEmployeeById(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.findFirst({
    where: { id, locationId, deletedAt: null },
  })
}

/**
 * Get an employee by ID or throw, scoped to locationId.
 * Use this when the employee MUST exist (e.g., inside a known-good transaction).
 */
export async function getEmployeeByIdOrThrow(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const employee = await client.employee.findFirst({
    where: { id, locationId, deletedAt: null },
  })
  if (!employee) throw new Error(`Employee ${id} not found for location ${locationId}`)
  return employee
}

/**
 * Get an employee by PIN, scoped to locationId.
 * Critical auth path -- used for PIN login on POS terminals.
 * Returns null if not found. Only returns active, non-deleted employees.
 */
export async function getEmployeeByPin(
  pin: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.findFirst({
    where: { pin, locationId, isActive: true, deletedAt: null },
  })
}

/**
 * Get an employee by ID with a custom include shape.
 * Escape hatch for route handlers that need specific relations
 * without duplicating locationId enforcement.
 */
export async function getEmployeeByIdWithInclude<T extends Prisma.EmployeeInclude>(
  id: string,
  locationId: string,
  include: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.findFirst({
    where: { id, locationId, deletedAt: null },
    include,
  })
}

/**
 * Get an employee by ID with a custom select shape.
 * Useful for lightweight existence checks or single-field reads.
 */
export async function getEmployeeByIdWithSelect<T extends Prisma.EmployeeSelect>(
  id: string,
  locationId: string,
  select: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.findFirst({
    where: { id, locationId, deletedAt: null },
    select,
  })
}

/**
 * Get all employees for a location (active and inactive).
 * Excludes soft-deleted employees.
 */
export async function getEmployees(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.employee.findMany({
    where: { locationId, deletedAt: null },
    orderBy: { firstName: 'asc' },
  })
}

/**
 * Get all active employees for a location.
 * Used for employee selection dropdowns, shift assignment, etc.
 */
export async function getActiveEmployees(locationId: string, tx?: TxClient) {
  const client = getClient(tx)
  return client.employee.findMany({
    where: { locationId, isActive: true, deletedAt: null },
    orderBy: { firstName: 'asc' },
  })
}

/**
 * Get employees by role for a location.
 */
export async function getEmployeesByRole(
  roleId: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.findMany({
    where: { roleId, locationId, isActive: true, deletedAt: null },
    orderBy: { firstName: 'asc' },
  })
}

/**
 * Check if an employee exists and belongs to this location.
 * Returns { id, isActive, locationId } or null. Lightweight check.
 */
export async function checkEmployeeExists(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.findFirst({
    where: { id, locationId, deletedAt: null },
    select: { id: true, isActive: true, locationId: true },
  })
}

/**
 * Count employees matching filters for a location.
 */
export async function countEmployees(
  locationId: string,
  where?: Omit<Prisma.EmployeeWhereInput, 'locationId'>,
  tx?: TxClient,
) {
  const client = getClient(tx)
  return client.employee.count({
    where: { locationId, deletedAt: null, ...where },
  })
}

// ── Writes ───────────────────────────────────────────────────────────────

/**
 * Create an employee with locationId baked in.
 */
export async function createEmployee(
  locationId: string,
  data: Omit<Prisma.EmployeeCreateInput, 'location' | 'role'> & { roleId: string },
  tx?: TxClient,
) {
  const client = getClient(tx)
  const { roleId, ...rest } = data
  return client.employee.create({
    data: {
      ...rest,
      location: { connect: { id: locationId } },
      role: { connect: { id: roleId } },
    },
  })
}

/**
 * Update an employee, enforcing locationId in the WHERE clause.
 *
 * Uses updateMany with composite where -- returns count, never throws on not-found.
 * This is safer than update() which only takes { id } in where and has no tenant guard.
 *
 * Throws if no matching employee was found (count === 0).
 */
export async function updateEmployee(
  id: string,
  locationId: string,
  data: Prisma.EmployeeUpdateManyMutationInput,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.employee.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`Employee ${id} not found for location ${locationId} -- update failed`)
  }
  return result
}

/**
 * Update an employee and return the updated record with includes.
 *
 * Two-step: updateMany (tenant-safe) then findFirst (tenant-safe)
 * to return the full updated object.
 */
export async function updateEmployeeAndReturn<T extends Prisma.EmployeeInclude>(
  id: string,
  locationId: string,
  data: Prisma.EmployeeUpdateManyMutationInput,
  include?: T,
  tx?: TxClient,
) {
  const client = getClient(tx)
  const result = await client.employee.updateMany({
    where: { id, locationId },
    data,
  })
  if (result.count === 0) {
    throw new Error(`Employee ${id} not found for location ${locationId} -- update failed`)
  }
  return client.employee.findFirst({
    where: { id, locationId, deletedAt: null },
    ...(include ? { include } : {}),
  })
}

/**
 * Soft-delete an employee (set deletedAt). Never hard-delete.
 */
export async function softDeleteEmployee(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateEmployee(id, locationId, { deletedAt: new Date() }, tx)
}

/**
 * Deactivate an employee (set isActive to false).
 * Preferred over soft-delete when the employee record should remain visible
 * in reports but not be usable for login/assignment.
 */
export async function deactivateEmployee(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateEmployee(id, locationId, { isActive: false }, tx)
}

/**
 * Reactivate a previously deactivated employee.
 */
export async function reactivateEmployee(
  id: string,
  locationId: string,
  tx?: TxClient,
) {
  return updateEmployee(id, locationId, { isActive: true }, tx)
}
