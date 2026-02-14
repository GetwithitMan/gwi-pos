# Pre-Launch Test Checklist

> **MANDATORY:** This checklist must be maintained and reviewed during every PM EOD session.
> New tests are added as features are built. Nothing ships until all tests pass.
> Mark tests with date completed when verified on live POS.

## How to Use This Checklist
1. PM adds new test items as features are completed during sessions
2. During EOD, PM reviews this list and adds any tests from the day's work
3. Before go-live, every item must have a completion date
4. Tests marked with a fail date are known failures — must be resolved before launch

---

### 1. Order Flow & Payment

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 1.1 | Create dine-in order, add items, send to kitchen | Open table → add items → Send → verify KDS shows ticket | ⬜ |
| 1.2 | Create bar tab order | Bar Tab → enter name → add items → Send | ⬜ |
| 1.3 | Create takeout order | Takeout → add items → verify payment required before send | ⬜ |
| 1.4 | Pay with cash (exact) | Add items → Pay → Cash → enter exact amount → verify receipt | ⬜ |
| 1.5 | Pay with cash (change due) | Pay with more than total → verify change displayed | ⬜ |
| 1.6 | Pay with card | Add items → Pay → Card → verify payment completes | ⬜ |
| 1.7 | Split payment (even split) | Pay → Split → Even → 2 ways → verify both payments | ⬜ |
| 1.8 | Split payment (by item) | Pay → Split → By Item → assign items → verify amounts | ⬜ |
| 1.9 | Apply discount (%) | Add items → Discount → percentage → verify total adjusts | ⬜ |
| 1.10 | Apply discount ($) | Add items → Discount → dollar amount → verify total | ⬜ |
| 1.11 | Void item (manager approval) | Add item → void → enter reason → manager PIN → verify removed | ⬜ |
| 1.12 | Comp item (manager approval) | Add item → comp → reason → manager PIN → verify $0 | ⬜ |
| 1.13 | Remote void approval via SMS | Void → Request Remote → select manager → verify SMS + code | ⬜ |
| 1.17 | Void from BartenderView | Bar view → open tab → void item → verify CompVoidModal opens and completes | ⬜ |
| 1.18 | "Was it made?" on void | Void item → select reason → verify Yes/No buttons → select → verify wasMade in DB | ⬜ |
| 1.19 | VOID stamp on order panel (FloorPlan) | Void item from floor plan → verify red VOID badge, strikethrough, $0.00 | ⬜ |
| 1.20 | VOID stamp on order panel (BartenderView) | Void item from bar view → verify same VOID stamp treatment | ⬜ |
| 1.21 | COMP stamp on order panel | Comp item → verify blue COMP badge, strikethrough, $0.00 | ⬜ |
| 1.22 | Voided item persists on reload | Void item → reload page → re-open order → verify VOID stamp still shows | ⬜ |
| 1.14 | Add tip on payment | Pay → add tip amount → verify tip recorded | ⬜ |
| 1.15 | Receipt displays correctly | Pay → view receipt → verify items, totals, tip, tax | ⬜ |
| 1.16 | Order auto-clears after payment | Pay → close receipt → verify floor plan returns to clean state | ⬜ |
| 1.23 | Cash rounding accepted by server | Add item ($3.29 total) → Pay Cash ($3.25 rounded) → verify payment succeeds, no rejection | ⬜ |
| 1.24 | Cash rounding shows on PaymentModal | Select Cash → verify "Rounding" line shows adjustment, remaining shows rounded total | ⬜ |
| 1.25 | Cash rounding stored on payment record | After cash payment → check DB Payment.roundingAdjustment is non-null | ⬜ |
| 1.26 | Cash rounding on daily report | /reports/daily → verify yellow "Cash Rounding" line with cumulative day total | ⬜ |
| 1.27 | Void then pay doesn't show stale total | Void item → open Pay → verify total reflects voided item (not pre-void amount) | ⬜ |

