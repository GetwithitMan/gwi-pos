/**
 * Tax Calculator for Payroll
 * Handles federal, state, FICA, and local tax calculations
 */

// 2024 Federal Tax Brackets (Single)
const FEDERAL_BRACKETS_SINGLE = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 },
]

// 2024 Federal Tax Brackets (Married Filing Jointly)
const FEDERAL_BRACKETS_MARRIED = [
  { min: 0, max: 23200, rate: 0.10 },
  { min: 23200, max: 94300, rate: 0.12 },
  { min: 94300, max: 201050, rate: 0.22 },
  { min: 201050, max: 383900, rate: 0.24 },
  { min: 383900, max: 487450, rate: 0.32 },
  { min: 487450, max: 731200, rate: 0.35 },
  { min: 731200, max: Infinity, rate: 0.37 },
]

// 2024 Standard Deduction
const STANDARD_DEDUCTION = {
  single: 14600,
  married: 29200,
  head_of_household: 21900,
}

// 2024 FICA Rates
const FICA_RATES = {
  socialSecurity: 0.062,  // 6.2%
  socialSecurityWageBase: 168600, // 2024 wage base
  medicare: 0.0145,       // 1.45%
  additionalMedicare: 0.009, // Additional 0.9% on wages over $200k
  additionalMedicareThreshold: 200000,
}

// State Tax Rates (simplified - flat rate states)
const STATE_TAX_RATES: Record<string, { rate: number; type: 'flat' | 'progressive'; brackets?: { min: number; max: number; rate: number }[] }> = {
  // No income tax states
  'AK': { rate: 0, type: 'flat' },
  'FL': { rate: 0, type: 'flat' },
  'NV': { rate: 0, type: 'flat' },
  'NH': { rate: 0, type: 'flat' }, // Only taxes interest/dividends
  'SD': { rate: 0, type: 'flat' },
  'TN': { rate: 0, type: 'flat' },
  'TX': { rate: 0, type: 'flat' },
  'WA': { rate: 0, type: 'flat' },
  'WY': { rate: 0, type: 'flat' },
  // Flat rate states
  'AZ': { rate: 0.025, type: 'flat' },
  'CO': { rate: 0.044, type: 'flat' },
  'GA': { rate: 0.0549, type: 'flat' },
  'ID': { rate: 0.058, type: 'flat' },
  'IL': { rate: 0.0495, type: 'flat' },
  'IN': { rate: 0.0305, type: 'flat' },
  'KY': { rate: 0.04, type: 'flat' },
  'MA': { rate: 0.05, type: 'flat' },
  'MI': { rate: 0.0425, type: 'flat' },
  'NC': { rate: 0.0475, type: 'flat' },
  'PA': { rate: 0.0307, type: 'flat' },
  'UT': { rate: 0.0465, type: 'flat' },
  // Progressive states (simplified to average effective rate for now)
  'CA': { rate: 0.0725, type: 'flat' }, // Simplified - actual is progressive up to 13.3%
  'NY': { rate: 0.0685, type: 'flat' }, // Simplified - actual is progressive
  'NJ': { rate: 0.0637, type: 'flat' }, // Simplified
  'OH': { rate: 0.04, type: 'flat' },   // Simplified
}

export interface TaxCalculationInput {
  grossPay: number
  payFrequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
  filingStatus: 'single' | 'married' | 'head_of_household'
  federalAllowances: number
  stateCode?: string
  stateAllowances?: number
  localTaxRate?: number
  additionalWithholding?: number
  isExemptFromFederal?: boolean
  isExemptFromState?: boolean
  ytdGrossWages?: number // For Social Security wage base check
}

export interface TaxCalculationResult {
  grossPay: number
  federalTax: number
  stateTax: number
  localTax: number
  socialSecurity: number
  medicare: number
  totalTax: number
  netPay: number
  effectiveTaxRate: number
  breakdown: {
    annualizedGross: number
    standardDeduction: number
    taxableIncome: number
    federalBracket: string
  }
}

/**
 * Calculate pay frequency multiplier for annualization
 */
function getPayFrequencyMultiplier(frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'): number {
  switch (frequency) {
    case 'weekly': return 52
    case 'biweekly': return 26
    case 'semimonthly': return 24
    case 'monthly': return 12
  }
}

/**
 * Calculate federal income tax withholding
 */
