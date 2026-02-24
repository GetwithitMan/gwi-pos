'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface TodayStats {
  totalSales: number
  orderCount: number
  avgOrderValue: number
  cashSales: number
  cardSales: number
  tipsCollected: number
  laborHours: number
  laborCost: number
}

interface ReportLink {
  name: string
  href: string
  description: string
  icon: React.ReactNode
  permission?: string
}

interface ReportCategory {
  title: string
  reports: ReportLink[]
}

export default function ReportsHubPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reports' })
  const employee = useAuthStore(s => s.employee)
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const permissions = employee?.permissions || []

  useEffect(() => {
    if (employee?.location?.id) {
      loadTodayStats()
    }
  }, [employee?.location?.id])

  const loadTodayStats = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      // Get today's date range
      const today = new Date().toISOString().split('T')[0]
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate: today,
        endDate: today,
        employeeId: employee.id,
      })

      const response = await fetch(`/api/reports/sales?${params}`)
      if (response.ok) {
        const data = await response.json()
        setStats({
          totalSales: data.data.summary?.netSales || 0,
          orderCount: data.data.summary?.orderCount || 0,
          avgOrderValue: data.data.summary?.averageOrderValue || 0,
          cashSales: data.data.summary?.cashSales || 0,
          cardSales: data.data.summary?.cardSales || 0,
          tipsCollected: data.data.summary?.tips || 0,
          // Labor metrics require aggregating TimeClockEntry data
          // Future enhancement: Add /api/reports/labor endpoint
          laborHours: data.data.summary?.laborHours || 0,
          laborCost: data.data.summary?.laborCost || 0,
        })
      }
    } catch (error) {
      console.error('Failed to load today stats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Check if user can view a specific report
  const canView = (permission?: string) => {
    if (!permission) return true
    return hasPermission(permissions, permission) ||
           hasPermission(permissions, PERMISSIONS.REPORTS_VIEW) ||
           hasPermission(permissions, 'admin') ||
           hasPermission(permissions, 'super_admin')
  }

  // Report categories with permission requirements
  const reportCategories: ReportCategory[] = [
    {
      title: 'End of Day',
      reports: [
        {
          name: 'Daily Sales Report',
          href: '/reports/daily',
          description: 'Full store report: revenue, payments, cash, labor, voids',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          ),
        },
        {
          name: 'Flash Report',
          href: '/reports/flash',
          description: 'Quick morning summary: yesterday vs previous day key metrics',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          ),
        },
        {
          name: 'Employee Shift Report',
          href: '/reports/shift',
          description: 'Individual employee shift: sales, tips, cash due',
          permission: PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          ),
        },
      ],
    },
    {
      title: 'Sales & Revenue',
      reports: [
        {
          name: 'Sales Report',
          href: '/reports/sales',
          description: 'Gross sales, net sales, payment breakdown by day/hour',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          ),
        },
        {
          name: 'Hourly Sales',
          href: '/reports/hourly',
          description: 'Revenue and order counts broken down by hour of day',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        },
        {
          name: 'Product Mix',
          href: '/reports/product-mix',
          description: 'Best selling items, category performance',
          permission: PERMISSIONS.REPORTS_PRODUCT_MIX,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
            </svg>
          ),
        },
        {
          name: 'Order History',
          href: '/reports/order-history',
          description: 'Individual order details and transaction history',
          permission: PERMISSIONS.REPORTS_TABS,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        },
        {
          name: 'Daypart Analysis',
          href: '/reports/daypart',
          description: 'Revenue and orders by time of day: morning, lunch, dinner, late night',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ),
        },
        {
          name: 'Trends & Comparison',
          href: '/reports/trends',
          description: 'Day-over-day and week-over-week comparison with delta metrics',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          ),
        },
        {
          name: 'Sales Forecasting',
          href: '/reports/forecasting',
          description: 'Day-of-week revenue patterns and projected sales for the next 7–14 days',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          ),
        },
      ],
    },
    {
      title: 'Team & Labor',
      reports: [
        {
          name: 'Payroll Report',
          href: '/reports/payroll',
          description: 'Complete payroll: wages, tips, commission, hours',
          permission: PERMISSIONS.REPORTS_LABOR,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          ),
        },
        {
          name: 'Labor Report',
          href: '/reports/labor',
          description: 'Hours worked, overtime, labor costs',
          permission: PERMISSIONS.REPORTS_LABOR,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        },
        {
          name: 'Employee Performance',
          href: '/reports/employees',
          description: 'Sales by server, tips, hours worked',
          permission: PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ),
        },
        {
          name: 'Server Performance',
          href: '/reports/server-performance',
          description: 'Orders, sales, tips, avg check, and table turns per server',
          permission: PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          ),
        },
        {
          name: 'Commission Report',
          href: '/reports/commission',
          description: 'Commission earnings by employee',
          permission: PERMISSIONS.REPORTS_COMMISSION,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        },
        {
          name: 'Tips Report',
          href: '/reports/tips',
          description: 'Tip sharing, tip-outs, and banked tips',
          permission: PERMISSIONS.REPORTS_COMMISSION,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          ),
        },
        {
          name: 'Tip Adjustment',
          href: '/reports/tip-adjustment',
          description: 'Review and adjust card transaction tips for today\'s shifts',
          permission: PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          ),
        },
      ],
    },
    {
      title: 'Performance',
      reports: [
        {
          name: 'Speed of Service',
          href: '/reports/speed-of-service',
          description: 'Avg order-to-send, send-to-complete, seat-to-pay times by employee and day',
          permission: PERMISSIONS.REPORTS_VIEW,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          ),
        },
      ],
    },
    {
      title: 'Operations',
      reports: [
        {
          name: 'Voids & Comps',
          href: '/reports/voids',
          description: 'Voided items and comped orders tracking',
          permission: PERMISSIONS.REPORTS_VOIDS,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          ),
        },
        {
          name: 'Payment Verification',
          href: '/reports/datacap',
          description: 'Verify card payments — live vs offline/SAF, authorization status, Datacap cross-check',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          ),
        },
        {
          name: 'Coupons & Discounts',
          href: '/reports/coupons',
          description: 'Coupon usage and discount tracking',
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
          ),
        },
        {
          name: 'Reservations',
          href: '/reports/reservations',
          description: 'Reservation history and no-shows',
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ),
        },
        {
          name: 'Cash-Flow & Liabilities',
          href: '/reports/cash-liabilities',
          description: 'Cash on hand, house accounts, gift cards, tip payouts, and over/short',
          permission: PERMISSIONS.REPORTS_SALES,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          ),
        },
        {
          name: 'Accounts Receivable',
          href: '/reports/house-accounts',
          description: 'Outstanding house account balances with 30/60/90-day aging buckets',
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
            </svg>
          ),
        },
      ],
    },
    {
      title: 'Inventory & Liquor',
      reports: [
        {
          name: 'Food Cost / Variance',
          href: '/reports/variance',
          description: 'Actual vs theoretical usage, shrinkage, variance by item',
          permission: PERMISSIONS.REPORTS_INVENTORY,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          ),
        },
        {
          name: 'Liquor & Spirits',
          href: '/reports/liquor',
          description: 'Pour costs, spirit sales, inventory levels',
          permission: PERMISSIONS.REPORTS_INVENTORY,
          icon: (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ),
        },
      ],
    },
  ]

  // Filter categories to only show reports user can access
  const filteredCategories = reportCategories
    .map(category => ({
      ...category,
      reports: category.reports.filter(report => canView(report.permission)),
    }))
    .filter(category => category.reports.length > 0)

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Reports Hub"
        subtitle={employee?.location?.name}
      />

      <div className="max-w-7xl mx-auto">
        {/* Today's Quick Stats */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Today&apos;s Overview</h2>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
                      <div className="h-8 bg-gray-200 rounded w-24" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Today&apos;s Sales</p>
                      <p className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalSales)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Orders</p>
                      <p className="text-2xl font-bold text-blue-600">{stats.orderCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Avg. Order</p>
                      <p className="text-2xl font-bold text-purple-600">{formatCurrency(stats.avgOrderValue)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Tips</p>
                      <p className="text-2xl font-bold text-orange-600">{formatCurrency(stats.tipsCollected)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Payment Breakdown */}
        {stats && (stats.cashSales > 0 || stats.cardSales > 0) && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-base">Today&apos;s Payment Methods</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-8">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <span className="text-sm text-gray-600">Cash</span>
                  <span className="font-semibold">{formatCurrency(stats.cashSales)}</span>
                  <span className="text-xs text-gray-400">
                    ({stats.cashSales + stats.cardSales > 0
                      ? Math.round((stats.cashSales / (stats.cashSales + stats.cardSales)) * 100)
                      : 0}%)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-blue-500 rounded-full" />
                  <span className="text-sm text-gray-600">Card</span>
                  <span className="font-semibold">{formatCurrency(stats.cardSales)}</span>
                  <span className="text-xs text-gray-400">
                    ({stats.cashSales + stats.cardSales > 0
                      ? Math.round((stats.cardSales / (stats.cashSales + stats.cardSales)) * 100)
                      : 0}%)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Report Categories */}
        <div className="space-y-8">
          {filteredCategories.map(category => (
            <div key={category.title}>
              <h2 className="text-lg font-semibold mb-4">{category.title}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {category.reports.map(report => (
                  <Link key={report.href} href={report.href}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="p-2 bg-gray-100 rounded-lg text-gray-600">
                            {report.icon}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-medium text-gray-900">{report.name}</h3>
                            <p className="text-sm text-gray-500 mt-1">{report.description}</p>
                          </div>
                          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* My Reports Section (always visible for personal stats) */}
        <div className="mt-8 pt-8 border-t">
          <h2 className="text-lg font-semibold mb-4">My Reports</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link href={`/reports/employees?employeeId=${employee?.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">My Sales</h3>
                      <p className="text-sm text-gray-500 mt-1">Your personal sales and performance</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href={`/reports/commission?employeeId=${employee?.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-green-100 rounded-lg text-green-600">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">My Commission</h3>
                      <p className="text-sm text-gray-500 mt-1">Your commission earnings and tips</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </CardContent>
              </Card>
            </Link>
            <Link href={`/reports/tips?employeeId=${employee?.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-orange-100 rounded-lg text-orange-600">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-900">My Tips</h3>
                      <p className="text-sm text-gray-500 mt-1">Your tip shares and banked tips</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
