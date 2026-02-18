/**
 * Order Type Configuration Types
 *
 * This module defines types for the configurable order types system.
 * Order types can be admin-configured with custom fields, workflow rules,
 * and display options for KDS and kitchen tickets.
 *
 * Key Types:
 * - OrderTypeConfig: Full order type configuration
 * - FieldDefinition: Custom field configuration
 * - WorkflowRules: Pre-send validation rules
 * - KDSConfig: Kitchen display settings
 * - OrderCustomFields: Values collected for an order
 *
 * @see /src/app/api/order-types - API endpoints
 * @see /src/components/orders/OrderTypeSelector.tsx - POS component
 * @see /src/app/(admin)/settings/order-types/page.tsx - Admin page
 */

// Field definition for custom fields
export interface FieldDefinition {
  label: string
  type: 'text' | 'phone' | 'email' | 'time' | 'date' | 'select' | 'textarea'
  placeholder?: string
  required?: boolean
  options?: { value: string; label: string }[] // For select type
  validation?: {
    pattern?: string
    minLength?: number
    maxLength?: number
    message?: string
  }
}

// Workflow rules for order type
export interface WorkflowRules {
  requirePaymentBeforeSend?: boolean
  requireTableSelection?: boolean
  requireCustomerName?: boolean
  requirePhone?: boolean
  requireCardOnFile?: boolean
  enablePreAuth?: boolean
  allowSplitCheck?: boolean
  autoCloseOnPayment?: boolean
  printTicketOnSend?: boolean
  showOnKDS?: boolean
}

// KDS display configuration
export interface KDSConfig {
  badgeText?: string // Template: "{customerName}" or "{tabName}"
  badgeColor?: string // Hex color for badge
  showPickupTime?: boolean
  showVehicleInfo?: boolean
  showPhone?: boolean
  showAddress?: boolean
  priority?: 'normal' | 'high' | 'rush'
  headerTemplate?: string // e.g., "{customerName} - {phone}"
}

// Print configuration for kitchen tickets
export interface PrintConfig {
  headerTemplate?: string
  showCustomFields?: string[] // Field names to print
  footerTemplate?: string
  fontSize?: 'normal' | 'large'
  includePrices?: boolean
}

// Full order type configuration
export interface OrderTypeConfig {
  id: string
  locationId: string
  name: string
  slug: string
  description?: string
  color?: string
  icon?: string
  sortOrder: number
  isActive: boolean
  isSystem: boolean
  requiredFields: Record<string, boolean>
  optionalFields: Record<string, boolean>
  fieldDefinitions: Record<string, FieldDefinition>
  workflowRules: WorkflowRules
  kdsConfig: KDSConfig
  printConfig: PrintConfig
}

// Custom fields stored on an order
export interface OrderCustomFields {
  customerName?: string
  phone?: string
  email?: string
  address?: string
  pickupTime?: string
  vehicleType?: string
  vehicleColor?: string
  notes?: string
  [key: string]: string | undefined
}

// System order type slugs (built-in types)
export type SystemOrderTypeSlug = 'dine_in' | 'bar_tab' | 'takeout' | 'delivery'

// Default system order types
export const SYSTEM_ORDER_TYPES: Partial<OrderTypeConfig>[] = [
  {
    name: 'Dine In',
    slug: 'dine_in',
    icon: 'table',
    color: '#3B82F6', // Blue
    isSystem: true,
    sortOrder: 0,
    requiredFields: { tableId: true },
    optionalFields: {},
    fieldDefinitions: {},
    workflowRules: {
      requireTableSelection: true,
      allowSplitCheck: true,
      showOnKDS: true,
    },
    kdsConfig: {
      badgeText: 'Table {tableNumber}',
      badgeColor: '#3B82F6',
    },
    printConfig: {
      headerTemplate: 'TABLE {tableNumber}',
    },
  },
  {
    name: 'Bar Tab',
    slug: 'bar_tab',
    icon: 'wine',
    color: '#8B5CF6', // Purple
    isSystem: true,
    sortOrder: 1,
    requiredFields: { tabName: true },
    optionalFields: {},
    fieldDefinitions: {
      tabName: {
        label: 'Tab Name',
        type: 'text',
        placeholder: 'Customer name or card name',
        required: true,
      },
    },
    workflowRules: {
      requireCustomerName: true,
      allowSplitCheck: true,
      showOnKDS: true,
    },
    kdsConfig: {
      badgeText: '{tabName}',
      badgeColor: '#8B5CF6',
    },
    printConfig: {
      headerTemplate: 'TAB: {tabName}',
    },
  },
  {
    name: 'Takeout',
    slug: 'takeout',
    icon: 'bag',
    color: '#10B981', // Emerald
    isSystem: true,
    sortOrder: 2,
    requiredFields: {},
    optionalFields: { customerName: true, phone: true },
    fieldDefinitions: {
      customerName: {
        label: 'Name',
        type: 'text',
        placeholder: 'Customer name',
      },
      phone: {
        label: 'Phone',
        type: 'phone',
        placeholder: '555-123-4567',
      },
    },
    workflowRules: {
      requirePaymentBeforeSend: true,
      allowSplitCheck: false,
      showOnKDS: true,
    },
    kdsConfig: {
      badgeText: 'TAKEOUT',
      badgeColor: '#10B981',
      showPhone: true,
    },
    printConfig: {
      headerTemplate: '*** TAKEOUT ***',
      showCustomFields: ['customerName', 'phone'],
    },
  },
  {
    name: 'Delivery',
    slug: 'delivery',
    icon: 'truck',
    color: '#F59E0B', // Amber
    isSystem: true,
    sortOrder: 3,
    requiredFields: { customerName: true, phone: true, address: true },
    optionalFields: {},
    fieldDefinitions: {
      customerName: {
        label: 'Name',
        type: 'text',
        placeholder: 'Customer name',
        required: true,
      },
      phone: {
        label: 'Phone',
        type: 'phone',
        placeholder: '555-123-4567',
        required: true,
      },
      address: {
        label: 'Delivery Address',
        type: 'textarea',
        placeholder: '123 Main St, City, State ZIP',
        required: true,
      },
    },
    workflowRules: {
      requirePaymentBeforeSend: true,
      allowSplitCheck: false,
      showOnKDS: true,
    },
    kdsConfig: {
      badgeText: 'DELIVERY',
      badgeColor: '#F59E0B',
      showPhone: true,
      showAddress: true,
    },
    printConfig: {
      headerTemplate: '*** DELIVERY ***',
      showCustomFields: ['customerName', 'phone', 'address'],
    },
  },
]

