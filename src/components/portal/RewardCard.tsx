'use client'

interface RewardCardProps {
  name: string
  description: string
  pointCost: number
  imageUrl?: string | null
  canRedeem: boolean
  onRedeem: () => void
}

export function RewardCard({
  name,
  description,
  pointCost,
  imageUrl,
  canRedeem,
  onRedeem,
}: RewardCardProps) {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden transition-shadow hover:shadow-md">
      {/* Gradient header */}
      <div
        className="h-24 w-full"
        style={{
          background: `linear-gradient(135deg, var(--brand-primary, #3B82F6), var(--brand-secondary, #6366F1))`,
        }}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Point badge */}
      <div className="absolute top-16 right-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-bold shadow-md"
          style={{ color: 'var(--brand-primary, #3B82F6)' }}
        >
          {pointCost.toLocaleString()} pts
        </span>
      </div>

      {/* Content */}
      <div className="p-4 pt-5">
        <h3 className="text-base font-semibold text-gray-900 mb-1">{name}</h3>
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">{description}</p>

        <button
          type="button"
          onClick={onRedeem}
          disabled={!canRedeem}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: canRedeem ? 'var(--brand-primary, #3B82F6)' : undefined,
            color: canRedeem ? '#fff' : undefined,
          }}
        >
          {canRedeem ? 'Redeem' : 'Not enough points'}
        </button>
      </div>
    </div>
  )
}
