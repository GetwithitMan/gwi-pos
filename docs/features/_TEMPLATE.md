# Feature: [Feature Name]

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
One paragraph describing what this feature does from a user/business perspective.

## Status
`Active` | `Beta` | `In Development` | `Planned`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | [e.g., API, admin UI, POS UI] | Full / Partial / None |
| `gwi-android-register` | [e.g., primary client] | Full / Partial / None |
| `gwi-cfd` | [e.g., payment display screens] | Full / Partial / None |
| `gwi-backoffice` | [e.g., event ingestion, reporting] | Full / Partial / None |
| `gwi-mission-control` | [e.g., fleet config push] | Full / Partial / None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | `/path/to/page` | Managers, Servers |
| Android | `ScreenName` | All staff |
| Admin | `/admin/path` | Managers only |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/[route]/` | API endpoints |
| `src/app/(pos)/[page]/` | POS UI page |
| `src/app/(admin)/[page]/` | Admin UI page |
| `src/lib/[module].ts` | Business logic |
| `src/stores/[store].ts` | Zustand state |
| `src/components/[component]/` | UI components |

### gwi-android-register
| File | Purpose |
|------|---------|
| `app/.../ui/[screen]/` | Screen |
| `app/.../viewmodel/[VM].kt` | ViewModel |
| `app/.../repository/[Repo].kt` | Repository |
| `app/.../usecase/[UC].kt` | Use case |

### gwi-cfd *(if applicable)*
| File | Purpose |
|------|---------|
| `app/.../[Screen].kt` | CFD screen |

### gwi-backoffice *(if applicable)*
| File | Purpose |
|------|---------|
| `src/[controller]/` | Controller |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/[route]` | Employee PIN | Description |
| `POST` | `/api/[route]` | Employee PIN | Description |
| `PUT` | `/api/[route]/[id]` | Manager | Description |
| `DELETE` | `/api/[route]/[id]` | Manager | Description |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `feature:action` | `{ id, ... }` | When X happens |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| `feature:response` | Android / CFD | Acknowledges Y |

---

## Data Model

Key Prisma models and fields used by this feature.

```
ModelName {
  id              String
  locationId      String      // always filter by this
  relevantField   Type
  deletedAt       DateTime?   // soft delete
}
```

---

## Business Logic

### Primary Flow
Step-by-step description of the happy path.

1. User does X
2. System does Y
3. Socket emits Z

### Edge Cases & Business Rules
- Rule 1: ...
- Rule 2: ...
- Limit: max N per location

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| [Feature] | Describe the effect |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| [Feature] | Describe the effect |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **[Feature 1]** — what invariant to check
- [ ] **[Feature 2]** — what invariant to check
- [ ] **Permissions** — does this change affect who can do what?
- [ ] **Reports** — does this change affect any report calculations?
- [ ] **Offline** — does this mutation work offline?
- [ ] **Socket** — does this change require new/updated socket events?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View | `FEATURE_VIEW` | Standard |
| Create | `FEATURE_CREATE` | High |
| Edit | `FEATURE_EDIT` | High |
| Delete | `FEATURE_DELETE` | Critical |

---

## Known Constraints & Limits
- Hard limit: ...
- Business rule: ...
- Performance note: ...

---

## Android-Specific Notes
Anything unique to the Android implementation vs web POS.

---

## Related Docs
- **Domain doc:** `docs/domains/[DOMAIN]-DOMAIN.md`
- **Architecture guide:** `docs/guides/[GUIDE].md`
- **Skills:** Skill [N]–[N] (see `docs/skills/SKILLS-INDEX.md`)
- **Changelog:** `docs/changelogs/[DOMAIN]-CHANGELOG.md`

---

*Last updated: YYYY-MM-DD*
