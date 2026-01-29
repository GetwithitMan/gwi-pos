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

  // Create Roles with new permission system
  // Manager gets full access to most features
  const managerPermissions = [
    // POS Access
    'pos.access', 'pos.table_service', 'pos.quick_order', 'pos.kds',
    'pos.cash_payments', 'pos.card_payments', 'pos.cash_drawer',
    'pos.view_others_orders', 'pos.edit_others_orders', 'pos.split_checks',
    'pos.change_table', 'pos.change_server', 'pos.no_sale',
    // Manager permissions
    'manager.discounts', 'manager.void_items', 'manager.void_orders',
    'manager.void_payments', 'manager.refunds', 'manager.edit_sent_items',
    'manager.transfer_checks', 'manager.bulk_operations', 'manager.shift_review',
    'manager.cash_drawer_blind', 'manager.cash_drawer_full',
    'manager.cash_variance_override', 'manager.pay_in_out', 'manager.close_day',
    'manager.tax_exempt', 'manager.open_items', 'manager.edit_time_entries',
    'manager.end_breaks_early', 'manager.force_clock_out', 'manager.receive_transfers',
    // Reports
    'reports.view', 'reports.sales', 'reports.sales_by_employee', 'reports.labor',
    'reports.commission', 'reports.product_mix', 'reports.inventory',
    'reports.timesheet', 'reports.tabs', 'reports.paid_in_out', 'reports.customers',
    'reports.voids', 'reports.gift_cards', 'reports.export',
    // Menu
    'menu.view', 'menu.edit_items', 'menu.edit_prices', 'menu.edit_modifiers',
    'menu.inventory_qty', 'menu.86_items',
    // Staff
    'staff.view', 'staff.edit_profile', 'staff.edit_wages', 'staff.manage_roles',
    'staff.assign_roles', 'staff.scheduling', 'staff.clock_others',
    // Tables
    'tables.view', 'tables.edit', 'tables.floor_plan', 'tables.reservations',
    // Settings
    'settings.view', 'settings.edit', 'settings.tax', 'settings.receipts',
    'settings.payments', 'settings.dual_pricing',
  ]

  const managerRole = await prisma.role.upsert({
    where: { id: 'role-manager' },
    update: {
      permissions: managerPermissions,
    },
    create: {
      id: 'role-manager',
      locationId: location.id,
      name: 'Manager',
      permissions: managerPermissions,
    },
  })

  // Server gets basic POS access
  const serverPermissions = [
    'pos.access', 'pos.table_service', 'pos.quick_order',
    'pos.cash_payments', 'pos.card_payments', 'pos.split_checks',
    'pos.change_table',
    'menu.view',
    'tables.view',
  ]

  const serverRole = await prisma.role.upsert({
    where: { id: 'role-server' },
    update: {
      permissions: serverPermissions,
    },
    create: {
      id: 'role-server',
      locationId: location.id,
      name: 'Server',
      permissions: serverPermissions,
    },
  })

  // Bartender gets POS access with cash drawer
  const bartenderPermissions = [
    'pos.access', 'pos.quick_order', 'pos.cash_payments', 'pos.card_payments',
    'pos.cash_drawer', 'pos.split_checks',
    'manager.cash_drawer_blind',
    'menu.view',
  ]

  const bartenderRole = await prisma.role.upsert({
    where: { id: 'role-bartender' },
    update: {
      permissions: bartenderPermissions,
    },
    create: {
      id: 'role-bartender',
      locationId: location.id,
      name: 'Bartender',
      permissions: bartenderPermissions,
    },
  })
  console.log('Created/updated roles: Manager, Server, Bartender')

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
        categoryType: 'food',
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
        categoryType: 'food',
        sortOrder: 2,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-3' },
      update: {},
      create: {
        id: 'cat-3',
        locationId: location.id,
        name: 'Soft Drinks',
        color: '#22c55e',
        categoryType: 'drinks',
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
        categoryType: 'food',
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
        categoryType: 'combos',
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
        categoryType: 'entertainment',
        sortOrder: 6,
      },
    }),
    // LIQUOR CATEGORIES
    prisma.category.upsert({
      where: { id: 'cat-whiskey' },
      update: {},
      create: {
        id: 'cat-whiskey',
        locationId: location.id,
        name: 'Whiskey',
        color: '#92400e',
        categoryType: 'liquor',
        sortOrder: 10,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-vodka' },
      update: {},
      create: {
        id: 'cat-vodka',
        locationId: location.id,
        name: 'Vodka',
        color: '#64748b',
        categoryType: 'liquor',
        sortOrder: 11,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-rum' },
      update: {},
      create: {
        id: 'cat-rum',
        locationId: location.id,
        name: 'Rum',
        color: '#b45309',
        categoryType: 'liquor',
        sortOrder: 12,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-tequila' },
      update: {},
      create: {
        id: 'cat-tequila',
        locationId: location.id,
        name: 'Tequila',
        color: '#65a30d',
        categoryType: 'liquor',
        sortOrder: 13,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-gin' },
      update: {},
      create: {
        id: 'cat-gin',
        locationId: location.id,
        name: 'Gin',
        color: '#0891b2',
        categoryType: 'liquor',
        sortOrder: 14,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-cocktails' },
      update: {},
      create: {
        id: 'cat-cocktails',
        locationId: location.id,
        name: 'Cocktails',
        color: '#db2777',
        categoryType: 'liquor',
        sortOrder: 15,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-beer' },
      update: {},
      create: {
        id: 'cat-beer',
        locationId: location.id,
        name: 'Beer',
        color: '#ca8a04',
        categoryType: 'drinks',
        sortOrder: 16,
      },
    }),
    prisma.category.upsert({
      where: { id: 'cat-wine' },
      update: {},
      create: {
        id: 'cat-wine',
        locationId: location.id,
        name: 'Wine',
        color: '#7c2d12',
        categoryType: 'drinks',
        sortOrder: 17,
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
    // Soft Drinks
    { id: 'item-11', categoryId: 'cat-3', name: 'Coca-Cola', price: 2.99, description: 'Classic Coke' },
    { id: 'item-11b', categoryId: 'cat-3', name: 'Diet Coke', price: 2.99, description: 'Diet Coca-Cola' },
    { id: 'item-11c', categoryId: 'cat-3', name: 'Sprite', price: 2.99, description: 'Lemon-lime soda' },
    { id: 'item-11d', categoryId: 'cat-3', name: 'Dr Pepper', price: 2.99, description: 'Dr Pepper' },
    { id: 'item-11e', categoryId: 'cat-3', name: 'Lemonade', price: 3.49, description: 'Fresh-squeezed lemonade' },
    { id: 'item-11f', categoryId: 'cat-3', name: 'Iced Tea', price: 2.99, description: 'Sweet or unsweet' },
    { id: 'item-11g', categoryId: 'cat-3', name: 'Coffee', price: 2.49, description: 'Fresh brewed coffee' },
    { id: 'item-11h', categoryId: 'cat-3', name: 'Red Bull', price: 4.99, description: 'Energy drink' },
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

  // =====================================================
  // LIQUOR ITEMS - With pour size options
  // =====================================================

  const defaultPourSizes = { shot: 1.0, double: 2.0, tall: 1.5, short: 0.75 }

  // WHISKEY
  const whiskeyItems = [
    // Well
    { id: 'whiskey-well', name: 'House Whiskey', price: 5.00, description: 'Well bourbon' },
    // Bourbon - Call
    { id: 'whiskey-jim', name: 'Jim Beam', price: 6.00, description: 'Kentucky straight bourbon' },
    { id: 'whiskey-evan', name: 'Evan Williams', price: 5.50, description: 'Kentucky bourbon' },
    { id: 'whiskey-buffalo', name: 'Buffalo Trace', price: 7.00, description: 'Kentucky straight bourbon' },
    // Bourbon - Premium
    { id: 'whiskey-makers', name: "Maker's Mark", price: 8.00, description: 'Kentucky bourbon' },
    { id: 'whiskey-woodford', name: 'Woodford Reserve', price: 9.00, description: 'Small batch bourbon' },
    { id: 'whiskey-bulleit', name: 'Bulleit Bourbon', price: 8.00, description: 'High-rye bourbon' },
    { id: 'whiskey-knob', name: 'Knob Creek', price: 9.00, description: '9 year bourbon' },
    // Bourbon - Top Shelf
    { id: 'whiskey-blantons', name: "Blanton's", price: 15.00, description: 'Single barrel bourbon' },
    { id: 'whiskey-eagle', name: 'Eagle Rare', price: 12.00, description: '10 year bourbon' },
    // Rye
    { id: 'whiskey-bulleit-rye', name: 'Bulleit Rye', price: 8.00, description: '95% rye whiskey' },
    { id: 'whiskey-rittenhouse', name: 'Rittenhouse Rye', price: 8.00, description: 'Bottled in bond rye' },
    { id: 'whiskey-sazerac', name: 'Sazerac Rye', price: 9.00, description: 'Baby Saz' },
    // Tennessee
    { id: 'whiskey-jd', name: 'Jack Daniels', price: 7.00, description: 'Tennessee whiskey' },
    { id: 'whiskey-jd-honey', name: 'Jack Honey', price: 7.00, description: 'Tennessee honey' },
    { id: 'whiskey-jd-fire', name: 'Jack Fire', price: 7.00, description: 'Cinnamon whiskey' },
    { id: 'whiskey-gentleman', name: 'Gentleman Jack', price: 9.00, description: 'Double mellowed' },
    // Scotch
    { id: 'whiskey-dewars', name: "Dewar's", price: 7.00, description: 'Blended Scotch' },
    { id: 'whiskey-jw-red', name: 'Johnnie Walker Red', price: 7.00, description: 'Blended Scotch' },
    { id: 'whiskey-jw-black', name: 'Johnnie Walker Black', price: 10.00, description: '12 year blend' },
    { id: 'whiskey-glenlivet', name: 'Glenlivet 12', price: 12.00, description: 'Single malt Speyside' },
    { id: 'whiskey-glenfiddich', name: 'Glenfiddich 12', price: 12.00, description: 'Single malt Speyside' },
    { id: 'whiskey-macallan', name: 'Macallan 12', price: 15.00, description: 'Single malt sherry oak' },
    // Irish
    { id: 'whiskey-jameson', name: 'Jameson', price: 7.00, description: 'Irish whiskey' },
    { id: 'whiskey-bushmills', name: 'Bushmills', price: 7.00, description: 'Irish whiskey' },
    { id: 'whiskey-tullamore', name: 'Tullamore DEW', price: 7.00, description: 'Irish whiskey' },
    // Canadian
    { id: 'whiskey-crown', name: 'Crown Royal', price: 8.00, description: 'Canadian whisky' },
    { id: 'whiskey-crown-apple', name: 'Crown Apple', price: 8.00, description: 'Apple flavored' },
    { id: 'whiskey-seagrams', name: "Seagram's 7", price: 6.00, description: 'Blended whiskey' },
    { id: 'whiskey-fireball', name: 'Fireball', price: 6.00, description: 'Cinnamon whisky' },
  ]

  for (const item of whiskeyItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-whiskey',
        name: item.name,
        price: item.price,
        description: item.description,
        pourSizes: defaultPourSizes,
        defaultPourSize: 'shot',
        applyPourToModifiers: true,
      },
    })
  }
  console.log('Created', whiskeyItems.length, 'whiskey items')

  // VODKA
  const vodkaItems = [
    // Well
    { id: 'vodka-well', name: 'House Vodka', price: 5.00, description: 'Well vodka' },
    // Call
    { id: 'vodka-smirnoff', name: 'Smirnoff', price: 6.00, description: 'Triple distilled' },
    { id: 'vodka-absolut', name: 'Absolut', price: 7.00, description: 'Swedish vodka' },
    { id: 'vodka-stoli', name: 'Stolichnaya', price: 7.00, description: 'Russian vodka' },
    { id: 'vodka-skyy', name: 'Skyy', price: 6.00, description: 'American vodka' },
    // Premium
    { id: 'vodka-ketel', name: 'Ketel One', price: 9.00, description: 'Dutch vodka' },
    { id: 'vodka-titos', name: "Tito's", price: 8.00, description: 'Handmade Texas vodka' },
    { id: 'vodka-deep', name: 'Deep Eddy', price: 7.00, description: 'Austin, Texas vodka' },
    { id: 'vodka-dripping', name: 'Dripping Springs', price: 8.00, description: 'Texas Hill Country' },
    // Flavored
    { id: 'vodka-deep-lemon', name: 'Deep Eddy Lemon', price: 7.00, description: 'Lemon vodka' },
    { id: 'vodka-deep-peach', name: 'Deep Eddy Peach', price: 7.00, description: 'Peach vodka' },
    { id: 'vodka-deep-cran', name: 'Deep Eddy Cranberry', price: 7.00, description: 'Cranberry vodka' },
    { id: 'vodka-absolut-citron', name: 'Absolut Citron', price: 7.00, description: 'Lemon vodka' },
    { id: 'vodka-absolut-vanilla', name: 'Absolut Vanilla', price: 7.00, description: 'Vanilla vodka' },
    // Top Shelf
    { id: 'vodka-grey', name: 'Grey Goose', price: 12.00, description: 'French vodka' },
    { id: 'vodka-belvedere', name: 'Belvedere', price: 12.00, description: 'Polish vodka' },
    { id: 'vodka-ciroc', name: 'Ciroc', price: 12.00, description: 'French grape vodka' },
    { id: 'vodka-chopin', name: 'Chopin', price: 11.00, description: 'Polish potato vodka' },
  ]

  for (const item of vodkaItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-vodka',
        name: item.name,
        price: item.price,
        description: item.description,
        pourSizes: defaultPourSizes,
        defaultPourSize: 'shot',
        applyPourToModifiers: true,
      },
    })
  }
  console.log('Created', vodkaItems.length, 'vodka items')

  // RUM
  const rumItems = [
    // Well
    { id: 'rum-well', name: 'House Rum', price: 5.00, description: 'Well white rum' },
    // White Rum
    { id: 'rum-bacardi', name: 'Bacardi Superior', price: 6.00, description: 'White rum' },
    { id: 'rum-malibu', name: 'Malibu', price: 6.00, description: 'Coconut rum' },
    { id: 'rum-havana', name: 'Havana Club 3', price: 7.00, description: 'Cuban style rum' },
    // Spiced
    { id: 'rum-captain', name: 'Captain Morgan', price: 6.00, description: 'Original spiced' },
    { id: 'rum-kraken', name: 'Kraken', price: 7.00, description: 'Black spiced rum' },
    { id: 'rum-sailor', name: 'Sailor Jerry', price: 7.00, description: 'Spiced navy rum' },
    // Dark/Aged
    { id: 'rum-myers', name: "Myers's", price: 7.00, description: 'Jamaican dark rum' },
    { id: 'rum-appleton', name: 'Appleton Estate', price: 8.00, description: 'Jamaican rum' },
    { id: 'rum-mount-gay', name: 'Mount Gay', price: 8.00, description: 'Barbados rum' },
    { id: 'rum-diplomatico', name: 'Diplomatico Reserva', price: 12.00, description: 'Venezuelan rum' },
    { id: 'rum-zacapa', name: 'Ron Zacapa 23', price: 14.00, description: 'Guatemalan rum' },
    // Flavored
    { id: 'rum-bacardi-lime', name: 'Bacardi Lime', price: 6.00, description: 'Lime rum' },
    { id: 'rum-bacardi-mango', name: 'Bacardi Mango', price: 6.00, description: 'Mango rum' },
    { id: 'rum-parrot', name: 'Parrot Bay', price: 6.00, description: 'Coconut rum' },
  ]

  for (const item of rumItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-rum',
        name: item.name,
        price: item.price,
        description: item.description,
        pourSizes: defaultPourSizes,
        defaultPourSize: 'shot',
        applyPourToModifiers: true,
      },
    })
  }
  console.log('Created', rumItems.length, 'rum items')

  // TEQUILA
  const tequilaItems = [
    // Well
    { id: 'tequila-well', name: 'House Tequila', price: 5.00, description: 'Well blanco' },
    // Blanco
    { id: 'tequila-cuervo-silver', name: 'Jose Cuervo Silver', price: 6.00, description: 'Silver tequila' },
    { id: 'tequila-sauza-silver', name: 'Sauza Silver', price: 6.00, description: 'Blanco tequila' },
    { id: 'tequila-espolon-blanco', name: 'Espolon Blanco', price: 8.00, description: 'Premium blanco' },
    { id: 'tequila-hornitos-plata', name: 'Hornitos Plata', price: 7.00, description: 'Plata tequila' },
    { id: 'tequila-1800-silver', name: '1800 Silver', price: 9.00, description: 'Premium silver' },
    { id: 'tequila-casamigos-blanco', name: 'Casamigos Blanco', price: 12.00, description: 'Ultra-premium blanco' },
    { id: 'tequila-patron-silver', name: 'Patron Silver', price: 12.00, description: 'Premium silver' },
    { id: 'tequila-don-julio-blanco', name: 'Don Julio Blanco', price: 13.00, description: 'Premium blanco' },
    { id: 'tequila-clase-azul-plata', name: 'Clase Azul Plata', price: 20.00, description: 'Ultra-premium' },
    // Reposado
    { id: 'tequila-cuervo-gold', name: 'Jose Cuervo Gold', price: 6.00, description: 'Gold tequila' },
    { id: 'tequila-espolon-repo', name: 'Espolon Reposado', price: 8.00, description: 'Aged 6 months' },
    { id: 'tequila-hornitos-repo', name: 'Hornitos Reposado', price: 7.00, description: 'Aged in oak' },
    { id: 'tequila-1800-repo', name: '1800 Reposado', price: 9.00, description: 'Aged 6 months' },
    { id: 'tequila-casamigos-repo', name: 'Casamigos Reposado', price: 13.00, description: 'Aged 7 months' },
    { id: 'tequila-patron-repo', name: 'Patron Reposado', price: 13.00, description: 'Aged in oak' },
    { id: 'tequila-don-julio-repo', name: 'Don Julio Reposado', price: 14.00, description: 'Aged 8 months' },
    // Anejo
    { id: 'tequila-1800-anejo', name: '1800 Anejo', price: 11.00, description: 'Aged 14 months' },
    { id: 'tequila-casamigos-anejo', name: 'Casamigos Anejo', price: 15.00, description: 'Aged 14 months' },
    { id: 'tequila-patron-anejo', name: 'Patron Anejo', price: 15.00, description: 'Aged 12 months' },
    { id: 'tequila-don-julio-anejo', name: 'Don Julio Anejo', price: 16.00, description: 'Aged 18 months' },
    { id: 'tequila-don-julio-1942', name: 'Don Julio 1942', price: 28.00, description: 'Extra anejo' },
  ]

  for (const item of tequilaItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-tequila',
        name: item.name,
        price: item.price,
        description: item.description,
        pourSizes: defaultPourSizes,
        defaultPourSize: 'shot',
        applyPourToModifiers: true,
      },
    })
  }
  console.log('Created', tequilaItems.length, 'tequila items')

  // GIN
  const ginItems = [
    // Well
    { id: 'gin-well', name: 'House Gin', price: 5.00, description: 'Well gin' },
    // Call
    { id: 'gin-beefeater', name: 'Beefeater', price: 6.00, description: 'London dry gin' },
    { id: 'gin-gordons', name: "Gordon's", price: 6.00, description: 'London dry gin' },
    { id: 'gin-tanqueray', name: 'Tanqueray', price: 8.00, description: 'London dry gin' },
    { id: 'gin-bombay', name: 'Bombay Sapphire', price: 8.00, description: 'Vapor infused gin' },
    // Premium
    { id: 'gin-hendricks', name: "Hendrick's", price: 10.00, description: 'Scottish gin, cucumber & rose' },
    { id: 'gin-aviation', name: 'Aviation', price: 9.00, description: 'American gin' },
    { id: 'gin-roku', name: 'Roku', price: 10.00, description: 'Japanese craft gin' },
    { id: 'gin-st-germain', name: 'The Botanist', price: 11.00, description: 'Islay dry gin' },
    { id: 'gin-empress', name: 'Empress 1908', price: 10.00, description: 'Color-changing gin' },
    // Top Shelf
    { id: 'gin-monkey', name: 'Monkey 47', price: 14.00, description: 'German dry gin' },
    { id: 'gin-tanq-10', name: 'Tanqueray No. Ten', price: 11.00, description: 'Small batch gin' },
    { id: 'gin-nolets', name: "Nolet's Silver", price: 13.00, description: 'Dutch gin' },
  ]

  for (const item of ginItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-gin',
        name: item.name,
        price: item.price,
        description: item.description,
        pourSizes: defaultPourSizes,
        defaultPourSize: 'shot',
        applyPourToModifiers: true,
      },
    })
  }
  console.log('Created', ginItems.length, 'gin items')

  // COCKTAILS
  const cocktailItems = [
    // Whiskey Cocktails
    { id: 'cocktail-old-fashioned', name: 'Old Fashioned', price: 11.00, description: 'Bourbon, bitters, sugar, orange' },
    { id: 'cocktail-manhattan', name: 'Manhattan', price: 12.00, description: 'Rye, sweet vermouth, bitters' },
    { id: 'cocktail-whiskey-sour', name: 'Whiskey Sour', price: 10.00, description: 'Bourbon, lemon, simple syrup' },
    { id: 'cocktail-mint-julep', name: 'Mint Julep', price: 10.00, description: 'Bourbon, mint, sugar' },
    { id: 'cocktail-jack-coke', name: 'Jack & Coke', price: 8.00, description: 'Jack Daniels and Coca-Cola' },
    // Vodka Cocktails
    { id: 'cocktail-moscow-mule', name: 'Moscow Mule', price: 10.00, description: 'Vodka, ginger beer, lime' },
    { id: 'cocktail-cosmopolitan', name: 'Cosmopolitan', price: 11.00, description: 'Vodka, triple sec, cranberry, lime' },
    { id: 'cocktail-bloody-mary', name: 'Bloody Mary', price: 10.00, description: 'Vodka, tomato, spices' },
    { id: 'cocktail-lemon-drop', name: 'Lemon Drop', price: 10.00, description: 'Vodka, lemon, triple sec, sugar' },
    { id: 'cocktail-vodka-martini', name: 'Vodka Martini', price: 11.00, description: 'Vodka, dry vermouth, olives' },
    { id: 'cocktail-screwdriver', name: 'Screwdriver', price: 8.00, description: 'Vodka and orange juice' },
    { id: 'cocktail-vodka-tonic', name: 'Vodka Tonic', price: 8.00, description: 'Vodka and tonic water' },
    { id: 'cocktail-vodka-soda', name: 'Vodka Soda', price: 7.00, description: 'Vodka and soda water' },
    // Rum Cocktails
    { id: 'cocktail-mojito', name: 'Mojito', price: 10.00, description: 'Rum, mint, lime, soda' },
    { id: 'cocktail-daiquiri', name: 'Daiquiri', price: 10.00, description: 'Rum, lime, simple syrup' },
    { id: 'cocktail-pina-colada', name: 'Pina Colada', price: 11.00, description: 'Rum, coconut, pineapple' },
    { id: 'cocktail-dark-stormy', name: 'Dark & Stormy', price: 10.00, description: 'Dark rum, ginger beer, lime' },
    { id: 'cocktail-cuba-libre', name: 'Cuba Libre', price: 8.00, description: 'Rum, Coke, lime' },
    { id: 'cocktail-mai-tai', name: 'Mai Tai', price: 12.00, description: 'Rum, curacao, orgeat, lime' },
    { id: 'cocktail-zombie', name: 'Zombie', price: 14.00, description: 'Multiple rums, tropical' },
    // Tequila Cocktails
    { id: 'cocktail-margarita', name: 'Margarita', price: 10.00, description: 'Tequila, lime, triple sec' },
    { id: 'cocktail-marg-frozen', name: 'Frozen Margarita', price: 10.00, description: 'Blended with ice' },
    { id: 'cocktail-marg-rocks', name: 'Margarita on Rocks', price: 10.00, description: 'Served over ice' },
    { id: 'cocktail-paloma', name: 'Paloma', price: 10.00, description: 'Tequila, grapefruit, lime' },
    { id: 'cocktail-tequila-sunrise', name: 'Tequila Sunrise', price: 9.00, description: 'Tequila, OJ, grenadine' },
    { id: 'cocktail-ranch-water', name: 'Ranch Water', price: 9.00, description: 'Tequila, lime, Topo Chico' },
    { id: 'cocktail-mexican-mule', name: 'Mexican Mule', price: 10.00, description: 'Tequila, ginger beer, lime' },
    // Gin Cocktails
    { id: 'cocktail-gin-tonic', name: 'Gin & Tonic', price: 9.00, description: 'Gin and tonic water' },
    { id: 'cocktail-gin-martini', name: 'Gin Martini', price: 12.00, description: 'Gin, dry vermouth, olives' },
    { id: 'cocktail-negroni', name: 'Negroni', price: 12.00, description: 'Gin, Campari, sweet vermouth' },
    { id: 'cocktail-tom-collins', name: 'Tom Collins', price: 10.00, description: 'Gin, lemon, simple, soda' },
    { id: 'cocktail-gimlet', name: 'Gimlet', price: 10.00, description: 'Gin, lime cordial' },
    { id: 'cocktail-french-75', name: 'French 75', price: 13.00, description: 'Gin, champagne, lemon' },
    { id: 'cocktail-aviation', name: 'Aviation', price: 12.00, description: 'Gin, maraschino, creme de violette' },
    // Specialty Cocktails
    { id: 'cocktail-long-island', name: 'Long Island Iced Tea', price: 12.00, description: 'Vodka, gin, rum, tequila, triple sec' },
    { id: 'cocktail-amaretto-sour', name: 'Amaretto Sour', price: 9.00, description: 'Amaretto, lemon, simple' },
    { id: 'cocktail-espresso-martini', name: 'Espresso Martini', price: 13.00, description: 'Vodka, espresso, Kahlua' },
  ]

  for (const item of cocktailItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-cocktails',
        name: item.name,
        price: item.price,
        description: item.description,
      },
    })
  }
  console.log('Created', cocktailItems.length, 'cocktail items')

  // BEER
  const beerItems = [
    // Domestic
    { id: 'beer-bud', name: 'Budweiser', price: 4.00, description: 'American lager' },
    { id: 'beer-bud-light', name: 'Bud Light', price: 4.00, description: 'Light lager' },
    { id: 'beer-coors', name: 'Coors Light', price: 4.00, description: 'Light lager' },
    { id: 'beer-miller', name: 'Miller Lite', price: 4.00, description: 'Light lager' },
    { id: 'beer-michelob', name: 'Michelob Ultra', price: 4.50, description: 'Ultra light lager' },
    { id: 'beer-pbr', name: 'Pabst Blue Ribbon', price: 3.50, description: 'Classic American lager' },
    { id: 'beer-lone-star', name: 'Lone Star', price: 3.50, description: 'National beer of Texas' },
    // Import
    { id: 'beer-corona', name: 'Corona', price: 5.00, description: 'Mexican lager' },
    { id: 'beer-modelo', name: 'Modelo Especial', price: 5.00, description: 'Mexican lager' },
    { id: 'beer-negra', name: 'Negra Modelo', price: 5.00, description: 'Dark Mexican lager' },
    { id: 'beer-pacifico', name: 'Pacifico', price: 5.00, description: 'Mexican pilsner' },
    { id: 'beer-dos-equis', name: 'Dos Equis Lager', price: 5.00, description: 'Mexican lager' },
    { id: 'beer-heineken', name: 'Heineken', price: 5.00, description: 'Dutch lager' },
    { id: 'beer-stella', name: 'Stella Artois', price: 5.50, description: 'Belgian lager' },
    { id: 'beer-guinness', name: 'Guinness', price: 6.00, description: 'Irish stout' },
    // Craft / Local
    { id: 'beer-shiner', name: 'Shiner Bock', price: 4.50, description: 'Texas bock' },
    { id: 'beer-fireman', name: "Fireman's 4", price: 5.00, description: 'Texas blonde' },
    { id: 'beer-512', name: '512 Pale Ale', price: 5.50, description: 'Austin pale ale' },
    { id: 'beer-la-ipa', name: 'Live Oak IPA', price: 6.00, description: 'Austin IPA' },
    { id: 'beer-la-hef', name: 'Live Oak Hefeweizen', price: 5.50, description: 'Austin wheat beer' },
    { id: 'beer-blue-moon', name: 'Blue Moon', price: 5.00, description: 'Belgian white' },
    { id: 'beer-fat-tire', name: 'Fat Tire', price: 5.00, description: 'Amber ale' },
    // IPA
    { id: 'beer-lagunitas', name: 'Lagunitas IPA', price: 5.50, description: 'West coast IPA' },
    { id: 'beer-sierra', name: 'Sierra Nevada Pale', price: 5.00, description: 'California pale ale' },
    { id: 'beer-stone', name: 'Stone IPA', price: 6.00, description: 'San Diego IPA' },
    // Cider / Seltzer
    { id: 'beer-angry', name: 'Angry Orchard', price: 5.00, description: 'Apple cider' },
    { id: 'beer-white-claw', name: 'White Claw', price: 5.00, description: 'Hard seltzer' },
    { id: 'beer-truly', name: 'Truly', price: 5.00, description: 'Hard seltzer' },
  ]

  for (const item of beerItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-beer',
        name: item.name,
        price: item.price,
        description: item.description,
      },
    })
  }
  console.log('Created', beerItems.length, 'beer items')

  // WINE
  const wineItems = [
    // House
    { id: 'wine-house-red', name: 'House Red', price: 7.00, description: 'Red blend' },
    { id: 'wine-house-white', name: 'House White', price: 7.00, description: 'White blend' },
    // Red
    { id: 'wine-cab', name: 'Cabernet Sauvignon', price: 9.00, description: 'Full-bodied red' },
    { id: 'wine-merlot', name: 'Merlot', price: 8.00, description: 'Medium-bodied red' },
    { id: 'wine-pinot-noir', name: 'Pinot Noir', price: 10.00, description: 'Light-bodied red' },
    { id: 'wine-malbec', name: 'Malbec', price: 9.00, description: 'Argentine red' },
    { id: 'wine-zin', name: 'Zinfandel', price: 8.00, description: 'Bold red' },
    // White
    { id: 'wine-chard', name: 'Chardonnay', price: 8.00, description: 'Full-bodied white' },
    { id: 'wine-sauv-blanc', name: 'Sauvignon Blanc', price: 8.00, description: 'Crisp white' },
    { id: 'wine-pinot-grigio', name: 'Pinot Grigio', price: 8.00, description: 'Light white' },
    { id: 'wine-riesling', name: 'Riesling', price: 8.00, description: 'Sweet white' },
    { id: 'wine-moscato', name: 'Moscato', price: 8.00, description: 'Sweet Italian' },
    // Rose / Sparkling
    { id: 'wine-rose', name: 'Rose', price: 9.00, description: 'Dry rose' },
    { id: 'wine-prosecco', name: 'Prosecco', price: 9.00, description: 'Italian sparkling' },
    { id: 'wine-champagne', name: 'Champagne', price: 14.00, description: 'French sparkling' },
    { id: 'wine-mimosa', name: 'Mimosa', price: 8.00, description: 'Champagne and OJ' },
  ]

  for (const item of wineItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        locationId: location.id,
        categoryId: 'cat-wine',
        name: item.name,
        price: item.price,
        description: item.description,
      },
    })
  }
  console.log('Created', wineItems.length, 'wine items')

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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
      locationId: location.id,
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
    { id: 'item-11', name: 'Coca-Cola' },
    { id: 'item-11f', name: 'Iced Tea' },
    { id: 'item-11e', name: 'Lemonade', upcharge: 0.50 },
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
          locationId: location.id,
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
          locationId: location.id,
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

  // =====================================================
  // MODIFIER GROUPS
  // =====================================================

  // LIQUOR MODIFIERS - Mixers
  const mixersGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-mixers' },
    update: {},
    create: {
      id: 'mod-mixers',
      locationId: location.id,
      name: 'Mixers',
      displayName: 'Add Mixer',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 3,
      isRequired: false,
      sortOrder: 1,
    },
  })

  const mixers = [
    { id: 'mixer-coke', name: 'Coke', price: 0 },
    { id: 'mixer-diet-coke', name: 'Diet Coke', price: 0 },
    { id: 'mixer-sprite', name: 'Sprite', price: 0 },
    { id: 'mixer-ginger-ale', name: 'Ginger Ale', price: 0 },
    { id: 'mixer-tonic', name: 'Tonic Water', price: 0 },
    { id: 'mixer-soda', name: 'Soda Water', price: 0 },
    { id: 'mixer-cranberry', name: 'Cranberry Juice', price: 0 },
    { id: 'mixer-oj', name: 'Orange Juice', price: 0 },
    { id: 'mixer-pineapple', name: 'Pineapple Juice', price: 0 },
    { id: 'mixer-grapefruit', name: 'Grapefruit Juice', price: 0 },
    { id: 'mixer-redbull', name: 'Red Bull', price: 3.00 },
    { id: 'mixer-ginger-beer', name: 'Ginger Beer', price: 1.00 },
    { id: 'mixer-topo', name: 'Topo Chico', price: 1.00 },
    { id: 'mixer-sweet-sour', name: 'Sweet & Sour', price: 0 },
    { id: 'mixer-water', name: 'Water Back', price: 0 },
    { id: 'mixer-pickle', name: 'Pickle Juice', price: 0 },
  ]

  for (const mod of mixers) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: mixersGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: mixers.indexOf(mod),
      },
    })
  }
  console.log('Created', mixers.length, 'mixer modifiers')

  // Garnishes
  const garnishGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-garnish' },
    update: {},
    create: {
      id: 'mod-garnish',
      locationId: location.id,
      name: 'Garnish',
      displayName: 'Garnish',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 5,
      isRequired: false,
      sortOrder: 2,
    },
  })

  const garnishes = [
    { id: 'garnish-lime', name: 'Lime', price: 0 },
    { id: 'garnish-lemon', name: 'Lemon', price: 0 },
    { id: 'garnish-orange', name: 'Orange', price: 0 },
    { id: 'garnish-cherry', name: 'Cherry', price: 0 },
    { id: 'garnish-olive', name: 'Olive', price: 0 },
    { id: 'garnish-olive-2', name: 'Extra Olives', price: 0.50 },
    { id: 'garnish-onion', name: 'Cocktail Onion', price: 0 },
    { id: 'garnish-celery', name: 'Celery Stalk', price: 0 },
    { id: 'garnish-mint', name: 'Fresh Mint', price: 0 },
    { id: 'garnish-salt', name: 'Salt Rim', price: 0 },
    { id: 'garnish-sugar', name: 'Sugar Rim', price: 0 },
    { id: 'garnish-tajin', name: 'Tajin Rim', price: 0.50 },
    { id: 'garnish-no', name: 'No Garnish', price: 0 },
  ]

  for (const mod of garnishes) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: garnishGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: garnishes.indexOf(mod),
      },
    })
  }
  console.log('Created', garnishes.length, 'garnish modifiers')

  // Ice Preference
  const iceGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-ice' },
    update: {},
    create: {
      id: 'mod-ice',
      locationId: location.id,
      name: 'Ice',
      displayName: 'Ice Preference',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      sortOrder: 3,
    },
  })

  const iceOptions = [
    { id: 'ice-regular', name: 'Regular Ice', price: 0, isDefault: true },
    { id: 'ice-light', name: 'Light Ice', price: 0 },
    { id: 'ice-extra', name: 'Extra Ice', price: 0 },
    { id: 'ice-no', name: 'No Ice', price: 0 },
    { id: 'ice-neat', name: 'Neat', price: 0 },
    { id: 'ice-rocks', name: 'On the Rocks', price: 0 },
    { id: 'ice-up', name: 'Up', price: 0 },
  ]

  for (const mod of iceOptions) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: iceGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: iceOptions.indexOf(mod),
      },
    })
  }
  console.log('Created', iceOptions.length, 'ice modifiers')

  // Margarita Style
  const margStyleGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-marg-style' },
    update: {},
    create: {
      id: 'mod-marg-style',
      locationId: location.id,
      name: 'Margarita Style',
      displayName: 'Style',
      modifierTypes: ['liquor'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 4,
    },
  })

  const margStyles = [
    { id: 'marg-rocks', name: 'On the Rocks', price: 0, isDefault: true },
    { id: 'marg-frozen', name: 'Frozen/Blended', price: 0 },
    { id: 'marg-up', name: 'Up', price: 0 },
  ]

  for (const mod of margStyles) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: margStyleGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: margStyles.indexOf(mod),
      },
    })
  }
  console.log('Created margarita style modifiers')

  // Margarita Flavor
  const margFlavorGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-marg-flavor' },
    update: {},
    create: {
      id: 'mod-marg-flavor',
      locationId: location.id,
      name: 'Margarita Flavor',
      displayName: 'Flavor',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      sortOrder: 5,
    },
  })

  const margFlavors = [
    { id: 'marg-classic', name: 'Classic Lime', price: 0, isDefault: true },
    { id: 'marg-strawberry', name: 'Strawberry', price: 1.00 },
    { id: 'marg-mango', name: 'Mango', price: 1.00 },
    { id: 'marg-peach', name: 'Peach', price: 1.00 },
    { id: 'marg-raspberry', name: 'Raspberry', price: 1.00 },
    { id: 'marg-blood-orange', name: 'Blood Orange', price: 1.00 },
    { id: 'marg-prickly-pear', name: 'Prickly Pear', price: 1.50 },
    { id: 'marg-watermelon', name: 'Watermelon', price: 1.00 },
    { id: 'marg-jalapeno', name: 'Spicy Jalapeno', price: 1.00 },
  ]

  for (const mod of margFlavors) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: margFlavorGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: margFlavors.indexOf(mod),
      },
    })
  }
  console.log('Created margarita flavor modifiers')

  // Tequila Upgrade for Cocktails
  const tequilaUpgradeGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-tequila-upgrade' },
    update: {},
    create: {
      id: 'mod-tequila-upgrade',
      locationId: location.id,
      name: 'Tequila Choice',
      displayName: 'Upgrade Tequila',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      isSpiritGroup: true,
      sortOrder: 6,
    },
  })

  const tequilaUpgrades = [
    { id: 'tequila-up-well', name: 'House Tequila', price: 0, tier: 'well', isDefault: true, linkedItemId: 'tequila-well' },
    { id: 'tequila-up-espolon', name: 'Espolon Blanco', price: 3.00, tier: 'call', linkedItemId: 'tequila-espolon-blanco' },
    { id: 'tequila-up-hornitos', name: 'Hornitos Plata', price: 2.00, tier: 'call', linkedItemId: 'tequila-hornitos-plata' },
    { id: 'tequila-up-1800', name: '1800 Silver', price: 4.00, tier: 'premium', linkedItemId: 'tequila-1800-silver' },
    { id: 'tequila-up-casamigos', name: 'Casamigos Blanco', price: 7.00, tier: 'premium', linkedItemId: 'tequila-casamigos-blanco' },
    { id: 'tequila-up-patron', name: 'Patron Silver', price: 7.00, tier: 'top_shelf', linkedItemId: 'tequila-patron-silver' },
    { id: 'tequila-up-don-julio', name: 'Don Julio Blanco', price: 8.00, tier: 'top_shelf', linkedItemId: 'tequila-don-julio-blanco' },
  ]

  for (const mod of tequilaUpgrades) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: tequilaUpgradeGroup.id,
        name: mod.name,
        price: mod.price,
        priceType: 'upcharge',
        spiritTier: mod.tier,
        linkedMenuItemId: mod.linkedItemId,
        isDefault: mod.isDefault || false,
        sortOrder: tequilaUpgrades.indexOf(mod),
      },
    })
  }
  console.log('Created tequila upgrade modifiers')

  // Vodka Upgrade for Cocktails
  const vodkaUpgradeGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-vodka-upgrade' },
    update: {},
    create: {
      id: 'mod-vodka-upgrade',
      locationId: location.id,
      name: 'Vodka Choice',
      displayName: 'Upgrade Vodka',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      isSpiritGroup: true,
      sortOrder: 7,
    },
  })

  const vodkaUpgrades = [
    { id: 'vodka-up-well', name: 'House Vodka', price: 0, tier: 'well', isDefault: true, linkedItemId: 'vodka-well' },
    { id: 'vodka-up-smirnoff', name: 'Smirnoff', price: 1.00, tier: 'call', linkedItemId: 'vodka-smirnoff' },
    { id: 'vodka-up-absolut', name: 'Absolut', price: 2.00, tier: 'call', linkedItemId: 'vodka-absolut' },
    { id: 'vodka-up-titos', name: "Tito's", price: 3.00, tier: 'premium', linkedItemId: 'vodka-titos' },
    { id: 'vodka-up-ketel', name: 'Ketel One', price: 4.00, tier: 'premium', linkedItemId: 'vodka-ketel' },
    { id: 'vodka-up-grey', name: 'Grey Goose', price: 7.00, tier: 'top_shelf', linkedItemId: 'vodka-grey' },
    { id: 'vodka-up-belvedere', name: 'Belvedere', price: 7.00, tier: 'top_shelf', linkedItemId: 'vodka-belvedere' },
  ]

  for (const mod of vodkaUpgrades) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: vodkaUpgradeGroup.id,
        name: mod.name,
        price: mod.price,
        priceType: 'upcharge',
        spiritTier: mod.tier,
        linkedMenuItemId: mod.linkedItemId,
        isDefault: mod.isDefault || false,
        sortOrder: vodkaUpgrades.indexOf(mod),
      },
    })
  }
  console.log('Created vodka upgrade modifiers')

  // Rum Upgrade for Cocktails
  const rumUpgradeGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-rum-upgrade' },
    update: {},
    create: {
      id: 'mod-rum-upgrade',
      locationId: location.id,
      name: 'Rum Choice',
      displayName: 'Upgrade Rum',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      isSpiritGroup: true,
      sortOrder: 8,
    },
  })

  const rumUpgrades = [
    { id: 'rum-up-well', name: 'House Rum', price: 0, tier: 'well', isDefault: true, linkedItemId: 'rum-well' },
    { id: 'rum-up-bacardi', name: 'Bacardi Superior', price: 1.00, tier: 'call', linkedItemId: 'rum-bacardi' },
    { id: 'rum-up-captain', name: 'Captain Morgan', price: 1.00, tier: 'call', linkedItemId: 'rum-captain' },
    { id: 'rum-up-malibu', name: 'Malibu', price: 1.00, tier: 'call', linkedItemId: 'rum-malibu' },
    { id: 'rum-up-mount-gay', name: 'Mount Gay', price: 3.00, tier: 'premium', linkedItemId: 'rum-mount-gay' },
    { id: 'rum-up-appleton', name: 'Appleton Estate', price: 3.00, tier: 'premium', linkedItemId: 'rum-appleton' },
    { id: 'rum-up-diplomatico', name: 'Diplomatico Reserva', price: 7.00, tier: 'top_shelf', linkedItemId: 'rum-diplomatico' },
  ]

  for (const mod of rumUpgrades) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: rumUpgradeGroup.id,
        name: mod.name,
        price: mod.price,
        priceType: 'upcharge',
        spiritTier: mod.tier,
        linkedMenuItemId: mod.linkedItemId,
        isDefault: mod.isDefault || false,
        sortOrder: rumUpgrades.indexOf(mod),
      },
    })
  }
  console.log('Created rum upgrade modifiers')

  // Gin Upgrade for Cocktails
  const ginUpgradeGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-gin-upgrade' },
    update: {},
    create: {
      id: 'mod-gin-upgrade',
      locationId: location.id,
      name: 'Gin Choice',
      displayName: 'Upgrade Gin',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      isSpiritGroup: true,
      sortOrder: 9,
    },
  })

  const ginUpgrades = [
    { id: 'gin-up-well', name: 'House Gin', price: 0, tier: 'well', isDefault: true, linkedItemId: 'gin-well' },
    { id: 'gin-up-beefeater', name: 'Beefeater', price: 1.00, tier: 'call', linkedItemId: 'gin-beefeater' },
    { id: 'gin-up-tanqueray', name: 'Tanqueray', price: 3.00, tier: 'call', linkedItemId: 'gin-tanqueray' },
    { id: 'gin-up-bombay', name: 'Bombay Sapphire', price: 3.00, tier: 'premium', linkedItemId: 'gin-bombay' },
    { id: 'gin-up-hendricks', name: "Hendrick's", price: 5.00, tier: 'premium', linkedItemId: 'gin-hendricks' },
    { id: 'gin-up-tanq10', name: 'Tanqueray Ten', price: 6.00, tier: 'top_shelf', linkedItemId: 'gin-tanq-10' },
    { id: 'gin-up-monkey', name: 'Monkey 47', price: 9.00, tier: 'top_shelf', linkedItemId: 'gin-monkey' },
  ]

  for (const mod of ginUpgrades) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: ginUpgradeGroup.id,
        name: mod.name,
        price: mod.price,
        priceType: 'upcharge',
        spiritTier: mod.tier,
        linkedMenuItemId: mod.linkedItemId,
        isDefault: mod.isDefault || false,
        sortOrder: ginUpgrades.indexOf(mod),
      },
    })
  }
  console.log('Created gin upgrade modifiers')

  // Whiskey Upgrade for Cocktails
  const whiskeyUpgradeGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-whiskey-upgrade' },
    update: {},
    create: {
      id: 'mod-whiskey-upgrade',
      locationId: location.id,
      name: 'Whiskey Choice',
      displayName: 'Upgrade Whiskey',
      modifierTypes: ['liquor'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      isSpiritGroup: true,
      sortOrder: 10,
    },
  })

  const whiskeyUpgrades = [
    { id: 'whiskey-up-well', name: 'House Bourbon', price: 0, tier: 'well', isDefault: true, linkedItemId: 'whiskey-well' },
    { id: 'whiskey-up-jim', name: 'Jim Beam', price: 1.00, tier: 'call', linkedItemId: 'whiskey-jim' },
    { id: 'whiskey-up-buffalo', name: 'Buffalo Trace', price: 2.00, tier: 'call', linkedItemId: 'whiskey-buffalo' },
    { id: 'whiskey-up-makers', name: "Maker's Mark", price: 3.00, tier: 'premium', linkedItemId: 'whiskey-makers' },
    { id: 'whiskey-up-woodford', name: 'Woodford Reserve', price: 4.00, tier: 'premium', linkedItemId: 'whiskey-woodford' },
    { id: 'whiskey-up-eagle', name: 'Eagle Rare', price: 7.00, tier: 'top_shelf', linkedItemId: 'whiskey-eagle' },
    { id: 'whiskey-up-blantons', name: "Blanton's", price: 10.00, tier: 'top_shelf', linkedItemId: 'whiskey-blantons' },
  ]

  for (const mod of whiskeyUpgrades) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: whiskeyUpgradeGroup.id,
        name: mod.name,
        price: mod.price,
        priceType: 'upcharge',
        spiritTier: mod.tier,
        linkedMenuItemId: mod.linkedItemId,
        isDefault: mod.isDefault || false,
        sortOrder: whiskeyUpgrades.indexOf(mod),
      },
    })
  }
  console.log('Created whiskey upgrade modifiers')

  // FOOD MODIFIERS - Steak Temperature
  const steakTempGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-steak-temp' },
    update: {},
    create: {
      id: 'mod-steak-temp',
      locationId: location.id,
      name: 'Temperature',
      displayName: 'How would you like it cooked?',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 20,
    },
  })

  const steakTemps = [
    { id: 'temp-rare', name: 'Rare', price: 0 },
    { id: 'temp-med-rare', name: 'Medium Rare', price: 0, isDefault: true },
    { id: 'temp-med', name: 'Medium', price: 0 },
    { id: 'temp-med-well', name: 'Medium Well', price: 0 },
    { id: 'temp-well', name: 'Well Done', price: 0 },
  ]

  for (const mod of steakTemps) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: steakTempGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: steakTemps.indexOf(mod),
      },
    })
  }
  console.log('Created steak temperature modifiers')

  // Wing Sauce
  const wingSauceGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-wing-sauce' },
    update: {},
    create: {
      id: 'mod-wing-sauce',
      locationId: location.id,
      name: 'Wing Sauce',
      displayName: 'Choose Sauce',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      sortOrder: 21,
    },
  })

  const wingSauces = [
    { id: 'sauce-buffalo', name: 'Buffalo', price: 0, isDefault: true },
    { id: 'sauce-mild', name: 'Mild', price: 0 },
    { id: 'sauce-hot', name: 'Hot', price: 0 },
    { id: 'sauce-bbq', name: 'BBQ', price: 0 },
    { id: 'sauce-honey-bbq', name: 'Honey BBQ', price: 0 },
    { id: 'sauce-teriyaki', name: 'Teriyaki', price: 0 },
    { id: 'sauce-garlic-parm', name: 'Garlic Parmesan', price: 0 },
    { id: 'sauce-lemon-pepper', name: 'Lemon Pepper', price: 0 },
    { id: 'sauce-mango-hab', name: 'Mango Habanero', price: 0 },
    { id: 'sauce-dry-rub', name: 'Dry Rub', price: 0 },
  ]

  for (const mod of wingSauces) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: wingSauceGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: wingSauces.indexOf(mod),
      },
    })
  }
  console.log('Created wing sauce modifiers')

  // Burger Add-ons
  const burgerAddGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-burger-add' },
    update: {},
    create: {
      id: 'mod-burger-add',
      locationId: location.id,
      name: 'Burger Add-Ons',
      displayName: 'Add Toppings',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 10,
      isRequired: false,
      sortOrder: 22,
    },
  })

  const burgerAddons = [
    { id: 'burger-bacon', name: 'Bacon', price: 2.00 },
    { id: 'burger-cheese', name: 'American Cheese', price: 1.00 },
    { id: 'burger-cheddar', name: 'Cheddar', price: 1.00 },
    { id: 'burger-swiss', name: 'Swiss', price: 1.00 },
    { id: 'burger-pepper-jack', name: 'Pepper Jack', price: 1.00 },
    { id: 'burger-blue', name: 'Blue Cheese Crumbles', price: 1.50 },
    { id: 'burger-mushrooms', name: 'Sauteed Mushrooms', price: 1.50 },
    { id: 'burger-onions', name: 'Grilled Onions', price: 1.00 },
    { id: 'burger-jalapeno', name: 'Jalapenos', price: 0.75 },
    { id: 'burger-avocado', name: 'Avocado', price: 2.00 },
    { id: 'burger-egg', name: 'Fried Egg', price: 1.50 },
    { id: 'burger-extra-patty', name: 'Extra Patty', price: 5.00 },
  ]

  for (const mod of burgerAddons) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: burgerAddGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: burgerAddons.indexOf(mod),
      },
    })
  }
  console.log('Created burger add-on modifiers')

  // =====================================================
  // LINK MODIFIERS TO MENU ITEMS
  // =====================================================

  // Link mixers, garnish, and ice to all liquor items
  const allLiquorItemIds = [
    ...whiskeyItems.map(i => i.id),
    ...vodkaItems.map(i => i.id),
    ...rumItems.map(i => i.id),
    ...tequilaItems.map(i => i.id),
    ...ginItems.map(i => i.id),
  ]

  for (const itemId of allLiquorItemIds) {
    // Mixers
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-mixers` },
      update: {},
      create: {
        id: `link-${itemId}-mixers`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: mixersGroup.id,
        sortOrder: 1,
      },
    })
    // Garnish
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 2,
      },
    })
    // Ice
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-ice` },
      update: {},
      create: {
        id: `link-${itemId}-ice`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: iceGroup.id,
        sortOrder: 3,
      },
    })
  }
  console.log('Linked modifiers to', allLiquorItemIds.length, 'liquor items')

  // Link steak temp to ribeye
  await prisma.menuItemModifierGroup.upsert({
    where: { id: 'link-steak-temp' },
    update: {},
    create: {
      id: 'link-steak-temp',
      locationId: location.id,
      menuItemId: 'item-7',
      modifierGroupId: steakTempGroup.id,
      sortOrder: 1,
    },
  })

  // Link wing sauce to wings
  await prisma.menuItemModifierGroup.upsert({
    where: { id: 'link-wing-sauce' },
    update: {},
    create: {
      id: 'link-wing-sauce',
      locationId: location.id,
      menuItemId: 'item-1',
      modifierGroupId: wingSauceGroup.id,
      sortOrder: 1,
    },
  })

  // Link burger add-ons to burger
  await prisma.menuItemModifierGroup.upsert({
    where: { id: 'link-burger-add' },
    update: {},
    create: {
      id: 'link-burger-add',
      locationId: location.id,
      menuItemId: 'item-5',
      modifierGroupId: burgerAddGroup.id,
      sortOrder: 1,
    },
  })

  // Link cocktail modifiers
  // Margaritas get style, flavor, and tequila upgrade
  const margaritaItems = ['cocktail-margarita', 'cocktail-marg-frozen', 'cocktail-marg-rocks']
  for (const itemId of margaritaItems) {
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-style` },
      update: {},
      create: {
        id: `link-${itemId}-style`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: margStyleGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-flavor` },
      update: {},
      create: {
        id: `link-${itemId}-flavor`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: margFlavorGroup.id,
        sortOrder: 2,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-tequila` },
      update: {},
      create: {
        id: `link-${itemId}-tequila`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: tequilaUpgradeGroup.id,
        sortOrder: 3,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 4,
      },
    })
  }

  // Link vodka upgrade to vodka cocktails
  const vodkaCocktails = ['cocktail-moscow-mule', 'cocktail-cosmopolitan', 'cocktail-bloody-mary',
    'cocktail-lemon-drop', 'cocktail-vodka-martini', 'cocktail-screwdriver', 'cocktail-vodka-tonic', 'cocktail-vodka-soda']
  for (const itemId of vodkaCocktails) {
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-vodka` },
      update: {},
      create: {
        id: `link-${itemId}-vodka`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: vodkaUpgradeGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 2,
      },
    })
  }

  // Link rum upgrade to rum cocktails
  const rumCocktails = ['cocktail-mojito', 'cocktail-daiquiri', 'cocktail-pina-colada',
    'cocktail-dark-stormy', 'cocktail-cuba-libre', 'cocktail-mai-tai', 'cocktail-zombie']
  for (const itemId of rumCocktails) {
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-rum` },
      update: {},
      create: {
        id: `link-${itemId}-rum`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: rumUpgradeGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 2,
      },
    })
  }

  // Link tequila upgrade to tequila cocktails
  const tequilaCocktails = ['cocktail-paloma', 'cocktail-tequila-sunrise', 'cocktail-ranch-water', 'cocktail-mexican-mule']
  for (const itemId of tequilaCocktails) {
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-tequila` },
      update: {},
      create: {
        id: `link-${itemId}-tequila`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: tequilaUpgradeGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 2,
      },
    })
  }

  // Link gin upgrade to gin cocktails
  const ginCocktails = ['cocktail-gin-tonic', 'cocktail-gin-martini', 'cocktail-negroni',
    'cocktail-tom-collins', 'cocktail-gimlet', 'cocktail-french-75', 'cocktail-aviation']
  for (const itemId of ginCocktails) {
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-gin` },
      update: {},
      create: {
        id: `link-${itemId}-gin`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: ginUpgradeGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 2,
      },
    })
  }

  // Link whiskey upgrade to whiskey cocktails
  const whiskeyCocktails = ['cocktail-old-fashioned', 'cocktail-manhattan', 'cocktail-whiskey-sour',
    'cocktail-mint-julep', 'cocktail-jack-coke']
  for (const itemId of whiskeyCocktails) {
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-whiskey` },
      update: {},
      create: {
        id: `link-${itemId}-whiskey`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: whiskeyUpgradeGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: { id: `link-${itemId}-garnish` },
      update: {},
      create: {
        id: `link-${itemId}-garnish`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: garnishGroup.id,
        sortOrder: 2,
      },
    })
  }

  console.log('Linked modifiers to cocktails')

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
  console.log('Bar Menu Created:')
  console.log('  - ' + whiskeyItems.length + ' whiskey items')
  console.log('  - ' + vodkaItems.length + ' vodka items')
  console.log('  - ' + rumItems.length + ' rum items')
  console.log('  - ' + tequilaItems.length + ' tequila items')
  console.log('  - ' + ginItems.length + ' gin items')
  console.log('  - ' + cocktailItems.length + ' cocktails')
  console.log('  - ' + beerItems.length + ' beers')
  console.log('  - ' + wineItems.length + ' wines')
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
