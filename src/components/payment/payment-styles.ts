/**
 * Shared Tailwind class constants for payment components.
 *
 * These replace the inline style objects that were previously in PaymentModal.tsx
 * (overlayStyle, modalStyle, headerStyle, contentStyle, footerStyle, etc.)
 */

// ─── Layout ─────────────────────────────────────────────────────────────────

export const overlayClasses =
  'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50'

export const modalClasses =
  'bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-white/[0.08] shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col'

export const headerClasses =
  'p-4 border-b border-white/[0.08] flex items-center justify-between'

export const contentClasses =
  'flex-1 overflow-y-auto p-4'

export const footerClasses =
  'p-4 border-t border-white/[0.08]'

// ─── Typography ─────────────────────────────────────────────────────────────

export const sectionLabelClasses =
  'text-slate-100 font-semibold text-base mb-2'

export const mutedTextClasses =
  'text-slate-400 text-sm'

// ─── Inputs ─────────────────────────────────────────────────────────────────

export const inputClasses =
  'bg-slate-900/80 border border-slate-600/30 rounded-lg text-white py-2.5 px-3 w-full text-sm outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30'

// ─── Buttons ────────────────────────────────────────────────────────────────

export const backButtonClasses =
  'flex-1 py-3 px-4 rounded-[10px] border border-slate-600/30 bg-transparent text-slate-400 text-[15px] font-medium cursor-pointer hover:bg-white/[0.03] transition-colors'

export const primaryButtonClasses =
  'flex-1 py-3 px-4 rounded-[10px] border-none bg-indigo-600 text-white text-[15px] font-semibold cursor-pointer hover:bg-indigo-500 transition-colors'

// ─── Info Panels ────────────────────────────────────────────────────────────

export const infoPanelBase =
  'p-3 rounded-[10px] mb-3'

// Color-specific info panel backgrounds (used with infoPanelBase)
export const infoPanelIndigo = 'bg-indigo-500/15'
export const infoPanelGreen = 'bg-green-500/[0.12]'
export const infoPanelPurple = 'bg-purple-500/[0.12]'
export const infoPanelTeal = 'bg-teal-500/[0.12]'

// ─── Method Buttons ─────────────────────────────────────────────────────────

export const methodButtonBase =
  'w-full h-[72px] flex items-center gap-4 px-5 rounded-xl text-left transition-colors'

export const methodButtonCash =
  `${methodButtonBase} border border-green-500/30 bg-green-500/[0.08] hover:bg-green-500/[0.12]`

export const methodButtonCard =
  `${methodButtonBase} border border-indigo-500/30 bg-indigo-500/[0.08] hover:bg-indigo-500/[0.12]`

export const methodButtonGiftCard =
  `${methodButtonBase} border border-purple-500/30 bg-purple-500/[0.08] hover:bg-purple-500/[0.12]`

export const methodButtonHouseAccount =
  `${methodButtonBase} border border-slate-500/30 bg-slate-500/[0.08] hover:bg-slate-500/[0.12]`

export const methodButtonRoomCharge =
  `${methodButtonBase} border border-teal-500/30 bg-teal-500/[0.08] hover:bg-teal-500/[0.12]`

// ─── Alerts / Status ────────────────────────────────────────────────────────

export const errorBannerClasses =
  'mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-[10px] text-red-400 text-sm'

export const processingBannerClasses =
  'mb-4 p-3 bg-indigo-500/[0.12] border border-indigo-500/25 rounded-[10px] flex items-center gap-2.5'

export const warningBannerClasses =
  'mb-4 p-3 bg-amber-500/15 border border-amber-500/30 rounded-[10px] text-amber-500 text-sm font-semibold'

export const surchargeNoticeClasses =
  'mb-3 py-2 px-3 bg-amber-500/10 border border-amber-500/25 rounded-lg text-[13px] text-amber-300 text-center'

export const savingsNoticeClasses =
  'mb-3 py-2 px-3 bg-green-500/10 border border-green-500/20 rounded-lg text-[13px] text-green-400 text-center'

// ─── Spinner ────────────────────────────────────────────────────────────────

export const spinnerClasses =
  'w-[18px] h-[18px] border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0'

export const spinnerSmallClasses =
  'w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0'
