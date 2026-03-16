'use client'

// ─── Leaflet Map Component ──────────────────────────────────────────────────
// Dynamic import target — never import at top level (SSR incompatible).
// Used by dispatch/page.tsx via next/dynamic with { ssr: false }.

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, Circle, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// ─── Fix default marker icons in webpack/Next.js ────────────────────────────
// Leaflet's default icon paths break under Next.js bundling. We override with
// CDN URLs that always resolve correctly.

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MapOrder {
  id: string
  lat: number
  lng: number
  customerName: string
  address: string
  status: 'pending' | 'preparing' | 'ready_for_pickup' | 'out_for_delivery' | 'delivered' | 'late'
  orderNumber?: number
  driverName?: string | null
  estimatedMinutes?: number
}

export interface MapDriver {
  id: string
  lat: number
  lng: number
  name: string
  initials: string
  status: 'available' | 'on_delivery' | 'returning'
  activeOrders: number
}

export interface MapZone {
  id: string
  name: string
  color: string
  type: 'radius' | 'polygon' | 'zipcode'
  // Radius zones
  centerLat?: number
  centerLng?: number
  radiusMiles?: number
  // Polygon zones
  polygon?: [number, number][]
}

export interface MapRoute {
  driverId: string
  color: string
  path: [number, number][]
}

interface DeliveryMapProps {
  center: [number, number]
  zoom?: number
  orders: MapOrder[]
  drivers: MapDriver[]
  zones: MapZone[]
  routes?: MapRoute[]
  onOrderClick?: (orderId: string) => void
  onDriverClick?: (driverId: string) => void
}

// ─── Status colors for order pins ───────────────────────────────────────────

const ORDER_PIN_COLORS: Record<MapOrder['status'], string> = {
  pending: '#9ca3af',     // gray
  preparing: '#eab308',   // yellow
  ready_for_pickup: '#22c55e', // green
  out_for_delivery: '#3b82f6', // blue
  delivered: '#6b7280',   // muted gray
  late: '#ef4444',        // red
}

// ─── Custom icon factory ────────────────────────────────────────────────────

function createOrderIcon(status: MapOrder['status']): L.DivIcon {
  const color = ORDER_PIN_COLORS[status]
  return L.divIcon({
    className: 'delivery-map-order-pin',
    html: `<div style="
      width: 14px; height: 14px; border-radius: 50%;
      background: ${color}; border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

function createDriverIcon(initials: string, status: MapDriver['status']): L.DivIcon {
  const bg = status === 'on_delivery' ? '#7c3aed' : status === 'returning' ? '#f59e0b' : '#22c55e'
  return L.divIcon({
    className: 'delivery-map-driver-pin',
    html: `<div style="
      width: 32px; height: 32px; border-radius: 50%;
      background: ${bg}; border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 11px; font-weight: 700;
      letter-spacing: -0.5px;
    ">${initials}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

// ─── Auto-fit bounds helper ─────────────────────────────────────────────────

function FitBounds({ orders, drivers }: { orders: MapOrder[]; drivers: MapDriver[] }) {
  const map = useMap()

  useEffect(() => {
    const points: L.LatLngExpression[] = [
      ...orders.map(o => [o.lat, o.lng] as [number, number]),
      ...drivers.map(d => [d.lat, d.lng] as [number, number]),
    ]
    if (points.length > 1) {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }
  }, [map, orders.length, drivers.length]) // Only refit when counts change

  return null
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeliveryMap({
  center,
  zoom = 13,
  orders,
  drivers,
  zones,
  routes = [],
  onOrderClick,
  onDriverClick,
}: DeliveryMapProps) {
  // Memoize icons to avoid re-creating on every render
  const orderIcons = useMemo(() => {
    const map = new Map<string, L.DivIcon>()
    for (const o of orders) {
      if (!map.has(o.status)) {
        map.set(o.status, createOrderIcon(o.status))
      }
    }
    return map
  }, [orders])

  const driverIcons = useMemo(() => {
    return new Map(drivers.map(d => [d.id, createDriverIcon(d.initials, d.status)]))
  }, [drivers])

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="w-full h-full rounded-lg"
      style={{ minHeight: '400px' }}
      zoomControl={true}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds orders={orders} drivers={drivers} />

      {/* Zone overlays */}
      {zones.map(zone => {
        if (zone.type === 'radius' && zone.centerLat && zone.centerLng && zone.radiusMiles) {
          return (
            <Circle
              key={zone.id}
              center={[zone.centerLat, zone.centerLng]}
              radius={zone.radiusMiles * 1609.34} // miles to meters
              pathOptions={{
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: 0.08,
                weight: 2,
                dashArray: '6 4',
              }}
            >
              <Popup>
                <div className="text-sm font-medium">{zone.name}</div>
              </Popup>
            </Circle>
          )
        }
        if (zone.type === 'polygon' && zone.polygon && zone.polygon.length >= 3) {
          return (
            <Polygon
              key={zone.id}
              positions={zone.polygon}
              pathOptions={{
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: 0.08,
                weight: 2,
              }}
            >
              <Popup>
                <div className="text-sm font-medium">{zone.name}</div>
              </Popup>
            </Polygon>
          )
        }
        return null
      })}

      {/* Route polylines */}
      {routes.map(route => (
        <Polyline
          key={route.driverId}
          positions={route.path}
          pathOptions={{
            color: route.color,
            weight: 3,
            opacity: 0.7,
            dashArray: '8 6',
          }}
        />
      ))}

      {/* Order markers */}
      {orders.map(order => (
        <Marker
          key={order.id}
          position={[order.lat, order.lng]}
          icon={orderIcons.get(order.status) || createOrderIcon(order.status)}
          eventHandlers={onOrderClick ? {
            click: () => onOrderClick(order.id),
          } : undefined}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{order.customerName}</div>
              {order.orderNumber && <div className="text-gray-500">#{order.orderNumber}</div>}
              <div className="text-gray-600 text-xs mt-0.5">{order.address}</div>
              <div className="text-xs mt-1 capitalize">{order.status.replace(/_/g, ' ')}</div>
              {order.driverName && <div className="text-xs text-purple-600">Driver: {order.driverName}</div>}
              {order.estimatedMinutes != null && (
                <div className="text-xs text-gray-500">ETA: {order.estimatedMinutes}min</div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Driver markers */}
      {drivers.map(driver => (
        <Marker
          key={driver.id}
          position={[driver.lat, driver.lng]}
          icon={driverIcons.get(driver.id) || createDriverIcon(driver.initials, driver.status)}
          eventHandlers={onDriverClick ? {
            click: () => onDriverClick(driver.id),
          } : undefined}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-semibold">{driver.name}</div>
              <div className="text-xs capitalize">{driver.status.replace(/_/g, ' ')}</div>
              <div className="text-xs text-gray-500">{driver.activeOrders} active order{driver.activeOrders !== 1 ? 's' : ''}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
