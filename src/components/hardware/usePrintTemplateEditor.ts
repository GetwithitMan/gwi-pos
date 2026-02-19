'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import type {
  PrintTemplateSettings,
  ElementConfig,
} from '@/types/print'
import { DEFAULT_PRINT_TEMPLATE_SETTINGS } from '@/types/print'

const DEFAULT_SETTINGS = DEFAULT_PRINT_TEMPLATE_SETTINGS

export function usePrintTemplateEditor(initialSettings?: Partial<PrintTemplateSettings>) {
  const [settings, setSettings] = useState<PrintTemplateSettings>(() => {
    const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    if (initialSettings) {
      Object.keys(initialSettings).forEach((key) => {
        if (typeof (initialSettings as any)[key] === 'object' && (initialSettings as any)[key] !== null) {
          if (Array.isArray((initialSettings as any)[key])) {
            merged[key] = (initialSettings as any)[key]
          } else {
            merged[key] = { ...merged[key], ...(initialSettings as any)[key] }
          }
        } else {
          merged[key] = (initialSettings as any)[key]
        }
      })
    }
    return merged
  })

  // Undo/Redo
  const [history, setHistory] = useState<PrintTemplateSettings[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isUndoRedo, setIsUndoRedo] = useState(false)

  useEffect(() => {
    if (isUndoRedo) {
      setIsUndoRedo(false)
      return
    }
    setHistory((prev) => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(settings)))
      if (newHistory.length > 50) newHistory.shift()
      return newHistory
    })
    setHistoryIndex((prev) => Math.min(prev + 1, 49))
  }, [settings])

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      setIsUndoRedo(true)
      setHistoryIndex(historyIndex - 1)
      setSettings(JSON.parse(JSON.stringify(history[historyIndex - 1])))
    }
  }, [history, historyIndex])

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setIsUndoRedo(true)
      setHistoryIndex(historyIndex + 1)
      setSettings(JSON.parse(JSON.stringify(history[historyIndex + 1])))
    }
  }, [history, historyIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  // Update helpers
  const updateElement = useCallback((id: string, updates: Partial<ElementConfig>) => {
    setSettings((prev) => ({
      ...prev,
      headerElements: prev.headerElements.map((el) =>
        el.id === id ? { ...el, ...updates } : el
      ),
    }))
  }, [])

  const moveElement = useCallback((fromIndex: number, toIndex: number) => {
    setSettings((prev) => {
      const elements = [...prev.headerElements]
      const [moved] = elements.splice(fromIndex, 1)
      elements.splice(toIndex, 0, moved)
      return { ...prev, headerElements: elements }
    })
  }, [])

  const update = useCallback(<K extends keyof PrintTemplateSettings>(
    section: K,
    key: string,
    value: any
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as any),
        [key]: value,
      },
    }))
  }, [])

  const updateNested = useCallback(<K extends keyof PrintTemplateSettings>(
    section: K,
    subsection: string,
    key: string,
    value: any
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as any),
        [subsection]: {
          ...((prev[section] as any)[subsection] || {}),
          [key]: value,
        },
      },
    }))
  }, [])

  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)
  }, [settings])

  const resetSettings = useCallback(() => {
    setSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)))
  }, [])

  return {
    settings,
    setSettings,
    history,
    historyIndex,
    undo,
    redo,
    updateElement,
    moveElement,
    update,
    updateNested,
    isDirty,
    resetSettings,
  }
}
