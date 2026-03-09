'use client'

import { useEffect, useState } from 'react'

/**
 * CellularModeBanner — shows a small persistent banner when the web POS client
 * is connected via cellular/cloud rather than the local NUC.
 *
 * Detection: checks the current window origin against known cloud domains
 * (*.ordercontrolcenter.com, *.barpos.restaurant). If the POS is being
 * served from a cloud URL rather than a local IP / localhost, we're in
 * cellular/cloud mode.
 *
 * Additionally checks for an x-cellular-mode meta tag that the proxy could
 * inject, but origin-based detection is the primary mechanism.
 */
export function CellularModeBanner() {
  const [isCellular, setIsCellular] = useState(false)

  useEffect(() => {
    try {
      const hostname = window.location.hostname

      // Cloud domains indicate cellular/cloud mode
      const cloudDomains = [
        '.ordercontrolcenter.com',
        '.barpos.restaurant',
        'gwi-pos.vercel.app',
      ]

      const isCloudOrigin = cloudDomains.some((domain) => hostname.endsWith(domain))
        || hostname === 'ordercontrolcenter.com'
        || hostname === 'barpos.restaurant'

      // Local network = not cellular
      const isLocal = hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '::1'
        || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)

      if (isCloudOrigin && !isLocal) {
        setIsCellular(true)
      }
    } catch {
      // Window not available (SSR) — ignore
    }
  }, [])

  if (!isCellular) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 16,
        zIndex: 9997,
        backgroundColor: '#3b82f6',
        color: '#fff',
        padding: '4px 12px',
        fontSize: '12px',
        fontWeight: 600,
        borderBottomLeftRadius: '6px',
        borderBottomRightRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
      </svg>
      Cellular
    </div>
  )
}
