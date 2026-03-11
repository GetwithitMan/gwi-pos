# GWI POS — Cross-Feature Dependency Matrix

**USE THIS BEFORE EVERY BUILD.** Find your feature, read everything in its row before touching code.

This matrix answers: "If I change feature X, what else might break?"

---

## How to Read This Matrix

- **Depends On** — features this one calls, reads, or is constrained by. A change there may require changes here.
- **Depended On By** — features that call into or rely on this one. A change here may break those.
- **Shared Models** — Prisma models shared between features (schema changes affect all of these).
- **Shared Socket Events** — socket events consumed by multiple features (change payload = update all consumers).

---

## The Matrix

### Orders
| | |
|---|---|
| **Depends On** | Menu (item selection), Floor Plan (table assignment), KDS (send-to-kitchen), Tips (order ownership), Employees (server assignment), Settings (order types, tax), Offline Sync (queue mutations) |
| **Depended On By** | Payments (payment on order), Tips (tip basis), Reports (sales data), Inventory (deductions on pay), Entertainment (session lifecycle), Discounts (applied to order), KDS (receives tickets), Error Reporting (critical path) |
| **Shared Models** | `Order`, `OrderItem`, `OrderSnapshot`, `OrderEvent`, `OrderItemSnapshot`, `OrderItemModifier` |
| **Shared Socket Events** | `order:created`, `order:updated`, `order:closed`, `item:added`, `item:removed`, `order:sent`, `order:editing`, `order:editing-released` |
| **Critical Rules** | Every mutation MUST call `emitOrderEvent()`. NEVER write to `db.order` without events. Read from `OrderSnapshot` not `Order`. |

---

### Payments
| | |
|---|---|
| **Depends On** | Orders (payment targets an order), Tips (postToTipLedger after payment), Tabs (pre-auth / capture flow), Hardware (card reader, receipt printer), Settings (tax, dual pricing, rounding), Roles (payment permissions), Offline Sync (payment queue) |
| **Depended On By** | Tips (ledger credit on payment), Inventory (deductions triggered at pay), Reports (payment facts), Tabs (capture on tab close), Discounts (discount reduces payment total), CFD (tip screen, approval display) |
| **Shared Models** | `Payment`, `PaymentIntent`, `OrderCard`, `WalkoutRetry`, `DigitalReceipt` |
| **Shared Socket Events** | `payment:applied`, `payment:voided`, `cfd:payment-started`, `cfd:tip-prompt`, `cfd:approved`, `cfd:declined` |
| **Critical Rules** | Datacap ONLY. Money first, reports second. All payment code in `src/lib/datacap/`. Fire-and-forget print. |

---

### Tips & Tip Banking
| | |
|---|---|
| **Depends On** | Payments (tip credited from payment), Orders (order ownership for co-owned tables), Employees (who earns tips), Shifts (payout at shift close, clock-out guard), Settings (TipBankSettings), Roles (adjustment permissions) |
| **Depended On By** | Reports (tip share, payroll export), Shifts (pending tips block close), Employees (tip earnings per employee) |
| **Shared Models** | `TipLedger`, `TipLedgerEntry`, `TipTransaction`, `TipGroup`, `TipGroupMembership`, `TipGroupSegment`, `TipAdjustment`, `CashTipDeclaration`, `TipBankSettings` |
| **Shared Socket Events** | `tip-group:created`, `tip-group:member-joined`, `tip-group:member-left`, `tip-group:closed` |
| **Critical Rules** | TipLedgerEntry is immutable — NEVER update/delete entries. Recalculate by adding delta entries. All tip reports use business day boundaries. Clock-out blocked if last member of active group (409). |

---

### Discounts & Coupons
| | |
|---|---|
| **Depends On** | Orders (discount applied to order/items), Roles (permission required to apply discount), Menu (item eligibility), Settings (discount configuration) |
| **Depended On By** | Payments (discounted total affects payment amount), Reports (discount reporting, void/discount audit), Tips (discount affects tip basis amount) |
| **Shared Models** | `Discount`, `DiscountRule`, `AppliedDiscount`, `OrderItem.discountAmountCents` |
| **Shared Socket Events** | `order:updated` (discount change triggers order update) |
| **Critical Rules** | Manager override required for discounts above threshold. Pre-check discount eligibility before applying. Discount does NOT affect tip calculation basis unless configured. |

---

### Roles & Permissions
| | |
|---|---|
| **Depends On** | Employees (role assigned to employee), Settings (role configuration) |
| **Depended On By** | **EVERY FEATURE** — permissions gate every sensitive action across the entire system |
| **Shared Models** | `Role`, `RolePermission`, `Employee.roleId` |
| **Shared Socket Events** | None directly — permission changes take effect on next API call |
| **Critical Rules** | Use `requirePermission()` ALWAYS — never `{ soft: true }`. 85 explicit permission keys in permission registry. CRITICAL permissions require confirm dialog. HIGH permissions show warning banner. Never add a new sensitive action without a permission key. |

---

### Menu Management
| | |
|---|---|
| **Depends On** | Settings (category types, feature flags), Inventory (ingredient linking) |
| **Depended On By** | Orders (item selection, pricing), Modifiers (modifier groups attach to items), KDS (per-modifier print routing), Liquor (liquor items are menu items), Combo Meals (combo components are menu items), Pizza Builder (pizza items are menu items), Entertainment (entertainment items are menu items) |
| **Shared Models** | `Category`, `MenuItem`, `ModifierGroup`, `Modifier`, `PricingOption` |
| **Shared Socket Events** | `menu:updated`, `categories:updated`, `modifiers:updated` |
| **Critical Rules** | `categoryType` determines routing: food/drinks/liquor/entertainment/combos/retail. Pour sizes on `MenuItem.pourSizes`. Linked items via `Modifier.linkedMenuItemId` for spirit upgrades. |

