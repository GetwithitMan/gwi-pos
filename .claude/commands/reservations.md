# Reservations (Skill 79)

Manage table reservations with availability, waitlist, and guest notes.

## Overview

The reservation system tracks upcoming bookings, manages table availability, handles walk-in waitlists, and integrates with the floor plan.

## Creating Reservations

### From Admin
1. Go to `/reservations`
2. Click "New Reservation"
3. Fill in details:
   - Guest name
   - Phone number
   - Date and time
   - Party size
   - Table preference (optional)
   - Special notes

### Via Phone/Walk-in
1. Use quick-add form
2. Enter essential info
3. System suggests available tables
4. Confirm booking

## Reservation Fields

| Field | Description |
|-------|-------------|
| guestName | Primary contact name |
| phone | Contact number |
| email | For confirmations |
| partySize | Number of guests |
| dateTime | Reservation date/time |
| duration | Expected duration (default: 90 min) |
| tableId | Assigned table (optional) |
| status | Pending, Confirmed, Seated, Completed, Cancelled |
| notes | Special requests, allergies |
| source | Phone, Walk-in, Online |

## Status Flow

```
Pending → Confirmed → Seated → Completed
                  ↓
              Cancelled
              No-Show
```

### Status Actions

| Status | Description | Actions |
|--------|-------------|---------|
| Pending | Not yet confirmed | Confirm, Cancel |
| Confirmed | Guest confirmed | Seat, No-Show, Cancel |
| Seated | At table | Complete |
| Completed | Visit finished | - |
| Cancelled | Booking cancelled | - |
| No-Show | Guest didn't arrive | - |

## Table Availability

### Check Availability
1. Select date and time
2. Enter party size
3. System shows available tables
4. Considers existing reservations
5. Accounts for turn time

### Turn Time
- Default: 90 minutes
- Adjustable per reservation
- Affects availability calculation

## Waitlist

### Add to Waitlist
1. Click "Add to Waitlist"
2. Enter guest name and party size
3. Guest added to queue
4. Estimated wait time shown

### Seat from Waitlist
1. Table becomes available
2. Click "Seat" on waitlist entry
3. Select table
4. Creates order for table

### Waitlist Display
- Position in queue
- Wait time
- Party size
- Table preferences

## Calendar View

### Daily View
- All reservations for selected day
- Color-coded by status
- Table assignments shown

### Weekly View
- Overview of busy times
- Capacity planning
- Identify gaps

## Notifications

### Guest Notifications
- Confirmation email/SMS
- Reminder before reservation
- Table ready notification (waitlist)

### Staff Alerts
- Upcoming reservations
- VIP guests arriving
- Large parties

## Reports

### Reservation Report
- Total reservations
- By source (phone, online)
- No-show rate
- Average party size

### Availability Report
- Utilization by time slot
- Peak hours
- Capacity optimization

## API Endpoints

### List Reservations
```
GET /api/reservations?locationId=xxx&date=2026-01-28
```

### Create Reservation
```
POST /api/reservations
{
  "locationId": "xxx",
  "guestName": "John Smith",
  "phone": "555-1234",
  "partySize": 4,
  "dateTime": "2026-01-28T19:00:00Z",
  "tableId": "table-5"
}
```

### Update Status
```
PATCH /api/reservations/[id]
{
  "status": "seated"
}
```

### Check Availability
```
GET /api/reservations/availability?locationId=xxx&date=2026-01-28&time=19:00&partySize=4
```

## Database Model

### Reservation
```prisma
model Reservation {
  id          String   @id
  locationId  String
  guestName   String
  phone       String?
  email       String?
  partySize   Int
  dateTime    DateTime
  duration    Int      @default(90)
  tableId     String?
  status      String   // pending, confirmed, seated, completed, cancelled, no_show
  notes       String?
  source      String?  // phone, walkin, online
  customerId  String?  // Link to Customer
  createdAt   DateTime
  createdBy   String?  // Employee who created
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/reservations/page.tsx` | Reservations management |
| `src/app/api/reservations/route.ts` | Reservations CRUD |
| `src/components/reservations/ReservationModal.tsx` | Create/edit form |
| `src/components/reservations/WaitlistPanel.tsx` | Waitlist display |
| `src/components/reservations/CalendarView.tsx` | Calendar view |