### 2. Modifiers & Menu Builder

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 2.1 | Add modifier to item | Select item → modifier modal → select modifier → verify on order | ⬜ |
| 2.2 | Pre-modifiers (No/Lite/Extra) | Select modifier → tap No/Lite/Extra → verify prefix on order | ⬜ |
| 2.3 | Stacked modifiers (2x) | Enable stacking → tap same modifier twice → verify 2x badge | ⬜ |
| 2.4 | Child modifier groups (nested) | Select modifier with child group → navigate to child → select → verify depth display | ✅ 2026-02-07 |
| 2.5 | Modifier with ingredient link | In Menu Builder: link modifier to ingredient → verify connection badge in /ingredients | ⬜ |
| 2.6 | Spirit tier upgrades (quick select) | On cocktail: tap Call/Prem/Top → verify spirit upgrade applied | ⬜ |
| 2.7 | Pour size selection | On liquor item: tap Shot/Dbl/Tall → verify price multiplier | ⬜ |
| 2.8 | Combo step flow | Select combo → step through components → verify all selections | ⬜ |
| 2.9 | Modifier cascade delete | Menu Builder → delete group with children → verify preview → confirm → all deleted | ⬜ |
| 2.10 | Online modifier override | Set modifier group showOnline=false → verify hidden on online channel query | ⬜ |

### 3. Inventory Deduction (CRITICAL)

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 3.1 | Base recipe deduction on payment | Order item with recipe → pay → check InventoryItem.currentStock decreased | ⬜ |
| 3.2 | Modifier deduction via ModifierInventoryLink (Path A) | Order + modifier with inventoryLink → pay → verify stock decreased | ⬜ |
| 3.3 | Modifier deduction via ingredientId fallback (Path B) | Order + modifier with ingredientId (e.g. Ranch) → pay → verify stock decreased by standardQuantity | ⬜ |
| 3.4 | "Extra" modifier = 2x deduction | Order + "Extra Ranch" → pay → verify 2x standardQuantity deducted (3.0 oz) | ⬜ |
| 3.5 | "No" modifier = 0x deduction + base skip | Order item with base Ranch + "No Ranch" → pay → verify Ranch NOT deducted | ⬜ |
| 3.6 | "Lite" modifier = 0.5x deduction | Order + "Lite" modifier → pay → verify half-quantity deducted | ⬜ |
| 3.7 | Path A takes precedence over Path B | Modifier has BOTH inventoryLink AND ingredientId → verify only inventoryLink quantity used | ⬜ |
| 3.8 | Void item deduction (waste) | Send item → void (kitchen error) → verify waste transaction created | ⬜ |
| 3.9 | Void item NO deduction (not made) | Void before send → verify NO waste transaction | ⬜ |
| 3.10 | InventoryItemTransaction created | After payment → check DB for transaction with type='sale', correct qty | ⬜ |
| 3.11 | Theoretical usage calculation | Run AvT report → verify modifier ingredient path included | ⬜ |
| 3.12 | PMIX food cost includes modifier ingredients | Run PMIX → verify modifier cost from ingredient path shows in food cost % | ⬜ |
| 3.13 | Prep stock deduction at send-to-kitchen | Send order with prep items → verify prepStock decreased | ⬜ |
| 3.14 | Multiple items x modifier qty | Order 3x burger each with Ranch → pay → verify 3 x 1.5 oz = 4.5 oz deducted | ⬜ |

### 4. Ingredient Library & Hierarchy

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 4.1 | Hierarchy view displays correctly | /ingredients → verify category → base → prep tree | ⬜ |
| 4.2 | "Connected" badge on linked ingredients | Ingredient with linkedModifierCount > 0 → verify purple badge | ⬜ |
| 4.3 | Expand linked modifiers panel | Click on connected ingredient → verify modifiers + menu items shown | ⬜ |
| 4.4 | Checkbox selection in hierarchy | Select ingredients → verify count → bulk action | ⬜ |
| 4.5 | Category "Select All" with indeterminate | Select some in category → verify indeterminate checkbox on category | ⬜ |
| 4.6 | Create new base ingredient | + New → fill fields → save → verify appears in hierarchy | ⬜ |
| 4.7 | Create prep item under base | Base → Add Preparation → fill input/output → save → verify nested | ⬜ |
| 4.8 | Edit ingredient cost | Edit base → change cost → save → verify cost API returns updated | ⬜ |
| 4.9 | Soft delete ingredient | Delete → verify disappears from list → verify deletedAt set (not hard deleted) | ⬜ |
| 4.10 | Restore deleted ingredient | Deleted panel → restore → verify returns to correct category | ⬜ |
| 4.11 | "Unverified" badge on new ingredients | Create via Menu Builder → verify red Unverified badge in /ingredients | ⬜ |
| 4.12 | Verify ingredient clears badge | Click verify button → confirm → verify badge removed | ⬜ |
| 4.13 | Quick stock adjust | /inventory/quick-adjust → adjust stock → type VERIFY → enter PIN → verify saved | ⬜ |
| 4.14 | Recipe cost aggregation | Base ingredient with recipe → expand → verify total cost shown | ⬜ |
| 4.15 | Debounced search | Type in search → verify no flicker → results appear after 300ms pause | ⬜ |

