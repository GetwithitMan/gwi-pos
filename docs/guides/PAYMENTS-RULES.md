# Payments Rules

> Reference doc for AI agents working on GWI POS payment code.

---

## Datacap-Only Rule

GWI POS uses **Datacap exclusively** for all card payments. This is a hard architectural constraint.

- NEVER add Stripe, Square, Braintree, or any other payment processor
- NEVER enter Datacap credentials directly in `.env` or the NUC — they come from Mission Control via sync
- All payment code lives in `src/lib/datacap/` — do not create payment code outside this directory

---

## Payment Priority Rule

> "Customers must always get their money. Reports can always be fixed after the fact."

If there is ever a conflict between payment processing reliability and reporting accuracy, **payment processing wins**.

---

## Architecture Diagram

```
Customer taps/swipes card
         │
         ▼
  Datacap Reader (LAN — 192.168.x.x:port)
         │  TCP — local network only
         ▼
  NUC (src/lib/datacap/client.ts)
         │  POST /api/orders/[id]/pay
         ▼
  Approved / Declined (local, ~1s)
         │
         ▼
  Order marked paid in local PG
         │  (background, non-blocking)
         ▼
  Syncs to Neon cloud (5s upstream)
```

---

## Credential Flow: Mission Control → NUC

Datacap credentials are configured in Mission Control per venue and pushed down to the NUC via sync — never entered directly.

```
GWI Admin sets credentials in Mission Control
  └── Location.settings.payments.datacapMerchantId
  └── Location.settings.payments.datacapTokenKey
  └── Location.settings.payments.datacapEnvironment
         │ Pushed to NUC via:
         │ 1. Registration flow (during NUC provisioning)
         │ 2. Downstream sync (Neon → NUC, every 15s)
         ▼
NUC local PG — Location.settings (cloud-authoritative)
         │
         ▼
getPaymentSettingsCached(locationId)  ← 5min TTL cache
         │
         ▼
DatacapClient configured and ready
```

---

## Credential Fields

| Field | What it is | Set where |
|-------|-----------|-----------|
| `datacapMerchantId` | Datacap MID — identifies the merchant | Mission Control |
| `datacapTokenKey` | Token key — used as password in cloud mode auth | Mission Control |
| `datacapEnvironment` | `'cert'` (test) or `'production'` | Mission Control |
| `processor` | `'datacap'` in production, `'simulated'` in dev | Mission Control |
| `readerTimeoutSeconds` | TCP timeout to reader (default 30s) | Mission Control |
| `operatorId` | Hardcoded `'POS'` — not configurable | N/A |

---

## Communication Modes

- `communicationMode: 'local'` in production — reader is on the LAN, zero internet dependency
- `communicationMode: 'cloud'` is for dev/remote testing only (Datacap cloud relay)

---

## Dual Pricing Model

- Card price = default (what's stored in the menu)
- Cash price = discount (card price minus surcharge percentage)
- Formula: `cashTotal = order.total`, `cardTotal = order.total + surcharge`
- Stored prices **are** cash prices. Web POS `PaymentModal` sends `amount: remainingBeforeTip` for cash (= `order.total`)
- Android must match: `cashTotal = order.total`, `cardTotal = order.total + surcharge`

See also: `docs/skills/SPEC-31-DUAL-PRICING.md`

---

## Agent Rules

1. NEVER add Stripe, Square, Braintree, or any other payment processor
2. NEVER enter Datacap credentials directly in `.env` or the NUC
3. All payment code lives in `src/lib/datacap/`
4. `communicationMode: 'local'` in production
5. Pre-auth (bar tabs) also goes through Datacap — same reader, same `DatacapClient`
6. Payment settings are cached at 5min TTL via `getPaymentSettingsCached()`
7. The simulated payment path (`src/lib/datacap/simulated-defaults.ts`) is dev-only — tagged `SIMULATED_DEFAULTS`, remove before go-live

---

## Simulated Defaults Cleanup (Go-Live)

Search tag: `SIMULATED_DEFAULTS`. Steps:

1. Set real `merchantId` + `operatorId` per Location
2. Set all `PaymentReader.communicationMode` to `'local'`
3. Set `settings.payments.processor` to `'datacap'`
4. Delete `simulated-defaults.ts` and its import
5. Verify: `grep -r "SIMULATED_DEFAULTS" src/` returns zero matches

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/datacap/` | All payment processing code |
| `src/lib/datacap/client.ts` | `DatacapClient` — TCP connection to reader |
| `src/lib/datacap/helpers.ts` | Helper utilities |
| `src/lib/datacap/simulated-defaults.ts` | Dev-only simulated payment path (remove at go-live) |
| `src/lib/payment-settings-cache.ts` | 5min TTL cache for payment settings |
| `/api/orders/[id]/pay/route.ts` | Payment endpoint |
| `/api/orders/[id]/pre-auth/route.ts` | Tab pre-auth endpoint |
