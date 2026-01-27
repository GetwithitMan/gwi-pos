'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { formatCurrency, formatTime } from '@/lib/utils'

interface Category {
  id: string
  name: string
  color: string
}

interface MenuItem {
  id: string
  categoryId: string
  name: string
  price: number
  isAvailable: boolean
}

export default function OrdersPage() {
  const router = useRouter()
  const { employee, isAuthenticated, logout } = useAuthStore()
  const { currentOrder, startOrder, addItem, removeItem, updateQuantity, clearOrder } = useOrderStore()
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showMenu, setShowMenu] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    loadMenu()
  }, [])

  useEffect(() => {
    if (!currentOrder) {
      startOrder('dine_in', { guestCount: 1 })
    }
  }, [currentOrder, startOrder])

  const loadMenu = async () => {
    try {
      const response = await fetch('/api/menu')
      if (response.ok) {
        const data = await response.json()
        setCategories(data.categories)
        setMenuItems(data.items)
        if (data.categories.length > 0) {
          setSelectedCategory(data.categories[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    clearOrder()
    logout()
    router.push('/login')
  }

  const handleAddItem = (item: MenuItem) => {
    if (!item.isAvailable) return
    addItem({
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: 1,
      modifiers: [],
    })
  }

  const filteredItems = menuItems.filter(
    item => item.categoryId === selectedCategory && item.isAvailable
  )
  const unavailableItems = menuItems.filter(
    item => item.categoryId === selectedCategory && !item.isAvailable
  )

  if (!isAuthenticated || !employee) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">GWI</span>
            </div>
            <div>
              <p className="font-semibold text-gray-900">{employee.displayName}</p>
              <p className="text-sm text-gray-500">{employee.role.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMenu(!showMenu)}
              className="relative"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
            <span className="text-sm text-gray-500">{formatTime(new Date())}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Clock Out
            </Button>
          </div>
        </header>

        {/* Dropdown Menu */}
        {showMenu && (
          <div className="absolute top-16 right-4 bg-white rounded-lg shadow-lg border z-50 py-2 min-w-[200px]">
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => {
                router.push('/menu')
                setShowMenu(false)
              }}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Menu Management
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => setShowMenu(false)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Reports
            </button>
            <button
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
              onClick={() => setShowMenu(false)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </div>
        )}

        {/* Categories */}
        <div className="bg-white border-b px-4 py-2 flex gap-2 overflow-x-auto">
          {isLoading ? (
            <div className="text-gray-400 py-2">Loading menu...</div>
          ) : (
            categories.map(category => (
              <Button
                key={category.id}
                variant={selectedCategory === category.id ? 'primary' : 'outline'}
                size="md"
                onClick={() => setSelectedCategory(category.id)}
                style={{
                  backgroundColor: selectedCategory === category.id ? category.color : undefined,
                  borderColor: category.color,
                  color: selectedCategory === category.id ? 'white' : category.color,
                }}
              >
                {category.name}
              </Button>
            ))
          )}
        </div>

        {/* Menu Items Grid */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                className="h-24 flex flex-col items-center justify-center gap-1 hover:bg-blue-50 hover:border-blue-500"
                onClick={() => handleAddItem(item)}
              >
                <span className="font-semibold text-gray-900 text-center leading-tight">{item.name}</span>
                <span className="text-sm text-gray-500">{formatCurrency(item.price)}</span>
              </Button>
            ))}
            {unavailableItems.map(item => (
              <Button
                key={item.id}
                variant="outline"
                className="h-24 flex flex-col items-center justify-center gap-1 opacity-50 cursor-not-allowed relative"
                disabled
              >
                <span className="font-semibold text-gray-900 text-center leading-tight">{item.name}</span>
                <span className="text-sm text-gray-500">{formatCurrency(item.price)}</span>
                <span className="absolute top-1 right-1 bg-red-500 text-white text-xs px-1 rounded">86</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Order */}
      <div className="w-80 bg-white border-l flex flex-col">
        {/* Order Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Current Order</h2>
            <span className="text-sm text-gray-500 capitalize">
              {currentOrder?.orderType.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Button
              variant={currentOrder?.orderType === 'dine_in' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => startOrder('dine_in')}
            >
              Table
            </Button>
            <Button
              variant={currentOrder?.orderType === 'bar_tab' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => startOrder('bar_tab')}
            >
              Quick Tab
            </Button>
            <Button
              variant={currentOrder?.orderType === 'takeout' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => startOrder('takeout')}
            >
              Takeout
            </Button>
          </div>
        </div>

        {/* Order Items */}
        <div className="flex-1 overflow-y-auto p-4">
          {currentOrder?.items.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <p>No items yet</p>
              <p className="text-sm">Tap menu items to add</p>
            </div>
          ) : (
            <div className="space-y-2">
              {currentOrder?.items.map(item => (
                <Card key={item.id} className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600"
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-medium">{item.quantity}</span>
                          <button
                            className="w-6 h-6 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600"
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          >
                            +
                          </button>
                        </div>
                        <span className="font-medium">{item.name}</span>
                      </div>
                      {item.modifiers.length > 0 && (
                        <div className="text-sm text-gray-500 ml-[72px]">
                          {item.modifiers.map(mod => mod.name).join(', ')}
                        </div>
                      )}
                      {item.specialNotes && (
                        <div className="text-sm text-orange-600 ml-[72px]">
                          Note: {item.specialNotes}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                      <button
                        className="text-red-500 hover:text-red-700 p-1"
                        onClick={() => removeItem(item.id)}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Order Totals */}
        <div className="border-t p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span>{formatCurrency(currentOrder?.subtotal || 0)}</span>
          </div>
          {(currentOrder?.discountTotal || 0) > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Discount</span>
              <span>-{formatCurrency(currentOrder?.discountTotal || 0)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Tax (8%)</span>
            <span>{formatCurrency(currentOrder?.taxTotal || 0)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg pt-2 border-t">
            <span>Total</span>
            <span>{formatCurrency(currentOrder?.total || 0)}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 border-t space-y-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!currentOrder?.items.length}
          >
            Send to Kitchen
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="md" disabled={!currentOrder?.items.length}>
              Pay
            </Button>
            <Button
              variant="danger"
              size="md"
              onClick={clearOrder}
              disabled={!currentOrder?.items.length}
            >
              Clear
            </Button>
          </div>
        </div>
      </div>

      {/* Click outside to close menu */}
      {showMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowMenu(false)}
        />
      )}
    </div>
  )
}
