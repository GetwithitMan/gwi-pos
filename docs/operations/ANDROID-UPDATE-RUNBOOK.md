# Android Update System — Operations Runbook

**Scope:** End-to-end operational procedures for the fleet-wide Android update system. Applies to register (L1400 / other), PAX A6650 handheld, CFD A3700, and KDS (pitboss/foodkds) apps.

**Plan reference:** `~/.claude/plans/cozy-shimmying-badger.md` (10 phases)
**Code boundary:** Devices poll NUC at `/api/android/update/latest` and `/api/android/update/events`. NUC proxies to MC at `/api/fleet/android/update` and `/api/fleet/android/events` (HMAC-signed). MC stores release metadata; R2 stores APK bytes.

---

## 1. Release publish flow

**Trigger:** developer tags `vX.Y.Z` on the app repo's `main` branch.

```
git tag v1.7.1 origin/main
git push origin v1.7.1
```

**Pipeline** (runs in the app's GitHub Actions):

1. Checkout tagged commit
2. Restore signing keystore from GitHub secrets (`KEYSTORE_BASE64`, `KEY_ALIAS`, `KEY_PASSWORD`, `KEYSTORE_PASSWORD` — or `STORE_PASSWORD` for CFD)
3. `./gradlew :app:assembleRelease` (or flavor-specific task for KDS)
4. Extract metadata via `aapt`: `versionCode`, `versionName`, `packageName`, `minSdk`, `targetSdk`, SHA-256, signing cert SHA-256s
5. Upload signed APK + `release.json` to R2 at `android/<APP_KIND>/releases/<versionCode>/`
6. POST to MC `/api/admin/android/releases` with the CI HMAC signature (`FLEET_CI_HMAC_SECRET` env)
7. Create GitHub Release (optional) with the APK attached

**Success signal:**
- Workflow run ends `success`
- MC response is HTTP 201 with release row: `{ id, appKind, versionCode, r2Key, artifactSha256, signingCertSha256s, … }`
- R2 URL `https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev/android/<APP_KIND>/releases/<versionCode>/app-release.apk` returns 200 on HEAD

**Failure signals:**
- Signing step fails → check `KEYSTORE_BASE64` + password secrets in repo settings
- R2 upload 403 → rotate R2 token (see §7)
- MC registration 4xx → HMAC signature mismatch (check `FLEET_CI_HMAC_SECRET`), duplicate `versionCode`, or cert mismatch
- Build hangs >30m → cancel and re-run; Gradle cache can go stale

**Appendix — APK version numbering:**
- Register: manual `versionCode` in `app/build.gradle.kts` (integer, monotonic)
- PAX: derived from git commit count (auto-bumps each commit to main)
- KDS: manual `versionCode` shared across flavors; each flavor gets `versionNameSuffix` (`-PB`, `-KDS`, `-DEL`)
- CFD: manual `versionCode` in `app/build.gradle.kts`

Cross-app IDs (`artifactSha256`, `signingCertSha256s`) must be unique per artifact; MC uses them as part of the integrity gate on device.

---

## 2. Pin/promote flow

**Channels:** `DEV`, `INTERNAL`, `CANARY`, `GA`, `PRODUCTION` (enum on MC `CloudLocation.releaseChannelTier`)
**Canary sub-tiers:** `CANARY_1…CANARY_5`, `GA` (stored separately on `CloudLocation.canaryTier`; composed on read into `CANARY_N` — see gwi-mission-control commit that landed PR #6)

### 2.1 Set a venue's channel

Admin UI: `/dashboard/organizations/<orgId>/locations/<locationId>` → scroll to **Release Channel** picker.
- Pick DEV / INTERNAL / CANARY / PRODUCTION.
- If CANARY: also pick **Canary Rollout Tier** (C1–C5 or GA).
- PATCH is immediate; next device poll (default 1h) picks up the new channel.

### 2.2 Pin a release to a channel

Admin UI: `/dashboard/releases/android` → select a registered release → **Pin to channel…** → pick channel.

Alternatively via API (HMAC-signed from CI):
```
POST /api/admin/android/channels/pin
Body: { appKind, channel, releaseId }
```

A pin becomes authoritative for every venue on that channel. Only one release can be pinned per `(appKind, channel)`.

### 2.3 Promotion ladder (recommended)

For each new release, walk the ladder:
```
DEV → CANARY_1 (one real canary venue) → CANARY_2..5 (staged) → GA (graduated) → PRODUCTION (full fleet)
```

Graduate only when the canary validation steps in §3 pass. Don't skip.

### 2.4 Emergency pin removal

Unpin a release from a channel:
```
POST /api/admin/android/channels/rollback
Body: { appKind, channel }
```

This reverts the channel to the previously-pinned release (or to "unpinned" if none). Already-installed devices stay on what they have; only devices still behind auto-update when they poll next.

---

## 3. Canary validation steps

Gate for every new release before it graduates from `CANARY_N` to `GA`:

### 3.1 Success criteria (all must hold)

- ≥1 canary venue on the pinned release for 24h+
- `promptedRelaunchRate` ≥ 95% — % of `INSTALL_PROMPTED` events followed by any subsequent device event within 24h (dip = crashes post-install or not relaunching)
- `relaunchedConfirmRate` ≥ 95% — % of relaunched devices that emit `INSTALL_CONFIRMED` matching `lastAttemptReleaseId` within 24h (dip = actual install failures)
- Zero `INTEGRITY_FAILED` events
- No mid-order prompts observed (banner suppression must work)
- No post-install crash spike (Sentry app-health)

### 3.2 Operator procedure

1. Tag release (§1) and wait for workflow green
2. Verify R2 URL HEAD returns 200
3. Verify MC release row with correct appKind / versionCode / certs
4. Pin release to `CANARY_1` on the chosen canary venue
5. Set that venue's `releaseChannelTier=CANARY + canaryTier=CANARY_1`
6. Wait for venue's device to poll (up to 1h; use the `Force check` action on the device's admin card to trigger immediately)
7. Watch `/dashboard/fleet/android-devices` — expect `installed == pinned` within one heartbeat
8. Leave in soak 24h
9. Check Sentry for any crash spike tagged with the new `release` label
10. If all criteria met, promote to `CANARY_2` (next venue cohort), repeat

### 3.3 Fail thresholds

Stop promotion and investigate:
- Any `INTEGRITY_FAILED` event → bad APK or wrong signing cert in pin metadata. Unpin. Re-examine.
- `promptedRelaunchRate < 95%` → devices crash or refuse to relaunch. Unpin. Open Sentry triage.
- `relaunchedConfirmRate < 95%` → installs silently failing. Unpin. Check OS version distribution of failing devices.
- Mid-order banner regression → code bug in `UpdatePolicy.shouldShowBanner(state, isOrderInProgress)`. File bug. Do not ship.

---

## 4. Stale-token recovery behavior

**Scenario:** Device's stored Bearer/device token is unknown to the current NUC — usually because the device was paired before a venue migration or a Terminal row was rewritten. Without recovery, device 401-loops forever.

### 4.1 What the NUC emits

`/api/android/update/latest` and `/api/android/update/events` return:
```
HTTP 401
{ "error": "Invalid token", "code": "device_token_unknown" }
```
**Only** when `authenticateAndroidUpdate(token)` returns null (all three token paths — cellular JWT, session JWT, terminal device token — fail).

Other 401 reasons keep their generic shape:
- Missing `Authorization` header → `{ "error": "Authentication required" }`
- Empty Bearer → same
These do NOT trigger recovery on the device.

### 4.2 What the device does

Per-app `StaleTokenTracker` (@Singleton, SharedPreferences-backed) with:
- Threshold: **3 consecutive** `device_token_unknown` responses
- Window: **within 15 minutes** (sliding)
- Reset: any 2xx on either update endpoint zeroes the counter

When threshold is hit:
1. `tokenProvider.clearAll()` (device token wiped)
2. `markNeedsPairing()` flag persisted to SharedPrefs
3. Update subsystem halts — no further polling until pairing completes
4. UI routes to the existing pairing screen with the blocking message:
   **"This device needs to be re-paired with the store server."**
5. Operator completes pairing at venue (activation code from MC admin UI)
6. Pairing screen clears the flag on success; update polling resumes

### 4.3 Which apps

- ✓ Register (v1.7.1+)
- ✓ PAX A6650 (v1.2.1+)
- ✓ CFD A3700 (v1.1.1+)
- ✗ KDS — NOT YET; KDS has no Bearer-token model (see Task #22 in `monument-canary-partial.md`)

### 4.4 Operator action when a device gets stuck in pairing

1. Confirm the device shows the "needs to be re-paired" message
2. Open MC admin UI → venue → **Devices** → find the terminal row
3. Click **Issue activation code** (or equivalent) — MC returns a short-lived code
4. Enter code on device pairing screen
5. Device completes pairing, resumes polling
6. Within one poll (≤1h), MC fleet dashboard shows device back on track

No need for ADB access. No need to re-install the APK.

---

## 5. Debug-signed device migration

**Scenario:** A device was installed via a debug build (pre-CI-secrets-distribution, or from a developer laptop). Its signing cert does not match the shared release keystore (`gwi-pos-release.jks`, cert SHA-256 `9DCB7DDEF046C61DDCCC49C9809C9FBC740795AD633B0A813CB3DE7E15255CFC`). Any OTA update will fail with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.

Captured in memory: `android-fleet-migration-gotchas.md` rule #1.

### 5.1 Detection

Symptoms:
- Device never updates even when a newer release is pinned
- `adb install -r <new.apk>` returns `INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package <pkg> signatures do not match`
- No `INSTALL_CONFIRMED` events for that device in MC despite pinning

### 5.2 One-time migration

On the affected device:
```
adb uninstall com.gwi.<app>    # register | pax | kds.foodkds | kds.pitboss | cfd
```

Then install the release-signed APK (either via `adb install` or by letting the update system deliver it after re-pairing).

**Data loss:** uninstall wipes pairing token, cached orders, local preferences. Operator must re-pair at venue.

### 5.3 Prevention for new devices

- Always distribute release-signed APKs for first install
- Never let developers push debug APKs to production devices
- CI keystore secrets must be in place BEFORE first CI tag (all four app repos now have them; verified 2026-04-17)

---

## 6. Rollback reality

**What rollback is NOT:**
- It does NOT automatically downgrade already-installed devices. Android won't let you install a `versionCode` lower than the installed one without an explicit uninstall.
- It does NOT retroactively un-send telemetry events.

**What rollback IS:**
- Unpinning the bad release from a channel (via `/api/admin/android/channels/rollback`) — stops new installs.
- Pinning the previous known-good release as a **new higher versionCode** hotfix, if the bad release is actively breaking devices. Bump versionCode, re-build, re-tag, pin.
- For a truly broken release (e.g., can't boot), uninstall + reinstall the previous version via ADB is the only per-device recovery. This is a physical-access operation.

**Rollback checklist when a release is misbehaving:**
1. Stop the bleeding: unpin the bad release from all channels
2. Triage: Sentry + fleet dashboard (how many devices are affected, what's the failure mode)
3. Decide: hotfix forward (bump + fix + re-tag) or rollback via uninstall (physical access)
4. If hotfix: follow §1 release publish flow with a patched commit; verify canary before promoting
5. If uninstall: dispatch ops to each affected venue. Document which devices were touched.

---

## 7. Secret rotation procedure

### 7.1 R2 token (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`)

Touches:
- Cloudflare R2 dashboard (rotation source)
- Vercel project `gwi-pos`: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- Vercel project `gwi-mission-control`: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- GitHub org secrets for CI: shared across gwi-android-register, gwi-pax-a6650, gwi-kds-android, gwi-cfd workflows

Procedure:
1. In Cloudflare R2 dashboard → API tokens → create NEW token scoped to same bucket
2. Test new token with `aws s3 ls s3://gwi-pos-artifacts --endpoint-url https://<account>.r2.cloudflarestorage.com` (success required)
3. Update Vercel env for both projects: `printf '%s' "<new-id>" | vercel env add R2_ACCESS_KEY_ID production` (use `printf`, not `echo` — see gotcha #6)
4. Trigger a redeploy for each Vercel project (dashboard → redeploy latest)
5. Update GitHub org secrets with same values
6. Trigger a CI run on each app repo to confirm (can use a no-op tag `v0.0.0-rotation-test`)
7. If all green for 24h, revoke OLD token in Cloudflare R2

Currently tracked as Task #13 — pending pre-launch.

### 7.2 `FLEET_CI_HMAC_SECRET`

Touches:
- Vercel project `gwi-mission-control`: `FLEET_CI_HMAC_SECRET`
- GitHub org secrets for `gwi-android-register`, `gwi-pax-a6650`, `gwi-kds-android`, `gwi-cfd`, `gwi-pos` — same value

Procedure:
1. Generate new secret: `openssl rand -hex 32`
2. Set in Vercel MC env (production) with `printf '%s'`
3. Redeploy MC
4. Set in each CI repo's GitHub secrets (same value)
5. Trigger a no-op tag on one app to verify CI can still register a release
6. Rotated atomically — old secret becomes invalid the moment MC redeploys. Brief window (≤ redeploy time) where CI tags will fail HMAC.

### 7.3 `SERVER_API_KEY` (per-NUC)

Each NUC has its own `SERVER_API_KEY` stored in `/opt/gwi-pos/.env` on that NUC. Used by NUC→MC HMAC for heartbeat/register/fleet-update/events. Rotation requires both:
- Updating the NUC env
- Issuing the new key via MC `ServerNode` table (admin UI: **Servers** → select NUC → **Rotate API key**)

Rotate per-NUC, not fleet-wide.

### 7.4 Signing keystore (`gwi-pos-release.jks`)

**DO NOT rotate without a multi-signer bridge release.** Rotating the keystore means a new cert SHA-256; any device with an old-cert APK will refuse to install the new-cert APK.

If rotation is ever needed (e.g., compromised keystore):
1. Build a bridge release signed by BOTH old and new keys (`apksigner sign --next-signer`)
2. Let bridge propagate to the entire fleet (100% coverage confirmed)
3. Only then start issuing single-signer releases with the new key
4. Devices accept the new cert because the old cert was acceptable at install time

Captured in the plan's "Cert rotation" verification section. Not a routine operation.

---

## 8. Hardware validation checklist

For each app, run this checklist on a real canary device before promoting beyond DEV.

### 8.1 Register (L1400)

| Check | Method | Expected |
|-------|--------|----------|
| Artifact in R2 | `curl -I <downloadUrl>` | 200 |
| MC row registered | GET `/api/admin/android/releases?appKind=REGISTER` | row with correct versionCode + sha |
| Channel pin | MC admin UI → Pin to DEV | succeeds; fleet dashboard shows venue matched |
| Device sees update | `logcat | grep UpdateClient` | `update/latest` returns 200, `upToDate:false` with release envelope |
| Install path | Tap **Update Now** on banner | `INSTALL_PROMPTED` event → system installer → app relaunches |
| Boot probe confirm | Device relaunches at new version | `INSTALL_CONFIRMED` event fires within 30s |
| Steady-state check | Wait 1h | at least one `CHECKED` poll logged; `lastUpdateStatus = OK` in MC |

Canary venue: Shaunels (proven 2026-04-17 with v1.6.1 → v1.6.2 → v1.6.3).

### 8.2 PAX A6650

Same as register, with one extra:

| Check | Method | Expected |
|-------|--------|----------|
| Safe-mode bypass | With crash-canary active, boot device | `isSafeMode=true`; UpdateBootProbe + UpdateClient both return early; no update traffic |

Canary venue: **TBD** — requires a real A6650 device. Samsung A17 (`com.gwi.pax` on stock Android) is a test-only proxy; real A6650 hardware validation is still pending.

### 8.3 CFD A3700

Same as register, minus the banner/install path (Phase 9 is log-and-defer — no auto-install UI):

| Check | Method | Expected |
|-------|--------|----------|
| Artifact in R2 | `curl -I` | 200 |
| MC row registered | GET `/api/admin/android/releases?appKind=CFD` | row present |
| Channel pin | Admin UI | succeeds |
| Device polls | `logcat | grep UpdateClient` | `update/latest` returns 200 |
| Telemetry flow | NUC container logs | `android-update-proxy outcome:"miss"` and `forward_ok` on events |
| StateFlow exposed | Compose tree | `UpdateStateRepository.state` collects new `UpdateState` values |
| **NO install** triggered | watch for ACTION_VIEW | none — kiosk-lockdown phase will wire DO silent install later |

Canary venue: **TBD** — Monument CFD (.19) requires uninstall + reinstall first (debug-signed lineage).

### 8.4 KDS (pitboss + foodkds + delivery)

**BLOCKED** until Task #22 lands (KDS auth model). Pre-auth-fix checklist can still run, but `/api/android/update/latest` returns 401 (no token to send).

When unblocked:

| Check | Method | Expected |
|-------|--------|----------|
| Artifact in R2 | `curl -I` for each appKind | 200 for KDS_PITBOSS, KDS_FOODKDS, KDS_DELIVERY |
| MC row registered | GET `/api/admin/android/releases?appKind=KDS_PITBOSS` (and others) | row present with correct versionNameSuffix (`-PB`/`-KDS`/`-DEL`) |
| Channel pin | Admin UI | succeeds per appKind |
| Device polls (post-auth-fix) | `logcat | grep UpdateClient` | 200 from `update/latest` |
| Banner render | Physical observation at KDS screen | red (required) or amber (optional) banner above FlavorContent |
| Install path | Tap Update | ACTION_VIEW install prompt |
| Boot probe confirm | Device relaunches | `INSTALL_CONFIRMED` event |

Canary venue: **TBD** — Monument KDS (.201/.202/.203/.206) ready once Task #22 ships.

---

## 9. Known limitations (honest)

- **No durable NUC event outbox.** If MC is down when a device POSTs events, NUC returns 5xx, device keeps the batch in its 50-event ring buffer. Ring-buffer overflow silently drops oldest events. SLO doesn't guarantee zero telemetry loss.
- **Install success is learned on next app launch.** Devices that never relaunch (operator abandons install, OS kill, crash) never emit `INSTALL_CONFIRMED`. `UPDATE_FAILED` is a 24h-timeout heuristic, not a live signal.
- **`minSchemaVersion` enforcement against old NUCs.** Old NUCs that don't forward `nucSchemaVersion` will receive releases even if `minSchemaVersion` would have guarded them. Runbook flag: list specific NUC server versions lacking this field before cutting a release that depends on the guard.
- **KDS is not on the Bearer-auth path.** Task #22. Until that lands, KDS devices cannot receive fleet-pushed updates.

---

## 10. Contact + escalation

- Unplanned 4xx/5xx spike on fleet dashboard → check MC Vercel runtime logs (`gwi-mission-control`), then NUC container logs (`docker logs gwi-pos --since 4h`).
- Ring-buffer overflow alerts → triage per-device, usually indicates MC outage or NUC→MC network issue.
- Repeated `INTEGRITY_FAILED` → stop all promotions, the release artifact itself is suspect. Compare on-device computed SHA vs MC's registered `artifactSha256`.
- Reaper not ticking (`reaper_last_tick` stale >5 min) → MC's `src/server/android-reaper.ts` is frozen; staleness of `lastUpdateStatus` values is suspect.

**Owner:** the team that owns `gwi-mission-control`. Related memory files:
- `android-fleet-migration-gotchas.md`
- `monument-canary-partial.md`
- `r2-artifact-hosting.md`