### 5. Floor Plan & Tables

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 5.1 | Floor plan loads with tables | Navigate to /orders → verify floor plan renders with tables | ⬜ |
| 5.2 | Tap table to start order | Tap available table → verify order panel opens | ⬜ |
| 5.3 | Table status colors | Available=green, occupied=blue, reserved=purple, dirty=yellow | ⬜ |
| 5.4 | ~~Virtual combine tables~~ | ~~N/A — Combine fully removed (Skill 326)~~ | N/A |
| 5.5 | ~~Split combined tables~~ | ~~N/A — Combine fully removed (Skill 326)~~ | N/A |
| 5.6 | Table resize and rotation | Floor Plan Editor → drag handles → verify resize + rotation | ⬜ |
| 5.7 | Entertainment items on floor plan | Add entertainment → place on floor plan → verify status glow | ⬜ |
| 5.8 | ~~Seat count correct after combine~~ | ~~N/A — Combine fully removed (Skill 326)~~ | N/A |
| 5.9 | No console spam in production | Build production (npm run build) → drag tables → check console for logs | ⬜ |
| 5.10 | Deterministic table placement | Reset DB → create 6 tables → verify grid layout (not random) | ⬜ |
| 5.11 | API failure shows toast | Network offline → drag table → verify error toast + rollback | ⬜ |
| 5.12 | Table property save failure rollback | Network offline → edit table properties → save → verify rollback + toast | ⬜ |
| 5.13 | NaN coordinate error logged | Pass invalid coord in dev → verify throw with context, log in prod | ⬜ |
| 5.14 | Legacy combine endpoint blocked | Call /api/tables/combine → verify 410 Gone response | ✅ 2026-02-11 |
| 5.15 | Soft deleted tables hidden | Soft delete table (deletedAt) → refresh floor plan → verify hidden | ⬜ |
| 5.16 | ~~Virtual group border renders~~ | ~~N/A — Combine fully removed (Skill 326)~~ | N/A |
| 5.17 | Add seat after send to kitchen | Send items → reopen table → tap "+" → verify new seat number appears in strip | ⬜ |
| 5.18 | Seat number persists on items after send | Assign items to seat 5 → send to kitchen → reopen table → verify items show S5 badge | ⬜ |
| 5.19 | Extra seats restored on table reopen | Add seats 5+6, send items → close/reopen table → verify seat strip shows 1-6 (not just 1-4) | ⬜ |
| 5.20 | Course number persists on items after send | Assign items to course 2 → send → reopen → verify course number shown | ⬜ |

### 6. KDS & Kitchen

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 6.1 | KDS receives orders | Send order → verify ticket appears on /kds | ⬜ |
| 6.2 | Bump item on KDS | Tap item on KDS → verify bumped/marked done | ⬜ |
| 6.3 | KDS device pairing | Generate code → enter on device → verify paired + cookie set | ⬜ |
| 6.4 | Modifier depth display | Order with nested modifiers → verify KDS shows "- Mod" / "-- Child" | ⬜ |
| 6.5 | Course firing | Multi-course order → fire courses in sequence → verify KDS updates | ⬜ |
| 6.6 | Entertainment KDS dashboard | /kds/entertainment → verify active sessions + timers | ⬜ |
| 6.7 | KDS renders on Chrome 108 device | Open /kds on KDS device (Chrome 108) → verify dark background, text visible, no white screen | ⬜ |
| 6.8 | KDS pair page renders on older Chrome | Open /kds/pair on Chrome 108 → verify dark background, code inputs visible, submit works | ⬜ |
| 6.9 | KDS pair redirect includes screen slug | Complete pairing → verify redirect URL is /kds?screen=kitchen (not just /kds) | ⬜ |

