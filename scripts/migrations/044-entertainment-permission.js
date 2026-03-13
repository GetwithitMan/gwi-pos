async function up(prisma) {
  const PREFIX = '[044-entertainment-permission]'

  // Find all roles that have 'settings.floor' permission but NOT 'settings.entertainment'
  const roles = await prisma.$queryRawUnsafe(`
    SELECT id, name, permissions
    FROM "Role"
    WHERE permissions::text LIKE '%settings.floor%'
      AND permissions::text NOT LIKE '%settings.entertainment%'
      AND "deletedAt" IS NULL
  `)

  if (roles.length === 0) {
    console.log(PREFIX, 'No roles need entertainment permission — skipping')
    return
  }

  for (const role of roles) {
    const perms = Array.isArray(role.permissions) ? role.permissions : JSON.parse(role.permissions || '[]')
    if (perms.includes('settings.entertainment')) continue

    perms.push('settings.entertainment')

    await prisma.$executeRawUnsafe(
      `UPDATE "Role" SET permissions = $1::jsonb WHERE id = $2`,
      JSON.stringify(perms),
      role.id
    )
    console.log(PREFIX, `Added settings.entertainment to role "${role.name}" (${role.id})`)
  }

  console.log(PREFIX, `Updated ${roles.length} role(s)`)
}

module.exports = { up }
