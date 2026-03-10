'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

// ─── Types ──────────────────────────────────────────────────────────────────

interface PrinterStatus {
  id: string
  name: string
  ipAddress: string
  port: number
  role: string
  status: 'online' | 'warning' | 'error' | 'offline'
  lastPingOk: boolean
  lastPingAt: string | null
  pendingCount: number
  failedCount: number
  failedPermanentCount: number
}

interface FailedJob {
  id: string
  jobType: string
  status: string
  retryCount: number
  errorMessage: string | null
  hasContent: boolean
  createdAt: string
  orderId: string | null
  orderNumber: number | null
  printerName: string
  printerId: string | null
}

interface PrintStatusData {
  health: 'ok' | 'error'
  printers: PrinterStatus[]
  jobs: FailedJob[]
  totalFailed: number
  totalPending: number
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PrinterStatusIndicator() {
  const locationId = useAuthStore(s => s.employee?.location?.id)
  const [data, setData] = useState<PrintStatusData | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Fetch printer status from API
  const fetchStatus = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/print/failed-jobs?locationId=${locationId}`)
      if (res.ok) {
        const json = await res.json()
        setData(json.data)
      }
    } catch {
      // Silent — network error during poll
    }
  }, [locationId])

  // Initial fetch + polling every 30s
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Subscribe to socket events for real-time updates
  useEffect(() => {
    if (!locationId) return

    const socket = getSharedSocket()

    const onPrintJobFailed = () => {
      // Re-fetch when a print failure event arrives
      fetchStatus()
    }

    socket.on('print:job-failed', onPrintJobFailed)

    return () => {
      socket.off('print:job-failed', onPrintJobFailed)
      releaseSharedSocket()
    }
  }, [locationId, fetchStatus])

  // Click-outside to close modal
  useEffect(() => {
    if (!showModal) return
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowModal(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModal])

  // Retry all failed jobs
  const handleRetryAll = async () => {
    if (!locationId || retrying) return
    setRetrying(true)
    try {
      await fetch('/api/print/failed-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId }),
      })
      await fetchStatus()
    } catch {
      // Silent
    } finally {
      setRetrying(false)
    }
  }

  // Retry a single job
  const handleRetryJob = async (jobId: string) => {
    if (!locationId || retryingJobId) return
    setRetryingJobId(jobId)
    try {
      await fetch('/api/print/failed-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, jobIds: [jobId] }),
      })
      await fetchStatus()
    } catch {
      // Silent
    } finally {
      setRetryingJobId(null)
    }
  }

  // Clear permanently failed jobs
  const handleClearFailed = async () => {
    if (!locationId) return
    try {
      await fetch(`/api/print/failed-jobs?locationId=${locationId}`, { method: 'DELETE' })
      await fetchStatus()
    } catch {
      // Silent
    }
  }

  // Don't render if no data or no issues
  if (!data) return null
  const hasIssues = data.health === 'error' || data.totalFailed > 0 || data.totalPending > 0

  // Determine dot color
  const dotColor = data.health === 'error'
    ? '#ef4444' // red
    : data.totalPending > 0
      ? '#f59e0b' // amber
      : '#22c55e' // green

  return (
    <>
      {/* ── Status Dot ── */}
      <button
        onClick={() => setShowModal(!showModal)}
        title={hasIssues ? `${data.totalFailed} failed, ${data.totalPending} pending print jobs` : 'All printers OK'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          height: '30px',
          padding: '0 8px',
          background: hasIssues ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
          border: hasIssues ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid transparent',
          borderRadius: '6px',
          cursor: 'pointer',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {/* Printer icon */}
        <svg width="14" height="14" fill="none" stroke={hasIssues ? '#f87171' : '#64748b'} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
        </svg>
        {/* Status dot */}
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: dotColor,
          boxShadow: hasIssues ? `0 0 6px ${dotColor}` : 'none',
          animation: data.health === 'error' ? 'printer-pulse 2s ease-in-out infinite' : 'none',
        }} />
        {data.totalFailed > 0 && (
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#f87171',
            lineHeight: '1',
          }}>
            {data.totalFailed}
          </span>
        )}
      </button>

      {/* ── Modal Overlay ── */}
      {showModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '60px',
          background: 'rgba(0, 0, 0, 0.5)',
        }}>
          <div
            ref={modalRef}
            style={{
              width: '560px',
              maxHeight: 'calc(100vh - 120px)',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              boxShadow: '0 25px 50px rgba(0, 0, 0, 0.8)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="18" height="18" fill="none" stroke="#e2e8f0" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4H7v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span style={{ fontSize: '15px', fontWeight: 600, color: '#f1f5f9' }}>Printer Status</span>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: '4px' }}
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable content */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
              {/* ── Printer List ── */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                  Printers
                </div>
                {data.printers.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: '13px', padding: '8px 0' }}>No printers configured</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {data.printers.map(printer => (
                      <div key={printer.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: '8px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: printer.status === 'online' ? '#22c55e' :
                              printer.status === 'warning' ? '#f59e0b' :
                              printer.status === 'error' ? '#ef4444' : '#6b7280',
                          }} />
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0' }}>{printer.name}</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{printer.ipAddress}:{printer.port} - {printer.role}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {printer.failedCount > 0 && (
                            <span style={{
                              fontSize: '11px', fontWeight: 600, color: '#f87171',
                              background: 'rgba(239, 68, 68, 0.15)', padding: '2px 6px', borderRadius: '4px',
                            }}>
                              {printer.failedCount} failed
                            </span>
                          )}
                          {printer.failedPermanentCount > 0 && (
                            <span style={{
                              fontSize: '11px', fontWeight: 600, color: '#fb923c',
                              background: 'rgba(251, 146, 60, 0.15)', padding: '2px 6px', borderRadius: '4px',
                            }}>
                              {printer.failedPermanentCount} perm
                            </span>
                          )}
                          {printer.pendingCount > 0 && (
                            <span style={{
                              fontSize: '11px', fontWeight: 600, color: '#fbbf24',
                              background: 'rgba(251, 191, 36, 0.15)', padding: '2px 6px', borderRadius: '4px',
                            }}>
                              {printer.pendingCount} queued
                            </span>
                          )}
                          {printer.status === 'online' && printer.failedCount === 0 && printer.pendingCount === 0 && (
                            <span style={{ fontSize: '11px', color: '#22c55e' }}>OK</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Failed Jobs ── */}
              {data.jobs.length > 0 && (
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '10px',
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Failed Jobs ({data.jobs.length})
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {data.totalFailed > 0 && (
                        <button
                          onClick={handleClearFailed}
                          style={{
                            fontSize: '11px', fontWeight: 500, color: '#64748b',
                            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '5px', padding: '4px 10px', cursor: 'pointer',
                          }}
                        >
                          Clear Permanent
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {data.jobs.map(job => (
                      <div key={job.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: job.status === 'failed_permanent' ? 'rgba(239, 68, 68, 0.06)' : 'rgba(251, 191, 36, 0.04)',
                        border: `1px solid ${job.status === 'failed_permanent' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.06)'}`,
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              fontWeight: 600,
                              color: job.status === 'failed_permanent' ? '#f87171' : '#fbbf24',
                            }}>
                              {job.status === 'failed_permanent' ? 'FAILED' : job.status === 'queued' ? 'QUEUED' : 'RETRY'}
                            </span>
                            {job.orderNumber && (
                              <span style={{ color: '#94a3b8' }}>Order #{job.orderNumber}</span>
                            )}
                            <span style={{ color: '#64748b' }}>{job.printerName}</span>
                          </div>
                          {job.errorMessage && (
                            <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {job.errorMessage}
                            </div>
                          )}
                        </div>
                        {job.hasContent && job.status !== 'queued' && (
                          <button
                            onClick={() => handleRetryJob(job.id)}
                            disabled={retryingJobId === job.id}
                            style={{
                              fontSize: '11px', fontWeight: 600,
                              color: retryingJobId === job.id ? '#64748b' : '#60a5fa',
                              background: 'rgba(96, 165, 250, 0.1)',
                              border: '1px solid rgba(96, 165, 250, 0.2)',
                              borderRadius: '5px', padding: '3px 8px',
                              cursor: retryingJobId === job.id ? 'not-allowed' : 'pointer',
                              flexShrink: 0, marginLeft: '8px',
                            }}
                          >
                            {retryingJobId === job.id ? 'Retrying...' : 'Retry'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.jobs.length === 0 && data.printers.length > 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: '13px' }}>
                  No failed print jobs
                </div>
              )}
            </div>

            {/* Footer with actions */}
            {data.jobs.length > 0 && (
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
              }}>
                <button
                  onClick={handleRetryAll}
                  disabled={retrying || data.totalPending === 0 && data.totalFailed === 0}
                  style={{
                    fontSize: '13px', fontWeight: 600,
                    color: retrying ? '#64748b' : '#f1f5f9',
                    background: retrying ? 'rgba(255, 255, 255, 0.05)' : 'rgba(99, 102, 241, 0.2)',
                    border: `1px solid ${retrying ? 'rgba(255, 255, 255, 0.1)' : 'rgba(99, 102, 241, 0.4)'}`,
                    borderRadius: '6px',
                    padding: '8px 16px',
                    cursor: retrying ? 'not-allowed' : 'pointer',
                  }}
                >
                  {retrying ? 'Retrying...' : 'Retry All Failed'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes printer-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  )
}