### 7. Tipping & Tip Shares

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 7.1 | Tip-out rules applied at shift close | Server closes shift → verify auto tip-out to busser | ⬜ |
| 7.2 | Tip share report shows correct amounts | /reports/tip-shares → verify amounts match rules | ⬜ |
| 7.3 | Mark tip shares as paid | Tip share report → mark paid → verify status updates | ⬜ |
| 7.4 | Daily store report includes tips | /reports/daily → verify tip section present | ⬜ |
| 7.5 | Employee tips API uses ledger (not TipBank) | GET /api/employees/[id]/tips → verify returns ledger entries, no TipBank model references | ⬜ |
| 7.6 | Tip allocation idempotency | Pay same order twice → verify only 1 TipTransaction + 1 set of ledger entries | ⬜ |
| 7.7 | Tip bank feature flag | Set tipBank.enabled=false → pay order → verify no tip allocation (payment still succeeds) | ⬜ |
| 7.8 | Tip ledger self-access check | GET /api/tips/ledger?employeeId=X without matching x-employee-id header → verify 403 | ⬜ |
| 7.9 | Tip debt auto-reclaim | Trigger chargeback exceeding balance → verify TipDebt created → add new tip → verify auto-reclaim | ⬜ |
| 7.10 | Weighted tip splits | Create tip group with role_weighted mode → pay order → verify splits by role tipWeight | ⬜ |

### 8. Employee & Auth

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 8.1 | PIN login works | /login → enter PIN → verify correct employee logged in | ⬜ |
| 8.2 | Permission enforcement | Server tries manager action → verify denied | ⬜ |
| 8.3 | Clock in/out | Clock in → verify time recorded → clock out → verify shift | ⬜ |
| 8.4 | Break tracking | Start break → end break → verify duration recorded | ⬜ |
| 8.5 | Shift close with cash count | Close shift → enter cash count → verify variance calculated | ⬜ |

### 9. Reports

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 9.1 | Daily store report generates | /reports/daily → select date → verify all sections populate | ⬜ |
| 9.2 | Sales by category report | /reports → sales → verify category breakdown | ⬜ |
| 9.3 | PMIX report with food cost | /reports/pmix → verify food cost % includes modifier ingredient costs | ⬜ |
| 9.4 | Void report accuracy | Void items → run void report → verify all voids shown | ⬜ |
| 9.5 | Employee shift report | /reports/shift → verify hours, tips earned vs received | ⬜ |

### 10. Entertainment & Timed Rentals

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 10.1 | Start timed session | Select entertainment item → send → verify timer starts | ⬜ |
| 10.2 | Extend session | Active session → extend → verify new expiry | ⬜ |
| 10.3 | Stop and bill | Stop session → verify final billing calculated | ⬜ |
| 10.4 | Block time mode | Set block time 60min → start → verify countdown | ⬜ |
| 10.5 | Per-minute billing | Set per-minute → start → stop after 15min → verify charge | ⬜ |

### 11. Printing & Hardware

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 11.1 | Receipt prints correctly | Pay order → print receipt → verify formatting | ⬜ |
| 11.2 | Kitchen ticket routes correctly | Send order → verify ticket goes to correct printer/KDS | ⬜ |
| 11.3 | Print route priority | Item printer > category printer > default → verify routing | ⬜ |
| 11.4 | Per-modifier print routing | Modifier with custom routing → verify follows setting | ⬜ |
| 11.5 | Backup printer failover | Primary offline → verify ticket goes to backup | ⬜ |

