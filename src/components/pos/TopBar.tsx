'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface TopBarProps {
  employee: {
    id: string
    name: string
    role?: { name: string }
  }
  currentRoute: 'orders' | 'bar' | 'tabs'
  onOpenAdminNav: () => void
  onOpenNewTab: () => void
  onOpenTimeClock: () => void
  onOpenDrawer: () => void
  onLogout: () => void
}

export function TopBar({
  employee,
  currentRoute,
  onOpenAdminNav,
  onOpenNewTab,
  onOpenTimeClock,
  onOpenDrawer,
  onLogout,
}: TopBarProps) {
  const [currentTime, setCurrentTime] = useState<string>('')
  const [showEmployeeMenu, setShowEmployeeMenu] = useState(false)

  // Update time every minute
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      const hours = now.getHours()
      const minutes = now.getMinutes()
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const displayHours = hours % 12 || 12
      const displayMinutes = minutes.toString().padStart(2, '0')
      setCurrentTime(`${displayHours}:${displayMinutes} ${ampm}`)
    }

    // Update immediately
    updateTime()

    // Update every minute
    const interval = setInterval(updateTime, 60000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="h-14 bg-gray-900/95 backdrop-blur border-b border-gray-800 flex items-center px-4 gap-4">
      {/* LEFT SECTION - Navigation */}
      <div className="flex items-center gap-2">
        {/* Settings Link - only shown if callback provided (permission-gated) */}
        {onOpenAdminNav && (
          <button
            onClick={onOpenAdminNav}
            className="p-2 hover:bg-gray-800 rounded transition-colors text-gray-300 hover:text-white"
            title="Settings"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}

        {/* Orders Link */}
        <Link
          href="/orders"
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            currentRoute === 'orders'
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-800 hover:text-white'
          }`}
        >
          <span>🍽️</span>
          <span>Orders</span>
        </Link>

        {/* Bar Link - redirects to /orders (Bar mode is a toggle on the orders page) */}
        <Link
          href="/orders"
          className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
            currentRoute === 'bar'
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-800 hover:text-white'
          }`}
        >
          <span>🍺</span>
          <span>Bar</span>
        </Link>
      </div>

      {/* CENTER SECTION - Quick Actions */}
      <div className="flex-1 flex items-center justify-center gap-2">
        {/* New Tab */}
        <button
          onClick={onOpenNewTab}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span>+</span>
          <span>Tab</span>
        </button>

        {/* Time Clock */}
        <button
          onClick={onOpenTimeClock}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span>⏱️</span>
          <span>Clock</span>
        </button>

        {/* Drawer */}
        <button
          onClick={onOpenDrawer}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <span>💵</span>
          <span>Drawer</span>
        </button>
      </div>

      {/* RIGHT SECTION - Time, Employee, Menu */}
      <div className="flex items-center gap-4">
        {/* Current Time */}
        <div className="text-gray-300 font-medium">
          {currentTime}
        </div>

        {/* Employee Menu */}
        <div className="relative">
          <button
            onClick={() => setShowEmployeeMenu(!showEmployeeMenu)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-white"
          >
            <span className="font-medium">{employee.name}</span>
            <svg
              className={`w-4 h-4 transition-transform ${showEmployeeMenu ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Dropdown Menu */}
          {showEmployeeMenu && (
            <>
              {/* Backdrop to close menu */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowEmployeeMenu(false)}
              />
              {/* Menu */}
              <div className="absolute right-0 mt-2 w-52 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20">
                <div className="p-2 border-b border-gray-700">
                  <div className="text-white font-medium">{employee.name}</div>
                  {employee.role?.name && (
                    <div className="text-gray-400 text-sm">{employee.role.name}</div>
                  )}
                  <div className="text-gray-500 text-xs mt-1">v{process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'}</div>
                </div>
                <div className="py-1">
                  <Link
                    href="/crew"
                    onClick={() => setShowEmployeeMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Crew Hub
                  </Link>
                  <Link
                    href="/crew/shift"
                    onClick={() => setShowEmployeeMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    My Shift
                  </Link>
                  <Link
                    href="/crew/tip-bank"
                    onClick={() => setShowEmployeeMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Tip Bank
                  </Link>
                  <Link
                    href="/crew/tip-group"
                    onClick={() => setShowEmployeeMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Tip Group
                  </Link>
                </div>
                <div className="border-t border-gray-700">
                  <button
                    onClick={() => {
                      setShowEmployeeMenu(false)
                      onLogout()
                    }}
                    className="w-full text-left px-4 py-2 text-red-400 hover:bg-gray-700 transition-colors text-sm"
                  >
                    Logout
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
