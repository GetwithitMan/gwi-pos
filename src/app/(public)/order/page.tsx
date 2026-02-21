'use client'

/**
 * Online Ordering Page — Phase 5
 *
 * Customer-facing 3-step ordering flow:
 *   Step 1: Browse menu (grouped by category)
 *   Step 2: Review cart + enter customer info
 *   Step 3: Datacap iFrame card entry + submit
 *
 * Query params:
 *   ?locationId=xxx  — required, identifies the venue
 *
 * Environment variables:
 *   NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY — Datacap hosted token public key
 *   NEXT_PUBLIC_DATACAP_ENV             — "cert" (default) | "production"
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

// ─── Datacap Hosted Token Global ─────────────────────────────────────────────
// Loaded from CDN script tag below. Declared here to satisfy TypeScript.
declare const DatacapHostedWebToken: {
  init: (tokenKey: string, iframeId: string, callback: (resp: DatacapTokenResponse) => void) => void
  requestToken: () => void
  removeMessageEventListener: () => void
}

interface DatacapTokenResponse {
  Token?: string
  Brand?: string
  Last4?: string
  Error?: string
}

// ─── Menu Data Types ──────────────────────────────────────────────────────────

interface ModifierOption {
  id: string
  name: string
  price: number
}

interface ModifierGroup {
  id: string
  name: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking: boolean
  options: ModifierOption[]
}

interface MenuItem {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  modifierGroups: ModifierGroup[]
}

interface MenuCategory {
  id: string
  name: string
  categoryType: string
  items: MenuItem[]
}

// ─── Cart Types ───────────────────────────────────────────────────────────────

interface CartModifier {
  modifierId: string
  name: string
  price: number
}

interface CartItem {
  id: string          // unique cart entry id
  menuItemId: string
  name: string
  basePrice: number
  quantity: number
  modifiers: CartModifier[]
}

// ─── Step Type ────────────────────────────────────────────────────────────────

type Step = 'menu' | 'cart' | 'payment'

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatPrice(cents: number): string {
  return `$${cents.toFixed(2)}`
}

function cartItemTotal(item: CartItem): number {
  const modsTotal = item.modifiers.reduce((s, m) => s + m.price, 0)
  return (item.basePrice + modsTotal) * item.quantity
}

function cartTotal(items: CartItem[]): number {
  return items.reduce((s, i) => s + cartItemTotal(i), 0)
}

// ─── Item Modal (add item to cart) ────────────────────────────────────────────

interface ItemModalProps {
  item: MenuItem
  onClose: () => void
  onAdd: (cartItem: CartItem) => void
}

function ItemModal({ item, onClose, onAdd }: ItemModalProps) {
  const [quantity, setQuantity] = useState(1)
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, CartModifier[]>>({})
  const [error, setError] = useState<string | null>(null)

  function toggleModifier(group: ModifierGroup, option: ModifierOption) {
    setSelectedModifiers(prev => {
      const current = prev[group.id] ?? []
      const exists = current.find(m => m.modifierId === option.id)

      if (exists) {
        // Remove it
        return { ...prev, [group.id]: current.filter(m => m.modifierId !== option.id) }
      }

      // Add it — check max
      if (!group.allowStacking && current.length >= group.maxSelections) {
        if (group.maxSelections === 1) {
          // Replace
          return {
            ...prev,
            [group.id]: [{ modifierId: option.id, name: option.name, price: option.price }],
          }
        }
        return prev // at max, ignore
      }

      return {
        ...prev,
        [group.id]: [...current, { modifierId: option.id, name: option.name, price: option.price }],
      }
    })
  }

  function handleAdd() {
    // Validate required groups
    for (const group of item.modifierGroups) {
      const selected = selectedModifiers[group.id] ?? []
      if (group.isRequired && selected.length < group.minSelections) {
        setError(`Please select ${group.minSelections > 1 ? `at least ${group.minSelections} options` : 'an option'} for "${group.name}"`)
        return
      }
    }
    setError(null)

    const allModifiers = Object.values(selectedModifiers).flat()
    onAdd({
      id: `${item.id}-${Date.now()}`,
      menuItemId: item.id,
      name: item.name,
      basePrice: item.price,
      quantity,
      modifiers: allModifiers,
    })
    onClose()
  }

  const modsTotal = Object.values(selectedModifiers).flat().reduce((s, m) => s + m.price, 0)
  const lineTotal = (item.price + modsTotal) * quantity

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        {item.imageUrl && (
          <img src={item.imageUrl} alt={item.name} className="w-full h-48 object-cover" />
        )}
        <div className="p-5">
          <div className="flex justify-between items-start mb-1">
            <h2 className="text-xl font-bold text-white">{item.name}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none ml-4">
              &times;
            </button>
          </div>
          {item.description && (
            <p className="text-gray-400 text-sm mb-3">{item.description}</p>
          )}
          <p className="text-green-400 font-semibold mb-4">{formatPrice(item.price)}</p>

          {/* Modifier Groups */}
          <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
            {item.modifierGroups.map(group => {
              const selected = selectedModifiers[group.id] ?? []
              return (
                <div key={group.id}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-white font-medium text-sm">{group.name}</span>
                    {group.isRequired && (
                      <span className="text-xs bg-amber-600 text-white px-1.5 py-0.5 rounded">Required</span>
                    )}
                    {group.maxSelections > 1 && (
                      <span className="text-xs text-gray-400">Pick up to {group.maxSelections}</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {group.options.map(option => {
                      const isSelected = selected.some(m => m.modifierId === option.id)
                      return (
                        <button
                          key={option.id}
                          onClick={() => toggleModifier(group, option)}
                          className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          }`}
                        >
                          <span>{option.name}</span>
                          {option.price > 0 && (
                            <span>+{formatPrice(option.price)}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}

          {/* Quantity + Add */}
          <div className="flex items-center gap-3 mt-4">
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center text-lg"
              >
                -
              </button>
              <span className="text-white font-medium w-6 text-center">{quantity}</span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center text-lg"
              >
                +
              </button>
            </div>
            <button
              onClick={handleAdd}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Add to Cart — {formatPrice(lineTotal)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function OnlineOrderPage() {
  const searchParams = useSearchParams()
  const locationId = searchParams.get('locationId') ?? ''

  // Menu
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [menuLoading, setMenuLoading] = useState(true)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)

  // Cart
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)

  // Step flow
  const [step, setStep] = useState<Step>('menu')

  // Customer info
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [specialNotes, setSpecialNotes] = useState('')
  const [infoErrors, setInfoErrors] = useState<Record<string, string>>({})

  // Payment
  const [datacapReady, setDatacapReady] = useState(false)
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [orderSuccess, setOrderSuccess] = useState<{ orderNumber: number; total: number } | null>(null)
  const datacapInitialized = useRef(false)

  // ── Load menu ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!locationId) {
      setMenuError('No location specified. Please use a valid ordering link.')
      setMenuLoading(false)
      return
    }

    fetch(`/api/online/menu?locationId=${encodeURIComponent(locationId)}`)
      .then(res => res.json())
      .then(json => {
        if (json.error) throw new Error(json.error)
        const cats: MenuCategory[] = json.data?.categories ?? []
        setCategories(cats)
        if (cats.length > 0) setActiveCategoryId(cats[0].id)
      })
      .catch(err => {
        setMenuError(err.message || 'Failed to load menu')
      })
      .finally(() => setMenuLoading(false))
  }, [locationId])

  // ── Load Datacap script when entering payment step ──────────────────────────

  useEffect(() => {
    if (step !== 'payment') return
    if (datacapInitialized.current) return

    const env = process.env.NEXT_PUBLIC_DATACAP_ENV ?? 'cert'
    const scriptSrc =
      env === 'production'
        ? 'https://token.dcap.com/v1/client/hosted'
        : 'https://token-cert.dcap.com/v1/client/hosted'

    const existing = document.querySelector(`script[src="${scriptSrc}"]`)
    if (existing) {
      initDatacap()
      return
    }

    const script = document.createElement('script')
    script.src = scriptSrc
    script.async = true
    script.onload = () => initDatacap()
    script.onerror = () => setPaymentError('Failed to load payment form. Please refresh.')
    document.body.appendChild(script)

    return () => {
      // Cleanup listener on unmount
      try {
        DatacapHostedWebToken.removeMessageEventListener()
      } catch {
        // library may not be loaded yet
      }
    }
  }, [step])

  function initDatacap() {
    const tokenKey = process.env.NEXT_PUBLIC_DATACAP_PAYAPI_TOKEN_KEY ?? ''
    if (!tokenKey) {
      setPaymentError('Payment system not configured. Please contact the venue.')
      return
    }
    try {
      DatacapHostedWebToken.init(tokenKey, 'datacap-token-iframe', handleDatacapToken)
      datacapInitialized.current = true
      setDatacapReady(true)
    } catch (err) {
      console.error('Datacap init error:', err)
      setPaymentError('Failed to initialize payment form. Please refresh.')
    }
  }

  // ── Handle Datacap token callback ───────────────────────────────────────────

  const handleDatacapToken = useCallback(async (resp: DatacapTokenResponse) => {
    if (resp.Error) {
      setPaymentError(`Card error: ${resp.Error}`)
      setPaymentLoading(false)
      return
    }
    if (!resp.Token) {
      setPaymentError('No payment token received. Please try again.')
      setPaymentLoading(false)
      return
    }

    // Submit order to our checkout API
    try {
      const payload = {
        locationId,
        token: resp.Token,
        cardBrand: resp.Brand,
        cardLast4: resp.Last4,
        items: cartItems.map(ci => ({
          menuItemId: ci.menuItemId,
          quantity: ci.quantity,
          modifiers: ci.modifiers.map(m => ({
            modifierId: m.modifierId,
            name: m.name,
            price: m.price,
          })),
        })),
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        orderType: 'takeout',
        notes: specialNotes || undefined,
      }

      const res = await fetch('/api/online/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (!res.ok) {
        setPaymentError(json.error || 'Payment failed. Please try a different card.')
        setPaymentLoading(false)
        return
      }

      setOrderSuccess({
        orderNumber: json.data.orderNumber,
        total: json.data.total,
      })
    } catch {
      setPaymentError('Network error. Please check your connection and try again.')
      setPaymentLoading(false)
    }
  }, [locationId, cartItems, customerName, customerEmail, customerPhone, specialNotes])

  // ── Cart operations ─────────────────────────────────────────────────────────

  function addToCart(item: CartItem) {
    setCartItems(prev => [...prev, item])
  }

  function removeFromCart(id: string) {
    setCartItems(prev => prev.filter(i => i.id !== id))
  }

  function updateQty(id: string, delta: number) {
    setCartItems(prev =>
      prev
        .map(i => i.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
        .filter(i => i.quantity > 0)
    )
  }

  // ── Validate cart → info step ───────────────────────────────────────────────

  function proceedToPayment() {
    const errs: Record<string, string> = {}
    if (!customerName.trim()) errs.name = 'Name is required'
    if (!customerEmail.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) errs.email = 'Enter a valid email'
    setInfoErrors(errs)
    if (Object.keys(errs).length === 0) {
      setStep('payment')
    }
  }

  // ── Trigger Datacap tokenization ────────────────────────────────────────────

  function handlePlaceOrder() {
    if (!datacapReady) return
    setPaymentLoading(true)
    setPaymentError(null)
    try {
      DatacapHostedWebToken.requestToken()
    } catch {
      setPaymentError('Payment form error. Please refresh and try again.')
      setPaymentLoading(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const total = cartTotal(cartItems)
  const itemCount = cartItems.reduce((s, i) => s + i.quantity, 0)

  // ── Success Screen ──────────────────────────────────────────────────────────

  if (orderSuccess) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-gray-900 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">✓</div>
          <h1 className="text-2xl font-bold text-white mb-2">Order Received!</h1>
          <p className="text-gray-400 mb-6">
            Your order #{orderSuccess.orderNumber} has been placed successfully.
          </p>
          <div className="bg-gray-800 rounded-xl p-4 mb-6">
            <div className="flex justify-between text-white">
              <span>Order Total</span>
              <span className="font-semibold">{formatPrice(orderSuccess.total)}</span>
            </div>
          </div>
          <div className="bg-blue-900/40 border border-blue-700 rounded-xl p-4">
            <p className="text-blue-300 text-sm">
              Estimated ready in approximately <strong>20 minutes</strong>.
              A confirmation will be sent to {customerEmail}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Loading / Error ─────────────────────────────────────────────────────────

  if (menuLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-lg">Loading menu…</div>
      </div>
    )
  }

  if (menuError) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="bg-red-900/40 border border-red-700 rounded-xl p-6 max-w-sm text-center">
          <p className="text-red-300">{menuError}</p>
        </div>
      </div>
    )
  }

  // ── Step 1: Menu Browser ────────────────────────────────────────────────────

  if (step === 'menu') {
    const activeCategory = categories.find(c => c.id === activeCategoryId) ?? categories[0]

    return (
      <div className="min-h-screen bg-gray-950 text-white">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 px-4 py-4">
          <h1 className="text-xl font-bold">Online Order</h1>
          <p className="text-gray-400 text-sm">Browse our menu and add items to your cart</p>
        </div>

        {/* Category Tabs */}
        <div className="sticky top-[73px] z-10 bg-gray-950 border-b border-gray-800 px-4 overflow-x-auto">
          <div className="flex gap-1 py-2 min-w-max">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  cat.id === activeCategoryId
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Items Grid */}
        <div className="px-4 py-4 pb-28">
          <h2 className="text-lg font-semibold mb-3 text-gray-200">
            {activeCategory?.name}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(activeCategory?.items ?? []).map(item => {
              const outOfStock = item.stockStatus === 'out_of_stock'
              return (
                <button
                  key={item.id}
                  onClick={() => !outOfStock && setSelectedItem(item)}
                  disabled={outOfStock}
                  className={`bg-gray-900 rounded-xl p-4 text-left flex gap-3 transition-colors ${
                    outOfStock
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-gray-800 cursor-pointer'
                  }`}
                >
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <h3 className="font-semibold text-white text-sm leading-tight">{item.name}</h3>
                      {item.stockStatus === 'low_stock' && (
                        <span className="text-xs text-amber-400 whitespace-nowrap">Low stock</span>
                      )}
                      {outOfStock && (
                        <span className="text-xs text-red-400 whitespace-nowrap">Sold out</span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2">{item.description}</p>
                    )}
                    <p className="text-green-400 font-semibold text-sm mt-2">
                      {formatPrice(item.price)}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Floating Cart Bar */}
        {itemCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950 border-t border-gray-800">
            <button
              onClick={() => setStep('cart')}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 rounded-xl flex items-center justify-between px-5 transition-colors"
            >
              <span className="bg-blue-500 rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold">
                {itemCount}
              </span>
              <span>View Cart</span>
              <span>{formatPrice(total)}</span>
            </button>
          </div>
        )}

        {/* Item Add Modal */}
        {selectedItem && (
          <ItemModal
            item={selectedItem}
            onClose={() => setSelectedItem(null)}
            onAdd={addToCart}
          />
        )}
      </div>
    )
  }

  // ── Step 2: Cart + Customer Info ────────────────────────────────────────────

  if (step === 'cart') {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => setStep('menu')}
            className="text-gray-400 hover:text-white text-lg"
          >
            ←
          </button>
          <div>
            <h1 className="text-xl font-bold">Your Cart</h1>
            <p className="text-gray-400 text-sm">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="px-4 py-4 pb-36 space-y-6 max-w-xl mx-auto">
          {/* Cart Items */}
          <div className="space-y-3">
            {cartItems.map(item => {
              const lineTotal = cartItemTotal(item)
              return (
                <div key={item.id} className="bg-gray-900 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white text-sm">{item.name}</h3>
                      {item.modifiers.length > 0 && (
                        <p className="text-gray-400 text-xs mt-0.5">
                          {item.modifiers.map(m => m.name).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-green-400 font-semibold text-sm">{formatPrice(lineTotal)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5">
                      <button
                        onClick={() => updateQty(item.id, -1)}
                        className="text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center"
                      >
                        -
                      </button>
                      <span className="text-white text-sm w-5 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(item.id, 1)}
                        className="text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Order Total */}
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="flex justify-between text-sm text-gray-400 mb-1">
              <span>Subtotal</span>
              <span>{formatPrice(total)}</span>
            </div>
            <div className="flex justify-between font-semibold text-white pt-2 border-t border-gray-800">
              <span>Total</span>
              <span>{formatPrice(total)}</span>
            </div>
            <p className="text-gray-500 text-xs mt-1">Tax calculated at checkout</p>
          </div>

          {/* Customer Info */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Your Info</h2>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Your full name"
                className={`w-full bg-gray-900 border rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none focus:border-blue-500 ${
                  infoErrors.name ? 'border-red-500' : 'border-gray-700'
                }`}
              />
              {infoErrors.name && <p className="text-red-400 text-xs mt-1">{infoErrors.name}</p>}
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={customerEmail}
                onChange={e => setCustomerEmail(e.target.value)}
                placeholder="your@email.com"
                className={`w-full bg-gray-900 border rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none focus:border-blue-500 ${
                  infoErrors.email ? 'border-red-500' : 'border-gray-700'
                }`}
              />
              {infoErrors.email && <p className="text-red-400 text-xs mt-1">{infoErrors.email}</p>}
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
                placeholder="555-123-4567"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Special Instructions (optional)
              </label>
              <textarea
                value={specialNotes}
                onChange={e => setSpecialNotes(e.target.value)}
                placeholder="Allergies, special requests…"
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm outline-none focus:border-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Sticky CTA */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950 border-t border-gray-800">
          <div className="max-w-xl mx-auto">
            <button
              onClick={proceedToPayment}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
            >
              Proceed to Payment — {formatPrice(total)}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 3: Payment ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => {
            setStep('cart')
            setPaymentError(null)
          }}
          disabled={paymentLoading}
          className="text-gray-400 hover:text-white text-lg disabled:opacity-50"
        >
          ←
        </button>
        <div>
          <h1 className="text-xl font-bold">Payment</h1>
          <p className="text-gray-400 text-sm">Secure card entry</p>
        </div>
      </div>

      <div className="px-4 py-4 pb-36 space-y-4 max-w-xl mx-auto">
        {/* Order Summary */}
        <div className="bg-gray-900 rounded-xl p-4">
          <h2 className="font-semibold text-gray-300 text-sm mb-3">Order Summary</h2>
          <div className="space-y-2">
            {cartItems.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-400">
                  {item.quantity}x {item.name}
                  {item.modifiers.length > 0 && (
                    <span className="text-gray-500"> ({item.modifiers.map(m => m.name).join(', ')})</span>
                  )}
                </span>
                <span className="text-white">{formatPrice(cartItemTotal(item))}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800 mt-3 pt-3 flex justify-between font-semibold">
            <span>Total</span>
            <span className="text-green-400">{formatPrice(total)}</span>
          </div>
        </div>

        {/* Customer Info Summary */}
        <div className="bg-gray-900 rounded-xl p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Name</span>
            <span className="text-white">{customerName}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-gray-400">Email</span>
            <span className="text-white">{customerEmail}</span>
          </div>
          {customerPhone && (
            <div className="flex justify-between mt-1">
              <span className="text-gray-400">Phone</span>
              <span className="text-white">{customerPhone}</span>
            </div>
          )}
        </div>

        {/* Datacap iFrame */}
        <div className="bg-gray-900 rounded-xl p-4">
          <h2 className="font-semibold text-gray-300 text-sm mb-3">Card Details</h2>
          <div className="min-h-[160px] flex items-center justify-center">
            {!datacapReady ? (
              <p className="text-gray-500 text-sm">Loading payment form…</p>
            ) : null}
            {/* Datacap injects content into this iframe */}
            <iframe
              id="datacap-token-iframe"
              className="w-full"
              style={{ minHeight: '160px', border: 'none' }}
              title="Secure Card Entry"
            />
          </div>
        </div>

        {/* Payment Error */}
        {paymentError && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-4">
            <p className="text-red-300 text-sm">{paymentError}</p>
          </div>
        )}
      </div>

      {/* Place Order Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950 border-t border-gray-800">
        <div className="max-w-xl mx-auto">
          <button
            onClick={handlePlaceOrder}
            disabled={paymentLoading || !datacapReady}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {paymentLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Processing…
              </>
            ) : (
              `Place Order — ${formatPrice(total)}`
            )}
          </button>
          <p className="text-center text-gray-500 text-xs mt-2">
            Your card is charged only when the order is confirmed.
          </p>
        </div>
      </div>
    </div>
  )
}
