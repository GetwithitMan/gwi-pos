/**
 * ESC/POS Commands for Epson thermal and impact printers
 * Compatible with TM-T88VII (thermal) and TM-U220 (impact)
 */

// ESC/POS Command Constants
export const ESCPOS = {
  // Initialization
  INIT: Buffer.from([0x1b, 0x40]), // Reset printer

  // Text Formatting
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),

  UNDERLINE_ON: Buffer.from([0x1b, 0x2d, 0x01]),
  UNDERLINE_OFF: Buffer.from([0x1b, 0x2d, 0x00]),

  ITALIC_ON: Buffer.from([0x1b, 0x34, 0x01]), // Not all printers support
  ITALIC_OFF: Buffer.from([0x1b, 0x34, 0x00]),

  INVERSE_ON: Buffer.from([0x1d, 0x42, 0x01]),
  INVERSE_OFF: Buffer.from([0x1d, 0x42, 0x00]),

  // Text Size (GS ! - for thermal printers)
  NORMAL_SIZE: Buffer.from([0x1d, 0x21, 0x00]),
  DOUBLE_HEIGHT: Buffer.from([0x1d, 0x21, 0x01]),
  DOUBLE_WIDTH: Buffer.from([0x1d, 0x21, 0x10]),
  DOUBLE_SIZE: Buffer.from([0x1d, 0x21, 0x11]), // Both width and height

  // Text Size (ESC ! - for impact printers like TM-U220)
  // ESC ! n: bit4=double-height, bit5=double-width, bit3=emphasized
  IMPACT_NORMAL: Buffer.from([0x1b, 0x21, 0x00]),
  IMPACT_DOUBLE_HEIGHT: Buffer.from([0x1b, 0x21, 0x10]), // bit 4
  IMPACT_DOUBLE_WIDTH: Buffer.from([0x1b, 0x21, 0x20]), // bit 5
  IMPACT_DOUBLE_SIZE: Buffer.from([0x1b, 0x21, 0x30]), // bits 4+5
  IMPACT_EMPHASIZED: Buffer.from([0x1b, 0x21, 0x08]), // bit 3 (bold)

  // Text Alignment
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([0x1b, 0x61, 0x02]),

  // Line Spacing
  LINE_SPACING_DEFAULT: Buffer.from([0x1b, 0x32]),
  LINE_SPACING_SET: (n: number) => Buffer.from([0x1b, 0x33, n]),

  // Paper Control
  FEED_LINE: Buffer.from([0x0a]), // Single line feed
  FEED_LINES: (n: number) => Buffer.from([0x1b, 0x64, n]), // Feed n lines

  // Paper Cutting
  CUT_FULL: Buffer.from([0x1d, 0x56, 0x00]),
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x01]),
  CUT_FEED_FULL: Buffer.from([0x1d, 0x56, 0x41, 0x03]), // Feed 3 lines then full cut
  CUT_FEED_PARTIAL: Buffer.from([0x1d, 0x56, 0x42, 0x03]), // Feed 3 lines then partial cut

  // Cash Drawer
  DRAWER_KICK: Buffer.from([0x1b, 0x70, 0x00, 0x19, 0x78]), // Kick cash drawer

  // Beeper (some models)
  BEEP: Buffer.from([0x1b, 0x42, 0x02, 0x02]), // 2 beeps

  // Print Color (for two-color printers like TM-U220)
  // ESC r n - Select print color
  COLOR_BLACK: Buffer.from([0x1b, 0x72, 0x00]), // Color 1 (black)
  COLOR_RED: Buffer.from([0x1b, 0x72, 0x01]),   // Color 2 (red)

  // Character Sets
  CODE_PAGE_PC437: Buffer.from([0x1b, 0x74, 0x00]), // USA, Standard Europe
  CODE_PAGE_PC850: Buffer.from([0x1b, 0x74, 0x02]), // Multilingual

  // Horizontal Tab
  TAB: Buffer.from([0x09]),
  SET_TAB_POSITIONS: (...positions: number[]) => {
    const cmd = [0x1b, 0x44, ...positions, 0x00]
    return Buffer.from(cmd)
  },

  // Barcode (basic support)
  BARCODE_HEIGHT: (n: number) => Buffer.from([0x1d, 0x68, n]),
  BARCODE_WIDTH: (n: number) => Buffer.from([0x1d, 0x77, n]), // n = 2-6
  BARCODE_TEXT_BELOW: Buffer.from([0x1d, 0x48, 0x02]),
  BARCODE_TEXT_NONE: Buffer.from([0x1d, 0x48, 0x00]),
  BARCODE_CODE39: (data: string) =>
    Buffer.concat([Buffer.from([0x1d, 0x6b, 0x04]), Buffer.from(data), Buffer.from([0x00])]),
  BARCODE_CODE128: (data: string) =>
    Buffer.concat([Buffer.from([0x1d, 0x6b, 0x49, data.length]), Buffer.from(data)]),
}

