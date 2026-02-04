import bcrypt from 'bcryptjs'
import { db } from './db'

// Re-export client-safe utilities for backward compatibility
export {
  hasPermission,
  PERMISSIONS,
  PERMISSION_GROUPS,
  DEFAULT_ROLES,
  isSuperAdmin,
  isAdmin,
} from './auth-utils'

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
