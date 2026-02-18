import { useRef, useCallback } from 'react'

interface UseLongPressOptions {
  /** Long-press duration in ms (default: 500) */
  duration?: number
  /** Callback fired on quick tap (touch end without long-press triggering) */
  onTap?: () => void
}

/**
 * Detects long-press gestures on both touch and mouse.
 * Returns event handlers to spread onto the target element.
 *
 * Vibrates (50ms) on successful long-press if `navigator.vibrate` is available.
 */
export function useLongPress(
  onLongPress: () => void,
  options: UseLongPressOptions = {},
) {
  const { duration = 500, onTap } = options
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const triggeredRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    triggeredRef.current = false
    clear()
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true
      onLongPress()
      if (navigator.vibrate) navigator.vibrate(50)
    }, duration)
  }, [onLongPress, duration, clear])

  const end = useCallback(() => {
    clear()
    if (!triggeredRef.current && onTap) {
      onTap()
    }
  }, [clear, onTap])

  return {
    onTouchStart: start,
    onTouchEnd: end,
    onTouchCancel: end,
    onMouseDown: start,
    onMouseUp: end,
    onMouseLeave: end,
  }
}
