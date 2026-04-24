'use client'

import { useState, useEffect, use, Suspense, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import MobileTabActions from '@/components/mobile/MobileTabActions'
import MobileCustomerLinkModal from '@/components/mobile/MobileCustomerLinkModal'
import type { CurrentlyLinkedCustomer } from '@/components/mobile/MobileCustomerLinkModal'

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
  customer: CurrentlyLinkedCustomer | null
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
  // locationId forwarded for login redirect
  const locationId = searchParams.get('locationId') ?? ''

  const [employeeId, setEmployeeId] = useState<string>('')
  const [tab, setTab] = useState<TabDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  // Increment to trigger a re-fetch of order detail after a successful link/unlink.
  const [refreshKey, setRefreshKey] = useState(0)

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

    checkAuth()
  }, [])  

  useEffect(() => {
    if (!authChecked) return

    // Parallel fetch: order detail + linked customer.
    // The /api/orders/{id} response carries customerId only — the customer
    // details (name, loyalty points) live behind /api/orders/{id}/customer
    // which is the canonical source per `feedback_ha_canonical_entity`
    // (display from current authoritative state, not a stale cache).
    const orderUrl = `/api/orders/${tabId}`
    const customerUrl = employeeId
      ? `/api/orders/${tabId}/customer?requestingEmployeeId=${encodeURIComponent(employeeId)}`
      : `/api/orders/${tabId}/customer`

    Promise.all([
      fetch(orderUrl).then(res => (res.ok ? res.json() : null)).catch(() => null),
      fetch(customerUrl).then(res => (res.ok ? res.json() : null)).catch(() => null),
    ])
      .then(([orderData, customerRaw]) => {
        if (!orderData) {
          setLoading(false)
          return
        }
        const data = orderData

        // /api/orders/{id}/customer wraps the customer payload in { data: { ... } }
        const customerPayload = customerRaw?.data?.customer ?? customerRaw?.customer ?? null
        const linkedCustomer: CurrentlyLinkedCustomer | null = customerPayload
          ? {
              id: customerPayload.id,
              name:
                customerPayload.name ||
                [customerPayload.firstName, customerPayload.lastName].filter(Boolean).join(' ').trim() ||
                'Customer',
              loyaltyPoints:
                typeof customerPayload.loyaltyPoints === 'number'
                  ? customerPayload.loyaltyPoints
                  : undefined,
              tags: Array.isArray(customerPayload.tags) ? customerPayload.tags : [],
            }
          : null

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
          customer: linkedCustomer,
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
  }, [authChecked, tabId, employeeId, refreshKey])

  const handleLinked = useCallback(() => {
    // Re-read the order on the next tick so we pick up the updated customer + totals
    // (auto-discount removal on unlink can change subtotal/total too).
    setRefreshKey(k => k + 1)
  }, [])

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
        <Link href="/mobile/tabs" className="text-blue-400">
          Back to Tabs
        </Link>
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
          <Link href="/mobile/tabs" className="text-white/40 hover:text-white/60">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
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

        {/* Customer link pill / button */}
        <div className="mt-3 ml-9">
          {tab.customer ? (
            <button
              onClick={() => setLinkModalOpen(true)}
              className="inline-flex items-center gap-2 min-h-[40px] px-3 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-300 text-sm font-medium hover:bg-blue-500/25 active:scale-[0.98]"
              aria-label="Edit linked customer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="truncate max-w-[160px]">{tab.customer.name}</span>
              {typeof tab.customer.loyaltyPoints === 'number' && (
                <span className="text-blue-200/80 text-xs">
                  · {tab.customer.loyaltyPoints.toLocaleString()} pts
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={() => setLinkModalOpen(true)}
              className="inline-flex items-center gap-2 min-h-[40px] px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm font-medium hover:bg-white/10 active:scale-[0.98]"
              aria-label="Link customer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Link Customer
            </button>
          )}
        </div>
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

      {/* Customer link modal — pinned overlay */}
      {linkModalOpen && (
        <MobileCustomerLinkModal
          isOpen={linkModalOpen}
          onClose={() => setLinkModalOpen(false)}
          orderId={tab.id}
          locationId={locationId}
          employeeId={employeeId}
          currentCustomer={tab.customer}
          onLinked={handleLinked}
        />
      )}
    </div>
  )
}
