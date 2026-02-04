import { useState, useCallback, useRef } from 'react'

interface CacheEntry<T> {
  data: T
  timestamp: number
}

/**
 * Hook for caching hierarchy data (recipes, menu items, etc.)
 * Reduces network calls when expanding/collapsing nodes
 */
export function useHierarchyCache<T>(ttlMs: number = 5 * 60 * 1000) {
  const cache = useRef<Map<string, CacheEntry<T>>>(new Map())

  const get = useCallback((key: string): T | null => {
    const entry = cache.current.get(key)
    if (!entry) return null

    // Check if entry is expired
    if (Date.now() - entry.timestamp > ttlMs) {
      cache.current.delete(key)
      return null
    }

    return entry.data
  }, [ttlMs])

  const set = useCallback((key: string, data: T) => {
    cache.current.set(key, {
      data,
      timestamp: Date.now(),
    })
  }, [])

  const clear = useCallback((key?: string) => {
    if (key) {
      cache.current.delete(key)
    } else {
      cache.current.clear()
    }
  }, [])

  const has = useCallback((key: string): boolean => {
    const entry = cache.current.get(key)
    if (!entry) return false

    // Check if entry is expired
    if (Date.now() - entry.timestamp > ttlMs) {
      cache.current.delete(key)
      return false
    }

    return true
  }, [ttlMs])

  return {
    get,
    set,
    clear,
    has,
  }
}

/**
 * Hook for fetching data with caching
 */
export function useCachedFetch<T>(ttlMs?: number) {
  const cache = useHierarchyCache<T>(ttlMs)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const fetchWithCache = useCallback(async (
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T | null> => {
    // Check cache first
    const cached = cache.get(key)
    if (cached !== null) {
      return cached
    }

    // Already loading this key?
    if (loading[key]) {
      return null
    }

    setLoading(prev => ({ ...prev, [key]: true }))
    setErrors(prev => ({ ...prev, [key]: '' }))

    try {
      const data = await fetcher()
      cache.set(key, data)
      return data
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch'
      setErrors(prev => ({ ...prev, [key]: errorMessage }))
      return null
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }))
    }
  }, [cache, loading])

  return {
    fetchWithCache,
    loading,
    errors,
    clearCache: cache.clear,
  }
}
