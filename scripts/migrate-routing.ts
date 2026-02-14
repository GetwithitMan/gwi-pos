/**
 * Migration Script: Old Printer System → Tag-Based Routing Engine
 *
 * This script migrates from the scattered routing logic (MenuItem.printerIds,
 * Category.printerIds, PizzaConfig.printerIds) to the unified Station model
 * with tag-based pub/sub routing.
 *
 * Run with: npx ts-node scripts/migrate-routing.ts
 *
 * What it does:
 * 1. Creates Station records from existing Printer records
 * 2. Assigns default tags based on printer role (kitchen→food, bar→bar)
 * 3. Creates pizza station from PizzaConfig.printerIds
 * 4. Creates expo station if needed
 * 5. Generates routeTags for categories based on categoryType
 *
 * This is NON-DESTRUCTIVE - it only adds new records, doesn't delete old ones.
 * The old printerIds fields remain for backwards compatibility.
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// Default tag mappings based on category type
const CATEGORY_TYPE_TO_TAGS: Record<string, string[]> = {
  food: ['kitchen', 'food'],
  drinks: ['bar'],
  liquor: ['bar'],
  pizza: ['pizza'],
  entertainment: ['entertainment'],
  combos: ['kitchen', 'food'],
  retail: ['kitchen'],  // Retail might print to default kitchen
}

// Printer role to station tags mapping
const PRINTER_ROLE_TO_TAGS: Record<string, string[]> = {
  kitchen: ['kitchen', 'food'],
  bar: ['bar'],
  receipt: [],  // Receipt printers don't need routing tags
  expo: ['expo'],
}

// Printer role to template type mapping
const PRINTER_ROLE_TO_TEMPLATE: Record<string, string> = {
  kitchen: 'STANDARD_KITCHEN',
  bar: 'BAR_TICKET',
  receipt: 'RECEIPT',
  expo: 'EXPO_SUMMARY',
}

interface MigrationResult {
  stationsCreated: number
  categoriesUpdated: number
  menuItemsUpdated: number
  pizzaStationCreated: boolean
  expoStationCreated: boolean
  errors: string[]
}

async function migrateRouting(locationId?: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    stationsCreated: 0,
    categoriesUpdated: 0,
    menuItemsUpdated: 0,
    pizzaStationCreated: false,
    expoStationCreated: false,
    errors: [],
  }

  try {
    // Get all locations to migrate (or specific one)
    // Note: Location is a root table, doesn't have deletedAt
    const locations = locationId
      ? await db.location.findMany({ where: { id: locationId } })
      : await db.location.findMany()

    console.log(`Migrating ${locations.length} location(s)...`)

    for (const location of locations) {
      console.log(`\n=== Location: ${location.name} (${location.id}) ===`)

      // 1. Migrate Printers to Stations
      const printers = await db.printer.findMany({
        where: { locationId: location.id, deletedAt: null },
      })

      console.log(`Found ${printers.length} printer(s) to migrate`)

      for (const printer of printers) {
        // Check if station already exists for this printer
        const existingStation = await db.station.findFirst({
          where: {
            locationId: location.id,
            ipAddress: printer.ipAddress,
            deletedAt: null,
          },
        })

        if (existingStation) {
          console.log(`  - Station already exists for ${printer.name} (${printer.ipAddress})`)
          continue
        }

        // Map printer role to tags and template
        const role = printer.printerRole || 'kitchen'
        const tags = PRINTER_ROLE_TO_TAGS[role] || ['kitchen']
        const templateType = PRINTER_ROLE_TO_TEMPLATE[role] || 'STANDARD_KITCHEN'

        const station = await db.station.create({
          data: {
            locationId: location.id,
            name: printer.name,
            displayName: printer.name,
            type: 'PRINTER',
            ipAddress: printer.ipAddress,
            port: printer.port || 9100,
            tags: tags,
            isExpo: role === 'expo',
            templateType,
            printerType: printer.printerType || 'thermal',
            printerModel: printer.model,  // Printer uses 'model', Station uses 'printerModel'
            paperWidth: printer.paperWidth || 80,
            supportsCut: printer.supportsCut ?? true,
            printSettings: printer.printSettings ?? undefined,
            isActive: printer.isActive,
            isDefault: printer.isDefault,
            showReferenceItems: true,
          },
        })

        console.log(`  + Created station: ${station.name} (tags: ${tags.join(', ')})`)
        result.stationsCreated++
      }

      // 2. Create Pizza Station from PizzaConfig
      const pizzaConfig = await db.pizzaConfig.findFirst({
        where: { locationId: location.id },
      })

      if (pizzaConfig && pizzaConfig.printerIds) {
        const pizzaPrinterIds = pizzaConfig.printerIds as string[]

        if (pizzaPrinterIds.length > 0) {
          // Find the first pizza printer
          const pizzaPrinter = await db.printer.findFirst({
            where: { id: { in: pizzaPrinterIds }, deletedAt: null },
          })

          if (pizzaPrinter) {
            // Check if a pizza station already exists
            // Fetch all stations and filter in application code
            const existingStations = await db.station.findMany({
              where: {
                locationId: location.id,
                deletedAt: null,
              },
            })
            const existingPizzaStation = existingStations.find((s) => {
              const tags = (s.tags as string[]) || []
              return tags.includes('pizza')
            })

            if (!existingPizzaStation) {
              const pizzaStation = await db.station.create({
                data: {
                  locationId: location.id,
                  name: 'Pizza Station',
                  displayName: 'Pizza Oven',
                  type: 'PRINTER',
                  ipAddress: pizzaPrinter.ipAddress,
                  port: pizzaPrinter.port || 9100,
                  tags: ['pizza'],
                  isExpo: false,
                  templateType: 'PIZZA_STATION',
                  printerType: pizzaPrinter.printerType || 'impact',
                  printerModel: pizzaPrinter.model,  // Printer uses 'model'
                  paperWidth: pizzaPrinter.paperWidth || 80,
                  supportsCut: pizzaPrinter.supportsCut ?? true,
                  printSettings: pizzaConfig.printSettings ?? undefined,
                  isActive: true,
                  showReferenceItems: true,
                },
              })

              console.log(`  + Created Pizza Station: ${pizzaStation.name}`)
              result.pizzaStationCreated = true
              result.stationsCreated++
            }
          }
        }
      }

      // 3. Create Expo Station if none exists
      const expoStation = await db.station.findFirst({
        where: {
          locationId: location.id,
          isExpo: true,
          deletedAt: null,
        },
      })

      if (!expoStation) {
        // Find any kitchen printer to use as expo
        const kitchenPrinter = await db.printer.findFirst({
          where: {
            locationId: location.id,
            printerRole: 'kitchen',
            deletedAt: null,
          },
        })

        if (kitchenPrinter) {
          const newExpoStation = await db.station.create({
            data: {
              locationId: location.id,
              name: 'Main Expo',
              displayName: 'Expo Station',
              type: 'PRINTER',
              ipAddress: kitchenPrinter.ipAddress,
              port: kitchenPrinter.port || 9100,
              tags: ['expo'],
              isExpo: true,
              templateType: 'EXPO_SUMMARY',
              printerType: kitchenPrinter.printerType || 'thermal',
              printerModel: kitchenPrinter.model,  // Printer uses 'model'
              paperWidth: kitchenPrinter.paperWidth || 80,
              supportsCut: true,
              isActive: true,
              showReferenceItems: false,  // Expo sees all items already
            },
          })

          console.log(`  + Created Expo Station: ${newExpoStation.name}`)
          result.expoStationCreated = true
          result.stationsCreated++
        }
      }

      // 4. Generate routeTags for Categories
      // Fetch all and filter in code since JSON null filtering is complex
      const allCategories = await db.category.findMany({
        where: {
          locationId: location.id,
          deletedAt: null,
        },
      })
      const categories = allCategories.filter((c) => !c.routeTags)

      console.log(`\nUpdating ${categories.length} categories with routeTags...`)

      for (const category of categories) {
        const categoryType = category.categoryType || 'food'
        const tags = CATEGORY_TYPE_TO_TAGS[categoryType] || ['kitchen']

        await db.category.update({
          where: { id: category.id },
          data: { routeTags: tags },
        })

        console.log(`  + ${category.name}: [${tags.join(', ')}]`)
        result.categoriesUpdated++
      }

      // 5. Generate routeTags for MenuItems with explicit printerIds
      // Fetch all and filter in code since JSON null filtering is complex
      const allMenuItems = await db.menuItem.findMany({
        where: {
          locationId: location.id,
          deletedAt: null,
        },
        include: {
          category: { select: { categoryType: true } },
        },
      })
      // Filter to items without routeTags but with printerIds
      const menuItems = allMenuItems.filter((item) => {
        const hasRouteTags = item.routeTags && (item.routeTags as string[]).length > 0
        const hasPrinterIds = item.printerIds && (item.printerIds as string[]).length > 0
        return !hasRouteTags && hasPrinterIds
      })

      console.log(`\nUpdating ${menuItems.length} menu items with routeTags...`)

      for (const item of menuItems) {
        const printerIds = (item.printerIds as string[]) || []
        if (printerIds.length === 0) continue

        // Get the printers to determine tags
        const printers = await db.printer.findMany({
          where: { id: { in: printerIds } },
        })

        // Collect unique tags from all printers
        const tags = new Set<string>()
        for (const printer of printers) {
          const role = printer.printerRole || 'kitchen'
          const roleTags = PRINTER_ROLE_TO_TAGS[role] || ['kitchen']
          roleTags.forEach((t) => tags.add(t))
        }

        if (tags.size > 0) {
          await db.menuItem.update({
            where: { id: item.id },
            data: { routeTags: Array.from(tags) },
          })

          console.log(`  + ${item.name}: [${Array.from(tags).join(', ')}]`)
          result.menuItemsUpdated++
        }
      }
    }

    console.log('\n=== Migration Complete ===')
    console.log(`Stations created: ${result.stationsCreated}`)
    console.log(`Categories updated: ${result.categoriesUpdated}`)
    console.log(`Menu items updated: ${result.menuItemsUpdated}`)
    console.log(`Pizza station created: ${result.pizzaStationCreated}`)
    console.log(`Expo station created: ${result.expoStationCreated}`)

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    result.errors.push(errorMsg)
    console.error('Migration error:', errorMsg)
  } finally {
    await db.$disconnect()
  }

  return result
}

// Run migration
const locationArg = process.argv[2]

migrateRouting(locationArg).then((result) => {
  if (result.errors.length > 0) {
    console.error('\nErrors occurred during migration:')
    result.errors.forEach((err) => console.error(`  - ${err}`))
    process.exit(1)
  }
  process.exit(0)
})
