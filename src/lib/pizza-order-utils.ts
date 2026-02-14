import type { PizzaOrderConfig } from '@/types'
import { getPizzaBasePrice } from '@/lib/pizza-helpers'

type PizzaModifier = {
  id: string
  name: string
  price: number
  preModifier?: string
  depth: number
}

const MAX_SECTIONS = 24
const HALF_SIZE = MAX_SECTIONS / 2
const QUARTER_SIZE = MAX_SECTIONS / 4
const SIXTH_SIZE = MAX_SECTIONS / 6
const EIGHTH_SIZE = MAX_SECTIONS / 8

/** All named box section ranges for pizza layout */
function buildBoxSections(): Record<string, number[]> {
  const boxes: Record<string, number[]> = {
    'WHOLE': Array.from({ length: MAX_SECTIONS }, (_, i) => i),
    'RIGHT HALF': Array.from({ length: HALF_SIZE }, (_, i) => i),
    'LEFT HALF': Array.from({ length: HALF_SIZE }, (_, i) => HALF_SIZE + i),
    'TOP RIGHT': Array.from({ length: QUARTER_SIZE }, (_, i) => i),
    'BOTTOM RIGHT': Array.from({ length: QUARTER_SIZE }, (_, i) => QUARTER_SIZE + i),
    'BOTTOM LEFT': Array.from({ length: QUARTER_SIZE }, (_, i) => QUARTER_SIZE * 2 + i),
    'TOP LEFT': Array.from({ length: QUARTER_SIZE }, (_, i) => QUARTER_SIZE * 3 + i),
  }
  for (let i = 0; i < 6; i++) {
    boxes[`1/6-${i + 1}`] = Array.from({ length: SIXTH_SIZE }, (_, j) => i * SIXTH_SIZE + j)
  }
  for (let i = 0; i < 8; i++) {
    boxes[`1/8-${i + 1}`] = Array.from({ length: EIGHTH_SIZE }, (_, j) => i * EIGHTH_SIZE + j)
  }
  return boxes
}

const BOX_SECTIONS = buildBoxSections()

const BOX_ORDER = [
  'WHOLE',
  'LEFT HALF', 'RIGHT HALF',
  'TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT',
  '1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6',
  '1/8-1', '1/8-2', '1/8-3', '1/8-4', '1/8-5', '1/8-6', '1/8-7', '1/8-8',
]

type PizzaItem = { type: string; id: string; name: string; sections: number[]; price: number }

function exactlyCovers(itemSections: number[], boxName: string): boolean {
  const boxSecs = BOX_SECTIONS[boxName]
  if (!boxSecs || itemSections.length !== boxSecs.length) return false
  const sorted = [...itemSections].sort((a, b) => a - b)
  return boxSecs.every((s, i) => sorted[i] === s)
}

function coversBox(itemSections: number[], boxName: string): boolean {
  const boxSecs = BOX_SECTIONS[boxName]
  if (!boxSecs) return false
  return boxSecs.every(s => itemSections.includes(s))
}

/**
 * Build modifier array from a PizzaOrderConfig, organized by section boxes.
 * Pure computation — no React or side effects.
 */
