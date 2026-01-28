'use client'

import { Button } from '@/components/ui/button'
import { formatWaitTime, type WaitlistEntry } from '@/lib/entertainment'

interface WaitlistPanelProps {
  waitlist: WaitlistEntry[]
  onNotify?: (entryId: string) => void
  onSeat?: (entryId: string) => void
  onRemove?: (entryId: string) => void
  onAddNew?: () => void
}

export function WaitlistPanel({
  waitlist,
  onNotify,
  onSeat,
  onRemove,
  onAddNew,
}: WaitlistPanelProps) {
  const waitingEntries = waitlist.filter(e => e.status === 'waiting' || !e.status)

  return (
    <div className="bg-white rounded-lg border-2 border-amber-400 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-amber-400 bg-amber-500 rounded-t-lg">
        <h3 className="font-bold text-lg flex items-center gap-2 text-white">
          WAITLIST
          <span className="bg-white text-amber-600 text-sm font-bold px-2.5 py-0.5 rounded-full">
            {waitingEntries.length}
          </span>
        </h3>
        {onAddNew && (
          <Button variant="outline" size="sm" onClick={onAddNew} className="bg-white text-amber-700 border-white hover:bg-amber-50">
            + Add
          </Button>
        )}
      </div>

      {/* Waitlist entries */}
      <div className="max-h-64 overflow-y-auto bg-amber-50">
        {waitingEntries.length === 0 ? (
          <div className="p-4 text-center text-gray-600 font-medium">
            No one waiting
          </div>
        ) : (
          <div className="divide-y divide-amber-200">
            {waitingEntries.map((entry, index) => (
              <div
                key={entry.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-amber-100"
              >
                <div className="flex items-center gap-3">
                  {/* Position number */}
                  <span className="w-8 h-8 flex items-center justify-center bg-amber-500 text-white rounded-full text-sm font-bold">
                    {index + 1}
                  </span>

                  {/* Customer info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-lg">{entry.customerName.split(' ')[0]}</span>
                      {entry.partySize > 1 && (
                        <span className="text-amber-700 font-semibold">
                          ({entry.partySize})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700 font-medium">
                      {entry.menuItem && (
                        <span className="text-blue-700">{entry.menuItem.name}</span>
                      )}
                      <span>•</span>
                      <span className="text-amber-700 font-semibold">{formatWaitTime(entry.waitMinutes)}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {onNotify && (
                    <Button
                      size="sm"
                      className="bg-blue-600 text-white hover:bg-blue-700 font-semibold"
                      onClick={() => onNotify(entry.id)}
                    >
                      Notify
                    </Button>
                  )}
                  {onSeat && (
                    <Button
                      size="sm"
                      className="bg-green-600 text-white hover:bg-green-700 font-semibold"
                      onClick={() => onSeat(entry.id)}
                    >
                      Seat
                    </Button>
                  )}
                  {onRemove && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-400 hover:bg-red-100 font-semibold"
                      onClick={() => onRemove(entry.id)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
