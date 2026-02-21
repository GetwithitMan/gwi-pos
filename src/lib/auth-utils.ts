// Client-safe auth utilities - NO database imports
// These can be used in both client and server components

export function hasPermission(permissions: string[], requiredPermission: string): boolean {
  // Admin/super_admin has all permissions
  if (permissions.includes('admin') || permissions.includes('super_admin') || permissions.includes('*')) {
    return true
  }

  // Check for exact match
  if (permissions.includes(requiredPermission)) {
    return true
  }

  // Check for wildcard patterns (e.g., 'pos.*' matches 'pos.access')
  for (const perm of permissions) {
    if (perm.endsWith('.*')) {
      const prefix = perm.slice(0, -2) // Remove '.*'
      if (requiredPermission.startsWith(prefix + '.')) {
        return true
      }
    }
  }

  return false
}

// Permission constants - comprehensive set for POS operations
export const PERMISSIONS = {
  // === POS ACCESS ===
  POS_ACCESS: 'pos.access',
  POS_TABLE_SERVICE: 'pos.table_service',
  POS_QUICK_ORDER: 'pos.quick_order',
  POS_KDS_ACCESS: 'pos.kds',
  POS_CASH_PAYMENTS: 'pos.cash_payments',
  POS_CARD_PAYMENTS: 'pos.card_payments',
  POS_CASH_DRAWER: 'pos.cash_drawer',
  POS_VIEW_OTHERS_ORDERS: 'pos.view_others_orders',
  POS_EDIT_OTHERS_ORDERS: 'pos.edit_others_orders',
  POS_SPLIT_CHECKS: 'pos.split_checks',
  POS_CHANGE_TABLE: 'pos.change_table',
  POS_CHANGE_SERVER: 'pos.change_server',
  POS_NO_SALE: 'pos.no_sale',

  // === MANAGER ===
  MGR_DISCOUNTS: 'manager.discounts',
  MGR_VOID_ITEMS: 'manager.void_items',
  MGR_VOID_ORDERS: 'manager.void_orders',
  MGR_VOID_PAYMENTS: 'manager.void_payments',
  MGR_REFUNDS: 'manager.refunds',
  MGR_EDIT_SENT_ITEMS: 'manager.edit_sent_items',
  MGR_TRANSFER_CHECKS: 'manager.transfer_checks',
  MGR_BULK_OPERATIONS: 'manager.bulk_operations',
  MGR_SHIFT_REVIEW: 'manager.shift_review',
  MGR_CASH_DRAWER_BLIND: 'manager.cash_drawer_blind',
  MGR_CASH_DRAWER_FULL: 'manager.cash_drawer_full',
  MGR_CASH_VARIANCE_OVERRIDE: 'manager.cash_variance_override',
  MGR_PAY_IN_OUT: 'manager.pay_in_out',
  MGR_CLOSE_DAY: 'manager.close_day',
  MGR_TAX_EXEMPT: 'manager.tax_exempt',
  MGR_OPEN_ITEMS: 'manager.open_items',
  MGR_EDIT_TIME_ENTRIES: 'manager.edit_time_entries',
  MGR_END_BREAKS_EARLY: 'manager.end_breaks_early',
  MGR_FORCE_CLOCK_OUT: 'manager.force_clock_out',
  MGR_RECEIVE_TRANSFERS: 'manager.receive_transfers',

  // === REPORTS ===
  REPORTS_VIEW: 'reports.view',
  REPORTS_SALES: 'reports.sales',
  REPORTS_SALES_BY_EMPLOYEE: 'reports.sales_by_employee',
  REPORTS_LABOR: 'reports.labor',
  REPORTS_COMMISSION: 'reports.commission',
  REPORTS_PRODUCT_MIX: 'reports.product_mix',
  REPORTS_INVENTORY: 'reports.inventory',
  REPORTS_TIMESHEET: 'reports.timesheet',
  REPORTS_TABS: 'reports.tabs',
  REPORTS_PAID_IN_OUT: 'reports.paid_in_out',
  REPORTS_CUSTOMERS: 'reports.customers',
  REPORTS_VOIDS: 'reports.voids',
  REPORTS_GIFT_CARDS: 'reports.gift_cards',
  REPORTS_EXPORT: 'reports.export',

  // === MENU ===
  MENU_VIEW: 'menu.view',
  MENU_EDIT_ITEMS: 'menu.edit_items',
  MENU_EDIT_PRICES: 'menu.edit_prices',
  MENU_EDIT_MODIFIERS: 'menu.edit_modifiers',
  MENU_INVENTORY_QTY: 'menu.inventory_qty',
  MENU_86_ITEMS: 'menu.86_items',

  // === STAFF ===
  STAFF_VIEW: 'staff.view',
  STAFF_EDIT_PROFILE: 'staff.edit_profile',
  STAFF_EDIT_WAGES: 'staff.edit_wages',
  STAFF_MANAGE_ROLES: 'staff.manage_roles',
  STAFF_ASSIGN_ROLES: 'staff.assign_roles',
  STAFF_SCHEDULING: 'staff.scheduling',
  STAFF_CLOCK_OTHERS: 'staff.clock_others',

  // === TABLES ===
  TABLES_VIEW: 'tables.view',
  TABLES_EDIT: 'tables.edit',
  TABLES_FLOOR_PLAN: 'tables.floor_plan',
  TABLES_RESERVATIONS: 'tables.reservations',

  // === SETTINGS ===
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_EDIT: 'settings.edit',
  SETTINGS_TAX: 'settings.tax',
  SETTINGS_RECEIPTS: 'settings.receipts',
  SETTINGS_PAYMENTS: 'settings.payments',
  SETTINGS_DUAL_PRICING: 'settings.dual_pricing',

  // === SETTINGS (Granular per-section) ===
  SETTINGS_VENUE: 'settings.venue',
  SETTINGS_MENU: 'settings.menu',
  SETTINGS_INVENTORY: 'settings.inventory',
  SETTINGS_FLOOR: 'settings.floor',
  SETTINGS_CUSTOMERS: 'settings.customers',
  SETTINGS_TEAM: 'settings.team',
  SETTINGS_TIPS: 'settings.tips',
  SETTINGS_REPORTS: 'settings.reports',
  SETTINGS_HARDWARE: 'settings.hardware',
  SETTINGS_SECURITY: 'settings.security',
  SETTINGS_INTEGRATIONS: 'settings.integrations',
  SETTINGS_AUTOMATION: 'settings.automation',
  SETTINGS_MONITORING: 'settings.monitoring',

  // === TIPS ===
  TIPS_VIEW_OWN: 'tips.view_own',
  TIPS_VIEW_ALL: 'tips.view_all',
  TIPS_SHARE: 'tips.share',
  TIPS_COLLECT: 'tips.collect',
  TIPS_MANAGE_RULES: 'tips.manage_rules',
  TIPS_MANAGE_BANK: 'tips.manage_bank',
  TIPS_MANAGE_GROUPS: 'tips.manage_groups',
  TIPS_OVERRIDE_SPLITS: 'tips.override_splits',
  TIPS_MANAGE_SETTINGS: 'tips.manage_settings',
  TIPS_PERFORM_ADJUSTMENTS: 'tips.perform_adjustments',
  TIPS_VIEW_LEDGER: 'tips.view_ledger',
  TIPS_PROCESS_PAYOUT: 'tips.process_payout',

  // === INVENTORY ===
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MANAGE: 'inventory.manage',
  INVENTORY_COUNTS: 'inventory.counts',
  INVENTORY_ADJUST_PREP_STOCK: 'inventory.adjust_prep_stock',
  INVENTORY_WASTE: 'inventory.waste',
  INVENTORY_TRANSACTIONS: 'inventory.transactions',
  INVENTORY_VENDORS: 'inventory.vendors',

  // === CUSTOMERS ===
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_EDIT: 'customers.edit',
  CUSTOMERS_GIFT_CARDS: 'customers.gift_cards',
  CUSTOMERS_HOUSE_ACCOUNTS: 'customers.house_accounts',
  CUSTOMERS_COUPONS: 'customers.coupons',

  // === EVENTS ===
  EVENTS_VIEW: 'events.view',
  EVENTS_MANAGE: 'events.manage',

  // === SCHEDULING ===
  SCHEDULING_VIEW: 'scheduling.view',
  SCHEDULING_MANAGE: 'scheduling.manage',

  // === PAYROLL ===
  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_MANAGE: 'payroll.manage',

  // === ADMIN LEVELS ===
  ADMIN: 'admin',
  MANAGER: 'manager',
  SUPER_ADMIN: 'super_admin',
} as const