export function buildPizzaModifiers(config: PizzaOrderConfig): PizzaModifier[] {
  const pizzaModifiers: PizzaModifier[] = []

  // Collect all items with their sections
  const allItems: PizzaItem[] = []

  if (config.sauces) {
    config.sauces.forEach(s => {
      const prefix = s.amount === 'light' ? 'Light ' : s.amount === 'extra' ? 'Extra ' : ''
      allItems.push({ type: 'sauce', id: s.sauceId, name: `${prefix}${s.name}`, sections: s.sections, price: s.price || 0 })
    })
  }
  if (config.cheeses) {
    config.cheeses.forEach(c => {
      const prefix = c.amount === 'light' ? 'Light ' : c.amount === 'extra' ? 'Extra ' : ''
      allItems.push({ type: 'cheese', id: c.cheeseId, name: `${prefix}${c.name}`, sections: c.sections, price: c.price || 0 })
    })
  }
  config.toppings.forEach(t => {
    const prefix = t.amount === 'light' ? 'Light ' : t.amount === 'extra' ? 'Extra ' : ''
    allItems.push({ type: 'topping', id: t.toppingId, name: `${prefix}${t.name}`, sections: t.sections, price: t.price })
  })

  // Determine section mode based on items (find smallest sections used)
  let sectionMode = 1
  allItems.forEach(item => {
    if (item.sections.length < MAX_SECTIONS) {
      if (item.sections.length <= EIGHTH_SIZE) sectionMode = Math.max(sectionMode, 8)
      else if (item.sections.length <= SIXTH_SIZE) sectionMode = Math.max(sectionMode, 6)
      else if (item.sections.length <= QUARTER_SIZE) sectionMode = Math.max(sectionMode, 4)
      else if (item.sections.length <= HALF_SIZE) sectionMode = Math.max(sectionMode, 2)
    }
  })

  // Group items into boxes
  const boxContents: Record<string, { items: string[]; totalPrice: number }> = {}
  BOX_ORDER.forEach(box => {
    boxContents[box] = { items: [], totalPrice: 0 }
  })

  // Place each item in the appropriate box(es)
  allItems.forEach(item => {
    let placed = false

    if (exactlyCovers(item.sections, 'WHOLE')) {
      boxContents['WHOLE'].items.push(item.name)
      boxContents['WHOLE'].totalPrice += item.price
      placed = true
    } else if (exactlyCovers(item.sections, 'LEFT HALF')) {
      boxContents['LEFT HALF'].items.push(item.name)
      boxContents['LEFT HALF'].totalPrice += item.price
      placed = true
    } else if (exactlyCovers(item.sections, 'RIGHT HALF')) {
      boxContents['RIGHT HALF'].items.push(item.name)
      boxContents['RIGHT HALF'].totalPrice += item.price
      placed = true
    } else {
      for (const q of ['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT']) {
        if (exactlyCovers(item.sections, q)) {
          boxContents[q].items.push(item.name)
          boxContents[q].totalPrice += item.price
          placed = true
          break
        }
      }
    }

    if (!placed) {
      for (let i = 1; i <= 6; i++) {
        if (exactlyCovers(item.sections, `1/6-${i}`)) {
          boxContents[`1/6-${i}`].items.push(item.name)
          boxContents[`1/6-${i}`].totalPrice += item.price
          placed = true
          break
        }
      }
    }

    if (!placed) {
      for (let i = 1; i <= 8; i++) {
        if (exactlyCovers(item.sections, `1/8-${i}`)) {
          boxContents[`1/8-${i}`].items.push(item.name)
          boxContents[`1/8-${i}`].totalPrice += item.price
          placed = true
          break
        }
      }
    }

    if (!placed) {
      const smallestBoxes = sectionMode === 8 ? ['1/8-1', '1/8-2', '1/8-3', '1/8-4', '1/8-5', '1/8-6', '1/8-7', '1/8-8'] :
        sectionMode === 6 ? ['1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6'] :
        sectionMode === 4 ? ['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT'] :
        ['LEFT HALF', 'RIGHT HALF']

      smallestBoxes.forEach(boxName => {
        if (coversBox(item.sections, boxName)) {
          boxContents[boxName].items.push(item.name)
        }
      })
    }
  })

  // Determine which rows to show based on section mode
  const rows: string[][] = [['WHOLE', 'LEFT HALF', 'RIGHT HALF']]
  if (sectionMode >= 4) rows.push(['TOP LEFT', 'TOP RIGHT', 'BOTTOM LEFT', 'BOTTOM RIGHT'])
  if (sectionMode >= 6) rows.push(['1/6-1', '1/6-2', '1/6-3', '1/6-4', '1/6-5', '1/6-6'])
  if (sectionMode >= 8) {
    rows.push(['1/8-1', '1/8-2', '1/8-3', '1/8-4'])
    rows.push(['1/8-5', '1/8-6', '1/8-7', '1/8-8'])
  }

  // Build modifiers from boxes
  rows.forEach(row => {
    row.forEach(boxName => {
      if (sectionMode === 1 && (boxName === 'LEFT HALF' || boxName === 'RIGHT HALF')) return

      const content = boxContents[boxName]
      const itemsText = content.items.length > 0 ? content.items.join(', ') : '-'

      pizzaModifiers.push({
        id: `pizza-box-${boxName.replace(/\s+/g, '-').toLowerCase()}`,
        name: `${boxName}: ${itemsText}`,
        price: content.totalPrice,
        depth: 0,
      })
    })
  })

  // Add cooking instructions
  if (config.cookingInstructions) {
    pizzaModifiers.push({
      id: 'pizza-cooking',
      name: config.cookingInstructions,
      price: 0,
      depth: 0,
    })
  }

  // Add cut style
  if (config.cutStyle && config.cutStyle !== 'Normal Cut') {
    pizzaModifiers.push({
      id: 'pizza-cut',
      name: config.cutStyle,
      price: 0,
      depth: 0,
    })
  }

  return pizzaModifiers
}

/**
 * Calculate the base price for a pizza config.
 * Re-exports getPizzaBasePrice for convenience.
 */
export { getPizzaBasePrice }
