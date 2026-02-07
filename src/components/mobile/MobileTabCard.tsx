'use client'

interface MobileTabCardProps {
  tab: {
    id: string
    displayName: string
    tabStatus: string | null
    total: number
    itemCount: number
    openedAt: string
    isBottleService: boolean
    preAuth: {
      cardBrand: string
      last4: string
      amount: number | null
    } | null
    cards: Array<{
      cardType: string
      cardLast4: string
      isDefault: boolean
      status: string
    }>
  }
  onTap: () => void
}

export default function MobileTabCard({ tab, onTap }: MobileTabCardProps) {
  const isPending = tab.tabStatus === 'pending_auth'
  const hasNoCard = tab.tabStatus === 'no_card'
  const timeOpen = new Date(tab.openedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  // Calculate time elapsed
  const elapsed = Date.now() - new Date(tab.openedAt).getTime()
  const hours = Math.floor(elapsed / (1000 * 60 * 60))
  const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60))
  const timeElapsed = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`

  return (
    <button
      onClick={onTap}
      className={`w-full text-left p-4 rounded-xl transition-colors active:scale-[0.98]
        ${isPending ? 'bg-blue-500/10 border border-blue-500/30 animate-pulse' : ''}
        ${hasNoCard ? 'bg-red-500/10 border border-red-500/30' : ''}
        ${tab.isBottleService && !isPending ? 'bg-amber-500/5 border border-amber-500/20' : ''}
        ${!isPending && !hasNoCard && !tab.isBottleService ? 'bg-white/5 border border-white/10 hover:bg-white/10' : ''}
      `}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span>{tab.isBottleService ? '🍾' : '🍺'}</span>
          <span className="font-semibold text-white">{tab.displayName}</span>
        </div>
        <span className="text-xl font-bold text-white">${tab.total.toFixed(2)}</span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-white/40">
          <span>{timeOpen}</span>
          <span>{timeElapsed}</span>
          <span>{tab.itemCount} items</span>
        </div>

        {/* Status badges */}
        {isPending && (
          <span className="text-xs text-blue-400 font-medium">Authorizing...</span>
        )}
        {hasNoCard && (
          <span className="text-xs text-red-400 font-medium">No Card</span>
        )}
      </div>

      {/* Card info */}
      {tab.cards.length > 0 && !isPending && (
        <div className="flex gap-1.5 mt-2">
          {tab.cards.map((card, i) => (
            <span
              key={i}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium
                ${card.isDefault ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/30'}`}
            >
              {card.cardType} ...{card.cardLast4}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
