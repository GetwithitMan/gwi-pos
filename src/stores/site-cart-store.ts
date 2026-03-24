import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─── Types ───

export interface CartModifier {
  modifierId: string
  name: string
  price: number
  quantity: number
  preModifier: string | null  // 'no' | 'lite' | 'extra' | 'side' | null
  depth: number
  childSelections?: CartModifier[]
  isCustomEntry?: boolean
  customEntryText?: string
  isNoneSelection?: boolean
}

export interface CartPizzaData {
  sizeId: string
  sizeName: string
  crustId: string
  crustName: string
  sauceId: string | null
  cheeseId: string | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  sauceSections: number[] | null
  cheeseSections: number[] | null
  sectionMode: number
  toppings: Array<{
    toppingId: string
    name: string
    sections: number[]
    amount: 'regular' | 'extra'
    price: number
  }>
  sizePrice: number
  crustPrice: number
  saucePrice: number
  cheesePrice: number
  toppingsPrice: number
}

export interface CartItem {
  id: string              // crypto.randomUUID()
  menuItemId: string
  name: string
  basePrice: number       // dollars (POS convention)
  quantity: number
  itemType: string        // 'standard' | 'pizza' | 'combo'
  modifiers: CartModifier[]
  pizzaData?: CartPizzaData
  specialInstructions?: string
}

interface SiteCartState {
  items: CartItem[]
  orderType: 'pickup' | 'delivery' | 'dine_in'
  tipPercent: number | null
  tipAmount: number
  customerInfo: { name: string; email: string; phone: string }
  specialRequests: string
  tableContext: { table: string; section?: string } | null
  couponCode: string | null
  couponDiscount: number
  giftCardNumber: string | null
  giftCardApplied: number
  slug: string
  menuVersion: string

  // Actions
  addItem: (item: CartItem) => void
  removeItem: (cartItemId: string) => void
  updateQuantity: (cartItemId: string, quantity: number) => void
  setOrderType: (type: 'pickup' | 'delivery' | 'dine_in') => void
  setTipPercent: (pct: number | null) => void
  setTipAmount: (amt: number) => void
  setCustomerInfo: (info: Partial<{ name: string; email: string; phone: string }>) => void
  setSpecialRequests: (text: string) => void
  setTableContext: (ctx: { table: string; section?: string } | null) => void
  applyCoupon: (code: string, discount: number) => void
  removeCoupon: () => void
  applyGiftCard: (number: string, amount: number) => void
  removeGiftCard: () => void
  setSlug: (slug: string) => void
  setMenuVersion: (version: string) => void
  clearCart: () => void
}

// ─── Helpers ───

/** Recursively sum modifier prices including nested children */
export function flattenModifierPrice(modifiers: CartModifier[]): number {
  let total = 0
  for (const mod of modifiers) {
    // 'no' pre-modifier = $0
    if (mod.preModifier === 'no') continue
    total += mod.price * mod.quantity
    if (mod.childSelections?.length) {
      total += flattenModifierPrice(mod.childSelections)
    }
  }
  return total
}

/** Calculate total price for a single cart item */
function getItemTotal(item: CartItem): number {
  if (item.pizzaData) {
    const { sizePrice, crustPrice, saucePrice, cheesePrice, toppingsPrice } = item.pizzaData
    return (sizePrice + crustPrice + saucePrice + cheesePrice + toppingsPrice) * item.quantity
  }
  const modsTotal = flattenModifierPrice(item.modifiers)
  return (item.basePrice + modsTotal) * item.quantity
}

// ─── Store ───

const DEFAULT_STATE = {
  items: [] as CartItem[],
  orderType: 'pickup' as const,
  tipPercent: null as number | null,
  tipAmount: 0,
  customerInfo: { name: '', email: '', phone: '' },
  specialRequests: '',
  tableContext: null as { table: string; section?: string } | null,
  couponCode: null as string | null,
  couponDiscount: 0,
  giftCardNumber: null as string | null,
  giftCardApplied: 0,
  slug: '',
  menuVersion: '',
}

export const useSiteCartStore = create<SiteCartState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      addItem: (item) => {
        set((state) => ({ items: [...state.items, item] }))
      },

      removeItem: (cartItemId) => {
        set((state) => ({ items: state.items.filter((i) => i.id !== cartItemId) }))
      },

      updateQuantity: (cartItemId, quantity) => {
        if (quantity <= 0) {
          set((state) => ({ items: state.items.filter((i) => i.id !== cartItemId) }))
          return
        }
        set((state) => ({
          items: state.items.map((i) =>
            i.id === cartItemId ? { ...i, quantity } : i
          ),
        }))
      },

      setOrderType: (type) => set({ orderType: type }),

      setTipPercent: (pct) => set({ tipPercent: pct }),

      setTipAmount: (amt) => set({ tipAmount: amt }),

      setCustomerInfo: (info) => {
        set((state) => ({
          customerInfo: { ...state.customerInfo, ...info },
        }))
      },

      setSpecialRequests: (text) => set({ specialRequests: text }),

      setTableContext: (ctx) => set({ tableContext: ctx }),

      applyCoupon: (code, discount) => set({ couponCode: code, couponDiscount: discount }),

      removeCoupon: () => set({ couponCode: null, couponDiscount: 0 }),

      applyGiftCard: (number, amount) => set({ giftCardNumber: number, giftCardApplied: amount }),

      removeGiftCard: () => set({ giftCardNumber: null, giftCardApplied: 0 }),

      setSlug: (slug) => set({ slug }),

      setMenuVersion: (version) => set({ menuVersion: version }),

      clearCart: () => set({ ...DEFAULT_STATE, slug: get().slug, menuVersion: get().menuVersion }),
    }),
    {
      name: 'site-cart',
      partialize: (state) => ({
        items: state.items,
        orderType: state.orderType,
        tipPercent: state.tipPercent,
        tipAmount: state.tipAmount,
        // EXCLUDED: customerInfo (PII — name, email, phone)
        // EXCLUDED: giftCardNumber (sensitive payment data)
        specialRequests: state.specialRequests,
        tableContext: state.tableContext,
        couponCode: state.couponCode,
        couponDiscount: state.couponDiscount,
        giftCardApplied: state.giftCardApplied,
        slug: state.slug,
        menuVersion: state.menuVersion,
      }),
    }
  )
)

// ─── Atomic Selectors ───

export const useCartItems = () => useSiteCartStore((s) => s.items)
export const useCartItemCount = () =>
  useSiteCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0))
export const useCartSubtotal = () =>
  useSiteCartStore((s) => s.items.reduce((sum, item) => sum + getItemTotal(item), 0))
export const useCartOrderType = () => useSiteCartStore((s) => s.orderType)
export const useCartCustomerInfo = () => useSiteCartStore((s) => s.customerInfo)
export const useCartTip = () =>
  useSiteCartStore((s) => ({ tipPercent: s.tipPercent, tipAmount: s.tipAmount }))
export const useCartSpecialRequests = () => useSiteCartStore((s) => s.specialRequests)
export const useCartTableContext = () => useSiteCartStore((s) => s.tableContext)
export const useCartCoupon = () =>
  useSiteCartStore((s) => ({ code: s.couponCode, discount: s.couponDiscount }))
export const useCartGiftCard = () =>
  useSiteCartStore((s) => ({ number: s.giftCardNumber, applied: s.giftCardApplied }))
export const useCartSlug = () => useSiteCartStore((s) => s.slug)
export const useCartMenuVersion = () => useSiteCartStore((s) => s.menuVersion)
