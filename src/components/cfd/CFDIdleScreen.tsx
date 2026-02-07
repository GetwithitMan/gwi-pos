'use client'

import { useState, useEffect } from 'react'

export default function CFDIdleScreen() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900">
      {/* Logo area */}
      <div className="mb-12">
        <div className="w-24 h-24 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-sm">
          <span className="text-4xl font-bold text-white/80">GWI</span>
        </div>
      </div>

      {/* Welcome text */}
      <h1 className="text-4xl font-light text-white/80 mb-4">Welcome</h1>
      <p className="text-xl text-white/40 mb-16">Your order will appear here</p>

      {/* Clock */}
      <div className="text-6xl font-light text-white/20 tabular-nums">
        {time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>
    </div>
  )
}