### 12. UI & Personalization

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 12.1 | Glassmorphism renders | Verify frosted glass panels throughout POS | ⬜ |
| 12.2 | Bar/Food mode theme switch | Switch between bar and food → verify blue/orange themes | ⬜ |
| 12.3 | Category color customization | Gear → Reorder Categories → paint icon → set color → verify | ⬜ |
| 12.4 | Menu item style customization | Gear → Customize Item Colors → set glow/border → verify | ⬜ |
| 12.5 | Reset all customizations | Gear → Reset All → verify defaults restored | ⬜ |
| 12.6 | Toast notifications display | Perform action → verify toast appears bottom-right | ⬜ |
| 12.7 | OrderPanel uniform on /orders | /orders → add items → verify Qty +/-, Note, Hold, Course, Edit, Delete controls present | ⬜ |
| 12.8 | OrderPanel uniform on /bar | /bar → select tab → add items → verify same item controls as /orders | ⬜ |
| 12.9 | OrderPanel uniform on FloorPlanHome | Tap table → add items → verify same item controls as /orders | ⬜ |
| 12.10 | OrderPanel dark header on /bar | /bar → verify OrderPanel renders its own dark header (no external light header) | ⬜ |
| 12.11 | FloorPlanHome hides OrderPanel header | Tap table → verify OrderPanel header is hidden (FloorPlanHome has its own) | ⬜ |
| 12.12 | Send + Pay buttons on all screens | Verify Send (green) and Pay (indigo) buttons appear on /orders, /bar, and FloorPlanHome | ⬜ |
| 12.13 | Note modal replaces window.prompt | Tap Note icon on pending item → verify dark glassmorphism modal appears (not browser prompt) | ⬜ |
| 12.14 | Quick Pick strip appears when enabled | Gear → enable Quick Pick Numbers → verify 1-9 strip appears in gutter between menu and order panel | ⬜ |
| 12.15 | Quick Pick quantity change | Add item → tap "3" in quick pick → verify item quantity changes to 3 | ⬜ |
| 12.16 | Quick Pick multi-digit entry | Add item → tap "1" then "2" quickly → verify quantity changes to 12 | ⬜ |
| 12.17 | Quick Pick multi-select mode | Tap SEL in gutter → select multiple items → tap number → verify all selected items change qty | ⬜ |
| 12.18 | Quick Pick Hold button | Select item → tap HLD in gutter → verify item shows HELD badge | ⬜ |
| 12.19 | Quick Pick delay presets | Select item → tap "5m" in gutter → verify blue delay badge appears on item | ⬜ |
| 12.20 | Per-item delay countdown | Set 5m delay → Send order → verify countdown timer renders on item → verify auto-fires at 0 | ⬜ |
| 12.21 | Per-item delay Fire Now | Set delay → Send → tap "Fire" on countdown → verify item immediately fires to kitchen | ⬜ |
| 12.22 | Hold and Delay mutually exclusive | Hold item → set delay → verify hold clears. Set delay → hold → verify delay clears | ⬜ |
| 12.23 | Modifier depth indentation | Add item with child modifiers (House Salad → Ranch) → verify Ranch indented with prefix | ✅ 2026-02-07 |
| 12.24 | Pre-modifier color labels | Add item → set modifier to "Extra" → verify amber EXTRA label in order panel | ✅ 2026-02-07 |
| 12.25 | Coursing toggle via table options | Tap table name → enable coursing → verify items group by course in OrderPanel | ⬜ |
| 12.26 | Open orders delay/hold/course badges | Create order with delayed/held items → open Orders panel → verify status badges shown | ⬜ |
| 12.27 | Delete button under price | Add pending item → verify trash icon appears under price amount (not in separate row) | ⬜ |

### 13. Datacap Payment Processing

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 13.1 | EMVSale processes correctly | Ring up item → Pay → Card → verify Datacap XML sent, response parsed, payment recorded | ⬜ |
| 13.2 | EMVPreAuth opens bar tab | New Tab → card tap → verify CollectCardData + PreAuth fire, RecordNo stored | ⬜ |
| 13.3 | PreAuthCapture closes tab | Close tab → verify capture uses RecordNo, final amount correct | ⬜ |
| 13.4 | AdjustByRecordNo adds tip | Close with receipt tip → enter tip later → verify adjust works | ⬜ |
| 13.5 | VoidSaleByRecordNo voids | Void payment → verify void uses RecordNo, hold released | ⬜ |
| 13.6 | EMVReturn processes refund | Return with card present → verify refund processes | ⬜ |
| 13.7 | ReturnByRecordNo (card not present) | Return without card → verify RecordNo-based refund | ⬜ |
| 13.8 | EMVPadReset fires after every transaction | Any monetary transaction → verify PadReset auto-fires | ⬜ |
| 13.9 | SequenceNo tracks per reader | Multiple transactions → verify SequenceNo increments correctly per reader | ⬜ |
| 13.10 | Reader ping uses real protocol | Settings → Hardware → Ping reader → verify EMVPadReset used | ⬜ |
| 13.11 | Simulated mode still works | Set processor=datacap_simulated → full flow → verify no hardware needed | ⬜ |
| 13.12 | Cloud fallback when local fails | Unplug reader → verify cloud mode attempted if configured | ⬜ |

