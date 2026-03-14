/**
 * seed-cocktails.ts
 *
 * Restores the full cocktail menu from the pre-reset database, including:
 *   - Cocktails category (cat-cocktails, matching old DB)
 *   - 37 unique cocktails with correct names + prices from old backup
 *   - Recipe ingredients linking each cocktail to its BottleProducts
 *   - Per-item spirit tier upgrade groups (Well / Call / Premium / Top Shelf)
 *   - Shared modifier templates: Mixers, Garnish, Ice, Margarita Style/Flavor
 *   - Margarita Style + Flavor groups pre-attached to all margarita variants
 *
 * Requires seed-liquor.ts to have already been run (needs the BottleProducts).
 *
 * Usage:
 *   npm run db:seed-cocktails
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const LOC = 'loc-1'

// ─── Spirit lookup: catId + bottle IDs per tier ───────────────────────────────
const SPIRIT: Record<string, { catId: string; well: string; call: string; premium: string; top: string }> = {
  vodka:   { catId: 'sc-vodka',   well: 'bottle-vodka-well',    call: 'bottle-vodka-call',    premium: 'bottle-vodka-premium', top: 'bottle-vodka-top'    },
  gin:     { catId: 'sc-gin',     well: 'bottle-gin-well',      call: 'bottle-gin-call',      premium: 'bottle-gin-premium',   top: 'bottle-gin-top'      },
  rum:     { catId: 'sc-rum',     well: 'bottle-rum-well',      call: 'bottle-rum-call',      premium: 'bottle-rum-premium',   top: 'bottle-rum-top'      },
  tequila: { catId: 'sc-tequila', well: 'bottle-tequila-well',  call: 'bottle-tequila-call',  premium: 'bottle-tequila-premium', top: 'bottle-tequila-top' },
  whiskey: { catId: 'sc-whiskey', well: 'bottle-whiskey-well',  call: 'bottle-whiskey-call',  premium: 'bottle-whiskey-premium', top: 'bottle-whiskey-top' },
  bourbon: { catId: 'sc-bourbon', well: 'bottle-bourbon-well',  call: 'bottle-bourbon-call',  premium: 'bottle-bourbon-premium', top: 'bottle-bourbon-top' },
}

// ─── Tier upcharges (matching seed-liquor.ts) ─────────────────────────────────
const TIERS = {
  well:      { label: 'Well',      upcharge: 0.00, sortOrder: 1, isDefault: true  },
  call:      { label: 'Call',      upcharge: 2.50, sortOrder: 2, isDefault: false },
  premium:   { label: 'Premium',   upcharge: 5.00, sortOrder: 3, isDefault: false },
  top_shelf: { label: 'Top Shelf', upcharge: 8.00, sortOrder: 4, isDefault: false },
}

// ─── Cocktail definitions (from old backup, de-duplicated) ────────────────────
// spirit: key into SPIRIT map, or null for no tier upgrade
// recipe: [ { b: bottleId, pc: pourCount, sub: isSubstitutable } ]
// extras: optional extra modifier group keys to attach (marg-style | marg-flavor)
interface RecipeStep { b: string; pc: number; sub: boolean; notes?: string }
interface CocktailDef {
  id: string; name: string; price: number; so: number
  spirit: string | null
  recipe: RecipeStep[]
  extras?: string[]    // 'marg-style' | 'marg-flavor'
}

const COCKTAILS: CocktailDef[] = [
  // ── $7 ──────────────────────────────────────────────────────────────────────
  { id: 'cocktail-vodka-soda',     name: 'Vodka Soda',          price: 7,  so: 1,  spirit: 'vodka',   recipe: [{ b: 'bottle-vodka-well', pc: 1.0, sub: true }] },

  // ── $8 ──────────────────────────────────────────────────────────────────────
  { id: 'cocktail-cuba-libre',     name: 'Cuba Libre',          price: 8,  so: 2,  spirit: 'rum',     recipe: [{ b: 'bottle-rum-well',     pc: 1.0, sub: true }] },
  { id: 'cocktail-jack-coke',      name: 'Jack & Coke',         price: 8,  so: 3,  spirit: 'whiskey', recipe: [{ b: 'bottle-whiskey-well', pc: 1.0, sub: true }] },
  { id: 'cocktail-screwdriver',    name: 'Screwdriver',         price: 8,  so: 4,  spirit: 'vodka',   recipe: [{ b: 'bottle-vodka-well',   pc: 1.0, sub: true }] },
  { id: 'cocktail-vodka-tonic',    name: 'Vodka Tonic',         price: 8,  so: 5,  spirit: 'vodka',   recipe: [{ b: 'bottle-vodka-well',   pc: 1.0, sub: true }] },

  // ── $9 ──────────────────────────────────────────────────────────────────────
  { id: 'cocktail-amaretto-sour',  name: 'Amaretto Sour',       price: 9,  so: 6,  spirit: null,      recipe: [{ b: 'bottle-cordial-amaretto',  pc: 1.0, sub: false }] },
  { id: 'cocktail-gin-tonic',      name: 'Gin & Tonic',         price: 9,  so: 7,  spirit: 'gin',     recipe: [{ b: 'bottle-gin-well',     pc: 1.0, sub: true }] },
  { id: 'cocktail-ranch-water',    name: 'Ranch Water',         price: 9,  so: 8,  spirit: 'tequila', recipe: [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }] },
  { id: 'cocktail-tequila-sunrise',name: 'Tequila Sunrise',     price: 9,  so: 9,  spirit: 'tequila', recipe: [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }] },

  // ── $10 ─────────────────────────────────────────────────────────────────────
  { id: 'cocktail-bloody-mary',    name: 'Bloody Mary',         price: 10, so: 10, spirit: 'vodka',   recipe: [{ b: 'bottle-vodka-well',   pc: 1.0, sub: true }] },
  { id: 'cocktail-daiquiri',       name: 'Daiquiri',            price: 10, so: 11, spirit: 'rum',     recipe: [{ b: 'bottle-rum-well',     pc: 1.0, sub: true }] },
  { id: 'cocktail-dark-stormy',    name: 'Dark & Stormy',       price: 10, so: 12, spirit: 'rum',     recipe: [{ b: 'bottle-rum-premium',  pc: 1.0, sub: true, notes: 'Dark rum float' }] },
  { id: 'cocktail-frozen-marg',    name: 'Frozen Margarita',    price: 10, so: 13, spirit: 'tequila',
    recipe:  [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false }],
    extras:  ['marg-flavor'] },
  { id: 'cocktail-gimlet',         name: 'Gimlet',              price: 10, so: 14, spirit: 'gin',     recipe: [{ b: 'bottle-gin-well',     pc: 1.0, sub: true }] },
  { id: 'cocktail-lemon-drop',     name: 'Lemon Drop',          price: 10, so: 15, spirit: 'vodka',
    recipe:  [{ b: 'bottle-vodka-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false }] },
  { id: 'cocktail-margarita',      name: 'Margarita',           price: 10, so: 16, spirit: 'tequila',
    recipe:  [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false }],
    extras:  ['marg-style', 'marg-flavor'] },
  { id: 'cocktail-marg-rocks',     name: 'Margarita on Rocks',  price: 10, so: 17, spirit: 'tequila',
    recipe:  [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false }],
    extras:  ['marg-flavor'] },
  { id: 'cocktail-mexican-mule',   name: 'Mexican Mule',        price: 10, so: 18, spirit: 'tequila', recipe: [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }] },
  { id: 'cocktail-mint-julep',     name: 'Mint Julep',          price: 10, so: 19, spirit: 'bourbon', recipe: [{ b: 'bottle-bourbon-well', pc: 1.33, sub: true, notes: '2 oz bourbon' }] },
  { id: 'cocktail-mojito',         name: 'Mojito',              price: 10, so: 20, spirit: 'rum',     recipe: [{ b: 'bottle-rum-well',     pc: 1.0, sub: true }] },
  { id: 'cocktail-moscow-mule',    name: 'Moscow Mule',         price: 10, so: 21, spirit: 'vodka',   recipe: [{ b: 'bottle-vodka-well',   pc: 1.0, sub: true }] },
  { id: 'cocktail-paloma',         name: 'Paloma',              price: 10, so: 22, spirit: 'tequila', recipe: [{ b: 'bottle-tequila-well', pc: 1.0, sub: true }] },
  { id: 'cocktail-tom-collins',    name: 'Tom Collins',         price: 10, so: 23, spirit: 'gin',     recipe: [{ b: 'bottle-gin-well',     pc: 1.0, sub: true }] },
  { id: 'cocktail-whiskey-sour',   name: 'Whiskey Sour',        price: 10, so: 24, spirit: 'whiskey', recipe: [{ b: 'bottle-whiskey-well', pc: 1.0, sub: true }] },

  // ── $11 ─────────────────────────────────────────────────────────────────────
  { id: 'cocktail-cosmopolitan',   name: 'Cosmopolitan',        price: 11, so: 25, spirit: 'vodka',
    recipe:  [{ b: 'bottle-vodka-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false }] },
  { id: 'cocktail-old-fashioned',  name: 'Old Fashioned',       price: 11, so: 26, spirit: 'bourbon', recipe: [{ b: 'bottle-bourbon-well', pc: 1.33, sub: true, notes: '2 oz bourbon' }] },
  { id: 'cocktail-pina-colada',    name: 'Pina Colada',         price: 11, so: 27, spirit: 'rum',     recipe: [{ b: 'bottle-rum-premium',  pc: 1.0, sub: true, notes: 'Spiced rum' }] },
  { id: 'cocktail-vodka-martini',  name: 'Vodka Martini',       price: 11, so: 28, spirit: 'vodka',   recipe: [{ b: 'bottle-vodka-well',   pc: 1.33, sub: true, notes: '2 oz, shaken/stirred' }] },

  // ── $12 ─────────────────────────────────────────────────────────────────────
  { id: 'cocktail-aviation',       name: 'Aviation',            price: 12, so: 29, spirit: 'gin',
    recipe:  [{ b: 'bottle-gin-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-chambord', pc: 0.33, sub: false, notes: 'Sub for maraschino' }] },
  { id: 'cocktail-gin-martini',    name: 'Gin Martini',         price: 12, so: 30, spirit: 'gin',     recipe: [{ b: 'bottle-gin-well',     pc: 1.33, sub: true, notes: '2 oz, shaken/stirred' }] },
  { id: 'cocktail-liit',           name: 'Long Island Iced Tea',price: 12, so: 31, spirit: null,
    recipe:  [
      { b: 'bottle-vodka-well',         pc: 0.33, sub: false },
      { b: 'bottle-gin-well',           pc: 0.33, sub: false },
      { b: 'bottle-rum-well',           pc: 0.33, sub: false },
      { b: 'bottle-tequila-well',       pc: 0.33, sub: false },
      { b: 'bottle-cordial-triplesec',  pc: 0.33, sub: false },
    ] },
  { id: 'cocktail-mai-tai',        name: 'Mai Tai',             price: 12, so: 32, spirit: 'rum',
    recipe:  [{ b: 'bottle-rum-well', pc: 0.67, sub: true }, { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false }] },
  { id: 'cocktail-manhattan',      name: 'Manhattan',           price: 12, so: 33, spirit: 'whiskey', recipe: [{ b: 'bottle-whiskey-well', pc: 1.33, sub: true, notes: '2 oz rye/blended' }] },
  { id: 'cocktail-negroni',        name: 'Negroni',             price: 12, so: 34, spirit: 'gin',     recipe: [{ b: 'bottle-gin-well',     pc: 1.0, sub: true }] },

  // ── $13 ─────────────────────────────────────────────────────────────────────
  { id: 'cocktail-espresso-martini',name: 'Espresso Martini',   price: 13, so: 35, spirit: 'vodka',
    recipe:  [{ b: 'bottle-vodka-well', pc: 1.0, sub: true }, { b: 'bottle-cordial-kahlua', pc: 0.33, sub: false }] },
  { id: 'cocktail-french-75',      name: 'French 75',           price: 13, so: 36, spirit: 'gin',     recipe: [{ b: 'bottle-gin-well',     pc: 0.67, sub: true, notes: '1 oz gin + champagne' }] },

  // ── $14 ─────────────────────────────────────────────────────────────────────
  { id: 'cocktail-zombie',         name: 'Zombie',              price: 14, so: 37, spirit: 'rum',
    recipe:  [
      { b: 'bottle-rum-well',     pc: 0.5,  sub: true,  notes: 'Light rum'     },
      { b: 'bottle-rum-call',     pc: 0.5,  sub: true,  notes: 'Dark rum'      },
      { b: 'bottle-rum-top',      pc: 0.33, sub: false, notes: 'Overproof float' },
      { b: 'bottle-cordial-triplesec', pc: 0.33, sub: false },
    ] },
]

// ─── Shared modifier template groups (restored from old backup) ───────────────
const SHARED_GROUPS = [
  {
    id:        'mod-mixers',
    name:      'Mixers',
    displayName:'Add Mixer',
    min: 0, max: 3,
    modifiers: [
      { id: 'mixer-coke',       name: 'Coke',           price: 0,    so: 0  },
      { id: 'mixer-diet-coke',  name: 'Diet Coke',       price: 0,    so: 1  },
      { id: 'mixer-sprite',     name: 'Sprite',          price: 0,    so: 2  },
      { id: 'mixer-ginger-ale', name: 'Ginger Ale',      price: 0,    so: 3  },
      { id: 'mixer-tonic',      name: 'Tonic Water',     price: 0,    so: 4  },
      { id: 'mixer-soda',       name: 'Soda Water',      price: 0,    so: 5  },
      { id: 'mixer-cranberry',  name: 'Cranberry Juice', price: 0,    so: 6  },
      { id: 'mixer-oj',         name: 'Orange Juice',    price: 0,    so: 7  },
      { id: 'mixer-pineapple',  name: 'Pineapple Juice', price: 0,    so: 8  },
      { id: 'mixer-grapefruit', name: 'Grapefruit Juice',price: 0,    so: 9  },
      { id: 'mixer-redbull',    name: 'Red Bull',         price: 3.00, so: 10 },
      { id: 'mixer-ginger-beer',name: 'Ginger Beer',     price: 1.00, so: 11 },
      { id: 'mixer-topo',       name: 'Topo Chico',      price: 1.00, so: 12 },
      { id: 'mixer-sweet-sour', name: 'Sweet & Sour',    price: 0,    so: 13 },
      { id: 'mixer-water',      name: 'Water Back',       price: 0,    so: 14 },
      { id: 'mixer-pickle',     name: 'Pickle Juice',    price: 0,    so: 15 },
    ],
  },
  {
    id:        'mod-garnish',
    name:      'Garnish',
    displayName:'Garnish',
    min: 0, max: 5,
    modifiers: [
      { id: 'garnish-lime',    name: 'Lime',           price: 0,    so: 0,  def: false },
      { id: 'garnish-lemon',   name: 'Lemon',          price: 0,    so: 1,  def: false },
      { id: 'garnish-orange',  name: 'Orange',         price: 0,    so: 2,  def: false },
      { id: 'garnish-cherry',  name: 'Cherry',         price: 0,    so: 3,  def: false },
      { id: 'garnish-olive',   name: 'Olive',          price: 0,    so: 4,  def: false },
      { id: 'garnish-olive-2', name: 'Extra Olives',   price: 0.50, so: 5,  def: false },
      { id: 'garnish-onion',   name: 'Cocktail Onion', price: 0,    so: 6,  def: false },
      { id: 'garnish-celery',  name: 'Celery Stalk',   price: 0,    so: 7,  def: false },
      { id: 'garnish-mint',    name: 'Fresh Mint',     price: 0,    so: 8,  def: false },
      { id: 'garnish-salt',    name: 'Salt Rim',        price: 0,    so: 9,  def: false },
      { id: 'garnish-sugar',   name: 'Sugar Rim',       price: 0,    so: 10, def: false },
      { id: 'garnish-tajin',   name: 'Tajin Rim',       price: 0.50, so: 11, def: false },
      { id: 'garnish-no',      name: 'No Garnish',      price: 0,    so: 12, def: false },
    ],
  },
  {
    id:        'mod-ice',
    name:      'Ice',
    displayName:'Ice Preference',
    min: 0, max: 1,
    modifiers: [
      { id: 'ice-regular', name: 'Regular Ice',  price: 0, so: 0, def: true  },
      { id: 'ice-light',   name: 'Light Ice',    price: 0, so: 1, def: false },
      { id: 'ice-extra',   name: 'Extra Ice',    price: 0, so: 2, def: false },
      { id: 'ice-no',      name: 'No Ice',       price: 0, so: 3, def: false },
      { id: 'ice-neat',    name: 'Neat',         price: 0, so: 4, def: false },
      { id: 'ice-rocks',   name: 'On the Rocks', price: 0, so: 5, def: false },
      { id: 'ice-up',      name: 'Up',           price: 0, so: 6, def: false },
    ],
  },
]

// Margarita-specific groups — get attached to margarita cocktails directly
const MARG_STYLE_GROUP = {
  id: 'mod-marg-style', name: 'Margarita Style', displayName: 'Style', min: 1, max: 1, required: true,
  modifiers: [
    { id: 'marg-rocks',   name: 'On the Rocks',  price: 0, so: 0, def: true  },
    { id: 'marg-frozen',  name: 'Frozen/Blended',price: 0, so: 1, def: false },
    { id: 'marg-up',      name: 'Up',            price: 0, so: 2, def: false },
  ],
}

const MARG_FLAVOR_GROUP = {
  id: 'mod-marg-flavor', name: 'Margarita Flavor', displayName: 'Flavor', min: 0, max: 1, required: false,
  modifiers: [
    { id: 'marg-classic',      name: 'Classic Lime',    price: 0,    so: 0, def: true  },
    { id: 'marg-strawberry',   name: 'Strawberry',      price: 1.00, so: 1, def: false },
    { id: 'marg-mango',        name: 'Mango',           price: 1.00, so: 2, def: false },
    { id: 'marg-peach',        name: 'Peach',           price: 1.00, so: 3, def: false },
    { id: 'marg-raspberry',    name: 'Raspberry',       price: 1.00, so: 4, def: false },
    { id: 'marg-blood-orange', name: 'Blood Orange',    price: 1.00, so: 5, def: false },
    { id: 'marg-prickly-pear', name: 'Prickly Pear',   price: 1.50, so: 6, def: false },
    { id: 'marg-watermelon',   name: 'Watermelon',      price: 1.00, so: 7, def: false },
    { id: 'marg-jalapeno',     name: 'Spicy Jalapeño',  price: 1.00, so: 8, def: false },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────

async function upsertModifiers(groupId: string, modifiers: any[]) {
  for (const m of modifiers) {
    await prisma.modifier.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id:             m.id,
        locationId:     LOC,
        modifierGroupId:groupId,
        name:           m.name,
        price:          m.price,
        priceType:      'upcharge',
        isDefault:      m.def ?? false,
        isActive:       true,
        showOnPOS:      true,
        sortOrder:      m.so,
        printerRouting: 'follow',
      },
    })
  }
}

async function main() {
  console.log('\n🍹 GWI Cocktails Seed\n')

  // ── 1. Cocktails menu category ────────────────────────────────────────────
  console.log('  [1/5] Cocktails menu category...')
  await prisma.category.upsert({
    where: { id: 'cat-cocktails' },
    update: {},
    create: {
      id:          'cat-cocktails',
      locationId:  LOC,
      name:        'Cocktails',
      color:       '#db2777',
      categoryType:'liquor',
      sortOrder:   15,
      isActive:    true,
      showOnPOS:   true,
    },
  })
  console.log('  ✓ Cocktails (cat-cocktails)')

  // ── 2. Shared modifier templates ──────────────────────────────────────────
  console.log('\n  [2/5] Shared modifier templates (Mixers / Garnish / Ice)...')

  // Shared templates (menuItemId = null → appear in Templates panel)
  for (const group of SHARED_GROUPS) {
    await prisma.modifierGroup.upsert({
      where: { id: group.id },
      update: {},
      create: {
        id:            group.id,
        locationId:    LOC,
        name:          group.name,
        displayName:   group.displayName,
        modifierTypes: ['liquor'],
        minSelections: group.min,
        maxSelections: group.max,
        isRequired:    false,
        sortOrder:     SHARED_GROUPS.indexOf(group) + 1,
      },
    })
    await upsertModifiers(group.id, group.modifiers)
    console.log(`  ✓ ${group.name} (${group.modifiers.length} options)`)
  }

  // Margarita Style — shared template
  await prisma.modifierGroup.upsert({
    where: { id: MARG_STYLE_GROUP.id },
    update: {},
    create: {
      id:            MARG_STYLE_GROUP.id,
      locationId:    LOC,
      name:          MARG_STYLE_GROUP.name,
      displayName:   MARG_STYLE_GROUP.displayName,
      modifierTypes: ['liquor'],
      minSelections: MARG_STYLE_GROUP.min,
      maxSelections: MARG_STYLE_GROUP.max,
      isRequired:    MARG_STYLE_GROUP.required,
      sortOrder:     4,
    },
  })
  await upsertModifiers(MARG_STYLE_GROUP.id, MARG_STYLE_GROUP.modifiers)

  // Margarita Flavor — shared template
  await prisma.modifierGroup.upsert({
    where: { id: MARG_FLAVOR_GROUP.id },
    update: {},
    create: {
      id:            MARG_FLAVOR_GROUP.id,
      locationId:    LOC,
      name:          MARG_FLAVOR_GROUP.name,
      displayName:   MARG_FLAVOR_GROUP.displayName,
      modifierTypes: ['liquor'],
      minSelections: MARG_FLAVOR_GROUP.min,
      maxSelections: MARG_FLAVOR_GROUP.max,
      isRequired:    MARG_FLAVOR_GROUP.required,
      sortOrder:     5,
    },
  })
  await upsertModifiers(MARG_FLAVOR_GROUP.id, MARG_FLAVOR_GROUP.modifiers)
  console.log(`  ✓ Margarita Style (3 options) + Flavor (9 options)`)

  // ── 3. Create cocktail menu items ─────────────────────────────────────────
  console.log('\n  [3/5] Creating 37 cocktail menu items...')
  for (const c of COCKTAILS) {
    await prisma.menuItem.upsert({
      where:  { id: c.id },
      update: {},
      create: {
        id:          c.id,
        locationId:  LOC,
        categoryId:  'cat-cocktails',
        name:        c.name,
        price:       c.price,
        itemType:    'standard',
        isActive:    true,
        showOnPOS:   true,
        sortOrder:   c.so,
      },
    })
  }
  console.log(`  ✓ ${COCKTAILS.length} cocktails created`)

  // ── 4. Spirit upgrade groups + recipe ingredients ─────────────────────────
  console.log('\n  [4/5] Spirit upgrades + recipe ingredients...')

  let upgradeCount = 0
  let recipeCount  = 0

  for (const c of COCKTAILS) {
    // ── Recipe ingredients (bottles in the drink) ──────────────────────────
    for (let i = 0; i < c.recipe.length; i++) {
      const step = c.recipe[i]
      await prisma.recipeIngredient.upsert({
        where:  { menuItemId_bottleProductId: { menuItemId: c.id, bottleProductId: step.b } },
        update: {},
        create: {
          locationId:     LOC,
          menuItemId:     c.id,
          bottleProductId:step.b,
          pourCount:      step.pc,
          isRequired:     true,
          isSubstitutable:step.sub,
          sortOrder:      i,
          notes:          step.notes ?? null,
        },
      })
      recipeCount++
    }

    // ── Spirit tier upgrade group (per-item) ───────────────────────────────
    if (!c.spirit) continue

    const sp    = SPIRIT[c.spirit]
    const mgId  = `cmg-${c.id.replace('cocktail-', '')}`
    const smgId = `csmg-${c.id.replace('cocktail-', '')}`

    const modGroup = await prisma.modifierGroup.upsert({
      where:  { id: mgId },
      update: {},
      create: {
        id:            mgId,
        locationId:    LOC,
        menuItemId:    c.id,
        name:          'Spirit Upgrades',
        modifierTypes: ['liquor'],
        isSpiritGroup: true,
        minSelections: 1,
        maxSelections: 1,
        isRequired:    true,
        sortOrder:     0,
      },
    })

    const tierEntries: [string, string][] = [
      ['well',      sp.well    ],
      ['call',      sp.call    ],
      ['premium',   sp.premium ],
      ['top_shelf', sp.top     ],
    ]
    for (const [tierKey, bottleId] of tierEntries) {
      const tier  = TIERS[tierKey as keyof typeof TIERS]
      const modId = `cm-${c.id.replace('cocktail-', '')}-${tierKey.replace('_', '-')}`
      await prisma.modifier.upsert({
        where:  { id: modId },
        update: {},
        create: {
          id:                   modId,
          locationId:           LOC,
          modifierGroupId:      modGroup.id,
          name:                 bottleId.replace('bottle-', '').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          displayName:          tier.label,
          price:                tier.upcharge,
          priceType:            'upcharge',
          spiritTier:           tierKey,
          linkedBottleProductId:bottleId,
          isDefault:            tier.isDefault,
          isActive:             true,
          showOnPOS:            true,
          sortOrder:            tier.sortOrder,
          printerRouting:       'follow',
        },
      })
    }

    await prisma.spiritModifierGroup.upsert({
      where:  { modifierGroupId: modGroup.id },
      update: {},
      create: {
        id:              smgId,
        locationId:      LOC,
        modifierGroupId: modGroup.id,
        spiritCategoryId:sp.catId,
        upsellEnabled:   true,
        upsellPromptText:`Upgrade your ${c.spirit}?`,
        defaultTier:     'well',
      },
    })

    upgradeCount++
  }

  console.log(`  ✓ ${upgradeCount} spirit upgrade groups (Well / Call / Premium / Top Shelf)`)
  console.log(`  ✓ ${recipeCount} recipe ingredient links`)

  // ── 5. Per-item Margarita Style + Flavor groups ───────────────────────────
  console.log('\n  [5/5] Attaching Margarita Style / Flavor to margarita cocktails...')

  const margaritaIds = COCKTAILS.filter(c => c.extras && c.extras.length > 0).map(c => ({ id: c.id, name: c.name, extras: c.extras! }))

  for (const m of margaritaIds) {
    for (const extraKey of m.extras) {
      const template = extraKey === 'marg-style' ? MARG_STYLE_GROUP : MARG_FLAVOR_GROUP
      const perItemId = `${m.id.replace('cocktail-', 'cmg-')}-${extraKey}`

      const perItemGroup = await prisma.modifierGroup.upsert({
        where:  { id: perItemId },
        update: {},
        create: {
          id:            perItemId,
          locationId:    LOC,
          menuItemId:    m.id,
          name:          template.name,
          displayName:   template.displayName,
          modifierTypes: ['liquor'],
          minSelections: template.min,
          maxSelections: template.max,
          isRequired:    template.required ?? false,
          sortOrder:     extraKey === 'marg-style' ? 1 : 2,
        },
      })

      for (const mod of template.modifiers) {
        const perItemModId = `${perItemId}-${mod.id.replace('marg-', '')}`
        await prisma.modifier.upsert({
          where:  { id: perItemModId },
          update: {},
          create: {
            id:             perItemModId,
            locationId:     LOC,
            modifierGroupId:perItemGroup.id,
            name:           mod.name,
            price:          mod.price,
            priceType:      'upcharge',
            isDefault:      mod.def,
            isActive:       true,
            showOnPOS:      true,
            sortOrder:      mod.so,
            printerRouting: 'follow',
          },
        })
      }
    }
    console.log(`  ✓ ${m.name}: ${m.extras.join(' + ')}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const cocktailCount = await prisma.menuItem.count({ where: { categoryId: 'cat-cocktails' } })
  const recipeTotal   = await prisma.recipeIngredient.count({ where: { locationId: LOC } })

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅  Cocktails seeded successfully!

  Cocktails:               ${cocktailCount}
  Recipe ingredient links: ${recipeTotal}
  Spirit upgrade groups:   ${upgradeCount}  (per-cocktail Well/Call/Premium/Top Shelf)

Shared modifier templates (appear in Templates panel):
  • Mixers          (Coke, Tonic, Ginger Beer, Red Bull, Topo Chico +$1, etc.)
  • Garnish         (Lime, Lemon, Salt Rim, Tajin +$0.50, etc.)
  • Ice Preference  (Regular, Light, Extra, No Ice, Neat, Rocks, Up)
  • Margarita Style (On the Rocks, Frozen, Up)
  • Margarita Flavor (Classic Lime, Strawberry +$1, Mango, Peach, Prickly Pear +$1.50, etc.)

Margarita Style + Flavor pre-attached to:
  • Margarita (Style + Flavor)
  • Margarita on Rocks (Flavor only)
  • Frozen Margarita (Flavor only)

Next steps:
  1. /liquor-builder → Drinks tab — click any cocktail to see upgrade buttons
  2. Apply Mixers / Garnish / Ice templates via the Templates panel on the right
  3. Adjust prices to match your market
  4. /liquor-builder → Recipes tab — review bottle quantities per drink
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}

main()
  .catch((e) => {
    console.error('\n❌ Error during cocktails seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
