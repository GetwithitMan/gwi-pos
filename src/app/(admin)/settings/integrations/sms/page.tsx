'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'

interface TwilioStatus {
  configured: boolean
  fromNumber: string | null
}

export default function SmsIntegrationPage() {
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
        body: JSON.stringify({ service: 'twilio' }),
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
          <p className="text-gray-500">Send SMS alerts and manager approval requests via Twilio.</p>
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
                <span><strong>Remote Void/Comp Approval</strong> -- Managers receive SMS when staff request void or comp approval. Reply YES to approve remotely.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Manager Alerts</strong> -- High-value tab alerts and threshold notifications sent via SMS.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">&#8226;</span>
                <span><strong>Walkout Recovery</strong> -- Notifications when walkout tabs are detected and retry attempts are scheduled.</span>
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
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </Button>
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
