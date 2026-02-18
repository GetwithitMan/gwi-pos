'use client'

import { useState } from 'react'

export function useSplitTickets() {
  const [showSplitTicketManager, setShowSplitTicketManager] = useState(false)
  const [splitManageMode, setSplitManageMode] = useState(false)
  const [editingChildSplit, setEditingChildSplit] = useState(false)
  const [splitParentToReturnTo, setSplitParentToReturnTo] = useState<string | null>(null)
  const [payAllSplitsQueue, setPayAllSplitsQueue] = useState<string[]>([])
  const [showPayAllSplitsConfirm, setShowPayAllSplitsConfirm] = useState(false)
  const [payAllSplitsTotal, setPayAllSplitsTotal] = useState(0)
  const [payAllSplitsCardTotal, setPayAllSplitsCardTotal] = useState(0)
  const [payAllSplitsParentId, setPayAllSplitsParentId] = useState<string | null>(null)
  const [payAllSplitsProcessing, setPayAllSplitsProcessing] = useState(false)
  const [payAllSplitsStep, setPayAllSplitsStep] = useState<'confirm' | 'datacap_card'>('confirm')
  const [orderSplitChips, setOrderSplitChips] = useState<{ id: string; label: string; isPaid: boolean; total: number }[]>([])
  const [splitParentId, setSplitParentId] = useState<string | null>(null)
  const [splitChipsFlashing, setSplitChipsFlashing] = useState(false)

  return {
    showSplitTicketManager,
    setShowSplitTicketManager,
    splitManageMode,
    setSplitManageMode,
    editingChildSplit,
    setEditingChildSplit,
    splitParentToReturnTo,
    setSplitParentToReturnTo,
    payAllSplitsQueue,
    setPayAllSplitsQueue,
    showPayAllSplitsConfirm,
    setShowPayAllSplitsConfirm,
    payAllSplitsTotal,
    setPayAllSplitsTotal,
    payAllSplitsCardTotal,
    setPayAllSplitsCardTotal,
    payAllSplitsParentId,
    setPayAllSplitsParentId,
    payAllSplitsProcessing,
    setPayAllSplitsProcessing,
    payAllSplitsStep,
    setPayAllSplitsStep,
    orderSplitChips,
    setOrderSplitChips,
    splitParentId,
    setSplitParentId,
    splitChipsFlashing,
    setSplitChipsFlashing,
  }
}
