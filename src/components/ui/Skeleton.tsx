'use client'

/**
 * CSS-only shimmer skeleton placeholders.
 * No external libraries — uses a gradient animation.
 */

interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
  rounded?: boolean
}

export function Skeleton({ className = '', width, height, rounded = false }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer ${rounded ? 'rounded-full' : 'rounded-lg'} ${className}`}
      style={{ width, height }}
    />
  )
}

/** Grid of rectangular skeleton cards — used for POS menu item loading. */
export function MenuGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-shimmer rounded-xl h-20" />
      ))}
      <SkeletonStyles />
    </div>
  )
}

/** Category tab bar skeleton. */
export function CategoryTabsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex gap-2 p-2 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-shimmer rounded-lg h-10 flex-shrink-0" style={{ width: 80 + Math.random() * 40 }} />
      ))}
      <SkeletonStyles />
    </div>
  )
}

/** Reservation list skeleton. */
export function ReservationListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton-shimmer rounded-lg h-12 w-16" />
          <div className="flex-1 space-y-2">
            <div className="skeleton-shimmer rounded h-4 w-3/4" />
            <div className="skeleton-shimmer rounded h-3 w-1/2" />
          </div>
          <div className="skeleton-shimmer rounded-lg h-8 w-20" />
        </div>
      ))}
      <SkeletonStyles />
    </div>
  )
}

/** POS bootstrap skeleton — categories + menu grid. */
export function POSBootstrapSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <CategoryTabsSkeleton />
      <MenuGridSkeleton />
    </div>
  )
}

/** Injects the shimmer keyframe animation once. */
function SkeletonStyles() {
  return (
    <style>{`
      .skeleton-shimmer {
        background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-in-out infinite;
      }
      @media (prefers-color-scheme: dark) {
        .skeleton-shimmer {
          background: linear-gradient(90deg, #374151 25%, #4b5563 50%, #374151 75%);
          background-size: 200% 100%;
        }
      }
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `}</style>
  )
}
