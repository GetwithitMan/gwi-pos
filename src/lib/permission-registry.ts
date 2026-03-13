// src/lib/permission-registry.ts
// Single source of truth for permission metadata.
// Powers the roles UI: (i) panels, filtering, risk warnings, tab grouping.
// Client-safe — no DB imports.
//
// IMPORTANT: roleType/accessLevel metadata is for UX/display only.
// It is NEVER used for authorization. All auth remains permission-key-based.

export type Risk = 'LOW' | 'MED' | 'HIGH' | 'CRITICAL'
export type PermissionTab = 'SHIFT_SERVICE' | 'TEAM_TIME' | 'REPORTING' | 'BUSINESS_SETUP'
export type RoleTypeCategory = 'FOH' | 'BOH' | 'ADMIN'

export interface PermissionMeta {
  key: string
  label: string
  description: string
  details: string[]
  examples?: string[]
  tab: PermissionTab
  applicableTo: RoleTypeCategory[]
  risk: Risk
  recommendedFor?: string[]
}

// ---------------------------------------------------------------------------
// Explicit registry: HIGH/CRITICAL + all BUSINESS_SETUP permissions
// ---------------------------------------------------------------------------

const PERMISSION_REGISTRY: Record<string, Omit<PermissionMeta, 'key'>> = {
  // =========================================================================
  // POS ACCESS — SHIFT_SERVICE
  // =========================================================================
  'pos.access': {
    label: 'POS Access',
    description: 'Lets this employee log in and use the register. Required for anything on the POS.',
    details: [
      'Without this permission, the employee cannot access the POS screen at all',
      'This is the most basic permission — nearly every role needs it',
      'Kitchen-only staff (cooks) typically use pos.kds instead',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Server', 'Bartender', 'Host'],
  },
  'pos.table_service': {
    label: 'Table Service',
    description: 'Lets this employee create and manage dine-in orders at tables.',
    details: [
      'Required for full-service restaurants where guests sit at tables',
      'Works with the floor plan to assign orders to specific tables',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Server'],
  },
  'pos.quick_order': {
    label: 'Quick Order',
    description: 'Lets this employee ring up bar tabs and quick counter orders without a table.',
    details: [
      'Used for bar service, takeout, and counter orders',
      'Does not require a table assignment',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Bartender', 'Server'],
  },
  'pos.kds': {
    label: 'Kitchen Display',
    description: 'Shows this employee the kitchen display screen to see incoming orders. For kitchen/BOH staff.',
    details: [
      'Provides access to the Kitchen Display System (KDS)',
      'Used by cooks and kitchen staff to view and manage incoming orders',
      'Does not grant access to the POS register',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Cook', 'Kitchen Manager'],
  },
  'pos.cash_payments': {
    label: 'Cash Payments',
    description: 'Lets this employee accept cash from customers.',
    details: [
      'Required to process cash transactions at the register',
      'Works alongside pos.cash_drawer for opening the drawer',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Server', 'Bartender'],
  },
  'pos.card_payments': {
    label: 'Card Payments',
    description: 'Lets this employee run credit/debit card transactions.',
    details: [
      'Required to process card payments via the Datacap terminal',
      'Includes pre-authorization for bar tabs',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Server', 'Bartender'],
  },
  'pos.cash_drawer': {
    label: 'Cash Drawer',
    description: 'Lets this employee open the cash drawer during a transaction.',
    details: [
      'Drawer opens automatically when processing a cash payment',
      'Use pos.no_sale to allow opening without a transaction',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Bartender'],
  },
  'pos.no_sale': {
    label: 'No Sale',
    description: 'Lets this employee open the cash drawer without processing a sale (e.g., to make change).',
    details: [
      'Opens the drawer without any transaction',
      'All no-sale events are logged for audit purposes',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Bartender'],
  },
  'pos.split_checks': {
    label: 'Split Checks',
    description: 'Lets this employee split a check between multiple people or payment methods.',
    details: [
      'Supports splitting by seat, by item, or evenly',
      'Also allows split payment (part cash, part card)',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Server', 'Bartender'],
  },
  'pos.change_table': {
    label: 'Change Table',
    description: 'Lets this employee move an order to a different table.',
    details: [
      'Useful when guests move or tables are combined',
      'The order stays with the original server unless also transferred',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'pos.change_server': {
    label: 'Change Server',
    description: 'Lets this employee reassign an order to a different employee.',
    details: [
      'Transfers responsibility (and tips) for the order',
      'Commonly used at shift change or section rotations',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'pos.view_others_orders': {
    label: "View Others' Orders",
    description: "Lets this employee see other employees' open orders.",
    details: [
      'Read-only access to orders owned by other employees',
      'Useful for managers and support staff monitoring the floor',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'pos.edit_others_orders': {
    label: "Edit Others' Orders",
    description: "Lets this employee add or remove items from another employee's open order.",
    details: [
      'Allows modifying orders that belong to someone else',
      'All changes are logged with the editing employee\'s identity',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },

  // =========================================================================
  // MANAGER — SHIFT SERVICE
  // =========================================================================
  'manager.discounts': {
    label: 'Apply Discounts',
    description: 'Lets this employee apply a manual discount to an order. HIGH RISK: improper use reduces revenue.',
    details: [
      'Covers both percentage and dollar amount discounts',
      'Does not require a manager override by default',
      'Audit trail is logged for every discount applied',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.void_items': {
    label: 'Void Items',
    description: 'Lets this employee remove an item from an order after it was sent to the kitchen.',
    details: [
      'Item is marked voided and removed from the bill',
      'Kitchen is notified',
      'A void reason may be required depending on settings',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.void_orders': {
    label: 'Void Orders',
    description: 'Lets this employee cancel an entire order.',
    details: [
      'Cancels all items on the order',
      'Does not reverse any payments already made',
      'Use manager.void_payments to reverse a payment',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.void_payments': {
    label: 'Void Payments',
    description: 'Lets this employee reverse a completed payment on a closed order.',
    details: [
      'CRITICAL: affects completed financial transactions',
      'Creates a full audit trail',
      'Only give this to managers or owners you trust completely',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'CRITICAL',
    recommendedFor: ['Manager', 'Owner'],
  },
  'manager.refunds': {
    label: 'Process Refunds',
    description: "Lets this employee issue a refund to a customer's card or as cash back.",
    details: [
      'Card refunds go back to the original payment method',
      'Cash refunds come from the drawer',
      'All refunds are logged for reporting',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.edit_sent_items': {
    label: 'Edit Sent Items',
    description: 'Lets this employee change the price or modifiers on an item that was already sent to the kitchen.',
    details: [
      'Allows modifying items after they have been sent',
      'Changes are logged in the audit trail',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.transfer_checks': {
    label: 'Transfer Checks',
    description: 'Lets this employee move a tab or check from one employee to another.',
    details: [
      'The receiving employee must have manager.receive_transfers permission',
      'Transfer history is logged for accountability',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager'],
  },
  'manager.bulk_operations': {
    label: 'Bulk Operations',
    description: 'Lets this employee void or close multiple checks at once (e.g., end-of-night cleanup).',
    details: [
      'Allows batch processing of open orders',
      'Useful for closing out forgotten tabs at end of day',
      'All individual operations are logged',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.tax_exempt': {
    label: 'Tax Exempt',
    description: 'Lets this employee remove sales tax from an order (e.g., for non-profit customers).',
    details: [
      'Removes tax from the entire order',
      'Tax-exempt orders are flagged in reports',
      'May require documentation for compliance',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.open_items': {
    label: 'Open Items',
    description: 'Lets this employee ring up an item without a set price — they type the amount manually.',
    details: [
      'Creates a custom-priced item on the order',
      'Open items are tracked separately in reports',
      'Can be abused to undercharge — give only to trusted staff',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.receive_transfers': {
    label: 'Receive Transfers',
    description: 'Lets this employee accept a tab that was transferred to them by another employee.',
    details: [
      'Required for an employee to receive transferred checks',
      'Works together with manager.transfer_checks',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Server', 'Bartender'],
  },
  'manager.keyed_entry': {
    label: 'Manual Card Entry',
    description: 'Allows this employee to manually type in credit card numbers for payment (card not present).',
    details: [
      'Used for phone orders, damaged cards, or when the card reader fails',
      'Higher fraud risk than card-present transactions — restrict to trusted managers',
      'Card data is sent directly to the processor and never stored locally',
      'All keyed entry transactions are audit-logged with employee ID',
    ],
    examples: [
      'Customer calls in a phone order and reads their card number',
      'Card chip is damaged and cannot be read by the terminal',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'manager.cash_variance_override': {
    label: 'Cash Variance Override',
    description: "Lets this employee close out the cash drawer even when the cash counted doesn't match what the system expects.",
    details: [
      'CRITICAL: can mask cash theft or accounting errors',
      'All overrides are logged',
      'Only give to owners and trusted managers',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'CRITICAL',
    recommendedFor: ['Manager', 'Owner'],
  },

  // =========================================================================
  // TEAM & TIME
  // =========================================================================
  'manager.edit_time_entries': {
    label: 'Edit Time Entries',
    description: "Lets this employee edit another employee's clock-in or clock-out time.",
    details: [
      'Changes to time entries affect payroll calculations',
      'All edits are logged with the original and modified values',
      'Use for correcting missed punches or time entry errors',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.end_breaks_early': {
    label: 'End Breaks Early',
    description: "Lets this employee end another employee's break before the timer runs out.",
    details: [
      'Overrides the scheduled break duration',
      'Break time is still recorded accurately for labor compliance',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.force_clock_out': {
    label: 'Force Clock Out',
    description: 'Lets this employee clock out another employee who forgot to clock out themselves.',
    details: [
      'Used when an employee leaves without clocking out',
      'The clock-out time can be set to a specific time',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.close_day': {
    label: 'Close Out Day',
    description: "Lets this employee run the end-of-day closeout to finalize the day's sales and reset totals.",
    details: [
      'Finalizes all transactions for the business day',
      'Generates end-of-day reports',
      'Cannot be undone once completed',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.shift_review': {
    label: 'Shift Review',
    description: 'Lets this employee view a summary of sales and activity during a shift.',
    details: [
      'Shows sales totals, voids, discounts, and payment breakdown',
      'Useful for shift handoff and accountability',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.cash_drawer_blind': {
    label: 'Cash Drawer (Blind Count)',
    description: 'Lets this employee count the cash drawer without seeing the expected total (blind count).',
    details: [
      'Employee enters their count without seeing what the system expects',
      'Prevents employees from adjusting their count to match',
      'More secure than full count access',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Bartender', 'Manager'],
  },
  'manager.cash_drawer_full': {
    label: 'Cash Drawer (Full Count)',
    description: 'Lets this employee see the expected drawer total when counting cash.',
    details: [
      'Shows the system-expected amount alongside the employee count',
      'Less secure than blind count — employee can adjust to match',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'manager.pay_in_out': {
    label: 'Paid In/Out',
    description: 'Lets this employee record cash going in or out of the drawer (e.g., dropping a safe deposit or getting change).',
    details: [
      'Tracks cash movements separate from sales',
      'Used for safe drops, bank runs, and petty cash',
      'All movements are logged and appear in reports',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'staff.view': {
    label: 'View Staff',
    description: 'Lets this employee see the list of employees.',
    details: [
      'Read-only view of the employee directory',
      'Does not include wage or payroll information',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'LOW',
  },
  'staff.edit_profile': {
    label: 'Edit Profiles',
    description: 'Lets this employee add, edit, or deactivate employee profiles.',
    details: [
      'Can create new employees and modify existing ones',
      'Includes changing names, PINs, and contact info',
      'Does not include wage changes (requires staff.edit_wages)',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'staff.edit_wages': {
    label: 'Edit Wages',
    description: "Lets this employee change an employee's hourly rate or salary.",
    details: [
      'FINANCIAL: changing wages affects payroll calculations',
      'Audit trail is kept for all wage changes',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'staff.manage_roles': {
    label: 'Manage Roles',
    description: 'Lets this employee create and edit roles and their permissions.',
    details: [
      'CRITICAL: this employee can grant themselves or others any permission',
      'Only give to owners and senior admins',
      'All role changes are logged',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'staff.assign_roles': {
    label: 'Assign Roles',
    description: 'Lets this employee change which role is assigned to an employee.',
    details: [
      'CRITICAL: combined with manage_roles, this grants full control over the permission system',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'staff.clock_others': {
    label: 'Clock Others',
    description: 'Lets this employee clock other employees in or out.',
    details: [
      'Useful for managers handling clock-ins at the start of a shift',
      'All buddy-punch events are logged',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'staff.scheduling': {
    label: 'Scheduling',
    description: 'Lets this employee view and manage the employee schedule.',
    details: [
      'Can view published schedules and shift assignments',
      'Includes availability requests and shift trades',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'scheduling.manage': {
    label: 'Manage Schedule',
    description: 'Lets this employee create and edit the employee schedule.',
    details: [
      'Full access to shift scheduling and availability management',
      'Can publish and modify schedules for all employees',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'payroll.manage': {
    label: 'Manage Payroll',
    description: 'Lets this employee process payroll, including exporting payroll data.',
    details: [
      'CRITICAL: grants access to all employee wage and tax data',
      'Can initiate payroll processing',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },

  // =========================================================================
  // REPORTING
  // =========================================================================
  'reports.view': {
    label: 'View Reports',
    description: 'Lets this employee access the reports section.',
    details: [
      'Required to see any reports',
      'Individual report types require their own permissions',
    ],
    tab: 'REPORTING',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'LOW',
  },
  'reports.sales': {
    label: 'Sales Reports',
    description: 'Lets this employee view total sales numbers for the business.',
    details: [
      'Shows revenue, transaction counts, and averages',
      'Does not break down by individual employee',
    ],
    tab: 'REPORTING',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'reports.sales_by_employee': {
    label: 'Sales by Employee',
    description: "Lets this employee see each employee's individual sales numbers.",
    details: [
      'Shows per-employee revenue breakdown',
      'Can reveal performance differences between staff',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'reports.labor': {
    label: 'Labor Reports',
    description: 'Lets this employee view labor costs and hours worked.',
    details: [
      'Shows total labor hours, costs, and labor percentage',
      'May reveal individual wage rates through calculation',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'reports.timesheet': {
    label: 'Timesheet Reports',
    description: 'Lets this employee view detailed time clock records for all employees.',
    details: [
      'Shows individual clock-in/out times, breaks, and total hours',
      'Contains sensitive scheduling and attendance data',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'reports.export': {
    label: 'Export Reports',
    description: 'Lets this employee download report data as a file.',
    details: [
      'CRITICAL: exported files may contain sensitive financial and employee data',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'reports.commission': {
    label: 'Commission Reports',
    description: 'Lets this employee view commission earnings by employee.',
    details: [
      'Shows per-employee commission totals and rates',
      'Contains sensitive compensation data',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'reports.product_mix': {
    label: 'Product Mix',
    description: 'Lets this employee see how many of each item was sold.',
    details: [
      'Shows quantity sold and revenue per menu item',
      'Useful for menu engineering and purchasing decisions',
    ],
    tab: 'REPORTING',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
  },
  'reports.inventory': {
    label: 'Inventory Reports',
    description: 'Lets this employee view stock level and usage reports.',
    details: [
      'Shows current stock, usage rates, and variance from par',
      'Read-only — cannot modify inventory from this view',
    ],
    tab: 'REPORTING',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
  },
  'reports.tabs': {
    label: 'Tab Reports',
    description: 'Lets this employee view open and closed tab history.',
    details: [
      'Shows tab details including customer names and amounts',
      'Includes pre-auth holds and final settled amounts',
    ],
    tab: 'REPORTING',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'reports.paid_in_out': {
    label: 'Paid In/Out Reports',
    description: 'Lets this employee view the history of cash paid in and out of drawers.',
    details: [
      'Shows all cash movements not tied to a sale (safe drops, petty cash)',
      'HIGH: reveals cash handling patterns and individual entries',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'reports.customers': {
    label: 'Customer Reports',
    description: 'Lets this employee view customer visit frequency and spending analytics.',
    details: [
      'Shows visit counts, lifetime spend, and favorite items',
      'Contains personally identifiable customer information',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'reports.voids': {
    label: 'Void Reports',
    description: 'Lets this employee view the history of voided items, orders, and payments.',
    details: [
      'HIGH: void reports are a primary fraud indicator',
      'Shows who voided what and when — useful for theft investigation',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'reports.gift_cards': {
    label: 'Gift Card Reports',
    description: 'Lets this employee view gift card issuance, redemption, and balance activity.',
    details: [
      'HIGH: gift cards carry real monetary value',
      'Shows all card activity including suspicious transactions',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'tips.view_own': {
    label: 'View Own Tips',
    description: 'Lets this employee see their own tip totals.',
    details: [
      'Shows personal tip earnings and tip-out amounts',
      'Does not show other employees\' tips',
    ],
    tab: 'REPORTING',
    applicableTo: ['FOH'],
    risk: 'LOW',
    recommendedFor: ['Server', 'Bartender'],
  },
  'tips.view_all': {
    label: 'View All Tips',
    description: 'Lets this employee see tip totals for all employees.',
    details: [
      'Shows tip earnings across the entire team',
      'Useful for managers monitoring tip distribution',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'tips.view_ledger': {
    label: 'View Tip Ledger',
    description: 'Lets this employee view the full tip transaction history for any employee.',
    details: [
      'Detailed line-by-line tip transactions',
      'Shows tip-ins, tip-outs, adjustments, and payouts',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'tips.share': {
    label: 'Share Tips',
    description: 'Lets this employee share tips they earned with another employee.',
    details: [
      'HIGH: moves real money between employee tip pools',
      'All tip shares are logged with employee and timestamp',
    ],
    tab: 'REPORTING',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Server', 'Bartender'],
  },
  'tips.collect': {
    label: 'Collect Tips',
    description: 'Lets this employee collect tips that have been shared to them.',
    details: [
      'HIGH: collecting tips changes the financial record',
      'Typically enabled for all tipped staff',
    ],
    tab: 'REPORTING',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Server', 'Bartender', 'Barback'],
  },
  'tips.manage_groups': {
    label: 'Manage Tip Groups',
    description: 'Lets this employee start, stop, and modify tip-sharing groups.',
    details: [
      'HIGH: affects tip distribution for all members of the group',
      'Includes adding and removing members',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Floor Manager'],
  },
  'tips.override_splits': {
    label: 'Override Tip Splits',
    description: 'Lets this employee change table ownership and tip split assignments.',
    details: [
      'HIGH: directly controls which employee earns tips from a table',
      'Use for resolving server switch disputes',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager'],
  },
  'tips.perform_adjustments': {
    label: 'Perform Tip Adjustments',
    description: 'Lets this employee make retroactive tip edits with automatic recalculation.',
    details: [
      'CRITICAL: retroactively changes tip amounts already recorded',
      'Recalculates tip-outs and potentially triggers payroll changes',
      'All adjustments are logged with reason and employee',
      'Give only to payroll administrators',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'inventory.transactions': {
    label: 'View Inventory History',
    description: 'Lets this employee see a log of all inventory changes — what was added, removed, or adjusted and when.',
    details: [
      'Shows who made each inventory change and when',
      'Useful for spotting unexplained stock losses',
      'Read-only — cannot modify records from this view',
      'Pairs with inventory.waste to give a full picture of stock movement',
    ],
    tab: 'REPORTING',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['BOH Manager', 'Floor Manager'],
  },

  // =========================================================================
  // BUSINESS_SETUP — Tables & Reservations
  // =========================================================================
  'tables.view': {
    label: 'View Tables',
    description: 'Lets this employee see the table layout and floor plan.',
    details: [
      'Read-only access to table status and section assignments',
      'Does not allow any changes',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'LOW',
  },
  'tables.edit': {
    label: 'Edit Tables',
    description: 'Lets this employee modify table names, capacities, and section assignments.',
    details: [
      'Changes take effect immediately for all users',
      'Does not include editing the floor plan layout',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'tables.floor_plan': {
    label: 'Floor Plan',
    description: 'Lets this employee edit the visual floor plan layout — table positions, sections, and room config.',
    details: [
      'Full access to drag-and-drop floor plan editor',
      'Changes affect how staff navigate the POS',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'tables.reservations': {
    label: 'Reservations',
    description: 'Lets this employee create, modify, and cancel reservations.',
    details: [
      'Access to the reservation calendar and guest details',
      'Can hold tables for future guests',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Host', 'Manager'],
  },

  // =========================================================================
  // BUSINESS_SETUP — Menu
  // =========================================================================
  'menu.view': {
    label: 'View Menu',
    description: 'Lets this employee view the menu setup.',
    details: [
      'Read-only access to menu categories, items, and modifiers',
      'Does not allow any changes',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'LOW',
  },
  'menu.edit_items': {
    label: 'Edit Menu Items',
    description: 'Lets this employee add and edit menu items.',
    details: [
      'Can create new items, modify names, descriptions, and images',
      'Does not include price changes (requires menu.edit_prices)',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'menu.edit_prices': {
    label: 'Edit Prices',
    description: 'Lets this employee change the price of menu items.',
    details: [
      'CRITICAL: affects all future transactions',
      'Price history is NOT automatically kept',
      'Consider giving only to owners',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'menu.edit_modifiers': {
    label: 'Edit Modifiers',
    description: 'Lets this employee add and edit modifier groups (e.g., add-ons, substitutions).',
    details: [
      'Manage modifier groups like toppings, sides, and cooking temps',
      'Can affect item pricing if modifiers have upcharges',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'menu.86_items': {
    label: '86 Items',
    description: "Lets this employee mark an item as unavailable (86'd) so customers can't order it.",
    details: [
      'Temporarily removes an item from the ordering screen',
      'Does not delete the item — it can be brought back anytime',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Bartender', 'Kitchen Manager'],
  },
  'menu.inventory_qty': {
    label: 'Inventory Quantity',
    description: 'Lets this employee update how many of an item are in stock.',
    details: [
      'Adjust stock counts for tracked menu items',
      'Does not grant full inventory management access',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
  },

  // =========================================================================
  // BUSINESS_SETUP — Inventory
  // =========================================================================
  'inventory.manage': {
    label: 'Manage Inventory',
    description: 'Lets this employee add and edit inventory items, not just count them.',
    details: [
      'Full create/update access to inventory items and recipes',
      'Includes setting par levels, costs, and units of measure',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'HIGH',
  },
  'inventory.vendors': {
    label: 'Manage Vendors',
    description: 'Lets this employee manage vendor contacts and purchase orders.',
    details: [
      'Create and edit vendor information',
      'Create and manage purchase orders',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'HIGH',
  },
  'inventory.view': {
    label: 'View Inventory',
    description: 'Lets this employee see current inventory levels and item details.',
    details: [
      'Read-only access to stock levels and item configuration',
      'Does not allow making any changes',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['BOH Manager', 'Kitchen Manager'],
  },
  'inventory.counts': {
    label: 'Daily Counts',
    description: 'Lets this employee perform daily prep count entries.',
    details: [
      'Submit daily stock counts for tracked prep items',
      'Affects stock levels and prep cost calculations',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Line Cook', 'BOH Manager'],
  },
  'inventory.adjust_prep_stock': {
    label: 'Adjust Prep Stock',
    description: 'Lets this employee make mid-day stock adjustments to prep items.',
    details: [
      'Can increase or decrease stock outside of a normal count',
      'All adjustments are logged with reason and employee',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['BOH Manager', 'Kitchen Manager'],
  },
  'inventory.waste': {
    label: 'Record Waste',
    description: 'Lets this employee log waste and spoilage for inventory items.',
    details: [
      'Records write-offs that reduce stock and affect cost of goods',
      'Waste logs are visible in inventory reports',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Line Cook', 'BOH Manager'],
  },

  // =========================================================================
  // BUSINESS_SETUP — Customers
  // =========================================================================
  'customers.view': {
    label: 'View Customers',
    description: 'Lets this employee see the customer list.',
    details: [
      'Read-only access to customer profiles',
      'Shows visit history and preferences',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
  },
  'customers.edit': {
    label: 'Edit Customers',
    description: 'Lets this employee add and edit customer profiles.',
    details: [
      'Can create new customers and update their information',
      'Includes contact info, preferences, and notes',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'customers.gift_cards': {
    label: 'Gift Cards',
    description: 'Lets this employee issue, reload, and void gift cards.',
    details: [
      'CRITICAL: gift cards have real monetary value',
      'Improper use can result in financial loss',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'customers.house_accounts': {
    label: 'House Accounts',
    description: 'Lets this employee manage house accounts (customers who pay on account).',
    details: [
      'CRITICAL: house accounts extend credit to customers',
      'Includes adding charges and processing payments',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },

  // =========================================================================
  // BUSINESS_SETUP — Tips Management
  // =========================================================================
  'tips.manage_rules': {
    label: 'Manage Tip-Out Rules',
    description: 'Lets this employee set up automatic tip-out rules.',
    details: [
      "CRITICAL: tip-out rules affect every tipped employee's income",
      'Changes apply to all future shifts',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'tips.manage_bank': {
    label: 'Manage Tip Bank',
    description: 'Lets this employee manage the tip bank, including holding and releasing tips.',
    details: [
      'Controls when and how tips are released to employees',
      'Can hold tips pending review',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'tips.manage_settings': {
    label: 'Manage Tip Settings',
    description: 'Lets this employee change how tips are allocated across the business.',
    details: [
      'CRITICAL: affects tip calculation methods for all employees',
      'Includes tip pooling, percentage splits, and chargebacks',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'tips.process_payout': {
    label: 'Process Tip Payouts',
    description: 'Lets this employee process tip payouts to employees.',
    details: [
      'CRITICAL: initiates financial transactions to employees',
      'Includes cash payouts and payroll batch processing',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },

  // =========================================================================
  // BUSINESS_SETUP — All Settings
  // =========================================================================
  'settings.view': {
    label: 'View Settings',
    description: 'Lets this employee view any settings page.',
    details: [
      'Read-only access to all system settings',
      'Does not allow making changes',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.edit': {
    label: 'Edit Settings',
    description: 'Lets this employee change any system settings.',
    details: [
      'Full write access to system configuration',
      'Changes take effect immediately for all users',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.tax': {
    label: 'Tax Settings',
    description: 'Lets this employee configure tax rates and rules. CRITICAL: affects every transaction.',
    details: [
      'Changes tax rates applied to all future orders',
      'Incorrect tax settings can cause compliance issues',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.receipts': {
    label: 'Receipt Settings',
    description: 'Lets this employee configure receipt templates and options.',
    details: [
      'Controls what appears on printed and digital receipts',
      'Includes header, footer, and tip line configuration',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.payments': {
    label: 'Payment Settings',
    description: 'Lets this employee configure payment types, tabs, and checkout policies.',
    details: [
      'Controls which payment methods are accepted',
      'Configures tab policies and pre-auth settings',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.dual_pricing': {
    label: 'Dual Pricing',
    description: 'Lets this employee toggle cash/card dual pricing. CRITICAL: changes prices shown to customers.',
    details: [
      'Enables or disables separate cash and card prices',
      'Affects all menu items when toggled',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.venue': {
    label: 'Venue Settings',
    description: 'Lets this employee edit business name, address, hours, and order types.',
    details: [
      'Core business information visible on receipts and reports',
      'Includes operating hours and order type configuration',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.menu': {
    label: 'Menu Settings',
    description: 'Lets this employee access the full menu builder.',
    details: [
      'Full access to menu configuration and builder tools',
      'Includes categories, items, modifiers, and combos',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.inventory': {
    label: 'Inventory Settings',
    description: 'Lets this employee configure inventory management settings.',
    details: [
      'Controls inventory tracking rules and par levels',
      'Includes vendor and purchase order configuration',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.floor': {
    label: 'Floor Plan Settings',
    description: 'Lets this employee edit the floor plan, tables, and reservation settings.',
    details: [
      'Full access to floor plan editor',
      'Controls table layout, sections, and reservation policies',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.entertainment': {
    label: 'Entertainment Settings',
    description: 'Lets this employee manage entertainment items, live status, waitlists, and PitBoss screens.',
    details: [
      'Controls entertainment item configuration and pricing',
      'Access to live status dashboard and session management',
      'Manage entertainment waitlist settings and PitBoss display screens',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.customers': {
    label: 'Customer Settings',
    description: 'Lets this employee configure customer-facing features like gift cards and loyalty.',
    details: [
      'Controls gift card, loyalty, and house account configuration',
      'Affects customer-facing policies',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.team': {
    label: 'Team Settings',
    description: 'Lets this employee access employee, role, scheduling, and payroll configuration.',
    details: [
      'Controls team management settings',
      'Includes role templates, scheduling rules, and payroll config',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.tips': {
    label: 'Tip Settings',
    description: 'Lets this employee configure the entire tip system.',
    details: [
      'Controls tip pooling, tip-outs, and payout configuration',
      'Changes affect all tipped employees',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.reports': {
    label: 'Report Settings',
    description: 'Lets this employee access all report configuration.',
    details: [
      'Controls which reports are available and their settings',
      'Includes scheduled report configuration',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.hardware': {
    label: 'Hardware Settings',
    description: 'Lets this employee configure printers, KDS screens, terminals, and payment readers.',
    details: [
      'Controls hardware connections and routing',
      'Incorrect settings can disrupt kitchen printing and payments',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.security': {
    label: 'Security Settings',
    description: 'Lets this employee manage PIN policies, blocked cards, and fraud alerts.',
    details: [
      'Controls authentication and security policies',
      'Includes PIN lockout rules and suspicious activity alerts',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.integrations': {
    label: 'Integration Settings',
    description: 'Lets this employee connect third-party services like SMS and email.',
    details: [
      'Controls external service connections',
      'May involve API keys and credentials',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.automation': {
    label: 'Automation Settings',
    description: 'Lets this employee configure automated processes like end-of-day batch jobs.',
    details: [
      'Controls scheduled tasks and automated workflows',
      'Includes EOD batch processing and report scheduling',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'settings.monitoring': {
    label: 'Monitoring',
    description: 'Lets this employee view system health and error logs.',
    details: [
      'Access to system diagnostics and error tracking',
      'Useful for troubleshooting technical issues',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },

  // =========================================================================
  // MEMBERSHIPS — BUSINESS_SETUP
  // =========================================================================
  'admin.manage_membership_plans': {
    label: 'Manage Membership Plans',
    description: 'Create, edit, and delete membership plan templates.',
    details: ['Controls plan pricing, billing cycles, trial periods, and benefits', 'Does not grant ability to enroll customers or process charges'],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager', 'Owner'],
  },
  'admin.manage_memberships': {
    label: 'Manage Memberships',
    description: 'Enroll customers, pause/resume/cancel subscriptions, and replace cards.',
    details: ['Can create new memberships and modify existing ones', 'Can view charge history and audit events', 'Cannot manually retry failed charges (requires separate permission)'],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'admin.retry_membership_charge': {
    label: 'Retry Membership Charge',
    description: 'Manually retry a failed recurring membership charge.',
    details: ['Triggers an immediate charge attempt against the customer card on file', 'Use with caution — retrying too aggressively can cause customer disputes'],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'admin.view_membership_reports': {
    label: 'View Membership Reports',
    description: 'Access membership analytics, MRR, churn, and decline reports.',
    details: ['Read-only access to membership reporting dashboards', 'Includes revenue, aging, and decline analysis'],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Manager', 'Owner'],
  },

  // =========================================================================
  // ADMIN FLAGS — BUSINESS_SETUP
  // =========================================================================
  'admin': {
    label: 'Admin',
    description: 'Grants full access to everything in the system. Same as checking every permission at once.',
    details: [
      'Used for Owner and Admin roles',
      "The system treats 'admin' as equivalent to all permissions enabled",
      'Adding this makes all other checkboxes redundant',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'super_admin': {
    label: 'Super Admin',
    description: 'Same as admin but reserved for the primary business owner account.',
    details: [
      'Highest privilege level in the system',
      'Cannot be removed by other admins',
      'Reserved for the business owner',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
}

// ---------------------------------------------------------------------------
// Inference for unmapped keys
// ---------------------------------------------------------------------------

function titleCase(str: string): string {
  return str
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function inferTab(key: string): PermissionTab {
  const prefix = key.split('.')[0]
  switch (prefix) {
    case 'pos':
    case 'manager':
      return 'SHIFT_SERVICE'
    case 'reports':
      return 'REPORTING'
    case 'settings':
    case 'menu':
    case 'inventory':
    case 'customers':
    case 'events':
    case 'tables':
      return 'BUSINESS_SETUP'
    case 'staff':
    case 'scheduling':
    case 'payroll':
      return 'TEAM_TIME'
    case 'tips':
      return 'SHIFT_SERVICE'
    default:
      return 'BUSINESS_SETUP'
  }
}

export function inferMeta(key: string): PermissionMeta {
  const parts = key.split('.')
  const labelPart = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  const label = titleCase(labelPart)

  return {
    key,
    label,
    description: `Grants access to ${label} functionality.`,
    details: [],
    tab: inferTab(key),
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'LOW',
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getPermissionMeta(key: string): PermissionMeta {
  const explicit = PERMISSION_REGISTRY[key]
  if (explicit) {
    return { key, ...explicit }
  }
  return inferMeta(key)
}

/**
 * Returns visible permission keys for a given roleType + accessLevel combo.
 * Hidden permissions remain in `selectedPermissions` (no data loss) —
 * the UI shows a banner when permissions are hidden.
 */
export function getVisiblePermissionKeys(
  roleType: RoleTypeCategory,
  accessLevel: 'STAFF' | 'MANAGER' | 'OWNER_ADMIN',
  showAdvanced: boolean,
  allKeys: string[]
): string[] {
  return allKeys.filter(key => {
    const meta = getPermissionMeta(key)

    // Advanced toggle overrides all filtering
    if (showAdvanced) return true

    // roleType applicableTo filter — hide permissions not applicable to this role type
    if (!meta.applicableTo.includes(roleType)) return false

    // Risk-based filtering by access level
    if (accessLevel === 'STAFF' && (meta.risk === 'HIGH' || meta.risk === 'CRITICAL')) {
      return false
    }
    if (accessLevel === 'MANAGER' && meta.risk === 'CRITICAL') {
      return false
    }

    return true
  })
}

/**
 * Groups permission keys by tab, returning only keys belonging to the given tab.
 */
export function getKeysByTab(
  tab: PermissionTab,
  visibleKeys: string[]
): string[] {
  return visibleKeys.filter(key => {
    const meta = getPermissionMeta(key)
    return meta.tab === tab
  })
}

/**
 * Dev coverage logger — call once when the roles page loads in development.
 * Logs any permission keys not in the explicit registry (using inferred metadata).
 */
export function logRegistryCoverage(allPermissionKeys: string[]): void {
  if (process.env.NODE_ENV !== 'development') return
  const unmapped = allPermissionKeys.filter(k => !(k in PERMISSION_REGISTRY))
  if (unmapped.length > 0) {
    console.group(`[PermissionRegistry] ${unmapped.length} unmapped keys (using inferred metadata):`)
    unmapped.forEach(k => console.log(' -', k))
    console.groupEnd()
  }
}
