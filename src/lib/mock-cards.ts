// Mock Card Database for Simulated Payment Processing
// Used in development mode and training mode

export type CardType = 'visa' | 'mastercard' | 'amex' | 'discover'

export interface MockCard {
  id: string
  firstName: string
  lastName: string
  cardType: CardType
  lastFour: string
  shouldDecline: boolean
}

// 55 mock cards with realistic diversity
// Distribution: ~50% Visa, ~30% Mastercard, ~15% Amex, ~5% Discover
// ~5% will decline (3 cards)
export const mockCards: MockCard[] = [
  // Visa cards (27)
  { id: '1', firstName: 'John', lastName: 'Smith', cardType: 'visa', lastFour: '4242', shouldDecline: false },
  { id: '2', firstName: 'Sarah', lastName: 'Johnson', cardType: 'visa', lastFour: '1234', shouldDecline: false },
  { id: '3', firstName: 'Michael', lastName: 'Williams', cardType: 'visa', lastFour: '5678', shouldDecline: false },
  { id: '4', firstName: 'Emily', lastName: 'Brown', cardType: 'visa', lastFour: '9012', shouldDecline: false },
  { id: '5', firstName: 'David', lastName: 'Garcia', cardType: 'visa', lastFour: '3456', shouldDecline: false },
  { id: '6', firstName: 'Jessica', lastName: 'Martinez', cardType: 'visa', lastFour: '7890', shouldDecline: false },
  { id: '7', firstName: 'Christopher', lastName: 'Anderson', cardType: 'visa', lastFour: '2345', shouldDecline: false },
  { id: '8', firstName: 'Amanda', lastName: 'Taylor', cardType: 'visa', lastFour: '6789', shouldDecline: false },
  { id: '9', firstName: 'Daniel', lastName: 'Thomas', cardType: 'visa', lastFour: '0123', shouldDecline: false },
  { id: '10', firstName: 'Michelle', lastName: 'Hernandez', cardType: 'visa', lastFour: '4567', shouldDecline: false },
  { id: '11', firstName: 'James', lastName: 'Moore', cardType: 'visa', lastFour: '8901', shouldDecline: false },
  { id: '12', firstName: 'Jennifer', lastName: 'Jackson', cardType: 'visa', lastFour: '2468', shouldDecline: false },
  { id: '13', firstName: 'Robert', lastName: 'White', cardType: 'visa', lastFour: '1357', shouldDecline: false },
  { id: '14', firstName: 'Lisa', lastName: 'Lopez', cardType: 'visa', lastFour: '9753', shouldDecline: false },
  { id: '15', firstName: 'William', lastName: 'Lee', cardType: 'visa', lastFour: '8642', shouldDecline: false },
  { id: '16', firstName: 'Ashley', lastName: 'Walker', cardType: 'visa', lastFour: '7531', shouldDecline: false },
  { id: '17', firstName: 'Joseph', lastName: 'Hall', cardType: 'visa', lastFour: '6420', shouldDecline: false },
  { id: '18', firstName: 'Kimberly', lastName: 'Allen', cardType: 'visa', lastFour: '5319', shouldDecline: false },
  { id: '19', firstName: 'Thomas', lastName: 'Young', cardType: 'visa', lastFour: '4208', shouldDecline: false },
  { id: '20', firstName: 'Nicole', lastName: 'King', cardType: 'visa', lastFour: '3197', shouldDecline: false },
  { id: '21', firstName: 'Kevin', lastName: 'Wright', cardType: 'visa', lastFour: '2086', shouldDecline: false },
  { id: '22', firstName: 'Stephanie', lastName: 'Scott', cardType: 'visa', lastFour: '1975', shouldDecline: false },
  { id: '23', firstName: 'Brian', lastName: 'Torres', cardType: 'visa', lastFour: '0864', shouldDecline: false },
  { id: '24', firstName: 'Maria', lastName: 'Nguyen', cardType: 'visa', lastFour: '9876', shouldDecline: false },
  { id: '25', firstName: 'Jason', lastName: 'Hill', cardType: 'visa', lastFour: '8765', shouldDecline: false },
  { id: '26', firstName: 'Laura', lastName: 'Flores', cardType: 'visa', lastFour: '7654', shouldDecline: true }, // DECLINE
  { id: '27', firstName: 'Andrew', lastName: 'Green', cardType: 'visa', lastFour: '6543', shouldDecline: false },

  // Mastercard cards (17)
  { id: '28', firstName: 'Rachel', lastName: 'Adams', cardType: 'mastercard', lastFour: '5432', shouldDecline: false },
  { id: '29', firstName: 'Mark', lastName: 'Nelson', cardType: 'mastercard', lastFour: '4321', shouldDecline: false },
  { id: '30', firstName: 'Angela', lastName: 'Baker', cardType: 'mastercard', lastFour: '3210', shouldDecline: false },
  { id: '31', firstName: 'Steven', lastName: 'Gonzalez', cardType: 'mastercard', lastFour: '2109', shouldDecline: false },
  { id: '32', firstName: 'Heather', lastName: 'Carter', cardType: 'mastercard', lastFour: '1098', shouldDecline: false },
  { id: '33', firstName: 'Ryan', lastName: 'Mitchell', cardType: 'mastercard', lastFour: '0987', shouldDecline: false },
  { id: '34', firstName: 'Amber', lastName: 'Perez', cardType: 'mastercard', lastFour: '9865', shouldDecline: false },
  { id: '35', firstName: 'Timothy', lastName: 'Roberts', cardType: 'mastercard', lastFour: '8754', shouldDecline: false },
  { id: '36', firstName: 'Megan', lastName: 'Turner', cardType: 'mastercard', lastFour: '7643', shouldDecline: false },
  { id: '37', firstName: 'Eric', lastName: 'Phillips', cardType: 'mastercard', lastFour: '6532', shouldDecline: false },
  { id: '38', firstName: 'Christina', lastName: 'Campbell', cardType: 'mastercard', lastFour: '5421', shouldDecline: false },
  { id: '39', firstName: 'Brandon', lastName: 'Parker', cardType: 'mastercard', lastFour: '4310', shouldDecline: false },
  { id: '40', firstName: 'Samantha', lastName: 'Evans', cardType: 'mastercard', lastFour: '3209', shouldDecline: false },
  { id: '41', firstName: 'Patrick', lastName: 'Edwards', cardType: 'mastercard', lastFour: '2198', shouldDecline: true }, // DECLINE
  { id: '42', firstName: 'Brittany', lastName: 'Collins', cardType: 'mastercard', lastFour: '1087', shouldDecline: false },
  { id: '43', firstName: 'Sean', lastName: 'Stewart', cardType: 'mastercard', lastFour: '0976', shouldDecline: false },
  { id: '44', firstName: 'Victoria', lastName: 'Sanchez', cardType: 'mastercard', lastFour: '9854', shouldDecline: false },

  // American Express cards (8)
  { id: '45', firstName: 'Marcus', lastName: 'Chen', cardType: 'amex', lastFour: '8001', shouldDecline: false },
  { id: '46', firstName: 'Katherine', lastName: 'Morris', cardType: 'amex', lastFour: '7002', shouldDecline: false },
  { id: '47', firstName: 'Derek', lastName: 'Rogers', cardType: 'amex', lastFour: '6003', shouldDecline: false },
  { id: '48', firstName: 'Olivia', lastName: 'Reed', cardType: 'amex', lastFour: '5004', shouldDecline: false },
  { id: '49', firstName: 'Jeffrey', lastName: 'Cook', cardType: 'amex', lastFour: '4005', shouldDecline: false },
  { id: '50', firstName: 'Natalie', lastName: 'Morgan', cardType: 'amex', lastFour: '3006', shouldDecline: false },
  { id: '51', firstName: 'Gregory', lastName: 'Bell', cardType: 'amex', lastFour: '2007', shouldDecline: false },
  { id: '52', firstName: 'Rebecca', lastName: 'Murphy', cardType: 'amex', lastFour: '1008', shouldDecline: false },

  // Discover cards (3)
  { id: '53', firstName: 'Kenneth', lastName: 'Bailey', cardType: 'discover', lastFour: '6011', shouldDecline: false },
  { id: '54', firstName: 'Melissa', lastName: 'Rivera', cardType: 'discover', lastFour: '6022', shouldDecline: false },
  { id: '55', firstName: 'Alexander', lastName: 'Cooper', cardType: 'discover', lastFour: '6033', shouldDecline: true }, // DECLINE
]

/**
 * Get a random card from the mock database
 */
export function getRandomCard(): MockCard {
  return mockCards[Math.floor(Math.random() * mockCards.length)]
}

/**
 * Get a card that will always succeed (for testing success paths)
 */
export function getSuccessCard(): MockCard {
  const successCards = mockCards.filter(c => !c.shouldDecline)
  return successCards[Math.floor(Math.random() * successCards.length)]
}

/**
 * Get a card that will always decline (for testing error paths)
 */
export function getDeclineCard(): MockCard {
  const declineCards = mockCards.filter(c => c.shouldDecline)
  return declineCards[Math.floor(Math.random() * declineCards.length)]
}

/**
 * Delay helper for simulating network/terminal latency
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate random number between min and max (inclusive)
 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Generate a 6-character alphanumeric auth code
 */
export function generateAuthCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * Get card type display name
 */
export function getCardTypeName(cardType: CardType): string {
  const names: Record<CardType, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
  }
  return names[cardType]
}
