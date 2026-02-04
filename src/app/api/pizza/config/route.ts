import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PizzaPrintSettings } from '@/types/pizza-print-settings'

// GET /api/pizza/config - Get pizza configuration for location
export async function GET() {
  try {
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    let config = await db.pizzaConfig.findUnique({
      where: { locationId: location.id }
    })

    // Create default config if doesn't exist
    if (!config) {
      config = await db.pizzaConfig.create({
        data: {
          locationId: location.id,
          maxSections: 8,
          defaultSections: 2,
          sectionOptions: [1, 2, 4, 8],
          pricingMode: 'fractional',
          freeToppingsEnabled: false,
          freeToppingsCount: 0,
          freeToppingsMode: 'per_pizza',
          showVisualBuilder: true,
          showToppingList: true,
          defaultToListView: false,
          builderMode: 'both',
          defaultBuilderMode: 'quick',
          allowModeSwitch: true,
        }
      })
    }

    return NextResponse.json({
      ...config,
      sectionOptions: config.sectionOptions as number[],
      hybridPricing: config.hybridPricing as Record<string, number> | null,
      extraToppingPrice: config.extraToppingPrice ? Number(config.extraToppingPrice) : null,
      printerIds: (config.printerIds as string[]) || [],
      printSettings: config.printSettings as PizzaPrintSettings | null,
      builderMode: config.builderMode || 'both',
      defaultBuilderMode: config.defaultBuilderMode || 'quick',
      allowModeSwitch: config.allowModeSwitch ?? true,
    })
  } catch (error) {
    console.error('Failed to get pizza config:', error)
    return NextResponse.json({ error: 'Failed to get pizza config' }, { status: 500 })
  }
}

// PATCH /api/pizza/config - Update pizza configuration
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const config = await db.pizzaConfig.upsert({
      where: { locationId: location.id },
      update: {
        ...(body.maxSections !== undefined && { maxSections: body.maxSections }),
        ...(body.defaultSections !== undefined && { defaultSections: body.defaultSections }),
        ...(body.sectionOptions !== undefined && { sectionOptions: body.sectionOptions }),
        ...(body.pricingMode !== undefined && { pricingMode: body.pricingMode }),
        ...(body.hybridPricing !== undefined && { hybridPricing: body.hybridPricing }),
        ...(body.freeToppingsEnabled !== undefined && { freeToppingsEnabled: body.freeToppingsEnabled }),
        ...(body.freeToppingsCount !== undefined && { freeToppingsCount: body.freeToppingsCount }),
        ...(body.freeToppingsMode !== undefined && { freeToppingsMode: body.freeToppingsMode }),
        ...(body.extraToppingPrice !== undefined && { extraToppingPrice: body.extraToppingPrice }),
        ...(body.showVisualBuilder !== undefined && { showVisualBuilder: body.showVisualBuilder }),
        ...(body.showToppingList !== undefined && { showToppingList: body.showToppingList }),
        ...(body.defaultToListView !== undefined && { defaultToListView: body.defaultToListView }),
        ...(body.printerIds !== undefined && { printerIds: body.printerIds || [] }),
        ...(body.printSettings !== undefined && { printSettings: body.printSettings }),
        ...(body.builderMode !== undefined && { builderMode: body.builderMode }),
        ...(body.defaultBuilderMode !== undefined && { defaultBuilderMode: body.defaultBuilderMode }),
        ...(body.allowModeSwitch !== undefined && { allowModeSwitch: body.allowModeSwitch }),
      },
      create: {
        locationId: location.id,
        maxSections: body.maxSections ?? 8,
        defaultSections: body.defaultSections ?? 2,
        sectionOptions: body.sectionOptions ?? [1, 2, 4, 8],
        pricingMode: body.pricingMode ?? 'fractional',
        hybridPricing: body.hybridPricing,
        freeToppingsEnabled: body.freeToppingsEnabled ?? false,
        freeToppingsCount: body.freeToppingsCount ?? 0,
        freeToppingsMode: body.freeToppingsMode ?? 'per_pizza',
        extraToppingPrice: body.extraToppingPrice,
        showVisualBuilder: body.showVisualBuilder ?? true,
        showToppingList: body.showToppingList ?? true,
        defaultToListView: body.defaultToListView ?? false,
        printerIds: body.printerIds || [],
        printSettings: body.printSettings,
        builderMode: body.builderMode ?? 'both',
        defaultBuilderMode: body.defaultBuilderMode ?? 'quick',
        allowModeSwitch: body.allowModeSwitch ?? true,
      }
    })

    return NextResponse.json({
      ...config,
      sectionOptions: config.sectionOptions as number[],
      hybridPricing: config.hybridPricing as Record<string, number> | null,
      extraToppingPrice: config.extraToppingPrice ? Number(config.extraToppingPrice) : null,
      printerIds: (config.printerIds as string[]) || [],
      printSettings: config.printSettings as PizzaPrintSettings | null,
      builderMode: config.builderMode || 'both',
      defaultBuilderMode: config.defaultBuilderMode || 'quick',
      allowModeSwitch: config.allowModeSwitch ?? true,
    })
  } catch (error) {
    console.error('Failed to update pizza config:', error)
    return NextResponse.json({ error: 'Failed to update pizza config' }, { status: 500 })
  }
}