// Example custom order types (for reference, these would be user-created)
export const EXAMPLE_CUSTOM_ORDER_TYPES: Partial<OrderTypeConfig>[] = [
  {
    name: 'Call-in',
    slug: 'call_in',
    icon: 'phone',
    color: '#EC4899', // Pink
    isSystem: false,
    sortOrder: 4,
    requiredFields: { customerName: true, phone: true, pickupTime: true },
    optionalFields: { address: true },
    fieldDefinitions: {
      customerName: {
        label: 'Name',
        type: 'text',
        placeholder: 'Customer name',
        required: true,
      },
      phone: {
        label: 'Phone',
        type: 'phone',
        placeholder: '555-123-4567',
        required: true,
      },
      pickupTime: {
        label: 'Pickup Time',
        type: 'time',
        placeholder: 'Select time',
        required: true,
      },
      address: {
        label: 'Address (optional)',
        type: 'textarea',
        placeholder: 'For delivery notes',
      },
    },
    workflowRules: {
      allowSplitCheck: false,
      showOnKDS: true,
      printTicketOnSend: true,
    },
    kdsConfig: {
      badgeText: 'CALL-IN',
      badgeColor: '#EC4899',
      showPickupTime: true,
      showPhone: true,
      headerTemplate: '{customerName} - Pickup: {pickupTime}',
    },
    printConfig: {
      headerTemplate: '*** CALL-IN ORDER ***\nPickup: {pickupTime}',
      showCustomFields: ['customerName', 'phone', 'pickupTime'],
    },
  },
  {
    name: 'Drive-through',
    slug: 'drive_through',
    icon: 'car',
    color: '#06B6D4', // Cyan
    isSystem: false,
    sortOrder: 5,
    requiredFields: { customerName: true },
    optionalFields: { vehicleType: true, vehicleColor: true },
    fieldDefinitions: {
      customerName: {
        label: 'Name',
        type: 'text',
        placeholder: 'Customer name',
        required: true,
      },
      vehicleType: {
        label: 'Vehicle Type',
        type: 'select',
        options: [
          { value: 'car', label: 'Car' },
          { value: 'truck', label: 'Truck' },
          { value: 'suv', label: 'SUV' },
          { value: 'van', label: 'Van' },
          { value: 'motorcycle', label: 'Motorcycle' },
        ],
      },
      vehicleColor: {
        label: 'Vehicle Color',
        type: 'select',
        options: [
          { value: 'black', label: 'Black' },
          { value: 'white', label: 'White' },
          { value: 'silver', label: 'Silver' },
          { value: 'gray', label: 'Gray' },
          { value: 'red', label: 'Red' },
          { value: 'blue', label: 'Blue' },
          { value: 'green', label: 'Green' },
          { value: 'other', label: 'Other' },
        ],
      },
    },
    workflowRules: {
      // Payment optional - can be collected at window or via handheld
      allowSplitCheck: false,
      showOnKDS: true,
      printTicketOnSend: true,
    },
    kdsConfig: {
      badgeText: 'DRIVE-THRU',
      badgeColor: '#06B6D4',
      showVehicleInfo: true,
      headerTemplate: '{customerName} - {vehicleColor} {vehicleType}',
    },
    printConfig: {
      headerTemplate: '*** DRIVE-THROUGH ***',
      showCustomFields: ['customerName', 'vehicleType', 'vehicleColor'],
    },
  },
]