function calculateFederalTax(
  grossPay: number,
  payFrequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly',
  filingStatus: 'single' | 'married' | 'head_of_household',
  allowances: number,
  isExempt: boolean
): { tax: number; annualizedGross: number; standardDeduction: number; taxableIncome: number; bracket: string } {
  if (isExempt) {
    return { tax: 0, annualizedGross: 0, standardDeduction: 0, taxableIncome: 0, bracket: 'Exempt' }
  }

  const multiplier = getPayFrequencyMultiplier(payFrequency)
  const annualizedGross = grossPay * multiplier

  // Standard deduction
  const deduction = STANDARD_DEDUCTION[filingStatus] || STANDARD_DEDUCTION.single

  // Each allowance reduces taxable income (using $4,300 per allowance for 2024)
  const allowanceAmount = allowances * 4300

  // Calculate taxable income
  const taxableIncome = Math.max(0, annualizedGross - deduction - allowanceAmount)

  // Get appropriate brackets
  const brackets = filingStatus === 'married' ? FEDERAL_BRACKETS_MARRIED : FEDERAL_BRACKETS_SINGLE

  // Calculate tax using progressive brackets
  let annualTax = 0
  let currentBracket = '10%'

  for (const bracket of brackets) {
    if (taxableIncome > bracket.min) {
      const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min
      annualTax += taxableInBracket * bracket.rate
      currentBracket = `${(bracket.rate * 100).toFixed(0)}%`
    }
  }

  // Convert back to per-pay-period amount
  const periodTax = Math.round((annualTax / multiplier) * 100) / 100

  return {
    tax: Math.max(0, periodTax),
    annualizedGross,
    standardDeduction: deduction,
    taxableIncome,
    bracket: currentBracket,
  }
}

/**
 * Calculate state income tax withholding
 */
function calculateStateTax(
  grossPay: number,
  stateCode: string | undefined,
  isExempt: boolean
): number {
  if (isExempt || !stateCode) return 0

  const stateConfig = STATE_TAX_RATES[stateCode.toUpperCase()]
  if (!stateConfig) return 0

  // Simple flat rate calculation
  const tax = grossPay * stateConfig.rate
  return Math.round(tax * 100) / 100
}

/**
 * Calculate FICA (Social Security and Medicare)
 */
function calculateFICA(
  grossPay: number,
  ytdGrossWages: number = 0
): { socialSecurity: number; medicare: number } {
  // Social Security (6.2% up to wage base)
  const remainingWageBase = Math.max(0, FICA_RATES.socialSecurityWageBase - ytdGrossWages)
  const socialSecurityWages = Math.min(grossPay, remainingWageBase)
  const socialSecurity = Math.round(socialSecurityWages * FICA_RATES.socialSecurity * 100) / 100

  // Medicare (1.45% on all wages, plus 0.9% on wages over $200k)
  let medicare = grossPay * FICA_RATES.medicare

  // Check for additional Medicare tax
  const totalWages = ytdGrossWages + grossPay
  if (totalWages > FICA_RATES.additionalMedicareThreshold) {
    const wagesOverThreshold = Math.min(
      grossPay,
      totalWages - FICA_RATES.additionalMedicareThreshold
    )
    if (wagesOverThreshold > 0) {
      medicare += wagesOverThreshold * FICA_RATES.additionalMedicare
    }
  }

  return {
    socialSecurity,
    medicare: Math.round(medicare * 100) / 100,
  }
}

/**
 * Main tax calculation function
 */
export function calculateTaxes(input: TaxCalculationInput): TaxCalculationResult {
  const {
    grossPay,
    payFrequency,
    filingStatus,
    federalAllowances,
    stateCode,
    localTaxRate = 0,
    additionalWithholding = 0,
    isExemptFromFederal = false,
    isExemptFromState = false,
    ytdGrossWages = 0,
  } = input

  // Calculate federal tax
  const federal = calculateFederalTax(
    grossPay,
    payFrequency,
    filingStatus,
    federalAllowances,
    isExemptFromFederal
  )

  // Calculate state tax
  const stateTax = calculateStateTax(grossPay, stateCode, isExemptFromState)

  // Calculate local tax
  const localTax = Math.round(grossPay * (localTaxRate / 100) * 100) / 100

  // Calculate FICA
  const fica = calculateFICA(grossPay, ytdGrossWages)

  // Add additional withholding
  const federalTax = Math.round((federal.tax + additionalWithholding) * 100) / 100

  // Total taxes
  const totalTax = Math.round((
    federalTax +
    stateTax +
    localTax +
    fica.socialSecurity +
    fica.medicare
  ) * 100) / 100

  // Net pay
  const netPay = Math.round((grossPay - totalTax) * 100) / 100

  // Effective tax rate
  const effectiveTaxRate = grossPay > 0
    ? Math.round((totalTax / grossPay) * 10000) / 100
    : 0

  return {
    grossPay,
    federalTax,
    stateTax,
    localTax,
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare,
    totalTax,
    netPay,
    effectiveTaxRate,
    breakdown: {
      annualizedGross: federal.annualizedGross,
      standardDeduction: federal.standardDeduction,
      taxableIncome: federal.taxableIncome,
      federalBracket: federal.bracket,
    },
  }
}

/**
 * Calculate employer-side taxes (for labor cost reporting)
 */
