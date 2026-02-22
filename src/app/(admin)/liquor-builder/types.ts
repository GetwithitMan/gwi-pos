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
  containerType?: string | null   // 'bottle' | 'can' | 'draft' | 'glass'
  alcoholSubtype?: string | null  // beer: domestic/import/craft/seltzer/na; wine: red/white/rose/sparkling/dessert
  vintage?: number | null         // wine vintage year e.g. 2021
  sortOrder: number
  needsVerification: boolean
  verifiedAt?: string | null
  verifiedBy?: string | null
  hasMenuItem: boolean
  linkedMenuItems: {
    id: string
    name: string
    price: number
    isActive: boolean
    sortOrder: number
    category: { id: string; name: string }
  }[]
  inventoryItem?: {
    id: string
    name: string
    currentStock: number
    storageUnit: string
    costPerUnit: number
    parLevel: number | null
    prepItems: {
      id: string
      name: string
      outputUnit: string
      batchYield: number
      costPerUnit: number | null
      currentPrepStock: number
      isDailyCountItem: boolean
      isActive: boolean
    }[]
  } | null
}
