# Integrations

Connect with payment processors, delivery services, and third-party systems.

## Overview

GWI POS integrates with external services for payments, delivery, accounting, and more.

## Payment Processors

### Supported Processors
| Processor | Features |
|-----------|----------|
| Stripe | Cards, terminals, Apple Pay |
| Square | Cards, terminals |
| PayPal | Online payments |
| Cash | Built-in cash handling |

### Stripe Integration

#### Setup
1. Go to Settings > Payments
2. Enter Stripe API keys
3. Configure webhook URL
4. Test with test mode

#### Features
- Credit/debit cards
- Stripe Terminal (physical)
- Apple Pay / Google Pay
- Pre-authorization
- Refunds

#### Configuration
```typescript
// Environment variables
STRIPE_SECRET_KEY=sk_xxx
STRIPE_PUBLISHABLE_KEY=pk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### Terminal Integration
- Stripe Terminal
- Square Terminal
- USB card readers
- Bluetooth readers

## Delivery Services

### Supported Platforms
| Platform | Integration |
|----------|-------------|
| DoorDash | Order sync |
| UberEats | Order sync |
| Grubhub | Order sync |
| Custom | API webhook |

### Delivery Order Flow
1. Order received from platform
2. Auto-creates in POS
3. Sends to kitchen
4. Status updates sync back

### Configuration
1. Settings > Integrations > Delivery
2. Connect platform account
3. Map menu items
4. Enable auto-accept (optional)

## Accounting

### QuickBooks Integration
- Daily sales sync
- Payment reconciliation
- Category mapping
- Automatic journal entries

### Xero Integration
- Sales data export
- Invoice generation
- Bank reconciliation

### Export Formats
- CSV export
- QuickBooks IIF
- Xero CSV
- Custom formats

## Loyalty & Marketing

### Email Marketing
| Platform | Features |
|----------|----------|
| Mailchimp | Customer sync, campaigns |
| Constant Contact | Email marketing |
| Custom SMTP | Transaction emails |

### SMS
- Twilio integration
- Reservation reminders
- Order ready alerts
- Marketing (opt-in)

## Kitchen Display

### External KDS
- Kitchen display systems
- Bump bar support
- Multi-station routing

### Print Services
- Star printers
- Epson printers
- Network printing
- Cloud printing

## Reservation Platforms

### OpenTable
- Sync reservations
- Availability updates
- Guest data import

### Resy
- Reservation sync
- Waitlist integration

### Custom Widget
- Embed on website
- Direct bookings
- No third-party fees

## API Webhooks

### Outgoing Webhooks
Send events to external systems:
- Order created
- Order completed
- Payment received
- Customer created

### Configuration
```
POST /api/settings/webhooks
{
  "url": "https://example.com/webhook",
  "events": ["order.created", "payment.completed"],
  "secret": "xxx"
}
```

### Webhook Payload
```json
{
  "event": "order.completed",
  "timestamp": "2026-01-28T19:45:00Z",
  "data": {
    "orderId": "xxx",
    "total": 45.50,
    "items": [...]
  }
}
```

## Incoming Webhooks

### Receive External Orders
```
POST /api/webhooks/orders
{
  "source": "doordash",
  "externalId": "dd-123",
  "items": [...],
  "customer": {...}
}
```

## API Keys

### Managing Keys
1. Settings > Integrations > API Keys
2. Generate new key
3. Set permissions
4. Track usage

### Key Permissions
- Read orders
- Create orders
- Read menu
- Update menu
- Read customers

## Data Sync

### Real-time Sync
- WebSocket connections
- Instant updates
- Two-way sync

### Batch Sync
- Scheduled exports
- Daily summaries
- End-of-day reports

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/webhooks/route.ts` | Webhook handler |
| `src/lib/stripe.ts` | Stripe integration |
| `src/lib/integrations/doordash.ts` | DoorDash sync |
| `src/app/(admin)/settings/integrations/page.tsx` | Integration config |
| `src/lib/accounting-export.ts` | Accounting exports |
