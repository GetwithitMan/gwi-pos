# 27 - Texting & SMS

**Status:** Planning
**Priority:** Medium
**Dependencies:** 25-Reservations, 26-Host-Management, 23-Online-Ordering

---

## Overview

The Texting & SMS skill provides text message communication with guests for waitlist notifications, reservation confirmations, order updates, and marketing. Integrates with Twilio or similar providers.

**Primary Goal:** Improve guest communication through timely, automated text messages.

---

## User Stories

### As a Guest...
- I want to receive a text when my table is ready
- I want reservation confirmations via text
- I want to know when my online order is ready
- I want to be able to reply to messages

### As a Host...
- I want to text guests from the waitlist
- I want to send "running late?" messages
- I want quick text templates

### As a Manager...
- I want to send promotional texts
- I want to see message history
- I want to control opt-in/opt-out

---

## Features

### Automated Messages

#### Waitlist Messages
- [ ] Added to waitlist confirmation
- [ ] Table ready notification
- [ ] Position update (optional)
- [ ] Removed from list

#### Reservation Messages
- [ ] Booking confirmation
- [ ] Reminder (24hr, 2hr)
- [ ] Modification confirmation
- [ ] Cancellation confirmation
- [ ] Thank you / feedback request

#### Online Order Messages
- [ ] Order confirmation
- [ ] Order ready for pickup
- [ ] Delivery update
- [ ] Order delayed notification

### Manual Messages

#### Quick Send
- [ ] Select guest from list
- [ ] Choose template or custom
- [ ] Send immediately
- [ ] View send status

#### Templates
```
Templates:
- "Your table is ready! Please see the host."
- "We're running about {X} minutes behind. Thanks for your patience!"
- "Your order #{order} is ready for pickup!"
- "Reminder: Reservation for {party_size} tomorrow at {time}"
- "Thanks for dining with us! How was your experience?"
```

#### Custom Messages
- [ ] Free-form text entry
- [ ] Character count
- [ ] Preview before send
- [ ] Emoji support

### Two-Way Messaging

#### Inbound Messages
- [ ] Guest replies captured
- [ ] Notification to staff
- [ ] Conversation view
- [ ] Auto-responses

#### Auto-Responses
```yaml
auto_responses:
  - trigger: "confirm"
    response: "Great! Your reservation is confirmed. See you at {time}!"
  - trigger: "cancel"
    response: "Your reservation has been cancelled. Reply UNDO to restore."
  - trigger: "help"
    response: "Call us at (555) 123-4567 for assistance."
```

### Bulk Messaging

#### Marketing Campaigns
- [ ] Create campaign
- [ ] Select recipients
- [ ] Schedule send time
- [ ] Track delivery/opens

#### Recipient Lists
- [ ] All opted-in guests
- [ ] Recent visitors
- [ ] Loyalty members
- [ ] Custom segments

### Compliance

#### Opt-In/Opt-Out
- [ ] Explicit opt-in required
- [ ] STOP to unsubscribe
- [ ] Opt-out immediately honored
- [ ] Opt-in records maintained

#### Compliance Features
- [ ] TCPA compliance
- [ ] Quiet hours (no late night)
- [ ] Rate limiting
- [ ] Consent tracking

### Message Templates

#### Template Management
- [ ] Create templates
- [ ] Variable placeholders
- [ ] Category organization
- [ ] A/B testing (optional)

#### Template Variables
```
{guest_name} - Guest's name
{party_size} - Party size
{wait_time} - Estimated wait
{time} - Reservation time
{date} - Reservation date
{order_number} - Order ID
{restaurant_name} - Business name
{restaurant_phone} - Phone number
```

---

## UI/UX Specifications

### SMS Dashboard

```
+------------------------------------------------------------------+
| MESSAGING                                                        |
+------------------------------------------------------------------+
| RECENT CONVERSATIONS                         [+ New Message]     |
+------------------------------------------------------------------+
| Search: [_________________________]                              |
+------------------------------------------------------------------+
|                                                                  |
| +--------------------------------------------------------------+|
| | John Smith (555) 123-4567                      5 min ago     ||
| | "On my way!" ← Guest reply                                   ||
| | You: "Your table is ready! Please see the host."             ||
| +--------------------------------------------------------------+|
|                                                                  |
| +--------------------------------------------------------------+|
| | Sarah Johnson (555) 234-5678                    15 min ago   ||
| | You: "Your order #1234 is ready for pickup!"                 ||
| | ✓ Delivered                                                  ||
| +--------------------------------------------------------------+|
|                                                                  |
| +--------------------------------------------------------------+|
| | Mike Williams (555) 345-6789                    1 hr ago     ||
| | You: "Reminder: Reservation for 4 tomorrow at 7:00 PM"       ||
| | ✓ Delivered                                                  ||
| +--------------------------------------------------------------+|
|                                                                  |
+------------------------------------------------------------------+
| QUICK SEND: [Waitlist ▼]  [Select Guest ▼]  [Template ▼] [Send] |
+------------------------------------------------------------------+
```

