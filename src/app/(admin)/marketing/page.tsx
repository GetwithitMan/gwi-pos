'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Campaign {
  id: string
  locationId: string
  name: string
  type: 'email' | 'sms'
  subject?: string
  body: string
  segment: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  scheduledFor?: string
  sentAt?: string
  createdBy?: string
  recipientCount: number
  deliveredCount: number
  openCount: number
  clickCount: number
  unsubscribeCount: number
  createdAt: string
  updatedAt: string
}

interface CampaignDetail extends Campaign {
  recipientStats: { status: string; count: number }[]
  recipients: {
    id: string
    customerId: string
    channel: string
    address: string
    status: string
    sentAt?: string
    deliveredAt?: string
    openedAt?: string
    errorMessage?: string
  }[]
}

interface CampaignAnalytics {
  campaign: { id: string; name: string; type: string; status: string; sentAt?: string }
  totals: { recipients: number; delivered: number; opened: number; clicked: number; unsubscribed: number }
  rates: { deliveryRate: number; openRate: number; clickRate: number; unsubscribeRate: number }
  statusBreakdown: { status: string; count: number }[]
  errors: { errorMessage: string; count: number }[]
}

const SEGMENTS = [
  { value: 'all', label: 'All Subscribers' },
  { value: 'vip', label: 'VIP Customers' },
  { value: 'new', label: 'New Customers (30 days)' },
  { value: 'inactive', label: 'Inactive (90+ days)' },
  { value: 'birthday', label: 'Birthday This Month' },
  { value: 'high_value', label: 'High Value (Top 20%)' },
]

