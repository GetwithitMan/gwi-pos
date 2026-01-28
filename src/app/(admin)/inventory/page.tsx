'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminNav } from '@/components/admin/AdminNav'

interface InventoryItem {
  id: string
  name: string
  categoryId: string
  categoryName: string
  currentStock: number
  lowStockAlert: number
  isLowStock: boolean
  isOutOfStock: boolean
  isAvailable: boolean
}

interface Transaction {
  id: string
  menuItemId: string
  menuItemName?: string
  type: string
  quantityBefore: number
  quantityChange: number
  quantityAfter: number
  reason?: string
  vendorName?: string
  invoiceNumber?: string
  unitCost?: number
  totalCost?: number
  createdAt: string
}

interface StockAlert {
  id: string
  menuItemId: string
  menuItemName?: string
  alertType: string
  currentStock: number
  status: string
  createdAt: string
}

export default function InventoryPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'stock' | 'transactions' | 'alerts'>('stock')
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [adjustForm, setAdjustForm] = useState({
    type: 'adjustment',
    quantityChange: 0,
    reason: '',
    vendorName: '',
    invoiceNumber: '',
    unitCost: 0,
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  const loadData = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const [inventoryRes, alertsRes] = await Promise.all([
        fetch(`/api/inventory?locationId=${employee.location.id}`),
        fetch(`/api/stock-alerts?locationId=${employee.location.id}`),
      ])

      if (inventoryRes.ok) {
        const data = await inventoryRes.json()
        setItems(data.items || [])
        setTransactions(data.transactions || [])
      }
      if (alertsRes.ok) {
        const data = await alertsRes.json()
        setAlerts(data.alerts || [])
      }
    } catch (error) {
      console.error('Failed to load inventory:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdjust = async () => {
    if (!employee?.location?.id || !selectedItem || adjustForm.quantityChange === 0) return

    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          menuItemId: selectedItem.id,
          type: adjustForm.type,
          quantityChange: adjustForm.quantityChange,
          reason: adjustForm.reason,
          vendorName: adjustForm.vendorName,
          invoiceNumber: adjustForm.invoiceNumber,
          unitCost: adjustForm.unitCost || null,
          employeeId: employee.id,
        }),
      })

      if (res.ok) {
        setShowAdjustModal(false)
        setSelectedItem(null)
        setAdjustForm({
          type: 'adjustment',
          quantityChange: 0,
          reason: '',
          vendorName: '',
          invoiceNumber: '',
          unitCost: 0,
        })
        loadData()
      }
    } catch (error) {
      console.error('Failed to adjust inventory:', error)
    }
  }

  const handleAcknowledgeAlerts = async (alertIds: string[]) => {
    try {
      await fetch('/api/stock-alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertIds,
          action: 'acknowledge',
          employeeId: employee?.id,
        }),
      })
      loadData()
    } catch (error) {
      console.error('Failed to acknowledge alerts:', error)
    }
  }

  const lowStockItems = items.filter(i => i.isLowStock && !i.isOutOfStock)
  const outOfStockItems = items.filter(i => i.isOutOfStock)
  const activeAlerts = alerts.filter(a => a.status === 'active')

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      <AdminNav />

      <div className="lg:ml-64 p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-600">Track stock levels and receive low stock alerts</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{items.length}</p>
              <p className="text-sm text-gray-600">Tracked Items</p>
            </CardContent>
          </Card>
          <Card className={lowStockItems.length > 0 ? 'border-yellow-500' : ''}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-yellow-600">{lowStockItems.length}</p>
              <p className="text-sm text-gray-600">Low Stock</p>
            </CardContent>
          </Card>
          <Card className={outOfStockItems.length > 0 ? 'border-red-500' : ''}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{outOfStockItems.length}</p>
              <p className="text-sm text-gray-600">Out of Stock</p>
            </CardContent>
          </Card>
          <Card className={activeAlerts.length > 0 ? 'border-red-500' : ''}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{activeAlerts.length}</p>
              <p className="text-sm text-gray-600">Active Alerts</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <Button
            variant={activeTab === 'stock' ? 'primary' : 'outline'}
            onClick={() => setActiveTab('stock')}
          >
            Stock Levels
          </Button>
          <Button
            variant={activeTab === 'transactions' ? 'primary' : 'outline'}
            onClick={() => setActiveTab('transactions')}
          >
            Transactions
          </Button>
          <Button
            variant={activeTab === 'alerts' ? 'primary' : 'outline'}
            onClick={() => setActiveTab('alerts')}
            className={activeAlerts.length > 0 ? 'relative' : ''}
          >
            Alerts
            {activeAlerts.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">
                {activeAlerts.length}
              </span>
            )}
          </Button>
        </div>

        {/* Stock Levels Tab */}
        {activeTab === 'stock' && (
          <Card>
            <CardHeader>
              <CardTitle>Stock Levels</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-gray-500">Loading...</p>
              ) : items.length === 0 ? (
                <p className="text-gray-500">
                  No items with inventory tracking enabled. Enable tracking in the menu editor.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 text-sm font-medium text-gray-600">Item</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-600">Category</th>
                        <th className="text-right p-3 text-sm font-medium text-gray-600">Current Stock</th>
                        <th className="text-right p-3 text-sm font-medium text-gray-600">Low Alert</th>
                        <th className="text-center p-3 text-sm font-medium text-gray-600">Status</th>
                        <th className="text-right p-3 text-sm font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {items.map(item => (
                        <tr key={item.id} className={item.isOutOfStock ? 'bg-red-50' : item.isLowStock ? 'bg-yellow-50' : ''}>
                          <td className="p-3 font-medium">{item.name}</td>
                          <td className="p-3 text-gray-500">{item.categoryName}</td>
                          <td className="p-3 text-right font-mono">{item.currentStock}</td>
                          <td className="p-3 text-right text-gray-500">{item.lowStockAlert}</td>
                          <td className="p-3 text-center">
                            {item.isOutOfStock ? (
                              <span className="px-2 py-1 rounded text-xs bg-red-100 text-red-800">Out of Stock</span>
                            ) : item.isLowStock ? (
                              <span className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800">Low Stock</span>
                            ) : (
                              <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-800">In Stock</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedItem(item)
                                setShowAdjustModal(true)
                              }}
                            >
                              Adjust
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="text-gray-500">No transactions recorded</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-3 text-sm font-medium text-gray-600">Date</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-600">Item</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-600">Type</th>
                        <th className="text-right p-3 text-sm font-medium text-gray-600">Change</th>
                        <th className="text-right p-3 text-sm font-medium text-gray-600">After</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-600">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {transactions.slice(0, 50).map(t => (
                        <tr key={t.id}>
                          <td className="p-3 text-sm text-gray-500">
                            {new Date(t.createdAt).toLocaleString()}
                          </td>
                          <td className="p-3">{t.menuItemName}</td>
                          <td className="p-3">
                            <span className="capitalize">{t.type}</span>
                          </td>
                          <td className={`p-3 text-right font-mono ${t.quantityChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {t.quantityChange > 0 ? '+' : ''}{t.quantityChange}
                          </td>
                          <td className="p-3 text-right font-mono">{t.quantityAfter}</td>
                          <td className="p-3 text-sm text-gray-500">
                            {t.reason || t.vendorName || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Stock Alerts</CardTitle>
              {activeAlerts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAcknowledgeAlerts(activeAlerts.map(a => a.id))}
                >
                  Acknowledge All
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="text-gray-500">No alerts</p>
              ) : (
                <div className="space-y-4">
                  {alerts.map(alert => (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-lg border ${
                        alert.status === 'active'
                          ? alert.alertType === 'out_of_stock'
                            ? 'border-red-300 bg-red-50'
                            : 'border-yellow-300 bg-yellow-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium">{alert.menuItemName}</h4>
                          <p className="text-sm text-gray-500">
                            {alert.alertType === 'out_of_stock' ? 'Out of Stock' : 'Low Stock'} -
                            Current: {alert.currentStock} units
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(alert.createdAt).toLocaleString()}
                          </p>
                        </div>
                        {alert.status === 'active' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAcknowledgeAlerts([alert.id])}
                          >
                            Acknowledge
                          </Button>
                        )}
                        {alert.status !== 'active' && (
                          <span className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-600">
                            {alert.status}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Adjust Modal */}
      {showAdjustModal && selectedItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Adjust Stock - {selectedItem.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-4">
                Current stock: <strong>{selectedItem.currentStock}</strong>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Transaction Type</label>
                  <select
                    value={adjustForm.type}
                    onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="adjustment">Adjustment</option>
                    <option value="purchase">Purchase / Restock</option>
                    <option value="waste">Waste / Spoilage</option>
                    <option value="count">Physical Count</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    {adjustForm.type === 'count' ? 'New Count' : 'Quantity Change'}
                  </label>
                  <input
                    type="number"
                    value={adjustForm.quantityChange}
                    onChange={(e) => setAdjustForm({
                      ...adjustForm,
                      quantityChange: parseInt(e.target.value) || 0,
                    })}
                    className="w-full border rounded px-3 py-2"
                    placeholder={adjustForm.type === 'count' ? 'Enter new count' : 'Enter +/- amount'}
                  />
                  {adjustForm.type !== 'count' && (
                    <p className="text-xs text-gray-400 mt-1">
                      Use positive for additions, negative for removals
                    </p>
                  )}
                </div>

                {adjustForm.type === 'purchase' && (
                  <>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Vendor</label>
                      <input
                        type="text"
                        value={adjustForm.vendorName}
                        onChange={(e) => setAdjustForm({ ...adjustForm, vendorName: e.target.value })}
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Invoice #</label>
                        <input
                          type="text"
                          value={adjustForm.invoiceNumber}
                          onChange={(e) => setAdjustForm({ ...adjustForm, invoiceNumber: e.target.value })}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Unit Cost</label>
                        <input
                          type="number"
                          step="0.01"
                          value={adjustForm.unitCost}
                          onChange={(e) => setAdjustForm({ ...adjustForm, unitCost: parseFloat(e.target.value) })}
                          className="w-full border rounded px-3 py-2"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Reason / Notes</label>
                  <input
                    type="text"
                    value={adjustForm.reason}
                    onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAdjustModal(false)
                      setSelectedItem(null)
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleAdjust} className="flex-1">
                    Save Adjustment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
