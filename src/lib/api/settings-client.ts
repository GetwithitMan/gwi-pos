import type { LocationSettings } from '@/lib/settings'

type SettingsResponse = { settings: LocationSettings }

export async function loadSettings(signal?: AbortSignal): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', { signal })
  if (!res.ok) throw new Error('Failed to load settings')
  const raw = await res.json()
  return raw.data ?? raw
}

export async function saveSettings(
  settings: Partial<LocationSettings>,
  employeeId?: string,
): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings, employeeId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Failed to save settings' }))
    throw new Error(data.error || 'Failed to save settings')
  }
  const raw = await res.json()
  return raw.data ?? raw
}
