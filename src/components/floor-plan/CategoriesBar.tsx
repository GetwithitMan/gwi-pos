'use client'

import { motion } from 'framer-motion'

interface Category {
  id: string
  name: string
  color?: string
  itemCount?: number
  categoryType?: string  // food, drinks, liquor, entertainment, combos, retail
}

interface CategoriesBarProps {
  categories: Category[]
  selectedCategoryId: string | null
  onCategorySelect: (categoryId: string | null) => void
  onStartTabWorkflow?: () => void
}

// Category types that belong to "Bar" row (must match orders page)
const BAR_TYPES = ['liquor', 'drinks', 'cocktails', 'beer', 'wine']
// Category types that belong to "Food" row - everything else defaults to food
const FOOD_TYPES = ['food', 'pizza', 'combos', 'retail', 'entertainment', 'appetizers', 'entrees', 'desserts']

export function CategoriesBar({
  categories,
  selectedCategoryId,
  onCategorySelect,
  onStartTabWorkflow,
}: CategoriesBarProps) {
  // Split categories into Food and Bar rows
  const foodCategories = categories.filter(c =>
    !c.categoryType || FOOD_TYPES.includes(c.categoryType)
  )
  const barCategories = categories.filter(c =>
    c.categoryType && BAR_TYPES.includes(c.categoryType)
  )

  const renderCategoryButton = (category: Category) => (
    <motion.button
      key={category.id}
      className={`category-button ${selectedCategoryId === category.id ? 'active' : ''}`}
      onClick={() => onCategorySelect(category.id)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      style={{
        padding: '10px 20px',
        background: selectedCategoryId === category.id
          ? (category.color ? `${category.color}20` : 'rgba(99, 102, 241, 0.2)')
          : 'rgba(255, 255, 255, 0.05)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: selectedCategoryId === category.id && category.color
          ? category.color
          : 'rgba(255, 255, 255, 0.1)',
        borderRadius: '10px',
        color: selectedCategoryId === category.id ? '#a5b4fc' : '#94a3b8',
        fontSize: '14px',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap' as const,
      }}
    >
      {category.name}
      {category.itemCount !== undefined && (
        <span style={{ marginLeft: '6px', fontSize: '12px', opacity: 0.6 }}>({category.itemCount})</span>
      )}
    </motion.button>
  )


  return (
    <div className="categories-bar-container" style={{ minHeight: '100px', background: 'rgba(0,0,0,0.2)' }}>
      {/* Food Row */}
      <div className="categories-bar categories-row-food" style={{ display: 'flex', padding: '8px 20px', gap: '8px' }}>
        <span className="category-row-label" style={{ color: '#f97316', fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase' as const }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          Food
        </span>

        {foodCategories.map(renderCategoryButton)}
      </div>

      {/* Bar Row */}
      <div className="categories-bar categories-row-bar" style={{ display: 'flex', padding: '8px 20px', gap: '8px' }}>
        <span className="category-row-label" style={{ color: '#3b82f6', fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Bar
        </span>

        {barCategories.map(renderCategoryButton)}

        {/* Start Tab Quick Action */}
        {onStartTabWorkflow && (
          <motion.button
            className="category-button new-tab-button"
            onClick={onStartTabWorkflow}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
          >
            <svg
              className="w-4 h-4 mr-1.5 inline-block"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Tab
          </motion.button>
        )}
      </div>
    </div>
  )
}
