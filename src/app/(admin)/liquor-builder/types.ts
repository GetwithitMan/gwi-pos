export interface SpiritCategory {
  id: string
  name: string
  displayName?: string | null
  description?: string | null
  sortOrder: number
  isActive: boolean
  bottleCount: number
  modifierGroupCount: number
}

export interface BottleProduct {
  id: string
  name: string
  brand?: string | null
  displayName?: string | null
  spiritCategoryId: string
  spiritCategory: {
    id: string
    name: string
    displayName?: string | null
  }
  tier: string
  bottleSizeMl: number
  bottleSizeOz?: number | null
  unitCost: number
  pourSizeOz?: number | null
  poursPerBottle?: number | null
  pourCost?: number | null
  currentStock: number
  lowStockAlert?: number | null
  isActive: boolean
  inventoryItemId?: string | null
  inventoryStock?: number | null
  hasMenuItem: boolean
  linkedMenuItems: {
    id: string
    name: string
    price: number
    isActive: boolean
    sortOrder: number
    category: { id: string; name: string }
  }[]
}
