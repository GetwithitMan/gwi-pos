import type { LocationSettings } from '@/lib/settings'

/**
 * Check if an order is a training order.
 * Training orders have isTraining=true — they are excluded from reports
 * and do not hit real payment processors.
 */
export function isTrainingOrder(order: { isTraining?: boolean }): boolean {
  return order.isTraining === true
}

/**
 * Check if an employee is currently in training mode.
 * Requires both the master training toggle to be enabled AND
 * the employee's ID to be in the trainingEmployeeIds list.
 */
export function isTrainingEmployee(employeeId: string, settings: LocationSettings): boolean {
  if (!settings.training?.enabled) return false
  return settings.training.trainingEmployeeIds.includes(employeeId)
}
