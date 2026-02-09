# Go-Live & Launch Readiness -- Changelog

## Session: 2026-02-09

### Domain Created
- Created Go-Live domain (Domain 23)
- Trigger: `PM Mode: Go-Live`
- Created `/docs/domains/GO-LIVE-DOMAIN.md` -- comprehensive domain doc
- Created `/docs/skills/239-GO-LIVE-LAUNCH-READINESS.md` -- skill doc
- Updated SKILLS-INDEX.md with Skill 246 entry
- Updated CLAUDE.md Domain Registry with Domain 23
- Documented three location modes: Development, Training, Production

### Known Simulated/Dev Items to Clean
- `src/lib/datacap/simulated-defaults.ts` -- SIMULATED_DEFAULTS for merchantId/operatorId
- `PaymentReader.communicationMode = 'simulated'` in dev DB
- `settings.payments.processor = 'simulated'` in dev DB
- Demo credentials: PIN 1234 (Manager), 2345 (Server), 3456 (Bartender)
- Debug console.logs throughout codebase
- Dev-only routes: `/rnd/*`, `/test-floorplan`

### Files Created
- `/docs/domains/GO-LIVE-DOMAIN.md`
- `/docs/changelogs/GO-LIVE-CHANGELOG.md`
- `/docs/skills/239-GO-LIVE-LAUNCH-READINESS.md`

### Files Modified
- `/docs/skills/SKILLS-INDEX.md` -- added Skill 246
- `/CLAUDE.md` -- added Domain 23 to registry + domain section

### Resume
1. Say: `PM Mode: Go-Live`
2. Review this changelog
3. Build training mode infrastructure (schema + UI)
4. Build go-live verification CLI tool (`scripts/go-live-check.ts`)
5. Create search-and-cleanup scripts for simulated code removal
