import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'

const RETENTION_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  '60days': 60,
  '90days': 90,
}

export function useDataRetention() {
  const employee = useAuthStore(s => s.employee)
  const [retentionDays, setRetentionDays] = useState(30)
  const [venueSlug, setVenueSlug] = useState<string | undefined>()

  useEffect(() => {
    if (!employee?.location?.id) return

    // Load settings to get localDataRetention
    fetch(`/api/settings?locationId=${employee.location.id}&employeeId=${employee.id}`)
      .then(r => r.json())
      .then(data => {
        const settings = data.data?.settings || data.data
        const retention = settings?.localDataRetention || 'monthly'
        setRetentionDays(RETENTION_DAYS[retention] || 30)
      })
      .catch(() => {}) // fallback to default 30

    // Load location to get venue slug
    fetch(`/api/location?locationId=${employee.location.id}&employeeId=${employee.id}`)
      .then(r => r.json())
      .then(data => {
        setVenueSlug(data.data?.slug || undefined)
      })
      .catch(() => {})
  }, [employee?.location?.id, employee?.id])

  return { retentionDays, venueSlug }
}
