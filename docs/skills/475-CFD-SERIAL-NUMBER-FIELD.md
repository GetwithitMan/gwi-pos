# Skill 475 — CFD Serial Number Field

**Date:** 2026-03-02
**Repo affected:** `gwi-pos`
**Commit:** `e51a05f` — add cfdSerialNumber field to Terminal model

---

## What Was Done

Added `cfdSerialNumber` to the Terminal model so that paired PAX A3700 CFD devices can be identified by their hardware serial number.

### Schema Change (`prisma/schema.prisma`)

```prisma
model Terminal {
  // ... existing fields
  cfdSerialNumber  String?   // PAX A3700 hardware serial
}
```

### Migration (`scripts/nuc-pre-migrate.js`)

New idempotent SQL case:
```sql
ALTER TABLE Terminal ADD COLUMN cfdSerialNumber TEXT;
```

### Route Updates

**`POST /api/hardware/terminals/[id]/pair-cfd`:**
- Now accepts `cfdSerialNumber` in the request body
- Writes serial number during CFD pairing so the device is identifiable in the admin UI

**`GET /api/hardware/terminals/[id]`:**
- Returns `cfdSerialNumber` in the terminal response

**`PUT /api/hardware/terminals/[id]`:**
- Accepts `cfdSerialNumber` in the update body

---

## Context

This was a Phase 1 gap — the original CFD backend (Skill 461) created the Terminal↔CFD relationship but did not capture the device serial number. The serial is needed for the back-office admin page (Skill 477) to display which physical PAX device is paired to each register.
