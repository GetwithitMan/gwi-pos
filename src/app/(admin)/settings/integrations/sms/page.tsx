'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

interface TwilioConfig {
  configured: boolean
  accountSid?: string
  fromNumber?: string
}

export default function SmsIntegrationPage() {
  const employeeId = useAuthStore(s => s.employee?.id)
  const [config, setConfig] = useState<TwilioConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [removing, setRemoving] = useState(false)

  // Form fields
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [fromNumber, setFromNumber] = useState('')

  useEffect(() => {
    fetch('/api/integrations/twilio')
      .then(res => res.json())
      .then(data => {
        setConfig(data.data)
        if (data.data?.fromNumber) {
          setFromNumber(data.data.fromNumber)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!accountSid || !authToken || !fromNumber) {
      toast.error('All three fields are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/integrations/twilio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountSid, authToken, fromNumber }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to save')
        return
      }
      toast.success('Twilio credentials saved')
      setConfig({ configured: true, accountSid: `***${accountSid.slice(-4)}`, fromNumber: data.data.fromNumber })
      setAccountSid('')
      setAuthToken('')
      setFromNumber(data.data.fromNumber)
    } catch {
      toast.error('Failed to save credentials')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'twilio', employeeId }),
      })
      const data = await res.json()
      if (data.data?.success) {
        toast.success(data.data.message)
      } else {
        toast.error(data.data?.message || 'Test failed')
      }
    } catch {
      toast.error('Failed to test connection')
    } finally {
      setTesting(false)
    }
  }

  async function handleRemove() {
    if (!confirm('Remove Twilio credentials? SMS features will stop working.')) return
    setRemoving(true)
    try {
      await fetch('/api/integrations/twilio', { method: 'DELETE' })
      toast.success('Twilio credentials removed')
      setConfig({ configured: false })
      setAccountSid('')
      setAuthToken('')
      setFromNumber('')
    } catch {
      toast.error('Failed to remove credentials')
    } finally {
      setRemoving(false)
    }
  }

  const configured = config?.configured ?? false

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">SMS Integration (Twilio)</h1>
          <p className="text-gray-600">Connect your Twilio account to enable text message alerts, manager approvals, and customer notifications.</p>
        </div>
        {!loading && (
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            configured ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}>
            {configured ? 'Connected' : 'Not Configured'}
          </span>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>What This Integration Does</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Remote Void/Comp Approval</strong> — Text a manager when a server requests to void or comp an item. Manager approves or denies by text.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>High-Value Tab Alerts</strong> — Alert when a tab exceeds a dollar threshold.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Walkout Detection</strong> — Alert when a tab is flagged as a walkout.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Customer Receipts & Notifications</strong> — Text receipts, delivery updates, and reservation confirmations.</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Credentials Form */}
        <Card>
          <CardHeader>
            <CardTitle>{configured ? 'Update Credentials' : 'Connect Your Twilio Account'}</CardTitle>
          </CardHeader>
          <CardContent>
            {configured && (
              <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                Connected — SID ending in <strong>{config?.accountSid?.slice(-4)}</strong>, sending from <strong>{config?.fromNumber}</strong>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account SID</label>
                <input
                  type="text"
                  value={accountSid}
                  onChange={e => setAccountSid(e.target.value)}
                  placeholder={configured ? 'Enter new SID to update' : 'AC...'}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Found on your Twilio Console dashboard. Starts with &quot;AC&quot;.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Auth Token</label>
                <input
                  type="password"
                  value={authToken}
                  onChange={e => setAuthToken(e.target.value)}
                  placeholder={configured ? 'Enter new token to update' : 'Your auth token'}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Found on your Twilio Console dashboard. Keep this secret.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Phone Number</label>
                <input
                  type="tel"
                  value={fromNumber}
                  onChange={e => setFromNumber(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Your Twilio phone number that messages will be sent from.</p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving || (!accountSid && !authToken)}
                >
                  {saving ? 'Saving...' : configured ? 'Update Credentials' : 'Save & Connect'}
                </Button>

                {configured && (
                  <>
                    <Button
                      onClick={handleTest}
                      disabled={testing}
                      variant="outline"
                    >
                      {testing ? 'Testing...' : 'Test Connection'}
                    </Button>

                    <Button
                      onClick={handleRemove}
                      disabled={removing}
                      variant="outline"
                      className="text-red-600 border-red-300 hover:bg-red-50"
                    >
                      {removing ? 'Removing...' : 'Disconnect'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Setup Help */}
        <Card>
          <CardHeader>
            <CardTitle>How to Get Your Twilio Credentials</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm text-gray-600 list-decimal list-inside">
              <li>Go to <strong>twilio.com</strong> and create a free account (or log in)</li>
              <li>From the <strong>Console Dashboard</strong>, copy your <strong>Account SID</strong> and <strong>Auth Token</strong></li>
              <li>Go to <strong>Phone Numbers</strong> and buy a number (or use an existing one)</li>
              <li>Paste all three values above and click <strong>Save &amp; Connect</strong></li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