### Conversation View

```
+------------------------------------------------------------------+
| CONVERSATION: John Smith                              [Close]    |
| (555) 123-4567                                                   |
+------------------------------------------------------------------+
|                                                                  |
| Today, 5:30 PM                                                   |
| +----------------------------------------------------------+    |
| | You: Hi John! You've been added to our waitlist.          |    |
| | Party of 4, estimated wait ~20 minutes. We'll text         |    |
| | when your table is ready!                                  |    |
| +----------------------------------------------------------+    |
|                                                                  |
| Today, 5:48 PM                                                   |
| +----------------------------------------------------------+    |
| | John: Is it much longer?                                   |    |
| +----------------------------------------------------------+    |
|                                                                  |
| Today, 5:50 PM                                                   |
| +----------------------------------------------------------+    |
| | You: Almost there! About 5 more minutes. Thanks for        |    |
| | your patience!                                             |    |
| +----------------------------------------------------------+    |
|                                                                  |
| Today, 5:55 PM                                                   |
| +----------------------------------------------------------+    |
| | You: Your table is ready! Please see the host.             |    |
| +----------------------------------------------------------+    |
|                                                                  |
| Today, 5:57 PM                                                   |
| +----------------------------------------------------------+    |
| | John: On my way!                                           |    |
| +----------------------------------------------------------+    |
|                                                                  |
+------------------------------------------------------------------+
| Type message: [________________________________] [Send]          |
| [Templates ▼]                                                    |
+------------------------------------------------------------------+
```

### Template Manager

