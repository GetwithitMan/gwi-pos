'use client'

/**
 * TrackingMap — Lightweight Leaflet + OpenStreetMap map for customer delivery tracking.
 *
 * Dynamic import only (no SSR). Loads Leaflet JS + CSS from CDN on first mount.
 * Shows up to 3 markers: restaurant, customer address, driver (if visible).
 * Auto-fits bounds to show all markers. Supports pinch zoom on mobile.
 */

import { useEffect, useRef, useState } from 'react'

// ── Types ───────────────────────────────────────────────────────────────────

export interface MapMarker {
  lat: number
  lng: number
  type: 'restaurant' | 'customer' | 'driver'
  label?: string
}

interface TrackingMapProps {
  markers: MapMarker[]
  className?: string
}

// ── Leaflet CDN URLs ────────────────────────────────────────────────────────

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'

// ── Marker SVG icons (inline to avoid extra requests) ───────────────────────

function createSvgIcon(color: string, inner: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 48" width="36" height="48">
      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="${color}" stroke="#fff" stroke-width="2"/>
      ${inner}
    </svg>`
  )}`
}

const MARKER_ICONS: Record<MapMarker['type'], { url: string; label: string }> = {
  restaurant: {
    url: createSvgIcon('#EF4444', '<text x="18" y="24" text-anchor="middle" font-size="16" fill="white">R</text>'),
    label: 'Restaurant',
  },
  customer: {
    url: createSvgIcon('#3B82F6', '<text x="18" y="24" text-anchor="middle" font-size="16" fill="white">C</text>'),
    label: 'Delivery Address',
  },
  driver: {
    url: createSvgIcon('#10B981', '<text x="18" y="24" text-anchor="middle" font-size="16" fill="white">D</text>'),
    label: 'Driver',
  },
}

// ── Leaflet loader ──────────────────────────────────────────────────────────

let leafletLoaded = false
let leafletLoadPromise: Promise<void> | null = null

function loadLeaflet(): Promise<void> {
  if (leafletLoaded) return Promise.resolve()
  if (leafletLoadPromise) return leafletLoadPromise

  leafletLoadPromise = new Promise<void>((resolve, reject) => {
    // Load CSS
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = LEAFLET_CSS
      document.head.appendChild(link)
    }

    // Load JS
    if ((window as any).L) {
      leafletLoaded = true
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = LEAFLET_JS
    script.async = true
    script.onload = () => {
      leafletLoaded = true
      resolve()
    }
    script.onerror = () => reject(new Error('Failed to load Leaflet'))
    document.head.appendChild(script)
  })

  return leafletLoadPromise
}

// ── Component ───────────────────────────────────────────────────────────────

export default function TrackingMap({ markers, className = '' }: TrackingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerLayerRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Initialize map
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        await loadLeaflet()
        if (cancelled || !containerRef.current) return

        const L = (window as any).L
        if (!L) return

        // Default center: US center if no markers
        const defaultCenter: [number, number] = [39.8283, -98.5795]
        const defaultZoom = 4

        const map = L.map(containerRef.current, {
          center: defaultCenter,
          zoom: defaultZoom,
          zoomControl: false,
          attributionControl: false,
          scrollWheelZoom: true,
          touchZoom: true,
          doubleClickZoom: true,
          dragging: true,
        })

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map)

        // Small attribution in bottom-right
        L.control.attribution({
          position: 'bottomright',
          prefix: false,
        }).addTo(map).addAttribution('OpenStreetMap')

        mapRef.current = map
        markerLayerRef.current = L.layerGroup().addTo(map)

        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.error('[TrackingMap] Init error:', err)
          setError('Map unavailable')
          setLoading(false)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !markerLayerRef.current) return

    const L = (window as any).L
    if (!L) return

    // Clear existing markers
    markerLayerRef.current.clearLayers()

    if (markers.length === 0) return

    const bounds: [number, number][] = []

    for (const m of markers) {
      const iconConfig = MARKER_ICONS[m.type]
      const icon = L.icon({
        iconUrl: iconConfig.url,
        iconSize: [30, 40],
        iconAnchor: [15, 40],
        popupAnchor: [0, -42],
      })

      const marker = L.marker([m.lat, m.lng], { icon })
      marker.bindPopup(
        `<div style="font-size:13px;font-weight:500;color:#1f2937;">${m.label || iconConfig.label}</div>`,
        { closeButton: false, offset: [0, -2] },
      )
      markerLayerRef.current.addLayer(marker)
      bounds.push([m.lat, m.lng])
    }

    // Fit bounds with padding
    if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], 15, { animate: true })
    } else {
      mapRef.current.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 16,
        animate: true,
      })
    }
  }, [markers])

  if (error) {
    return (
      <div className={`bg-gray-800 flex items-center justify-center ${className}`}>
        <p className="text-gray-400 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-10 bg-gray-900 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Loading map...</p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
