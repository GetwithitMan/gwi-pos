'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'

interface TabNamePromptModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (name: string) => void
  cardInfo?: { cardholderName?: string; cardLast4?: string; cardType?: string } | null
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
            <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
              <span className="text-green-400 text-sm">{'\u2713'}</span>
              <span className="text-green-300 text-sm font-medium">
                {cardInfo.cardType} {'\u2022\u2022\u2022'}{cardInfo.cardLast4}
              </span>
              {cardInfo.cardholderName && (
                <span className="text-green-300 text-sm ml-auto font-medium">{cardInfo.cardholderName}</span>
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