---

### Modifiers
| | |
|---|---|
| **Depends On** | Menu (modifier groups attach to menu items), Inventory (modifier ingredients) |
| **Depended On By** | Orders (modifier selection on order items), KDS (modifier display depth), Liquor (pour size + spirit tier modifiers), Pizza Builder (topping modifiers) |
| **Shared Models** | `ModifierGroup`, `Modifier`, `OrderItemModifier`, `Modifier.linkedMenuItemId` |
| **Shared Socket Events** | `modifiers:updated` |
| **Critical Rules** | `allowStacking: true` enables double-tap for 2x quantity. `universal` modifiers apply to all item types. Per-modifier print routing configured in Hardware. |

---

### Inventory
| | |
|---|---|
| **Depends On** | Menu (ingredient linked to modifier/item), Settings (units of measure) |
| **Depended On By** | Orders (auto-deduction on payment via `processInventoryDeductions()`), Reports (PMIX food cost, theoretical vs actual variance), Liquor (liquor-specific deductions) |
| **Shared Models** | `Ingredient`, `PrepItem`, `RecipeComponent`, `StockCount`, `StockAlert` |
| **Shared Socket Events** | None — deductions are fire-and-forget post-payment |
| **Critical Rules** | Deductions are fire-and-forget — NEVER block payment on inventory. Void reverses deductions. Dual pricing impacts cost per unit calculations. |

---

### Tabs (Bar Tabs)
| | |
|---|---|
| **Depends On** | Orders (tab is an open-ended order), Payments (pre-auth + capture via Datacap), Employees (tab ownership) |
| **Depended On By** | Reports (open tab aging), Payments (capture on close) |
| **Shared Models** | `Order.isTab`, `Order.tabName`, `Order.tabNickname`, `OrderCard`, `WalkoutRetry` |
| **Shared Socket Events** | `tab:opened`, `tab:closed`, `tab:updated`, `tab:items-updated` |
| **Critical Rules** | `tabName` = cardholder name (read-only from card). `tabNickname` = bartender-assigned display name (editable). Incremental auth at configurable thresholds. |

---

### KDS (Kitchen Display System)
| | |
|---|---|
| **Depends On** | Orders (receives tickets from send-to-kitchen), Hardware (device pairing, printer backup), Menu (modifier depth display), Roles (station assignment) |
| **Depended On By** | Orders (bump status syncs back to order), Entertainment (entertainment KDS dashboard) |
| **Shared Models** | `KdsScreen`, `KdsScreenItem`, `HardwareDevice` |
| **Shared Socket Events** | `kds:ticket-updated`, `kds:item-bumped`, `kds:order-bumped`, `item:bumped`, `session:completed` |
| **Critical Rules** | Tag-based routing (items route to stations by tag). Print API is fire-and-forget. KDS events are now event-sourced (via `emitKdsEvent()`). |

---

### Shifts & Payroll
| | |
|---|---|
| **Depends On** | Employees (shift belongs to employee), Tips (pending tips block shift close), Time Clock (clock-in/out creates shift entries) |
| **Depended On By** | Reports (labor reports, shift reports), Tips (payout at shift close), Employees (shift history) |
| **Shared Models** | `Shift`, `ShiftBreak`, `ShiftEntry`, `PayrollPeriod` |
| **Shared Socket Events** | `shift:closed`, `shift:opened` |
| **Critical Rules** | Shift close MUST check for pending tips (block if any $0-tip closed card payments exist). Manager override required to force-close a shift with open orders. |

---

### Employees
| | |
|---|---|
| **Depends On** | Roles (role assigned to employee), Settings (max employees per license tier) |
| **Depended On By** | Tips (earnings tracking), Shifts (shift belongs to employee), Time Clock (clock-in/out), Reports (labor), Orders (server assignment), Floor Plan (section assignment) |
| **Shared Models** | `Employee`, `EmployeeRole`, `EmployeeClock`, `EmployeeBreak` |
| **Shared Socket Events** | `employees:changed` (plural — verified actual event name) |
| **Critical Rules** | Clock-out blocked if last member of active tip group. PIN is auth credential — never log or expose. |

---

### Time Clock
| | |
|---|---|
| **Depends On** | Employees (clock event belongs to employee), Tips (group template assigned on clock-in) |
| **Depended On By** | Shifts (shift generated from clock events), Tips (clock-out blocked if last tip group member) |
| **Shared Models** | `TimeClock`, `TimeClockEntry`, `EmployeeClock` |
| **Shared Socket Events** | `employee:clocked-in`, `employee:clocked-out` |
| **Critical Rules** | Clock-out during active payment is blocked. Clock-out during pending tip payout is blocked. |

---

### Floor Plan
| | |
|---|---|
| **Depends On** | Orders (tables have orders), Entertainment (entertainment items on floor plan), Employees (section ownership) |
| **Depended On By** | Orders (table assignment, inline ordering), Entertainment (visual placement) |
| **Shared Models** | `Table`, `TableSection`, `Seat`, `FloorPlanItem`, `VirtualGroup` |
| **Shared Socket Events** | `floor:updated`, `table:updated`, `seat:updated` |
| **Critical Rules** | Virtual group combining is denormalized — seats track their parent table. Floor plan has 30s polling fallback if socket disconnects. |

---

