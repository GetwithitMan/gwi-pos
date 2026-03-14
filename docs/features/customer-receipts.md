# Feature: Customer Receipts

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Customer Receipts → read every listed dependency doc.

## Summary
Customer receipts are generated in three formats: thermal print (ESC/POS), email (HTML), and SMS (plain text). Thermal receipts are built by `buildCustomerReceipt()` and sent to the location's receipt printer via TCP. Email receipts use a responsive HTML template sent via the email service. SMS receipts use a plain-text format under 1600 characters sent via Twilio. Digital receipt records (`DigitalReceipt`) are persisted with optional signature data for chargeback defense. Receipt data includes order items, modifiers, special notes, totals (subtotal, discount, tax, tip, surcharge), payment method details, and configurable tip/signature sections.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, ESC/POS builder, email/SMS sending, digital receipt storage | Full |
| `gwi-android-register` | Triggers print/email/SMS receipt after payment | Partial |
| `gwi-pax-a6650` | Triggers print receipt after payment | Partial |
| `gwi-cfd` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Payment flow → receipt options (print/email/SMS) | Servers |
| Admin | `/settings/receipts` → receipt configuration | Managers |
| Android | Post-payment receipt actions | Servers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/escpos/customer-receipt.ts` | `buildCustomerReceipt()` — ESC/POS buffer builder for thermal receipts |
| `src/lib/escpos/commands.ts` | ESC/POS command constants, line builders, document assembly |
| `src/lib/printer-connection.ts` | `sendToPrinter()` — TCP socket send to printer, `testPrinterConnection()` |
| `src/lib/domain/payment/receipt-builder.ts` | `buildReceiptData()` — pure function that assembles receipt response from order/payment data |
| `src/types/print/print-template-settings.ts` | `PrintTemplateSettings` type — receipt section config (tip line, signature, suggested tips, promo text, terms) |
| `src/types/print/receipt-settings.ts` | `GlobalReceiptSettings` — location-level receipt configuration |
| `src/app/api/print/receipt/route.ts` | `POST` — print customer receipt to thermal printer |
| `src/app/api/orders/[id]/receipt/route.ts` | `GET` — fetch receipt data for an order (used by Android/web to display digital receipt) |
| `src/app/api/receipts/route.ts` | `POST/GET` — create and search `DigitalReceipt` records |
| `src/app/api/receipts/email/route.ts` | `POST` — send email receipt with HTML template |
| `src/app/api/receipts/sms/route.ts` | `POST` — send SMS receipt via Twilio |
| `src/app/(admin)/settings/receipts/page.tsx` | Admin receipt settings UI |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/print/receipt` | Employee PIN | Print customer receipt to thermal printer |
| `GET` | `/api/orders/[id]/receipt` | Employee PIN | Fetch receipt data for an order (JSON) |
| `POST` | `/api/receipts` | Employee PIN | Create a `DigitalReceipt` record (after payment) |
| `GET` | `/api/receipts` | Employee PIN | Search digital receipts (by locationId, orderId, cardLast4, date range) |
| `POST` | `/api/receipts/email` | Employee PIN | Send email receipt for an order |
| `POST` | `/api/receipts/sms` | Employee PIN | Send SMS receipt for an order |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| None | — | Receipts are request-response, not socket-driven |

---

## Data Model

### DigitalReceipt
```
id              String    @id
locationId      String
orderId         String    @unique
paymentId       String
receiptData     Json                  // Full receipt content (items, amounts, taxes)
signatureData   String?               // Base64 PNG from reader or POS screen
signatureSource String?               // "reader" | "pos_screen"
archivedAt      DateTime?             // When moved to cloud archive
createdAt       DateTime
```

### CustomerReceiptData (runtime type, not persisted)
```
order: {
  orderNumber, displayNumber, orderType, tabName, tableName,
  guestCount, employeeName, locationName, locationAddress,
  locationPhone, createdAt, paidAt
}
items: [{
  name, quantity, price,
  modifiers: [{ name, price }],
  specialNotes
}]
payments: [{
  method, amount, tipAmount, totalAmount,
  cardBrand, cardLast4, changeGiven
}]
totals: {
  subtotal, discount, tax, tipTotal, total,
  surchargeAmount, surchargePercent, surchargeDisclosure,
  tipExemptAmount
}
```

---

## Business Logic

### Thermal Print Receipt Flow
1. Client calls `POST /api/print/receipt` with `{ orderId, printerId? }`
2. Route loads order with employee, location, table, items (with modifiers), and completed payments
3. Resolves receipt printer: specified printer, default receipt printer, or first active receipt printer
4. Parses location settings for dual pricing / surcharge
5. Builds `CustomerReceiptData` with correct pricing (card vs cash prices based on payment method)
6. Calls `buildCustomerReceipt()` to generate ESC/POS buffer
7. Sends buffer to printer via TCP (`sendToPrinter()`)
8. Logs `PrintJob` record (fire-and-forget) for success or failure

