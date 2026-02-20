'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'

interface TabNamePromptModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string) => void
  cardInfo?: {
    cardholderName?: string
    cardLast4?: string
    cardType?: string
    recordNo?: string
    authAmount?: number
  } | null
}

export function TabNamePromptModal({ isOpen, onClose, onSubmit, cardInfo }: TabNamePromptModalProps) {
  const [nameInput, setNameInput] = useState('')

  const handleClose = () => {
    setNameInput('')
    onClose()
  }

  const handleSubmitWithCard = () => {
    if (nameInput.trim()) {
      const fullName = cardInfo?.cardholderName
        ? `${nameInput.trim()} — ${cardInfo.cardholderName}`
        : nameInput.trim()
      onSubmit(fullName)
    } else {
      onSubmit('')
    }
    setNameInput('')
  }

  const handleSubmitWithoutCard = () => {
    if (!nameInput.trim()) return
    onSubmit(nameInput.trim())
    setNameInput('')
  }

  const handleSkip = () => {
    onSubmit('')
    setNameInput('')
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="2xl">
      <div className="rounded-2xl shadow-2xl w-full p-6 max-h-[85vh] overflow-y-auto -m-5" style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
        {cardInfo?.cardLast4 ? (
          <>
            <h3 className="text-lg font-bold text-white mb-2">Tab Started</h3>
            <div className="mb-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.35)' }}>
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-base">✓</span>
                <span className="text-green-200 text-sm font-bold uppercase tracking-wide">
                  {cardInfo.cardType}
                </span>
                <span className="text-green-300 text-sm font-mono">
                  •••• {cardInfo.cardLast4}
                </span>
                {cardInfo.authAmount != null && (
                  <span className="ml-auto text-green-400 text-sm font-semibold">
                    ${cardInfo.authAmount.toFixed(2)} hold
                  </span>
                )}
              </div>
              {cardInfo.cardholderName && (
                <p className="text-green-300 text-sm font-medium mt-1 ml-6">
                  {cardInfo.cardholderName}
                </p>
              )}
              {cardInfo.recordNo && (
                <p className="mt-1 ml-6 font-mono text-[10px] text-green-600 opacity-70 select-all">
                  {cardInfo.recordNo.startsWith('DC4:')
                    ? `${cardInfo.recordNo.slice(0, 12)}…`
                    : `DC4:${cardInfo.recordNo.slice(0, 8)}…`}
                </p>
              )}
            </div>
            <p className="text-sm text-gray-400 mb-3">Add a nickname? (shown above cardholder name)</p>
            <div
              className="w-full px-4 py-3 rounded-xl text-lg min-h-[48px] flex items-center"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: nameInput ? 'white' : 'rgba(255,255,255,0.4)' }}
            >
              {nameInput || 'e.g. Blue shirt, Patio group...'}
            </div>
            <div className="mt-3">
              <OnScreenKeyboard
                value={nameInput}
                onChange={setNameInput}
                onSubmit={handleSubmitWithCard}
                theme="dark"
                submitLabel="Send to Tab"
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSkip}
                className="flex-1 py-3 rounded-xl text-gray-300 font-semibold"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                Skip
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-white mb-1">Tab Name</h3>
            <p className="text-sm text-gray-400 mb-4">Enter a name for this tab</p>
            <div
              className="w-full px-4 py-3 rounded-xl text-lg min-h-[48px] flex items-center"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: nameInput ? 'white' : 'rgba(255,255,255,0.4)' }}
            >
              {nameInput || 'e.g. John, Table 5, etc.'}
            </div>
            <div className="mt-3">
              <OnScreenKeyboard
                value={nameInput}
                onChange={setNameInput}
                onSubmit={handleSubmitWithoutCard}
                theme="dark"
                submitLabel="Start Tab"
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleClose}
                className="flex-1 py-3 rounded-xl text-gray-400 font-semibold"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
