import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

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
      settings: {},
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
    prisma.category.upsert({
      where: { id: 'cat-5' },
      update: {},
      create: {
        id: 'cat-5',
        locationId: location.id,
        name: 'Combos',
        color: '#f97316',
        sortOrder: 5,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-6' },
      update: {},
      create: {
        id: 'cat-6',
        locationId: location.id,
        name: 'Entertainment',
        color: '#8b5cf6',
        sortOrder: 6,
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
    // Sides (for combos)
    { id: 'side-1', categoryId: 'cat-1', name: 'French Fries', price: 4.99, description: 'Crispy golden fries' },
    { id: 'side-2', categoryId: 'cat-1', name: 'Onion Rings', price: 5.99, description: 'Beer-battered onion rings' },
    { id: 'side-3', categoryId: 'cat-1', name: 'Coleslaw', price: 3.99, description: 'Creamy coleslaw' },
    { id: 'side-4', categoryId: 'cat-1', name: 'Side Salad', price: 4.99, description: 'House salad' },
    { id: 'side-5', categoryId: 'cat-1', name: 'Mashed Potatoes', price: 4.99, description: 'Garlic mashed potatoes' },
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

  // Create Combo Menu Items
  const comboItems = [
    {
      id: 'combo-1',
      categoryId: 'cat-5',
      name: 'Burger Combo',
      price: 18.99,
      description: 'Classic burger with side and drink',
      itemType: 'combo',
    },
    {
      id: 'combo-2',
      categoryId: 'cat-5',
      name: 'Wings Combo',
      price: 16.99,
      description: 'Buffalo wings with side and drink',
      itemType: 'combo',
    },
    {
      id: 'combo-3',
      categoryId: 'cat-5',
      name: 'Steak Dinner',
      price: 34.99,
      description: 'Ribeye steak with two sides',
      itemType: 'combo',
    },
  ]

  for (const item of comboItems) {
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
        itemType: item.itemType,
      },
    })
  }
  console.log('Created', comboItems.length, 'combo items')

  // Create Combo Templates
  await prisma.comboTemplate.upsert({
    where: { id: 'combo-template-1' },
    update: {},
    create: {
      id: 'combo-template-1',
      menuItemId: 'combo-1',
      basePrice: 18.99,
      comparePrice: 23.97, // Burger 14.99 + Side 5.99 + Drink 2.99
    },
  })

  await prisma.comboTemplate.upsert({
    where: { id: 'combo-template-2' },
    update: {},
    create: {
      id: 'combo-template-2',
      menuItemId: 'combo-2',
      basePrice: 16.99,
      comparePrice: 21.97, // Wings 12.99 + Side 5.99 + Drink 2.99
    },
  })

  await prisma.comboTemplate.upsert({
    where: { id: 'combo-template-3' },
    update: {},
    create: {
      id: 'combo-template-3',
      menuItemId: 'combo-3',
      basePrice: 34.99,
      comparePrice: 40.97, // Steak 28.99 + 2 sides 5.99 each
    },
  })
  console.log('Created combo templates')

  // Create Combo Components for Burger Combo
  const burgerSideComponent = await prisma.comboComponent.upsert({
    where: { id: 'comp-burger-side' },
    update: {},
    create: {
      id: 'comp-burger-side',
      comboTemplateId: 'combo-template-1',
      slotName: 'side',
      displayName: 'Choose Your Side',
      sortOrder: 1,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
  })

  const burgerDrinkComponent = await prisma.comboComponent.upsert({
    where: { id: 'comp-burger-drink' },
    update: {},
    create: {
      id: 'comp-burger-drink',
      comboTemplateId: 'combo-template-1',
      slotName: 'drink',
      displayName: 'Choose Your Drink',
      sortOrder: 2,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
  })

  // Create Combo Components for Wings Combo
  const wingsSideComponent = await prisma.comboComponent.upsert({
    where: { id: 'comp-wings-side' },
    update: {},
    create: {
      id: 'comp-wings-side',
      comboTemplateId: 'combo-template-2',
      slotName: 'side',
      displayName: 'Choose Your Side',
      sortOrder: 1,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
  })

  const wingsDrinkComponent = await prisma.comboComponent.upsert({
    where: { id: 'comp-wings-drink' },
    update: {},
    create: {
      id: 'comp-wings-drink',
      comboTemplateId: 'combo-template-2',
      slotName: 'drink',
      displayName: 'Choose Your Drink',
      sortOrder: 2,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
  })

  // Create Combo Components for Steak Dinner (2 sides)
  const steakSide1Component = await prisma.comboComponent.upsert({
    where: { id: 'comp-steak-side1' },
    update: {},
    create: {
      id: 'comp-steak-side1',
      comboTemplateId: 'combo-template-3',
      slotName: 'side1',
      displayName: 'Choose First Side',
      sortOrder: 1,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
  })

  const steakSide2Component = await prisma.comboComponent.upsert({
    where: { id: 'comp-steak-side2' },
    update: {},
    create: {
      id: 'comp-steak-side2',
      comboTemplateId: 'combo-template-3',
      slotName: 'side2',
      displayName: 'Choose Second Side',
      sortOrder: 2,
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
    },
  })
  console.log('Created combo components')

  // Create Combo Options (link sides and drinks to components)
  const sideOptions = [
    { id: 'side-1', name: 'French Fries' },
    { id: 'side-2', name: 'Onion Rings' },
    { id: 'side-3', name: 'Coleslaw' },
    { id: 'side-4', name: 'Side Salad' },
    { id: 'side-5', name: 'Mashed Potatoes' },
  ]

  const drinkOptions = [
    { id: 'item-11', name: 'Soft Drink' },
    { id: 'item-8', name: 'Draft Beer', upcharge: 3.00 },
  ]

  // Add side options to all side components
  const sideComponents = [
    'comp-burger-side',
    'comp-wings-side',
    'comp-steak-side1',
    'comp-steak-side2',
  ]

  for (const compId of sideComponents) {
    for (let i = 0; i < sideOptions.length; i++) {
      const opt = sideOptions[i]
      await prisma.comboComponentOption.upsert({
        where: { id: `${compId}-${opt.id}` },
        update: {},
        create: {
          id: `${compId}-${opt.id}`,
          comboComponentId: compId,
          menuItemId: opt.id,
          upcharge: opt.id === 'side-2' ? 1.00 : 0, // Onion rings cost extra
          sortOrder: i,
          isAvailable: true,
        },
      })
    }
  }

  // Add drink options to drink components
  const drinkComponents = ['comp-burger-drink', 'comp-wings-drink']

  for (const compId of drinkComponents) {
    for (let i = 0; i < drinkOptions.length; i++) {
      const opt = drinkOptions[i]
      await prisma.comboComponentOption.upsert({
        where: { id: `${compId}-${opt.id}` },
        update: {},
        create: {
          id: `${compId}-${opt.id}`,
          comboComponentId: compId,
          menuItemId: opt.id,
          upcharge: opt.upcharge || 0,
          sortOrder: i,
          isAvailable: true,
        },
      })
    }
  }
  console.log('Created combo options')

  // Create Timed Rental Menu Items (Entertainment)
  const timedItems = [
    {
      id: 'timed-1',
      categoryId: 'cat-6',
      name: 'Pool Table',
      price: 15.00,
      description: 'Per hour rental',
      itemType: 'timed_rental',
      timedPricing: { per15Min: 5.00, per30Min: 8.00, perHour: 15.00, minimum: 15 },
    },
    {
      id: 'timed-2',
      categoryId: 'cat-6',
      name: 'Dart Board',
      price: 10.00,
      description: 'Per hour rental',
      itemType: 'timed_rental',
      timedPricing: { per15Min: 3.00, per30Min: 5.00, perHour: 10.00, minimum: 15 },
    },
    {
      id: 'timed-3',
      categoryId: 'cat-6',
      name: 'Karaoke Room',
      price: 25.00,
      description: 'Private room per hour',
      itemType: 'timed_rental',
      timedPricing: { per30Min: 15.00, perHour: 25.00, minimum: 30 },
    },
    {
      id: 'timed-4',
      categoryId: 'cat-6',
      name: 'Bowling Lane',
      price: 30.00,
      description: 'Per hour rental',
      itemType: 'timed_rental',
      timedPricing: { per30Min: 18.00, perHour: 30.00, minimum: 30 },
    },
  ]

  for (const item of timedItems) {
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
        itemType: item.itemType,
        timedPricing: item.timedPricing,
      },
    })
  }
  console.log('Created', timedItems.length, 'timed rental items')

  // Create Tables
  const tables = [
    { id: 'table-1', name: 'Table 1', capacity: 4, posX: 50, posY: 50 },
    { id: 'table-2', name: 'Table 2', capacity: 4, posX: 200, posY: 50 },
    { id: 'table-3', name: 'Table 3', capacity: 6, posX: 350, posY: 50 },
    { id: 'table-4', name: 'Bar 1', capacity: 2, posX: 50, posY: 200, shape: 'bar' },
    { id: 'table-5', name: 'Bar 2', capacity: 2, posX: 150, posY: 200, shape: 'bar' },
    { id: 'table-6', name: 'Bar 3', capacity: 2, posX: 250, posY: 200, shape: 'bar' },
    { id: 'table-7', name: 'Patio 1', capacity: 4, posX: 50, posY: 350 },
    { id: 'table-8', name: 'Patio 2', capacity: 4, posX: 200, posY: 350 },
  ]

  for (const table of tables) {
    await prisma.table.upsert({
      where: { id: table.id },
      update: {},
      create: {
        id: table.id,
        locationId: location.id,
        name: table.name,
        capacity: table.capacity,
        posX: table.posX,
        posY: table.posY,
        shape: table.shape || 'rectangle',
      },
    })
  }
  console.log('Created', tables.length, 'tables')

  console.log('')
  console.log('========================================')
  console.log('  Database seeded successfully!')
  console.log('========================================')
  console.log('')
  console.log('Demo credentials:')
  console.log('  Manager PIN: 1234')
  console.log('  Server PIN:  2345')
  console.log('  Bartender PIN: 3456')
  console.log('')
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
