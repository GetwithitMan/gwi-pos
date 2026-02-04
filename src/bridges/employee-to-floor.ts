/**
 * Employee ↔ Floor Plan Bridge
 *
 * Connects employees with section assignments and permissions.
 */

export interface EmployeeToFloorBridge {
  /** Get employee's assigned section */
  getAssignedSection(employeeId: string): Promise<{
    sectionId: string
    sectionName: string
    tableIds: string[]
  } | null>

  /** Get all servers currently on shift */
  getActiveServers(locationId: string): Promise<Array<{
    id: string
    name: string
    sectionId?: string
  }>>

  /** Check if employee can access a table */
  canAccessTable(employeeId: string, tableId: string): Promise<boolean>
}

export interface FloorToEmployeeBridge {
  /** Assign section to employee */
  assignSection(employeeId: string, sectionId: string): Promise<boolean>

  /** Get employees in a section */
  getEmployeesInSection(sectionId: string): Promise<string[]>
}

export const employeeToFloorBridge: EmployeeToFloorBridge = {
  getAssignedSection: async () => null,
  getActiveServers: async () => [],
  canAccessTable: async () => true,
}

export const floorToEmployeeBridge: FloorToEmployeeBridge = {
  assignSection: async () => true,
  getEmployeesInSection: async () => [],
}