// Permission groups for UI organization
export const PERMISSION_GROUPS = {
  'POS Access': {
    description: 'Basic point of sale operations',
    permissions: [
      { key: 'pos.access', label: 'POS Access', description: 'Can access POS screen' },
      { key: 'pos.table_service', label: 'Table Service Mode', description: 'Dine-in order taking' },
      { key: 'pos.quick_order', label: 'Quick Order Mode', description: 'Takeout/bar orders' },
      { key: 'pos.kds', label: 'Kitchen Display', description: 'Access KDS screens' },
      { key: 'pos.cash_payments', label: 'Cash Payments', description: 'Process cash transactions' },
      { key: 'pos.card_payments', label: 'Card Payments', description: 'Process card transactions' },
      { key: 'pos.cash_drawer', label: 'Cash Drawer Access', description: 'Open cash drawer' },
      { key: 'pos.view_others_orders', label: "View Others' Orders", description: 'See other employees orders' },
      { key: 'pos.edit_others_orders', label: "Edit Others' Orders", description: 'Modify other employees orders' },
      { key: 'pos.split_checks', label: 'Split Checks', description: 'Split orders into multiple checks' },
      { key: 'pos.change_table', label: 'Change Table', description: 'Move orders between tables' },
      { key: 'pos.change_server', label: 'Change Server', description: 'Transfer orders to other employees' },
      { key: 'pos.no_sale', label: 'No Sale', description: 'Open drawer without transaction' },
    ],
  },
  'Manager': {
    description: 'Managerial operations and overrides',
    permissions: [
      { key: 'manager.discounts', label: 'Apply Discounts', description: 'Apply manual discounts' },
      { key: 'manager.void_items', label: 'Void Items', description: 'Remove items from orders' },
      { key: 'manager.void_orders', label: 'Void Orders', description: 'Cancel entire orders' },
      { key: 'manager.void_payments', label: 'Void Payments', description: 'Reverse completed payments' },
      { key: 'manager.refunds', label: 'Process Refunds', description: 'Issue refunds' },
      { key: 'manager.edit_sent_items', label: 'Edit Sent Items', description: 'Modify items already sent to kitchen' },
      { key: 'manager.transfer_checks', label: 'Transfer Checks', description: 'Move checks between employees' },
      { key: 'manager.bulk_operations', label: 'Bulk Operations', description: 'Bulk void/close checks' },
      { key: 'manager.shift_review', label: 'Shift Review', description: 'View shift sales data' },
      { key: 'manager.cash_drawer_blind', label: 'Cash Drawer (Blind)', description: 'Count drawer without seeing expected' },
      { key: 'manager.cash_drawer_full', label: 'Cash Drawer (Full)', description: 'See expected amounts when counting' },
      { key: 'manager.cash_variance_override', label: 'Cash Variance Override', description: 'Close with large variance' },
      { key: 'manager.pay_in_out', label: 'Paid In/Out', description: 'Record cash in/out transactions' },
      { key: 'manager.close_day', label: 'Close Out Day', description: 'End of day closeout' },
      { key: 'manager.tax_exempt', label: 'Tax Exempt', description: 'Remove tax from orders' },
      { key: 'manager.open_items', label: 'Open Items', description: 'Create open-priced items' },
      { key: 'manager.edit_time_entries', label: 'Edit Time Entries', description: 'Modify clock in/out times' },
      { key: 'manager.end_breaks_early', label: 'End Breaks Early', description: 'Force end employee breaks' },
      { key: 'manager.force_clock_out', label: 'Force Clock Out', description: 'Clock out employees with open tabs' },
      { key: 'manager.receive_transfers', label: 'Receive Transfers', description: 'Accept transferred tabs from other employees' },
    ],
  },
  'Reports': {
    description: 'Access to reports and analytics',
    permissions: [
      { key: 'reports.view', label: 'View Reports', description: 'Access reports section' },
      { key: 'reports.sales', label: 'Sales Reports', description: 'View sales data' },
      { key: 'reports.sales_by_employee', label: 'Sales by Employee', description: 'View individual employee sales' },
      { key: 'reports.labor', label: 'Labor Reports', description: 'View labor costs and hours' },
      { key: 'reports.commission', label: 'Commission Reports', description: 'View commission data' },
      { key: 'reports.product_mix', label: 'Product Mix', description: 'View item sales breakdown' },
      { key: 'reports.inventory', label: 'Inventory Reports', description: 'View stock levels' },
      { key: 'reports.timesheet', label: 'Timesheet Reports', description: 'View employee time entries' },
      { key: 'reports.tabs', label: 'Tab Reports', description: 'View open/closed tabs' },
      { key: 'reports.paid_in_out', label: 'Paid In/Out Reports', description: 'View cash movements' },
      { key: 'reports.customers', label: 'Customer Reports', description: 'View customer analytics' },
      { key: 'reports.voids', label: 'Void Reports', description: 'View void and comp history' },
      { key: 'reports.gift_cards', label: 'Gift Card Reports', description: 'View gift card activity' },
      { key: 'reports.export', label: 'Export Reports', description: 'Download report data' },
    ],
  },
  'Menu Management': {
    description: 'Menu and product configuration',
    permissions: [
      { key: 'menu.view', label: 'View Menu', description: 'See menu configuration' },
      { key: 'menu.edit_items', label: 'Edit Items', description: 'Add/modify menu items' },
      { key: 'menu.edit_prices', label: 'Edit Prices', description: 'Change item prices' },
      { key: 'menu.edit_modifiers', label: 'Edit Modifiers', description: 'Manage modifier groups' },
      { key: 'menu.inventory_qty', label: 'Inventory Quantity', description: 'Update stock counts' },
      { key: 'menu.86_items', label: '86 Items', description: 'Mark items unavailable' },
    ],
  },
  'Staff Management': {
    description: 'Employee and role administration',
    permissions: [
      { key: 'staff.view', label: 'View Staff', description: 'See employee list' },
      { key: 'staff.edit_profile', label: 'Edit Profiles', description: 'Modify employee info' },
      { key: 'staff.edit_wages', label: 'Edit Wages', description: 'Change pay rates' },
      { key: 'staff.manage_roles', label: 'Manage Roles', description: 'Create/edit roles' },
      { key: 'staff.assign_roles', label: 'Assign Roles', description: 'Assign roles to employees' },
      { key: 'staff.scheduling', label: 'Scheduling', description: 'Manage schedules' },
      { key: 'staff.clock_others', label: 'Clock Others', description: 'Clock in/out other employees' },
    ],
  },
  'Tables & Reservations': {
    description: 'Table and reservation management',
    permissions: [
      { key: 'tables.view', label: 'View Tables', description: 'See table layout' },
      { key: 'tables.edit', label: 'Edit Tables', description: 'Modify table configuration' },
      { key: 'tables.floor_plan', label: 'Floor Plan', description: 'Edit floor plan layout' },
      { key: 'tables.reservations', label: 'Reservations', description: 'Manage reservations' },
    ],
  },
  'Settings': {
    description: 'System configuration',
    permissions: [
      { key: 'settings.view', label: 'View Settings', description: 'See system settings' },
      { key: 'settings.edit', label: 'Edit Settings', description: 'Modify system settings' },
      { key: 'settings.tax', label: 'Tax Settings', description: 'Configure tax rules' },
      { key: 'settings.receipts', label: 'Receipt Settings', description: 'Configure receipt options' },
      { key: 'settings.payments', label: 'Payment Settings', description: 'Configure payment options' },
      { key: 'settings.dual_pricing', label: 'Dual Pricing', description: 'Toggle cash/card pricing' },
    ],
  },
  'Settings — Venue': {
    description: 'Business info, tax, order types configuration',
    permissions: [
      { key: 'settings.venue', label: 'Venue Settings', description: 'Business name, address, hours, timezone' },
      { key: 'settings.tax', label: 'Tax Configuration', description: 'Tax rules and rates' },
    ],
  },
  'Settings — Menu': {
    description: 'Menu builder, ingredients, combos, liquor',
    permissions: [
      { key: 'settings.menu', label: 'Menu Settings', description: 'Access menu builder, ingredients, combos, discounts' },
    ],
  },
  'Settings — Inventory': {
    description: 'Inventory management and tracking configuration',
    permissions: [
      { key: 'settings.inventory', label: 'Inventory Settings', description: 'Stock adjust, counts, waste, vendors' },
    ],
  },
  'Settings — Floor & Tables': {
    description: 'Floor plan, reservations, entertainment, events',
    permissions: [
      { key: 'settings.floor', label: 'Floor Settings', description: 'Floor plan editor, reservations, entertainment' },
    ],
  },
  'Settings — Customers': {
    description: 'Customer management, gift cards, house accounts',
    permissions: [
      { key: 'settings.customers', label: 'Customer Settings', description: 'Customer list, gift cards, house accounts, coupons' },
    ],
  },
  'Settings — Team': {
    description: 'Employee management, roles, scheduling, payroll',
    permissions: [
      { key: 'settings.team', label: 'Team Settings', description: 'Employees, roles, scheduling, payroll' },
    ],
  },
  'Settings — Tips': {
    description: 'Tip configuration, tip-out rules, tip groups',
    permissions: [
      { key: 'settings.tips', label: 'Tip Settings', description: 'Tip bank settings, tip-out rules, tip groups, payouts' },
    ],
  },
  'Settings — Payments': {
    description: 'Payment processing, receipts, tabs',
    permissions: [
      { key: 'settings.payments', label: 'Payment Settings', description: 'Payment config, receipts, tab policies' },
    ],
  },
  'Settings — Reports': {
    description: 'Access reports and analytics',
    permissions: [
      { key: 'settings.reports', label: 'Report Settings', description: 'Access all reports' },
    ],
  },
  'Settings — Hardware': {
    description: 'Printers, KDS screens, terminals, payment readers',
    permissions: [
      { key: 'settings.hardware', label: 'Hardware Settings', description: 'Printers, KDS, terminals, payment readers' },
    ],
  },
  'Settings — Security': {
    description: 'PIN lockout, blocked cards, suspicious alerts',
    permissions: [
      { key: 'settings.security', label: 'Security Settings', description: 'PIN policies, blocked cards, tip alerts' },
    ],
  },
  'Settings — Integrations': {
    description: 'Third-party service connections',
    permissions: [
      { key: 'settings.integrations', label: 'Integration Settings', description: 'SMS, email, Slack configuration' },
    ],
  },
  'Settings — Automation': {
    description: 'Automated processes and scheduling',
    permissions: [
      { key: 'settings.automation', label: 'Automation Settings', description: 'EOD batch, report scheduling, walkout recovery' },
    ],
  },
  'Settings — Monitoring': {
    description: 'System health and error monitoring',
    permissions: [
      { key: 'settings.monitoring', label: 'Monitoring', description: 'Error logs, system health dashboard' },
    ],
  },
  'Tips': {
    description: 'Tip sharing and management',
    permissions: [
      { key: 'tips.view_own', label: 'View Own Tips', description: 'See your own tips and tip shares' },
      { key: 'tips.view_all', label: 'View All Tips', description: 'See all employees tips' },
      { key: 'tips.share', label: 'Share Tips', description: 'Share tips to other employees' },
      { key: 'tips.collect', label: 'Collect Tips', description: 'Collect shared tips' },
      { key: 'tips.manage_rules', label: 'Manage Tip-Out Rules', description: 'Configure automatic tip-out rules' },
      { key: 'tips.manage_bank', label: 'Manage Tip Bank', description: 'Manage banked tips and payroll' },
      { key: 'tips.manage_groups', label: 'Manage Tip Groups', description: 'Start/stop tip groups, add/remove members' },
      { key: 'tips.override_splits', label: 'Override Splits', description: 'Change table ownership and tip splits' },
      { key: 'tips.manage_settings', label: 'Manage Tip Settings', description: 'Configure tip allocation, chargebacks, and policies' },
      { key: 'tips.perform_adjustments', label: 'Perform Adjustments', description: 'Retroactive tip edits with recalculation' },
      { key: 'tips.view_ledger', label: 'View Any Ledger', description: 'View any employees tip ledger (not just own)' },
      { key: 'tips.process_payout', label: 'Process Payouts', description: 'Cash payouts and payroll batch processing' },
    ],
  },
  'Inventory': {
    description: 'Inventory and prep stock management',
    permissions: [
      { key: 'inventory.view', label: 'View Inventory', description: 'See inventory levels and items' },
      { key: 'inventory.manage', label: 'Manage Inventory', description: 'Add/edit inventory items' },
      { key: 'inventory.counts', label: 'Daily Counts', description: 'Perform daily prep counts' },
      { key: 'inventory.adjust_prep_stock', label: 'Adjust Prep Stock', description: 'Make mid-day stock adjustments' },
      { key: 'inventory.waste', label: 'Record Waste', description: 'Log waste and spoilage' },
      { key: 'inventory.transactions', label: 'View Transactions', description: 'See inventory transaction history' },
      { key: 'inventory.vendors', label: 'Manage Vendors', description: 'Manage vendor information' },
    ],
  },
}

