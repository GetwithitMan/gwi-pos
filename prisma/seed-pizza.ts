import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function seedPizza() {
  console.log('Seeding pizza data...')

  // Get location
  const location = await prisma.location.findFirst()
  if (!location) {
    console.error('No location found. Run main seed first.')
    return
  }

  // Create pizza category
  let pizzaCategory = await prisma.category.findFirst({
    where: { locationId: location.id, categoryType: 'pizza' }
  })

  if (!pizzaCategory) {
    pizzaCategory = await prisma.category.create({
      data: {
        locationId: location.id,
        name: 'Pizza',
        color: '#ef4444',
        categoryType: 'pizza',
        sortOrder: 5,
        isActive: true,
      }
    })
    console.log('Created pizza category')
  }

  // Create or update pizza config
  await prisma.pizzaConfig.upsert({
    where: { locationId: location.id },
    update: {
      maxSections: 24,
      sectionOptions: [1, 2, 4, 6, 8],
    },
    create: {
      locationId: location.id,
      maxSections: 24,
      defaultSections: 2,
      sectionOptions: [1, 2, 4, 6, 8],
      pricingMode: 'fractional',
      freeToppingsEnabled: false,
      freeToppingsCount: 0,
      freeToppingsMode: 'per_pizza',
      showVisualBuilder: true,
      showToppingList: true,
      defaultToListView: false,
    }
  })
  console.log('Pizza config ready')

  // Create sizes
  const sizes = [
    { name: 'Personal', displayName: '8"', inches: 8, slices: 4, basePrice: 8.99, priceMultiplier: 0.8, toppingMultiplier: 0.8, freeToppings: 0, sortOrder: 0, isDefault: false },
    { name: 'Small', displayName: '10"', inches: 10, slices: 6, basePrice: 10.99, priceMultiplier: 1.0, toppingMultiplier: 1.0, freeToppings: 0, sortOrder: 1, isDefault: false },
    { name: 'Medium', displayName: '12"', inches: 12, slices: 8, basePrice: 13.99, priceMultiplier: 1.2, toppingMultiplier: 1.2, freeToppings: 0, sortOrder: 2, isDefault: true },
    { name: 'Large', displayName: '14"', inches: 14, slices: 8, basePrice: 16.99, priceMultiplier: 1.4, toppingMultiplier: 1.4, freeToppings: 0, sortOrder: 3, isDefault: false },
    { name: 'X-Large', displayName: '18"', inches: 18, slices: 12, basePrice: 21.99, priceMultiplier: 1.8, toppingMultiplier: 1.6, freeToppings: 0, sortOrder: 4, isDefault: false },
  ]

  for (const size of sizes) {
    await prisma.pizzaSize.upsert({
      where: { id: `size-${size.name.toLowerCase().replace(' ', '-')}` },
      update: size,
      create: { id: `size-${size.name.toLowerCase().replace(' ', '-')}`, locationId: location.id, ...size, isActive: true }
    })
  }
  console.log('Created sizes')

  // Create crusts
  const crusts = [
    { name: 'Hand Tossed', price: 0, isDefault: true, sortOrder: 0 },
    { name: 'Thin Crust', price: 0, isDefault: false, sortOrder: 1 },
    { name: 'Thick Crust', price: 1.50, isDefault: false, sortOrder: 2 },
    { name: 'Stuffed Crust', price: 3.00, isDefault: false, sortOrder: 3 },
    { name: 'Gluten Free', price: 3.50, isDefault: false, sortOrder: 4 },
    { name: 'Cauliflower', price: 4.00, isDefault: false, sortOrder: 5 },
  ]

  for (const crust of crusts) {
    await prisma.pizzaCrust.upsert({
      where: { id: `crust-${crust.name.toLowerCase().replace(/ /g, '-')}` },
      update: crust,
      create: { id: `crust-${crust.name.toLowerCase().replace(/ /g, '-')}`, locationId: location.id, ...crust, isActive: true }
    })
  }
  console.log('Created crusts')

  // Create sauces
  const sauces = [
    { name: 'Marinara', price: 0, isDefault: true, sortOrder: 0, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { name: 'Alfredo', price: 1.00, isDefault: false, sortOrder: 1, allowLight: true, allowExtra: true, extraPrice: 1.50 },
    { name: 'BBQ', price: 0.50, isDefault: false, sortOrder: 2, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { name: 'Buffalo', price: 0.50, isDefault: false, sortOrder: 3, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { name: 'Garlic Butter', price: 0.50, isDefault: false, sortOrder: 4, allowLight: true, allowExtra: true, extraPrice: 1.00 },
    { name: 'Pesto', price: 1.50, isDefault: false, sortOrder: 5, allowLight: true, allowExtra: true, extraPrice: 2.00 },
    { name: 'No Sauce', price: 0, isDefault: false, sortOrder: 6, allowLight: false, allowExtra: false, extraPrice: 0 },
  ]

  for (const sauce of sauces) {
    await prisma.pizzaSauce.upsert({
      where: { id: `sauce-${sauce.name.toLowerCase().replace(/ /g, '-')}` },
      update: sauce,
      create: { id: `sauce-${sauce.name.toLowerCase().replace(/ /g, '-')}`, locationId: location.id, ...sauce, isActive: true }
    })
  }
  console.log('Created sauces')

  // Create cheeses
  const cheeses = [
    { name: 'Mozzarella', price: 0, isDefault: true, sortOrder: 0, allowLight: true, allowExtra: true, extraPrice: 2.00 },
    { name: 'Cheddar Blend', price: 0.50, isDefault: false, sortOrder: 1, allowLight: true, allowExtra: true, extraPrice: 2.50 },
    { name: 'Parmesan', price: 1.00, isDefault: false, sortOrder: 2, allowLight: true, allowExtra: true, extraPrice: 2.00 },
    { name: 'Feta', price: 1.50, isDefault: false, sortOrder: 3, allowLight: true, allowExtra: true, extraPrice: 2.50 },
    { name: 'Vegan Cheese', price: 2.00, isDefault: false, sortOrder: 4, allowLight: true, allowExtra: true, extraPrice: 3.00 },
    { name: 'No Cheese', price: 0, isDefault: false, sortOrder: 5, allowLight: false, allowExtra: false, extraPrice: 0 },
  ]

  for (const cheese of cheeses) {
    await prisma.pizzaCheese.upsert({
      where: { id: `cheese-${cheese.name.toLowerCase().replace(/ /g, '-')}` },
      update: cheese,
      create: { id: `cheese-${cheese.name.toLowerCase().replace(/ /g, '-')}`, locationId: location.id, ...cheese, isActive: true }
    })
  }
  console.log('Created cheeses')

  // Create toppings
  const toppings = [
    // MEATS
    { name: 'Pepperoni', category: 'meat', price: 2.00, extraPrice: 3.00, color: '#dc2626', sortOrder: 0 },
    { name: 'Italian Sausage', category: 'meat', price: 2.00, extraPrice: 3.00, color: '#b91c1c', sortOrder: 1 },
    { name: 'Bacon', category: 'meat', price: 2.50, extraPrice: 3.75, color: '#991b1b', sortOrder: 2 },
    { name: 'Ham', category: 'meat', price: 2.00, extraPrice: 3.00, color: '#f87171', sortOrder: 3 },
    { name: 'Ground Beef', category: 'meat', price: 2.00, extraPrice: 3.00, color: '#7f1d1d', sortOrder: 4 },
    { name: 'Canadian Bacon', category: 'meat', price: 2.50, extraPrice: 3.75, color: '#fca5a5', sortOrder: 5 },
    { name: 'Chicken', category: 'meat', price: 2.50, extraPrice: 3.75, color: '#fecaca', sortOrder: 6 },
    { name: 'Meatball', category: 'meat', price: 2.50, extraPrice: 3.75, color: '#450a0a', sortOrder: 7 },

    // VEGGIES
    { name: 'Mushrooms', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#854d0e', sortOrder: 0 },
    { name: 'Green Peppers', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#16a34a', sortOrder: 1 },
    { name: 'Onions', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#a855f7', sortOrder: 2 },
    { name: 'Black Olives', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#1f2937', sortOrder: 3 },
    { name: 'Green Olives', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#65a30d', sortOrder: 4 },
    { name: 'Tomatoes', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#ef4444', sortOrder: 5 },
    { name: 'Jalapenos', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#22c55e', sortOrder: 6 },
    { name: 'Banana Peppers', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#facc15', sortOrder: 7 },
    { name: 'Spinach', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#15803d', sortOrder: 8 },
    { name: 'Roasted Garlic', category: 'veggie', price: 1.00, extraPrice: 1.50, color: '#fef08a', sortOrder: 9 },
    { name: 'Pineapple', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#fde047', sortOrder: 10 },
    { name: 'Red Onions', category: 'veggie', price: 1.50, extraPrice: 2.25, color: '#7c3aed', sortOrder: 11 },

    // PREMIUM
    { name: 'Grilled Chicken', category: 'premium', price: 3.50, extraPrice: 5.25, color: '#c084fc', sortOrder: 0 },
    { name: 'Steak', category: 'premium', price: 4.00, extraPrice: 6.00, color: '#a855f7', sortOrder: 1 },
    { name: 'Prosciutto', category: 'premium', price: 4.50, extraPrice: 6.75, color: '#d946ef', sortOrder: 2 },
    { name: 'Salami', category: 'premium', price: 3.00, extraPrice: 4.50, color: '#e879f9', sortOrder: 3 },
    { name: 'Sun-dried Tomatoes', category: 'premium', price: 2.50, extraPrice: 3.75, color: '#f0abfc', sortOrder: 4 },
    { name: 'Artichoke Hearts', category: 'premium', price: 2.50, extraPrice: 3.75, color: '#86efac', sortOrder: 5 },
    { name: 'Roasted Red Peppers', category: 'premium', price: 2.00, extraPrice: 3.00, color: '#fb7185', sortOrder: 6 },

    // SEAFOOD
    { name: 'Shrimp', category: 'seafood', price: 4.00, extraPrice: 6.00, color: '#f97316', sortOrder: 0 },
    { name: 'Anchovies', category: 'seafood', price: 2.50, extraPrice: 3.75, color: '#64748b', sortOrder: 1 },
    { name: 'Crab', category: 'seafood', price: 5.00, extraPrice: 7.50, color: '#fb923c', sortOrder: 2 },

    // CHEESE (extra)
    { name: 'Ricotta', category: 'cheese', price: 2.00, extraPrice: 3.00, color: '#fef9c3', sortOrder: 0 },
    { name: 'Goat Cheese', category: 'cheese', price: 2.50, extraPrice: 3.75, color: '#fef3c7', sortOrder: 1 },
    { name: 'Blue Cheese', category: 'cheese', price: 2.50, extraPrice: 3.75, color: '#dbeafe', sortOrder: 2 },
    { name: 'Gorgonzola', category: 'cheese', price: 3.00, extraPrice: 4.50, color: '#bfdbfe', sortOrder: 3 },
  ]

  for (const topping of toppings) {
    await prisma.pizzaTopping.upsert({
      where: { id: `topping-${topping.name.toLowerCase().replace(/ /g, '-')}` },
      update: topping,
      create: {
        id: `topping-${topping.name.toLowerCase().replace(/ /g, '-')}`,
        locationId: location.id,
        ...topping,
        isActive: true
      }
    })
  }
  console.log('Created toppings')

  // Create pizza menu items
  const pizzas = [
    { name: 'Build Your Own', description: 'Start from scratch with your choice of toppings', price: 13.99 },
    { name: 'Cheese Pizza', description: 'Classic cheese pizza with marinara and mozzarella', price: 13.99 },
    { name: 'Pepperoni', description: 'Classic pepperoni pizza', price: 15.99 },
    { name: 'Meat Lovers', description: 'Pepperoni, sausage, bacon, ham, ground beef', price: 19.99 },
    { name: 'Supreme', description: 'Pepperoni, sausage, mushrooms, peppers, onions, olives', price: 19.99 },
    { name: 'Veggie Delight', description: 'Mushrooms, peppers, onions, olives, tomatoes, spinach', price: 17.99 },
    { name: 'Hawaiian', description: 'Ham and pineapple with mozzarella', price: 16.99 },
    { name: 'BBQ Chicken', description: 'Grilled chicken, BBQ sauce, red onions, cilantro', price: 18.99 },
    { name: 'Buffalo Chicken', description: 'Buffalo chicken, buffalo sauce, blue cheese crumbles', price: 18.99 },
    { name: 'Margherita', description: 'Fresh tomatoes, basil, fresh mozzarella', price: 16.99 },
    { name: 'White Pizza', description: 'Alfredo sauce, ricotta, mozzarella, garlic', price: 16.99 },
    { name: 'The Works', description: 'Everything but the kitchen sink!', price: 22.99 },
  ]

  for (let i = 0; i < pizzas.length; i++) {
    const pizza = pizzas[i]
    await prisma.menuItem.upsert({
      where: { id: `pizza-${pizza.name.toLowerCase().replace(/ /g, '-')}` },
      update: { ...pizza, sortOrder: i },
      create: {
        id: `pizza-${pizza.name.toLowerCase().replace(/ /g, '-')}`,
        locationId: location.id,
        categoryId: pizzaCategory.id,
        name: pizza.name,
        description: pizza.description,
        price: pizza.price,
        sortOrder: i,
        isAvailable: true,
        isActive: true,
      }
    })
  }
  console.log('Created pizza menu items')

  console.log('Pizza seed complete!')
}

seedPizza()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
