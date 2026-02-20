'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'

interface EmployeePaymentInfo {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
  hourlyRate: number | null

  // Address
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null

  // Tax Info
  federalFilingStatus: string | null
  federalAllowances: number | null
  additionalFederalWithholding: number | null
  stateFilingStatus: string | null
  stateAllowances: number | null
  additionalStateWithholding: number | null
  isExemptFromFederalTax: boolean
  isExemptFromStateTax: boolean

  // Payment
  paymentMethod: string | null
  bankName: string | null
  bankRoutingNumber: string | null
  bankAccountNumber: string | null
  bankAccountType: string | null
  bankAccountLast4: string | null

  // YTD
  ytdGrossEarnings: number | null
  ytdTaxesWithheld: number | null
  ytdNetPay: number | null
}

type PageParams = {
  id: string
}

export default function EmployeePaymentPage({ params }: { params: Promise<PageParams> }) {
  const { id: employeeId } = use(params)
  const router = useRouter()
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/employees' })
  const [employee, setEmployee] = useState<EmployeePaymentInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    // Address
    address: '',
    city: '',
    state: '',
    zipCode: '',

    // Tax Info
    federalFilingStatus: 'single',
    federalAllowances: '0',
    additionalFederalWithholding: '0',
    stateFilingStatus: 'single',
    stateAllowances: '0',
    additionalStateWithholding: '0',
    isExemptFromFederalTax: false,
    isExemptFromStateTax: false,

    // Payment
    paymentMethod: 'check',
    bankName: '',
    bankRoutingNumber: '',
    bankAccountNumber: '',
    bankAccountType: 'checking',
  })

  useEffect(() => {
    loadEmployee()
  }, [employeeId])

  const loadEmployee = async () => {
    try {
      const response = await fetch(`/api/employees/${employeeId}/payment`)
      if (response.ok) {
        const data = await response.json()
        setEmployee(data.data.employee)

        // Populate form
        setFormData({
          address: data.data.employee.address || '',
          city: data.data.employee.city || '',
          state: data.data.employee.state || '',
          zipCode: data.data.employee.zipCode || '',
          federalFilingStatus: data.data.employee.federalFilingStatus || 'single',
          federalAllowances: data.data.employee.federalAllowances?.toString() || '0',
          additionalFederalWithholding: data.data.employee.additionalFederalWithholding?.toString() || '0',
          stateFilingStatus: data.data.employee.stateFilingStatus || 'single',
          stateAllowances: data.data.employee.stateAllowances?.toString() || '0',
          additionalStateWithholding: data.data.employee.additionalStateWithholding?.toString() || '0',
          isExemptFromFederalTax: data.data.employee.isExemptFromFederalTax || false,
          isExemptFromStateTax: data.data.employee.isExemptFromStateTax || false,
          paymentMethod: data.data.employee.paymentMethod || 'check',
          bankName: data.data.employee.bankName || '',
          bankRoutingNumber: '', // Never prefill for security
          bankAccountNumber: '', // Never prefill for security
          bankAccountType: data.data.employee.bankAccountType || 'checking',
        })
      } else {
        setError('Failed to load employee')
      }
    } catch (err) {
      setError('Failed to load employee')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    setError(null)
    setSuccess(null)
    setIsSaving(true)

    try {
      const payload: Record<string, unknown> = {
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        zipCode: formData.zipCode || null,
        federalFilingStatus: formData.federalFilingStatus,
        federalAllowances: parseInt(formData.federalAllowances) || 0,
        additionalFederalWithholding: parseFloat(formData.additionalFederalWithholding) || 0,
        stateFilingStatus: formData.stateFilingStatus,
        stateAllowances: parseInt(formData.stateAllowances) || 0,
        additionalStateWithholding: parseFloat(formData.additionalStateWithholding) || 0,
        isExemptFromFederalTax: formData.isExemptFromFederalTax,
        isExemptFromStateTax: formData.isExemptFromStateTax,
        paymentMethod: formData.paymentMethod,
      }

      // Only include bank info if payment method is direct_deposit
      if (formData.paymentMethod === 'direct_deposit') {
        payload.bankName = formData.bankName || null
        payload.bankAccountType = formData.bankAccountType

        // Only update bank details if new values provided
        if (formData.bankRoutingNumber) {
          payload.bankRoutingNumber = formData.bankRoutingNumber
        }
        if (formData.bankAccountNumber) {
          payload.bankAccountNumber = formData.bankAccountNumber
          // Store last 4 for display
          payload.bankAccountLast4 = formData.bankAccountNumber.slice(-4)
        }
      }

      const response = await fetch(`/api/employees/${employeeId}/payment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        setSuccess('Payment preferences saved successfully')
        loadEmployee() // Refresh data
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to save')
      }
    } catch (err) {
      setError('Failed to save payment preferences')
    } finally {
      setIsSaving(false)
    }
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-red-500">Employee not found</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/employees')}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold">Payment & Tax Preferences</h1>
            <p className="text-sm text-gray-500">
              {employee.displayName || `${employee.firstName} ${employee.lastName}`}
              {employee.hourlyRate && (
                <span className="ml-2">{formatCurrency(employee.hourlyRate)}/hr</span>
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Messages */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* YTD Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Year-to-Date Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">YTD Gross Earnings</p>
                <p className="text-2xl font-bold text-blue-600">
                  {formatCurrency(employee.ytdGrossEarnings || 0)}
                </p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">YTD Taxes Withheld</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatCurrency(employee.ytdTaxesWithheld || 0)}
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">YTD Net Pay</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(employee.ytdNetPay || 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
            <p className="text-sm text-gray-500">Required for tax documents (W-2, etc.)</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, address: e.target.value })
                }
                placeholder="123 Main St"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, city: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={formData.state}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, state: e.target.value })
                  }
                  placeholder="TX"
                  maxLength={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="zipCode">ZIP Code</Label>
                <Input
                  id="zipCode"
                  value={formData.zipCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, zipCode: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tax Information */}
        <Card>
          <CardHeader>
            <CardTitle>Tax Withholding (W-4)</CardTitle>
            <p className="text-sm text-gray-500">Federal and state tax withholding settings</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Federal */}
            <div className="space-y-4">
              <h4 className="font-medium text-gray-700">Federal Tax</h4>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="exemptFederal"
                  checked={formData.isExemptFromFederalTax}
                  onChange={(e) =>
                    setFormData({ ...formData, isExemptFromFederalTax: e.target.checked })
                  }
                  className="rounded"
                />
                <Label htmlFor="exemptFederal" className="font-normal">
                  Exempt from federal income tax withholding
                </Label>
              </div>

              {!formData.isExemptFromFederalTax && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="federalFilingStatus">Filing Status</Label>
                    <select
                      id="federalFilingStatus"
                      value={formData.federalFilingStatus}
                      onChange={(e) =>
                        setFormData({ ...formData, federalFilingStatus: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    >
                      <option value="single">Single</option>
                      <option value="married">Married Filing Jointly</option>
                      <option value="married_separate">Married Filing Separately</option>
                      <option value="head_of_household">Head of Household</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="federalAllowances">Allowances</Label>
                    <Input
                      id="federalAllowances"
                      type="number"
                      min="0"
                      value={formData.federalAllowances}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFormData({ ...formData, federalAllowances: e.target.value })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="additionalFederalWithholding">Additional Withholding</Label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                      <Input
                        id="additionalFederalWithholding"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.additionalFederalWithholding}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setFormData({ ...formData, additionalFederalWithholding: e.target.value })
                        }
                        className="pl-7"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* State */}
            <div className="space-y-4 pt-4 border-t">
              <h4 className="font-medium text-gray-700">State Tax</h4>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="exemptState"
                  checked={formData.isExemptFromStateTax}
                  onChange={(e) =>
                    setFormData({ ...formData, isExemptFromStateTax: e.target.checked })
                  }
                  className="rounded"
                />
                <Label htmlFor="exemptState" className="font-normal">
                  Exempt from state income tax withholding
                </Label>
              </div>

              {!formData.isExemptFromStateTax && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="stateFilingStatus">Filing Status</Label>
                    <select
                      id="stateFilingStatus"
                      value={formData.stateFilingStatus}
                      onChange={(e) =>
                        setFormData({ ...formData, stateFilingStatus: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    >
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="head_of_household">Head of Household</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="stateAllowances">Allowances</Label>
                    <Input
                      id="stateAllowances"
                      type="number"
                      min="0"
                      value={formData.stateAllowances}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFormData({ ...formData, stateAllowances: e.target.value })
                      }
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="additionalStateWithholding">Additional Withholding</Label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                      <Input
                        id="additionalStateWithholding"
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.additionalStateWithholding}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setFormData({ ...formData, additionalStateWithholding: e.target.value })
                        }
                        className="pl-7"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
            <p className="text-sm text-gray-500">How you receive your pay</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <select
                id="paymentMethod"
                value={formData.paymentMethod}
                onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              >
                <option value="check">Paper Check</option>
                <option value="direct_deposit">Direct Deposit</option>
                <option value="pay_card">Pay Card</option>
              </select>
            </div>

            {formData.paymentMethod === 'direct_deposit' && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <h4 className="font-medium text-gray-700">Bank Account Information</h4>
                {employee.bankAccountLast4 && (
                  <p className="text-sm text-gray-500">
                    Current account ending in: ****{employee.bankAccountLast4}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input
                      id="bankName"
                      value={formData.bankName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFormData({ ...formData, bankName: e.target.value })
                      }
                      placeholder="e.g., Chase Bank"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="bankAccountType">Account Type</Label>
                    <select
                      id="bankAccountType"
                      value={formData.bankAccountType}
                      onChange={(e) =>
                        setFormData({ ...formData, bankAccountType: e.target.value })
                      }
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                    >
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="bankRoutingNumber">
                      Routing Number
                      {employee.bankRoutingNumber && (
                        <span className="text-gray-400 text-xs ml-1">(leave blank to keep)</span>
                      )}
                    </Label>
                    <Input
                      id="bankRoutingNumber"
                      value={formData.bankRoutingNumber}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFormData({
                          ...formData,
                          bankRoutingNumber: e.target.value.replace(/\D/g, '').slice(0, 9),
                        })
                      }
                      placeholder="9 digits"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="bankAccountNumber">
                      Account Number
                      {employee.bankAccountLast4 && (
                        <span className="text-gray-400 text-xs ml-1">(leave blank to keep)</span>
                      )}
                    </Label>
                    <Input
                      id="bankAccountNumber"
                      type="password"
                      value={formData.bankAccountNumber}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFormData({
                          ...formData,
                          bankAccountNumber: e.target.value.replace(/\D/g, ''),
                        })
                      }
                      placeholder="Account number"
                      className="mt-1"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  Bank account information is securely stored and only used for direct deposit payments.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-4">
          <Button variant="ghost" onClick={() => router.push('/employees')}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      </div>
    </div>
  )
}