### Receipt Sections (Thermal)
The thermal receipt contains these sections in order:
1. **Header** — location name (bold, double-height), address, phone
2. **Order info** — order number, order type, table, tab, server, date/time, guest count
3. **Items** — each item with quantity, price, modifiers (indented), special notes
4. **Totals** — subtotal, discount, CC surcharge (with percentage), tax, total (bold, double-height)
5. **Payments** — payment method with card brand/last4, tip amount, change given
6. **Suggested tips** — configurable percentages (default: 18%, 20%, 22%) calculated on pre-tax or post-tax total, with tip-exempt amount deducted from basis
7. **Tip/Total lines** — blank lines for customer to write tip and total
8. **Signature** — configurable line style (solid/dotted/x-line), copy labels ("CUSTOMER COPY")
9. **Surcharge disclosure** — legally required text when CC surcharge is applied
10. **Terms text** — configurable (default: "Gratuity is optional")
11. **Promo text** — configurable promotional message

### Email Receipt
- Full HTML template with responsive layout (max-width 480px)
- Includes: location header, order info, itemized items with modifiers, totals, payment details, footer
- Voided items excluded; comped items shown with strikethrough and "(COMP)" tag
- Subject line: "Receipt from {Location} - Order #{number}"
- Sent via `sendEmail()` from `src/lib/email-service.ts`

### SMS Receipt
- Plain text format, capped at 1600 characters (Twilio concatenated SMS limit)
- Includes: location name, order number, items (max 20), totals, payment methods
- Sent via `sendSMS()` from `src/lib/twilio.ts`
- Items truncated with "...and N more items" if over 20

### Digital Receipt Storage
- `POST /api/receipts` creates a `DigitalReceipt` record after payment
- Stores full `receiptData` JSON and optional `signatureData` (Base64 PNG)
- `signatureSource` tracks whether signature came from card reader or POS screen
- Unique constraint on `orderId` — one receipt per order
- Searchable by `cardLast4`, date range, `orderId` for chargeback defense

### Dual Pricing on Receipts
- When dual pricing is enabled and payment includes a card charge, item prices are recalculated using `calculateCardPrice()` with the cash discount percentage
- Receipt shows the card price (higher) rather than the stored cash price
- Surcharge disclosure text is included when the pricing program model is `surcharge`

### Printer Settings Integration
- Each `Printer` record has a `printSettings` JSON field conforming to `PrintTemplateSettings`
- Receipt-specific settings control: tip line visibility, suggested tip percentages, tip calculation basis (pre/post tax), signature settings, terms text, promo text
- Settings are merged with defaults via `mergePrintTemplateSettings()`

### Paper Width Support
- 80mm (48 chars) — standard thermal receipt
- 58mm (32 chars) — compact thermal receipt
- 40mm (20 chars) — narrow label

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Hardware | Uses receipt printer for thermal printing |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Payments | Receipt generated after payment; dual pricing affects displayed prices |
| Orders | Receipt data sourced from order items, modifiers, totals |
| Settings | Tip line, signature, promo text, surcharge disclosure configured in location settings |
| Tips | Suggested tip percentages and tip-exempt items affect tip section |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does this change affect how receipt data is built from payment records?
- [ ] **Dual Pricing** — are card/cash prices correctly reflected?
- [ ] **Surcharge** — is disclosure text included when surcharge is active?
- [ ] **PrintTemplateSettings** — are new settings merged with defaults correctly?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Print receipt | Employee PIN | Standard |
| Send email receipt | Employee PIN | Standard |
| Send SMS receipt | Employee PIN | Standard |
| Search digital receipts | Employee PIN | Standard |

---

## Known Constraints & Limits
- SMS receipts truncated to 1600 characters (Twilio concatenated SMS limit)
- SMS shows max 20 items before truncating
- `DigitalReceipt.orderId` has unique constraint — one receipt record per order
- Twilio must be configured (`isTwilioConfigured()`) for SMS to work
- Email service must be configured for email receipts
- Thermal print is NOT fire-and-forget — caller waits for print result
- PrintJob records are logged fire-and-forget (success or failure)
- Tip suggestion basis can be pre-tax or post-tax, configurable per printer

---

## Android-Specific Notes
- Android triggers receipt print via `POST /api/print/receipt` after payment
- Receipt data fetched via `GET /api/orders/[id]/receipt` for on-screen display
- Email/SMS receipt sending available from post-payment screen

---

## Related Docs
- **Print routing:** `docs/features/print-routing.md`
- **Hardware:** `docs/features/hardware.md`
- **Payments:** `docs/features/payments.md`
- **Settings:** `docs/features/settings.md`
- **Dual pricing spec:** `docs/skills/SPEC-31-DUAL-PRICING.md`

---

*Last updated: 2026-03-14*
