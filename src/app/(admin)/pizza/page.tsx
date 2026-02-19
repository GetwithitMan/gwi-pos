'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import {
  PizzaConfig,
  Printer,
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
} from './types'
import {
  ConfigTab,
  SizesTab,
  CrustsTab,
  SaucesTab,
  CheesesTab,
  ToppingsTab,
} from './PizzaTabs'
import {
  SizeModal,
  CrustModal,
  SauceModal,
  CheeseModal,
  ToppingModal,
} from './PizzaModals'

type TabType = 'config' | 'sizes' | 'crusts' | 'sauces' | 'cheeses' | 'toppings'

export default function PizzaAdminPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [activeTab, setActiveTab] = useState<TabType>('sizes')
  const [isLoading, setIsLoading] = useState(true)
  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null)

  // Data states
  const [config, setConfig] = useState<PizzaConfig | null>(null)
  const [sizes, setSizes] = useState<PizzaSize[]>([])
  const [crusts, setCrusts] = useState<PizzaCrust[]>([])
  const [sauces, setSauces] = useState<PizzaSauce[]>([])
  const [cheeses, setCheeses] = useState<PizzaCheese[]>([])
  const [toppings, setToppings] = useState<PizzaTopping[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])

  // Modal states
  const [showSizeModal, setShowSizeModal] = useState(false)
  const [showCrustModal, setShowCrustModal] = useState(false)
  const [showSauceModal, setShowSauceModal] = useState(false)
  const [showCheeseModal, setShowCheeseModal] = useState(false)
  const [showToppingModal, setShowToppingModal] = useState(false)
  const [showPrintSettingsModal, setShowPrintSettingsModal] = useState(false)

  // Edit states
  const [editingSize, setEditingSize] = useState<PizzaSize | null>(null)
  const [editingCrust, setEditingCrust] = useState<PizzaCrust | null>(null)
  const [editingSauce, setEditingSauce] = useState<PizzaSauce | null>(null)
  const [editingCheese, setEditingCheese] = useState<PizzaCheese | null>(null)
  const [editingTopping, setEditingTopping] = useState<PizzaTopping | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/pizza')
      return
    }
    loadAllData()
  }, [isAuthenticated, router])

  const loadAllData = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/pizza')
      if (response.ok) {
        const data = await response.json()
        setConfig(data.data.config)
        setSizes(data.data.sizes)
        setCrusts(data.data.crusts)
        setSauces(data.data.sauces)
        setCheeses(data.data.cheeses)
        setToppings(data.data.toppings)
        setPrinters(data.data.printers || [])
      }
    } catch (error) {
      console.error('Failed to load pizza data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Config handlers
  const handleSaveConfig = async (updates: Partial<PizzaConfig>) => {
    try {
      const response = await fetch('/api/pizza/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (response.ok) {
        const data = await response.json()
        setConfig(data.data)
      }
    } catch (error) {
      console.error('Failed to save config:', error)
    }
  }

  // Size handlers
  const handleSaveSize = async (sizeData: Partial<PizzaSize>) => {
    try {
      const method = editingSize ? 'PATCH' : 'POST'
      const url = editingSize ? `/api/pizza/sizes/${editingSize.id}` : '/api/pizza/sizes'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sizeData)
      })
      if (response.ok) {
        await loadAllData()
        setShowSizeModal(false)
        setEditingSize(null)
      }
    } catch (error) {
      console.error('Failed to save size:', error)
    }
  }

  const handleDeleteSize = (id: string) => {
    setConfirmAction({
      title: 'Delete Size',
      message: 'Delete this size?',
      action: async () => {
        try {
          await fetch(`/api/pizza/sizes/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete size:', error)
        }
      },
    })
  }

  // Crust handlers
  const handleSaveCrust = async (crustData: Partial<PizzaCrust>) => {
    try {
      const method = editingCrust ? 'PATCH' : 'POST'
      const url = editingCrust ? `/api/pizza/crusts/${editingCrust.id}` : '/api/pizza/crusts'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crustData)
      })
      if (response.ok) {
        await loadAllData()
        setShowCrustModal(false)
        setEditingCrust(null)
      }
    } catch (error) {
      console.error('Failed to save crust:', error)
    }
  }

  const handleDeleteCrust = (id: string) => {
    setConfirmAction({
      title: 'Delete Crust',
      message: 'Delete this crust?',
      action: async () => {
        try {
          await fetch(`/api/pizza/crusts/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete crust:', error)
        }
      },
    })
  }

  // Sauce handlers
  const handleSaveSauce = async (sauceData: Partial<PizzaSauce>) => {
    try {
      const method = editingSauce ? 'PATCH' : 'POST'
      const url = editingSauce ? `/api/pizza/sauces/${editingSauce.id}` : '/api/pizza/sauces'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sauceData)
      })
      if (response.ok) {
        await loadAllData()
        setShowSauceModal(false)
        setEditingSauce(null)
      }
    } catch (error) {
      console.error('Failed to save sauce:', error)
    }
  }

  const handleDeleteSauce = (id: string) => {
    setConfirmAction({
      title: 'Delete Sauce',
      message: 'Delete this sauce?',
      action: async () => {
        try {
          await fetch(`/api/pizza/sauces/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete sauce:', error)
        }
      },
    })
  }

  // Cheese handlers
  const handleSaveCheese = async (cheeseData: Partial<PizzaCheese>) => {
    try {
      const method = editingCheese ? 'PATCH' : 'POST'
      const url = editingCheese ? `/api/pizza/cheeses/${editingCheese.id}` : '/api/pizza/cheeses'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cheeseData)
      })
      if (response.ok) {
        await loadAllData()
        setShowCheeseModal(false)
        setEditingCheese(null)
      }
    } catch (error) {
      console.error('Failed to save cheese:', error)
    }
  }

  const handleDeleteCheese = (id: string) => {
    setConfirmAction({
      title: 'Delete Cheese',
      message: 'Delete this cheese?',
      action: async () => {
        try {
          await fetch(`/api/pizza/cheeses/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete cheese:', error)
        }
      },
    })
  }

  // Topping handlers
  const handleSaveTopping = async (toppingData: Partial<PizzaTopping>) => {
    try {
      const method = editingTopping ? 'PATCH' : 'POST'
      const url = editingTopping ? `/api/pizza/toppings/${editingTopping.id}` : '/api/pizza/toppings'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toppingData)
      })
      if (response.ok) {
        await loadAllData()
        setShowToppingModal(false)
        setEditingTopping(null)
      }
    } catch (error) {
      console.error('Failed to save topping:', error)
    }
  }

  const handleDeleteTopping = async (id: string) => {
    if (!confirm('Delete this topping?')) return
    try {
      await fetch(`/api/pizza/toppings/${id}`, { method: 'DELETE' })
      await loadAllData()
    } catch (error) {
      console.error('Failed to delete topping:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-12 text-gray-500">Loading pizza configuration...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 p-6">
      <AdminPageHeader
        title="Pizza Builder Settings"
        subtitle="Configure sizes, crusts, sauces, cheeses, and toppings"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
      />
      <div className="max-w-6xl mx-auto mt-6">

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 pb-4 overflow-x-auto">
          {[
            { id: 'config', label: 'Settings', icon: '⚙️' },
            { id: 'sizes', label: 'Sizes', icon: '📐' },
            { id: 'crusts', label: 'Crusts', icon: '🍞' },
            { id: 'sauces', label: 'Sauces', icon: '🥫' },
            { id: 'cheeses', label: 'Cheeses', icon: '🧀' },
            { id: 'toppings', label: 'Toppings', icon: '🍕' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-white/80 text-gray-700 hover:bg-orange-100'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'config' && (
          <ConfigTab
            config={config}
            printers={printers}
            onSave={handleSaveConfig}
            showPrintSettings={showPrintSettingsModal}
            setShowPrintSettings={setShowPrintSettingsModal}
          />
        )}

        {activeTab === 'sizes' && (
          <SizesTab
            sizes={sizes}
            onAdd={() => { setEditingSize(null); setShowSizeModal(true) }}
            onEdit={(size) => { setEditingSize(size); setShowSizeModal(true) }}
            onDelete={handleDeleteSize}
          />
        )}

        {activeTab === 'crusts' && (
          <CrustsTab
            crusts={crusts}
            onAdd={() => { setEditingCrust(null); setShowCrustModal(true) }}
            onEdit={(crust) => { setEditingCrust(crust); setShowCrustModal(true) }}
            onDelete={handleDeleteCrust}
          />
        )}

        {activeTab === 'sauces' && (
          <SaucesTab
            sauces={sauces}
            onAdd={() => { setEditingSauce(null); setShowSauceModal(true) }}
            onEdit={(sauce) => { setEditingSauce(sauce); setShowSauceModal(true) }}
            onDelete={handleDeleteSauce}
          />
        )}

        {activeTab === 'cheeses' && (
          <CheesesTab
            cheeses={cheeses}
            onAdd={() => { setEditingCheese(null); setShowCheeseModal(true) }}
            onEdit={(cheese) => { setEditingCheese(cheese); setShowCheeseModal(true) }}
            onDelete={handleDeleteCheese}
          />
        )}

        {activeTab === 'toppings' && (
          <ToppingsTab
            toppings={toppings}
            onAdd={() => { setEditingTopping(null); setShowToppingModal(true) }}
            onEdit={(topping) => { setEditingTopping(topping); setShowToppingModal(true) }}
            onDelete={handleDeleteTopping}
          />
        )}

        {/* Modals */}
        {showSizeModal && (
          <SizeModal
            size={editingSize}
            onSave={handleSaveSize}
            onClose={() => { setShowSizeModal(false); setEditingSize(null) }}
          />
        )}

        {showCrustModal && (
          <CrustModal
            crust={editingCrust}
            onSave={handleSaveCrust}
            onClose={() => { setShowCrustModal(false); setEditingCrust(null) }}
          />
        )}

        {showSauceModal && (
          <SauceModal
            sauce={editingSauce}
            onSave={handleSaveSauce}
            onClose={() => { setShowSauceModal(false); setEditingSauce(null) }}
          />
        )}

        {showCheeseModal && (
          <CheeseModal
            cheese={editingCheese}
            onSave={handleSaveCheese}
            onClose={() => { setShowCheeseModal(false); setEditingCheese(null) }}
          />
        )}

        {showToppingModal && (
          <ToppingModal
            topping={editingTopping}
            onSave={handleSaveTopping}
            onClose={() => { setShowToppingModal(false); setEditingTopping(null) }}
          />
        )}

        <ConfirmDialog
          open={!!confirmAction}
          title={confirmAction?.title || 'Confirm'}
          description={confirmAction?.message}
          confirmLabel="Delete"
          destructive
          onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
          onCancel={() => setConfirmAction(null)}
        />
      </div>
    </div>
  )
}