### Hardware
| | |
|---|---|
| **Depends On** | Settings (hardware configuration, `HardwareLimitsSettings`), KDS (device pairing), Mission Control (subscription tier → device count limits), Cellular Auth (session tracking for venue-side device management) |
| **Depended On By** | Orders (receipt printing), Payments (card reader, receipt), KDS (printer routing), Menu (per-modifier print routing), CFD (display device), Terminal management (device count enforcement at pairing), Printer management (device count enforcement at creation), Cellular pairing (device count enforcement at exchange) |
| **Shared Models** | `HardwareDevice`, `HardwareCommand`, `PrinterConfig`, `KdsScreen` |
| **Shared Socket Events** | `hardware:command`, `printer:status`, `terminal:status_changed`, `cellular:device-revoked` |
| **Critical Rules** | Print calls MUST be fire-and-forget — 7+ second TCP timeout if printer offline. NEVER await print before clearing UI. VP3300/VP3350 is the only supported card reader. Device count limits enforced at 4 creation/pairing points — returns 403 `DEVICE_LIMIT_EXCEEDED` when tier cap reached. Transaction/behavior limits per device type in `HardwareLimitsSettings`. |

---

### CFD (Customer-Facing Display)
| | |
|---|---|
| **Depends On** | Payments (payment flow drives CFD states), Orders (order summary display), Hardware (display device pairing) |
| **Depended On By** | Payments (CFD tip selection feeds back to payment) |
| **Shared Models** | `Terminal.cfdTerminalId`, `CfdSettings` |
| **Shared Socket Events** | `cfd:show-order`, `cfd:payment-started`, `cfd:tip-prompt`, `cfd:tip-selected`, `cfd:processing`, `cfd:approved`, `cfd:declined`, `cfd:idle`, `cfd:signature-request`, `cfd:receipt-sent`, `cfd:receipt-choice` |
| **Critical Rules** | CFD is stateless — all state driven by socket events from POS. 8-state machine. Paired via bootstrap token. CFD tip selection is race-free with 60s timeout. |

---

### Reports
| | |
|---|---|
| **Depends On** | Orders (sales data from `OrderSnapshot`), Payments (payment facts), Tips (tip share reports), Employees (labor data), Inventory (food cost, variance), Settings (business day boundaries) |
| **Depended On By** | Backoffice (aggregate reports materialized from events) |
| **Shared Models** | `OrderSnapshot`, `OrderItemSnapshot`, `TipLedgerEntry`, `PayrollPeriod` |
| **Shared Socket Events** | None — reports are read-only queries |
| **Critical Rules** | ALL reports read from `OrderSnapshot` not legacy `Order` table. All reports use business day boundaries (not calendar midnight). Training orders filtered by default. |

---

### Settings
| | |
|---|---|
| **Depends On** | Location model (settings stored per-location) |
| **Depended On By** | **EVERY FEATURE** — every API route calls `getSettings()` or `withVenue()` to fetch location config |
| **Shared Models** | `Location.settings` (JSON), `TaxRule`, `OrderType`, `FeatureFlag` |
| **Shared Socket Events** | `settings:updated` |
| **Critical Rules** | Settings changes are immediate — no restart required. Dependent settings must show disabled state in UI when parent is off. |

---

### Entertainment
| | |
|---|---|
| **Depends On** | Orders (entertainment items added to orders), Menu (items with `categoryType: 'entertainment'`), Floor Plan (visual placement), KDS (entertainment KDS dashboard) |
| **Depended On By** | Payments (session charges on payment), Reports (entertainment revenue) |
| **Shared Models** | `EntertainmentSession`, `EntertainmentItem`, `TimedRental` |
| **Shared Socket Events** | `entertainment:status-updated`, `session:started`, `session:expired`, `waitlist:changed` |
| **Critical Rules** | Timer auto-starts on send-to-kitchen. Block-time vs per-minute billing configured per item. Entertainment TODO on Android: sheet not yet opened. |

---

### Customers
| | |
|---|---|
| **Depends On** | Settings (customer features enabled), Roles (customer read/write permissions) |
| **Depended On By** | Orders (customer assigned to order), Events (customer tickets), Payments (house accounts) |
| **Shared Models** | `Customer`, `CustomerNote`, `LoyaltyPoints` |
| **Shared Socket Events** | None |
| **Critical Rules** | Customer data is PII — handle with care. Loyalty points require LOYALTY_POINTS permission. |

---

### Liquor Management
| | |
|---|---|
| **Depends On** | Menu (liquor items = menu items with `categoryType: 'liquor'`), Inventory (bottle tracking, deductions) |
| **Depended On By** | Orders (pour size selection, spirit tier), Reports (liquor reports: pour cost %, bottle variance) |
| **Shared Models** | `MenuItem.pourSizes`, `Modifier.linkedMenuItemId` (spirit upgrades), `LiquorBottle` |
| **Shared Socket Events** | `menu:updated` |
| **Critical Rules** | Spirit tier upsells use `Modifier.linkedMenuItemId` to track upgrade pricing and inventory. Single-tier stacking only (no spirit stacking by design). |

---

### Combo Meals
| | |
|---|---|
| **Depends On** | Menu (combo components are menu items) |
| **Depended On By** | Orders (combo adds multiple items), Payments (combo pricing) |
| **Shared Models** | `ComboTemplate`, `ComboComponent`, `MenuItem.categoryType = 'combos'` |
| **Shared Socket Events** | `menu:updated` |
| **Critical Rules** | Combo price is composite — not sum of parts. Component substitutions track price delta. |

---

