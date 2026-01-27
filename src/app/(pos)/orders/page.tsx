'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useOrderStore } from '@/stores/order-store'
import { formatCurrency, formatTime } from '@/lib/utils'

// Demo menu items (will come from API)
const DEMO_CATEGORIES = [
  { id: '1', name: 'Appetizers', color: '#ef4444' },
  { id: '2', name: 'Entrees', color: '#3b82f6' },
  { id: '3', name: 'Drinks', color: '#22c55e' },
  { id: '4', name: 'Desserts', color: '#a855f7' },
]

const DEMO_ITEMS = [
  { id: '1', categoryId: '1', name: 'Wings', price: 12.99 },
  { id: '2', categoryId: '1', name: 'Nachos', price: 10.99 },
  { id: '3', categoryId: '1', name: 'Mozzarella Sticks', price: 8.99 },
  { id: '4', categoryId: '2', name: 'Burger', price: 14.99 },
  { id: '5', categoryId: '2', name: 'Steak', price: 24.99 },
  { id: '6', categoryId: '2', name: 'Salmon', price: 22.99 },
  { id: '7', categoryId: '3', name: 'Soda', price: 2.99 },
  { id: '8', categoryId: '3', name: 'Beer', price: 5.99 },
  { id: '9', categoryId: '3', name: 'Cocktail', price: 9.99 },
  { id: '10', categoryId: '4', name: 'Cheesecake', price: 7.99 },
]

export default function OrdersPage() {
  const router = useRouter()
  const { employee, isAuthenticated, logout } = useAuthStore()
  const { currentOrder, startOrder, addItem, removeItem, clearOrder } = useOrderStore()
  const [selectedCategory, setSelectedCategory] = useState(DEMO_CATEGORIES[0].id)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    // Start a new order if none exists
    if (!currentOrder) {
      startOrder('dine_in', { guestCount: 1 })
    }
  }, [currentOrder, startOrder])

  const handleLogout = () => {
    clearOrder()
    logout()
    router.push('/login')
  }

  const handleAddItem = (item: typeof DEMO_ITEMS[0]) => {
    addItem({
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: 1,
      modifiers: [],
    })
  }

  const filteredItems = DEMO_ITEMS.filter(item => item.categoryId === selectedCategory)

  if (!isAuthenticated || !employee) {
    return null // Will redirect
  }

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Left Panel - Menu */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">GWI</span>
            </div>
            <div>
              <p className="font-semibold text-gray-900">{employee.displayName}</p>
              <p className="text-sm text-gray-500">{employee.role.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{formatTime(new Date())}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Clock Out
            </Button>
          </div>
        </header>

        {/* Categories */}
        <div className="bg-white border-b px-4 py-2 flex gap-2 overflow-x-auto">
          {DEMO_CATEGORIES.map(category => (
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
          ))}
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
                <span className="font-semibold text-gray-900">{item.name}</span>
                <span className="text-sm text-gray-500">{formatCurrency(item.price)}</span>
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
            <span className="text-sm text-gray-500">
              {currentOrder?.orderType.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Button variant="ghost" size="sm">Table</Button>
            <Button variant="ghost" size="sm">Quick Tab</Button>
            <Button variant="ghost" size="sm">Takeout</Button>
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
                        <span className="font-medium">{item.quantity}x</span>
                        <span>{item.name}</span>
                      </div>
                      {item.modifiers.length > 0 && (
                        <div className="text-sm text-gray-500 ml-6">
                          {item.modifiers.map(mod => mod.name).join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1"
                        onClick={() => removeItem(item.id)}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </Button>
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
            <span className="text-gray-500">Tax</span>
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
            <Button variant="outline" size="md">
              Hold
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
    </div>
  )
}