// Default role templates for quick setup
export const DEFAULT_ROLES: Record<string, string[]> = {
  'Server': [
    'pos.access', 'pos.table_service', 'pos.quick_order',
    'pos.cash_payments', 'pos.card_payments', 'pos.split_checks',
    'pos.change_table',
    'tips.view_own', 'tips.share', 'tips.collect',
  ],
  'Bartender': [
    'pos.access', 'pos.table_service', 'pos.quick_order',
    'pos.cash_payments', 'pos.card_payments', 'pos.cash_drawer',
    'pos.split_checks',
    'manager.cash_drawer_blind',
    'tips.view_own', 'tips.share', 'tips.collect',
    'menu.86_items',
  ],
  'Host': [
    'pos.access',
    'tables.view', 'tables.reservations',
    'customers.view', 'customers.edit',
  ],
  'Cook': [
    'pos.kds',
    'inventory.view', 'inventory.counts', 'inventory.adjust_prep_stock', 'inventory.waste',
  ],
  'Kitchen Manager': [
    'pos.kds',
    'inventory.view', 'inventory.manage', 'inventory.counts',
    'inventory.adjust_prep_stock', 'inventory.waste', 'inventory.vendors',
    'menu.view', 'menu.86_items',
    'settings.inventory',
  ],
  'Barback': [
    'pos.kds',
    'inventory.view', 'inventory.counts', 'inventory.adjust_prep_stock',
  ],
  'Manager': [
    'pos.*', 'manager.*', 'reports.*',
    'menu.view', 'menu.edit_items', 'menu.edit_prices', 'menu.edit_modifiers',
    'menu.86_items', 'menu.inventory_qty',
    'staff.*', 'tables.*', 'customers.*',
    'tips.*',
    'inventory.*',
    'settings.*',
    'events.*', 'scheduling.*', 'payroll.*',
  ],
  'Admin': ['admin'],
  'Owner': ['super_admin'],
}

// Check if user has super admin privileges
export function isSuperAdmin(permissions: string[]): boolean {
  return permissions.includes('super_admin') || permissions.includes('*')
}

// Check if user has admin privileges (includes super admin)
export function isAdmin(permissions: string[]): boolean {
  return permissions.includes('admin') || permissions.includes('super_admin') || permissions.includes('*')
}
