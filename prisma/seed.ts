import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { hash } from 'bcryptjs'

const connectionString = process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL

console.log('Connection string found:', connectionString ? 'Yes' : 'No')

if (!connectionString) {
  throw new Error('Database connection string not found. Make sure POSTGRES_PRISMA_URL or POSTGRES_URL is set.')
}

const adapter = new PrismaNeon({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding database...')

  // Create Organization
  const org = await prisma.organization.upsert({
    where: { id: 'org-1' },
    update: {},
    create: {
      id: 'org-1',
      name: 'GWI Restaurant Group',
    },
  })
  console.log('Created organization:', org.name)

  // Create Location
  const location = await prisma.location.upsert({
    where: { id: 'loc-1' },
    update: {},
    create: {
      id: 'loc-1',
      organizationId: org.id,
      name: 'Main Bar & Grill',
      timezone: 'America/New_York',
      address: '123 Main Street, Austin, TX 78701',
      phone: '512-555-0123',
    },
  })
  console.log('Created location:', location.name)

  // Create Roles
  const managerRole = await prisma.role.upsert({
    where: { id: 'role-manager' },
    update: {},
    create: {
      id: 'role-manager',
      locationId: location.id,
      name: 'Manager',
      permissions: {
        orders: ['create', 'read', 'update', 'delete', 'void', 'discount'],
        menu: ['create', 'read', 'update', 'delete'],
        employees: ['create', 'read', 'update', 'delete'],
        reports: ['read'],
        settings: ['read', 'update'],
      },
    },
  })

  const serverRole = await prisma.role.upsert({
    where: { id: 'role-server' },
    update: {},
    create: {
      id: 'role-server',
      locationId: location.id,
      name: 'Server',
      permissions: {
        orders: ['create', 'read', 'update'],
        menu: ['read'],
      },
    },
  })

  const bartenderRole = await prisma.role.upsert({
    where: { id: 'role-bartender' },
    update: {},
    create: {
      id: 'role-bartender',
      locationId: location.id,
      name: 'Bartender',
      permissions: {
        orders: ['create', 'read', 'update'],
        menu: ['read'],
      },
    },
  })
  console.log('Created roles: Manager, Server, Bartender')

  // Create Employees
  const pinHash = await hash('1234', 10)

  const manager = await prisma.employee.upsert({
    where: { id: 'emp-1' },
    update: {},
    create: {
      id: 'emp-1',
      locationId: location.id,
      roleId: managerRole.id,
      firstName: 'Demo',
      lastName: 'Manager',
      displayName: 'Demo Manager',
      pin: pinHash,
      hourlyRate: 25.00,
      email: 'manager@demo.com',
    },
  })

  const server = await prisma.employee.upsert({
    where: { id: 'emp-2' },
    update: {},
    create: {
      id: 'emp-2',
      locationId: location.id,
      roleId: serverRole.id,
      firstName: 'Sarah',
      lastName: 'Server',
      displayName: 'Sarah S.',
      pin: await hash('2345', 10),
      hourlyRate: 12.00,
      email: 'sarah@demo.com',
    },
  })

  const bartender = await prisma.employee.upsert({
    where: { id: 'emp-3' },
    update: {},
    create: {
      id: 'emp-3',
      locationId: location.id,
      roleId: bartenderRole.id,
      firstName: 'Mike',
      lastName: 'Bartender',
      displayName: 'Mike B.',
      pin: await hash('3456', 10),
      hourlyRate: 15.00,
      email: 'mike@demo.com',
    },
  })
  console.log('Created employees: Demo Manager (PIN: 1234), Sarah S. (PIN: 2345), Mike B. (PIN: 3456)')

  // Create Categories
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { id: 'cat-1' },
      update: {},
      create: {
        id: 'cat-1',
        locationId: location.id,
        name: 'Appetizers',
        color: '#ef4444',
        sortOrder: 1,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-2' },
      update: {},
      create: {
        id: 'cat-2',
        locationId: location.id,
        name: 'Entrees',
        color: '#3b82f6',
        sortOrder: 2,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-3' },
      update: {},
      create: {
        id: 'cat-3',
        locationId: location.id,
        name: 'Drinks',
        color: '#22c55e',
        sortOrder: 3,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-4' },
      update: {},
      create: {
        id: 'cat-4',
        locationId: location.id,
        name: 'Desserts',
        color: '#a855f7',
        sortOrder: 4,
      },
    }),
  ])
  console.log('Created categories:', categories.map(c => c.name).join(', '))

  // Create Menu Items
  const menuItems = [
    // Appetizers
    { id: 'item-1', categoryId: 'cat-1', name: 'Buffalo Wings', price: 12.99, description: 'Crispy wings tossed in buffalo sauce' },
    { id: 'item-2', categoryId: 'cat-1', name: 'Loaded Nachos', price: 10.99, description: 'Tortilla chips with all the fixings' },
    { id: 'item-3', categoryId: 'cat-1', name: 'Mozzarella Sticks', price: 8.99, description: 'Served with marinara sauce' },
    { id: 'item-4', categoryId: 'cat-1', name: 'Spinach Dip', price: 9.99, description: 'Creamy spinach artichoke dip', isAvailable: false },
    // Entrees
    { id: 'item-5', categoryId: 'cat-2', name: 'Classic Burger', price: 14.99, description: '8oz beef patty with lettuce, tomato, onion' },
    { id: 'item-6', categoryId: 'cat-2', name: 'Grilled Salmon', price: 22.99, description: 'Atlantic salmon with seasonal vegetables' },
    { id: 'item-7', categoryId: 'cat-2', name: 'Ribeye Steak', price: 28.99, description: '12oz ribeye cooked to order' },
    // Drinks
    { id: 'item-8', categoryId: 'cat-3', name: 'Draft Beer', price: 5.99, description: 'Selection of local craft beers' },
    { id: 'item-9', categoryId: 'cat-3', name: 'House Wine', price: 7.99, description: 'Red or white' },
    { id: 'item-10', categoryId: 'cat-3', name: 'Margarita', price: 9.99, description: 'Classic lime margarita' },
    { id: 'item-11', categoryId: 'cat-3', name: 'Soft Drink', price: 2.99, description: 'Coke, Sprite, or Dr Pepper' },
    // Desserts
    { id: 'item-12', categoryId: 'cat-4', name: 'Chocolate Cake', price: 7.99, description: 'Rich chocolate layer cake' },
    { id: 'item-13', categoryId: 'cat-4', name: 'Cheesecake', price: 8.99, description: 'New York style cheesecake' },
  ]

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: item.categoryId,
        name: item.name,
        price: item.price,
        description: item.description,
        isAvailable: item.isAvailable ?? true,
      },
    })
  }
  console.log('Created', menuItems.length, 'menu items')

  console.log('Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
