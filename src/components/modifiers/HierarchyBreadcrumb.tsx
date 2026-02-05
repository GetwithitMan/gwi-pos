'use client'

interface HierarchyBreadcrumbProps {
  itemName: string
  navStack: { groupId: string; groupName: string }[]
  onNavigateTo: (index: number) => void  // -1 = root, 0 = first level, etc.
}

export function HierarchyBreadcrumb({ itemName, navStack, onNavigateTo }: HierarchyBreadcrumbProps) {
  return (
    <div className="bg-white/5 border-b border-white/10 py-2 px-3 flex items-center gap-2 text-sm">
      {/* Back arrow button */}
      <button
        onClick={() => onNavigateTo(navStack.length - 2)}
        className="text-slate-400 hover:text-white transition-colors"
        title="Go back"
      >
        ◀
      </button>

      {/* Item name */}
      <button
        onClick={() => onNavigateTo(-1)}
        className="text-slate-400 hover:text-white transition-colors"
      >
        {itemName}
      </button>

      {/* Navigation stack */}
      {navStack.map((segment, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="text-slate-600">›</span>
          <button
            onClick={() => onNavigateTo(index)}
            className={index === navStack.length - 1
              ? "text-white font-medium"
              : "text-slate-400 hover:text-white transition-colors"
            }
          >
            {segment.groupName}
          </button>
        </div>
      ))}
    </div>
  )
}
