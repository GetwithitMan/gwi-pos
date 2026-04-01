'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { SilentErrorBoundary } from '@/lib/error-boundary'
import { OpenOrdersPanel } from '@/components/orders/OpenOrdersPanel'

// ============================================================================
// TYPES
// ============================================================================

interface BartenderTabPanelProps {
  locationId: string
  employeeId: string
  employeePermissions: string[]
  isExpanded: boolean
  onToggleExpand: () => void
  selectedTabId: string | null
  onSelectOrder: (order: { id: string }) => void
  onNewTab: () => void
  onClosedOrderAction: () => void
  refreshTrigger: number
}

// ============================================================================
// COMPONENT
// ============================================================================

export const BartenderTabPanel = memo(function BartenderTabPanel({
  locationId,
  employeeId,
  employeePermissions,
  isExpanded,
  onToggleExpand,
  selectedTabId,
  onSelectOrder,
  onNewTab,
  onClosedOrderAction,
  refreshTrigger,
}: BartenderTabPanelProps) {
  return (
    <motion.div
      key={isExpanded ? 'expanded' : 'collapsed'}
      initial={false}
      animate={{ width: isExpanded ? '100%' : 288 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex-shrink-0 flex flex-col"
    >
      <SilentErrorBoundary name="OpenOrders">
        <OpenOrdersPanel
          locationId={locationId}
          employeeId={employeeId}
          employeePermissions={employeePermissions}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          forceDark={true}
          currentOrderId={selectedTabId || undefined}
          onSelectOrder={onSelectOrder}
          onViewOrder={onSelectOrder}
          onNewTab={onNewTab}
          onClosedOrderAction={onClosedOrderAction}
          refreshTrigger={refreshTrigger}
          lastCallEnabled={true}
        />
      </SilentErrorBoundary>
    </motion.div>
  )
})
