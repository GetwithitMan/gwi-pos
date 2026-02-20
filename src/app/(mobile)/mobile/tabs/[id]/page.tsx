'use client'

import { useState, useEffect, use, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MobileTabActions from '@/components/mobile/MobileTabActions'

interface TabDetail {
  id: string
  tabName: string | null
  tabNickname: string | null
  orderNumber: number
  total: number
  subtotal: number
  taxTotal: number
  tipTotal: number
  openedAt: string
  isBottleService: boolean
  bottleServiceDeposit: number | null
  bottleServiceMinSpend: number | null
  items: Array<{
    name: string
    quantity: number
    price: number
    modifiers?: string[]
  }>
  cards: Array<{
    cardType: string
    cardLast4: string
    authAmount: number
    isDefault: boolean
    status: string
  }>
}

export default function MobileTabDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: tabId } = use(params)
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <MobileTabDetailContent tabId={tabId} />
    </Suspense>
  )
}

function MobileTabDetailContent({ tabId }: { tabId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // locationId forwarded for login redirect; employeeId kept as backwards-compat fallback
  const locationId = searchParams.get('locationId') ?? ''

  const [employeeId, setEmployeeId] = useState<string>(
    searchParams.get('employeeId') ?? ''
  )
  const [tab, setTab] = useState<TabDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)

  // Verify session cookie on mount. Redirect to login if not authenticated.
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/mobile/device/auth')
        if (res.ok) {
          const data = await res.json()
          setEmployeeId(data.data.employeeId)
          setAuthChecked(true)
          return
        }
      } catch {
        // network error — fall through to redirect
      }

      const loginUrl = locationId
        ? `/mobile/login?locationId=${locationId}`
        : '/mobile/login'
      router.replace(loginUrl)
    }

    if (!employeeId) {
      checkAuth()
    } else {
      setAuthChecked(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authChecked) return

    fetch(`/api/orders/${tabId}`)
      .then(res => res.json())
      .then(data => {
        setTab({
          id: data.id,
          tabName: data.tabName,
          tabNickname: data.tabNickname,
          orderNumber: data.orderNumber,
          total: Number(data.total),
          subtotal: Number(data.subtotal),
          taxTotal: Number(data.taxTotal),
          tipTotal: Number(data.tipTotal),
          openedAt: data.openedAt,
          isBottleService: data.isBottleService || false,
          bottleServiceDeposit: data.bottleServiceDeposit ? Number(data.bottleServiceDeposit) : null,
          bottleServiceMinSpend: data.bottleServiceMinSpend ? Number(data.bottleServiceMinSpend) : null,
          items: (data.items || []).map((item: { name: string; quantity: number; price: number; modifiers?: Array<{ name: string }> }) => ({
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price),
            modifiers: item.modifiers?.map((m: { name: string }) => m.name),
          })),
          cards: (data.cards || []).map((c: { cardType: string; cardLast4: string; authAmount: number; isDefault: boolean; status: string }) => ({
            cardType: c.cardType,
            cardLast4: c.cardLast4,
            authAmount: Number(c.authAmount),
            isDefault: c.isDefault,
            status: c.status,
          })),
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [authChecked, tabId])

  // Don't render until auth is resolved
  if (!authChecked) {
    return <div className="min-h-screen bg-gray-950" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!tab) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-white/50">Tab not found</p>
        <a href="/mobile/tabs" className="text-blue-400">
          Back to Tabs
        </a>
      </div>
    )
  }

  const displayName = tab.tabNickname || tab.tabName || `Tab #${tab.orderNumber}`
  const timeOpen = new Date(tab.openedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3 mb-1">
          <a href="/mobile/tabs" className="text-white/40 hover:text-white/60">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </a>
          <div className="flex-1">
            <h1 className="text-lg font-bold">{displayName}</h1>
            <p className="text-white/40 text-sm">Opened {timeOpen}</p>
          </div>
          <span className="text-2xl font-bold">${tab.total.toFixed(2)}</span>
        </div>

        {/* Card badges */}
        {tab.cards.length > 0 && (
          <div className="flex gap-2 mt-2 ml-9">
            {tab.cards.map((card, i) => (
              <span
                key={i}
                className={`px-2 py-0.5 rounded text-xs font-medium
                  ${card.isDefault ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/40'}`}
              >
                {card.cardType} ...{card.cardLast4}
              </span>
            ))}
          </div>
        )}

        {/* Bottle service indicator */}
        {tab.isBottleService && (
          <div className="mt-2 ml-9 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400">
            Bottle Service — Deposit: ${tab.bottleServiceDeposit?.toFixed(2)} • Min: ${tab.bottleServiceMinSpend?.toFixed(2)}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {tab.items.map((item, i) => (
          <div key={i} className="flex justify-between py-2 border-b border-white/5">
            <div>
              <span className="text-white">
                {item.quantity > 1 && <span className="text-white/40">{item.quantity}x </span>}
                {item.name}
              </span>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="ml-4">
                  {item.modifiers.map((mod, j) => (
                    <p key={j} className="text-white/30 text-sm">{mod}</p>
                  ))}
                </div>
              )}
            </div>
            <span className="text-white/60 tabular-nums">${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="p-4 border-t border-white/10 space-y-1 text-sm">
        <div className="flex justify-between text-white/40">
          <span>Subtotal</span>
          <span>${tab.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-white/40">
          <span>Tax</span>
          <span>${tab.taxTotal.toFixed(2)}</span>
        </div>
        {tab.tipTotal > 0 && (
          <div className="flex justify-between text-white/40">
            <span>Tip</span>
            <span>${tab.tipTotal.toFixed(2)}</span>
          </div>
        )}
        {tab.cards.length > 0 && (
          <div className="flex justify-between text-white/40">
            <span>Authorized</span>
            <span>${tab.cards.reduce((s, c) => s + c.authAmount, 0).toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <MobileTabActions
        tabId={tab.id}
        employeeId={employeeId}
      />
    </div>
  )
}
