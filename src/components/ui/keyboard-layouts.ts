export type KeyType = 'char' | 'shift' | 'backspace' | 'space' | 'enter' | 'mode-toggle'

export interface KeyDef {
  label: string
  shiftLabel?: string
  type: KeyType
  flex?: number
}

// QWERTY layout
export const QWERTY_ROWS: KeyDef[][] = [
  // Row 1
  [
    { label: 'q', shiftLabel: 'Q', type: 'char' },
    { label: 'w', shiftLabel: 'W', type: 'char' },
    { label: 'e', shiftLabel: 'E', type: 'char' },
    { label: 'r', shiftLabel: 'R', type: 'char' },
    { label: 't', shiftLabel: 'T', type: 'char' },
    { label: 'y', shiftLabel: 'Y', type: 'char' },
    { label: 'u', shiftLabel: 'U', type: 'char' },
    { label: 'i', shiftLabel: 'I', type: 'char' },
    { label: 'o', shiftLabel: 'O', type: 'char' },
    { label: 'p', shiftLabel: 'P', type: 'char' },
  ],
  // Row 2
  [
    { label: 'a', shiftLabel: 'A', type: 'char' },
    { label: 's', shiftLabel: 'S', type: 'char' },
    { label: 'd', shiftLabel: 'D', type: 'char' },
    { label: 'f', shiftLabel: 'F', type: 'char' },
    { label: 'g', shiftLabel: 'G', type: 'char' },
    { label: 'h', shiftLabel: 'H', type: 'char' },
    { label: 'j', shiftLabel: 'J', type: 'char' },
    { label: 'k', shiftLabel: 'K', type: 'char' },
    { label: 'l', shiftLabel: 'L', type: 'char' },
  ],
  // Row 3
  [
    { label: '⇧', type: 'shift', flex: 1.5 },
    { label: 'z', shiftLabel: 'Z', type: 'char' },
    { label: 'x', shiftLabel: 'X', type: 'char' },
    { label: 'c', shiftLabel: 'C', type: 'char' },
    { label: 'v', shiftLabel: 'V', type: 'char' },
    { label: 'b', shiftLabel: 'B', type: 'char' },
    { label: 'n', shiftLabel: 'N', type: 'char' },
    { label: 'm', shiftLabel: 'M', type: 'char' },
    { label: '⌫', type: 'backspace', flex: 1.5 },
  ],
  // Row 4
  [
    { label: '?123', type: 'mode-toggle', flex: 1.5 },
    { label: ',', type: 'char' },
    { label: ' ', type: 'space', flex: 4 },
    { label: '.', type: 'char' },
    { label: 'Done', type: 'enter', flex: 1.5 },
  ],
]

// Symbols layout
export const SYMBOL_ROWS: KeyDef[][] = [
  // Row 1
  [
    { label: '1', type: 'char' },
    { label: '2', type: 'char' },
    { label: '3', type: 'char' },
    { label: '4', type: 'char' },
    { label: '5', type: 'char' },
    { label: '6', type: 'char' },
    { label: '7', type: 'char' },
    { label: '8', type: 'char' },
    { label: '9', type: 'char' },
    { label: '0', type: 'char' },
  ],
  // Row 2
  [
    { label: '@', type: 'char' },
    { label: '#', type: 'char' },
    { label: '$', type: 'char' },
    { label: '&', type: 'char' },
    { label: '*', type: 'char' },
    { label: '(', type: 'char' },
    { label: ')', type: 'char' },
    { label: "'", type: 'char' },
    { label: '"', type: 'char' },
  ],
  // Row 3
  [
    { label: '⇧', type: 'shift', flex: 1.5 },
    { label: '-', type: 'char' },
    { label: '+', type: 'char' },
    { label: '=', type: 'char' },
    { label: '/', type: 'char' },
    { label: '!', type: 'char' },
    { label: '?', type: 'char' },
    { label: ':', type: 'char' },
    { label: '⌫', type: 'backspace', flex: 1.5 },
  ],
  // Row 4
  [
    { label: 'ABC', type: 'mode-toggle', flex: 1.5 },
    { label: ',', type: 'char' },
    { label: ' ', type: 'space', flex: 4 },
    { label: '.', type: 'char' },
    { label: 'Done', type: 'enter', flex: 1.5 },
  ],
]

// Numeric layout (calculator/PIN style)
export const NUMERIC_ROWS: KeyDef[][] = [
  [
    { label: '1', type: 'char' },
    { label: '2', type: 'char' },
    { label: '3', type: 'char' },
  ],
  [
    { label: '4', type: 'char' },
    { label: '5', type: 'char' },
    { label: '6', type: 'char' },
  ],
  [
    { label: '7', type: 'char' },
    { label: '8', type: 'char' },
    { label: '9', type: 'char' },
  ],
  [
    { label: '⌫', type: 'backspace' },
    { label: '0', type: 'char' },
    { label: 'Done', type: 'enter' },
  ],
]

// Phone layout (with +, -, parentheses)
export const PHONE_ROWS: KeyDef[][] = [
  [
    { label: '1', type: 'char' },
    { label: '2', type: 'char' },
    { label: '3', type: 'char' },
  ],
  [
    { label: '4', type: 'char' },
    { label: '5', type: 'char' },
    { label: '6', type: 'char' },
  ],
  [
    { label: '7', type: 'char' },
    { label: '8', type: 'char' },
    { label: '9', type: 'char' },
  ],
  [
    { label: '+', type: 'char' },
    { label: '0', type: 'char' },
    { label: '⌫', type: 'backspace' },
  ],
  [
    { label: '-', type: 'char' },
    { label: '(', type: 'char' },
    { label: ')', type: 'char' },
  ],
]
