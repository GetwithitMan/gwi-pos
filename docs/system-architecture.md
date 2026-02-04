# GWI POS - System Architecture (Domain Map)

## Overview

The GWI POS system is organized into **8 major domains**, each with clear boundaries and responsibilities. Domains communicate through **Bridge Interfaces** — they never reach into each other's internals.

---

## Domain Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GWI POS SYSTEM                               │
│                                                                      │
│  ┌───────────────────────┐       ┌───────────────────────┐          │
│  │   FLOOR PLAN DOMAIN   │       │  ORDER MGMT DOMAIN    │          │
│  │                       │       │                       │          │
│  │  L1  Floor Canvas     │       │  O1 Tickets           │          │
│  │  L2  Tables/Objects   │◄─────►│  O2 Items             │          │
│  │  L3  Seats            │ Bridge│  O3 Modifiers/Courses │          │
│  │  L4  Groups           │  API  │  O4 Split/Transfer    │          │
│  │  L5  Admin/Blueprint  │       │  O5 Payments          │          │
│  │  L6  Staff/Roles      │       │  O6 Kitchen Display   │          │
│  │  L7  Status Engine    │       │  O7 Bar Integration   │          │
│  │  L8  Entertainment    │       │  O8 Pricing Engine    │          │
│  │  L9  Waitlist         │       │  O9 Print/Receipt     │          │
│  │                       │       │  O10 Analytics        │          │
│  └───────────────────────┘       └───────────────────────┘          │
│                                                                      │
│  ┌───────────────────────┐       ┌───────────────────────┐          │
│  │   MENU DOMAIN         │       │  INVENTORY DOMAIN     │          │
│  │                       │       │                       │          │
│  │  M1 Categories        │       │  I1 Stock Tracking    │          │
│  │  M2 Items             │       │  I2 Purchase Orders   │          │
│  │  M3 Modifiers         │       │  I3 Waste/Spoilage    │          │
│  │  M4 Pricing Rules     │       │  I4 Recipe Costing    │          │
│  │  M5 Availability      │       │  I5 Par Levels        │          │
│  │  M6 Specials/LTOs     │       │  I6 Vendor Mgmt       │          │
│  │  M7 Menu Scheduling   │       │  I7 Bottle Tracking   │          │
│  └───────────────────────┘       └───────────────────────┘          │
│                                                                      │
│  ┌───────────────────────┐       ┌───────────────────────┐          │
│  │   EMPLOYEE DOMAIN     │       │  REPORTING DOMAIN     │          │
│  │                       │       │                       │          │
│  │  E1 Employee Profiles │       │  R1 Sales Reports     │          │
│  │  E2 Scheduling        │       │  R2 Labor Reports     │          │
│  │  E3 Time Clock        │       │  R3 Inventory Reports │          │
│  │  E4 Payroll Hooks     │       │  R4 Trend Analysis    │          │
│  │  E5 Certifications    │       │  R5 Shift Summaries   │          │
│  │  E6 Performance       │       │  R6 Tax Reports       │          │
│  │                       │       │  R7 Custom Dashboards │          │
│  └───────────────────────┘       └───────────────────────┘          │
│                                                                      │
│  ┌───────────────────────┐       ┌───────────────────────┐          │
│  │   GUEST DOMAIN        │       │  HARDWARE DOMAIN      │          │
│  │                       │       │                       │          │
│  │  G1 Guest Profiles    │       │  H1 POS Terminals     │          │
│  │  G2 Loyalty Program   │       │  H2 Kitchen Printers  │          │
│  │  G3 Reservations      │       │  H3 Receipt Printers  │          │
│  │  G4 Feedback/Reviews  │       │  H4 Card Readers      │          │
│  │  G5 Allergen Tracking │       │  H5 Cash Drawers      │          │
│  │  G6 Visit History     │       │  H6 Tablets/Handhelds │          │
│  │  G7 Marketing Opt-in  │       │  H7 KDS Screens       │          │
│  │                       │       │  H8 Digital Signage   │          │
│  └───────────────────────┘       └───────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Domain Responsibilities

| Domain | Answers | Does NOT Handle |
|--------|---------|-----------------|
| **Floor Plan** | WHERE is everything? WHO is responsible? | What was ordered, payment |
| **Orders** | WHAT was ordered? HOW is it being paid? | Table positions, staff sections |
| **Menu** | WHAT can be ordered? At WHAT price? | Stock levels, order history |
| **Inventory** | HOW MUCH do we have? WHAT did it cost? | Menu display, pricing |
| **Employee** | WHO works here? WHEN do they work? | What tables they have right now |
| **Reporting** | HOW is the business doing? | Real-time operations |
| **Guest** | WHO are our customers? WHAT do they like? | Current table status |
| **Hardware** | HOW do we connect to devices? | Business logic |

---

## Build Priority

```
Priority 1 (NOW):     Floor Plan Domain (Layers 1-9)
Priority 2 (NEXT):    Order Management Domain (O1-O5 minimum)
Priority 3 (THEN):    Menu Domain (M1-M4 minimum)
Priority 4 (THEN):    Kitchen Display (O6) + Hardware (H1-H4)
Priority 5 (LATER):   Everything else
```

---

## Domain Status Board

```
DOMAIN          SPEC CREATED    PM ASSIGNED    STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Floor Plan      [x]             [ ]            In Progress
Orders          [ ]             [ ]            Not Started
Menu            [ ]             [ ]            Not Started
Inventory       [ ]             [ ]            Not Started
Employee        [ ]             [ ]            Not Started
Reporting       [ ]             [ ]            Not Started
Guest           [ ]             [ ]            Not Started
Hardware        [ ]             [ ]            Not Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Cross-Domain Communication

Domains NEVER import from each other directly. They communicate through **Bridge Interfaces** defined in `/docs/domain-bridges.md`.

```
Floor Plan ──── Bridge ──── Orders
Orders ──────── Bridge ──── Menu
Orders ──────── Bridge ──── Hardware (KDS, Printers)
Menu ────────── Bridge ──── Inventory
Employee ────── Bridge ──── Floor Plan (staff roles)
Guest ───────── Bridge ──── Floor Plan (waitlist)
Reporting ───── Bridge ──── All (read-only)
```

Each bridge has:
1. A **contract document** defining the interface
2. **Integration tests** verifying both sides work
3. **Versioning** so changes are tracked

---

## File Structure

```
docs/
  system-architecture.md       ← This file (Architect owns)
  domain-bridges.md            ← Bridge interfaces (Architect owns)
  build-roadmap.md             ← Build priorities (Architect owns)

  domains/
    floorplan/
      spec.md                  ← Floor Plan PM owns
      status.md
      change-log.md

    orders/
      spec.md                  ← Orders PM owns
      status.md
      change-log.md

    menu/
      spec.md                  ← Menu PM owns
      ...

src/
  domains/
    floor-plan/               ← Floor Plan code
    orders/                   ← Orders code
    menu/                     ← Menu code
    ...

  shared/
    bridges/                  ← Bridge type definitions (Architect owns)
      floorplan-orders/
      orders-menu/
      ...
```

---

## Rules

1. **Domains are isolated.** No domain imports from another domain's internals.
2. **Bridges are contracts.** Both sides implement their half of the interface.
3. **Architect owns bridges.** Domain PMs cannot modify bridge interfaces without Architect approval.
4. **Each domain has one PM.** The PM owns the spec and manages the layers within.
5. **Build in order.** Don't start a domain until its dependencies exist.
