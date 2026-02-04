/**
 * Reporting Aggregator Bridge
 *
 * Collects data from all domains for reporting.
 * This is a one-way bridge - Reporting pulls from other domains.
 */

export interface ReportingAggregator {
  // From Order Management
  getSalesData(locationId: string, startDate: Date, endDate: Date): Promise<{
    grossSales: number
    netSales: number
    orderCount: number
    averageCheck: number
    discounts: number
    voids: number
    comps: number
  }>

  getPaymentBreakdown(locationId: string, startDate: Date, endDate: Date): Promise<Array<{
    method: string
    count: number
    amount: number
    tips: number
  }>>

  // From Employee
  getLaborData(locationId: string, startDate: Date, endDate: Date): Promise<{
    totalHours: number
    totalWages: number
    totalTips: number
    laborCostPercent: number
  }>

  getEmployeePerformance(employeeId: string, startDate: Date, endDate: Date): Promise<{
    sales: number
    tips: number
    hours: number
    averageCheck: number
    coverCount: number
  }>

  // From Inventory
  getInventoryUsage(locationId: string, startDate: Date, endDate: Date): Promise<{
    theoreticalCost: number
    actualCost: number
    variance: number
    variancePercent: number
  }>

  getWasteReport(locationId: string, startDate: Date, endDate: Date): Promise<Array<{
    itemId: string
    itemName: string
    quantity: number
    cost: number
    reason: string
  }>>

  // From Menu
  getProductMix(locationId: string, startDate: Date, endDate: Date): Promise<Array<{
    itemId: string
    itemName: string
    categoryId: string
    quantitySold: number
    grossSales: number
    costPercent: number
  }>>

  // From Guest
  getCustomerMetrics(locationId: string, startDate: Date, endDate: Date): Promise<{
    newCustomers: number
    returningCustomers: number
    averageVisits: number
    loyaltyRedemptions: number
  }>

  // From Events
  getEventMetrics(locationId: string, startDate: Date, endDate: Date): Promise<{
    eventCount: number
    ticketsSold: number
    ticketRevenue: number
    averageAttendance: number
  }>

  // From Financial
  getFinancialSummary(locationId: string, startDate: Date, endDate: Date): Promise<{
    giftCardsSold: number
    giftCardsRedeemed: number
    houseAccountCharges: number
    discountsApplied: number
    couponsRedeemed: number
  }>
}

export const reportingAggregator: ReportingAggregator = {
  getSalesData: async () => ({
    grossSales: 0,
    netSales: 0,
    orderCount: 0,
    averageCheck: 0,
    discounts: 0,
    voids: 0,
    comps: 0,
  }),
  getPaymentBreakdown: async () => [],
  getLaborData: async () => ({
    totalHours: 0,
    totalWages: 0,
    totalTips: 0,
    laborCostPercent: 0,
  }),
  getEmployeePerformance: async () => ({
    sales: 0,
    tips: 0,
    hours: 0,
    averageCheck: 0,
    coverCount: 0,
  }),
  getInventoryUsage: async () => ({
    theoreticalCost: 0,
    actualCost: 0,
    variance: 0,
    variancePercent: 0,
  }),
  getWasteReport: async () => [],
  getProductMix: async () => [],
  getCustomerMetrics: async () => ({
    newCustomers: 0,
    returningCustomers: 0,
    averageVisits: 0,
    loyaltyRedemptions: 0,
  }),
  getEventMetrics: async () => ({
    eventCount: 0,
    ticketsSold: 0,
    ticketRevenue: 0,
    averageAttendance: 0,
  }),
  getFinancialSummary: async () => ({
    giftCardsSold: 0,
    giftCardsRedeemed: 0,
    houseAccountCharges: 0,
    discountsApplied: 0,
    couponsRedeemed: 0,
  }),
}