export function calculateEmployerTaxes(grossPay: number, ytdGrossWages: number = 0): {
  socialSecurity: number
  medicare: number
  futa: number // Federal Unemployment
  total: number
} {
  // Employer matches FICA
  const fica = calculateFICA(grossPay, ytdGrossWages)

  // FUTA (Federal Unemployment Tax Act) - 6% on first $7,000 of wages
  // Usually reduced to 0.6% with state unemployment credit
  const futaWageBase = 7000
  const remainingFutaBase = Math.max(0, futaWageBase - ytdGrossWages)
  const futaWages = Math.min(grossPay, remainingFutaBase)
  const futa = Math.round(futaWages * 0.006 * 100) / 100 // 0.6% effective rate

  return {
    socialSecurity: fica.socialSecurity,
    medicare: fica.medicare,
    futa,
    total: Math.round((fica.socialSecurity + fica.medicare + futa) * 100) / 100,
  }
}

/**
 * Get list of available states for tax configuration
 */
export function getStateList(): { code: string; name: string; hasIncomeTax: boolean }[] {
  const states = [
    { code: 'AL', name: 'Alabama', hasIncomeTax: true },
    { code: 'AK', name: 'Alaska', hasIncomeTax: false },
    { code: 'AZ', name: 'Arizona', hasIncomeTax: true },
    { code: 'AR', name: 'Arkansas', hasIncomeTax: true },
    { code: 'CA', name: 'California', hasIncomeTax: true },
    { code: 'CO', name: 'Colorado', hasIncomeTax: true },
    { code: 'CT', name: 'Connecticut', hasIncomeTax: true },
    { code: 'DE', name: 'Delaware', hasIncomeTax: true },
    { code: 'FL', name: 'Florida', hasIncomeTax: false },
    { code: 'GA', name: 'Georgia', hasIncomeTax: true },
    { code: 'HI', name: 'Hawaii', hasIncomeTax: true },
    { code: 'ID', name: 'Idaho', hasIncomeTax: true },
    { code: 'IL', name: 'Illinois', hasIncomeTax: true },
    { code: 'IN', name: 'Indiana', hasIncomeTax: true },
    { code: 'IA', name: 'Iowa', hasIncomeTax: true },
    { code: 'KS', name: 'Kansas', hasIncomeTax: true },
    { code: 'KY', name: 'Kentucky', hasIncomeTax: true },
    { code: 'LA', name: 'Louisiana', hasIncomeTax: true },
    { code: 'ME', name: 'Maine', hasIncomeTax: true },
    { code: 'MD', name: 'Maryland', hasIncomeTax: true },
    { code: 'MA', name: 'Massachusetts', hasIncomeTax: true },
    { code: 'MI', name: 'Michigan', hasIncomeTax: true },
    { code: 'MN', name: 'Minnesota', hasIncomeTax: true },
    { code: 'MS', name: 'Mississippi', hasIncomeTax: true },
    { code: 'MO', name: 'Missouri', hasIncomeTax: true },
    { code: 'MT', name: 'Montana', hasIncomeTax: true },
    { code: 'NE', name: 'Nebraska', hasIncomeTax: true },
    { code: 'NV', name: 'Nevada', hasIncomeTax: false },
    { code: 'NH', name: 'New Hampshire', hasIncomeTax: false },
    { code: 'NJ', name: 'New Jersey', hasIncomeTax: true },
    { code: 'NM', name: 'New Mexico', hasIncomeTax: true },
    { code: 'NY', name: 'New York', hasIncomeTax: true },
    { code: 'NC', name: 'North Carolina', hasIncomeTax: true },
    { code: 'ND', name: 'North Dakota', hasIncomeTax: true },
    { code: 'OH', name: 'Ohio', hasIncomeTax: true },
    { code: 'OK', name: 'Oklahoma', hasIncomeTax: true },
    { code: 'OR', name: 'Oregon', hasIncomeTax: true },
    { code: 'PA', name: 'Pennsylvania', hasIncomeTax: true },
    { code: 'RI', name: 'Rhode Island', hasIncomeTax: true },
    { code: 'SC', name: 'South Carolina', hasIncomeTax: true },
    { code: 'SD', name: 'South Dakota', hasIncomeTax: false },
    { code: 'TN', name: 'Tennessee', hasIncomeTax: false },
    { code: 'TX', name: 'Texas', hasIncomeTax: false },
    { code: 'UT', name: 'Utah', hasIncomeTax: true },
    { code: 'VT', name: 'Vermont', hasIncomeTax: true },
    { code: 'VA', name: 'Virginia', hasIncomeTax: true },
    { code: 'WA', name: 'Washington', hasIncomeTax: false },
    { code: 'WV', name: 'West Virginia', hasIncomeTax: true },
    { code: 'WI', name: 'Wisconsin', hasIncomeTax: true },
    { code: 'WY', name: 'Wyoming', hasIncomeTax: false },
    { code: 'DC', name: 'District of Columbia', hasIncomeTax: true },
  ]
  return states.sort((a, b) => a.name.localeCompare(b.name))
}