### 14. Bar Tab Flows

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 14.1 | Card-first tab open | New Tab → card tap → verify cardholder name auto-fills tab | ⬜ |
| 14.2 | Pending tab shimmer animation | Open tab → verify shimmer while authorizing → green check on approval | ⬜ |
| 14.3 | Decline shows red X | Use test decline card → verify red X animation + toast alert | ⬜ |
| 14.4 | Parallel ordering during auth | Open tab (processing) → switch to another customer → ring up → verify both work | ⬜ |
| 14.5 | Auto-increment at 80% threshold | Open $1 tab → add $25 drinks → verify IncrementalAuth fires at $0.80 | ⬜ |
| 14.6 | Multi-card tab | Add second card to tab → verify both cards show as badges | ⬜ |
| 14.7 | Close tab with device tip | Close tab → verify tip buttons on reader → capture includes tip | ⬜ |
| 14.8 | Close tab with receipt tip | Close tab (PrintBlankLine) → enter tip → verify AdjustByRecordNo | ⬜ |
| 14.9 | Tab void releases holds | Void unclosed tab → verify all OrderCard records voided | ⬜ |
| 14.10 | Re-Auth button shows on existing tab | Open tab with card → add items → verify button says "Re-Auth XXXX" | ⬜ |
| 14.11 | Re-Auth fires IncrementalAuth (no card tap) | Click Re-Auth → verify IncrementalAuthByRecordNo fires, no card modal shown | ⬜ |
| 14.12 | Re-Auth approval toast + hold update | Re-Auth approved → verify green toast + Open Orders hold amount increases | ⬜ |
| 14.13 | Re-Auth decline toast | Re-Auth declined → verify red decline toast, tab still usable | ⬜ |
| 14.14 | Re-Auth includes tax in hold | Add $10 item (+ tax) → Re-Auth → verify hold covers total with tax, not just subtotal | ⬜ |
| 14.15 | Tip buffer on hold | Set tip buffer to 25% → $50 tab → verify hold is ~$62.50 | ⬜ |
| 14.16 | Tip buffer 0% holds exact total | Set tip buffer to 0% in settings → Re-Auth → verify hold equals exact tab total | ⬜ |
| 14.17 | No tab duplication on Re-Auth | Click Re-Auth multiple times → verify only 1 tab in Open Orders (no duplicates) | ⬜ |
| 14.18 | Add second card to existing tab | Tab has card → add another card → verify both cards, default card used for increment | ⬜ |
| 14.19 | Settings UI: Bar Tab / Pre-Auth card | /settings → verify Bar Tab card shows tip buffer %, threshold, min increment, manager alert | ⬜ |
| 14.20 | Settings save and apply | Change tip buffer to 30% → save → Re-Auth → verify hold uses 30% buffer | ⬜ |

### 15. Quick Pay & Tip Modes

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 15.1 | Quick Pay single-tap flow | Ring up drink → Quick Pay → card tap → tip → done (no tab) | ⬜ |
| 15.2 | Under-threshold shows dollar tips | Set threshold=$15 → order $8 drink → verify $1/$2/$3 buttons | ⬜ |
| 15.3 | Over-threshold shows percent tips | Order $20+ → verify 18%/20%/25% buttons | ⬜ |
| 15.4 | Custom tip requires entry for $0 | Tap Custom → verify must enter amount (even $0) to skip | ⬜ |
| 15.5 | Signature capture works | Transaction over signature threshold → verify canvas renders, base64 captured | ⬜ |

### 16. Bottle Service

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 16.1 | Tier CRUD works | Settings → create Bronze/Silver/Gold tiers → verify saved | ⬜ |
| 16.2 | Open bottle service tab | Select tier → card tap → verify deposit pre-auth fires | ⬜ |
| 16.3 | Spend progress banner | Add drinks → verify progress bar updates, % shown | ⬜ |
| 16.4 | Re-auth alert at deposit threshold | Spend reaches deposit → verify alert shown, "Extend" button works | ⬜ |
| 16.5 | Auto-gratuity applied | Close bottle tab → verify auto-grat % added if configured | ⬜ |
| 16.6 | Bottle tabs show gold banner | Open bottle tab → verify gold/amber styling distinct from regular tabs | ⬜ |

### 17. Walkout Recovery & Card Recognition

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 17.1 | Mark tab as walkout | Manager marks tab → verify moves to walkout section | ⬜ |
| 17.2 | Auto-retry schedule fires | Walkout tab exists → verify retry attempts logged per schedule | ⬜ |
| 17.3 | Card recognition on repeat visit | Use same test card twice → verify visit count badge + toast | ⬜ |
| 17.4 | Digital receipt stored | Complete payment → verify DigitalReceipt record created with receipt data | ⬜ |

### 18. Customer-Facing Display (CFD)

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 18.1 | CFD idle screen renders | Open /cfd → verify clock + welcome text + branding | ⬜ |
| 18.2 | CFD shows live order | Ring up items on POS → verify /cfd shows items in real-time | ⬜ |
| 18.3 | CFD tip prompt works | Initiate payment → verify tip buttons appear on CFD | ⬜ |
| 18.4 | CFD signature capture | Signature requested → verify canvas on CFD → sign → base64 sent | ⬜ |
| 18.5 | CFD approved/declined screens | Complete payment → verify Thank You or Declined screen | ⬜ |
| 18.6 | CFD auto-returns to idle | After approved/declined → verify returns to idle after 10s | ⬜ |

