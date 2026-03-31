/**
 * Geo Validation Helpers for Online Ordering
 *
 * Haversine distance calculation and point-in-polygon testing
 * for delivery zone matching (radius, polygon, and zipcode zones).
 */

const EARTH_RADIUS_MILES = 3959

/** Haversine distance between two lat/lng points in miles. */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Ray casting point-in-polygon test.
 * `polygon` is an array of [lng, lat] coordinate pairs (GeoJSON convention).
 */
export function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1] // lat
    const yi = polygon[i][0] // lng
    const xj = polygon[j][1] // lat
    const yj = polygon[j][0] // lng
    const intersect =
      ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Extract the outer ring of coordinates from a GeoJSON polygon.
 * Supports both Polygon and the first polygon of a MultiPolygon.
 */
export function getPolygonRing(polygonJson: any): number[][] | null {
  if (!polygonJson || !polygonJson.type || !polygonJson.coordinates) return null
  if (polygonJson.type === 'Polygon') return polygonJson.coordinates[0] ?? null
  if (polygonJson.type === 'MultiPolygon') return polygonJson.coordinates[0]?.[0] ?? null
  return null
}

// ─── Zone Matching ───────────────────────────────────────────────────────────

export interface DeliveryZoneRow {
  id: string
  deliveryFee: unknown
  minimumOrder: unknown
  estimatedMinutes: number | null
  zipCodes: unknown
  zoneType: string
  centerLat: unknown
  centerLng: unknown
  radiusMiles: unknown
  polygonJson: unknown
}

export interface MatchedZone {
  id: string
  deliveryFee: number
  minimumOrder: number
  estimatedMinutes: number | null
}

/**
 * Match a customer's delivery location against active delivery zones.
 * Zones are evaluated in sortOrder; first match wins.
 * Priority: ZIP match, then radius, then polygon.
 */
export function matchDeliveryZone(
  zones: DeliveryZoneRow[],
  customerZip: string,
  deliveryLat: number | null,
  deliveryLng: number | null,
): MatchedZone | null {
  const hasCoords = deliveryLat != null && deliveryLng != null

  for (const zone of zones) {
    // Zipcode match
    if (zone.zoneType === 'zipcode' && customerZip) {
      const zoneZips = Array.isArray(zone.zipCodes) ? zone.zipCodes : []
      if (zoneZips.includes(customerZip)) {
        return {
          id: zone.id,
          deliveryFee: Number(zone.deliveryFee),
          minimumOrder: Number(zone.minimumOrder),
          estimatedMinutes: zone.estimatedMinutes,
        }
      }
    }

    // Radius match (requires lat/lng from client)
    if (zone.zoneType === 'radius' && hasCoords
        && zone.centerLat != null && zone.centerLng != null && zone.radiusMiles != null) {
      const centerLat = Number(zone.centerLat)
      const centerLng = Number(zone.centerLng)
      const radiusMiles = Number(zone.radiusMiles)
      const distance = haversineDistance(deliveryLat!, deliveryLng!, centerLat, centerLng)
      if (distance <= radiusMiles) {
        return {
          id: zone.id,
          deliveryFee: Number(zone.deliveryFee),
          minimumOrder: Number(zone.minimumOrder),
          estimatedMinutes: zone.estimatedMinutes,
        }
      }
    }

    // Polygon match (requires lat/lng from client)
    if (zone.zoneType === 'polygon' && hasCoords && zone.polygonJson) {
      const ring = getPolygonRing(zone.polygonJson)
      if (ring && pointInPolygon(deliveryLat!, deliveryLng!, ring)) {
        return {
          id: zone.id,
          deliveryFee: Number(zone.deliveryFee),
          minimumOrder: Number(zone.minimumOrder),
          estimatedMinutes: zone.estimatedMinutes,
        }
      }
    }
  }

  return null
}