const VARIABLE_HINTS = [
  '{{customer_name}} - Full name',
  '{{customer_first_name}} - First name',
  '{{location_name}} - Your business name',
  '{{unsubscribe_url}} - Unsubscribe link (auto-added for email)',
]

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/marketing' })

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null)
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null)
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false)

  const locationId = employee?.location?.id

  const loadCampaigns = useCallback(async () => {
    if (!locationId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      if (filter !== 'all') params.set('status', filter)
      const res = await fetch(`/api/marketing/campaigns?${params}`)
      const data = await res.json()
      setCampaigns(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load campaigns:', err)
    } finally {
      setIsLoading(false)
    }
  }, [locationId, filter])

  useEffect(() => {
    if (locationId) loadCampaigns()
  }, [locationId, loadCampaigns])

  async function handleViewDetail(campaignId: string) {
    if (!locationId) return
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaignId}?locationId=${locationId}`)
      const { data } = await res.json()
      setSelectedCampaign(data)
      setShowDetailModal(true)
    } catch (err) {
      console.error('Failed to load campaign detail:', err)
    }
  }

  async function handleViewAnalytics(campaignId: string) {
    if (!locationId) return
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaignId}/analytics?locationId=${locationId}`)
      const { data } = await res.json()
      setAnalytics(data)
      setShowAnalyticsModal(true)
    } catch (err) {
      console.error('Failed to load analytics:', err)
    }
  }

  async function handleSendCampaign(campaignId: string) {
    if (!locationId || !confirm('Are you sure you want to send this campaign now?')) return
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaignId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to send campaign')
        return
      }
      alert(`Campaign sending to ${data.data?.recipientCount || 0} recipients`)
      loadCampaigns()
    } catch (err) {
      console.error('Failed to send campaign:', err)
    }
  }

  async function handleDeleteCampaign(campaignId: string) {
    if (!locationId || !confirm('Cancel this campaign?')) return
    try {
      await fetch(`/api/marketing/campaigns/${campaignId}?locationId=${locationId}`, {
        method: 'DELETE',
      })
      loadCampaigns()
    } catch (err) {
      console.error('Failed to delete campaign:', err)
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────

  const activeCampaigns = campaigns.filter(c => ['draft', 'scheduled', 'sending'].includes(c.status)).length
  const totalRecipients = campaigns.reduce((sum, c) => sum + c.recipientCount, 0)
  const totalDelivered = campaigns.reduce((sum, c) => sum + c.deliveredCount, 0)
  const totalOpened = campaigns.reduce((sum, c) => sum + c.openCount, 0)
  const avgOpenRate = totalDelivered > 0 ? Math.round((totalOpened / totalDelivered) * 100) : 0

  const filteredCampaigns = filter === 'all'
    ? campaigns
    : campaigns.filter(c => c.status === filter)

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Loading campaigns...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Marketing Campaigns"
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            Create Campaign
          </Button>
        }
      />

      <main className="max-w-7xl mx-auto mt-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Active Campaigns</div>
            <div className="text-2xl font-bold">{activeCampaigns}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Total Recipients</div>
            <div className="text-2xl font-bold">{totalRecipients.toLocaleString()}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Total Delivered</div>
            <div className="text-2xl font-bold text-green-400">{totalDelivered.toLocaleString()}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-gray-400 text-sm">Avg Open Rate</div>
            <div className="text-2xl font-bold text-blue-400">{avgOpenRate}%</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {['all', 'draft', 'scheduled', 'sending', 'sent', 'cancelled'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg capitalize ${
                filter === f ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Campaign List */}
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="text-left p-4">Campaign</th>
                <th className="text-left p-4">Type</th>
                <th className="text-left p-4">Segment</th>
                <th className="text-left p-4">Status</th>
                <th className="text-left p-4">Recipients</th>
                <th className="text-left p-4">Performance</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map(campaign => (
                <tr key={campaign.id} className="border-t border-gray-700 hover:bg-gray-750">
                  <td className="p-4">
                    <div className="font-medium">{campaign.name}</div>
                    {campaign.subject && (
                      <div className="text-sm text-gray-400 truncate max-w-xs">{campaign.subject}</div>
                    )}
                    <div className="text-xs text-gray-500">
                      {new Date(campaign.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 text-xs rounded font-medium ${
                      campaign.type === 'email' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300'
                    }`}>
                      {campaign.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="text-sm capitalize">{campaign.segment.replace('_', ' ')}</span>
                  </td>
                  <td className="p-4">
                    <StatusBadge status={campaign.status} />
                    {campaign.scheduledFor && campaign.status === 'scheduled' && (
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(campaign.scheduledFor).toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-sm">
                    {campaign.recipientCount > 0 ? (
                      <div>
                        <div>{campaign.recipientCount.toLocaleString()} sent</div>
                        <div className="text-green-400">{campaign.deliveredCount.toLocaleString()} delivered</div>
                      </div>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="p-4 text-sm">
                    {campaign.status === 'sent' && campaign.deliveredCount > 0 ? (
                      <div>
                        <div>{Math.round((campaign.openCount / campaign.deliveredCount) * 100)}% opened</div>
                        <div>{Math.round((campaign.clickCount / campaign.deliveredCount) * 100)}% clicked</div>
                      </div>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="p-4 text-right space-x-2">
                    <button
                      onClick={() => handleViewDetail(campaign.id)}
                      className="px-3 py-1 text-sm bg-gray-700 rounded hover:bg-gray-600"
                    >
                      View
                    </button>
                    {campaign.status === 'sent' && (
                      <button
                        onClick={() => handleViewAnalytics(campaign.id)}
                        className="px-3 py-1 text-sm bg-indigo-600 rounded hover:bg-indigo-700"
                      >
                        Analytics
                      </button>
                    )}
                    {['draft', 'scheduled'].includes(campaign.status) && (
                      <button
                        onClick={() => handleSendCampaign(campaign.id)}
                        className="px-3 py-1 text-sm bg-green-600 rounded hover:bg-green-700"
                      >
                        Send Now
                      </button>
                    )}
                    {['draft', 'scheduled'].includes(campaign.status) && (
                      <button
                        onClick={() => handleDeleteCampaign(campaign.id)}
                        className="px-3 py-1 text-sm bg-red-600 rounded hover:bg-red-700"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredCampaigns.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-500">
                    No campaigns found. Create your first campaign to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Create Campaign Modal */}
      <CreateCampaignModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        locationId={locationId}
        onCreated={() => { setShowCreateModal(false); loadCampaigns() }}
      />

      {/* Campaign Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedCampaign(null) }}
        title={selectedCampaign?.name || 'Campaign Details'}
        size="lg"
      >
        {selectedCampaign && <CampaignDetailView campaign={selectedCampaign} />}
      </Modal>

      {/* Analytics Modal */}
      <Modal
        isOpen={showAnalyticsModal}
        onClose={() => { setShowAnalyticsModal(false); setAnalytics(null) }}
        title={analytics ? `Analytics: ${analytics.campaign.name}` : 'Campaign Analytics'}
        size="lg"
      >
        {analytics && <AnalyticsView analytics={analytics} />}
      </Modal>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-700 text-gray-300',
    scheduled: 'bg-yellow-900 text-yellow-300',
    sending: 'bg-blue-900 text-blue-300',
    sent: 'bg-green-900 text-green-300',
    cancelled: 'bg-red-900 text-red-300',
  }
  return (
    <span className={`px-2 py-1 text-xs rounded font-medium capitalize ${colors[status] || 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  )
}

function CreateCampaignModal({
  isOpen,
  onClose,
  locationId,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  locationId: string | undefined
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    name: '',
    type: 'email' as 'email' | 'sms',
    subject: '',
    bodyContent: '',
    segment: 'all',
    scheduledFor: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!locationId) return
    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          locationId,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create campaign')
        return
      }
      setForm({ name: '', type: 'email', subject: '', bodyContent: '', segment: 'all', scheduledFor: '' })
      onCreated()
    } catch (err) {
      setError('Failed to create campaign')
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Campaign" size="lg">
      {error && <div className="bg-red-900/50 text-red-300 p-3 rounded mb-4">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Campaign Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            placeholder="Summer Special Offer"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type *</label>
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value as 'email' | 'sms' })}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600"
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Target Audience *</label>
            <select
              value={form.segment}
              onChange={e => setForm({ ...form, segment: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600"
            >
              {SEGMENTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {form.type === 'email' && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">Subject Line</label>
            <input
              type="text"
              value={form.subject}
              onChange={e => setForm({ ...form, subject: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Check out our latest specials!"
            />
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            {form.type === 'email' ? 'Email Body (HTML supported)' : 'SMS Message'}
          </label>
          <textarea
            value={form.bodyContent}
            onChange={e => setForm({ ...form, bodyContent: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none font-mono text-sm"
            rows={form.type === 'email' ? 8 : 4}
            placeholder={form.type === 'email'
              ? '<h2>Hi {{customer_first_name}}!</h2>\n<p>We have exciting specials at {{location_name}}...</p>'
              : 'Hi {{customer_first_name}}! Visit {{location_name}} this week for 20% off.'
            }
          />
          <div className="mt-2 text-xs text-gray-500">
            <span className="font-medium">Available variables:</span>{' '}
            {VARIABLE_HINTS.map((h, i) => (
              <span key={i}>
                {i > 0 && ' | '}
                <code className="bg-gray-700 px-1 rounded">{h}</code>
              </span>
            ))}
          </div>
          {form.type === 'sms' && (
            <div className="mt-1 text-xs text-gray-500">
              {form.bodyContent.length}/130 chars (STOP instructions auto-appended)
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Schedule (leave blank to save as draft)</label>
          <input
            type="datetime-local"
            value={form.scheduledFor}
            onChange={e => setForm({ ...form, scheduledFor: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="flex-1 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {isSaving ? 'Creating...' : form.scheduledFor ? 'Schedule Campaign' : 'Save as Draft'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CampaignDetailView({ campaign }: { campaign: CampaignDetail }) {
  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold">{campaign.recipientCount}</div>
          <div className="text-xs text-gray-400">Recipients</div>
        </div>
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold text-green-400">{campaign.deliveredCount}</div>
          <div className="text-xs text-gray-400">Delivered</div>
        </div>
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{campaign.openCount}</div>
          <div className="text-xs text-gray-400">Opened</div>
        </div>
      </div>

      {/* Status Breakdown */}
      {campaign.recipientStats.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">Recipient Status</h3>
          <div className="flex flex-wrap gap-2">
            {campaign.recipientStats.map(s => (
              <span key={s.status} className="px-3 py-1 bg-gray-700 rounded text-sm capitalize">
                {s.status}: {s.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Content Preview */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2">Content</h3>
        <div className="bg-gray-700 rounded p-4">
          {campaign.type === 'email' && campaign.subject && (
            <div className="text-sm text-gray-400 mb-2">Subject: {campaign.subject}</div>
          )}
          <div className="text-sm whitespace-pre-wrap">{campaign.body}</div>
        </div>
      </div>

      {/* Recent Recipients */}
      {campaign.recipients.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-2">
            Recipients ({campaign.recipients.length})
          </h3>
          <div className="max-h-60 overflow-y-auto bg-gray-700 rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-600 sticky top-0">
                <tr>
                  <th className="text-left p-2">Address</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Sent</th>
                </tr>
              </thead>
              <tbody>
                {campaign.recipients.map(r => (
                  <tr key={r.id} className="border-t border-gray-600">
                    <td className="p-2 font-mono text-xs">{r.address}</td>
                    <td className="p-2 capitalize">{r.status}</td>
                    <td className="p-2 text-gray-400">
                      {r.sentAt ? new Date(r.sentAt).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AnalyticsView({ analytics }: { analytics: CampaignAnalytics }) {
  return (
    <div className="space-y-6">
      {/* Rate Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold text-green-400">{analytics.rates.deliveryRate}%</div>
          <div className="text-xs text-gray-400">Delivery Rate</div>
        </div>
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{analytics.rates.openRate}%</div>
          <div className="text-xs text-gray-400">Open Rate</div>
        </div>
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold text-purple-400">{analytics.rates.clickRate}%</div>
          <div className="text-xs text-gray-400">Click Rate</div>
        </div>
        <div className="bg-gray-700 rounded p-3 text-center">
          <div className="text-xl font-bold text-red-400">{analytics.rates.unsubscribeRate}%</div>
          <div className="text-xs text-gray-400">Unsubscribe Rate</div>
        </div>
      </div>

      {/* Totals */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2">Totals</h3>
        <div className="grid grid-cols-5 gap-3">
          {Object.entries(analytics.totals).map(([key, value]) => (
            <div key={key} className="bg-gray-700 rounded p-3 text-center">
              <div className="text-lg font-bold">{(value as number).toLocaleString()}</div>
              <div className="text-xs text-gray-400 capitalize">{key}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Status Breakdown */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2">Status Breakdown</h3>
        <div className="bg-gray-700 rounded p-4">
          {analytics.statusBreakdown.map(s => (
            <div key={s.status} className="flex justify-between py-1 border-b border-gray-600 last:border-0">
              <span className="capitalize">{s.status}</span>
              <span className="font-mono">{s.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Errors */}
      {analytics.errors.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-red-400 mb-2">Errors</h3>
          <div className="bg-gray-700 rounded p-4 space-y-2">
            {analytics.errors.map((e, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-red-300 truncate flex-1">{e.errorMessage}</span>
                <span className="text-gray-400 ml-3">{e.count}x</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
