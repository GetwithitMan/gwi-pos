'use client'

import Link from 'next/link'
import type { KDSOrder } from './KDSOrderCard'

interface PrepStation {
  id: string
  name: string
  displayName: string | null
  color: string | null
  stationType: string
  showAllItems?: boolean
}

interface ScreenConfig {
  id: string
  name: string
  slug: string | null
  screenType: string
  locationId: string
  columns: number
  fontSize: string
  colorScheme: string
  agingWarning: number
  lateWarning: number
  playSound: boolean
  flashOnNew: boolean
  stations: Array<{
    id: string
    name: string
    displayName: string | null
    stationType: string
    color: string | null
  }>
}

type AuthState = 'checking' | 'authenticated' | 'requires_pairing' | 'employee_fallback'

export interface KDSHeaderProps {
  authState: AuthState
  screenConfig: ScreenConfig | null
  station: PrepStation | null
  orders: KDSOrder[]
  lastUpdate: Date | null
  socketConnected: boolean
  expoMode: boolean
  setExpoMode: (value: boolean) => void
  showCompleted: boolean
  setShowCompleted: (value: boolean) => void
  stationParam: string | null
  stations: PrepStation[]
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onShowClock: () => void
  onRefresh: () => void
  onNavigateBack: () => void
  onStationChange: (stationId: string) => void
  setIsLoading: (value: boolean) => void
}

export function KDSHeader({
  authState,
  screenConfig,
  station,
  orders,
  lastUpdate,
  socketConnected,
  expoMode,
  setExpoMode,
  showCompleted,
  setShowCompleted,
  stationParam,
  stations,
  isFullscreen,
  onToggleFullscreen,
  onShowClock,
  onRefresh,
  onNavigateBack,
  onStationChange,
  setIsLoading,
}: KDSHeaderProps) {
  return (
    <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-4">
        {authState === 'employee_fallback' && (
          <button
            onClick={onNavigateBack}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {expoMode ? (
              <>
                <span className="w-3 h-3 rounded-full bg-orange-500" title="Expo" />
                Expo View
              </>
            ) : screenConfig ? (
              <>
                <span className="w-3 h-3 rounded-full bg-green-500" title="Paired" />
                {screenConfig.name}
              </>
            ) : station ? (
              <>
                <span
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: station.color || '#3B82F6' }}
                />
                {station.displayName || station.name}
              </>
            ) : (
              'All Stations'
            )}
          </h1>
          <p className="text-sm text-gray-400">
            {orders.length} order{orders.length !== 1 ? 's' : ''} •
            Updated {lastUpdate ? lastUpdate.toLocaleTimeString() : '...'}
            <span className={`ml-2 w-2 h-2 rounded-full inline-block ${socketConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}
              title={socketConnected ? 'Live updates' : 'Polling fallback'} />
            {authState === 'employee_fallback' && (
              <span className="ml-2 text-yellow-500">(Employee Mode)</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Station Selector - only for employee fallback mode */}
        {authState === 'employee_fallback' && (
          <select
            value={stationParam || ''}
            onChange={(e) => onStationChange(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Stations</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>
                {s.displayName || s.name}
              </option>
            ))}
          </select>
        )}

        {/* Expo / Station Mode Toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-600">
          <button
            onClick={() => { setExpoMode(false); setIsLoading(true) }}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              !expoMode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Station
          </button>
          <button
            onClick={() => { setExpoMode(true); setIsLoading(true) }}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              expoMode
                ? 'bg-orange-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Expo
          </button>
        </div>

        {/* Show Completed Toggle */}
        <button
          onClick={() => setShowCompleted(!showCompleted)}
          className={`px-3 py-2 rounded-lg text-sm transition-colors ${
            showCompleted
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          {showCompleted ? 'Hide Done' : 'Show Done'}
        </button>

        {/* Fullscreen Toggle */}
        <button
          onClick={onToggleFullscreen}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          {isFullscreen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>

        {/* Settings Button - only show when screen config exists */}
        {screenConfig && (
          <Link
            href={`/kds/settings?screen=${screenConfig.id}`}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            title="Screen Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        )}

        {/* Clock In/Out Button */}
        <button
          onClick={onShowClock}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          title="Clock In / Out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </header>
  )
}
