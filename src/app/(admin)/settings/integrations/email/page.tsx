'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'

interface ResendStatus {
  configured: boolean
}

export default function EmailIntegrationPage() {
  const [status, setStatus] = useState<ResendStatus | null>(null)
  const [testing, setTesting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/integrations/status')
      .then(res => res.json())
      .then(data => {
        setStatus(data.resend)
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
        body: JSON.stringify({ service: 'resend' }),
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
          <h1 className="text-2xl font-bold mb-1">Email Integration (Resend)</h1>
          <p className="text-gray-500">Send transactional emails and reports via Resend.</p>
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
                <span><strong>Error Alert Emails</strong> -- Critical system errors are emailed to the configured admin address for fast response.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-400 mt-0.5">&#8226;</span>
                <span><strong>Automated Report Delivery</strong> -- Daily store reports and sales summaries delivered by email. <em className="text-gray-400">(Coming soon)</em></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gray-400 mt-0.5">&#8226;</span>
                <span><strong>Digital Receipt Emails</strong> -- Email receipts to customers after payment. <em className="text-gray-400">(Coming soon)</em></span>
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
                  {loading ? 'Checking...' : configured ? 'API key configured' : 'Not configured'}
                </span>
              </div>
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
              <li>Create a Resend account at <strong>resend.com</strong></li>
              <li>Generate an API key from the dashboard</li>
              <li>Add the following to your <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">.env.local</code> file:</li>
            </ol>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto mt-3">
{`RESEND_API_KEY=re_your_key_here`}
            </pre>
            <p className="text-sm text-gray-500 mt-3">4. Restart the POS server for changes to take effect.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
