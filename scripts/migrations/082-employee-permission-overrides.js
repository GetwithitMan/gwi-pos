const { tableExists, columnExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[082-employee-permission-overrides]'

  const exists = await tableExists(prisma, 'EmployeePermissionOverride')
  if (exists) {
    console.log(`${PREFIX} EmployeePermissionOverride table already exists — skipping`)
    return
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "EmployeePermissionOverride" (
      "id"            TEXT NOT NULL,
      "locationId"    TEXT NOT NULL,
      "employeeId"    TEXT NOT NULL,
      "permissionKey" TEXT NOT NULL,
      "allowed"       BOOLEAN NOT NULL,
      "reason"        TEXT,
      "setBy"         TEXT,
      "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP(3) NOT NULL,
      CONSTRAINT "EmployeePermissionOverride_pkey" PRIMARY KEY ("id")
    )
  `)
  console.log(`${PREFIX} Created EmployeePermissionOverride table`)

  // Unique constraint: one override per employee + permission key
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "EmployeePermissionOverride_employeeId_permissionKey_key"
    ON "EmployeePermissionOverride" ("employeeId", "permissionKey")
  `)
  console.log(`${PREFIX} Added unique index on (employeeId, permissionKey)`)

  // Location index for tenant queries
  await prisma.$executeRawUnsafe(`
    CREATE INDEX "EmployeePermissionOverride_locationId_idx"
    ON "EmployeePermissionOverride" ("locationId")
  `)
  console.log(`${PREFIX} Added index on locationId`)

  // Employee index for permission lookups
  await prisma.$executeRawUnsafe(`
    CREATE INDEX "EmployeePermissionOverride_employeeId_idx"
    ON "EmployeePermissionOverride" ("employeeId")
  `)
  console.log(`${PREFIX} Added index on employeeId`)

  // Foreign keys
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "EmployeePermissionOverride"
    ADD CONSTRAINT "EmployeePermissionOverride_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  `)

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "EmployeePermissionOverride"
    ADD CONSTRAINT "EmployeePermissionOverride_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  `)
  console.log(`${PREFIX} Added foreign key constraints`)
}

module.exports = { up }
