'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/**
 * Format time distance to now in human-readable format
 */
function formatDistanceToNow(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'}`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`
}
import {
  LinkIcon,
  ClockIcon,
  UserIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CurrencyDollarIcon,
  TableCellsIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { formatCurrency } from '@/lib/utils'

interface TableInGroup {
  id: string
  name: string
  abbreviation?: string
  virtualGroupId?: string | null
  virtualGroupPrimary: boolean
  virtualGroupColor?: string | null
  virtualGroupCreatedAt?: string | Date | null
  currentOrder?: {
    id: string
    orderNumber: number
    total: number
    guestCount: number
    createdAt: string
    server?: {
      id: string
      firstName: string
      lastName: string
    }
  } | null
}

interface VirtualGroup {
  id: string
  primaryTableName: string
  primaryTableId: string
  groupColor: string
  createdAt: Date
  members: TableInGroup[]
  totalSpend: number
  totalGuests: number
  serverName: string
  serverId?: string
  highestSpendTable?: { name: string; amount: number }
}

interface ManagerGroupDashboardProps {
  tables: TableInGroup[]
  onTransferGroup?: (groupId: string, newServerId: string) => void
  onDissolveGroup?: (groupId: string) => void
  onViewGroupDetails?: (groupId: string) => void
  riskThreshold?: number // Dollar amount to flag as high-risk
}

/**
 * Manager Group Dashboard - Bird's-eye view of all active virtual groups
 *
 * Features:
 * - Group pacing (time active)
 * - Spend concentration (which table is ordering most)
 * - Risk mitigation (flags high-spend groups without payment)
 * - Server assignment and handover
 */
export function ManagerGroupDashboard({
  tables,
  onTransferGroup,
  onDissolveGroup,
  onViewGroupDetails,
  riskThreshold = 500, // Default $500 threshold
}: ManagerGroupDashboardProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'time' | 'spend' | 'size'>('time')

  // Group the flat tables array into logical virtual groups
  const activeGroups = useMemo(() => {
    const groups: Record<string, VirtualGroup> = {}

    tables.forEach((t) => {
      if (!t.virtualGroupId) return

      const groupId = t.virtualGroupId

      if (!groups[groupId]) {
        groups[groupId] = {
          id: groupId,
          primaryTableName: '',
          primaryTableId: '',
          groupColor: t.virtualGroupColor || '#06b6d4',
          createdAt: new Date(t.virtualGroupCreatedAt || Date.now()),
          members: [],
          totalSpend: 0,
          totalGuests: 0,
          serverName: 'Unassigned',
          serverId: undefined,
        }
      }

      groups[groupId].members.push(t)
      groups[groupId].totalSpend += t.currentOrder?.total || 0
      groups[groupId].totalGuests += t.currentOrder?.guestCount || 0

      if (t.virtualGroupPrimary) {
        groups[groupId].primaryTableName = t.name
        groups[groupId].primaryTableId = t.id
        if (t.currentOrder?.server) {
          groups[groupId].serverName = `${t.currentOrder.server.firstName} ${t.currentOrder.server.lastName}`
          groups[groupId].serverId = t.currentOrder.server.id
        }
      }

      // Track highest spend table
      const tableSpend = t.currentOrder?.total || 0
      if (
        !groups[groupId].highestSpendTable ||
        tableSpend > groups[groupId].highestSpendTable.amount
      ) {
        groups[groupId].highestSpendTable = {
          name: t.name,
          amount: tableSpend,
        }
      }
    })

    // Sort groups
    let sorted = Object.values(groups)
    switch (sortBy) {
      case 'spend':
        sorted.sort((a, b) => b.totalSpend - a.totalSpend)
        break
      case 'size':
        sorted.sort((a, b) => b.members.length - a.members.length)
        break
      case 'time':
      default:
        sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    }

    return sorted
  }, [tables, sortBy])

  const toggleExpanded = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const totalActiveGroups = activeGroups.length
  const totalTablesInGroups = activeGroups.reduce((sum, g) => sum + g.members.length, 0)
  const totalGroupSpend = activeGroups.reduce((sum, g) => sum + g.totalSpend, 0)
  const highRiskGroups = activeGroups.filter((g) => g.totalSpend >= riskThreshold)

  if (activeGroups.length === 0) {
    return (
      <div className="p-6 bg-slate-950 min-h-screen">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <LinkIcon className="w-7 h-7 text-cyan-400" />
            Active Virtual Groups
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time overview of linked party orders
          </p>
        </header>

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
            <LinkIcon className="w-8 h-8 text-slate-600" />
          </div>
          <h2 className="text-lg font-medium text-slate-400 mb-2">
            No Active Virtual Groups
          </h2>
          <p className="text-sm text-slate-500 max-w-md">
            Virtual groups are created when servers long-press a table to link
            multiple tables together for large parties.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 bg-slate-950 min-h-screen">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <LinkIcon className="w-7 h-7 text-cyan-400" />
          Active Virtual Groups
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Real-time overview of linked party orders
        </p>
      </header>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="text-3xl font-bold text-white">{totalActiveGroups}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Active Groups</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="text-3xl font-bold text-white">{totalTablesInGroups}</div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Tables Linked</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className="text-3xl font-bold text-green-400">
            {formatCurrency(totalGroupSpend)}
          </div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Total Group Spend</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800">
          <div className={`text-3xl font-bold ${highRiskGroups.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
            {highRiskGroups.length}
          </div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">
            High Value ({formatCurrency(riskThreshold)}+)
          </div>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-sm text-slate-500">Sort by:</span>
        <div className="flex gap-1">
          {(['time', 'spend', 'size'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setSortBy(option)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                sortBy === option
                  ? 'bg-cyan-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {option === 'time' && 'Oldest First'}
              {option === 'spend' && 'Highest Spend'}
              {option === 'size' && 'Most Tables'}
            </button>
          ))}
        </div>
      </div>

      {/* Group Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.id)
          const isHighRisk = group.totalSpend >= riskThreshold
          const hoursActive = (Date.now() - group.createdAt.getTime()) / (1000 * 60 * 60)

          return (
            <motion.div
              key={group.id}
              layout
              className={`bg-slate-900 rounded-2xl border overflow-hidden shadow-lg ${
                isHighRisk ? 'border-amber-500/50' : 'border-slate-800'
              }`}
            >
              {/* High Risk Banner */}
              {isHighRisk && (
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center gap-2">
                  <ExclamationTriangleIcon className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">
                    High Value Group - Consider Partial Payment
                  </span>
                </div>
              )}

              {/* Group Header */}
              <div className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full animate-pulse"
                      style={{ backgroundColor: group.groupColor }}
                    />
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        Party: {group.primaryTableName}
                      </h2>
                      <p className="text-xs text-cyan-400 font-medium uppercase tracking-widest">
                        {group.members.length} Tables Linked
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-mono font-bold text-green-400">
                      {formatCurrency(group.totalSpend)}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase">Current Total</div>
                  </div>
                </div>

                {/* Group Stats */}
                <div className="space-y-3 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-2">
                      <ClockIcon className="w-4 h-4" />
                      Active For:
                    </span>
                    <span className={`font-medium ${hoursActive > 2 ? 'text-amber-400' : 'text-slate-200'}`}>
                      {formatDistanceToNow(group.createdAt)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-2">
                      <UserIcon className="w-4 h-4" />
                      Lead Server:
                    </span>
                    <span className="text-slate-200">{group.serverName}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 flex items-center gap-2">
                      <UserGroupIcon className="w-4 h-4" />
                      Total Guests:
                    </span>
                    <span className="text-slate-200">{group.totalGuests || '-'}</span>
                  </div>
                  {group.highestSpendTable && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500 flex items-center gap-2">
                        <CurrencyDollarIcon className="w-4 h-4" />
                        Top Spender:
                      </span>
                      <span className="text-slate-200">
                        {group.highestSpendTable.name} ({formatCurrency(group.highestSpendTable.amount)})
                      </span>
                    </div>
                  )}
                </div>

                {/* Table Tags */}
                <div className="pt-4 border-t border-slate-800">
                  <button
                    onClick={() => toggleExpanded(group.id)}
                    className="w-full flex items-center justify-between text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    <span>Member Tables</span>
                    {isExpanded ? (
                      <ChevronUpIcon className="w-4 h-4" />
                    ) : (
                      <ChevronDownIcon className="w-4 h-4" />
                    )}
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-3 space-y-2">
                          {group.members.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center justify-between py-2 px-3 bg-slate-800/50 rounded-lg"
                            >
                              <div className="flex items-center gap-2">
                                <TableCellsIcon className="w-4 h-4 text-slate-500" />
                                <span className="text-slate-200">
                                  {m.abbreviation || m.name}
                                </span>
                                {m.virtualGroupPrimary && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-cyan-500/20 text-cyan-400 rounded">
                                    Primary
                                  </span>
                                )}
                              </div>
                              <span className="text-sm text-green-400 font-medium">
                                {m.currentOrder ? formatCurrency(m.currentOrder.total) : '-'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {!isExpanded && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {group.members.map((m) => (
                        <span
                          key={m.id}
                          className={`px-2 py-1 rounded text-[10px] border ${
                            m.virtualGroupPrimary
                              ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {m.abbreviation || m.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 mt-4 pt-4 border-t border-slate-800">
                  {onViewGroupDetails && (
                    <button
                      onClick={() => onViewGroupDetails(group.id)}
                      className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      View Details
                    </button>
                  )}
                  {onTransferGroup && (
                    <button
                      onClick={() => onTransferGroup(group.id, '')}
                      className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors"
                      title="Transfer to another server"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Transfer
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
