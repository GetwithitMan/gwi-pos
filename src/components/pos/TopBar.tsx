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
        {/* Hamburger Menu */}
        <button
          onClick={onOpenAdminNav}
          className="p-2 hover:bg-gray-800 rounded transition-colors text-gray-300 hover:text-white"
          title="Menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

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

        {/* Bar Link */}
        <Link
          href="/bar"
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
              <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20">
                <div className="p-2 border-b border-gray-700">
                  <div className="text-white font-medium">{employee.name}</div>
                  {employee.role?.name && (
                    <div className="text-gray-400 text-sm">{employee.role.name}</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowEmployeeMenu(false)
                    onLogout()
                  }}
                  className="w-full text-left px-4 py-2 text-red-400 hover:bg-gray-700 transition-colors"
                >
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
