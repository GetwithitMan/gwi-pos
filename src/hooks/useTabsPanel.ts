'use client'

import { useState } from 'react'

export function useTabsPanel() {
  const [showTabsPanel, setShowTabsPanel] = useState(false)
  const [isTabManagerExpanded, setIsTabManagerExpanded] = useState(false)
  const [showTipAdjustment, setShowTipAdjustment] = useState(false)
  const [tabsRefreshTrigger, setTabsRefreshTrigger] = useState(0)

  return {
    showTabsPanel,
    setShowTabsPanel,
    isTabManagerExpanded,
    setIsTabManagerExpanded,
    showTipAdjustment,
    setShowTipAdjustment,
    tabsRefreshTrigger,
    setTabsRefreshTrigger,
  }
}