### Pizza Builder
| | |
|---|---|
| **Depends On** | Menu (pizza items are menu items), Modifiers (toppings are modifiers), Orders (pizza added to order) |
| **Depended On By** | Orders (pizza items with complex modifier tree) |
| **Shared Models** | `MenuItem` (with pizza-specific config), `ModifierGroup`, `Modifier` |
| **Shared Socket Events** | `menu:updated` |
| **Critical Rules** | Pizza builder is a specialized modifier UI — underlying data model is standard MenuItem + ModifierGroups. |

---

### Tax Rules
| | |
|---|---|
| **Depends On** | Settings (tax configuration) |
| **Depended On By** | Payments (tax applied at checkout), Orders (tax calculated on subtotal), Reports (tax collected reporting) |
| **Shared Models** | `TaxRule`, `TaxRate`, `MenuItem.taxRuleId` |
| **Shared Socket Events** | None |
| **Critical Rules** | Tax-inclusive pricing supported (price includes tax). Multiple rates per location. Tax-exempt items configured per menu item. |

---

### Events & Tickets
| | |
|---|---|
| **Depends On** | Orders (tickets added like order items), Customers (ticket buyer), Payments (ticket payment) |
| **Depended On By** | Reports (event revenue) |
| **Shared Models** | `Event`, `Ticket`, `TicketScan` |
| **Shared Socket Events** | None |
| **Critical Rules** | Ticket check-in must be idempotent (duplicate scan = no double-entry). Refunds follow payment void flow. |

---

### Cash Drawers
| | |
|---|---|
| **Depends On** | Payments (cash payments open drawer), Shifts (drawer reconciliation at close), Hardware (drawer connected to printer) |
| **Depended On By** | Reports (cash drawer audit), Shifts (end-of-day reconciliation) |
| **Shared Models** | `CashDrawer`, `DrawerEvent` |
| **Shared Socket Events** | None |
| **Critical Rules** | Drawer opens automatically on cash payment — fire-and-forget via printer ESC/POS command. |

---

### Offline Sync
| | |
|---|---|
| **Depends On** | All features (every mutation must handle offline gracefully) |
| **Depended On By** | All features |
| **Shared Models** | `OutboxEvent`, `SyncMeta`, `DeadLetterEvent` |
| **Shared Socket Events** | Connectivity events: `terminal:status_changed` |
| **Critical Rules** | NEVER use client timestamps — DB-generated NOW() only. All mutations enqueue to outbox when offline. Outbox retries with exponential backoff. Dead-letter queue for failed events. |

---

### Error Reporting
| | |
|---|---|
| **Depends On** | All features (observability layer) |
| **Depended On By** | None (leaf node) |
| **Shared Models** | `ErrorLog`, `SystemHealth` |
| **Shared Socket Events** | None |
| **Critical Rules** | Payment failures = CRITICAL severity. Order mutations = HIGH severity. Pivot-ready for Sentry/Datadog. |

---

### Mission Control
| | |
|---|---|
| **Depends On** | Settings (pushed from cloud), Employees (license limits), Payments (PayFac credentials) |
| **Depended On By** | None from gwi-pos perspective (cloud layer is above) |
| **Shared Models** | `Terminal`, `Location`, HMAC fleet API |
| **Shared Socket Events** | Heartbeat: `terminal:status_changed` |
| **Critical Rules** | HMAC-SHA256 auth for all fleet API calls. AES-256-GCM for sensitive config. NEVER store payment keys in plain text. |

---

### Store-and-Forward (SAF)
| | |
|---|---|
| **Depends On** | Payments, Hardware, Offline Sync |
| **Depended On By** | Payments |
| **Shared Models** | `Payment` (`safStatus`, `safUploadedAt`, `safError`, `isOfflineCapture`) |
| **Shared Socket Events** | None — UI polls on demand |
| **Critical Rules** | SAF only applies to card-present Datacap transactions. Must forward all queued transactions before end-of-day batch settlement. NEVER double-charge: idempotencyKey and offlineIntentId enforce deduplication. forceOffline flag is for testing/certification only — never use in production flows. |

---

### Refund & Void
| | |
|---|---|
| **Depends On** | Payments, Orders, Roles & Permissions, Hardware |
| **Depended On By** | Payments, Reports |
| **Shared Models** | `Payment` (`status`, `voidedAt`, `refundedAt`, `settledAt`), `RefundLog`, `OrderItem` |
| **Shared Socket Events** | `payment:processed` — after void or refund is persisted; `order:totals_updated` — after void changes order balance |
| **Critical Rules** | Pre-settlement = void (local DB only, no money moves). Post-settlement = refund (Datacap EMV return, money returns to customer). NEVER void a settled transaction. NEVER refund an unsettled one. manager.void_payments permission required for all paths. |

---

### Pricing Programs
| | |
|---|---|
| **Depends On** | Payments, Settings, Menu |
| **Depended On By** | Payments, Reports, Mission Control |
| **Shared Models** | `Settings` (`pricingProgram` JSON blob in `Location.settings`) |
| **Shared Socket Events** | None — client cache re-fetches on 5-minute TTL |
| **Critical Rules** | Menu prices ARE the cash price. Surcharge/dual pricing is calculated at payment time only. NEVER alter OrderItem prices retroactively. Surcharge capped at 3% (Visa/MC rules). Surcharge prohibited in CT, MA, PR. Merchant-absorbed models (flat_rate, interchange_plus, tiered) never show a surcharge line to customers. |

---

### Auto Discounts (Planned)
| | |
|---|---|
| **Depends On** | Discounts, Orders, Menu, Settings |
| **Depended On By** | Discounts |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only — do not implement without design session. |