### 19. Pay-at-Table & Bartender Mobile

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 19.1 | Pay-at-table loads order | Open /pay-at-table?orderId=X → verify order summary shows | ⬜ |
| 19.2 | Split check works | Select split → choose ways → verify per-person amount correct | ⬜ |
| 19.3 | Pay-at-table tip screen | Select tip → verify amount added → payment processes | ⬜ |
| 19.4 | Mobile tab list loads | Open /mobile/tabs → verify open tabs listed with totals | ⬜ |
| 19.5 | Mobile tab detail | Tap tab → verify items, cards, totals, bottle service indicator | ⬜ |
| 19.6 | Mobile quick actions | Close Tab / Transfer / Alert Manager → verify confirmation + action | ⬜ |
| 19.7 | Mobile polls for updates | Wait 10s → verify tab list refreshes automatically | ⬜ |

### 20. Phase 2 & 3 Systematic Fixes (Orders Domain)

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 20.1 | Centralized calculations consistency | Create order with items/modifiers → verify subtotal/tax/total match across client/server | ⬜ |
| 20.2 | Item total calculation with modifiers | Add item with 3 modifiers → verify itemTotal = (price + modifiers) x quantity | ⬜ |
| 20.3 | Order subtotal aggregation | Order with 5 items → verify subtotal = sum of all itemTotals | ⬜ |
| 20.4 | Tax calculation with rate | Order $50 subtotal at 8% tax → verify taxTotal = $4.00 | ⬜ |
| 20.5 | Tip recalculation preserves other totals | Add $10 tip → verify only total changes, subtotal/tax unchanged | ⬜ |
| 20.6 | Commission calculation | Order item with 10% commission at $20 → verify commissionTotal = $2.00 | ⬜ |
| 20.7 | Standardized error: ORDER_NOT_FOUND | Call GET /api/orders/invalid-id → verify 404 with code "ORDER_NOT_FOUND" | ⬜ |
| 20.8 | Standardized error: ORDER_CLOSED | Try to modify closed order → verify 409 with code "ORDER_CLOSED" | ⬜ |
| 20.9 | Standardized error: ORDER_EMPTY | POST /api/orders/[id]/items with empty array → verify 400 with code "ORDER_EMPTY" | ⬜ |
| 20.10 | Error response includes timestamp | Any error response → verify has "timestamp" field with ISO 8601 format | ⬜ |
| 20.11 | Error response machine-readable | Parse error.code field programmatically → verify matches ERROR_CODES constant | ⬜ |
| 20.12 | Location settings cache hit | Create 10 orders rapidly → verify only 1 DB query for location settings | ⬜ |
| 20.13 | Location settings cache TTL | Wait 5 minutes after cache hit → next order triggers fresh DB query | ⬜ |
| 20.14 | Location settings cache invalidation | Call invalidateLocationSettings(locationId) → next order fetches fresh | ⬜ |
| 20.15 | Location settings cache reduces API time | Measure order creation time with/without cache → verify 5-15ms improvement | ⬜ |
| 20.16 | Batch update reduces queries (send) | Send 10-item order → verify 1-2 queries (not 10+) using DB query logging | ⬜ |
| 20.17 | Batch update for regular items | Send 7 regular items → verify single orderItem.updateMany() call | ⬜ |
| 20.18 | Batch update for entertainment items | Send 3 entertainment items → verify 3 atomic transactions (not 9 queries) | ⬜ |
| 20.19 | Batch held item marking | Mark 5 items held → verify single updateMany() call | ⬜ |
| 20.20 | Batch bump items | Bump 8 items on KDS → verify single updateMany() call | ⬜ |
| 20.21 | Socket.io ORDER_TOTALS_UPDATE on create | Create order → verify ORDER_TOTALS_UPDATE event dispatched | ⬜ |
| 20.22 | Socket.io ORDER_TOTALS_UPDATE on add items | Add items to order → verify ORDER_TOTALS_UPDATE event dispatched | ⬜ |
| 20.23 | Socket.io ORDER_TOTALS_UPDATE on tip change | Update tip amount → verify ORDER_TOTALS_UPDATE event dispatched | ⬜ |
| 20.24 | Socket event includes correct payload | Capture event → verify has orderId, totals object, timestamp | ⬜ |
| 20.25 | Socket event filtered by location | Terminal in Location A doesn't receive Location B events | ⬜ |
| 20.26 | Socket dispatch fire-and-forget | Socket server down → verify API still returns 200, no blocking | ⬜ |
| 20.27 | Socket dispatch async doesn't delay response | Measure API response time with socket dispatch → verify < 5ms overhead | ⬜ |
| 20.28 | Multi-terminal real-time update | Terminal A updates order → Terminal B receives update within 100ms | ⬜ |
| 20.29 | Rapid updates all propagate | Add 5 items in 500ms → verify all 5 ORDER_TOTALS_UPDATE events fire | ⬜ |
| 20.30 | Large order totals update | 50-item order total updated → verify correct totals in socket event | ⬜ |

