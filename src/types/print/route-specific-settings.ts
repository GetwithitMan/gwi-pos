export interface RouteSpecificSettings {
  textSize?: 'normal' | 'large'          // Override ticket text size
  useRedInk?: boolean                     // Red ribbon for this route
  boldHeaders?: boolean                   // Bold all header lines
  printCopies?: number                    // Print N copies (default 1)
  showPrices?: boolean                    // Show item prices on ticket
  customHeader?: string                   // Extra header line (e.g. "URGENT")
  customFooter?: string                   // Extra footer line
}

export const DEFAULT_ROUTE_SETTINGS: RouteSpecificSettings = {
  textSize: 'normal',
  useRedInk: false,
  boldHeaders: false,
  printCopies: 1,
  showPrices: false,
}
