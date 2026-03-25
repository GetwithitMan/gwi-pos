import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('permission-registry')

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
    description: 'Basic POS access — required for all front-of-house employees. Allows viewing the order screen, selecting tables, and navigating the POS interface. Does NOT include payment processing, discounts, or voids (those require separate permissions). Without this permission, the employee cannot log in to the register at all.',
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
    description: 'Allows creating and managing dine-in orders at tables using the floor plan. Without this permission, the employee can only use Quick Order (bar tabs and counter orders) and cannot select a table for an order. Requires pos.access.',
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
    description: 'Allows ringing up bar tabs, takeout, and counter orders without assigning a table. Without this permission, the employee can only create table-based orders using the floor plan. Ideal for bartenders and counter staff. Requires pos.access.',
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
    description: 'Allows viewing the Kitchen Display System (KDS) to see and bump incoming orders. This is the primary permission for cooks and kitchen staff. Does NOT grant access to the POS register, payments, or front-of-house features. Without this permission, the employee cannot see the kitchen screen at all.',
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
    description: 'Allows accepting cash payments from customers and completing cash transactions at the register. Without this permission, the employee cannot close out an order with cash and must hand it off to someone who can. Works alongside the Cash Drawer permission for opening the drawer. Requires pos.access.',
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
    description: 'Allows running credit and debit card transactions through the card reader, including pre-authorizations for bar tabs. Without this permission, the employee cannot swipe, tap, or insert cards and must hand off to a coworker for card payments. Requires pos.access.',
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
    description: 'Allows opening the cash drawer automatically when processing a cash payment. The drawer opens as part of the transaction flow. For opening the drawer without a sale (to make change, etc.), the employee also needs the No Sale permission. Without this permission, the drawer stays locked during the transaction.',
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
    description: 'Allows opening the cash drawer without processing a sale — for example, to make change for a customer or to add starting cash. Every no-sale drawer open is logged in the audit trail with the employee name and timestamp, so you can track who opened the drawer and when. Without this permission, the drawer only opens during an actual cash transaction.',
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
    description: 'Allows splitting a check between multiple guests or payment methods. Supports splitting by seat, by item, or evenly among a group. Also allows split-tender payments (part cash, part card). Without this permission, the employee cannot split a check and must close out the full order with a single payment.',
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
    description: 'Allows moving an order from one table to another — for example, when guests relocate or tables are combined. The order stays assigned to the original server unless also transferred. Without this permission, the employee must ask a manager to move the order.',
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
    description: 'Allows reassigning an order to a different server or bartender — commonly used at shift change or when rotating sections. The receiving employee takes over responsibility and tip credit for the order. Without this permission, the employee cannot hand off their tables to someone else.',
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
    description: "Allows viewing orders belonging to other servers and bartenders (read-only). Useful for managers checking the floor or support staff helping out. Without this permission, the employee can only see their own orders. Does NOT allow editing — that requires the Edit Others' Orders permission.",
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
    description: "Allows adding items to, removing items from, or modifying another employee's open order. All changes are logged with the editing employee's name so you always know who made the change. Without this permission, the employee can only modify their own orders. Requires the View Others' Orders permission.",
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
    description: 'Allows applying percentage or fixed-dollar discounts to orders. Without this permission, the employee must request a manager override via PIN to apply any discount. Every discount is logged with the employee name, amount, and reason in the audit trail. Give only to managers and trusted leads — improper use directly reduces your revenue.',
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
    description: 'Allows voiding (removing) items from orders, even after they have been sent to the kitchen. A void reason may be required depending on your settings. The kitchen is automatically notified when an item is voided. Without this permission, the employee sees the void button but must enter a manager PIN to proceed. All voids are logged for your Void Report.',
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
    description: 'Allows canceling an entire order and all its items at once. Does NOT reverse any payments already taken — use Void Payments to reverse a completed payment. Without this permission, the employee cannot cancel a full order and must void items one by one (if they have Void Items) or ask a manager. All order voids are logged in the audit trail.',
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
    description: 'Allows reversing a completed credit card or cash payment that has already been processed. This puts money back on the customer\'s card or removes it from the drawer. This is the highest-risk financial permission — only give it to managers or owners you trust completely. Without this permission, the employee cannot undo any completed payment. A full audit trail is created for every voided payment.',
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
    description: "Allows issuing refunds to a customer's original payment method (card refund back to their card, or cash back from the drawer). Different from voiding a payment — refunds are used after the transaction has settled (typically the next day or later). Without this permission, the employee cannot process any refunds and must get a manager. All refunds appear in sales reports and the audit trail.",
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
    description: 'Allows modifying items that have already been sent to the kitchen — changing price, modifiers, or special instructions after the ticket has printed. Without this permission, once an item is sent, it is locked and cannot be changed (the employee would need to void it and re-ring it). All edits to sent items are logged in the audit trail.',
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
    description: 'Allows transferring a tab or check from one employee to another — for example, when a server leaves mid-shift and hands their tables to someone else. The receiving employee must have the Receive Transfers permission. Transfer history is logged so you can see who handed off what. Without this permission, the employee cannot give their orders to another person.',
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
    description: 'Allows voiding or closing out multiple checks at once — typically used for end-of-night cleanup when there are forgotten open tabs. Without this permission, the employee must close or void each order individually. Every individual operation within the batch is logged separately in the audit trail. Give only to closing managers.',
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
    description: 'Allows removing sales tax from an order — used for tax-exempt customers like non-profits, government agencies, or resellers with a tax-exempt certificate. Tax-exempt orders are flagged in reports for compliance documentation. Without this permission, the employee cannot remove tax and must get a manager to apply the exemption.',
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
    description: 'Allows ringing up a custom item with a manually typed price instead of selecting from the menu. Used for special requests, catering add-ons, or items not yet on the menu. Open items are tracked separately in reports so you can spot abuse. Without this permission, the employee can only ring up items that are already on the menu with set prices. Give only to trusted staff — this can be used to undercharge.',
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
    description: 'Allows accepting a tab or check that another employee transfers to you. Required for the receiving end of a transfer — the person handing off needs Transfer Checks, and the person picking up needs this permission. Without this permission, tabs cannot be transferred to this employee. Recommended for all servers and bartenders so shift handoffs work smoothly.',
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
    description: 'Allows manually typing in a credit card number instead of swiping, tapping, or inserting the card. Used for phone orders, damaged cards, or when the card reader fails. This carries higher fraud risk than card-present transactions because the card cannot be verified physically. Card data is sent directly to the processor and never stored. All keyed entries are logged with the employee name. Without this permission, the employee can only process card-present transactions.',
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
    description: "Allows closing out the cash drawer even when the counted cash does not match the expected total — overriding the variance. This can mask cash theft or accounting errors, so only give it to owners and your most trusted managers. Without this permission, the employee cannot close a drawer that is over or short. All variance overrides are logged with the employee name and the dollar amount of the discrepancy.",
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
    description: "Allows editing another employee's clock-in or clock-out times — for example, when someone forgot to punch in or punched at the wrong time. Changes directly affect payroll calculations and hours worked. The original time and the new time are both logged so you can see exactly what was changed. Without this permission, the employee cannot correct anyone's time entries.",
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
    description: "Allows ending another employee's break before the scheduled break time is up — for example, when the floor gets busy and you need them back sooner. The actual break duration is still recorded accurately for labor compliance. Without this permission, the employee cannot cut short anyone else's break.",
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
    description: 'Allows clocking out another employee who forgot to punch out — the clock-out time can be set to when they actually left. Used to prevent employees from accumulating hours after leaving. Without this permission, forgotten clock-outs must wait until the employee returns or a manager handles it. The forced clock-out is logged with who did it and the time set.',
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
    description: "Allows running the end-of-day closeout, which finalizes all transactions, generates the daily sales report, and resets totals for the next business day. This cannot be undone once completed. Without this permission, the employee cannot close out the day — only a manager or owner can. Typically given only to the closing manager.",
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
    description: 'Allows viewing a shift summary showing sales totals, voids, discounts, comps, and payment breakdown for the current or previous shift. Useful during shift handoff so the incoming manager knows where things stand. Without this permission, the employee cannot see shift-level performance data.',
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
    description: 'Allows counting the cash drawer at the end of a shift using a blind count — the employee enters what they count without seeing what the system expects. This is more secure than full count because the employee cannot adjust their count to match. Without this permission, the employee cannot count the drawer at all. If you want them to see the expected total, give them Full Count instead.',
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
    description: 'Allows counting the cash drawer while seeing the expected total the system calculated. Less secure than blind count because the employee can see exactly what the system expects and adjust their count to match. Best for managers who need to reconcile. Without this permission, use Blind Count instead for a more secure drawer count.',
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
    description: 'Allows recording cash going into or out of the drawer for non-sale reasons — safe drops, bank change runs, petty cash withdrawals, or adding a starting bank. All movements are tracked separately from sales and appear in cash reports. Without this permission, the employee cannot record any cash movements and must ask a manager. Every paid in/out entry is logged with the employee name, amount, and reason.',
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
    description: 'Allows viewing the employee directory — names, roles, and contact info. Does NOT include wage or payroll information (that requires Edit Wages). Without this permission, the employee list is hidden. This is read-only and does not allow making any changes to employee profiles.',
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
    description: 'Allows creating new employee profiles, editing names, PINs, contact info, and deactivating employees who leave. Does NOT include changing pay rates — that requires the Edit Wages permission separately. Without this permission, the employee can only view staff profiles (if they have View Staff). Requires View Staff.',
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
    description: "Allows changing an employee's hourly rate or salary. Changes directly affect payroll calculations going forward. An audit trail is kept for every wage change showing the old rate, new rate, and who made the change. Without this permission, the employee can edit profiles but cannot see or change pay rates. Give only to owners and payroll administrators.",
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
    description: 'Allows creating new roles and editing which permissions each role has. This is one of the most powerful permissions in the system — anyone with it can grant themselves or others any permission, including admin access. Only give this to the business owner and senior administrators. Without this permission, the employee cannot create or modify roles. All role changes are logged.',
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
    description: 'Allows changing which role is assigned to an employee — for example, promoting a server to a manager role. Combined with Manage Roles, this gives full control over the entire permission system. Without this permission, the employee cannot change anyone\'s role assignment. Give only to the owner and senior managers.',
    details: [
      'CRITICAL: combined with manage_roles, this grants full control over the permission system',
    ],
    tab: 'TEAM_TIME',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'staff.clock_others': {
    label: 'Clock Others',
    description: 'Allows clocking other employees in or out on their behalf — useful for managers handling clock-ins at the start of a busy shift. All buddy-punch events are logged with who did the punching and for whom. Without this permission, each employee must clock in and out using their own PIN.',
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
    description: 'Allows viewing published schedules, shift assignments, and availability requests. This is read-level access to the scheduling system. To create and edit schedules, also grant Manage Schedule. Without this permission, the employee cannot see the schedule page at all.',
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
    description: 'Allows creating, editing, and publishing employee schedules. Can assign shifts, modify availability, and approve shift trades for all employees. Without this permission, the employee can view schedules (if they have the Scheduling permission) but cannot make changes. Requires the Scheduling permission for access to the scheduling page.',
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
    description: 'Allows processing payroll runs and exporting payroll data for all employees. This grants access to every employee\'s wage rates, hours worked, tips, and tax information. Without this permission, payroll data is completely hidden. Only give this to the owner, bookkeeper, or payroll administrator.',
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
    description: 'Allows accessing the reports dashboard. This is the gateway permission — without it, the Reports menu item is completely hidden. However, this alone only shows the reports landing page. Each specific report type (Sales, Labor, Timesheets, etc.) requires its own permission to actually view the data.',
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
    description: 'Allows viewing overall sales reports — total revenue, transaction counts, averages, and payment method breakdowns. Shows business-level numbers, not individual employee performance. Without this permission, the sales reports section is hidden. For per-employee sales breakdowns, also grant Sales by Employee. Requires View Reports.',
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
    description: "Allows viewing per-employee sales breakdowns — how much each server, bartender, or cashier sold during a shift or date range. Can reveal performance differences between staff, so consider whether you want all managers to see this. Without this permission, sales data is only shown at the business level. Requires View Reports and Sales Reports.",
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
    description: 'Allows viewing labor cost reports — total hours worked, labor dollar amounts, and labor as a percentage of sales. May reveal individual wage rates through calculation (e.g., if someone worked 8 hours and the labor cost was $120, the rate is $15/hr). Without this permission, labor data is completely hidden. Requires View Reports.',
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
    description: 'Allows viewing detailed time clock records — individual clock-in/out times, break durations, and total hours for every employee. Contains sensitive attendance and scheduling data. Without this permission, time clock details are hidden and the employee can only see their own punches. Requires View Reports.',
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
    description: 'Allows downloading report data as CSV or Excel files that can be shared, emailed, or imported into accounting software. Exported files may contain sensitive financial data, employee wages, and customer information — once exported, the data leaves the system and cannot be controlled. Without this permission, the employee can view reports on screen but cannot download or export anything.',
    details: [
      'CRITICAL: exported files may contain sensitive financial and employee data',
    ],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'CRITICAL',
  },
  'reports.commission': {
    label: 'Commission Reports',
    description: 'Allows viewing commission earnings reports for all employees who earn commissions on items they sell. Shows per-employee commission totals and the items that earned them. Contains sensitive compensation data. Without this permission, commission reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing the product mix report — how many of each menu item were sold and the revenue each generated. Useful for menu engineering (what to keep, drop, or reprice) and purchasing decisions. Without this permission, product mix data is hidden. Requires View Reports.',
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
    description: 'Allows viewing inventory reports — current stock levels, usage rates, variance from par levels, and cost of goods. This is read-only and does not allow modifying inventory counts or settings. Without this permission, inventory reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing tab reports — open tabs, closed tab history, pre-authorization holds, and final settled amounts. Includes customer names tied to tabs and payment details. Without this permission, tab reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing the history of all cash paid in and out of drawers — safe drops, petty cash, bank runs, and starting banks. Shows who made each entry, the amount, and the reason. Reveals cash handling patterns and individual entries. Without this permission, paid in/out reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing customer analytics — visit frequency, lifetime spend, average check size, and favorite items for individual customers. Contains personally identifiable information (names, phone numbers, email addresses). Without this permission, customer reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing the void report — a complete history of every voided item, voided order, and voided payment. Shows who voided what, when, and the reason given. This is your primary tool for detecting theft and fraud (high void rates for a specific employee are a red flag). Without this permission, void reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing gift card reports — every card issued, redeemed, reloaded, and voided, along with current balances. Gift cards carry real monetary value, so this report helps detect suspicious activity like frequent voids or unusual redemption patterns. Without this permission, gift card reports are hidden. Requires View Reports.',
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
    description: 'Allows viewing their own tip earnings — total tips received, tip-out amounts owed, and net tips for the shift. Does NOT show any other employee\'s tips. Without this permission, the employee cannot see their tip summary at all. Recommended for all tipped positions (servers, bartenders, barbacks).',
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
    description: 'Allows viewing tip totals for every employee across the team — useful for managers monitoring tip distribution and ensuring fairness. Without this permission, the employee can only see their own tips (if they have View Own Tips). Does not allow editing tips. Requires View Reports for the reports section.',
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
    description: 'Allows viewing the detailed, line-by-line tip transaction history for any employee — every tip-in, tip-out, adjustment, and payout. This is the most granular view of tip data in the system. Without this permission, the employee can see tip totals (if they have View All Tips) but not the individual transactions behind them.',
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
    description: 'Allows sharing tips with another employee — for example, a server tipping out a barback or food runner at the end of a shift. This moves real money between employee tip pools. All tip shares are logged with the employee names, amount, and timestamp. Without this permission, the employee cannot manually share tips with coworkers.',
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
    description: 'Allows collecting tips that have been shared or tipped out to this employee by another coworker. Without this permission, shared tips remain pending and cannot be collected. Typically enabled for all tipped staff — servers, bartenders, barbacks, food runners, and bussers.',
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
    description: 'Allows creating, modifying, and ending tip-sharing groups — groups of employees who pool and split tips together. Affects tip distribution for all members of the group. Can add and remove members from active groups. Without this permission, the employee cannot manage tip pools. Typically given to floor managers who coordinate tip sharing.',
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
    description: 'Allows overriding which employee earns tips from a specific table — changing table ownership and tip split percentages after the fact. Used to resolve server switch disputes or correct incorrect assignments. Directly controls who gets paid. Without this permission, tip splits are determined automatically based on who served the table.',
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
    description: 'Allows making retroactive changes to tip amounts that have already been recorded — for example, correcting a tip entered wrong or adjusting after a chargeback. Changes automatically recalculate tip-outs and may trigger payroll adjustments. Every adjustment is logged with the reason and employee who made it. Without this permission, recorded tips cannot be changed. Give only to the owner or payroll administrator.',
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
    description: 'Allows viewing the complete history of inventory changes — every item added, removed, adjusted, or wasted, along with who made the change and when. Read-only and cannot modify records. Useful for spotting unexplained stock losses. Pairs with Record Waste to give a full picture of where inventory went. Without this permission, inventory history is hidden.',
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
    description: 'Allows viewing the table layout and floor plan, including table status (open, occupied, reserved) and section assignments. This is read-only — the employee can see the floor but cannot make changes. Without this permission, the floor plan view is hidden.',
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
    description: 'Allows modifying table properties — names, seating capacities, and section assignments. Changes take effect immediately for all staff on the floor. Does NOT include dragging tables around the floor plan layout (that requires the Floor Plan permission). Without this permission, tables are read-only.',
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
    description: 'Allows editing the visual floor plan layout — dragging tables, creating sections, and configuring rooms. Changes affect how every employee navigates the POS to find tables. Without this permission, the employee can view the floor plan but cannot move or rearrange anything.',
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
    description: 'Allows creating, modifying, and canceling reservations. Includes access to the reservation calendar and guest details. Can hold tables for future guests and manage the waitlist. Without this permission, the employee cannot interact with the reservation system at all. Recommended for hosts and managers.',
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
    description: 'Allows viewing the menu configuration — categories, items, prices, and modifiers — in read-only mode. The employee can see how things are set up but cannot make any changes. Without this permission, the menu management pages are hidden. For making changes, also grant Edit Menu Items, Edit Prices, or Edit Modifiers as needed.',
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
    description: 'Allows creating new menu items and editing names, descriptions, images, categories, and availability. Does NOT include changing prices (that requires Edit Prices separately) or modifying modifier groups (that requires Edit Modifiers). Without this permission, the employee can view the menu but cannot add or change items.',
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
    description: 'Allows changing the price of any menu item. Price changes take effect immediately on all future orders. This directly affects your revenue — an incorrect price change can result in undercharging or overcharging every customer. Without this permission, the employee can edit items but the price field is locked. Consider giving only to owners.',
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
    description: 'Allows creating and editing modifier groups — toppings, sides, cooking temperatures, add-ons, and substitutions. If modifiers have upcharges, changing them can affect item pricing. Without this permission, the employee cannot add or change modifiers on menu items.',
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
    description: "Allows marking a menu item as 86'd (unavailable) so it disappears from the ordering screen and cannot be ordered. Does not delete the item — it can be brought back anytime when restocked. Without this permission, the employee must ask a manager to 86 an item that ran out. Recommended for bartenders and kitchen managers who know when stock runs out.",
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
    description: 'Allows updating stock counts for tracked menu items — for example, entering how many specials are left or adjusting the count after receiving a delivery. Does NOT grant full inventory management access (recipes, vendors, par levels). Without this permission, the employee cannot update any stock quantities.',
    details: [
      'Adjust stock counts for tracked menu items',
      'Does not grant full inventory management access',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['BOH', 'ADMIN'],
    risk: 'MED',
  },
  'menu.templates.create': {
    label: 'Create Modifier Templates',
    description: 'Allows creating reusable modifier group templates — pre-built sets of modifiers (like "Standard Toppings" or "Cooking Temps") that can be quickly applied when building new menu items. Without this permission, the employee must build modifier groups from scratch each time.',
    details: [
      'Create templates from scratch or from existing modifier groups',
      'Templates can be applied when building new modifier groups',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'LOW',
  },
  'menu.templates.edit': {
    label: 'Edit Modifier Templates',
    description: 'Allows editing existing modifier group templates — changing names, settings, and the list of modifiers in the template. Changes to templates do NOT affect modifier groups already created from that template. Without this permission, existing templates cannot be modified.',
    details: [
      'Modify template name, settings, and modifier list',
      'Changes do not affect groups already created from the template',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'LOW',
  },
  'menu.templates.delete': {
    label: 'Delete Modifier Templates',
    description: 'Allows deleting modifier group templates so they no longer appear in the template list. Deleted templates do NOT affect modifier groups already created from them. Without this permission, the employee can edit templates but cannot remove them.',
    details: [
      'Soft-deletes the template so it no longer appears in the list',
      'Does not affect groups already created from the template',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
  },
  'menu.templates.apply': {
    label: 'Apply Modifier Templates',
    description: 'Allows using a saved template to quickly populate a new modifier group with pre-defined modifiers when setting up a menu item. Saves time versus building groups from scratch. Also requires Edit Modifiers to actually create the group on the item. Without this permission, the "Apply Template" option is hidden.',
    details: [
      'Use templates to quickly populate a new modifier group with pre-defined modifiers',
      'Requires menu.edit_modifiers to actually create the group on an item',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'LOW',
  },

  // =========================================================================
  // BUSINESS_SETUP — Inventory
  // =========================================================================
  'inventory.manage': {
    label: 'Manage Inventory',
    description: 'Allows full create and edit access to inventory items and recipes — setting up new items, configuring par levels, costs, and units of measure. This is full inventory management, not just counting. Without this permission, the employee can view inventory (if they have View Inventory) or do counts (if they have Daily Counts) but cannot add or configure items.',
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
    description: 'Allows creating and editing vendor contacts and managing purchase orders — placing orders with suppliers, receiving deliveries, and tracking costs. Without this permission, the employee cannot interact with vendors or create purchase orders. Typically given to kitchen managers and the owner.',
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
    description: 'Allows viewing current stock levels, item configurations, par levels, and costs in read-only mode. The employee can see everything about inventory but cannot make any changes. Without this permission, inventory pages are hidden entirely. For making changes, also grant Manage Inventory.',
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
    description: 'Allows submitting daily stock counts for tracked prep items — counting how much of each prep item is on hand at the start or end of the day. Affects stock levels and prep cost calculations. Without this permission, the employee cannot enter counts. Recommended for line cooks and kitchen managers who do morning prep checks.',
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
    description: 'Allows making mid-day stock adjustments to prep items outside of a regular daily count — for example, when extra prep is done or stock is moved between stations. All adjustments are logged with the employee name and reason. Without this permission, the employee can only adjust stock during a formal daily count.',
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
    description: 'Allows recording waste and spoilage — logging when inventory items are thrown away, dropped, or spoiled. Write-offs reduce stock counts and affect cost of goods calculations. Waste logs are visible in inventory reports. Without this permission, the employee cannot log waste and unexplained stock losses go untracked.',
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
    description: 'Allows viewing the customer directory — names, contact info, visit history, and preferences. This is read-only and does not allow creating or editing customer profiles. Without this permission, the customer list is hidden entirely.',
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
    description: 'Allows creating new customer profiles and editing existing ones — updating names, phone numbers, email, preferences, and notes. Without this permission, the employee can view customers (if they have View Customers) but cannot make changes. Requires View Customers.',
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
    description: 'Allows issuing new gift cards, reloading existing ones with additional value, and voiding gift cards. Gift cards carry real monetary value — issuing a $100 gift card is like handing someone $100 in cash. Improper use can result in direct financial loss. Without this permission, the employee cannot interact with gift cards at all. Only give to the owner and trusted managers.',
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
    description: 'Allows managing house accounts — customers who are allowed to charge to an account and pay later (like running a tab without a card). Includes opening accounts, adding charges, and processing payments. This extends credit to customers on your behalf. Without this permission, the employee cannot use or manage house accounts. Only give to the owner and trusted managers.',
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
    description: 'Allows setting up automatic tip-out rules that control how tips are shared — for example, servers tipping out 3% to the bar and 2% to bussers. These rules affect every tipped employee\'s income on every shift going forward. Without this permission, the employee cannot change how tips are automatically distributed. Only give to the owner.',
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
    description: 'Allows managing the tip bank — holding tips pending review and releasing them to employees for payout. Controls when and how tips flow from the system to the employee. Can delay tip releases if there is a dispute or issue to investigate. Without this permission, the employee cannot hold or release tips. Only give to the owner and payroll administrator.',
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
    description: 'Allows changing tip system settings — tip pooling percentages, tip calculation methods, split rules, and chargeback policies. Changes affect tip calculations for every tipped employee on every future shift. Without this permission, tip settings are read-only. Only give to the owner — incorrect settings can cause labor law compliance issues.',
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
    description: 'Allows processing tip payouts — releasing earned tips to employees as cash or adding them to the payroll batch. This initiates actual financial transactions. Without this permission, tips accumulate in the system but cannot be paid out. Only give to the owner and payroll administrator.',
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
    description: 'Allows viewing all system settings pages in read-only mode — the employee can see how things are configured but cannot change anything. Without this permission, the Settings menu is hidden entirely. To make changes, the employee also needs Edit Settings or the specific settings permission for that area.',
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
    description: 'Allows changing any system setting across the entire business. Changes take effect immediately for all employees and devices. This is a very broad permission — consider using the specific settings permissions (Tax, Payments, Hardware, etc.) instead for finer control. Without this permission, settings are read-only. Requires View Settings.',
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
    description: 'Allows configuring tax rates and tax rules for the business. Changes affect the tax charged on every future order. Incorrect tax settings can cause compliance issues with your state or local tax authority. Without this permission, tax settings are locked. Only give to the owner or accountant.',
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
    description: 'Allows configuring what appears on printed and digital receipts — header text, footer messages, logo, tip line options, and itemization format. Changes affect every receipt printed going forward. Without this permission, receipt settings are locked.',
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
    description: 'Allows configuring which payment methods are accepted (cash, card, gift card, house account), tab policies (pre-auth amounts, auto-close rules), and checkout behavior. Changes affect how every employee processes payments. Without this permission, payment settings are locked. Only give to the owner.',
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
    description: 'Allows enabling or disabling cash/card dual pricing — showing separate (lower) cash prices and (higher) card prices to customers. When toggled, this changes the prices displayed on every menu item across the POS and customer-facing display. Without this permission, dual pricing settings are locked. Only give to the owner.',
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
    description: 'Allows editing core business information — venue name, address, phone number, operating hours, and which order types are available (dine-in, takeout, delivery). This information appears on receipts, reports, and customer-facing displays. Without this permission, venue settings are locked.',
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
    description: 'Allows full access to the menu builder — creating and organizing categories, items, modifiers, combos, and all menu configuration. This is the broadest menu permission and includes everything. Without this permission, the menu builder is hidden. For more granular control, use the individual menu permissions (Edit Items, Edit Prices, Edit Modifiers) instead.',
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
    description: 'Allows configuring inventory management settings — tracking rules, par levels, low-stock alerts, and vendor/purchase order configuration. Changes affect how inventory is tracked and when alerts are triggered for all items. Without this permission, inventory settings are locked.',
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
    description: 'Allows editing the floor plan layout, table configuration, section assignments, and reservation policies. Changes affect how every employee navigates the POS and how reservations are handled. Without this permission, floor plan settings are locked.',
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
    description: 'Allows managing entertainment items (bowling lanes, pool tables, axe throwing, etc.), configuring pricing and time blocks, viewing live session status, managing the entertainment waitlist, and controlling PitBoss display screens. Without this permission, entertainment settings are locked.',
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
    description: 'Allows configuring customer-facing features — gift card policies, loyalty program settings, house account rules, and customer data management. Changes affect how customers interact with your business. Without this permission, customer settings are locked.',
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
    description: 'Allows accessing team management settings — employee roles, role templates, scheduling rules, break policies, and payroll configuration. Changes affect how employees are managed across the business. Without this permission, team settings are locked.',
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
    description: 'Allows configuring the entire tip system — tip pooling rules, tip-out percentages, payout schedules, and calculation methods. Changes affect how tips are distributed for every tipped employee on every shift. Without this permission, tip system settings are locked. Only give to the owner.',
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
    description: 'Allows configuring report settings — which reports are available, scheduled report delivery, and report formatting options. Without this permission, report settings are locked. Does not control who can view reports (that is handled by the individual report permissions).',
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
    description: 'Allows configuring hardware devices — receipt printers, kitchen printers, KDS screens, card readers, and print routing rules. Incorrect settings can disrupt kitchen ticket printing and block payments. Without this permission, hardware settings are locked. Only give to the owner or whoever manages your equipment setup.',
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
    description: 'Allows managing security settings — PIN lockout policies, blocked card lists, fraud alert thresholds, and authentication rules. Incorrect changes can lock employees out or weaken security. Without this permission, security settings are locked. Only give to the owner.',
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
    description: 'Allows connecting and configuring third-party integrations — 7shifts, MarginEdge, Oracle PMS, SMS providers, email services, and other external systems. May involve entering credentials and keys. Without this permission, integration settings are locked. Only give to the owner or IT administrator.',
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
    description: 'Allows configuring automated processes — end-of-day batch processing schedules, automatic report delivery, and other scheduled tasks. Changes affect what runs automatically without human intervention. Without this permission, automation settings are locked.',
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
    description: 'Allows viewing system health dashboards, connection status, error logs, and device diagnostics. Useful for troubleshooting when things are not working — printers offline, terminals disconnected, sync issues. Without this permission, the monitoring page is hidden.',
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
    description: 'Allows creating, editing, and deleting membership plan templates — setting up plan pricing, billing cycles, trial periods, and benefits. Does NOT allow enrolling customers or processing charges (that requires Manage Memberships). Without this permission, the employee cannot set up or change membership plans.',
    details: ['Controls plan pricing, billing cycles, trial periods, and benefits', 'Does not grant ability to enroll customers or process charges'],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager', 'Owner'],
  },
  'admin.manage_memberships': {
    label: 'Manage Memberships',
    description: 'Allows enrolling customers in membership plans, pausing or resuming subscriptions, canceling memberships, and replacing cards on file. Can view charge history and audit events. Cannot manually retry failed charges (that requires a separate permission). Without this permission, the employee cannot manage any customer memberships.',
    details: ['Can create new memberships and modify existing ones', 'Can view charge history and audit events', 'Cannot manually retry failed charges (requires separate permission)'],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'admin.retry_membership_charge': {
    label: 'Retry Membership Charge',
    description: 'Allows manually retrying a failed recurring membership charge — triggering an immediate charge attempt against the customer\'s card on file. Use with caution: retrying too aggressively can cause customer disputes and chargebacks. Without this permission, failed charges wait for the next automatic retry cycle.',
    details: ['Triggers an immediate charge attempt against the customer card on file', 'Use with caution — retrying too aggressively can cause customer disputes'],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'admin.view_membership_reports': {
    label: 'View Membership Reports',
    description: 'Allows viewing membership analytics dashboards — monthly recurring revenue (MRR), churn rate, decline reports, and membership aging. This is read-only and does not allow managing memberships or processing charges. Without this permission, membership reports are hidden.',
    details: ['Read-only access to membership reporting dashboards', 'Includes revenue, aging, and decline analysis'],
    tab: 'REPORTING',
    applicableTo: ['ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Manager', 'Owner'],
  },

  // =========================================================================
  // DELIVERY — SHIFT_SERVICE + BUSINESS_SETUP
  // =========================================================================
  'delivery.view': {
    label: 'View Deliveries',
    description: 'Allows viewing the delivery management screen — the delivery queue, active runs, driver assignments, and order status. This is read-only and does not allow dispatching, reassigning, or modifying deliveries. Without this permission, the delivery screen is hidden.',
    details: [
      'Read-only access to the delivery management screen',
      'Can see driver assignments, order status, and ETAs',
      'Cannot dispatch, reassign, or modify deliveries',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Server', 'Manager'],
  },
  'delivery.create': {
    label: 'Create Delivery Orders',
    description: 'Allows creating new delivery orders from the POS — entering the customer address, phone number, and delivery details. The order enters the delivery queue for dispatch. Does NOT allow assigning drivers or dispatching (that requires Dispatch Deliveries). Without this permission, the employee cannot take delivery orders.',
    details: [
      'Can enter customer address, phone, and delivery details',
      'Creates the order in the delivery queue for dispatch',
      'Does not grant ability to assign drivers or dispatch',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Server', 'Cashier', 'Manager'],
  },
  'delivery.manage': {
    label: 'Manage Deliveries',
    description: 'Allows editing delivery orders after they are created — updating addresses, estimated delivery times, special instructions, reassigning between drivers, and marking orders as delivered or returned. Without this permission, the employee can view deliveries but cannot modify them.',
    details: [
      'Can modify delivery addresses, ETAs, and special instructions',
      'Can reassign orders between drivers',
      'Can mark orders as delivered or returned',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager'],
  },
  'delivery.dispatch': {
    label: 'Dispatch Deliveries',
    description: 'Allows assigning drivers to delivery orders and sending them out. Can build multi-order delivery runs and override dispatch policy warnings (like zone mismatches). Without this permission, the employee cannot assign a driver to an order — deliveries sit in the queue until someone with this permission dispatches them.',
    details: [
      'Can assign orders to available drivers',
      'Can build multi-order runs when enabled',
      'Can override dispatch policy warnings (e.g. zone mismatch)',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager'],
  },
  'delivery.settings': {
    label: 'Delivery Settings',
    description: 'Allows configuring all delivery system settings — delivery fees, free delivery thresholds, delivery radius, dispatch assignment strategy, driver pay rates, and SMS notification settings. Changes affect how all deliveries are priced and handled. Without this permission, delivery settings are locked.',
    details: [
      'Controls delivery fees, free delivery thresholds, and zone configuration',
      'Can modify dispatch assignment strategy and driver pay settings',
      'Can enable/disable SMS notifications and customer tracking',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Owner', 'Manager'],
  },
  'delivery.zones.manage': {
    label: 'Manage Delivery Zones',
    description: 'Allows creating, editing, and deleting delivery zones — drawing zone boundaries on the map, setting per-zone delivery fees and minimum order amounts, and enabling or disabling zones. Without this permission, the employee cannot change which areas you deliver to or how much you charge per zone.',
    details: [
      'Can draw zone boundaries on the map',
      'Can set per-zone delivery fees and minimum order amounts',
      'Can enable or disable zones without deleting them',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager', 'Owner'],
  },
  'delivery.drivers.manage': {
    label: 'Manage Drivers',
    description: 'Allows managing delivery driver profiles — adding and removing drivers, setting pay rates, entering vehicle information, managing driver cash banks, and handling reconciliation. Without this permission, the employee cannot add, remove, or configure drivers.',
    details: [
      'Can add and remove drivers from the delivery roster',
      'Can set driver pay rates and vehicle information',
      'Can manage driver cash banks and reconciliation',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager', 'Owner'],
  },
  'delivery.reports': {
    label: 'Delivery Reports',
    description: 'Allows viewing delivery-specific reports — driver efficiency, delivery times, mileage, tips, zone performance, and delivery revenue. This is read-only and does not allow managing deliveries. Without this permission, delivery reports are hidden.',
    details: [
      'Access to delivery-specific analytics and KPIs',
      'Includes driver mileage, tip, and pay reports',
      'Can view zone performance and customer satisfaction metrics',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Manager', 'Owner'],
  },
  'delivery.audit': {
    label: 'Delivery Audit',
    description: 'Allows viewing the delivery audit trail — cash handling records, proof-of-delivery photos and signatures, cash drop history, and shortage reports. This is read-only and used for investigating delivery issues after the fact. Without this permission, the audit trail is hidden.',
    details: [
      'Read-only access to delivery audit logs',
      'Can review proof-of-delivery photos and signatures',
      'Can view cash drop history and shortage reports',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Manager', 'Owner'],
  },
  'delivery.exceptions': {
    label: 'Delivery Exceptions',
    description: 'Allows handling delivery problems — flagging late orders, processing refused deliveries, resolving customer complaints, approving refunds or credits for delivery failures, and suspending problem customers from future deliveries. Without this permission, the employee cannot resolve delivery issues and must escalate to a manager.',
    details: [
      'Can flag and resolve delivery issues',
      'Can approve refunds or credits for delivery failures',
      'Can suspend customers from future deliveries',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager'],
  },
  'delivery.policy_override': {
    label: 'Delivery Policy Override',
    description: 'Allows overriding delivery dispatch policies — dispatching to addresses outside valid zones, bypassing cash-on-delivery limits, overriding prepayment requirements, and waiving proof-of-delivery for specific orders. All overrides are logged in the audit trail. Without this permission, the employee must follow all dispatch policies strictly. Give only to managers.',
    details: [
      'Can dispatch outside valid zones when blockDispatchWithoutValidZone is enabled',
      'Can override cash-on-delivery limits and prepayment requirements',
      'Can bypass proof-of-delivery requirements for specific orders',
      'All overrides are logged in the audit trail',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'delivery.self_assign': {
    label: 'Self-Assign Deliveries',
    description: 'Allows drivers to claim ready-for-pickup orders themselves from the driver tablet screen, instead of waiting for a manager to assign them. The driver selects orders and creates their own delivery run. All dispatch policy rules still apply (max orders per run, zone validation, suspended customer checks). Only works when self-assign is enabled in delivery settings. Without this permission, drivers must wait for a manager to dispatch orders to them.',
    details: [
      'Driver can view READY orders on the /driver tablet screen',
      'Can select one or more orders and create a delivery run',
      'Still respects all dispatch policy gates (max per run, zone validation, suspended check)',
      'Requires driverSelfAssignEnabled to be ON in delivery settings',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH'],
    risk: 'LOW',
    recommendedFor: ['Driver'],
  },

  // =========================================================================
  // CAKE ORDERING — SHIFT_SERVICE + BUSINESS_SETUP
  // =========================================================================
  'cake.view': {
    label: 'View Cake Orders',
    description: 'Allows viewing the custom cake orders list — order details, quotes, deposit status, and production notes. Required for any cake module access; other cake permissions depend on this one. Without this permission, the entire cake ordering section is hidden.',
    details: [
      'Can see the cake orders list and individual order details',
      'Can view quote amounts, deposit status, and production notes',
      'Required for any cake module access — other cake permissions depend on this',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'BOH', 'ADMIN'],
    risk: 'LOW',
  },
  'cake.create': {
    label: 'Create Cake Orders',
    description: 'Allows creating new custom cake orders using the cake builder wizard — selecting sizes, flavors, decorations, and attaching customer info and pickup/delivery preferences. Created orders start in quote or draft status. Without this permission, the employee cannot start a new cake order. Requires View Cake Orders.',
    details: [
      'Can start a new cake order using the cake builder wizard',
      'Can attach customer information and delivery/pickup preferences',
      'Created orders start in QUOTE or DRAFT status depending on workflow',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
  },
  'cake.edit': {
    label: 'Edit Cake Order Details',
    description: 'Allows modifying existing cake orders — changing flavors, decorations, sizes, custom instructions, and pickup or delivery dates. Cannot change pricing or approve quotes (those require separate permissions). Without this permission, the employee can view cake orders but cannot edit them.',
    details: [
      'Can change cake options, sizes, flavors, and custom instructions',
      'Can update pickup/delivery dates and customer contact info',
      'Cannot change pricing or approve quotes — those require separate permissions',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'cake.quote': {
    label: 'Create & Manage Quotes',
    description: 'Allows generating price quotes for custom cake orders and sending them to customers via SMS or email. Can re-quote if order details change before approval. Does NOT allow approving quotes (that requires Approve Quotes). Without this permission, the employee cannot provide pricing to customers.',
    details: [
      'Can calculate and generate quotes based on cake configuration',
      'Can send quotes to customers via SMS or email',
      'Can re-quote if order details change before approval',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'MED',
  },
  'cake.quote_approve': {
    label: 'Approve Quotes',
    description: 'Allows approving or rejecting pending cake order quotes. Approval locks in the quoted price and triggers a deposit request if required by your settings. This commits your business to a price — restrict to managers or the owner. Without this permission, quotes remain pending until someone with approval authority reviews them.',
    details: [
      'Can approve or reject pending quotes',
      'Approval locks the quoted price and triggers deposit request if required',
      'Typically restricted to managers or owners to control pricing commitments',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'cake.payment': {
    label: 'Process Cake Payments',
    description: 'Allows collecting deposits and final payments on cake orders — processing card, cash, or text-to-pay transactions. All payments flow through the standard card processor. Without this permission, the employee cannot take payment on cake orders and must hand off to someone who can.',
    details: [
      'Can process deposit payments (card, cash, text-to-pay)',
      'Can collect remaining balance at pickup or delivery',
      'All payments flow through the standard Datacap pipeline',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'HIGH',
  },
  'cake.payment_external': {
    label: 'Record External Payments',
    description: 'Allows recording cake order payments received outside the POS — checks, wire transfers, Venmo, Zelle, or other third-party payment methods. External payments are logged in the audit trail with the method and reference number. Large amounts may require additional manager approval based on your threshold settings. Without this permission, only POS-processed payments can be recorded.',
    details: [
      'Can mark deposits or balances as paid via external method',
      'External payments are logged in the audit trail with method and reference',
      'Gated by externalPaymentManagerThreshold setting for large amounts',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'cake.cancel': {
    label: 'Cancel Cake Orders',
    description: 'Allows canceling cake orders at any stage. Deposit forfeiture is calculated automatically based on your cancellation policy settings (how many days before the event and what percentage is forfeited). Cancellations are permanent and logged in the audit trail. Without this permission, the employee cannot cancel cake orders.',
    details: [
      'Can cancel orders at any stage of the workflow',
      'Deposit forfeiture is calculated based on forfeitDaysBefore and depositForfeitPercent settings',
      'Cancellations are permanent and logged in the audit trail',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },
  'cake.settings': {
    label: 'Configure Cake Module',
    description: 'Allows configuring the cake ordering module — enabling/disabling the module, setting deposit percentages, rush fees, delivery fees, capacity limits, lead time requirements, cancellation policies, and quote expiration rules. Changes affect all future cake orders. Without this permission, cake module settings are locked.',
    details: [
      'Can enable/disable the cake module and public ordering',
      'Can configure deposit percentages, rush fees, delivery fees, and capacity limits',
      'Can edit cancellation policies and quote expiration rules',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
  },

  // =========================================================================
  // NOTIFICATIONS — BUSINESS_SETUP + SHIFT_SERVICE
  // =========================================================================
  'notifications.manage_providers': {
    label: 'Manage Notification Providers',
    description: 'Allows adding, editing, and removing notification providers (JTECH, SMS, LRS, etc.) and viewing raw provider responses. This controls which paging and messaging systems are connected to your venue. Incorrect configuration can disable all paging. Without this permission, the employee cannot change provider settings. Only give to owners and IT administrators.',
    details: [
      'Add, edit, or remove notification providers (JTECH, SMS, LRS, etc.)',
      'View raw provider responses and test connections',
      'Incorrect changes can disable all guest paging',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'notifications.manage_rules': {
    label: 'Manage Notification Rules',
    description: 'Allows editing routing rules that control which events trigger which notifications through which providers. Includes setting conditions, retry policies, fallback providers, and message templates. Incorrect rules can cause missed notifications or excessive paging. Without this permission, notification routing is locked.',
    details: [
      'Edit routing rules, conditions, and retry policies',
      'Configure fallback providers and message templates',
      'Incorrect rules can cause missed notifications or excessive paging',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'HIGH',
    recommendedFor: ['Manager', 'Owner'],
  },
  'notifications.manage_devices': {
    label: 'Manage Notification Devices',
    description: 'Allows adding, editing, and removing pager devices from the notification device inventory. Includes changing device status (retire, disable, mark as found), updating labels, and managing device metadata. Without this permission, the employee cannot modify the device inventory.',
    details: [
      'Add and remove pager devices from inventory',
      'Change device status (retire, disable, mark as found)',
      'Update device labels and metadata',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager', 'Owner'],
  },
  'notifications.view_log': {
    label: 'View Notification Log',
    description: 'Allows viewing the notification log — delivery attempts, provider responses, routing rule evaluations, and device assignment history. This is read-only and does not allow modifying any notification settings. Without this permission, the notification log is hidden.',
    details: [
      'Read-only access to notification delivery log',
      'View routing rule evaluations and provider responses',
      'View device assignment history',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Manager', 'Owner'],
  },
  'notifications.replay_dlq': {
    label: 'Replay Dead-Letter Notifications',
    description: 'Allows retrying failed notification jobs from the dead-letter queue. Dead-letter jobs are notifications that exhausted all retry attempts and failed permanently. Replaying them re-enqueues the notification for another delivery attempt. Without this permission, dead-letter jobs remain stuck until an admin replays them.',
    details: [
      'Retry failed notification jobs from the dead-letter queue',
      'Re-enqueues the notification for another delivery attempt',
      'All replays are logged in the audit trail',
    ],
    tab: 'BUSINESS_SETUP',
    applicableTo: ['ADMIN'],
    risk: 'MED',
    recommendedFor: ['Manager', 'Owner'],
  },
  'notifications.manual_page': {
    label: 'Manual Page',
    description: 'Allows using the "Page Now" button to manually trigger a notification for an order or waitlist entry. Each manual page creates a unique, auditable event. Without this permission, the employee cannot manually page a customer — notifications only fire automatically from KDS bumps and system events.',
    details: [
      'Trigger a notification for an order or waitlist entry on demand',
      'Each manual page creates a unique, auditable event',
      'Bypasses workflow dedup (always sends)',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Server', 'Bartender', 'Manager'],
  },
  'pos.assign_device': {
    label: 'Assign Notification Device',
    description: 'Allows using the "Assign Next" button on the order panel to auto-assign or manually assign a pager device to an order or waitlist entry. Without this permission, the employee cannot assign pagers to customers.',
    details: [
      'Auto-assign or manually assign a pager to an order or waitlist entry',
      'Uses FOR UPDATE SKIP LOCKED to prevent double-assign',
    ],
    tab: 'SHIFT_SERVICE',
    applicableTo: ['FOH', 'ADMIN'],
    risk: 'LOW',
    recommendedFor: ['Server', 'Bartender', 'Host', 'Manager'],
  },

  // =========================================================================
  // ADMIN FLAGS — BUSINESS_SETUP
  // =========================================================================
  'admin': {
    label: 'Admin',
    description: 'Grants full, unrestricted access to every feature in the system — equivalent to checking every single permission box at once. The employee can do anything: void payments, change prices, edit wages, modify settings, export data, and more. Adding this makes all other permission checkboxes redundant. Only give to owners and trusted general managers.',
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
    description: 'The highest privilege level in the system — same as Admin but reserved for the primary business owner. Cannot be removed by other admins, ensuring the owner always retains full control. Only one account should have this permission.',
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
    unmapped.forEach(k => log.info(' -', k))
    console.groupEnd()
  }
}