### 21. Socket Layer + Fetch Consolidation (Skill 248)

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 21.1 | No 3s polling in Network tab | Open /orders → Network tab → wait 30s → verify no repeating /api/orders/open or /api/menu requests | ⬜ |
| 21.2 | Open orders update cross-terminal via socket | Open two browser tabs → create order in tab A → verify tab B's Open Orders panel updates within 1s | ⬜ |
| 21.3 | Entertainment status via socket | Start entertainment session → verify other terminals see status change without polling | ⬜ |
| 21.4 | Hold/note/course/seat feel instant | Hold an item → verify no loading flash or flicker (store already updated) | ⬜ |
| 21.5 | Resend doesn't double-fetch | Resend item → verify only 1 GET /api/orders/[id] in Network tab (not 2) | ⬜ |
| 21.6 | Visibility-change fallback works | Switch to another app → switch back → verify open orders refresh on return | ⬜ |
| 21.7 | Socket graceful degradation (no server) | Dev mode (no socket server) → verify no red console errors, only warnings | ⬜ |
| 21.8 | Payment triggers open orders refresh | Pay order on terminal A → verify terminal B's Open Orders panel removes it within 1s | ⬜ |
| 21.9 | Debounced tabsRefreshTrigger | Rapid actions (split + void + pay) → verify only 1 /api/orders/open fetch in Network | ⬜ |
| 21.10 | OPEN_ORDERS_CHANGED broadcast route works | Fire dispatchOpenOrdersChanged → verify broadcast route returns 200 (not 400) | ⬜ |
| 21.11 | Floor plan updates on item add (cross-terminal) | Terminal A adds items to table → Terminal B sees table turn green (occupied) within 1s | ⬜ |
| 21.12 | Floor plan updates on payment (cross-terminal) | Terminal A pays table order → Terminal B sees table go back to available within 1s | ⬜ |
| 21.13 | Floor plan updates on tab close (cross-terminal) | Terminal A closes tab → Terminal B sees status update within 1s | ⬜ |
| 21.14 | Local table status instant on item add | Add first item to table order → table turns green immediately (no server round-trip) | ⬜ |

### 22. Auth & Session Stability

| # | Test | How to Verify | Status |
|---|------|--------------|--------|
| 22.1 | Page refresh preserves login | Log in → refresh page → verify still logged in (not redirected to /login) | ⬜ |
| 22.2 | Auth persists across tabs | Log in on tab A → open new tab to /orders → verify logged in (not redirected) | ⬜ |
| 22.3 | ~~Virtual combine requires intentional long-press~~ | ~~N/A — Combine fully removed (Skill 326)~~ | N/A |
| 22.4 | No ghost/phantom tables on floor plan | Refresh /orders → verify only real tables visible, no duplicates or old seed tables | ⬜ |
| 22.5 | Cloud settings loads with correct locationId | Visit `{slug}.ordercontrolcenter.com/settings` → verify no 500 errors, menu/ingredients pages load | ⬜ |
| 22.6 | Cloud session guard shows spinner then loads | Visit cloud settings with stale auth → verify "Verifying session..." spinner → page loads correctly | ⬜ |
| 22.7 | Cloud sign-out clears session and redirects | Cloud settings → click Sign Out → verify redirected to Mission Control, auth store cleared | ⬜ |
| 22.8 | Cloud mode re-bootstrap from cookie | Clear localStorage (stale auth) → refresh cloud settings → verify auto-login from httpOnly cookie | ⬜ |
| 22.9 | validate-session catches stale locationId | Set localStorage locationId to "loc-1" → refresh cloud settings → verify corrected to venue DB locationId | ⬜ |
| 22.10 | Multi-tenant DB routing isolates venues | Create data on venue A → verify it does NOT appear in venue B's database | ⬜ |

---

### Test Status Legend
- ⬜ = Not tested yet
- ✅ YYYY-MM-DD = Passed (with date)
- ❌ YYYY-MM-DD = Failed (with date — must resolve before launch)
- 🔄 = In progress / partially tested
