'use client'

import { useAuthStore } from '@/stores/auth-store'
import { hasPermission } from '@/lib/auth-utils'
import { useMemo } from 'react'

/**
 * Check if the current employee has a specific permission.
 * Uses the employee permissions from the auth store (loaded at login).
 *
 * Delegates to the canonical hasPermission() in auth-utils.ts which handles:
 * - Admin bypass (admin, super_admin, *, all)
 * - Exact match
 * - Wildcard match (e.g., 'pos.*' matches 'pos.access')
 *
 * @param permission - Permission key (e.g., 'manager.void_items')
 * @returns true if employee has the permission
 */
export function usePermission(permission: string): boolean {
  const permissions = useAuthStore(s => s.employee?.permissions)
  return useMemo(() => {
    if (!permissions) return false
    return hasPermission(permissions, permission)
  }, [permissions, permission])
}

/**
 * Check if the current employee has ANY of the listed permissions.
 */
export function useAnyPermission(requiredPermissions: string[]): boolean {
  const permissions = useAuthStore(s => s.employee?.permissions)
  return useMemo(() => {
    if (!permissions) return false
    return requiredPermissions.some(p => hasPermission(permissions, p))
  }, [permissions, requiredPermissions])
}

/**
 * Check if the current employee has ALL of the listed permissions.
 */
export function useAllPermissions(requiredPermissions: string[]): boolean {
  const permissions = useAuthStore(s => s.employee?.permissions)
  return useMemo(() => {
    if (!permissions) return false
    return requiredPermissions.every(p => hasPermission(permissions, p))
  }, [permissions, requiredPermissions])
}
