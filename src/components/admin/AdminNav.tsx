'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { hasPermission, isAdmin, PERMISSIONS } from '@/lib/auth-utils'

// SVG Icons as components for reuse
const Icons = {
  grid: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  monitor: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  menu: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  modifiers: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  ),
  combo: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  ingredients: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  pizza: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18M3 12h18" />
    </svg>
  ),
  liquor: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  prep: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  inventory: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  table: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  floorPlan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  ),
  clock: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  calendar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  ticket: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  ),
  virtualGroups: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  customers: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  giftCard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </svg>
  ),
  houseAccount: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  coupon: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  ),
  discount: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  employee: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  role: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  schedule: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  payroll: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  reports: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  money: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  tax: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  tips: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  hardware: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  ),
  printer: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  ),
  void: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  ),
  outOfStock: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  chart: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  ),
  history: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  dollar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  chevronDown: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  close: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  hamburger: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
}

interface NavItem {
  name: string
  href: string
  icon?: React.ReactNode
  permission?: string
  subItems?: NavItem[]
  action?: string  // If set, triggers onAction instead of navigation
}

interface NavSection {
  title: string
  icon: string
  permission?: string | null // null means everyone can see
  items: NavItem[]
  adminItems?: NavItem[] // Only show for managers/admins
}

// Navigation sections with the new hierarchy
const navSections: NavSection[] = [
  {
    title: 'POS',
    icon: '📱',
    permission: null,
    items: [
      { name: 'Floor Plan', href: '/orders', icon: Icons.grid },
      { name: 'Tip Adjustments', href: '#', icon: Icons.dollar, action: 'tip_adjustments' },
      { name: 'Kitchen Display', href: '/kds', icon: Icons.monitor },
    ],
  },
  {
    title: 'Inventory',
    icon: '📦',
    permission: null, // Visible to all - Food & Liquor inventory
    items: [
      { name: 'Quick 86', href: '/86', icon: Icons.outOfStock },
      { name: 'Food Inventory', href: '/inventory', icon: Icons.ingredients },
      { name: 'Liquor Inventory', href: '/inventory/beverages', icon: Icons.liquor },
    ],
    adminItems: [
      { name: 'Counts', href: '/inventory/counts', icon: Icons.chart },
      { name: 'Waste Log', href: '/inventory/waste', icon: Icons.void },
      { name: 'Vendors', href: '/inventory/vendors', icon: Icons.houseAccount },
    ],
  },
  {
    title: 'Menu Builder',
    icon: '🍔',
    permission: null, // Visible to all
    items: [
      { name: 'Menu Items', href: '/menu', icon: Icons.menu },
      { name: 'Combos', href: '/combos', icon: Icons.combo },
    ],
    adminItems: [
      { name: 'Discounts', href: '/discounts', icon: Icons.discount },
    ],
  },
  {
    title: 'Floor & Tables',
    icon: '🪑',
    permission: null,
    items: [
      { name: 'Floor Plan Editor', href: '/floorplan/editor', icon: Icons.floorPlan },
      { name: 'Reservations', href: '/reservations', icon: Icons.calendar },
      { name: 'Timed Rentals', href: '/timed-rentals', icon: Icons.clock },
    ],
    adminItems: [
      { name: 'Virtual Groups', href: '/virtual-groups', icon: Icons.virtualGroups },
      { name: 'Events', href: '/events', icon: Icons.ticket },
    ],
  },
  {
    title: 'Customers',
    icon: '👥',
    permission: PERMISSIONS.CUSTOMERS_VIEW,
    items: [
      { name: 'Customer List', href: '/customers', icon: Icons.customers },
      { name: 'Gift Cards', href: '/gift-cards', icon: Icons.giftCard },
    ],
    adminItems: [
      { name: 'House Accounts', href: '/house-accounts', icon: Icons.houseAccount },
      { name: 'Coupons', href: '/coupons', icon: Icons.coupon },
      { name: 'Discounts', href: '/discounts', icon: Icons.discount },
    ],
  },
  {
    title: 'Team',
    icon: '👔',
    permission: PERMISSIONS.STAFF_VIEW,
    items: [
      { name: 'Employees', href: '/employees', icon: Icons.employee },
    ],
    adminItems: [
      { name: 'Roles & Permissions', href: '/roles', icon: Icons.role },
      { name: 'Scheduling', href: '/scheduling', icon: Icons.schedule },
      { name: 'Payroll', href: '/payroll', icon: Icons.payroll },
    ],
  },
  {
    title: 'Reports',
    icon: '📊',
    permission: null, // Some reports available to all
    items: [
      { name: 'Reports Hub', href: '/reports', icon: Icons.reports },
      { name: 'Daily Summary', href: '/reports/daily', icon: Icons.calendar },
      { name: 'My Shift', href: '/reports/shift', icon: Icons.clock },
    ],
    adminItems: [
      { name: 'Sales', href: '/reports/sales', icon: Icons.money },
      { name: 'Product Mix', href: '/reports/product-mix', icon: Icons.chart },
      { name: 'Order History', href: '/reports/order-history', icon: Icons.history },
      { name: 'Tips', href: '/reports/tips', icon: Icons.tips },
      { name: 'Employee Reports', href: '/reports/employees', icon: Icons.employee },
      { name: 'Voids & Comps', href: '/reports/voids', icon: Icons.void },
      { name: 'Commissions', href: '/reports/commission', icon: Icons.money },
      { name: 'Reservations', href: '/reports/reservations', icon: Icons.calendar },
      { name: 'Coupons', href: '/reports/coupons', icon: Icons.coupon },
      { name: 'Liquor', href: '/reports/liquor', icon: Icons.liquor },
      { name: 'Payroll', href: '/reports/payroll', icon: Icons.payroll },
    ],
  },
  {
    title: 'Settings',
    icon: '⚙️',
    permission: PERMISSIONS.SETTINGS_VIEW,
    items: [
      { name: 'General', href: '/settings', icon: Icons.settings },
    ],
    adminItems: [
      { name: 'Order Types', href: '/settings/order-types', icon: Icons.menu },
      { name: 'Tax Rules', href: '/tax-rules', icon: Icons.tax },
      { name: 'Tip-Out Rules', href: '/settings/tip-outs', icon: Icons.tips },
      {
        name: 'Hardware',
        href: '/settings/hardware',
        icon: Icons.hardware,
        subItems: [
          { name: 'Printers', href: '/settings/hardware/printers' },
          { name: 'KDS Screens', href: '/settings/hardware/kds-screens' },
          { name: 'Print Routing', href: '/settings/hardware/routing' },
          { name: 'Terminals', href: '/settings/hardware/terminals' },
          { name: 'Payment Readers', href: '/settings/hardware/payment-readers' },
        ],
      },
    ],
  },
]

