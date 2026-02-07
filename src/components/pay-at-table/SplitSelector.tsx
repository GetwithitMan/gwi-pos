'use client'

interface SplitSelectorProps {
  total: number
  onSplitSelected: (count: number) => void
  onCancel: () => void
}

export default function SplitSelector({ total, onSplitSelected, onCancel }: SplitSelectorProps) {
  const splitOptions = [2, 3, 4, 5, 6]

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 p-8">
      <h2 className="text-2xl text-white/80 mb-2">Split the Check</h2>
      <p className="text-white/40 text-lg mb-8">Total: ${total.toFixed(2)}</p>

      <div className="grid grid-cols-3 gap-4 max-w-sm w-full mb-8">
        {splitOptions.map(count => (
          <button
            key={count}
            onClick={() => onSplitSelected(count)}
            className="py-6 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors text-center"
          >
            <div className="text-2xl font-bold text-white">{count}</div>
            <div className="text-white/40 text-sm mt-1">
              ${(Math.round((total / count) * 100) / 100).toFixed(2)} each
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onCancel}
        className="px-8 py-3 text-white/50 text-lg hover:text-white/70 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
