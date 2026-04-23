'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { MOBILE_EVENTS } from '@/types/multi-surface'
import type { CustomerLinkedEvent } from '@/types/multi-surface'

interface CustomerSearchResult {
  id: string
  name: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  loyaltyPoints: number
  tags: string[]
  isBanned: boolean
  totalSpent: number
}

export interface CurrentlyLinkedCustomer {
  id: string
  name: string
  loyaltyPoints?: number
  tags?: string[]
}

interface MobileCustomerLinkModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  locationId: string
  employeeId: string
  /** If the order already has a linked customer, render it pinned at the top with a Remove button. */
  currentCustomer?: CurrentlyLinkedCustomer | null
  /** Optional callback fired when the link/unlink succeeds. Caller can use it to refresh. */
  onLinked?: (event: CustomerLinkedEvent) => void
  /** Terminal identifier (mobile device id) — included in the socket payload for tracing. */
  terminalId?: string
}

const SEARCH_DEBOUNCE_MS = 300

function formatPhoneLast4(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

/**
 * Mobile-friendly customer search + link modal.
 *
 * Search calls the existing /api/customers?search=... endpoint (debounced 300ms).
 * Selection emits MOBILE_EVENTS.LINK_CUSTOMER_REQUEST via the shared socket,
 * and the server-side handler at src/lib/socket-handlers/link-customer.ts forwards
 * to PUT /api/orders/{id}/customer. The modal listens for the matching
 * CUSTOMER_LINKED echo and surfaces success or error inline.
 *
 * UX:
 * - Currently linked customer pinned at top with a "Remove" button (unlink).
 * - Search input debounces 300ms, minimum 2 chars.
 * - Each result has a 48px+ touch target and a "Use this customer" button.
 * - "Cancel" closes without changes.
 */
export default function MobileCustomerLinkModal({
  isOpen,
  onClose,
  orderId,
  locationId,
  employeeId,
  currentCustomer,
  onLinked,
  terminalId,
}: MobileCustomerLinkModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<CustomerSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingCustomerId, setPendingCustomerId] = useState<string | 'unlink' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const searchAbortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when modal opens / closes.
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('')
      setResults([])
      setErrorMessage(null)
      setStatusMessage(null)
      setIsSearching(false)
      setIsSubmitting(false)
      setPendingCustomerId(null)
      searchAbortRef.current?.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isOpen])

  const runSearch = useCallback(
    async (term: string) => {
      if (!locationId) return
      searchAbortRef.current?.abort()
      const ac = new AbortController()
      searchAbortRef.current = ac

      setIsSearching(true)
      setErrorMessage(null)
      try {
        const params = new URLSearchParams({
          locationId,
          search: term,
          limit: '15',
        })
        if (employeeId) params.set('requestingEmployeeId', employeeId)

        const res = await fetch(`/api/customers?${params}`, { signal: ac.signal })
        if (!res.ok) {
          setResults([])
          setErrorMessage('Search failed')
          return
        }
        const raw = await res.json()
        const data = raw.data ?? raw
        const customers: CustomerSearchResult[] = (data.customers ?? []).map((c: any) => ({
          id: c.id,
          name: c.name || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unknown',
          firstName: c.firstName ?? '',
          lastName: c.lastName ?? '',
          phone: c.phone ?? null,
          email: c.email ?? null,
          loyaltyPoints: typeof c.loyaltyPoints === 'number' ? c.loyaltyPoints : 0,
          tags: Array.isArray(c.tags) ? c.tags : [],
          isBanned: c.isBanned === true,
          totalSpent: typeof c.totalSpent === 'number' ? c.totalSpent : 0,
        }))
        setResults(customers)
      } catch (err) {
        const isAbort =
          (err as { name?: string } | null)?.name === 'AbortError'
        if (!isAbort) {
          setResults([])
          setErrorMessage('Search failed')
        }
      } finally {
        if (!ac.signal.aborted) setIsSearching(false)
      }
    },
    [locationId, employeeId],
  )

  // Debounced search: waits 300ms after the last keystroke before firing.
  useEffect(() => {
    if (!isOpen) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (searchTerm.trim().length < 2) {
      setResults([])
      setIsSearching(false)
      return
    }

    debounceRef.current = setTimeout(() => {
      void runSearch(searchTerm.trim())
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm, isOpen, runSearch])

  // Listen for the server's CUSTOMER_LINKED echo for THIS order.
  useEffect(() => {
    if (!isOpen) return
    const socket = getSharedSocket()

    const onLinkedEvent = (data: CustomerLinkedEvent) => {
      if (data.orderId !== orderId) return
      setIsSubmitting(false)
      setPendingCustomerId(null)

      if (data.success) {
        setErrorMessage(null)
        setStatusMessage(
          data.customerId
            ? 'Customer linked'
            : 'Customer removed',
        )
        onLinked?.(data)
        // Close shortly after success so caller can refresh.
        setTimeout(() => {
          setStatusMessage(null)
          onClose()
        }, 600)
      } else {
        setErrorMessage(data.error || 'Link failed')
        setStatusMessage(null)
      }
    }

    socket.on(MOBILE_EVENTS.CUSTOMER_LINKED, onLinkedEvent)
    return () => {
      socket.off(MOBILE_EVENTS.CUSTOMER_LINKED, onLinkedEvent)
      releaseSharedSocket()
    }
  }, [isOpen, orderId, onClose, onLinked])

  const emitLink = useCallback(
    (customerId: string | null) => {
      const socket = getSharedSocket()
      socket.emit(MOBILE_EVENTS.LINK_CUSTOMER_REQUEST, {
        orderId,
        customerId,
        employeeId,
        terminalId,
      })
      releaseSharedSocket()
    },
    [orderId, employeeId, terminalId],
  )

  const handleSelect = (customer: CustomerSearchResult) => {
    if (customer.isBanned) {
      setErrorMessage(`${customer.name} is flagged as banned. Cannot link.`)
      return
    }
    setIsSubmitting(true)
    setPendingCustomerId(customer.id)
    setErrorMessage(null)
    setStatusMessage('Linking customer…')
    emitLink(customer.id)
  }

  const handleUnlink = () => {
    setIsSubmitting(true)
    setPendingCustomerId('unlink')
    setErrorMessage(null)
    setStatusMessage('Removing customer…')
    emitLink(null)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950"
      role="dialog"
      aria-modal="true"
      aria-label="Link customer"
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/10">
        <button
          onClick={onClose}
          className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 text-white/60 hover:bg-white/10"
          aria-label="Cancel"
          disabled={isSubmitting}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-white flex-1">Link Customer</h2>
      </div>

      {/* Currently linked customer (pinned) */}
      {currentCustomer && (
        <div className="p-4 border-b border-white/10 bg-blue-500/10">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-blue-300/70 mb-1">
                Currently linked
              </p>
              <p className="text-white font-semibold truncate">{currentCustomer.name}</p>
              {typeof currentCustomer.loyaltyPoints === 'number' && (
                <p className="text-blue-300 text-sm">
                  {currentCustomer.loyaltyPoints.toLocaleString()} pts
                </p>
              )}
            </div>
            <button
              onClick={handleUnlink}
              disabled={isSubmitting}
              className="min-h-[48px] min-w-[48px] px-4 rounded-xl bg-red-500/20 text-red-300 font-medium hover:bg-red-500/30 disabled:opacity-50"
            >
              {pendingCustomerId === 'unlink' ? '…' : 'Remove'}
            </button>
          </div>
        </div>
      )}

      {/* Search input */}
      <div className="p-4 border-b border-white/10">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by name, phone, or email"
          className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-blue-400"
          autoFocus
          disabled={isSubmitting}
          aria-label="Customer search"
        />
        {searchTerm.trim().length > 0 && searchTerm.trim().length < 2 && (
          <p className="mt-2 text-xs text-white/40">Type at least 2 characters</p>
        )}
      </div>

      {/* Status / error banner */}
      {(errorMessage || statusMessage) && (
        <div
          className={`px-4 py-3 text-sm ${
            errorMessage
              ? 'bg-red-500/20 text-red-300'
              : 'bg-blue-500/20 text-blue-300'
          }`}
          role="status"
        >
          {errorMessage || statusMessage}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isSearching && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isSearching && results.length === 0 && searchTerm.trim().length >= 2 && (
          <div className="p-8 text-center text-white/40 text-sm">
            No customers found
          </div>
        )}

        {!isSearching && results.length === 0 && searchTerm.trim().length < 2 && (
          <div className="p-8 text-center text-white/30 text-sm">
            Search for a customer to link to this tab
          </div>
        )}

        <ul className="divide-y divide-white/5">
          {results.map((customer) => {
            const phoneLast4 = formatPhoneLast4(customer.phone)
            const tierTag = customer.tags.find((t) =>
              ['VIP', 'Platinum', 'Gold', 'Silver', 'Regular'].includes(t),
            )
            const isPending = pendingCustomerId === customer.id
            return (
              <li key={customer.id}>
                <button
                  onClick={() => handleSelect(customer)}
                  disabled={isSubmitting || customer.isBanned}
                  className={`w-full text-left p-4 min-h-[64px] flex items-center justify-between gap-3 hover:bg-white/5 active:bg-white/10 disabled:opacity-50 ${
                    customer.isBanned ? 'cursor-not-allowed' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white truncate">
                        {customer.name}
                      </span>
                      {tierTag && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-300">
                          {tierTag}
                        </span>
                      )}
                      {customer.isBanned && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/30 text-red-300">
                          BANNED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/50">
                      {phoneLast4 && <span>···{phoneLast4}</span>}
                      <span>{customer.loyaltyPoints.toLocaleString()} pts</span>
                    </div>
                  </div>
                  <span
                    className={`min-h-[48px] px-4 flex items-center justify-center rounded-xl font-medium text-sm ${
                      customer.isBanned
                        ? 'bg-white/5 text-white/30'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}
                  >
                    {isPending ? '…' : 'Use'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="w-full min-h-[48px] py-3 rounded-xl bg-white/10 text-white/70 font-medium hover:bg-white/20 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