---

### Upsell Prompts (Planned)
| | |
|---|---|
| **Depends On** | Menu, Orders, Reports |
| **Depended On By** | Orders |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Repeat Orders (Planned)
| | |
|---|---|
| **Depends On** | Orders, Menu |
| **Depended On By** | Orders |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Custom Menus (Planned)
| | |
|---|---|
| **Depends On** | Menu, Employees, Settings |
| **Depended On By** | Menu |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Commissioned Items (Planned)
| | |
|---|---|
| **Depends On** | Menu, Employees, Reports, Payments |
| **Depended On By** | Menu, Employees |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Paid In / Out (Planned)
| | |
|---|---|
| **Depends On** | Cash Drawers, Shifts, Roles & Permissions, Reports |
| **Depended On By** | Shifts, Reports |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Staff Training Mode (Planned)
| | |
|---|---|
| **Depends On** | Orders, Payments, Settings |
| **Depended On By** | Settings |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | NEVER allow training-mode transactions to touch real payment processors or ledgers. |

---

### Live Dashboard (Planned)
| | |
|---|---|
| **Depends On** | Reports, Orders, Payments, Employees |
| **Depended On By** | Reports |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only — read-only aggregation, never a mutation source. |

---

### Online Ordering
| | |
|---|---|
| **Depends On** | Menu, Orders, Payments (Datacap PayAPI), Settings (`onlineOrdering` feature flag) |
| **Depended On By** | Orders (online orders enter kitchen queue), Reports (online order revenue) |
| **Shared Models** | `Order` (`source: 'online'`), `OrderType` |
| **Shared Socket Events** | `order:created` (same as POS orders) |
| **Critical Rules** | Uses **Datacap PayAPI** — NOT a separate gateway (NOT Stripe/Square). Admin config at `/settings/online-ordering`. `online-order-worker.ts` handles async order processing — undocumented in feature docs. |

---

### QR Self-Ordering (Planned)
| | |
|---|---|
| **Depends On** | Menu, Orders, Payments, Floor Plan |
| **Depended On By** | Orders |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only — requires separate payment gateway (NOT Datacap). NOT compatible with current Datacap-only architecture without a design session. |

---

### Delivery Management (Planned)
| | |
|---|---|
| **Depends On** | Orders, Customers, Settings |
| **Depended On By** | Orders |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Reservations (Planned)
| | |
|---|---|
| **Depends On** | Customers, Floor Plan, Events & Tickets, Settings |
| **Depended On By** | Floor Plan, Customers |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Host Management (Planned)
| | |
|---|---|
| **Depends On** | Floor Plan, Employees, Reservations |
| **Depended On By** | Floor Plan |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Bottle Service
| | |
|---|---|
| **Depends On** | Tabs (bottle service runs as a tab), Payments (closing the service charges the tab), Floor Plan (VIP section placement), Menu (bottle menu items) |
| **Depended On By** | Tabs (bottle service is a tab variant) |
| **Shared Models** | `Order.isTab`, `Order.tabName` |
| **Shared Socket Events** | `tab:opened`, `tab:closed` |
| **Critical Rules** | Active — API exists at `src/app/api/bottle-service/`. Feature doc pending. |

---

### Multi-Location Management (Planned)
| | |
|---|---|
| **Depends On** | Settings, Menu, Employees, Reports |
| **Depended On By** | Settings, Mission Control |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only — requires mission-control integration design before implementation. |

---

### Invoicing & B2B (Planned)
| | |
|---|---|
| **Depends On** | Customers, Payments, Reports |
| **Depended On By** | Payments, Reports |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Hotel PMS Integration (Oracle OPERA Cloud) — Active
| | |
|---|---|
| **Depends On** | Payments (room_charge is a tender type in PaymentModal + pay route), Settings (HotelPmsSettings in LocationSettings), Orders (charge posted at order close) |
| **Depended On By** | Payments (adds room_charge to PaymentMethod enum and modal) |
| **Shared Models** | `Payment` (roomNumber, guestName, pmsReservationId, pmsTransactionId), `HotelPmsSettings` (in Location.settings), `PmsChargeAttempt` (crash-safe idempotency — PENDING→COMPLETED state machine) |
| **Shared Socket Events** | None — no socket events emitted for room charges |
| **Critical Rules** | Credentials stored in Location.settings (NOT env vars). `hotelPms` must remain in the settings PUT deep-merge list or credentials will be wiped on any settings save. No SAF support — room charges fail if OPERA is offline. No auto-reverse on void/refund. "Datacap only" processor rule does NOT apply to room_charge (it bypasses Datacap). Client sends `selectionId` to /pay — never raw OPERA IDs. Selection tokens expire after 10 minutes. `validatePmsBaseUrl()` must run on settings PUT to block SSRF. |

---

### Printer Settings (Planned)
| | |
|---|---|
| **Depends On** | Hardware, Orders, KDS |
| **Depended On By** | Hardware |
| **Shared Models** | TBD |
| **Shared Socket Events** | TBD |
| **Critical Rules** | Planned only. |

---

### Remote Void Approval
| | |
|---|---|
| **Depends On** | Refund/Void (initiates void request), Roles (manager permission required), Payments (void targets a payment) |
| **Depended On By** | Refund/Void (approval unblocks void execution), Discounts (comp/void may use remote approval for large amounts) |
| **Shared Models** | `VoidApprovalRequest`, `VoidApprovalCode` |
| **Shared Socket Events** | `void:approval-update` (targeted to requestingTerminalId) |
| **Critical Rules** | 32-hex approval token (30-min expiry). 6-digit code (5-min expiry). Single-use enforcement. 5 SMS/15-min rate limit. HTTP 409 on duplicate pending request. Twilio graceful degradation. |

