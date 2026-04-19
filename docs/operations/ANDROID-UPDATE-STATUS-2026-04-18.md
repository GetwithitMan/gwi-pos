# Android Update System — Status Summary

**Date:** 2026-04-18
**Reporting window:** 2026-04-16 (plan approved) → today
**Next milestone:** Monument canary re-test → broader promotion

---

## What shipped

### Control plane (MC)
- Fleet release registry + channel-pin backend (Phase 1) — live at `app.thepasspos.com`
- Admin UI for Android releases, pins, devices, per-venue health (Phase 1)
- HMAC-authenticated fleet routes (`/api/fleet/android/update`, `/api/fleet/android/events`) — live
- `resolveEffectiveChannel` composes `releaseChannelTier × canaryTier → CANARY_N` (2026-04-18 fix, Task #14)
- Structured Zod forensics on events-route 400s (2026-04-18, Task #18 follow-through)

### NUC proxy (gwi-pos)
- `/api/android/update/latest` + `/api/android/update/events` live, HMAC-signing NUC→MC client, 30s-cached per-key responses, 30s rate limit on `/latest`
- Multi-token auth: cellular JWT, session JWT, terminal device token (Phase 4 fix)
- `cloudLocationId` resolution from env-first, DB-second (Phase 4 fix)
- **`device_token_unknown` stale-token signal** (2026-04-18, Task #23 NUC-side) — deployed to Monument NUC + verified via smoke test

### Android apps

| App | Shipped version | Highlights |
|-----|-----------------|------------|
| Register (`com.gwi.register`) | **v1.7.1** (code 16) | Phase 4 update subsystem, Phase 6 forced-update screen behind a default-off flag, Task #23 stale-token recovery |
| PAX A6650 (`com.gwi.pax`) | **v1.2.1** | Full update subsystem mirrored from register, safe-mode guard preserved, Task #23 recovery |
| CFD A3700 (`com.gwi.cfd`) | **v1.1.1** (code 3) | Update subsystem with log-and-defer kiosk treatment, Bearer-on-events fix, Task #23 recovery |
| KDS (pitboss/foodkds/delivery) | **v1.1.1** | Subsystem + Application-scope poller + banner UI; **auth model gap blocking validation** (Task #22) |

### Signing + distribution
- Shared release keystore (`gwi-pos-release.jks`, cert `9DCB7DDEF046C61DDCCC49C9809C9FBC740795AD633B0A813CB3DE7E15255CFC`) across all 4 apps
- GitHub-org-level secrets distributed to every app repo CI (verified 2026-04-17)
- R2 artifact hosting at `https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/android/<APP_KIND>/releases/<versionCode>/`
- All 4 apps' CI workflows: tag → build → sign → R2 upload → MC register → GitHub Release

---

## What's proven

| Claim | Evidence |
|-------|----------|
| End-to-end update loop works on register | Shaunels canary 2026-04-17: v1.6.1 → v1.6.2 → v1.6.3 via MC pin, `INSTALL_CONFIRMED` received by MC, dashboard showed convergence |
| Integrity gate rejects bad APKs | Phase 4 verification: SHA mismatch, packageName mismatch, cert mismatch all produce `INTEGRITY_FAILED` on the device and abort install |
| Stale-token recovery lands correctly on NUC | Monument NUC 2026-04-18: bogus Bearer returns `401 { code: "device_token_unknown" }`; missing Bearer returns generic `401 { error: "Authentication required" }` with no code field |
| CI → R2 → MC pipeline works for all 4 apps | Every tagged release has a green workflow + MC row + R2 artifact; verified per-app in latest tags |
| Canary tier composition resolves correctly | Post-PR #6 MC deploy: venues set to `CANARY + C1` now resolve to `CANARY_1` pin (not generic `CANARY`) |

---

## What remains (critical path)

1. **Task #23 client re-test at Monument** (in progress): Monument NUC has the new code; register/PAX/CFD release workflows for v1.7.1/v1.2.1/v1.1.1 are running as of 14:44 UTC. Once done, install APKs on Monument devices and verify 3× `device_token_unknown` → reset-to-pairing.
2. **PAX A6650 real-hardware canary**: the A6650 at Monument (.65) needs wireless-debug enabled and an update loop proof. Samsung A17 (.64) is a throwaway proxy, not a real canary.
3. **CFD real-hardware canary**: CFD at Monument (.19) needs `adb uninstall` (debug-signed lineage) + re-install + re-pair, then loop proof.
4. **Task #22 KDS auth decision + implementation**: option A (LAN-scoped auth on NUC) recommended in `docs/decisions/2026-04-18-kds-update-auth.md`. Awaiting sign-off. Est. same-day ship once approved.
5. **KDS real-hardware canary** (after #4): Monument has 4 KDS devices ready to bootstrap.

---

## What's blocked

| Blocker | Blocks | Status |
|---------|--------|--------|
| Monument release workflows in flight | Client-side Task #23 re-test | In progress, ETA ~15:04 UTC (CFD) / ~15:02 UTC (register) / ~15:12 UTC (PAX) |
| Task #22 KDS auth decision | KDS update delivery fleet-wide | Decision doc written; awaiting sign-off |
| PAX A6650 hardware wireless-debug | PAX A6650 real-hardware canary | Monument-side physical action needed on device .65 |
| CFD debug-signed lineage on Monument | CFD real-hardware canary at Monument | Needs `adb uninstall` (wipes pairing); captured in runbook §5 |

---

## Rollout policy (current)

- **DEV channel:** ship first; MC pins any new release here for smoke tests
- **CANARY_1 → CANARY_5:** staged venue cohorts; promote only when §3 canary criteria hold
- **GA:** only after the C1–C5 ladder completes
- **PRODUCTION:** only after GA holds for 24h without incident AND pre-launch security checklist signed off
- **Hold point:** no app promotes beyond DEV until one real-hardware canary succeeds for that app kind

Per-app current channel:

| App | DEV | CANARY | GA | PRODUCTION |
|-----|-----|--------|-----|------------|
| Register v1.7.0 | ✓ Shaunels | — | — | — |
| Register v1.7.1 | ship-pending | — | — | — |
| PAX v1.2.0 | ✓ (artifact only) | — | — | — |
| PAX v1.2.1 | ship-pending | — | — | — |
| KDS v1.1.1 | ✓ (blocked by Task #22) | — | — | — |
| CFD v1.1.0 | ✓ (artifact only) | — | — | — |
| CFD v1.1.1 | ship-pending | — | — | — |

---

## Open tasks (in priority order)

| # | Subject | Status | Priority |
|---|---------|--------|----------|
| 23 | Stale-token recovery (NUC + 3 clients) | in-progress — NUC shipped, clients in workflow | P0 (critical path) |
| 22 | KDS auth model decision | pending sign-off | P0 (blocks KDS validation) |
| 13 | R2 token rotation | pending (not pre-launch blocker for DEV/CANARY, required for PRODUCTION) | P1 |
| 17 | Soak monitor (Shaunels) | in-progress, ~24h remaining | P2 (auto-expires) |

Non-blocking + closed:
- #12 Phase 4 register cutover ✓
- #14 MC canary-tier composition ✓
- #15 Phase 7 PAX cutover ✓
- #16 Phase 6 forced-update screen ✓
- #18 mcStatus:400 burst investigation ✓
- #19 Phase 8 KDS wiring ✓
- #20 Phase 9 CFD wiring ✓
- #21 CFD build-artifact hygiene ✓ (PR #3 open)

---

## Related docs

- `docs/operations/ANDROID-UPDATE-RUNBOOK.md` — full operational procedures
- `docs/operations/PRE-LAUNCH-SECURITY-CHECKLIST.md` — pre-production punch list
- `docs/decisions/2026-04-18-kds-update-auth.md` — KDS auth choice A vs B
- Memory: `monument-canary-partial.md`, `android-fleet-migration-gotchas.md`

---

**Bottom line:** platform work is done. What remains is migration recovery (Task #23 client re-test) + one architectural auth choice (Task #22 KDS) + real-hardware validation for PAX/CFD/KDS. No greenfield phases left.
