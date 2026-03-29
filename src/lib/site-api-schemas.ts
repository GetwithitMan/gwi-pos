import { z } from 'zod'

// Site Bootstrap Response
export const SiteBootstrapSchema = z.object({
  venue: z.object({
    name: z.string(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  branding: z.object({
    brandColor: z.string(),
    brandColorSecondary: z.string(),
    logoUrl: z.string().nullable(),
    bannerUrl: z.string().nullable(),
    tagline: z.string().nullable(),
    themePreset: z.enum(['modern', 'classic', 'bold']),
    headingFont: z.string().nullable(),
  }),
  sections: z.object({
    showHero: z.boolean(),
    showAbout: z.boolean(),
    showHours: z.boolean(),
    showFeaturedItems: z.boolean(),
    showReservations: z.boolean(),
    showContact: z.boolean(),
    showRewardsOnSite: z.boolean(),
    showGiftCards: z.boolean(),
  }),
  content: z.object({
    aboutText: z.string(),
    socialLinks: z.object({
      facebook: z.string().optional(),
      instagram: z.string().optional(),
      twitter: z.string().optional(),
      yelp: z.string().optional(),
      google: z.string().optional(),
    }),
    footerText: z.string().nullable(),
  }),
  hours: z.array(z.object({
    day: z.number(),
    open: z.string(),
    close: z.string(),
    closed: z.boolean(),
  })),
  capabilities: z.object({
    canBrowseMenu: z.boolean(),
    canPlacePickupOrder: z.boolean(),
    canPlaceDeliveryOrder: z.boolean(),
    canPlaceDineInOrder: z.boolean(),
    canReserve: z.boolean(),
    canUseRewards: z.boolean(),
    canViewOrderHistory: z.boolean(),
    canUseGiftCards: z.boolean(),
    canUseCoupons: z.boolean(),
    isCurrentlyOpen: z.boolean(),
    isAcceptingOrders: z.boolean(),
  }),
  orderingConfig: z.object({
    prepTime: z.number(),
    tipSuggestions: z.array(z.number()),
    defaultTip: z.number(),
    requireZip: z.boolean(),
    allowSpecialRequests: z.boolean(),
    surchargeType: z.string().nullable(),
    surchargeAmount: z.number(),
    surchargeName: z.string(),
    minOrderAmount: z.number().nullable(),
    maxOrderAmount: z.number().nullable(),
    achEnabled: z.boolean(),
  }),
  walletConfig: z.object({
    applePayMid: z.string().nullable(),
    googlePayBusinessId: z.string().nullable(),
  }),
})

export type SiteBootstrapResponse = z.infer<typeof SiteBootstrapSchema>

// Checkout Quote
export const CheckoutQuoteRequestSchema = z.object({
  slug: z.string(),
  items: z.array(z.object({
    menuItemId: z.string(),
    quantity: z.number().int().positive(),
    modifiers: z.array(z.object({
      modifierId: z.string(),
      name: z.string(),
      price: z.number(),
    })),
  })),
  orderType: z.enum(['pickup', 'delivery', 'dine_in']),
  couponCode: z.string().optional(),
  giftCardNumber: z.string().optional(),
  tipPercent: z.number().optional(),
  tipAmount: z.number().optional(),
})

// Coupon Validation
export const CouponValidateSchema = z.object({
  code: z.string(),
  slug: z.string(),
  subtotal: z.number(),
  customerId: z.string().optional(),
})

export const CouponValidateResponseSchema = z.object({
  valid: z.boolean(),
  discount: z.number().optional(),
  discountType: z.string().optional(),
  reason: z.string().optional(),
})

// Gift Card Balance
export const GiftCardBalanceSchema = z.object({
  number: z.string(),
  pin: z.string().optional(),
  slug: z.string(),
})

export const GiftCardBalanceResponseSchema = z.object({
  valid: z.boolean(),
  balance: z.number().optional(),
  last4: z.string().optional(),
  reason: z.string().optional(),
})