/**
 * Create a text buffer with optional encoding
 */
export function text(content: string, encoding: BufferEncoding = 'utf8'): Buffer {
  return Buffer.from(content, encoding)
}

/**
 * Create a line of text followed by a newline
 */
export function line(content: string): Buffer {
  return Buffer.concat([text(content), ESCPOS.FEED_LINE])
}

/**
 * Create a divider line (dashes)
 */
export function divider(width: number = 48, char: string = '-'): Buffer {
  return line(char.repeat(width))
}

/**
 * Create a centered line
 */
export function centeredLine(content: string): Buffer {
  return Buffer.concat([ESCPOS.ALIGN_CENTER, line(content), ESCPOS.ALIGN_LEFT])
}

/**
 * Create a bold line
 */
export function boldLine(content: string): Buffer {
  return Buffer.concat([ESCPOS.BOLD_ON, line(content), ESCPOS.BOLD_OFF])
}

/**
 * Create a large/double-size line (for headers)
 */
export function largeLine(content: string): Buffer {
  return Buffer.concat([ESCPOS.DOUBLE_SIZE, line(content), ESCPOS.NORMAL_SIZE])
}

/**
 * Create a two-column line (left and right aligned)
 * @param left - Left text
 * @param right - Right text
 * @param width - Total line width (default 48 for 80mm paper)
 */
export function twoColumnLine(left: string, right: string, width: number = 48): Buffer {
  const spaces = Math.max(1, width - left.length - right.length)
  return line(left + ' '.repeat(spaces) + right)
}

/**
 * Create a three-column line
 * @param left - Left text
 * @param center - Center text
 * @param right - Right text
 * @param width - Total line width
 */
export function threeColumnLine(
  left: string,
  center: string,
  right: string,
  width: number = 48
): Buffer {
  const usedWidth = left.length + center.length + right.length
  const totalSpaces = Math.max(2, width - usedWidth)
  const leftSpaces = Math.floor(totalSpaces / 2)
  const rightSpaces = totalSpaces - leftSpaces
  return line(left + ' '.repeat(leftSpaces) + center + ' '.repeat(rightSpaces) + right)
}

/**
 * Build a complete receipt/ticket by combining commands
 * Note: COLOR_BLACK at end ensures TM-U220 (impact) printers don't retain red state
 */
export function buildDocument(...parts: Buffer[]): Buffer {
  return Buffer.concat([
    ESCPOS.INIT,
    ...parts,
    ESCPOS.COLOR_BLACK, // Safety reset - TM-U220 is stateful
    ESCPOS.NORMAL_SIZE,
    ESCPOS.FEED_LINES(3),
    ESCPOS.CUT_PARTIAL,
  ])
}

/**
 * Build a document without cut (for impact printers that may not support it)
 * Note: COLOR_BLACK at end ensures TM-U220 doesn't retain red state between jobs
 */
export function buildDocumentNoCut(...parts: Buffer[]): Buffer {
  return Buffer.concat([
    ESCPOS.INIT,
    ESCPOS.COLOR_BLACK, // Ensure we start in black (belt-and-suspenders with INIT)
    ...parts,
    ESCPOS.COLOR_BLACK, // Safety reset - TM-U220 is stateful
    ESCPOS.IMPACT_NORMAL, // Reset text size for impact printers
    ESCPOS.FEED_LINES(5),
  ])
}

/**
 * Paper width configurations
 */
export const PAPER_WIDTH = {
  '80mm': 48, // 48 characters at normal font
  '58mm': 32, // 32 characters at normal font
  '40mm': 20, // 20 characters (for small receipt printers)
} as const
