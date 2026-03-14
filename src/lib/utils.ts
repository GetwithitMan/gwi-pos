import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num)
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateTime(date: Date | string): string {
  return `${formatDate(date)} ${formatTime(date)}`
}

/**
 * Normalize a phone number to digits-only format for consistent storage and lookup.
 * Strips all non-digit characters. For US numbers (10 digits), prepends country code 1.
 * Returns null if the input is falsy or has fewer than 7 digits.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return null
  // US 10-digit → prepend 1
  if (digits.length === 10) return `1${digits}`
  // Already has country code
  if (digits.length === 11 && digits[0] === '1') return digits
  return digits
}

/**
 * Format a normalized phone number for display: (555) 123-4567
 * Accepts any format — normalizes first, then formats.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  // Strip leading 1 for US numbers
  const local = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
  }
  return phone // Return as-is if not standard US format
}
