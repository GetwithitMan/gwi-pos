# Feature: Reservations

> **Status: PLANNED** — Specced in `docs/skills/SPEC-25-RESERVATIONS.md`. Skill 19 (Reservations) is referenced in SKILLS-INDEX. Verify if any reservation models exist in schema.prisma before building.

## Summary
Online and phone table booking system. Guests book via a public widget or phone, receive email/SMS confirmations, and are seated from a reservation queue. Includes waitlist management, deposit collection, and no-show tracking.

## Status
`Planned` — Basic reservation reference in Skill 19 and floor plan. Full booking system not confirmed built.

## Key Capabilities (from SPEC-25)
- **Public booking widget** — embeddable on venue website
- **Time slot availability engine** — based on table capacity and turn times
- **Deposit collection** — require credit card hold or payment to confirm
- **Confirmation flow** — email + SMS confirmation with calendar invite
- **Reminder sequence** — 24h and 2h before reservation
- **No-show tracking** — automatic cancellation + fee charge after grace period
- **Capacity overbooking** — configurable percentage above physical capacity
- **Third-party integrations** — OpenTable, Resy, Yelp Reservations

## Dependencies (anticipated)
- **Customers** — guest profiles linked to reservations
- **Floor Plan** — table assignment from reservation
- **Settings** — reservation configuration, turn times, deposit amounts
- **Events** — event-specific reservation blocks
- **Payments** — deposit collection

## SPEC Document
`docs/skills/SPEC-25-RESERVATIONS.md`

*Last updated: 2026-03-03*