interface AdminNavProps {
  forceOpen?: boolean
  onClose?: () => void
  permissions?: string[]
  onAction?: (action: string) => void
}

export function AdminNav({ forceOpen, onClose, permissions = [], onAction }: AdminNavProps) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<string[]>(['POS', 'Menu & Products', 'Reports'])
  const [expandedSubItems, setExpandedSubItems] = useState<string[]>([])

  // Check if user is admin/manager
  const userIsAdmin = isAdmin(permissions)

  // Check if user has permission to view an item
  const canView = (permission?: string | null) => {
    if (!permission) return true
    if (permission === 'pos.access') return true
    return hasPermission(permissions, permission)
  }

  // Filter nav sections and items based on permissions
  const filteredNavSections = navSections
    .map((section) => {
      // Get base items that user has permission to view
      const visibleItems = section.items.filter((item) => canView(item.permission))

      // Add admin items if user is admin/manager
      const adminItems = userIsAdmin && section.adminItems ? section.adminItems : []

      return {
        ...section,
        items: [...visibleItems, ...adminItems],
      }
    })
    .filter((section) => {
      // Show section if it has visible items AND user has section permission (or section has no permission requirement)
      const hasVisibleItems = section.items.length > 0
      const hasAccess = section.permission === null || canView(section.permission)
      return hasVisibleItems && hasAccess
    })

  // Use forceOpen prop if provided, otherwise use internal state
  const isVisible = forceOpen !== undefined ? forceOpen : isOpen

  const toggleSection = (title: string) => {
    setExpandedSections((prev) =>
      prev.includes(title) ? prev.filter((s) => s !== title) : [...prev, title]
    )
  }

  const toggleSubItems = (href: string) => {
    setExpandedSubItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    )
  }

  const isActive = (href: string) => {
    if (href === '/orders') {
      return pathname === '/orders' || pathname === '/'
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  const handleClose = () => {
    if (onClose) {
      onClose()
    } else {
      setIsOpen(false)
    }
  }

  return (
    <>
      {/* Mobile menu button - only show if not controlled externally */}
      {forceOpen === undefined && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="fixed top-4 left-4 z-50 lg:hidden bg-white p-2 rounded-lg shadow-md"
        >
          {isVisible ? Icons.close : Icons.hamburger}
        </button>
      )}

      {/* Overlay */}
      {isVisible && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={handleClose}
        />
      )}

      {/* Sidebar */}
      <nav
        className={`fixed top-0 left-0 bottom-0 w-72 bg-white shadow-lg z-50 transform transition-transform duration-200 ${
          forceOpen !== undefined
            ? isVisible
              ? 'translate-x-0'
              : '-translate-x-full'
            : `lg:translate-x-0 ${isVisible ? 'translate-x-0' : '-translate-x-full'}`
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="p-4 border-b flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700">
            <div>
              <h1 className="text-xl font-bold text-white">GWI POS</h1>
              <p className="text-xs text-blue-200">Admin Navigation</p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Close menu"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto py-2">
            {filteredNavSections.map((section) => (
              <div key={section.title} className="mb-1">
                {/* Section Header */}
                <button
                  onClick={() => toggleSection(section.title)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-lg">{section.icon}</span>
                    <span>{section.title}</span>
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                      expandedSections.includes(section.title) ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Section Items */}
                {expandedSections.includes(section.title) && (
                  <div className="mt-1 space-y-0.5">
                    {section.items.map((item) => (
                      <div key={item.href}>
                        {item.subItems ? (
                          // Item with sub-items (expandable)
                          <>
                            <button
                              onClick={() => toggleSubItems(item.href)}
                              className={`w-full flex items-center justify-between gap-3 px-6 py-2 text-sm transition-colors ${
                                isActive(item.href)
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                              }`}
                            >
                              <span className="flex items-center gap-3">
                                <span className="text-gray-400">{item.icon}</span>
                                <span>{item.name}</span>
                              </span>
                              <svg
                                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                                  expandedSubItems.includes(item.href) ? 'rotate-180' : ''
                                }`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {/* Sub-items */}
                            {expandedSubItems.includes(item.href) && (
                              <div className="ml-4 mt-1 border-l-2 border-gray-100">
                                <Link
                                  href={item.href}
                                  onClick={handleClose}
                                  className={`flex items-center gap-3 px-6 py-1.5 text-sm transition-colors ${
                                    pathname === item.href
                                      ? 'bg-blue-50 text-blue-700'
                                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                                  }`}
                                >
                                  Overview
                                </Link>
                                {item.subItems.map((subItem) => (
                                  <Link
                                    key={subItem.href}
                                    href={subItem.href}
                                    onClick={handleClose}
                                    className={`flex items-center gap-3 px-6 py-1.5 text-sm transition-colors ${
                                      isActive(subItem.href)
                                        ? 'bg-blue-50 text-blue-700'
                                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                                    }`}
                                  >
                                    {subItem.name}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </>
                        ) : item.action ? (
                          // Action item (triggers callback instead of navigation)
                          <button
                            onClick={() => {
                              onAction?.(item.action!)
                              handleClose()
                            }}
                            className="flex items-center gap-3 px-6 py-2 text-sm transition-colors text-gray-600 hover:bg-gray-50 hover:text-gray-900 w-full text-left"
                          >
                            <span className="text-gray-400">{item.icon}</span>
                            <span>{item.name}</span>
                          </button>
                        ) : (
                          // Regular nav item
                          <Link
                            href={item.href}
                            onClick={handleClose}
                            className={`flex items-center gap-3 px-6 py-2 text-sm transition-colors ${
                              isActive(item.href)
                                ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                          >
                            <span className="text-gray-400">{item.icon}</span>
                            <span>{item.name}</span>
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-gray-50">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>GWI POS v1.0.0</span>
              {userIsAdmin && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>
      </nav>
    </>
  )
}
