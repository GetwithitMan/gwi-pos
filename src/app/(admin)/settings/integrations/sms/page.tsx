'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

interface TwilioStatus {
  configured: boolean
  fromNumber: string | null
}

export default function SmsIntegrationPage() {
  const employeeId = useAuthStore(s => s.employee?.id)
  const [status, setStatus] = useState<TwilioStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/integrations/status')
      .then(res => res.json())
      .then(data => {
        setStatus(data.twilio)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [])

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'twilio', employeeId }),
      })
      const data = await res.json()
      if (data.data.success) {
        toast.success(data.data.message)
      } else {
        toast.error(data.data.message)
      }
    } catch {
      toast.error('Failed to test connection')
    } finally {
      setTesting(false)
    }
  }

  const configured = status?.configured ?? false

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">SMS Integration (Twilio)</h1>
          <p className="text-gray-500">Connect a Twilio SMS account to enable text message alerts and manager approvals. Twilio is a third-party messaging service — you need a Twilio account to use this feature.</p>
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
                <span><strong>Remote Void/Comp Approval</strong> — Send a text message to the manager when a server requests to void or comp (give away for free) an item. Manager approves or denies by text.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>High-Value Tab Alerts</strong> — Send a text message alert when a tab exceeds the configured dollar threshold. Helps managers catch unusually large or suspicious orders.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Walkout Tab Detection</strong> — Send a text message when a tab is flagged as a walkout (customer left without paying).</span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <span className={`text-sm font-medium ${configured ? 'text-green-700' : 'text-yellow-700'}`}>
                  {loading ? 'Checking...' : configured ? 'Credentials configured' : 'Not configured'}
                </span>
              </div>
              {status?.fromNumber && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">From Number</span>
                  <span className="text-sm font-mono text-gray-800">{status.fromNumber}</span>
                </div>
              )}
              <div className="pt-2">
                <Button
                  onClick={handleTest}
                  disabled={!configured || testing}
                  variant="outline"
                  size="sm"
                  title={!configured ? 'Configure your Twilio credentials in your server settings first, then test the connection here.' : 'Test the Twilio SMS connection'}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </Button>
                {!configured && (
                  <p className="text-xs text-gray-600 mt-1">Configure your Twilio credentials in your server settings first.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Setup Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm text-gray-600 list-decimal list-inside">
              <li>Create a Twilio account at <strong>twilio.com</strong></li>
              <li>Get your Account SID, Auth Token, and purchase a phone number</li>
              <li>Add the following to your <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">.env.local</code> file:</li>
            </ol>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto mt-3">
{`TWILIO_ACCOUNT_SID=your_sid_here
TWILIO_AUTH_TOKEN=your_token_here
TWILIO_FROM_NUMBER=+1234567890`}
            </pre>
            <p className="text-sm text-gray-500 mt-3">4. Restart the POS server for changes to take effect.</p>
            <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              These credentials are set in your venue&apos;s server configuration. Ask your IT person or our support team to update them — you don&apos;t need to make changes yourself.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