---

### Chargebacks
| | |
|---|---|
| **Depends On** | Payments (chargeback filed against a payment), Orders (context for the transaction), Tips (TipDebt linked if tip involved) |
| **Depended On By** | Payments (needsReconciliation flag set on match), Reports (chargeback total in financial summary) |
| **Shared Models** | `ChargebackCase`, `Payment.needsReconciliation` |
| **Shared Socket Events** | None (no real-time events) |
| **Critical Rules** | Auto-match algorithm: 30-day window, exact card + amount, single-match wins. `db.$transaction` wraps match + flag update. No status-update endpoint — cases cannot be closed via API. 100-record list cap. |

---

### Gift Cards
| | |
|---|---|
| **Depends On** | Payments (redemption creates payment record), Orders (gift card applied to order) |
| **Depended On By** | Payments (gift card is a tender type), Reports (gift card sales and redemptions) |
| **Shared Models** | `GiftCard`, `GiftCardTransaction` |
| **Shared Socket Events** | None directly (payment:applied fired by payment layer) |
| **Critical Rules** | Redemption uses `db.$transaction` — atomic balance check + decrement. OFFLINE-INCOMPATIBLE — no SAF path. Partial redemption supported (split tender). Error codes: GC_NOT_FOUND, GC_STATUS, GC_EXPIRED, GC_INSUFFICIENT. |

---

### House Accounts
| | |
|---|---|
| **Depends On** | Customers (account belongs to customer), Payments (house account is a tender type), Reports (aging report, balance tracking) |
| **Depended On By** | Payments (house account charge creates a transaction), Reports (A/R aging report) |
| **Shared Models** | `HouseAccount`, `HouseAccountTransaction` |
| **Shared Socket Events** | None |
| **Critical Rules** | Atomic `db.$transaction` for balance decrement. creditLimit=0 means unlimited. Delete blocked if outstanding balance. Aging buckets: current / 30d / 60d / 90d / 90d+. Transaction types: charge / payment / adjustment / credit. |

---

### Coursing
| | |
|---|---|
| **Depends On** | Orders (coursing state per order), KDS (courses control what kitchen sees), Menu (items assigned to courses) |
| **Depended On By** | KDS (only shows current-course items when coursing enabled), Orders (order cannot close until all courses fired) |
| **Shared Models** | `CourseConfig`, `OrderCourseMode` enum |
| **Shared Socket Events** | `order:event` (COURSE_FIRED, COURSE_ADVANCED events) |
| **Critical Rules** | Max 5 courses. `force: true` allows out-of-order fire. Auto-mode timer is CLIENT-driven (server does not enforce). KDS only shows current-course items — crucial for kitchen flow. |

---

### Scheduling
| | |
|---|---|
| **Depends On** | Employees (schedules are for employees), Shifts (scheduled shifts relate to actual shifts), Time Clock (scheduled vs actual hours) |
| **Depended On By** | Shifts (compare scheduled vs actual), Reports (labor scheduling analysis) |
| **Shared Models** | `Schedule`, `ScheduledShift`, `AvailabilityEntry`, `ShiftSwapRequest` |
| **Shared Socket Events** | None (no real-time broadcast on schedule changes) |
| **Critical Rules** | One schedule per week per location. Scheduling ≠ Time Clock ≠ Shift — three distinct systems. ScheduledShift statuses: pending / confirmed / declined / swapped / cancelled. Swap request requires manager approval. |

---

### Security Settings
| | |
|---|---|
| **Depends On** | Settings (sub-system of settings), Employees (idle lock, PIN policy), Roles (permission gates) |
| **Depended On By** | Employees (idleLockMinutes consumed via bootstrap), Payments (void2FAThreshold), Remote Void Approval (require2FAForLargeVoids) |
| **Shared Models** | `SecuritySettings` |
| **Shared Socket Events** | None |
| **Critical Rules** | 3 hardcoded policies: 3-attempt lockout/15-min freeze, 5-min OTP, 30-min approval link. IDLE_LOCK_OPTIONS = [0,1,3,5,10,15,30] (fixed). buddyPunchDetection is settings flag only — enforcement is TODO. Android reads idleLockMinutes via bootstrap. |

---

### Audit Trail
| | |
|---|---|
| **Depends On** | Orders (audits order mutations), Payments (audits payment events), Employees (audits employee actions), Settings (audit configuration) |
| **Depended On By** | Reports (compliance reporting, activity export) |
| **Shared Models** | `AuditLog` (local NUC Prisma) + `gwi_access_logs` (Neon cloud raw SQL — no Prisma migration) |
| **Shared Socket Events** | None |
| **Critical Rules** | TWO separate systems — local `AuditLog` (Prisma, NUC) and cloud `gwi_access_logs` (raw SQL, Neon, no migration). entityType filter currently hardcoded to `['order','payment']` — employee/menu entries exist but are not surfaced. CSV export is current-page only. 31-day max query window. Phone numbers masked at write time. |

---

