import { useState, useEffect, useMemo, useCallback } from 'react'
import { useDebounce } from './useDebounce'

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  is86d?: boolean
}

interface IngredientMatch {
  ingredientType: 'spirit' | 'food'
  ingredientName: string
  ingredientId: string
  items: MenuItem[]
}

interface SearchResults {
  directMatches: MenuItem[]
  ingredientMatches: IngredientMatch[]
  totalMatches: number
}

interface UseMenuSearchOptions {
  locationId: string | undefined
  menuItems: MenuItem[]
  enabled?: boolean
  debounceMs?: number
  minQueryLength?: number
}

export function useMenuSearch({
  locationId,
  menuItems,
  enabled = true,
  debounceMs = 300,
  minQueryLength = 2
}: UseMenuSearchOptions) {
  const [query, setQuery] = useState('')
  const [apiResults, setApiResults] = useState<SearchResults | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedQuery = useDebounce(query, debounceMs)

  // Layer 1: Client-side name search (instant)
  const clientMatches = useMemo(() => {
    if (!query || query.length < minQueryLength) return []
    const lowerQuery = query.toLowerCase()
    return menuItems.filter(item =>
      item.name.toLowerCase().includes(lowerQuery)
    ).slice(0, 20)
  }, [query, menuItems, minQueryLength])

  // Layer 2: Server-side ingredient search (debounced)
  useEffect(() => {
    if (!enabled || !locationId || !debouncedQuery || debouncedQuery.length < minQueryLength) {
      setApiResults(null)
      setIsSearching(false)
      return
    }

    const controller = new AbortController()
    setIsSearching(true)
    setError(null)

    fetch(`/api/menu/search?locationId=${locationId}&q=${encodeURIComponent(debouncedQuery)}`, {
      signal: controller.signal
    })
      .then(res => {
        if (!res.ok) throw new Error('Search failed')
        return res.json()
      })
      .then(data => {
        setApiResults(data)
        setIsSearching(false)
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setError(err.message)
          setIsSearching(false)
        }
      })

    return () => controller.abort()
  }, [enabled, locationId, debouncedQuery, minQueryLength])

  // Combine results with deduplication
  const results = useMemo(() => {
    if (!query || query.length < minQueryLength) return null

    const directMatches = [...clientMatches]

    if (apiResults) {
      // Add API direct matches not already in client matches
      const clientIds = new Set(clientMatches.map(m => m.id))
      for (const item of apiResults.directMatches) {
        if (!clientIds.has(item.id)) {
          directMatches.push(item)
        }
      }

      // Filter ingredient matches to exclude direct matches
      const allDirectIds = new Set(directMatches.map(m => m.id))
      const ingredientMatches = apiResults.ingredientMatches
        .map(group => ({
          ...group,
          items: group.items.filter(item => !allDirectIds.has(item.id))
        }))
        .filter(group => group.items.length > 0)

      return {
        directMatches: directMatches.slice(0, 30),
        ingredientMatches,
        totalMatches: directMatches.length + ingredientMatches.reduce((sum, g) => sum + g.items.length, 0)
      }
    }

    return {
      directMatches,
      ingredientMatches: [],
      totalMatches: directMatches.length
    }
  }, [query, clientMatches, apiResults, minQueryLength])

  const clearSearch = useCallback(() => {
    setQuery('')
    setApiResults(null)
    setError(null)
  }, [])

  return {
    query,
    setQuery,
    isSearching,
    results,
    error,
    clearSearch
  }
}
