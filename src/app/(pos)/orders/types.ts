/**
 * Shared types for the orders page decomposition.
 * These types define the contracts between the orchestrating page.tsx
 * and its extracted components/hooks.
 */

import type { FloorPlanTable, FloorPlanSection, FloorPlanElement } from '@/components/floor-plan/use-floor-plan'
import type { OrderTypeConfig, OrderCustomFields, WorkflowRules } from '@/types/order-types'
import type { Category, MenuItem, PizzaOrderConfig, SelectedModifier, OrderItem } from '@/types'
import type { OpenOrder } from '@/components/orders/OpenOrdersPanel'
import type { OrderPanelItemData } from '@/components/orders/OrderPanel'
import type { PrepaidPackage } from '@/lib/entertainment-pricing'

export type ViewMode = 'floor-plan' | 'bartender'

export interface FloorPlanSnapshot {
  tables: FloorPlanTable[]
  sections: FloorPlanSection[]
  elements: FloorPlanElement[]
  openOrdersCount: number
}

export interface TabCardInfo {
  cardholderName?: string
  cardLast4: string
  cardType: string
  recordNo?: string
  authAmount?: number
}

export interface SplitChip {
  id: string
  label: string
  isPaid: boolean
  total: number
}

export interface EntertainmentItemInfo {
  id: string
  name: string
  ratePerMinute: number
  prepaidPackages: PrepaidPackage[]
  happyHourEnabled: boolean
  happyHourPrice: number | null
}

export interface ActiveSession {
  id: string
  menuItemId: string
  menuItemName: string
  startedAt: string
  rateType: string
  rateAmount: number
}

export interface QuickBarItem {
  id: string
  name: string
  price: number
  bgColor?: string | null
  textColor?: string | null
}

export interface OrderToLoad {
  id: string
  orderNumber: number
  tableId?: string
  tableName?: string
  tabName?: string
  orderType: string
}

export type {
  OrderTypeConfig,
  OrderCustomFields,
  WorkflowRules,
  Category,
  MenuItem,
  PizzaOrderConfig,
  SelectedModifier,
  OrderItem,
  OpenOrder,
  OrderPanelItemData,
  PrepaidPackage,
}
