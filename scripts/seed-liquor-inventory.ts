/**
 * Seed Liquor Inventory Script
 * Creates spirit categories and bottle products for the liquor builder
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Spirit tier mapping based on price ranges
function getTier(price: number): 'well' | 'call' | 'premium' | 'top_shelf' {
  if (price <= 6) return 'well'
  if (price <= 9) return 'call'
  if (price <= 13) return 'premium'
  return 'top_shelf'
}

// Category definitions
const CATEGORIES = [
  { name: 'Whiskey', displayName: 'Whiskey', description: 'Whiskey, Bourbon, Rye, Scotch' },
  { name: 'Vodka', displayName: 'Vodka', description: 'Vodka and flavored vodkas' },
  { name: 'Rum', displayName: 'Rum', description: 'White, spiced, dark, and aged rum' },
  { name: 'Tequila', displayName: 'Tequila', description: 'Blanco, Reposado, Añejo tequila' },
  { name: 'Gin', displayName: 'Gin', description: 'Gin and botanical spirits' },
  { name: 'Cocktails', displayName: 'Cocktails', description: 'Mixed drinks and cocktails' },
]

// Bottle products grouped by category
const BOTTLES = {
  Whiskey: [
    { name: "Blanton's", price: 15.00 },
    { name: 'Buffalo Trace', price: 7.00 },
    { name: 'Bulleit Bourbon', price: 8.00 },
    { name: 'Bulleit Rye', price: 8.00 },
    { name: 'Bushmills', price: 7.00 },
    { name: 'Crown Apple', price: 8.00 },
    { name: 'Crown Royal', price: 8.00 },
    { name: "Dewar's", price: 7.00 },
    { name: 'Eagle Rare', price: 12.00 },
    { name: 'Evan Williams', price: 5.50 },
    { name: 'Fireball', price: 6.00 },
    { name: 'Gentleman Jack', price: 9.00 },
    { name: 'Glenfiddich 12', price: 12.00 },
    { name: 'Glenlivet 12', price: 12.00 },
    { name: 'House Whiskey', price: 5.00 },
    { name: 'Jack Daniels', price: 7.00 },
    { name: 'Jack Fire', price: 7.00 },
    { name: 'Jack Honey', price: 7.00 },
    { name: 'Jameson', price: 7.00 },
    { name: 'Jim Beam', price: 6.00 },
    { name: 'Johnnie Walker Black', price: 10.00 },
    { name: 'Johnnie Walker Red', price: 7.00 },
    { name: 'Knob Creek', price: 9.00 },
    { name: 'Macallan 12', price: 15.00 },
    { name: "Maker's Mark", price: 8.00 },
    { name: 'Rittenhouse Rye', price: 8.00 },
    { name: 'Sazerac Rye', price: 9.00 },
    { name: "Seagram's 7", price: 6.00 },
    { name: 'Tullamore DEW', price: 7.00 },
    { name: 'Woodford Reserve', price: 9.00 },
  ],
  Vodka: [
    { name: 'Absolut', price: 7.00 },
    { name: 'Absolut Citron', price: 7.00 },
    { name: 'Absolut Vanilla', price: 7.00 },
    { name: 'Belvedere', price: 12.00 },
    { name: 'Chopin', price: 11.00 },
    { name: 'Ciroc', price: 12.00 },
    { name: 'Deep Eddy', price: 7.00 },
    { name: 'Deep Eddy Cranberry', price: 7.00 },
    { name: 'Deep Eddy Lemon', price: 7.00 },
    { name: 'Deep Eddy Peach', price: 7.00 },
    { name: 'Dripping Springs', price: 8.00 },
    { name: 'Grey Goose', price: 12.00 },
    { name: 'House Vodka', price: 5.00 },
    { name: 'Ketel One', price: 9.00 },
    { name: 'Skyy', price: 6.00 },
    { name: 'Smirnoff', price: 6.00 },
    { name: 'Stolichnaya', price: 7.00 },
    { name: "Tito's", price: 8.00 },
  ],
  Rum: [
    { name: 'Appleton Estate', price: 8.00 },
    { name: 'Bacardi Lime', price: 6.00 },
    { name: 'Bacardi Mango', price: 6.00 },
    { name: 'Bacardi Superior', price: 6.00 },
    { name: 'Captain Morgan', price: 6.00 },
    { name: 'Diplomatico Reserva', price: 12.00 },
    { name: 'Havana Club 3', price: 7.00 },
    { name: 'House Rum', price: 5.00 },
    { name: 'Kraken', price: 7.00 },
    { name: 'Malibu', price: 6.00 },
    { name: 'Mount Gay', price: 8.00 },
    { name: "Myers's", price: 7.00 },
    { name: 'Parrot Bay', price: 6.00 },
    { name: 'Ron Zacapa 23', price: 14.00 },
    { name: 'Sailor Jerry', price: 7.00 },
  ],
  Tequila: [
    { name: '1800 Anejo', price: 11.00 },
    { name: '1800 Reposado', price: 9.00 },
    { name: '1800 Silver', price: 9.00 },
    { name: 'Casamigos Anejo', price: 15.00 },
    { name: 'Casamigos Blanco', price: 12.00 },
    { name: 'Casamigos Reposado', price: 13.00 },
    { name: 'Clase Azul Plata', price: 20.00 },
    { name: 'Clase Azul Reposado', price: 54.00 },
    { name: 'Don Julio 1942 (Shot)', price: 28.00 },
    { name: 'Don Julio 1942 (Pour)', price: 47.00 },
    { name: 'Don Julio Anejo', price: 16.00 },
    { name: 'Don Julio Blanco', price: 13.00 },
    { name: 'Don Julio Reposado', price: 14.00 },
    { name: 'Espolon Blanco', price: 8.00 },
    { name: 'Espolon Reposado', price: 8.00 },
    { name: 'Hornitos Plata', price: 7.00 },
    { name: 'Hornitos Reposado', price: 7.00 },
    { name: 'House Tequila', price: 5.00 },
    { name: 'Jose Cuervo Gold', price: 6.00 },
    { name: 'Jose Cuervo Silver', price: 6.00 },
    { name: 'Patron Anejo', price: 15.00 },
    { name: 'Patron Reposado', price: 13.00 },
    { name: 'Patron Silver', price: 12.00 },
    { name: 'Sauza Silver', price: 6.00 },
  ],
  Gin: [
    { name: 'Aviation', price: 9.00 },
    { name: 'Beefeater', price: 6.00 },
    { name: 'Bombay Sapphire', price: 8.00 },
    { name: 'Empress 1908', price: 10.00 },
    { name: "Gordon's", price: 6.00 },
    { name: "Hendrick's", price: 10.00 },
    { name: 'House Gin', price: 5.00 },
    { name: 'Monkey 47', price: 14.00 },
    { name: "Nolet's Silver", price: 13.00 },
    { name: 'Roku', price: 10.00 },
    { name: 'Tanqueray', price: 8.00 },
    { name: 'Tanqueray No. Ten', price: 11.00 },
    { name: 'The Botanist', price: 11.00 },
  ],
  Cocktails: [
    { name: 'Amaretto Sour', price: 9.00 },
    { name: 'Aviation', price: 12.00 },
    { name: 'Bloody Mary', price: 10.00 },
    { name: 'Cosmopolitan', price: 11.00 },
    { name: 'Cuba Libre', price: 8.00 },
    { name: 'Daiquiri', price: 10.00 },
    { name: 'Dark & Stormy', price: 10.00 },
    { name: 'Espresso Martini', price: 13.00 },
    { name: 'French 75', price: 13.00 },
    { name: 'Frozen Margarita', price: 10.00 },
    { name: 'Gimlet', price: 10.00 },
    { name: 'Gin & Tonic', price: 9.00 },
    { name: 'Gin Martini', price: 12.00 },
    { name: 'Jack & Coke', price: 8.00 },
    { name: 'Lemon Drop', price: 10.00 },
    { name: 'Long Island Iced Tea', price: 12.00 },
    { name: 'Mai Tai', price: 12.00 },
    { name: 'Manhattan', price: 12.00 },
    { name: 'Margarita', price: 10.00 },
    { name: 'Margarita on Rocks', price: 10.00 },
    { name: 'Mexican Mule', price: 10.00 },
    { name: 'Mint Julep', price: 10.00 },
    { name: 'Mojito', price: 10.00 },
    { name: 'Moscow Mule', price: 10.00 },
    { name: 'Negroni', price: 12.00 },
    { name: 'Old Fashioned', price: 11.00 },
    { name: 'Paloma', price: 10.00 },
    { name: 'Pina Colada', price: 11.00 },
    { name: 'Ranch Water', price: 9.00 },
    { name: 'Screwdriver', price: 8.00 },
    { name: 'Tequila Sunrise', price: 9.00 },
    { name: 'Tom Collins', price: 10.00 },
    { name: 'Vodka Martini', price: 11.00 },
    { name: 'Vodka Soda', price: 7.00 },
    { name: 'Vodka Tonic', price: 8.00 },
    { name: 'Whiskey Sour', price: 10.00 },
    { name: 'Zombie', price: 12.00 },
  ],
}

async function main() {
  console.log('🍸 Seeding liquor inventory...\n')

  // Get location
  const location = await prisma.location.findFirst()
  if (!location) {
    throw new Error('No location found - please seed basic data first')
  }

  console.log(`📍 Location: ${location.name} (${location.id})\n`)

  // Step 1: Create categories
  console.log('📂 Creating spirit categories...')
  const categoryMap = new Map<string, string>()

  for (const categoryDef of CATEGORIES) {
    // Check if category already exists
    let category = await prisma.spiritCategory.findFirst({
      where: {
        locationId: location.id,
        name: categoryDef.name,
        deletedAt: null,
      },
    })

    if (category) {
      console.log(`  ✓ Category "${categoryDef.name}" already exists`)
    } else {
      // Get max sort order
      const maxSortOrder = await prisma.spiritCategory.aggregate({
        where: { locationId: location.id },
        _max: { sortOrder: true },
      })

      category = await prisma.spiritCategory.create({
        data: {
          locationId: location.id,
          name: categoryDef.name,
          displayName: categoryDef.displayName,
          description: categoryDef.description,
          sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        },
      })
      console.log(`  ✓ Created category "${categoryDef.name}"`)
    }

    categoryMap.set(categoryDef.name, category.id)
  }

  console.log(`\n✅ ${categoryMap.size} categories ready\n`)

  // Step 2: Create bottles
  console.log('🍾 Creating bottle products...')
  let totalCreated = 0
  let totalSkipped = 0

  for (const [categoryName, bottles] of Object.entries(BOTTLES)) {
    const categoryId = categoryMap.get(categoryName)
    if (!categoryId) {
      console.warn(`  ⚠️  Skipping ${categoryName} - category not found`)
      continue
    }

    console.log(`\n  ${categoryName}:`)

    for (const bottleDef of bottles) {
      // Check if bottle already exists (name must be unique per location)
      const existing = await prisma.bottleProduct.findFirst({
        where: {
          locationId: location.id,
          name: bottleDef.name,
          deletedAt: null,
        },
      })

      if (existing) {
        console.log(`    - ${bottleDef.name} (already exists)`)
        totalSkipped++
        continue
      }

      // Determine tier based on price
      const tier = getTier(bottleDef.price)

      // Standard bottle defaults
      const bottleSizeMl = 750 // Standard bottle
      const unitCost = bottleDef.price * 0.25 // Estimate: sell price * 0.25 = cost
      const pourSizeOz = 1.5 // Standard pour

      // Calculate metrics
      const bottleSizeOz = bottleSizeMl / 29.5735
      const pourSizeMl = pourSizeOz * 29.5735
      const poursPerBottle = Math.floor(bottleSizeMl / pourSizeMl)
      const pourCost = poursPerBottle > 0 ? unitCost / poursPerBottle : 0

      // Check if inventory item already exists
      let inventoryItem = await prisma.inventoryItem.findFirst({
        where: {
          locationId: location.id,
          name: bottleDef.name,
          deletedAt: null,
        },
      })

      // Create inventory item if it doesn't exist
      if (!inventoryItem) {
        inventoryItem = await prisma.inventoryItem.create({
          data: {
            locationId: location.id,
            name: bottleDef.name,
            description: `${categoryName} - ${tier}`,
            department: 'Beverage',
            itemType: 'liquor',
            revenueCenter: 'bar',
            category: categoryName.toLowerCase(),
            subcategory: tier,
            purchaseUnit: 'bottle',
            purchaseSize: 1,
            purchaseCost: unitCost,
            storageUnit: 'oz',
            unitsPerPurchase: bottleSizeOz,
            costPerUnit: pourCost,
            spiritCategoryId: categoryId,
            pourSizeOz: pourSizeOz,
            currentStock: 0,
            isActive: true,
            trackInventory: true,
          },
        })
      }

      // Create bottle product
      await prisma.bottleProduct.create({
        data: {
          locationId: location.id,
          name: bottleDef.name,
          brand: null,
          displayName: null,
          spiritCategoryId: categoryId,
          tier,
          bottleSizeMl,
          bottleSizeOz,
          unitCost,
          pourSizeOz,
          poursPerBottle,
          pourCost,
          currentStock: 0,
          lowStockAlert: 2,
          inventoryItemId: inventoryItem.id,
        },
      })

      console.log(`    ✓ ${bottleDef.name} ($${bottleDef.price.toFixed(2)} - ${tier})`)
      totalCreated++
    }
  }

  console.log(`\n✅ Created ${totalCreated} new bottles`)
  console.log(`ℹ️  Skipped ${totalSkipped} existing bottles`)
  console.log('\n🎉 Liquor inventory seeding complete!\n')
}

main()
  .catch((e) => {
    console.error('\n❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
