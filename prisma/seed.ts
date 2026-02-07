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

  // Create Simulated Payment Reader
  const simulatedReader = await prisma.paymentReader.upsert({
    where: { serialNumber: 'SIM-001-DEV' },
    update: {},
    create: {
      locationId: location.id,
      name: 'Simulated Card Reader',
      serialNumber: 'SIM-001-DEV',
      ipAddress: 'localhost',
      port: 3000,
      verificationType: 'IP_ONLY',
      isActive: true,
      isOnline: true,
    },
  })
  console.log('Created simulated payment reader:', simulatedReader.name)

  // Create Default Terminal bound to simulated reader
  const terminal = await prisma.terminal.upsert({
    where: { id: 'terminal-1' },
    update: {
      paymentReaderId: simulatedReader.id,
      paymentProvider: 'SIMULATED',
    },
    create: {
      id: 'terminal-1',
      locationId: location.id,
      name: 'Main Terminal',
      paymentReaderId: simulatedReader.id,
      paymentProvider: 'SIMULATED',
    },
  })
  console.log('Created terminal:', terminal.name, '→ bound to', simulatedReader.name)

  // Create System Order Types
  const orderTypes = [
    {
      id: 'order-type-dine-in',
      locationId: location.id,
      name: 'Dine In',
      slug: 'dine_in',
      icon: 'table',
      color: '#3B82F6',
      sortOrder: 0,
      isActive: true,
      isSystem: true,
      requiredFields: { tableId: true },
      optionalFields: {},
      fieldDefinitions: {},
      workflowRules: { requireTableSelection: true, allowSplitCheck: true, showOnKDS: true },
      kdsConfig: { badgeText: 'Table {tableNumber}', badgeColor: '#3B82F6' },
      printConfig: { headerTemplate: 'TABLE {tableNumber}' },
    },
    {
      id: 'order-type-bar-tab',
      locationId: location.id,
      name: 'Bar Tab',
      slug: 'bar_tab',
      icon: 'wine',
      color: '#8B5CF6',
      sortOrder: 1,
      isActive: true,
      isSystem: true,
      requiredFields: { tabName: true },
      optionalFields: {},
      fieldDefinitions: {
        tabName: { label: 'Tab Name', type: 'text', placeholder: 'Customer name or card name', required: true },
      },
      workflowRules: { requireCustomerName: true, allowSplitCheck: true, showOnKDS: true },
      kdsConfig: { badgeText: '{tabName}', badgeColor: '#8B5CF6' },
      printConfig: { headerTemplate: 'TAB: {tabName}' },
    },
    {
      id: 'order-type-takeout',
      locationId: location.id,
      name: 'Takeout',
      slug: 'takeout',
      icon: 'bag',
      color: '#10B981',
      sortOrder: 2,
      isActive: true,
      isSystem: true,
      requiredFields: {},
      optionalFields: { customerName: true, phone: true },
      fieldDefinitions: {
        customerName: { label: 'Name', type: 'text', placeholder: 'Customer name' },
        phone: { label: 'Phone', type: 'phone', placeholder: '555-123-4567' },
      },
      workflowRules: { requirePaymentBeforeSend: true, allowSplitCheck: false, showOnKDS: true },
      kdsConfig: { badgeText: 'TAKEOUT', badgeColor: '#10B981', showPhone: true },
      printConfig: { headerTemplate: '*** TAKEOUT ***', showCustomFields: ['customerName', 'phone'] },
    },
    {
      id: 'order-type-delivery',
      locationId: location.id,
      name: 'Delivery',
      slug: 'delivery',
      icon: 'truck',
      color: '#F59E0B',
      sortOrder: 3,
      isActive: true,
      isSystem: true,
      requiredFields: { customerName: true, phone: true, address: true },
      optionalFields: {},
      fieldDefinitions: {
        customerName: { label: 'Name', type: 'text', placeholder: 'Customer name', required: true },
        phone: { label: 'Phone', type: 'phone', placeholder: '555-123-4567', required: true },
        address: { label: 'Delivery Address', type: 'textarea', placeholder: '123 Main St, City, State ZIP', required: true },
      },
      workflowRules: { requirePaymentBeforeSend: true, allowSplitCheck: false, showOnKDS: true },
      kdsConfig: { badgeText: 'DELIVERY', badgeColor: '#F59E0B', showPhone: true, showAddress: true },
      printConfig: { headerTemplate: '*** DELIVERY ***', showCustomFields: ['customerName', 'phone', 'address'] },
    },
  ]

  for (const orderType of orderTypes) {
    await prisma.orderType.upsert({
      where: { id: orderType.id },
      update: {},
      create: orderType,
    })
  }
  console.log('Created order types:', orderTypes.length)

  // Create Roles with new permission system

  // Super Admin gets ALL access including dev features
  const superAdminPermissions = [
    'all',  // Full access to everything
    'dev.access',  // Developer features
    'dev.test_cards',  // Simulated card reader
    'dev.training_mode',  // Training mode (future)
    'dev.force_sync',  // Manual sync trigger (future)
  ]

  const superAdminRole = await prisma.role.upsert({
    where: { id: 'role-super-admin' },
    update: {
      permissions: superAdminPermissions,
    },
    create: {
      id: 'role-super-admin',
      locationId: location.id,
      name: 'Super Admin',
      permissions: superAdminPermissions,
    },
  })

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
  console.log('Created/updated roles: Super Admin, Manager, Server, Bartender')

  // Create Employees

  // Super Admin - PIN 0000 for dev access
  const superAdmin = await prisma.employee.upsert({
    where: { id: 'emp-super-admin' },
    update: {},
    create: {
      id: 'emp-super-admin',
      locationId: location.id,
      roleId: superAdminRole.id,
      firstName: 'Dev',
      lastName: 'Admin',
      displayName: 'Dev Admin',
      pin: await hash('0000', 10),
      hourlyRate: 0,
      email: 'dev@gwi-pos.local',
    },
  })

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
  console.log('Created employees: Dev Admin (PIN: 0000), Demo Manager (PIN: 1234), Sarah S. (PIN: 2345), Mike B. (PIN: 3456)')

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
        categoryShow: 'food',
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
        categoryShow: 'food',
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
        categoryShow: 'bar',
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
        categoryShow: 'food',
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
        categoryShow: 'food',
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
        categoryShow: 'entertainment',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
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
        categoryShow: 'bar',
        sortOrder: 17,
      },
    }),
  ])
  console.log('Created categories:', categories.map(c => c.name).join(', '))

  // Create additional food categories
  const sidesCategory = await prisma.category.upsert({
    where: { id: 'cat-sides' },
    update: {},
    create: {
      id: 'cat-sides',
      locationId: location.id,
      name: 'Sides',
      color: '#f59e0b',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 7,
      showOnPOS: true,
    },
  })

  const saladsCategory = await prisma.category.upsert({
    where: { id: 'cat-salads' },
    update: {},
    create: {
      id: 'cat-salads',
      locationId: location.id,
      name: 'Salads',
      color: '#22c55e',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 8,
      showOnPOS: true,
    },
  })

  const sandwichesCategory = await prisma.category.upsert({
    where: { id: 'cat-sandwiches' },
    update: {},
    create: {
      id: 'cat-sandwiches',
      locationId: location.id,
      name: 'Sandwiches',
      color: '#f97316',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 9,
      showOnPOS: true,
    },
  })

  const kidsCategory = await prisma.category.upsert({
    where: { id: 'cat-kids' },
    update: {},
    create: {
      id: 'cat-kids',
      locationId: location.id,
      name: 'Kids Menu',
      color: '#ec4899',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 13,
      showOnPOS: true,
    },
  })

  console.log('Created additional food categories:', [sidesCategory.name, saladsCategory.name, sandwichesCategory.name, kidsCategory.name].join(', '))

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
    // Sides
    { id: 'side-1', categoryId: 'cat-sides', name: 'French Fries', price: 4.99, description: 'Crispy golden fries' },
    { id: 'side-2', categoryId: 'cat-sides', name: 'Onion Rings', price: 5.99, description: 'Beer-battered onion rings' },
    { id: 'side-3', categoryId: 'cat-sides', name: 'Coleslaw', price: 3.99, description: 'Creamy coleslaw' },
    { id: 'side-4', categoryId: 'cat-sides', name: 'Side Salad', price: 4.99, description: 'House salad' },
    { id: 'side-5', categoryId: 'cat-sides', name: 'Mashed Potatoes', price: 4.99, description: 'Garlic mashed potatoes' },
    { id: 'side-6', categoryId: 'cat-sides', name: 'Sweet Potato Fries', price: 6.99, description: 'Crispy sweet potato fries' },
    { id: 'side-7', categoryId: 'cat-sides', name: 'Mac & Cheese', price: 5.99, description: 'Creamy mac and cheese' },
    { id: 'side-8', categoryId: 'cat-sides', name: 'Steamed Broccoli', price: 4.99, description: 'Fresh steamed broccoli' },
    // Salads
    { id: 'salad-1', categoryId: 'cat-salads', name: 'Caesar Salad', price: 11.99, description: 'Romaine, croutons, parmesan, caesar dressing' },
    { id: 'salad-2', categoryId: 'cat-salads', name: 'House Salad', price: 9.99, description: 'Mixed greens with house vinaigrette' },
    { id: 'salad-3', categoryId: 'cat-salads', name: 'Cobb Salad', price: 13.99, description: 'Turkey, bacon, egg, avocado, blue cheese' },
    { id: 'salad-4', categoryId: 'cat-salads', name: 'Wedge Salad', price: 10.99, description: 'Iceberg wedge with bacon and blue cheese' },
    // Sandwiches
    { id: 'sandwich-1', categoryId: 'cat-sandwiches', name: 'Club Sandwich', price: 12.99, description: 'Turkey, ham, bacon, lettuce, tomato' },
    { id: 'sandwich-2', categoryId: 'cat-sandwiches', name: 'BLT', price: 10.99, description: 'Bacon, lettuce, tomato on sourdough' },
    { id: 'sandwich-3', categoryId: 'cat-sandwiches', name: 'Grilled Chicken Sandwich', price: 13.99, description: 'Grilled chicken breast with aioli' },
    { id: 'sandwich-4', categoryId: 'cat-sandwiches', name: 'Philly Cheesesteak', price: 14.99, description: 'Shaved ribeye with peppers and onions' },
    { id: 'sandwich-5', categoryId: 'cat-sandwiches', name: 'Fish Tacos', price: 13.99, description: 'Beer-battered cod with slaw and lime crema' },
    // Kids Menu
    { id: 'kids-1', categoryId: 'cat-kids', name: 'Kids Burger', price: 7.99, description: 'Small burger with fries' },
    { id: 'kids-2', categoryId: 'cat-kids', name: 'Kids Chicken Tenders', price: 7.99, description: 'Chicken tenders with fries' },
    { id: 'kids-3', categoryId: 'cat-kids', name: 'Kids Mac & Cheese', price: 6.99, description: 'Creamy mac and cheese' },
    { id: 'kids-4', categoryId: 'cat-kids', name: 'Kids Grilled Cheese', price: 5.99, description: 'Grilled cheese with fries' },
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

  // Salad Dressing
  const saladDressingGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-salad-dressing' },
    update: {},
    create: {
      id: 'mod-salad-dressing',
      locationId: location.id,
      name: 'Dressing',
      displayName: 'Choose Dressing',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 23,
    },
  })

  const saladDressings = [
    { id: 'dressing-ranch', name: 'Ranch', price: 0, isDefault: true },
    { id: 'dressing-caesar', name: 'Caesar', price: 0 },
    { id: 'dressing-bleu', name: 'Blue Cheese', price: 0 },
    { id: 'dressing-italian', name: 'Italian', price: 0 },
    { id: 'dressing-vinaigrette', name: 'Balsamic Vinaigrette', price: 0 },
    { id: 'dressing-honey', name: 'Honey Mustard', price: 0 },
  ]

  for (const mod of saladDressings) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: saladDressingGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: saladDressings.indexOf(mod),
      },
    })
  }
  console.log('Created salad dressing modifiers')

  // Salad Protein Add-On
  const saladProteinGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-salad-protein' },
    update: {},
    create: {
      id: 'mod-salad-protein',
      locationId: location.id,
      name: 'Add Protein',
      displayName: 'Add Protein',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 3,
      isRequired: false,
      sortOrder: 24,
    },
  })

  const saladProteins = [
    { id: 'protein-chicken', name: 'Grilled Chicken', price: 4.99 },
    { id: 'protein-shrimp', name: 'Shrimp', price: 6.99 },
    { id: 'protein-steak', name: 'Steak Tips', price: 7.99 },
    { id: 'protein-salmon', name: 'Salmon', price: 8.99 },
  ]

  for (const mod of saladProteins) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: saladProteinGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: false,
        sortOrder: saladProteins.indexOf(mod),
      },
    })
  }
  console.log('Created salad protein modifiers')

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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: mixersGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: iceGroup.id,
        },
      },
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
    where: {
      menuItemId_modifierGroupId: {
        menuItemId: 'item-7',
        modifierGroupId: steakTempGroup.id,
      },
    },
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
    where: {
      menuItemId_modifierGroupId: {
        menuItemId: 'item-1',
        modifierGroupId: wingSauceGroup.id,
      },
    },
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
    where: {
      menuItemId_modifierGroupId: {
        menuItemId: 'item-5',
        modifierGroupId: burgerAddGroup.id,
      },
    },
    update: {},
    create: {
      id: 'link-burger-add',
      locationId: location.id,
      menuItemId: 'item-5',
      modifierGroupId: burgerAddGroup.id,
      sortOrder: 1,
    },
  })

  // Link salad dressing to all salads
  const saladItemIds = ['salad-1', 'salad-2', 'salad-3', 'salad-4']
  for (const itemId of saladItemIds) {
    await prisma.menuItemModifierGroup.upsert({
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: saladDressingGroup.id,
        },
      },
      update: {},
      create: {
        id: `link-${itemId}-dressing`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: saladDressingGroup.id,
        sortOrder: 1,
      },
    })
    await prisma.menuItemModifierGroup.upsert({
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: saladProteinGroup.id,
        },
      },
      update: {},
      create: {
        id: `link-${itemId}-protein`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: saladProteinGroup.id,
        sortOrder: 2,
      },
    })
  }
  console.log('Linked dressing and protein to', saladItemIds.length, 'salads')

  // Link burger add-ons to all sandwiches
  const sandwichItemIds = ['sandwich-1', 'sandwich-2', 'sandwich-3', 'sandwich-4', 'sandwich-5']
  for (const itemId of sandwichItemIds) {
    await prisma.menuItemModifierGroup.upsert({
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: burgerAddGroup.id,
        },
      },
      update: {},
      create: {
        id: `link-${itemId}-burger-add`,
        locationId: location.id,
        menuItemId: itemId,
        modifierGroupId: burgerAddGroup.id,
        sortOrder: 1,
      },
    })
  }
  console.log('Linked burger add-ons to', sandwichItemIds.length, 'sandwiches')

  // Link cocktail modifiers
  // Margaritas get style, flavor, and tequila upgrade
  const margaritaItems = ['cocktail-margarita', 'cocktail-marg-frozen', 'cocktail-marg-rocks']
  for (const itemId of margaritaItems) {
    await prisma.menuItemModifierGroup.upsert({
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: margStyleGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: margFlavorGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: tequilaUpgradeGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: vodkaUpgradeGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: rumUpgradeGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: tequilaUpgradeGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: ginUpgradeGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: whiskeyUpgradeGroup.id,
        },
      },
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
      where: {
        menuItemId_modifierGroupId: {
          menuItemId: itemId,
          modifierGroupId: garnishGroup.id,
        },
      },
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

  // ========================================
  // PIZZA BUILDER DATA (Skill 109)
  // ========================================
  console.log('')
  console.log('Creating pizza builder data...')

  // Create Pizza Category
  const pizzaCategory = await prisma.category.upsert({
    where: { id: 'cat-pizza' },
    update: { categoryType: 'pizza' }, // Ensure existing pizza category gets updated
    create: {
      id: 'cat-pizza',
      locationId: location.id,
      name: 'Pizza',
      color: '#ea580c',
      categoryType: 'pizza', // This triggers the Pizza Builder modal
      categoryShow: 'food',
      sortOrder: 0, // First category
    },
  })
  console.log('Created pizza category')

  // Create Pizza Config
  await prisma.pizzaConfig.upsert({
    where: { locationId: location.id },
    update: {},
    create: {
      locationId: location.id,
      maxSections: 8,
      defaultSections: 2,
      sectionOptions: [1, 2, 4, 8],
      pricingMode: 'fractional',
      freeToppingsEnabled: false,
      freeToppingsCount: 0,
      freeToppingsMode: 'per_pizza',
      showVisualBuilder: true,
      showToppingList: true,
      defaultToListView: false,
      builderMode: 'both',
      defaultBuilderMode: 'quick',
      allowModeSwitch: true,
    },
  })
  console.log('Created pizza config')

  // Create Pizza Sizes
  const pizzaSizes = [
    { id: 'size-personal', name: 'Personal', displayName: '8" Personal', inches: 8, slices: 4, basePrice: 8.99, priceMultiplier: 0.5, toppingMultiplier: 0.6, freeToppings: 0, sortOrder: 0, isDefault: false },
    { id: 'size-small', name: 'Small', displayName: '10" Small', inches: 10, slices: 6, basePrice: 11.99, priceMultiplier: 0.7, toppingMultiplier: 0.8, freeToppings: 0, sortOrder: 1, isDefault: false },
    { id: 'size-medium', name: 'Medium', displayName: '12" Medium', inches: 12, slices: 8, basePrice: 14.99, priceMultiplier: 0.85, toppingMultiplier: 0.9, freeToppings: 0, sortOrder: 2, isDefault: true },
    { id: 'size-large', name: 'Large', displayName: '14" Large', inches: 14, slices: 8, basePrice: 17.99, priceMultiplier: 1.0, toppingMultiplier: 1.0, freeToppings: 0, sortOrder: 3, isDefault: false },
    { id: 'size-xlarge', name: 'X-Large', displayName: '16" X-Large', inches: 16, slices: 10, basePrice: 20.99, priceMultiplier: 1.15, toppingMultiplier: 1.2, freeToppings: 0, sortOrder: 4, isDefault: false },
    { id: 'size-party', name: 'Party', displayName: '18" Party', inches: 18, slices: 12, basePrice: 24.99, priceMultiplier: 1.35, toppingMultiplier: 1.4, freeToppings: 0, sortOrder: 5, isDefault: false },
  ]

  for (const size of pizzaSizes) {
    await prisma.pizzaSize.upsert({
      where: { id: size.id },
      update: {},
      create: {
        ...size,
        locationId: location.id,
        isActive: true,
      },
    })
  }
  console.log(`Created ${pizzaSizes.length} pizza sizes`)

  // Create Pizza Crusts
  const pizzaCrusts = [
    { id: 'crust-hand', name: 'Hand-Tossed', displayName: 'Hand-Tossed', price: 0, sortOrder: 0, isDefault: true },
    { id: 'crust-thin', name: 'Thin', displayName: 'Thin & Crispy', price: 0, sortOrder: 1, isDefault: false },
    { id: 'crust-deep', name: 'Deep Dish', displayName: 'Deep Dish', price: 2.00, sortOrder: 2, isDefault: false },
    { id: 'crust-stuffed', name: 'Stuffed', displayName: 'Stuffed Crust', price: 3.00, sortOrder: 3, isDefault: false },
    { id: 'crust-gf', name: 'Gluten-Free', displayName: 'Gluten-Free', price: 3.00, sortOrder: 4, isDefault: false },
    { id: 'crust-cauli', name: 'Cauliflower', displayName: 'Cauliflower', price: 4.00, sortOrder: 5, isDefault: false },
  ]

  for (const crust of pizzaCrusts) {
    await prisma.pizzaCrust.upsert({
      where: { id: crust.id },
      update: {},
      create: {
        ...crust,
        locationId: location.id,
        isActive: true,
      },
    })
  }
  console.log(`Created ${pizzaCrusts.length} pizza crusts`)

  // Create Pizza Sauces
  const pizzaSauces = [
    { id: 'sauce-marinara', name: 'Marinara', displayName: 'Classic Marinara', price: 0, sortOrder: 0, isDefault: true, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'sauce-garlic', name: 'Garlic Butter', displayName: 'Garlic Butter', price: 0, sortOrder: 1, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'sauce-bbq', name: 'BBQ', displayName: 'BBQ Sauce', price: 0, sortOrder: 2, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'sauce-buffalo', name: 'Buffalo', displayName: 'Buffalo Sauce', price: 0, sortOrder: 3, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'sauce-alfredo', name: 'Alfredo', displayName: 'Alfredo Sauce', price: 1.00, sortOrder: 4, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'sauce-pesto', name: 'Pesto', displayName: 'Basil Pesto', price: 1.50, sortOrder: 5, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'sauce-olive', name: 'Olive Oil', displayName: 'Olive Oil', price: 0, sortOrder: 6, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'sauce-none', name: 'No Sauce', displayName: 'No Sauce', price: 0, sortOrder: 7, isDefault: false, allowLight: false, allowExtra: false, extraPrice: 0 },
  ]

  for (const sauce of pizzaSauces) {
    await prisma.pizzaSauce.upsert({
      where: { id: sauce.id },
      update: {},
      create: {
        ...sauce,
        locationId: location.id,
        isActive: true,
      },
    })
  }
  console.log(`Created ${pizzaSauces.length} pizza sauces`)

  // Create Pizza Cheeses
  const pizzaCheeses = [
    { id: 'cheese-mozz', name: 'Mozzarella', displayName: 'Mozzarella', price: 0, sortOrder: 0, isDefault: true, allowLight: true, allowExtra: true, extraPrice: 2.00 },
    { id: 'cheese-light', name: 'Light Cheese', displayName: 'Light Cheese', price: 0, sortOrder: 1, isDefault: false, allowLight: false, allowExtra: false, extraPrice: 0 },
    { id: 'cheese-extra', name: 'Extra Cheese', displayName: 'Extra Mozzarella', price: 2.00, sortOrder: 2, isDefault: false, allowLight: false, allowExtra: false, extraPrice: 0 },
    { id: 'cheese-none', name: 'No Cheese', displayName: 'No Cheese', price: 0, sortOrder: 3, isDefault: false, allowLight: false, allowExtra: false, extraPrice: 0 },
    { id: 'cheese-vegan', name: 'Vegan', displayName: 'Vegan Cheese', price: 2.00, sortOrder: 4, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 2.00 },
    { id: 'cheese-ricotta', name: 'Ricotta', displayName: 'Ricotta Dollops', price: 1.50, sortOrder: 5, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'cheese-feta', name: 'Feta', displayName: 'Feta Crumbles', price: 1.50, sortOrder: 6, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'cheese-parm', name: 'Parmesan', displayName: 'Parmesan', price: 1.00, sortOrder: 7, isDefault: false, allowLight: true, allowExtra: true, extraPrice: 1.00 },
  ]

  for (const cheese of pizzaCheeses) {
    await prisma.pizzaCheese.upsert({
      where: { id: cheese.id },
      update: {},
      create: {
        ...cheese,
        locationId: location.id,
        isActive: true,
      },
    })
  }
  console.log(`Created ${pizzaCheeses.length} pizza cheeses`)

  // Create Pizza Toppings (50+)
  const pizzaToppings = [
    // MEATS (15 items)
    { id: 'top-pepperoni', name: 'Pepperoni', price: 1.50, category: 'meat', sortOrder: 0 },
    { id: 'top-sausage', name: 'Italian Sausage', price: 1.50, category: 'meat', sortOrder: 1 },
    { id: 'top-bacon', name: 'Bacon', price: 2.00, category: 'meat', sortOrder: 2 },
    { id: 'top-ham', name: 'Ham', price: 1.50, category: 'meat', sortOrder: 3 },
    { id: 'top-beef', name: 'Ground Beef', price: 1.50, category: 'meat', sortOrder: 4 },
    { id: 'top-chicken', name: 'Chicken', price: 2.50, category: 'meat', sortOrder: 5 },
    { id: 'top-grchicken', name: 'Grilled Chicken', price: 2.50, category: 'meat', sortOrder: 6 },
    { id: 'top-bufchicken', name: 'Buffalo Chicken', price: 2.50, category: 'meat', sortOrder: 7 },
    { id: 'top-anchovies', name: 'Anchovies', price: 2.00, category: 'meat', sortOrder: 8 },
    { id: 'top-meatballs', name: 'Meatballs', price: 2.50, category: 'meat', sortOrder: 9 },
    { id: 'top-pulledpork', name: 'Pulled Pork', price: 2.50, category: 'meat', sortOrder: 10 },
    { id: 'top-salami', name: 'Salami', price: 2.00, category: 'meat', sortOrder: 11 },
    { id: 'top-capicola', name: 'Capicola', price: 2.50, category: 'meat', sortOrder: 12 },
    { id: 'top-canadbacon', name: 'Canadian Bacon', price: 2.00, category: 'meat', sortOrder: 13 },
    { id: 'top-chorizo', name: 'Chorizo', price: 2.50, category: 'meat', sortOrder: 14 },

    // VEGETABLES (20 items)
    { id: 'top-mushrooms', name: 'Mushrooms', price: 1.00, category: 'veggie', sortOrder: 20 },
    { id: 'top-onions', name: 'Onions', price: 1.00, category: 'veggie', sortOrder: 21 },
    { id: 'top-redonion', name: 'Red Onion', price: 1.00, category: 'veggie', sortOrder: 22 },
    { id: 'top-greenpepp', name: 'Green Peppers', price: 1.00, category: 'veggie', sortOrder: 23 },
    { id: 'top-blackolives', name: 'Black Olives', price: 1.00, category: 'veggie', sortOrder: 24 },
    { id: 'top-greenolives', name: 'Green Olives', price: 1.00, category: 'veggie', sortOrder: 25 },
    { id: 'top-jalapenos', name: 'Jalapenos', price: 1.00, category: 'veggie', sortOrder: 26 },
    { id: 'top-bananapepp', name: 'Banana Peppers', price: 1.00, category: 'veggie', sortOrder: 27 },
    { id: 'top-tomatoes', name: 'Tomatoes', price: 1.00, category: 'veggie', sortOrder: 28 },
    { id: 'top-sundried', name: 'Sun-Dried Tomatoes', price: 1.50, category: 'veggie', sortOrder: 29 },
    { id: 'top-spinach', name: 'Spinach', price: 1.00, category: 'veggie', sortOrder: 30 },
    { id: 'top-broccoli', name: 'Broccoli', price: 1.00, category: 'veggie', sortOrder: 31 },
    { id: 'top-garlic', name: 'Roasted Garlic', price: 1.00, category: 'veggie', sortOrder: 32 },
    { id: 'top-basil', name: 'Fresh Basil', price: 1.00, category: 'veggie', sortOrder: 33 },
    { id: 'top-artichoke', name: 'Artichoke Hearts', price: 1.50, category: 'veggie', sortOrder: 34 },
    { id: 'top-roastedpepp', name: 'Roasted Red Peppers', price: 1.50, category: 'veggie', sortOrder: 35 },
    { id: 'top-pineapple', name: 'Pineapple', price: 1.00, category: 'veggie', sortOrder: 36 },
    { id: 'top-kalamata', name: 'Kalamata Olives', price: 1.50, category: 'veggie', sortOrder: 37 },
    { id: 'top-corn', name: 'Sweet Corn', price: 1.00, category: 'veggie', sortOrder: 38 },
    { id: 'top-zucchini', name: 'Zucchini', price: 1.00, category: 'veggie', sortOrder: 39 },

    // PREMIUM (10 items)
    { id: 'top-prosciutto', name: 'Prosciutto', price: 3.00, category: 'premium', sortOrder: 40 },
    { id: 'top-phillysteak', name: 'Philly Steak', price: 3.00, category: 'premium', sortOrder: 41 },
    { id: 'top-freshmozz', name: 'Fresh Mozzarella', price: 2.50, category: 'premium', sortOrder: 42 },
    { id: 'top-goatcheese', name: 'Goat Cheese', price: 2.50, category: 'premium', sortOrder: 43 },
    { id: 'top-bluecheese', name: 'Blue Cheese', price: 2.50, category: 'premium', sortOrder: 44 },
    { id: 'top-truffleoil', name: 'Truffle Oil', price: 3.50, category: 'premium', sortOrder: 45 },
    { id: 'top-arugula', name: 'Arugula', price: 2.00, category: 'premium', sortOrder: 46 },
    { id: 'top-burrata', name: 'Burrata', price: 3.50, category: 'premium', sortOrder: 47 },
    { id: 'top-pancetta', name: 'Pancetta', price: 3.00, category: 'premium', sortOrder: 48 },
    { id: 'top-soppressata', name: 'Soppressata', price: 3.00, category: 'premium', sortOrder: 49 },

    // SEAFOOD (5 items)
    { id: 'top-shrimp', name: 'Shrimp', price: 3.50, category: 'seafood', sortOrder: 50 },
    { id: 'top-crab', name: 'Crab Meat', price: 4.00, category: 'seafood', sortOrder: 51 },
    { id: 'top-clams', name: 'Clams', price: 3.00, category: 'seafood', sortOrder: 52 },
    { id: 'top-salmon', name: 'Smoked Salmon', price: 4.00, category: 'seafood', sortOrder: 53 },
    { id: 'top-tuna', name: 'Tuna', price: 3.50, category: 'seafood', sortOrder: 54 },
  ]

  for (const topping of pizzaToppings) {
    await prisma.pizzaTopping.upsert({
      where: { id: topping.id },
      update: {},
      create: {
        ...topping,
        locationId: location.id,
        isActive: true,
      },
    })
  }
  console.log(`Created ${pizzaToppings.length} pizza toppings`)

  // Create Specialty Pizza Menu Items
  const specialtyPizzas = [
    {
      id: 'pizza-pepperoni-lovers',
      name: 'Pepperoni Lovers',
      description: 'Double pepperoni with extra cheese',
      price: 19.99,
    },
    {
      id: 'pizza-meat-lovers',
      name: 'Meat Lovers',
      description: 'Pepperoni, sausage, bacon, ham, ground beef',
      price: 22.99,
    },
    {
      id: 'pizza-supreme',
      name: 'Supreme',
      description: 'Pepperoni, sausage, mushrooms, onions, green peppers, black olives',
      price: 21.99,
    },
    {
      id: 'pizza-veggie-supreme',
      name: 'Veggie Supreme',
      description: 'Mushrooms, onions, green peppers, black olives, tomatoes, spinach',
      price: 19.99,
    },
    {
      id: 'pizza-hawaiian',
      name: 'Hawaiian',
      description: 'Ham, pineapple, extra cheese',
      price: 18.99,
    },
    {
      id: 'pizza-bbq-chicken',
      name: 'BBQ Chicken',
      description: 'BBQ sauce, grilled chicken, red onion, cilantro',
      price: 20.99,
    },
    {
      id: 'pizza-buffalo-chicken',
      name: 'Buffalo Chicken',
      description: 'Buffalo sauce, buffalo chicken, ranch drizzle',
      price: 20.99,
    },
    {
      id: 'pizza-margherita',
      name: 'Margherita',
      description: 'Marinara, fresh mozzarella, tomatoes, fresh basil',
      price: 18.99,
    },
    {
      id: 'pizza-white',
      name: 'White Pizza',
      description: 'Alfredo sauce, ricotta, roasted garlic, spinach',
      price: 19.99,
    },
    {
      id: 'pizza-philly',
      name: 'Philly Cheesesteak',
      description: 'Garlic butter, philly steak, green peppers, onions, extra cheese',
      price: 22.99,
    },
    {
      id: 'pizza-works',
      name: 'The Works',
      description: 'Pepperoni, sausage, bacon, ham, mushrooms, onions, green peppers, black olives',
      price: 24.99,
    },
    {
      id: 'pizza-four-cheese',
      name: 'Four Cheese',
      description: 'Mozzarella, parmesan, ricotta, feta',
      price: 19.99,
    },
  ]

  for (const pizza of specialtyPizzas) {
    await prisma.menuItem.upsert({
      where: { id: pizza.id },
      update: {},
      create: {
        id: pizza.id,
        locationId: location.id,
        categoryId: pizzaCategory.id,
        name: pizza.name,
        description: pizza.description,
        price: pizza.price,
        isAvailable: true,
        itemType: 'standard',
              },
    })
  }
  console.log(`Created ${specialtyPizzas.length} specialty pizzas`)

  // Create Build Your Own Pizza item
  await prisma.menuItem.upsert({
    where: { id: 'pizza-custom' },
    update: {},
    create: {
      id: 'pizza-custom',
      locationId: location.id,
      categoryId: pizzaCategory.id,
      name: 'Build Your Own',
      description: 'Create your perfect pizza with our fresh ingredients',
      price: 14.99, // Base price (medium)
      isAvailable: true,
      itemType: 'standard',
          },
  })
  console.log('Created Build Your Own Pizza')

  console.log('')
  // =====================================================
  // VOID REASONS (for inventory tracking)
  // =====================================================
  console.log('Creating void reasons...')

  const voidReasons = await Promise.all([
    prisma.voidReason.upsert({
      where: { id: 'void-made-wrong' },
      update: {},
      create: {
        id: 'void-made-wrong',
        locationId: location.id,
        name: 'Made Wrong',
        description: 'Item was prepared incorrectly',
        deductInventory: true,
        requiresManager: false,
        sortOrder: 0,
      },
    }),
    prisma.voidReason.upsert({
      where: { id: 'void-customer-changed-mind' },
      update: {},
      create: {
        id: 'void-customer-changed-mind',
        locationId: location.id,
        name: 'Customer Changed Mind',
        description: 'Customer changed order before it was made',
        deductInventory: false,
        requiresManager: false,
        sortOrder: 1,
      },
    }),
    prisma.voidReason.upsert({
      where: { id: 'void-rang-wrong' },
      update: {},
      create: {
        id: 'void-rang-wrong',
        locationId: location.id,
        name: 'Rang Wrong',
        description: 'Server entered incorrect item',
        deductInventory: false,
        requiresManager: false,
        sortOrder: 2,
      },
    }),
    prisma.voidReason.upsert({
      where: { id: 'void-spilled' },
      update: {},
      create: {
        id: 'void-spilled',
        locationId: location.id,
        name: 'Spilled/Dropped',
        description: 'Item was spilled or dropped',
        deductInventory: true,
        requiresManager: false,
        sortOrder: 3,
      },
    }),
    prisma.voidReason.upsert({
      where: { id: 'void-returned' },
      update: {},
      create: {
        id: 'void-returned',
        locationId: location.id,
        name: 'Returned (Quality)',
        description: 'Customer returned due to quality issue',
        deductInventory: true,
        requiresManager: true,
        sortOrder: 4,
      },
    }),
    prisma.voidReason.upsert({
      where: { id: 'void-comp' },
      update: {},
      create: {
        id: 'void-comp',
        locationId: location.id,
        name: 'Manager Comp',
        description: 'Complimentary item (manager approved)',
        deductInventory: true,
        requiresManager: true,
        sortOrder: 5,
      },
    }),
    prisma.voidReason.upsert({
      where: { id: 'void-86d' },
      update: {},
      create: {
        id: 'void-86d',
        locationId: location.id,
        name: '86d Item',
        description: 'Item out of stock after ordering',
        deductInventory: false,
        requiresManager: true,
        sortOrder: 6,
      },
    }),
  ])
  console.log(`Created ${voidReasons.length} void reasons`)

  // =====================================================
  // STORAGE LOCATIONS (for inventory counts)
  // =====================================================
  console.log('Creating storage locations...')

  const storageLocations = await Promise.all([
    prisma.storageLocation.upsert({
      where: { id: 'storage-walk-in-cooler' },
      update: {},
      create: {
        id: 'storage-walk-in-cooler',
        locationId: location.id,
        name: 'Walk-in Cooler',
        description: 'Main refrigerated storage',
        sortOrder: 0,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-walk-in-freezer' },
      update: {},
      create: {
        id: 'storage-walk-in-freezer',
        locationId: location.id,
        name: 'Walk-in Freezer',
        description: 'Main frozen storage',
        sortOrder: 1,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-dry-storage' },
      update: {},
      create: {
        id: 'storage-dry-storage',
        locationId: location.id,
        name: 'Dry Storage',
        description: 'Shelf-stable items',
        sortOrder: 2,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-bar-rail' },
      update: {},
      create: {
        id: 'storage-bar-rail',
        locationId: location.id,
        name: 'Bar Rail',
        description: 'Well and speed rack bottles',
        sortOrder: 3,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-bar-back' },
      update: {},
      create: {
        id: 'storage-bar-back',
        locationId: location.id,
        name: 'Bar Back',
        description: 'Back bar display and storage',
        sortOrder: 4,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-liquor-room' },
      update: {},
      create: {
        id: 'storage-liquor-room',
        locationId: location.id,
        name: 'Liquor Room',
        description: 'Secure liquor storage',
        sortOrder: 5,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-beer-cooler' },
      update: {},
      create: {
        id: 'storage-beer-cooler',
        locationId: location.id,
        name: 'Beer Cooler',
        description: 'Keg and bottled beer storage',
        sortOrder: 6,
      },
    }),
    prisma.storageLocation.upsert({
      where: { id: 'storage-kitchen-line' },
      update: {},
      create: {
        id: 'storage-kitchen-line',
        locationId: location.id,
        name: 'Kitchen Line',
        description: 'Prep and line coolers',
        sortOrder: 7,
      },
    }),
  ])
  console.log(`Created ${storageLocations.length} storage locations`)

  // ========================================
  // INGREDIENT CATEGORIES
  // ========================================
  console.log('Creating ingredient categories...')

  const ingredientCategories = [
    { id: 'ing-cat-proteins', code: 1, name: 'Proteins', icon: '🍖', color: '#ef4444' },
    { id: 'ing-cat-seafood', code: 2, name: 'Seafood', icon: '🦐', color: '#0ea5e9' },
    { id: 'ing-cat-cheeses', code: 3, name: 'Cheeses', icon: '🧀', color: '#eab308' },
    { id: 'ing-cat-vegetables', code: 4, name: 'Vegetables', icon: '🥬', color: '#22c55e' },
    { id: 'ing-cat-sauces', code: 5, name: 'Sauces', icon: '🥫', color: '#f97316' },
    { id: 'ing-cat-breads', code: 6, name: 'Breads', icon: '🍞', color: '#a16207' },
    { id: 'ing-cat-toppings', code: 7, name: 'Toppings', icon: '🧅', color: '#8b5cf6' },
    { id: 'ing-cat-garnishes', code: 8, name: 'Garnishes', icon: '🌿', color: '#10b981' },
  ]

  // Create category lookup map
  const categoryMap: Record<string, string> = {}
  for (const cat of ingredientCategories) {
    await prisma.ingredientCategory.upsert({
      where: { id: cat.id },
      update: {},
      create: {
        id: cat.id,
        locationId: location.id,
        code: cat.code,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        sortOrder: cat.code - 1,
      },
    })
    categoryMap[cat.name] = cat.id
  }
  console.log(`Created ${ingredientCategories.length} ingredient categories`)

  // ========================================
  // INGREDIENTS - Comprehensive Library
  // ========================================
  console.log('Creating ingredient library...')

  // Define all ingredients with modification options
  const allIngredients = [
    // ==========================================
    // PROTEINS
    // ==========================================
    { id: 'ing-beef-patty', name: 'Beef Patty', category: 'Proteins', allowNo: false, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 5.00 },
    { id: 'ing-chicken-breast', name: 'Grilled Chicken', category: 'Proteins', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 4.00 },
    { id: 'ing-crispy-chicken', name: 'Crispy Chicken', category: 'Proteins', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 4.50 },
    { id: 'ing-pulled-pork', name: 'Pulled Pork', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 3.50 },
    { id: 'ing-bacon', name: 'Bacon', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 2.50 },
    { id: 'ing-turkey', name: 'Turkey', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 3.00 },
    { id: 'ing-ham', name: 'Ham', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 2.50 },
    { id: 'ing-salami', name: 'Salami', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-pepperoni', name: 'Pepperoni', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-sausage', name: 'Italian Sausage', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 2.50 },
    { id: 'ing-meatball', name: 'Meatballs', category: 'Proteins', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 3.00 },
    { id: 'ing-steak', name: 'Steak', category: 'Proteins', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 6.00 },
    { id: 'ing-ribeye', name: 'Ribeye', category: 'Proteins', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 8.00 },
    { id: 'ing-brisket', name: 'Brisket', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 5.00 },
    { id: 'ing-chorizo', name: 'Chorizo', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 2.50 },
    { id: 'ing-prosciutto', name: 'Prosciutto', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 3.50 },
    { id: 'ing-pancetta', name: 'Pancetta', category: 'Proteins', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 3.00 },

    // ==========================================
    // SEAFOOD
    // ==========================================
    { id: 'ing-shrimp', name: 'Shrimp', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 5.00 },
    { id: 'ing-salmon', name: 'Salmon', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 6.00 },
    { id: 'ing-tuna', name: 'Tuna', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 5.50 },
    { id: 'ing-crab', name: 'Crab', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 7.00 },
    { id: 'ing-lobster', name: 'Lobster', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 10.00 },
    { id: 'ing-calamari', name: 'Calamari', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 4.50 },
    { id: 'ing-scallops', name: 'Scallops', category: 'Seafood', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 6.00 },
    { id: 'ing-anchovies', name: 'Anchovies', category: 'Seafood', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },

    // ==========================================
    // CHEESES
    // ==========================================
    { id: 'ing-american', name: 'American Cheese', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-cheddar', name: 'Cheddar', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-swiss', name: 'Swiss', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-provolone', name: 'Provolone', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-mozzarella', name: 'Mozzarella', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-pepper-jack', name: 'Pepper Jack', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-blue-cheese', name: 'Blue Cheese', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-gouda', name: 'Gouda', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-brie', name: 'Brie', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-feta', name: 'Feta', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-parmesan', name: 'Parmesan', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-goat-cheese', name: 'Goat Cheese', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-cream-cheese', name: 'Cream Cheese', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-ricotta', name: 'Ricotta', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-cotija', name: 'Cotija', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-queso-fresco', name: 'Queso Fresco', category: 'Cheeses', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },

    // ==========================================
    // VEGETABLES
    // ==========================================
    { id: 'ing-lettuce', name: 'Lettuce', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-romaine', name: 'Romaine', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-spinach', name: 'Spinach', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-arugula', name: 'Arugula', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-kale', name: 'Kale', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-mixed-greens', name: 'Mixed Greens', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-tomato', name: 'Tomato', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-cherry-tomato', name: 'Cherry Tomatoes', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-sun-dried-tomato', name: 'Sun-Dried Tomatoes', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-onion', name: 'Onion', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-red-onion', name: 'Red Onion', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-green-onion', name: 'Green Onion', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-caramelized-onion', name: 'Caramelized Onions', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-pickles', name: 'Pickles', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-cucumber', name: 'Cucumber', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-bell-pepper', name: 'Bell Peppers', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-roasted-pepper', name: 'Roasted Red Peppers', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-jalapeno', name: 'Jalapeños', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-banana-pepper', name: 'Banana Peppers', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-mushroom', name: 'Mushrooms', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-portobello', name: 'Portobello', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-avocado', name: 'Avocado', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-guacamole', name: 'Guacamole', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 2.50 },
    { id: 'ing-corn', name: 'Corn', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-black-beans', name: 'Black Beans', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-pinto-beans', name: 'Pinto Beans', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-olives', name: 'Black Olives', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-kalamata', name: 'Kalamata Olives', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-artichoke', name: 'Artichoke Hearts', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-broccoli', name: 'Broccoli', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-zucchini', name: 'Zucchini', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-eggplant', name: 'Eggplant', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-cabbage', name: 'Cabbage', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-coleslaw', name: 'Coleslaw', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-sprouts', name: 'Sprouts', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-pico', name: 'Pico de Gallo', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },

    // ==========================================
    // SAUCES & CONDIMENTS
    // ==========================================
    { id: 'ing-ketchup', name: 'Ketchup', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-mustard', name: 'Yellow Mustard', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-dijon', name: 'Dijon Mustard', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-honey-mustard', name: 'Honey Mustard', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-mayo', name: 'Mayo', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-chipotle-mayo', name: 'Chipotle Mayo', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-garlic-aioli', name: 'Garlic Aioli', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-sriracha-aioli', name: 'Sriracha Aioli', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-special-sauce', name: 'Special Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-bbq', name: 'BBQ Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-honey-bbq', name: 'Honey BBQ', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-carolina-bbq', name: 'Carolina Gold BBQ', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-buffalo', name: 'Buffalo Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-hot-sauce', name: 'Hot Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-sriracha', name: 'Sriracha', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-ranch', name: 'Ranch', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-blue-dressing', name: 'Blue Cheese Dressing', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-caesar', name: 'Caesar Dressing', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-balsamic', name: 'Balsamic Vinaigrette', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-italian-dressing', name: 'Italian Dressing', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-thousand', name: 'Thousand Island', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-sour-cream', name: 'Sour Cream', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-salsa', name: 'Salsa', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-salsa-verde', name: 'Salsa Verde', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-marinara', name: 'Marinara', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-alfredo', name: 'Alfredo Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-pesto', name: 'Pesto', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-teriyaki', name: 'Teriyaki', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-soy-sauce', name: 'Soy Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-ginger-sauce', name: 'Ginger Sauce', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-sweet-chili', name: 'Sweet Chili', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-tzatziki', name: 'Tzatziki', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-hummus', name: 'Hummus', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-tahini', name: 'Tahini', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-queso', name: 'Queso', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-gravy', name: 'Gravy', category: 'Sauces', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.75 },

    // ==========================================
    // BREADS & BASES
    // ==========================================
    { id: 'ing-brioche-bun', name: 'Brioche Bun', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-sesame-bun', name: 'Sesame Bun', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-pretzel-bun', name: 'Pretzel Bun', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 1.00 },
    { id: 'ing-ciabatta', name: 'Ciabatta', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.75 },
    { id: 'ing-sourdough', name: 'Sourdough', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-wheat-bread', name: 'Wheat Bread', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-white-bread', name: 'White Bread', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-rye-bread', name: 'Rye Bread', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-texas-toast', name: 'Texas Toast', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-hoagie-roll', name: 'Hoagie Roll', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-french-bread', name: 'French Bread', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-baguette', name: 'Baguette', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.75 },
    { id: 'ing-croissant', name: 'Croissant', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 1.00 },
    { id: 'ing-english-muffin', name: 'English Muffin', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-pita', name: 'Pita Bread', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-naan', name: 'Naan', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 1.00 },
    { id: 'ing-flatbread', name: 'Flatbread', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-tortilla-flour', name: 'Flour Tortilla', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-tortilla-corn', name: 'Corn Tortilla', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-wrap-spinach', name: 'Spinach Wrap', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-wrap-tomato', name: 'Tomato Wrap', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0.50 },
    { id: 'ing-lettuce-wrap', name: 'Lettuce Wrap', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 0 },
    { id: 'ing-gf-bun', name: 'Gluten-Free Bun', category: 'Breads', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: false, extraPrice: 2.00 },

    // ==========================================
    // TOPPINGS & EXTRAS
    // ==========================================
    { id: 'ing-egg', name: 'Fried Egg', category: 'Toppings', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-egg-scrambled', name: 'Scrambled Egg', category: 'Toppings', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 1.50 },
    { id: 'ing-onion-rings', name: 'Onion Ring', category: 'Toppings', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-fried-onion', name: 'Crispy Fried Onions', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-croutons', name: 'Croutons', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-walnuts', name: 'Walnuts', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-pecans', name: 'Pecans', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-almonds', name: 'Almonds', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 1.00 },
    { id: 'ing-sunflower', name: 'Sunflower Seeds', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-dried-cranberry', name: 'Dried Cranberries', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-tortilla-strips', name: 'Tortilla Strips', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-wontons', name: 'Crispy Wontons', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-sesame-seeds', name: 'Sesame Seeds', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0 },
    { id: 'ing-everything-seasoning', name: 'Everything Seasoning', category: 'Toppings', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.25 },

    // ==========================================
    // GARNISHES & HERBS
    // ==========================================
    { id: 'ing-cilantro', name: 'Cilantro', category: 'Garnishes', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-parsley', name: 'Parsley', category: 'Garnishes', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-basil', name: 'Fresh Basil', category: 'Garnishes', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-dill', name: 'Fresh Dill', category: 'Garnishes', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-chives', name: 'Chives', category: 'Garnishes', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.25 },
    { id: 'ing-mint', name: 'Fresh Mint', category: 'Garnishes', allowNo: true, allowLite: true, allowOnSide: true, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-lime-wedge', name: 'Lime Wedge', category: 'Garnishes', allowNo: true, allowLite: false, allowOnSide: true, allowExtra: true, extraPrice: 0 },
    { id: 'ing-lemon-wedge', name: 'Lemon Wedge', category: 'Garnishes', allowNo: true, allowLite: false, allowOnSide: true, allowExtra: true, extraPrice: 0 },
  ]

  // Create all ingredients
  for (const ing of allIngredients) {
    await prisma.ingredient.upsert({
      where: { id: ing.id },
      update: {},
      create: {
        id: ing.id,
        locationId: location.id,
        name: ing.name,
        category: ing.category, // Legacy string category
        categoryId: categoryMap[ing.category] || null, // New category relation
        allowNo: ing.allowNo,
        allowLite: ing.allowLite,
        allowOnSide: ing.allowOnSide,
        allowExtra: ing.allowExtra,
        extraPrice: ing.extraPrice,
        sortOrder: allIngredients.indexOf(ing),
      },
    })
  }
  console.log(`Created ${allIngredients.length} ingredients`)

  // Link ingredients to Classic Burger (item-5)
  const burgerIngredientLinks = [
    { id: 'link-burger-patty', ingredientId: 'ing-beef-patty', isIncluded: true },
    { id: 'link-burger-bun', ingredientId: 'ing-brioche-bun', isIncluded: true },
    { id: 'link-burger-lettuce', ingredientId: 'ing-lettuce', isIncluded: true },
    { id: 'link-burger-tomato', ingredientId: 'ing-tomato', isIncluded: true },
    { id: 'link-burger-onion', ingredientId: 'ing-onion', isIncluded: true },
    { id: 'link-burger-pickles', ingredientId: 'ing-pickles', isIncluded: false }, // Not included by default, available to add
    { id: 'link-burger-ketchup', ingredientId: 'ing-ketchup', isIncluded: false },
    { id: 'link-burger-mustard', ingredientId: 'ing-mustard', isIncluded: false },
    { id: 'link-burger-mayo', ingredientId: 'ing-mayo', isIncluded: false },
    { id: 'link-burger-special', ingredientId: 'ing-special-sauce', isIncluded: true }, // Comes with special sauce
  ]

  for (const link of burgerIngredientLinks) {
    await prisma.menuItemIngredient.upsert({
      where: {
        menuItemId_ingredientId: {
          menuItemId: 'item-5',
          ingredientId: link.ingredientId,
        },
      },
      update: {},
      create: {
        id: link.id,
        locationId: location.id,
        menuItemId: 'item-5', // Classic Burger
        ingredientId: link.ingredientId,
        isIncluded: link.isIncluded,
        sortOrder: burgerIngredientLinks.indexOf(link),
      },
    })
  }
  console.log(`Linked ${burgerIngredientLinks.length} ingredients to Classic Burger`)

  // =====================================================
  // COMPREHENSIVE FOOD MENU WITH NESTED MODIFIERS
  // =====================================================
  console.log('')
  console.log('Creating comprehensive food menu with nested modifiers...')

  // -------------------------------------------------------
  // NEW CATEGORIES
  // -------------------------------------------------------
  const breakfastCategory = await prisma.category.upsert({
    where: { id: 'cat-breakfast' },
    update: {},
    create: {
      id: 'cat-breakfast',
      locationId: location.id,
      name: 'Breakfast',
      color: '#f59e0b',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 18,
      showOnPOS: true,
    },
  })

  const wingsCategory = await prisma.category.upsert({
    where: { id: 'cat-wings' },
    update: {},
    create: {
      id: 'cat-wings',
      locationId: location.id,
      name: 'Wings',
      color: '#ef4444',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 19,
      showOnPOS: true,
    },
  })

  const steaksCategory = await prisma.category.upsert({
    where: { id: 'cat-steaks' },
    update: {},
    create: {
      id: 'cat-steaks',
      locationId: location.id,
      name: 'Steaks',
      color: '#991b1b',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 20,
      showOnPOS: true,
    },
  })

  const tacosCategory = await prisma.category.upsert({
    where: { id: 'cat-tacos' },
    update: {},
    create: {
      id: 'cat-tacos',
      locationId: location.id,
      name: 'Tacos',
      color: '#16a34a',
      categoryType: 'food',
      categoryShow: 'food',
      sortOrder: 21,
      showOnPOS: true,
    },
  })

  console.log('Created new categories:', [breakfastCategory.name, wingsCategory.name, steaksCategory.name, tacosCategory.name].join(', '))

  // -------------------------------------------------------
  // NEW MENU ITEMS
  // -------------------------------------------------------
  const breakfastItems = [
    { id: 'brkfst-1', categoryId: 'cat-breakfast', name: 'Build Your Own Omelette', price: 13.99, description: 'Choose up to 5 fillings, served with toast and potatoes' },
    { id: 'brkfst-2', categoryId: 'cat-breakfast', name: 'Classic Breakfast', price: 11.99, description: '2 eggs any style, toast, choice of meat, choice of potato' },
    { id: 'brkfst-3', categoryId: 'cat-breakfast', name: 'Pancakes', price: 9.99, description: 'Stack of 3 fluffy buttermilk pancakes with maple syrup' },
    { id: 'brkfst-4', categoryId: 'cat-breakfast', name: 'French Toast', price: 10.99, description: 'Thick-cut brioche dipped in cinnamon egg batter' },
    { id: 'brkfst-5', categoryId: 'cat-breakfast', name: 'Breakfast Burrito', price: 12.99, description: 'Flour tortilla stuffed with eggs, cheese, and your choice of fillings' },
    { id: 'brkfst-6', categoryId: 'cat-breakfast', name: 'Eggs Benedict', price: 14.99, description: 'Poached eggs on English muffin with Canadian bacon and hollandaise' },
    { id: 'brkfst-7', categoryId: 'cat-breakfast', name: 'Biscuits & Gravy', price: 9.99, description: 'Flaky biscuits smothered in sausage gravy' },
  ]

  for (const item of breakfastItems) {
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
      },
    })
  }
  console.log('Created', breakfastItems.length, 'breakfast items')

  const wingItems = [
    { id: 'wings-6', categoryId: 'cat-wings', name: '6pc Wings', price: 9.99, description: '6 crispy boneless wings tossed in your choice of sauce' },
    { id: 'wings-12', categoryId: 'cat-wings', name: '12pc Wings', price: 16.99, description: '12 crispy boneless wings tossed in your choice of sauce' },
    { id: 'wings-18', categoryId: 'cat-wings', name: '18pc Wings', price: 23.99, description: '18 crispy boneless wings - perfect for sharing' },
    { id: 'wings-24', categoryId: 'cat-wings', name: '24pc Wings', price: 29.99, description: '24 crispy boneless wings - party size' },
    { id: 'wings-bone-in-6', categoryId: 'cat-wings', name: '6pc Bone-In Wings', price: 10.99, description: '6 traditional bone-in wings' },
    { id: 'wings-bone-in-12', categoryId: 'cat-wings', name: '12pc Bone-In Wings', price: 18.99, description: '12 traditional bone-in wings' },
  ]

  for (const item of wingItems) {
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
      },
    })
  }
  console.log('Created', wingItems.length, 'wing items')

  const steakItems = [
    { id: 'steak-ny', categoryId: 'cat-steaks', name: 'NY Strip 12oz', price: 32.99, description: 'Hand-cut New York strip, served with two sides' },
    { id: 'steak-filet', categoryId: 'cat-steaks', name: 'Filet Mignon 8oz', price: 38.99, description: 'Center-cut filet, the most tender steak' },
    { id: 'steak-ribeye-16', categoryId: 'cat-steaks', name: 'Ribeye 16oz', price: 36.99, description: 'Bone-in ribeye, rich marbling and full flavor' },
    { id: 'steak-sirloin', categoryId: 'cat-steaks', name: 'Top Sirloin 10oz', price: 24.99, description: 'Lean and flavorful top sirloin' },
    { id: 'steak-porterhouse', categoryId: 'cat-steaks', name: 'Porterhouse 20oz', price: 44.99, description: 'The best of both worlds - strip and filet' },
    { id: 'steak-surf-turf', categoryId: 'cat-steaks', name: 'Surf & Turf', price: 42.99, description: '8oz filet paired with grilled lobster tail' },
  ]

  for (const item of steakItems) {
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
      },
    })
  }
  console.log('Created', steakItems.length, 'steak items')

  const tacoItems = [
    { id: 'taco-street', categoryId: 'cat-tacos', name: 'Street Tacos (3)', price: 11.99, description: 'Three street-style tacos on corn tortillas with cilantro and onion' },
    { id: 'taco-fish', categoryId: 'cat-tacos', name: 'Fish Tacos (3)', price: 13.99, description: 'Beer-battered cod with cabbage slaw and chipotle crema' },
    { id: 'taco-shrimp', categoryId: 'cat-tacos', name: 'Shrimp Tacos (3)', price: 14.99, description: 'Grilled shrimp with mango salsa and avocado' },
    { id: 'taco-carnitas', categoryId: 'cat-tacos', name: 'Carnitas Tacos (3)', price: 12.99, description: 'Slow-braised pork shoulder with pickled onion' },
    { id: 'taco-birria', categoryId: 'cat-tacos', name: 'Birria Tacos (3)', price: 14.99, description: 'Braised beef birria tacos with consomme for dipping' },
  ]

  for (const item of tacoItems) {
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
      },
    })
  }
  console.log('Created', tacoItems.length, 'taco items')

  // -------------------------------------------------------
  // DEEPEST CHILD MODIFIER GROUPS (Level 3 - create first)
  // -------------------------------------------------------

  // Loaded Fry Toppings (child of "Loaded" fry style)
  const loadedFryTopGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-loaded-fry-top' },
    update: {},
    create: {
      id: 'mod-loaded-fry-top',
      locationId: location.id,
      name: 'Loaded Toppings',
      displayName: 'Loaded Toppings',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 3,
      isRequired: false,
      sortOrder: 100,
    },
  })

  const loadedFryToppings = [
    { id: 'lft-bacon', name: 'Bacon', price: 0 },
    { id: 'lft-cheese-sauce', name: 'Cheese Sauce', price: 0 },
    { id: 'lft-sour-cream', name: 'Sour Cream', price: 0 },
    { id: 'lft-chives', name: 'Chives', price: 0 },
    { id: 'lft-jalapenos', name: 'Jalapenos', price: 0 },
    { id: 'lft-ranch', name: 'Ranch', price: 0 },
  ]

  for (const mod of loadedFryToppings) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: loadedFryTopGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: loadedFryToppings.indexOf(mod),
      },
    })
  }
  console.log('Created loaded fry toppings (deepest child)')

  // -------------------------------------------------------
  // MID-LEVEL CHILD MODIFIER GROUPS (Level 2)
  // -------------------------------------------------------

  // Fry Style (child of fries in side choice)
  const fryStyleGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-fry-style' },
    update: {},
    create: {
      id: 'mod-fry-style',
      locationId: location.id,
      name: 'Fry Style',
      displayName: 'Fry Style',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      sortOrder: 101,
    },
  })

  const fryStyles: Array<{ id: string; name: string; price: number; isDefault?: boolean; childModifierGroupId?: string }> = [
    { id: 'fstyle-regular', name: 'Regular', price: 0, isDefault: true },
    { id: 'fstyle-seasoned', name: 'Seasoned', price: 0 },
    { id: 'fstyle-cajun', name: 'Cajun', price: 0 },
    { id: 'fstyle-truffle', name: 'Truffle Parmesan', price: 2 },
    { id: 'fstyle-loaded', name: 'Loaded', price: 3, childModifierGroupId: loadedFryTopGroup.id },
  ]

  for (const mod of fryStyles) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: fryStyleGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: fryStyles.indexOf(mod),
        childModifierGroupId: mod.childModifierGroupId || null,
      },
    })
  }
  console.log('Created fry style modifiers with nested loaded toppings')

  // Gravy Choice (child of mashed potatoes)
  const gravyChoiceGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-gravy-choice' },
    update: {},
    create: {
      id: 'mod-gravy-choice',
      locationId: location.id,
      name: 'Gravy',
      displayName: 'Gravy?',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      sortOrder: 102,
    },
  })

  const gravyChoices: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'gravy-none', name: 'No Gravy', price: 0, isDefault: true },
    { id: 'gravy-brown', name: 'Brown Gravy', price: 0 },
    { id: 'gravy-white', name: 'White Gravy', price: 0 },
    { id: 'gravy-mushroom', name: 'Mushroom Gravy', price: 1 },
  ]

  for (const mod of gravyChoices) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: gravyChoiceGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: gravyChoices.indexOf(mod),
      },
    })
  }
  console.log('Created gravy choice modifiers')

  // Baked Potato Toppings (child of baked potato)
  const bakedPotatoTopGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-baked-potato-top' },
    update: {},
    create: {
      id: 'mod-baked-potato-top',
      locationId: location.id,
      name: 'Baked Potato Toppings',
      displayName: 'Baked Potato Toppings',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 5,
      isRequired: false,
      sortOrder: 103,
    },
  })

  const bakedPotatoToppings: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'bpt-butter', name: 'Butter', price: 0, isDefault: true },
    { id: 'bpt-sour-cream', name: 'Sour Cream', price: 0 },
    { id: 'bpt-cheese', name: 'Cheese', price: 0 },
    { id: 'bpt-bacon', name: 'Bacon Bits', price: 0 },
    { id: 'bpt-chives', name: 'Chives', price: 0 },
    { id: 'bpt-broc-cheese', name: 'Broccoli & Cheese', price: 1 },
  ]

  for (const mod of bakedPotatoToppings) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: bakedPotatoTopGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: bakedPotatoToppings.indexOf(mod),
      },
    })
  }
  console.log('Created baked potato toppings')

  // Side Salad Type (child of side salad in side choice)
  const sideSaladTypeGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-side-salad-type' },
    update: {},
    create: {
      id: 'mod-side-salad-type',
      locationId: location.id,
      name: 'Salad Type',
      displayName: 'Salad Type',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 104,
    },
  })

  // Side salad type modifiers: house salad -> reuses existing salad dressing, wedge -> also reuses salad dressing
  const sideSaladTypes: Array<{ id: string; name: string; price: number; isDefault?: boolean; childModifierGroupId?: string }> = [
    { id: 'sst-house', name: 'House Salad', price: 0, isDefault: true, childModifierGroupId: saladDressingGroup.id },
    { id: 'sst-caesar', name: 'Caesar Salad', price: 0 },
    { id: 'sst-wedge', name: 'Wedge Salad', price: 1, childModifierGroupId: saladDressingGroup.id },
  ]

  for (const mod of sideSaladTypes) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: sideSaladTypeGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: sideSaladTypes.indexOf(mod),
        childModifierGroupId: mod.childModifierGroupId || null,
      },
    })
  }
  console.log('Created side salad type modifiers (house/caesar/wedge) with dressing nesting')

  // Heat Level (child of spicy wing flavors)
  const heatLevelGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-heat-level' },
    update: {},
    create: {
      id: 'mod-heat-level',
      locationId: location.id,
      name: 'Heat Level',
      displayName: 'Heat Level',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 1,
      isRequired: false,
      sortOrder: 105,
    },
  })

  const heatLevels: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'heat-mild', name: 'Mild', price: 0, isDefault: true },
    { id: 'heat-medium', name: 'Medium', price: 0 },
    { id: 'heat-hot', name: 'Hot', price: 0 },
    { id: 'heat-extra-hot', name: 'Extra Hot', price: 0 },
  ]

  for (const mod of heatLevels) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: heatLevelGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: heatLevels.indexOf(mod),
      },
    })
  }
  console.log('Created heat level modifiers')

  // -------------------------------------------------------
  // TOP-LEVEL MODIFIER GROUPS (with child references)
  // -------------------------------------------------------

  // === SIDE CHOICE (shared across entrees, steaks, sandwiches) ===
  const sideChoiceGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-side-choice' },
    update: {},
    create: {
      id: 'mod-side-choice',
      locationId: location.id,
      name: 'Side Choice',
      displayName: 'Choose Your Side',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 30,
    },
  })

  const sideChoices: Array<{ id: string; name: string; price: number; isDefault?: boolean; childModifierGroupId?: string }> = [
    { id: 'side-ch-fries', name: 'French Fries', price: 0, isDefault: true, childModifierGroupId: fryStyleGroup.id },
    { id: 'side-ch-sweet-fries', name: 'Sweet Potato Fries', price: 2, childModifierGroupId: fryStyleGroup.id },
    { id: 'side-ch-mashed', name: 'Mashed Potatoes', price: 0, childModifierGroupId: gravyChoiceGroup.id },
    { id: 'side-ch-baked', name: 'Baked Potato', price: 0, childModifierGroupId: bakedPotatoTopGroup.id },
    { id: 'side-ch-mac', name: 'Mac & Cheese', price: 1 },
    { id: 'side-ch-onion-rings', name: 'Onion Rings', price: 1 },
    { id: 'side-ch-coleslaw', name: 'Coleslaw', price: 0 },
    { id: 'side-ch-broccoli', name: 'Steamed Broccoli', price: 0 },
    { id: 'side-ch-salad', name: 'Side Salad', price: 0, childModifierGroupId: sideSaladTypeGroup.id },
    { id: 'side-ch-rice', name: 'Rice Pilaf', price: 0 },
    { id: 'side-ch-corn', name: 'Corn on the Cob', price: 0 },
  ]

  for (const mod of sideChoices) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: sideChoiceGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: sideChoices.indexOf(mod),
        childModifierGroupId: mod.childModifierGroupId || null,
      },
    })
  }
  console.log('Created side choice modifiers with nested sub-choices')

  // === SIDE CHOICE 2 (steaks get two sides) ===
  const sideChoice2Group = await prisma.modifierGroup.upsert({
    where: { id: 'mod-side-choice-2' },
    update: {},
    create: {
      id: 'mod-side-choice-2',
      locationId: location.id,
      name: 'Second Side',
      displayName: 'Choose Second Side',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 31,
    },
  })

  const sideChoices2: Array<{ id: string; name: string; price: number; isDefault?: boolean; childModifierGroupId?: string }> = [
    { id: 'side-ch2-fries', name: 'French Fries', price: 0, isDefault: true, childModifierGroupId: fryStyleGroup.id },
    { id: 'side-ch2-sweet-fries', name: 'Sweet Potato Fries', price: 2, childModifierGroupId: fryStyleGroup.id },
    { id: 'side-ch2-mashed', name: 'Mashed Potatoes', price: 0, childModifierGroupId: gravyChoiceGroup.id },
    { id: 'side-ch2-baked', name: 'Baked Potato', price: 0, childModifierGroupId: bakedPotatoTopGroup.id },
    { id: 'side-ch2-mac', name: 'Mac & Cheese', price: 1 },
    { id: 'side-ch2-onion-rings', name: 'Onion Rings', price: 1 },
    { id: 'side-ch2-coleslaw', name: 'Coleslaw', price: 0 },
    { id: 'side-ch2-broccoli', name: 'Steamed Broccoli', price: 0 },
    { id: 'side-ch2-salad', name: 'Side Salad', price: 0, childModifierGroupId: sideSaladTypeGroup.id },
    { id: 'side-ch2-rice', name: 'Rice Pilaf', price: 0 },
    { id: 'side-ch2-corn', name: 'Corn on the Cob', price: 0 },
  ]

  for (const mod of sideChoices2) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: sideChoice2Group.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: sideChoices2.indexOf(mod),
        childModifierGroupId: mod.childModifierGroupId || null,
      },
    })
  }
  console.log('Created second side choice modifiers (for steaks)')

  // === OMELETTE FILLINGS ===
  const omeletteFillingGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-omelette-fillings' },
    update: {},
    create: {
      id: 'mod-omelette-fillings',
      locationId: location.id,
      name: 'Omelette Fillings',
      displayName: 'Choose Fillings (up to 5)',
      modifierTypes: ['food'],
      minSelections: 2,
      maxSelections: 5,
      isRequired: true,
      sortOrder: 32,
    },
  })

  const omeletteFillings = [
    { id: 'omfill-cheddar', name: 'Cheddar Cheese', price: 0 },
    { id: 'omfill-swiss', name: 'Swiss Cheese', price: 0 },
    { id: 'omfill-pepperjack', name: 'Pepper Jack', price: 0 },
    { id: 'omfill-mushrooms', name: 'Mushrooms', price: 0 },
    { id: 'omfill-onions', name: 'Onions', price: 0 },
    { id: 'omfill-bellpepper', name: 'Bell Peppers', price: 0 },
    { id: 'omfill-tomatoes', name: 'Tomatoes', price: 0 },
    { id: 'omfill-spinach', name: 'Spinach', price: 0 },
    { id: 'omfill-ham', name: 'Ham', price: 1 },
    { id: 'omfill-bacon', name: 'Bacon', price: 1.50 },
    { id: 'omfill-sausage', name: 'Sausage', price: 1 },
    { id: 'omfill-avocado', name: 'Avocado', price: 1.50 },
    { id: 'omfill-jalapenos', name: 'Jalapenos', price: 0 },
    { id: 'omfill-broccoli', name: 'Broccoli', price: 0 },
  ]

  for (const mod of omeletteFillings) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: omeletteFillingGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: omeletteFillings.indexOf(mod),
      },
    })
  }
  console.log('Created', omeletteFillings.length, 'omelette filling modifiers')

  // === OMELETTE STYLE ===
  const omeletteStyleGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-omelette-style' },
    update: {},
    create: {
      id: 'mod-omelette-style',
      locationId: location.id,
      name: 'Omelette Style',
      displayName: 'Style',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 33,
    },
  })

  const omeletteStyles: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'omstyle-traditional', name: 'Traditional', price: 0, isDefault: true },
    { id: 'omstyle-eggwhite', name: 'Egg White Only', price: 1 },
    { id: 'omstyle-stuffed', name: 'Stuffed', price: 0 },
  ]

  for (const mod of omeletteStyles) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: omeletteStyleGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: omeletteStyles.indexOf(mod),
      },
    })
  }
  console.log('Created omelette style modifiers')

  // === TOAST CHOICE ===
  const toastChoiceGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-toast-choice' },
    update: {},
    create: {
      id: 'mod-toast-choice',
      locationId: location.id,
      name: 'Toast',
      displayName: 'Toast',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 34,
    },
  })

  const toastChoices: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'toast-white', name: 'White', price: 0, isDefault: true },
    { id: 'toast-wheat', name: 'Wheat', price: 0 },
    { id: 'toast-sourdough', name: 'Sourdough', price: 0 },
    { id: 'toast-rye', name: 'Rye', price: 0 },
    { id: 'toast-english-muffin', name: 'English Muffin', price: 0 },
    { id: 'toast-biscuit', name: 'Biscuit', price: 0 },
    { id: 'toast-none', name: 'No Toast', price: 0 },
  ]

  for (const mod of toastChoices) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: toastChoiceGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: toastChoices.indexOf(mod),
      },
    })
  }
  console.log('Created toast choice modifiers')

  // === BREAKFAST MEAT ===
  const breakfastMeatGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-breakfast-meat' },
    update: {},
    create: {
      id: 'mod-breakfast-meat',
      locationId: location.id,
      name: 'Breakfast Meat',
      displayName: 'Choose Meat',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 35,
    },
  })

  const breakfastMeats: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'bmeat-bacon', name: 'Bacon', price: 0, isDefault: true },
    { id: 'bmeat-sausage-patty', name: 'Sausage Patties', price: 0 },
    { id: 'bmeat-sausage-link', name: 'Sausage Links', price: 0 },
    { id: 'bmeat-ham', name: 'Ham', price: 0 },
    { id: 'bmeat-turkey-sausage', name: 'Turkey Sausage', price: 1 },
  ]

  for (const mod of breakfastMeats) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: breakfastMeatGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: breakfastMeats.indexOf(mod),
      },
    })
  }
  console.log('Created breakfast meat modifiers')

  // === EGG STYLE ===
  const eggStyleGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-egg-style' },
    update: {},
    create: {
      id: 'mod-egg-style',
      locationId: location.id,
      name: 'Egg Style',
      displayName: 'How do you like your eggs?',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 36,
    },
  })

  const eggStyles: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'egg-scrambled', name: 'Scrambled', price: 0, isDefault: true },
    { id: 'egg-over-easy', name: 'Over Easy', price: 0 },
    { id: 'egg-over-medium', name: 'Over Medium', price: 0 },
    { id: 'egg-over-hard', name: 'Over Hard', price: 0 },
    { id: 'egg-sunny-side', name: 'Sunny Side Up', price: 0 },
    { id: 'egg-poached', name: 'Poached', price: 0 },
  ]

  for (const mod of eggStyles) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: eggStyleGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: eggStyles.indexOf(mod),
      },
    })
  }
  console.log('Created egg style modifiers')

  // === BREAKFAST POTATO ===
  const breakfastPotatoGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-breakfast-potato' },
    update: {},
    create: {
      id: 'mod-breakfast-potato',
      locationId: location.id,
      name: 'Breakfast Potato',
      displayName: 'Potato Choice',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 37,
    },
  })

  const breakfastPotatoes: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'bpot-hashbrown', name: 'Hash Browns', price: 0, isDefault: true },
    { id: 'bpot-homefries', name: 'Home Fries', price: 0 },
    { id: 'bpot-country', name: 'Country Potatoes', price: 0 },
    { id: 'bpot-none', name: 'No Potatoes', price: 0 },
  ]

  for (const mod of breakfastPotatoes) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: breakfastPotatoGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: breakfastPotatoes.indexOf(mod),
      },
    })
  }
  console.log('Created breakfast potato modifiers')

  // === WING FLAVORS (with heat level nesting) ===
  const wingFlavorGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-wing-flavors' },
    update: {},
    create: {
      id: 'mod-wing-flavors',
      locationId: location.id,
      name: 'Wing Flavors',
      displayName: 'Choose Flavors',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 3,
      isRequired: true,
      allowStacking: true,
      sortOrder: 38,
    },
  })

  const wingFlavors: Array<{ id: string; name: string; price: number; childModifierGroupId?: string }> = [
    { id: 'wflav-buffalo', name: 'Buffalo', price: 0, childModifierGroupId: heatLevelGroup.id },
    { id: 'wflav-bbq', name: 'BBQ', price: 0 },
    { id: 'wflav-honey-bbq', name: 'Honey BBQ', price: 0 },
    { id: 'wflav-garlic-parm', name: 'Garlic Parmesan', price: 0 },
    { id: 'wflav-lemon-pepper', name: 'Lemon Pepper', price: 0 },
    { id: 'wflav-teriyaki', name: 'Teriyaki', price: 0 },
    { id: 'wflav-mango-hab', name: 'Mango Habanero', price: 0, childModifierGroupId: heatLevelGroup.id },
    { id: 'wflav-nashville', name: 'Nashville Hot', price: 0, childModifierGroupId: heatLevelGroup.id },
    { id: 'wflav-sweet-chili', name: 'Sweet Chili', price: 0 },
    { id: 'wflav-dry-rub', name: 'Dry Rub', price: 0 },
    { id: 'wflav-old-bay', name: 'Old Bay', price: 0 },
    { id: 'wflav-carolina-gold', name: 'Carolina Gold', price: 0 },
  ]

  for (const mod of wingFlavors) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: wingFlavorGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: wingFlavors.indexOf(mod),
        childModifierGroupId: mod.childModifierGroupId || null,
      },
    })
  }
  console.log('Created', wingFlavors.length, 'wing flavor modifiers with heat level nesting')

  // === WING DIPPING SAUCES ===
  const wingDipsGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-wing-dips' },
    update: {},
    create: {
      id: 'mod-wing-dips',
      locationId: location.id,
      name: 'Dipping Sauces',
      displayName: 'Dipping Sauces',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 3,
      isRequired: false,
      sortOrder: 39,
    },
  })

  const wingDips = [
    { id: 'wdip-ranch', name: 'Ranch', price: 0 },
    { id: 'wdip-bleu-cheese', name: 'Blue Cheese', price: 0 },
    { id: 'wdip-honey-mustard', name: 'Honey Mustard', price: 0 },
    { id: 'wdip-bbq', name: 'BBQ', price: 0 },
    { id: 'wdip-hot-sauce', name: 'Hot Sauce', price: 0 },
    { id: 'wdip-sweet-chili', name: 'Sweet Chili', price: 0 },
    { id: 'wdip-extra-ranch', name: 'Extra Ranch', price: 0.75 },
  ]

  for (const mod of wingDips) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: wingDipsGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: wingDips.indexOf(mod),
      },
    })
  }
  console.log('Created wing dipping sauce modifiers')

  // === WING STYLE ===
  const wingStyleGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-wing-style' },
    update: {},
    create: {
      id: 'mod-wing-style',
      locationId: location.id,
      name: 'Wing Style',
      displayName: 'Style',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 40,
    },
  })

  const wingStyles: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'wstyle-tossed', name: 'Tossed', price: 0, isDefault: true },
    { id: 'wstyle-dry-rub', name: 'Dry Rub', price: 0 },
    { id: 'wstyle-extra-crispy', name: 'Extra Crispy', price: 0 },
  ]

  for (const mod of wingStyles) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: wingStyleGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: wingStyles.indexOf(mod),
      },
    })
  }
  console.log('Created wing style modifiers')

  // === STEAK ADD-ONS ===
  const steakAddonsGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-steak-addons' },
    update: {},
    create: {
      id: 'mod-steak-addons',
      locationId: location.id,
      name: 'Steak Add-Ons',
      displayName: 'Add-Ons',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 5,
      isRequired: false,
      sortOrder: 41,
    },
  })

  const steakAddons = [
    { id: 'stadd-mushrooms', name: 'Sauteed Mushrooms', price: 2 },
    { id: 'stadd-onions', name: 'Sauteed Onions', price: 1.50 },
    { id: 'stadd-bleu-cheese', name: 'Blue Cheese Crumbles', price: 2 },
    { id: 'stadd-shrimp', name: 'Shrimp Skewer', price: 8 },
    { id: 'stadd-lobster', name: 'Lobster Tail', price: 16 },
    { id: 'stadd-loaded-baked', name: 'Loaded Baked Potato', price: 3 },
    { id: 'stadd-au-jus', name: 'Au Jus', price: 0 },
    { id: 'stadd-horseradish', name: 'Horseradish Cream', price: 0 },
    { id: 'stadd-compound-butter', name: 'Compound Butter', price: 0 },
  ]

  for (const mod of steakAddons) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: steakAddonsGroup.id,
        name: mod.name,
        price: mod.price,
        sortOrder: steakAddons.indexOf(mod),
      },
    })
  }
  console.log('Created steak add-on modifiers')

  // === TACO PROTEIN ===
  const tacoProteinGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-taco-protein' },
    update: {},
    create: {
      id: 'mod-taco-protein',
      locationId: location.id,
      name: 'Taco Protein',
      displayName: 'Choose Protein',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 42,
    },
  })

  const tacoProteins: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'tprot-carne-asada', name: 'Carne Asada', price: 0, isDefault: true },
    { id: 'tprot-chicken', name: 'Chicken', price: 0 },
    { id: 'tprot-al-pastor', name: 'Al Pastor', price: 0 },
    { id: 'tprot-carnitas', name: 'Carnitas', price: 0 },
    { id: 'tprot-ground-beef', name: 'Ground Beef', price: 0 },
    { id: 'tprot-veggie', name: 'Veggie', price: 0 },
  ]

  for (const mod of tacoProteins) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: tacoProteinGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: tacoProteins.indexOf(mod),
      },
    })
  }
  console.log('Created taco protein modifiers')

  // === TACO TOPPINGS ===
  const tacoToppingsGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-taco-toppings' },
    update: {},
    create: {
      id: 'mod-taco-toppings',
      locationId: location.id,
      name: 'Taco Toppings',
      displayName: 'Customize Toppings',
      modifierTypes: ['food'],
      minSelections: 0,
      maxSelections: 6,
      isRequired: false,
      sortOrder: 43,
    },
  })

  const tacoToppings: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'ttop-cilantro', name: 'Cilantro', price: 0, isDefault: true },
    { id: 'ttop-onion', name: 'Onion', price: 0, isDefault: true },
    { id: 'ttop-pico', name: 'Pico de Gallo', price: 0 },
    { id: 'ttop-guacamole', name: 'Guacamole', price: 1.50 },
    { id: 'ttop-sour-cream', name: 'Sour Cream', price: 0 },
    { id: 'ttop-cotija', name: 'Cotija Cheese', price: 0 },
    { id: 'ttop-lime-crema', name: 'Lime Crema', price: 0 },
    { id: 'ttop-pickled-onion', name: 'Pickled Onion', price: 0 },
    { id: 'ttop-jalapenos', name: 'Jalapenos', price: 0 },
    { id: 'ttop-salsa-verde', name: 'Salsa Verde', price: 0 },
    { id: 'ttop-salsa-roja', name: 'Salsa Roja', price: 0 },
  ]

  for (const mod of tacoToppings) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: tacoToppingsGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: tacoToppings.indexOf(mod),
      },
    })
  }
  console.log('Created taco topping modifiers')

  // === TACO SIDE ===
  const tacoSideGroup = await prisma.modifierGroup.upsert({
    where: { id: 'mod-taco-side' },
    update: {},
    create: {
      id: 'mod-taco-side',
      locationId: location.id,
      name: 'Taco Side',
      displayName: 'Side',
      modifierTypes: ['food'],
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 44,
    },
  })

  const tacoSides: Array<{ id: string; name: string; price: number; isDefault?: boolean }> = [
    { id: 'tside-rice-beans', name: 'Rice & Beans', price: 0, isDefault: true },
    { id: 'tside-chips-salsa', name: 'Chips & Salsa', price: 0 },
    { id: 'tside-street-corn', name: 'Street Corn', price: 2 },
    { id: 'tside-elote', name: 'Elote', price: 3 },
    { id: 'tside-none', name: 'No Side', price: 0 },
  ]

  for (const mod of tacoSides) {
    await prisma.modifier.upsert({
      where: { id: mod.id },
      update: {},
      create: {
        id: mod.id,
        locationId: location.id,
        modifierGroupId: tacoSideGroup.id,
        name: mod.name,
        price: mod.price,
        isDefault: mod.isDefault || false,
        sortOrder: tacoSides.indexOf(mod),
      },
    })
  }
  console.log('Created taco side modifiers')

  // -------------------------------------------------------
  // MENU ITEM ↔ MODIFIER GROUP LINKS
  // -------------------------------------------------------
  console.log('Linking modifier groups to menu items...')

  // Helper to create MenuItemModifierGroup links
  const createModLink = async (linkId: string, menuItemId: string, modifierGroupId: string, sortOrder: number) => {
    await prisma.menuItemModifierGroup.upsert({
      where: {
        menuItemId_modifierGroupId: {
          menuItemId,
          modifierGroupId,
        },
      },
      update: {},
      create: {
        id: linkId,
        locationId: location.id,
        menuItemId,
        modifierGroupId,
        sortOrder,
      },
    })
  }

  // --- BREAKFAST LINKS ---

  // Build Your Own Omelette → Fillings, Style, Toast, Potato
  await createModLink('link-brkfst1-fillings', 'brkfst-1', omeletteFillingGroup.id, 0)
  await createModLink('link-brkfst1-style', 'brkfst-1', omeletteStyleGroup.id, 1)
  await createModLink('link-brkfst1-toast', 'brkfst-1', toastChoiceGroup.id, 2)
  await createModLink('link-brkfst1-potato', 'brkfst-1', breakfastPotatoGroup.id, 3)

  // Classic Breakfast → Egg Style, Meat, Toast, Potato
  await createModLink('link-brkfst2-eggs', 'brkfst-2', eggStyleGroup.id, 0)
  await createModLink('link-brkfst2-meat', 'brkfst-2', breakfastMeatGroup.id, 1)
  await createModLink('link-brkfst2-toast', 'brkfst-2', toastChoiceGroup.id, 2)
  await createModLink('link-brkfst2-potato', 'brkfst-2', breakfastPotatoGroup.id, 3)

  // Pancakes → Breakfast Meat
  await createModLink('link-brkfst3-meat', 'brkfst-3', breakfastMeatGroup.id, 0)

  // French Toast → Breakfast Meat
  await createModLink('link-brkfst4-meat', 'brkfst-4', breakfastMeatGroup.id, 0)

  // Breakfast Burrito → Breakfast Meat, Omelette Fillings (reuse as burrito fillings)
  await createModLink('link-brkfst5-meat', 'brkfst-5', breakfastMeatGroup.id, 0)
  await createModLink('link-brkfst5-fillings', 'brkfst-5', omeletteFillingGroup.id, 1)

  // Eggs Benedict → Breakfast Potato
  await createModLink('link-brkfst6-potato', 'brkfst-6', breakfastPotatoGroup.id, 0)

  console.log('Linked breakfast items to modifier groups')

  // --- WING LINKS ---
  const allWingItemIds = wingItems.map(i => i.id)
  for (const itemId of allWingItemIds) {
    await createModLink(`link-${itemId}-flavors`, itemId, wingFlavorGroup.id, 0)
    await createModLink(`link-${itemId}-dips`, itemId, wingDipsGroup.id, 1)
    await createModLink(`link-${itemId}-style`, itemId, wingStyleGroup.id, 2)
  }
  console.log('Linked', allWingItemIds.length, 'wing items to flavor/dip/style groups')

  // --- STEAK LINKS ---
  const allSteakItemIds = steakItems.map(i => i.id)
  for (const itemId of allSteakItemIds) {
    await createModLink(`link-${itemId}-temp`, itemId, steakTempGroup.id, 0)
    await createModLink(`link-${itemId}-side1`, itemId, sideChoiceGroup.id, 1)
    await createModLink(`link-${itemId}-side2`, itemId, sideChoice2Group.id, 2)
    await createModLink(`link-${itemId}-addons`, itemId, steakAddonsGroup.id, 3)
  }
  console.log('Linked', allSteakItemIds.length, 'steak items to temp/sides/add-ons groups')

  // --- TACO LINKS ---
  const allTacoItemIds = tacoItems.map(i => i.id)
  for (const itemId of allTacoItemIds) {
    await createModLink(`link-${itemId}-toppings`, itemId, tacoToppingsGroup.id, 0)
    await createModLink(`link-${itemId}-tside`, itemId, tacoSideGroup.id, 1)
  }
  // Street Tacos additionally get protein choice
  await createModLink('link-taco-street-protein', 'taco-street', tacoProteinGroup.id, 2)
  console.log('Linked', allTacoItemIds.length, 'taco items to topping/side groups (+ protein for street tacos)')

  // --- EXISTING ITEM ADDITIONAL LINKS ---

  // Classic Burger (item-5) → Side Choice
  await createModLink('link-burger-side', 'item-5', sideChoiceGroup.id, 2)

  // Ribeye Steak (item-7) → Side Choice, Side Choice 2, Steak Add-ons
  await createModLink('link-ribeye-side1', 'item-7', sideChoiceGroup.id, 2)
  await createModLink('link-ribeye-side2', 'item-7', sideChoice2Group.id, 3)
  await createModLink('link-ribeye-addons', 'item-7', steakAddonsGroup.id, 4)

  // Grilled Salmon (item-6) → Side Choice
  await createModLink('link-salmon-side', 'item-6', sideChoiceGroup.id, 1)

  // All Sandwiches → Side Choice
  const sandwichSideIds = ['sandwich-1', 'sandwich-2', 'sandwich-3', 'sandwich-4', 'sandwich-5']
  for (const itemId of sandwichSideIds) {
    await createModLink(`link-${itemId}-side`, itemId, sideChoiceGroup.id, 1)
  }

  // Grilled Chicken Sandwich (sandwich-3) → Salad Dressing (for the sauce)
  await createModLink('link-sandwich3-dressing', 'sandwich-3', saladDressingGroup.id, 2)

  console.log('Linked existing items (burger, ribeye, salmon, sandwiches) to side choice groups')

  // -------------------------------------------------------
  // BREAKFAST INGREDIENTS
  // -------------------------------------------------------
  // Breakfast ingredients - unique names only (Spinach, Avocado, Mushrooms, Bell Peppers already exist)
  const breakfastIngredients = [
    // Proteins
    { id: 'ing-bacon-strips', name: 'Bacon Strips', category: 'Proteins', allowNo: false, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-sausage', name: 'Breakfast Sausage', category: 'Proteins', allowNo: false, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 2.00 },
    { id: 'ing-ham-sliced', name: 'Ham (Sliced)', category: 'Proteins', allowNo: false, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 2.00 },
    // Dairy
    { id: 'ing-cheddar-shred', name: 'Cheddar Shredded', category: 'Dairy', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-swiss-slice', name: 'Swiss Sliced', category: 'Dairy', allowNo: true, allowLite: false, allowOnSide: false, allowExtra: true, extraPrice: 0.75 },
    { id: 'ing-pepper-jack-shred', name: 'Pepper Jack Shredded', category: 'Dairy', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.75 },
    // Vegetables
    { id: 'ing-mushrooms-sliced', name: 'Mushrooms (Sliced)', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-bell-pepper-diced', name: 'Bell Peppers (Diced)', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.50 },
    { id: 'ing-onion-diced-brkfst', name: 'Onion (Diced)', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.25 },
    { id: 'ing-tomato-diced-brkfst', name: 'Tomato (Diced)', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.25 },
    { id: 'ing-jalapeno-sliced-brkfst', name: 'Jalapeno (Sliced)', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.25 },
    { id: 'ing-broccoli-floret-brkfst', name: 'Broccoli (Florets)', category: 'Vegetables', allowNo: true, allowLite: true, allowOnSide: false, allowExtra: true, extraPrice: 0.50 },
  ]

  for (const ing of breakfastIngredients) {
    await prisma.ingredient.upsert({
      where: { id: ing.id },
      update: {},
      create: {
        id: ing.id,
        locationId: location.id,
        name: ing.name,
        category: ing.category,
        categoryId: categoryMap[ing.category] || null,
        allowNo: ing.allowNo,
        allowLite: ing.allowLite,
        allowOnSide: ing.allowOnSide,
        allowExtra: ing.allowExtra,
        extraPrice: ing.extraPrice,
        sortOrder: breakfastIngredients.indexOf(ing) + allIngredients.length,
      },
    })
  }
  console.log('Created', breakfastIngredients.length, 'breakfast ingredients')

  console.log('')
  console.log('=== NESTED MODIFIER SUMMARY ===')
  console.log('New categories: 4 (Breakfast, Wings, Steaks, Tacos)')
  console.log('New menu items:', breakfastItems.length + wingItems.length + steakItems.length + tacoItems.length)
  console.log('New modifier groups: 15 (including nested child groups)')
  console.log('Nesting depth examples:')
  console.log('  Side Choice → French Fries → Fry Style → Loaded → Loaded Toppings (4 levels)')
  console.log('  Side Choice → Side Salad → Salad Type → House Salad → Dressing (4 levels)')
  console.log('  Wing Flavors → Buffalo → Heat Level (2 levels)')
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
  console.log('Food Menu Created:')
  console.log('  - ' + breakfastItems.length + ' breakfast items')
  console.log('  - ' + wingItems.length + ' wing items')
  console.log('  - ' + steakItems.length + ' steak items')
  console.log('  - ' + tacoItems.length + ' taco items')
  console.log('')
  console.log('Pizza Builder Created:')
  console.log('  - ' + pizzaSizes.length + ' sizes')
  console.log('  - ' + pizzaCrusts.length + ' crusts')
  console.log('  - ' + pizzaSauces.length + ' sauces')
  console.log('  - ' + pizzaCheeses.length + ' cheeses')
  console.log('  - ' + pizzaToppings.length + ' toppings')
  console.log('  - ' + (specialtyPizzas.length + 1) + ' specialty pizzas (including Build Your Own)')
  console.log('')
  console.log('Nested Modifier System:')
  console.log('  - 15 new modifier groups')
  console.log('  - 4 levels of nesting depth')
  console.log('  - ' + (sideChoices.length + sideChoices2.length + fryStyles.length + loadedFryToppings.length + gravyChoices.length + bakedPotatoToppings.length + sideSaladTypes.length + omeletteFillings.length + omeletteStyles.length + toastChoices.length + breakfastMeats.length + eggStyles.length + breakfastPotatoes.length + wingFlavors.length + wingDips.length + wingStyles.length + steakAddons.length + tacoProteins.length + tacoToppings.length + tacoSides.length + heatLevels.length) + ' total new modifiers')
  console.log('')
  console.log('Inventory System Created:')
  console.log('  - ' + voidReasons.length + ' void reasons')
  console.log('  - ' + storageLocations.length + ' storage locations')
  console.log('')
  console.log('Ingredients Library Created:')
  console.log('  - ' + allIngredients.length + ' base ingredients')
  console.log('  - ' + breakfastIngredients.length + ' breakfast ingredients')
  console.log('  - ' + burgerIngredientLinks.length + ' burger recipe links')
  console.log('')
  console.log('Ingredient Categories:')
  const ingCategories = [...new Set(allIngredients.map(i => i.category))]
  ingCategories.forEach(cat => {
    const count = allIngredients.filter(i => i.category === cat).length
    console.log(`  - ${cat}: ${count} items`)
  })
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