### Walkout Retry
| | |
|---|---|
| **Depends On** | Payments (retry targets the original payment), Tabs (walkout originates from an unclosed tab), Datacap (retry path uses card-present re-charge), Orders (`Order.isWalkout` flag set on walkout) |
| **Depended On By** | Payments (successful retry creates a new Payment record), Reports (walkout count in financial summary) |
| **Shared Models** | `WalkoutRetry`, `Payment`, `Order.isWalkout` |
| **Shared Socket Events** | None |
| **Critical Rules** | **No scheduler in codebase** — route comment says "used by cron" but none exists; all retries require manual API trigger. **No write-off API** — `writtenOffAt`/`writtenOffBy` fields exist in schema but nothing ever sets them. `walkoutAutoDetectMinutes` setting is wired to nothing. Double-charge guard: `updateMany` with `status = 'pending'` filter (BUG #459 fix). Two creation paths: manual POST `/api/orders/[id]/mark-walkout` AND auto-flag in `close-tab/route.ts` (sets `isWalkout=true` only — does NOT create a WalkoutRetry record). |

---

### Mobile Tab Management
| | |
|---|---|
| **Depends On** | Tabs (manages open tabs remotely), Employees (mobile login = employee PIN auth, bcrypt), Orders (tab detail renders order items), Payments (tab balance is calculated from payments) |
| **Depended On By** | Tabs (mobile close/transfer requests relay to POS terminal) |
| **Shared Models** | `Order.isTab`, `Order.tabName`, `Order.tabNickname`, `Employee.pin` |
| **Shared Socket Events** | `tab:close-request`, `tab:transfer-request`, `tab:alert-manager` (emitted by `MobileTabActions.tsx` — **zero server handlers in `socket-server.ts`; silently dropped**), `tab:items-updated` (dead stub — no emitter, no consumer) |
| **Critical Rules** | **Socket relay is non-functional** — mobile emits 3 events but `socket-server.ts` has ZERO handlers; events are silently dropped. `/mobile` routes require bcrypt PIN auth with 8h httpOnly cookie scoped to `/mobile` — separate from POS session. 20s polling fallback for tab list. `visibilitychange` triggers instant refresh on tab-back. |

---

### Notifications & Alerts
| | |
|---|---|
| **Depends On** | Settings (`alertPhoneNumbers`, `alertEmail` from Location settings), Error Reporting (system errors trigger CRITICAL alerts) |
| **Depended On By** | Error Reporting (errors route through alert service), EOD Reset (daily summary delivered via email), Shifts (shift close can trigger email report) |
| **Shared Models** | None — stateless service; no DB table |
| **Shared Socket Events** | None |
| **Critical Rules** | Three channels: Resend (email), Twilio (SMS CRITICAL-only with secondary guard), Slack webhook. **Slack fully implemented but `SLACK_WEBHOOK_URL` not configured** — HIGH alerts reach email only in practice. Dev-mode bypass silently returns success without calling Resend. Severity routing: CRITICAL → SMS+Slack+Email (5-min throttle); HIGH → Slack+Email (15-min); MEDIUM → Email (60-min); LOW → dashboard only. |

---

### EOD Reset
| | |
|---|---|
| **Depends On** | Orders (cancels abandoned draft orders), Settings (`MGR_CLOSE_DAY` permission, `eod.batchCloseTime`), Shifts (EOD ties to business day boundary), Payments (Datacap batch close), Walkout Retry (walkout detection at batch close) |
| **Depended On By** | Reports (business day boundary reset), Floor Plan (`eod:reset-complete` socket triggers FloorPlanHome summary toast), Live Dashboard ("Close Day" button), Settings/Payments (read-only batch time visual), Mission Control (BatchCloseCard config) |
| **Shared Models** | `Order` (draft cancellation), `BusinessDay`, `AuditLog` (eod_auto_batch_close, eod_batch_close_success/failed) |
| **Shared Socket Events** | `eod:reset-complete` (manual), `eod:auto-batch-complete` (automated cron) |
| **Critical Rules** | **Three routes**: `POST /api/eod/reset` (manual, requires `MGR_CLOSE_DAY`), `GET /api/cron/eod-batch-close` (automated, cron secret auth, runs every 5 min), `POST /api/orders/eod-cleanup` (no permission check). Dashboard "Close Day" button triggers manual reset with dry-run preview. Automated cron checks batch window (15 min after configured `batchCloseTime`), idempotent via AuditLog. Batch close time configured from MC `BatchCloseCard`, defaults to 04:00. |

---

### Pay-at-Table (PAT)
| | |
|---|---|
| **Depends On** | Payments (PAT initiates a Datacap sale), Tabs (payment targets an open tab), Hardware (iPad-mounted Datacap reader on-table) |
| **Depended On By** | Payments (alternative payment initiation path) |
| **Shared Models** | `Payment`, `Order.isTab` — no dedicated PAT model |
| **Shared Socket Events** | `pat:pay-request`, `pat:pay-result` (functional); `pat:split-request`, `pat:split-result` (**dead code** — never emitted or consumed) |
| **Critical Rules** | `/pay-at-table` route is **PUBLIC** (listed in `cloud-auth.ts` public paths) — access control relies entirely on valid query params, no session auth. `locationId = ''` in Datacap sale call — relies on Datacap to resolve from reader ID, may silently fail. No terminal-side "payment in progress" UI when `pat:pay-request` arrives — POS operator is unaware. `pat:split-*` is dead code. Status: partial — real components exist (`src/components/pay-at-table/`) but flow has known gaps. |

---

## Frequently Co-Modified Clusters

When one of these changes, the entire cluster often needs review:

| Cluster | Features | Why Co-Modified |
|---------|----------|-----------------|
| **Transaction Core** | Orders + Payments + Tips | Every sale touches all three |
| **Menu & Products** | Menu + Modifiers + Inventory | Item changes affect deductions and display |
| **Service Floor** | Floor Plan + Entertainment + Tables | Physical space and sessions interlock |
| **Staff & Compensation** | Employees + Time Clock + Tips | Clock-out, tip allocation, shift payroll |
| **Output Devices** | Hardware + KDS + Printers + Device Limits | Routing, dispatch, and device count caps shared |
| **Access Control** | Roles + Permissions + Employees | Permission changes need role + employee sync |
| **Payment Integrity** | Payments + Store-and-Forward + Refund/Void + Pricing Programs + Remote Void Approval + Chargebacks | All affect how money is collected, voided, and reconciled |
| **Guest Tenders** | Payments + Gift Cards + House Accounts + Tabs + Pay-at-Table + Memberships | All are non-cash or alternative tender paths — each needs payment permission check |
| **Staff Lifecycle** | Employees + Time Clock + Shifts + Scheduling | Schedule → clock-in → shift → close → tips all connected |
| **Venue Operations** | Floor Plan + Coursing + KDS + Entertainment | Physical space, kitchen flow, and order routing interlock |
| **Promotions** | Discounts + Coupons + Happy Hour + Auto Discounts | All affect order totals — test together when changing pricing logic |
| **Security & Compliance** | Security Settings + Roles + Audit Trail + Remote Void Approval | Permission model, access log, and void approval chain |
| **System Operations** | Notifications + EOD Reset + Error Reporting + Audit Trail | Alert routing, day-close, error capture, and compliance log all share service layer |
| **Debt & Recovery** | Walkout Retry + Chargebacks + House Accounts | All represent money owed with incomplete close paths — no scheduler, no write-off UI built |

---

---

### 7shifts Integration
| | |
|---|---|
| **Depends On** | Employees (sevenShiftsUserId mapping), Scheduling (ScheduledShift upserts), Time Clock (TimeClockEntry push), Settings (SevenShiftsSettings credentials/token), Shifts (business date for sales push), Reports (net sales aggregation) |
| **Depended On By** | Scheduling (schedule pull populates ScheduledShift), Time Clock (punch push writes sevenShiftsTimePunchId), Reports (sales push aggregates closed orders) |
| **Shared Models** | `Employee` (sevenShiftsUserId/RoleId/DeptId/LocationId), `TimeClockEntry` (sevenShiftsTimePunchId/PushedAt/PushError), `ScheduledShift` (sevenShiftsShiftId), `SevenShiftsDailySalesPush`, `Location.settings.sevenShifts` |
| **Shared Socket Events** | None — 7shifts sync is fire-and-forget; no real-time socket events emitted |
| **Critical Rules** | Token endpoint is app.7shifts.com (NOT api.7shifts.com). Every API call requires both Authorization + x-company-guid headers. Webhook HMAC key = `{timestamp}#{companyGuid}`. Single-venue fallback only when exactly one location has 7shifts enabled. Fire-and-forget is safe on NUC (persistent process) — not safe on serverless. |

---

---

### Memberships
| | |
|---|---|
| **Depends On** | Customers (customer record for enrollment), SavedCards (card-on-file for recurring billing), Payments/Datacap (PayAPI card-not-present charges), Settings (membership config: enabled, gracePeriodDays, retryScheduleDays), Reports (membership analytics) |
| **Depended On By** | Customers (customer detail page shows membership status) |
| **Shared Models** | `Membership`, `MembershipPlan`, `MembershipCharge`, `MembershipEvent`, `SavedCard`, `Customer` |
| **Shared Socket Events** | `membership:updated` (actions: enrolled, charged, declined, paused, resumed, cancelled, card_updated, expired) |
| **Critical Rules** | RecurringData chain never crosses subscriptions — new chain on card replace. Atomic write path: charge + membership update + event in sequence. Typed idempotency keys (6 formats) prevent duplicate charges. Billing lease (5-min lock) prevents concurrent cron + manual charges. Hard declines → immediate `uncollectible` (no retry). |

---

### Berg Liquor Controls
| | |
|---|---|
| **Depends On** | Liquor (`BergPluMapping` resolves to `BottleProduct` via `bottleProductId` or `MenuItem`), Inventory (Deduction Outbox — double-deduction risk with `RING_AND_SLING`), Orders (auto-ring `OrderItem` creation in `RING_AND_SLING` mode via `terminalId → offlineTerminalId` scope), Settings (`bergReportsEnabled` flag gates Tier 1 features) |
| **Depended On By** | Reports (Berg Comparison variance report; Sprint C Dispense Log / Variance / Unmatched / Health reports) |
| **Shared Models** | `BergPluMapping` (links `pluCode` to `MenuItem`/`BottleProduct`), `BergDevice` (per-ECU config), `BergDispenseEvent` (immutable audit record), `LocationSettings.bergReportsEnabled` |
| **Shared Socket Events** | None — berg-bridge to server is HTTP POST; no socket events emitted for dispense events |
| **Critical Rules** | `berg-bridge.ts` is NUC-only — NEVER deploy on Vercel. `BERG_ENABLED` env var MUST gate all `serialport`-dependent routes or Vercel build fails. `bridgeSecretHash` is one-time-display — treat as a password. `unmatchedType` is `String?` not an enum — do NOT add enum constraints. `RING_AND_SLING` OrderItem creation is deferred (Sprint B) — do NOT wire order mutation before Sprint B. Double-deduction guard: verify Deduction Outbox config before enabling `RING_AND_SLING`. `terminalId` matches `Terminal.offlineTerminalId` (NOT `Terminal.id`). |

---

*Last updated: 2026-03-10 (Device count limits, cellular device management, transaction/behavior limits added to Hardware row)*
