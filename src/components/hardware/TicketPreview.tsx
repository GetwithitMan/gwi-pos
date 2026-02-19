'use client'

import { useState, useEffect, useRef } from 'react'
import type { TemplateType } from '@/types/routing'
import type {
  PrintTemplateSettings,
  GlobalReceiptSettings,
} from '@/types/print'

// Preview modes for the live preview
export type PreviewMode = 'kitchen' | 'receipt' | 'entertainment'

export interface TicketPreviewProps {
  settings: PrintTemplateSettings
  globalSettings: GlobalReceiptSettings
  templateType: TemplateType
  paperWidth: 80 | 58
  showImpactMode: boolean
  previewMode: PreviewMode
}

export function TicketPreview({
  settings,
  globalSettings,
  templateType,
  paperWidth,
  showImpactMode,
  previewMode,
}: TicketPreviewProps) {
  const charWidth = paperWidth === 80 ? 48 : 32
  const pixelWidth = paperWidth === 80 ? 300 : 220

  const [isFlashing, setIsFlashing] = useState(false)
  const prevSettingsRef = useRef(JSON.stringify(settings) + previewMode)

  useEffect(() => {
    const current = JSON.stringify(settings) + previewMode
    if (current !== prevSettingsRef.current) {
      setIsFlashing(true)
      const timer = setTimeout(() => setIsFlashing(false), 150)
      prevSettingsRef.current = current
      return () => clearTimeout(timer)
    }
  }, [settings, previewMode])

  // Helpers
  const getDividerChar = (style: string) => {
    switch (style) {
      case 'double': return '═'
      case 'star': return '*'
      case 'dot': return '·'
      case 'thick': return '█'
      case 'blank': return ' '
      default: return '-'
    }
  }

  const getModPrefix = () => {
    switch (settings.modifiers.prefix) {
      case 'dash': return '- '
      case 'bullet': return '• '
      case 'arrow': return '> '
      case 'asterisk': return '* '
      default: return ''
    }
  }

  const formatPreMod = (preMod: string, name: string) => {
    const pm = settings.modifiers.caps ? preMod.toUpperCase() : preMod
    const n = settings.modifiers.caps ? name.toUpperCase() : name
    switch (settings.preModifiers.style) {
      case 'stars': return `*${pm}* ${n}`
      case 'brackets': return `[${pm}] ${n}`
      case 'parens': return `(${pm}) ${n}`
      case 'caps': return `${pm.toUpperCase()} ${n.toUpperCase()}`
      default: return `${pm} ${n}`
    }
  }

  const formatSeat = (seat: number) => {
    switch (settings.seats.format) {
      case 'Seat 1': return `Seat ${seat}`
      case '#1': return `#${seat}`
      case '(1)': return `(${seat})`
      default: return `S${seat}`
    }
  }

  const getSizeClass = (size: string) => {
    switch (size) {
      case 'xlarge': return 'text-2xl'
      case 'large': return 'text-lg'
      default: return 'text-sm'
    }
  }

  const getAlignClass = (align: string) => {
    switch (align) {
      case 'right': return 'text-right'
      case 'center': return 'text-center'
      default: return 'text-left'
    }
  }

  const Divider = ({ config }: { config: { style: string } }) => (
    <div className="text-slate-400 select-none overflow-hidden whitespace-nowrap text-xs my-1">
      {getDividerChar(config.style).repeat(charWidth)}
    </div>
  )

  // Two-column line helper for receipts
  const TwoCol = ({ left, right, bold = false }: { left: string; right: string; bold?: boolean }) => (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )

  // Sample data values
  const sampleData: Record<string, string> = {
    stationName: previewMode === 'receipt' ? 'RECEIPT' : 'KITCHEN',
    orderNumber: '124',
    orderType: 'DINE IN',
    tableName: '4',
    tabName: 'Smith Party',
    guestCount: '3',
    serverName: 'Sarah',
    checkNumber: '00124',
    timestamp: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString(),
  }

  // Sample receipt items
  const sampleItems = [
    { name: 'Cheeseburger', price: 14.99, qty: 1, mods: [{ name: 'No Onion', price: 0 }, { name: 'Extra Pickles', price: 0.50 }] },
    { name: 'Caesar Salad', price: 12.99, qty: 2, mods: [{ name: 'Dressing on Side', price: 0 }] },
    { name: 'Draft Beer', price: 6.00, qty: 2, mods: [] },
  ]
  const subtotal = 52.97
  const tax = 4.24
  const total = 57.21

  return (
    <div
      className={`bg-[#fdfdf8] shadow-[0_0_40px_rgba(0,0,0,0.5)] text-black font-mono leading-tight transition-all duration-150 ${isFlashing ? 'ring-4 ring-cyan-400/50' : ''}`}
      style={{
        width: `${pixelWidth}px`,
        padding: paperWidth === 80 ? '20px' : '14px',
        fontSize: paperWidth === 80 ? '11px' : '9px',
      }}
    >
      {/* HEADER ELEMENTS */}
      {settings.headerElements
        .filter((el) => el.enabled)
        .map((element) => {
          const value = sampleData[element.id] || ''
          const displayValue = `${element.prefix}${element.caps ? value.toUpperCase() : value}${element.suffix}`
          const isReverse = element.reversePrint && !showImpactMode
          const isRed = element.redPrint && showImpactMode

          return (
            <div key={element.id}>
              <div
                className={`
                  ${getSizeClass(element.size)}
                  ${getAlignClass(element.alignment)}
                  ${element.bold ? 'font-bold' : ''}
                  ${isReverse ? 'bg-black text-white px-2 py-0.5' : ''}
                  ${isRed ? 'text-red-600' : ''}
                `}
              >
                {displayValue}
              </div>
              {element.borderBottom !== 'none' && (
                <div className="text-slate-400 overflow-hidden whitespace-nowrap text-xs">
                  {getDividerChar(element.borderBottom).repeat(charWidth)}
                </div>
              )}
            </div>
          )
        })}

      {/* Header Divider */}
      <Divider config={settings.dividers.afterHeader} />

      {/* === KITCHEN MODE === */}
      {previewMode === 'kitchen' && (
        <>
          {/* ITEMS */}
          <div className={settings.spacing.compact ? 'space-y-0.5' : 'space-y-2'}>
            {/* Category Header */}
            {settings.categories.enabled && (
              <>
                {settings.categories.dividerAbove && <Divider config={settings.dividers.betweenCategories} />}
                <div
                  className={`
                    ${getSizeClass(settings.categories.size)}
                    ${getAlignClass(settings.categories.alignment)}
                    ${settings.categories.style === 'bold' || settings.categories.style === 'banner' ? 'font-bold' : ''}
                    ${settings.categories.style === 'reverse' ? 'bg-black text-white px-2 py-0.5' : ''}
                  `}
                >
                  {settings.categories.style === 'boxed' && '['}
                  {settings.categories.style === 'banner' && '═══ '}
                  {settings.categories.caps ? 'ENTREES' : 'Entrees'}
                  {settings.categories.style === 'boxed' && ']'}
                  {settings.categories.style === 'banner' && ' ═══'}
                </div>
              </>
            )}

            {/* Item 1 */}
            <div>
              <div className={`${getSizeClass(settings.items.size)} ${settings.items.bold ? 'font-bold' : ''}`}>
                {settings.seats.display === 'prefix' && <span className="text-slate-600">{formatSeat(1)}: </span>}
                {settings.items.quantityPosition === 'before' && '1x '}
                {settings.items.caps ? 'CHEESEBURGER' : 'Cheeseburger'}
                {settings.items.quantityPosition === 'after' && ' x1'}
                {settings.seats.display === 'inline' && <span className="text-slate-500"> ({formatSeat(1)})</span>}
              </div>
              <div style={{ paddingLeft: `${settings.modifiers.indent * 4}px` }} className={settings.modifiers.bold ? 'font-bold' : ''}>
                <div className={settings.preModifiers.highlight ? (showImpactMode ? 'text-red-600 font-bold' : 'bg-black text-white px-1') : ''}>
                  {getModPrefix()}{formatPreMod('NO', 'Onion')}
                </div>
                <div>{getModPrefix()}{settings.modifiers.caps ? 'EXTRA PICKLES' : 'Extra Pickles'}</div>
              </div>
            </div>

            {/* Seat Separator */}
            {settings.seats.groupBySeat && settings.seats.seatSeparator !== 'none' && (
              <div className="text-slate-400 text-xs text-center my-1">
                {settings.seats.seatSeparator === 'newSeat'
                  ? settings.seats.newSeatText.replace('{n}', '2')
                  : settings.seats.seatSeparator === 'blank'
                    ? '\u00A0'
                    : getDividerChar(settings.seats.seatSeparator).repeat(charWidth / 2)
                }
              </div>
            )}

            {/* Item 2 with Notes */}
            <div>
              <div className={`${getSizeClass(settings.items.size)} ${settings.items.bold ? 'font-bold' : ''}`}>
                {settings.seats.display === 'prefix' && <span className="text-slate-600">{formatSeat(2)}: </span>}
                {settings.items.quantityPosition === 'before' && '2x '}
                {settings.items.caps ? 'CAESAR SALAD' : 'Caesar Salad'}
              </div>
              <div style={{ paddingLeft: `${settings.modifiers.indent * 4}px` }}>
                <div>{getModPrefix()}{settings.modifiers.caps ? 'DRESSING ON SIDE' : 'Dressing on Side'}</div>
                {settings.notes.enabled && (
                  <div className={`
                    ${settings.notes.style === 'italic' ? 'italic' : ''}
                    ${settings.notes.style === 'reverse' ? 'bg-black text-white px-1' : ''}
                  `}>
                    {settings.notes.style === 'boxed' && '['}
                    {settings.notes.prefix} Nut allergy
                    {settings.notes.style === 'boxed' && ']'}
                  </div>
                )}
              </div>
            </div>

            {/* Resend Indicator */}
            {settings.indicators.resend.enabled && (
              <div className={`text-center font-bold mt-3 ${settings.indicators.resend.reverse ? (showImpactMode ? 'text-red-600' : 'bg-black text-white px-2 py-0.5') : ''}`}>
                {settings.indicators.resend.format}
              </div>
            )}
          </div>
        </>
      )}

      {/* === RECEIPT MODE === */}
      {previewMode === 'receipt' && (
        <>
          {/* ITEMIZED ITEMS - only show when receiptType is 'itemized' */}
          {settings.receipt.receiptType === 'itemized' && (
            <div className="space-y-1 text-xs">
              {sampleItems.map((item, i) => (
                <div key={i}>
                  <TwoCol
                    left={`${settings.receipt.itemized?.showQuantity && item.qty > 1 ? `${item.qty}x ` : ''}${item.name}`}
                    right={settings.receipt.itemized?.showItemPrices ? `$${(item.price * item.qty).toFixed(2)}` : ''}
                    bold={settings.items.bold}
                  />
                  {settings.receipt.itemized?.showModifiers && item.mods.map((mod, j) => (
                    <TwoCol
                      key={j}
                      left={`${settings.receipt.itemized?.indentModifiers ? '  ' : ''}${mod.name}`}
                      right={settings.receipt.itemized?.showModifierPrices && mod.price > 0 ? `+$${mod.price.toFixed(2)}` : ''}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Simple receipt message */}
          {settings.receipt.receiptType === 'simple' && (
            <div className="text-xs text-center text-slate-500 py-2">
              (Simple receipt - no itemization)
            </div>
          )}

          <Divider config={{ style: 'dash' }} />

          {/* TOTALS */}
          <div className="text-xs space-y-0.5">
            {settings.receipt.totals?.showSubtotal && <TwoCol left="Subtotal" right={`$${subtotal.toFixed(2)}`} />}
            {settings.receipt.totals?.showDiscounts && (
              <TwoCol left="Discount" right="-$5.00" />
            )}
            {settings.receipt.totals?.showServiceCharge && (
              <TwoCol left="Service Charge" right="$4.00" />
            )}
            {settings.receipt.totals?.showTax && (
              <>
                <TwoCol left="Tax" right={`$${tax.toFixed(2)}`} />
                {settings.receipt.totals?.showTaxBreakdown && (
                  <>
                    <TwoCol left="  State Tax (6%)" right="$2.54" />
                    <TwoCol left="  Local Tax (2%)" right="$1.70" />
                  </>
                )}
              </>
            )}
            <TwoCol left="TOTAL" right={`$${total.toFixed(2)}`} bold />
          </div>

          {settings.receipt.totals?.showPaymentMethod && (
            <div className="text-xs mt-2">
              <TwoCol left="VISA *4242" right={`$${total.toFixed(2)}`} />
            </div>
          )}

          {settings.receipt.totals?.showChange && (
            <div className="text-xs">
              <TwoCol left="Cash Tendered" right="$60.00" />
              <TwoCol left="Change" right="$2.79" />
            </div>
          )}

          {/* TIP SECTION */}
          {settings.receipt.tipLine && (
            <>
              <Divider config={{ style: 'dash' }} />
              <div className={`
                text-xs mt-2
                ${settings.receipt.tipSectionStyle?.frame === 'box' ? 'border border-black p-2' : ''}
                ${settings.receipt.tipSectionStyle?.frame === 'dashedBox' ? 'border border-dashed border-black p-2' : ''}
              `}>
                {settings.receipt.tipSectionStyle?.frame === 'doubleLine' && (
                  <div className="text-center text-slate-400 mb-1">{'═'.repeat(charWidth - 4)}</div>
                )}

                {/* Suggested Tips */}
                <div className={`text-center mb-2 ${settings.receipt.tipSectionStyle?.weight === 'bold' || settings.receipt.tipSectionStyle?.weight === 'thick' ? 'font-bold' : ''}`}>
                  <div className="text-slate-500 mb-1">Suggested Gratuity</div>
                  <div className="flex justify-center gap-3">
                    {settings.receipt.suggestedTips.slice(0, settings.receipt.tipSectionStyle?.tipsPerLine || 3).map((pct) => (
                      <span key={pct}>{pct}%=${(total * pct / 100).toFixed(2)}</span>
                    ))}
                  </div>
                </div>

                {/* Tip Line */}
                <div className="mt-2">
                  {settings.receipt.tipSectionStyle?.tipInputStyle === 'checkbox' ? (
                    <div className="flex justify-around">
                      <span>[ ] ${(total * 0.18).toFixed(2)}</span>
                      <span>[ ] ${(total * 0.20).toFixed(2)}</span>
                      <span>[ ] Other</span>
                    </div>
                  ) : settings.receipt.tipSectionStyle?.tipInputStyle === 'blank' ? (
                    <TwoCol left="Tip:" right="" />
                  ) : (
                    <TwoCol left="Tip:" right="__________" />
                  )}
                </div>

                {settings.receipt.tipSectionStyle?.showTipTotal && (
                  <div className="mt-2">
                    <TwoCol left="Total:" right="__________" bold />
                  </div>
                )}

                {settings.receipt.tipSectionStyle?.frame === 'doubleLine' && (
                  <div className="text-center text-slate-400 mt-1">{'═'.repeat(charWidth - 4)}</div>
                )}
              </div>
            </>
          )}

          {/* SIGNATURE */}
          {settings.receipt.signature?.enabled && (
            <div className="mt-4 text-xs">
              <div className="mb-2">
                {settings.receipt.signature?.lineStyle === 'x-line' && 'x'}
                {settings.receipt.signature?.lineStyle === 'dotted' ? '.'.repeat(35) : '_'.repeat(35)}
              </div>
              <div className="text-center text-slate-500">Signature</div>
              {settings.receipt.signature?.showCopyLabel && (
                <div className="text-center font-bold mt-2">
                  {settings.receipt.signature?.customerCopyLabel || 'CUSTOMER COPY'}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* === ENTERTAINMENT MODE === */}
      {previewMode === 'entertainment' && (
        <>
          {/* Sample entertainment ticket - Session Start */}
          <div className={`text-center mb-2 ${settings.entertainment?.highlightWarnings && !showImpactMode ? 'bg-black text-white px-2 py-1' : settings.entertainment?.highlightWarnings && showImpactMode ? 'text-red-600' : ''}`}>
            <div className="text-lg font-bold">
              {settings.entertainment?.sessionStartHeader || 'SESSION STARTED'}
            </div>
          </div>

          <Divider config={{ style: 'double' }} />

          {/* Guest Name */}
          {settings.entertainment?.showGuestName && (
            <div className={`
              text-center my-2
              ${getSizeClass(settings.entertainment?.nameSize || 'large')}
              ${settings.entertainment?.nameBold ? 'font-bold' : ''}
            `}>
              Johnson Party
            </div>
          )}

          {/* Party Size */}
          {settings.entertainment?.showPartySize && (
            <div className="text-xs text-center">
              Party of 4
            </div>
          )}

          <Divider config={{ style: 'dash' }} />

          {/* Table/Lane Assignment */}
          {settings.entertainment?.showTableAssignment && (
            <div className="text-sm font-bold text-center my-2">
              Pool Table 3
            </div>
          )}

          {/* Time Information */}
          <div className="text-xs space-y-1 my-3">
            {settings.entertainment?.showStartTime && (
              <TwoCol left="Start Time:" right="7:30 PM" />
            )}
            {settings.entertainment?.showEndTime && (
              <TwoCol left={settings.entertainment?.returnByLabel || 'Return By:'} right="8:30 PM" />
            )}
            {settings.entertainment?.showDuration && (
              <TwoCol left="Duration:" right="60 minutes" />
            )}
            {settings.entertainment?.showTimeRemaining && (
              <TwoCol left="Time Remaining:" right="58 min" />
            )}
          </div>

          {/* Price */}
          {settings.entertainment?.showPrice && (
            <>
              <Divider config={{ style: 'dash' }} />
              <div className="text-sm font-bold text-center my-2">
                $15.00 / hour
              </div>
            </>
          )}

          {/* Instructions */}
          {settings.entertainment?.showInstructions && (
            <>
              <Divider config={{ style: 'dash' }} />
              <div className="text-xs mt-2">
                <div className="font-bold">{settings.entertainment?.instructionsLabel || 'Instructions:'}</div>
                <div className="italic mt-1">Birthday party - please bring cake at 8pm</div>
              </div>
            </>
          )}

          {/* Sample Warning Ticket Preview */}
          <div className="mt-6 pt-4 border-t-2 border-dashed border-slate-300">
            <div className="text-[10px] text-slate-500 text-center mb-2">--- Warning Ticket Preview ---</div>
            <div className={`text-center ${settings.entertainment?.highlightWarnings && !showImpactMode ? 'bg-black text-white px-2 py-1' : settings.entertainment?.highlightWarnings && showImpactMode ? 'text-red-600 font-bold' : ''}`}>
              <div className="text-lg font-bold">
                {settings.entertainment?.warningHeader || '5 MIN WARNING'}
              </div>
            </div>
            {settings.entertainment?.showGuestName && (
              <div className={`text-center mt-1 ${settings.entertainment?.nameBold ? 'font-bold' : ''}`}>
                Johnson Party
              </div>
            )}
            {settings.entertainment?.showTableAssignment && (
              <div className="text-xs text-center">Pool Table 3</div>
            )}
            {settings.entertainment?.showTimeRemaining && (
              <div className="text-sm text-center font-bold mt-1">5 minutes left!</div>
            )}
          </div>
        </>
      )}

      {/* Footer Divider */}
      <Divider config={settings.dividers.beforeFooter} />

      {/* Duplicate Header */}
      {settings.footer.duplicateHeader && (
        <div className="text-center text-sm mt-1 pt-1 border-t border-dashed border-slate-300">
          <div className="font-bold">#124</div>
          <div>Table 4 • Sarah</div>
        </div>
      )}

      {/* FOOTER */}
      {settings.footer.enabled && (
        <div className="text-xs text-slate-500 text-center mt-2">
          {settings.footer.showTime && <div>{new Date().toLocaleString()}</div>}
          {settings.footer.showTicketNumber && <div>Ticket #00124</div>}
          {settings.footer.customText && <div>{settings.footer.customText}</div>}
          {settings.receipt.termsText && <div className="italic mt-1">{settings.receipt.termsText}</div>}
          {settings.receipt.promoText && <div className="mt-1">{settings.receipt.promoText}</div>}
        </div>
      )}
    </div>
  )
}
