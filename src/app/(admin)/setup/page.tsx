'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface SetupStatus {
  businessInfo: boolean
  menuBasics: boolean
  employees: boolean
  floorPlan: boolean
  printers: boolean
  payments: boolean
  completedCount: number
  totalSteps: number
}

interface SetupStep {
  key: keyof Omit<SetupStatus, 'completedCount' | 'totalSteps'>
  title: string
  description: string
  href: string
  buttonLabel: string
}

const SETUP_STEPS: SetupStep[] = [
  {
    key: 'businessInfo',
    title: 'Business Info',
    description: 'Set your venue name, address, and contact details so receipts and reports look right.',
    href: '/settings',
    buttonLabel: 'Go to Settings',
  },
  {
    key: 'menuBasics',
    title: 'Menu Basics',
    description: 'Create at least one category and one menu item. You can also import items from a CSV file.',
    href: '/menu',
    buttonLabel: 'Build Menu',
  },
  {
    key: 'employees',
    title: 'Employees',
    description: 'Add your staff with PINs and roles so they can clock in and take orders.',
    href: '/employees',
    buttonLabel: 'Add Employees',
  },
  {
    key: 'floorPlan',
    title: 'Floor Plan',
    description: 'Set up your tables, bar seats, and sections for dine-in service.',
    href: '/tables',
    buttonLabel: 'Set Up Tables',
  },
  {
    key: 'printers',
    title: 'Printers',
    description: 'Connect receipt and kitchen printers so orders reach the right station.',
    href: '/settings/hardware/printers',
    buttonLabel: 'Configure Printers',
  },
  {
    key: 'payments',
    title: 'Payment Readers',
    description: 'Pair at least one card reader so you can accept credit and debit payments.',
    href: '/settings/hardware/payment-readers',
    buttonLabel: 'Add Reader',
  },
]

export default function SetupPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/setup' })

  const locationId = employee?.location?.id
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/setup/status?locationId=${locationId}`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch setup status:', error)
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  if (!hydrated || !employee) return null

  const completedCount = status?.completedCount ?? 0
  const totalSteps = status?.totalSteps ?? 6
  const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0
  const allComplete = completedCount === totalSteps

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Getting Started"
        subtitle="Complete these steps to set up your venue"
      />

      <div className="mx-auto max-w-3xl">
        {/* Progress Section */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {allComplete ? 'All set! Your venue is ready.' : `Setup ${completedCount}/${totalSteps} complete`}
            </h2>
            <span className="text-sm font-medium text-gray-500">{progressPercent}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                allComplete ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {allComplete && (
            <p className="mt-3 text-sm text-green-700">
              All setup steps are complete. You&apos;re ready to start taking orders!
            </p>
          )}
        </div>

        {/* Steps */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center rounded-xl bg-white shadow-sm">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-4">
            {SETUP_STEPS.map((step, index) => {
              const isComplete = status ? status[step.key] : false

              return (
                <div
                  key={step.key}
                  className={`rounded-xl bg-white p-5 shadow-sm border transition-colors ${
                    isComplete ? 'border-green-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Status Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {isComplete ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                          <svg
                            className="h-5 w-5 text-green-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                          <span className="text-sm font-semibold text-gray-500">{index + 1}</span>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`text-base font-semibold ${isComplete ? 'text-green-800' : 'text-gray-900'}`}>
                          {step.title}
                        </h3>
                        {isComplete && (
                          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Complete
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{step.description}</p>
                    </div>

                    {/* Action Button */}
                    <Link
                      href={step.href}
                      className={`flex-shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        isComplete
                          ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {isComplete ? 'Review' : step.buttonLabel} &rarr;
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Skip Setup Link */}
        <div className="mt-8 text-center">
          <Link
            href="/orders"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip setup and go to orders &rarr;
          </Link>
        </div>
      </div>
    </div>
  )
}