```
+------------------------------------------------------------------+
| MESSAGE TEMPLATES                              [+ New Template]  |
+------------------------------------------------------------------+
| Category: [All ▼]                                                |
+------------------------------------------------------------------+
|                                                                  |
| WAITLIST                                                         |
| +--------------------------------------------------------------+|
| | Table Ready                                        [Edit]    ||
| | "Your table is ready at {restaurant_name}! Please see..."    ||
| +--------------------------------------------------------------+|
| | Wait Update                                        [Edit]    ||
| | "Update: We're running about {wait_time} minutes behind..."  ||
| +--------------------------------------------------------------+|
|                                                                  |
| RESERVATIONS                                                     |
| +--------------------------------------------------------------+|
| | Confirmation                                       [Edit]    ||
| | "Confirmed! {party_size} guests on {date} at {time}..."      ||
| +--------------------------------------------------------------+|
| | Reminder                                           [Edit]    ||
| | "Reminder: Your reservation for {party_size} is tomorrow..." ||
| +--------------------------------------------------------------+|
|                                                                  |
| ONLINE ORDERS                                                    |
| +--------------------------------------------------------------+|
| | Order Ready                                        [Edit]    ||
| | "Your order #{order_number} is ready for pickup!"            ||
| +--------------------------------------------------------------+|
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### SMS Messages
```sql
sms_messages {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Participants
  phone_number: VARCHAR(20)
  guest_id: UUID (FK, nullable)
  direction: VARCHAR(10) (outbound, inbound)

  -- Content
  message_body: TEXT
  template_id: UUID (FK, nullable)

  -- Context
  context_type: VARCHAR(50) (waitlist, reservation, order, marketing, manual)
  context_id: UUID (nullable) -- Related entity ID

  -- Delivery
  provider_message_id: VARCHAR(100)
  status: VARCHAR(50) (queued, sent, delivered, failed, received)
  sent_at: TIMESTAMP (nullable)
  delivered_at: TIMESTAMP (nullable)
  failed_reason: VARCHAR(200) (nullable)

  -- Staff
  sent_by: UUID (FK, nullable) -- NULL for automated

  created_at: TIMESTAMP
}
```

### SMS Templates
```sql
sms_templates {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  category: VARCHAR(50)
  message_body: TEXT
  variables: VARCHAR[] -- List of variables used

  is_active: BOOLEAN DEFAULT true
  is_system: BOOLEAN DEFAULT false -- Built-in templates

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### SMS Opt-Ins
```sql
sms_opt_ins {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  phone_number: VARCHAR(20)
  guest_id: UUID (FK, nullable)

  opted_in: BOOLEAN DEFAULT true
  opted_in_at: TIMESTAMP
  opted_out_at: TIMESTAMP (nullable)

  opt_in_source: VARCHAR(50) (waitlist, reservation, website, etc.)
  opt_out_source: VARCHAR(50) (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP

  UNIQUE (location_id, phone_number)
}
```

### SMS Campaigns
```sql
sms_campaigns {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(200)
  message_body: TEXT

  -- Targeting
  recipient_type: VARCHAR(50) (all, segment, list)
  recipient_count: INTEGER

  -- Scheduling
  scheduled_at: TIMESTAMP (nullable)
  sent_at: TIMESTAMP (nullable)

  -- Stats
  messages_sent: INTEGER DEFAULT 0
  messages_delivered: INTEGER DEFAULT 0
  messages_failed: INTEGER DEFAULT 0

  -- Status
  status: VARCHAR(50) (draft, scheduled, sending, sent, cancelled)

  created_by: UUID (FK)
  created_at: TIMESTAMP
}
```

### SMS Settings
```sql
sms_settings {
  location_id: UUID PRIMARY KEY (FK)

  -- Provider
  provider: VARCHAR(50) DEFAULT 'twilio'
  provider_phone_number: VARCHAR(20)

  -- Compliance
  quiet_hours_start: TIME DEFAULT '21:00'
  quiet_hours_end: TIME DEFAULT '09:00'
  rate_limit_per_hour: INTEGER DEFAULT 100

  -- Features
  two_way_enabled: BOOLEAN DEFAULT true
  auto_responses_enabled: BOOLEAN DEFAULT true

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Messages
```
POST   /api/sms/send
GET    /api/sms/messages
GET    /api/sms/conversations/{phone}
POST   /api/sms/conversations/{phone}/reply
```

### Templates
```
GET    /api/sms/templates
POST   /api/sms/templates
PUT    /api/sms/templates/{id}
DELETE /api/sms/templates/{id}
```

### Campaigns
```
GET    /api/sms/campaigns
POST   /api/sms/campaigns
PUT    /api/sms/campaigns/{id}
POST   /api/sms/campaigns/{id}/send
DELETE /api/sms/campaigns/{id}
```

### Opt-Ins
```
GET    /api/sms/opt-ins
POST   /api/sms/opt-in
POST   /api/sms/opt-out
GET    /api/sms/opt-ins/check?phone={phone}
```

### Webhooks (from provider)
```
POST   /api/sms/webhooks/inbound
POST   /api/sms/webhooks/status
```

---

## Business Rules

1. **Opt-In Required:** Only send to opted-in numbers
2. **STOP Processing:** Immediately honor opt-out requests
3. **Quiet Hours:** No messages during configured quiet hours
4. **Rate Limiting:** Prevent spam with rate limits
5. **Delivery Tracking:** Track all message statuses

---

## Permissions

| Action | Host | Server | Manager | Admin |
|--------|------|--------|---------|-------|
| Send individual messages | Yes | No | Yes | Yes |
| View conversations | Yes | No | Yes | Yes |
| Manage templates | No | No | Yes | Yes |
| Send campaigns | No | No | Yes | Yes |
| View reports | No | No | Yes | Yes |
| Configure settings | No | No | No | Yes |

---

## Configuration Options

```yaml
sms:
  provider: "twilio"

  automation:
    waitlist_added: true
    waitlist_ready: true
    reservation_confirmation: true
    reservation_reminder: true
    order_ready: true

  compliance:
    quiet_hours_start: "21:00"
    quiet_hours_end: "09:00"
    rate_limit_per_hour: 100
    require_opt_in: true

  two_way:
    enabled: true
    auto_responses: true
    notify_staff_on_reply: true
```

---

## Open Questions

1. **Provider Selection:** Twilio, MessageBird, or other?

2. **MMS Support:** Send images (e.g., receipt photos)?

3. **Short Codes:** Use dedicated short code vs long code?

4. **International:** Support international numbers?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Provider selection
- [ ] Template content

### Development
- [ ] Provider integration
- [ ] Send functionality
- [ ] Conversation view
- [ ] Templates
- [ ] Campaigns
- [ ] Opt-in management
- [ ] Webhooks

---

*Last Updated: January 27, 2026*
