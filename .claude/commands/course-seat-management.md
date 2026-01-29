# Course & Seat Management (Skill 76)

Organize orders by seat number and course for fine dining service.

## Overview

Course and seat management allows servers to assign items to specific seats and courses, enabling coordinated kitchen firing and accurate guest billing.

## Seat Assignment

### Assigning Seats to Items
1. Add item to order
2. Click item in order panel
3. Select seat number (1-12)
4. Item shows seat badge

### Seat Display
- Items grouped by seat in order panel
- Seat numbers shown on KDS tickets
- Split check can separate by seat

### Auto-Increment Seats
- Enable in order settings
- Each new item gets next seat number
- Resets when starting new order

## Course Management

### Course Numbers
| Course | Typical Items |
|--------|---------------|
| 1 | Appetizers, Soup, Salad |
| 2 | Main Course, Entrees |
| 3 | Dessert, Coffee |

### Assigning Courses
1. Add items to order
2. Click item to edit
3. Select course number
4. Items group by course

### Hold & Fire

**Hold Course:**
- Items held until explicitly fired
- Shows "HELD" badge on item
- Kitchen doesn't receive until fired

**Fire Course:**
1. Select course to fire
2. Click "Fire Course" button
3. All items in course sent to kitchen
4. Items show "FIRED" status

### Course Timing
- Track time between courses
- KDS shows course number
- Coordinate multi-course meals

## POS Controls

### Order Panel Buttons
- **Seat**: Assign/change seat number
- **Course**: Assign/change course
- **Hold**: Hold item from kitchen
- **Fire**: Send held items

### Course Overview Panel
- Shows all courses at a glance
- Items grouped by course number
- Quick fire buttons per course
- Status indicators (held, fired, complete)

## KDS Display

### Ticket Header
```
Table 5 | Seat 2 | Course 1
```

### Item Grouping
- Items grouped by seat
- Course number shown
- Fire time displayed
- Held items highlighted

## API Endpoints

### Update Item Seat/Course
```
PATCH /api/orders/[orderId]/items/[itemId]
{
  "seatNumber": 2,
  "courseNumber": 1
}
```

### Fire Course
```
POST /api/orders/[orderId]/fire-course
{
  "courseNumber": 2
}
```

### Hold Item
```
PATCH /api/orders/[orderId]/items/[itemId]
{
  "isHeld": true
}
```

## Database Fields

### OrderItem
```prisma
model OrderItem {
  seatNumber    Int?
  courseNumber  Int?
  isHeld        Boolean @default(false)
  firedAt       DateTime?
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/components/orders/SeatCourseHoldControls.tsx` | Seat/course controls |
| `src/components/orders/CourseOverviewPanel.tsx` | Course overview display |
| `src/app/api/orders/[id]/items/[itemId]/route.ts` | Item update API |
| `src/app/api/orders/[id]/fire-course/route.ts` | Fire course API |
