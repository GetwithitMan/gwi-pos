# Monument Steakhouse — On-Site Validation Checklist

**Purpose:** close the real-hardware validation gap left by Task #23 (stale-token recovery) and any related PR that could not be E2E-tested remotely.

**When:** next scheduled site visit.

**Estimated on-site time:** 5 min for register validation + 3 min per CFD device for fresh-pair cycle.

---

## 1. Register stale-token recovery — device .61 (primary)

Device state before you start:
- Upgraded to `com.gwi.register` **v1.7.1** (versionCode 16) via ADB install
- Paired to Monument NUC, but the stored device token is suspected stale (predates Monument NUC migration)
- App is sitting on the PIN login screen
- Neither PIN 8888 (owner) nor 111111 (Bartender MGR) should have been entered since upgrade

Success criteria:
- After 3 device-side update polls that each hit the NUC's `device_token_unknown` 401, the app clears its stored token, sets `needsPairing`, halts update polling, and routes to the pairing screen with the message **"This device needs to be re-paired with the store server."**
- Operator enters a fresh activation code (issued from MC admin UI → Monument → Devices → Issue activation code)
- After successful pair, `needsPairing` clears and update polling resumes with 200s
- Within 1 poll cycle (≤1h), MC fleet dashboard shows .61 at the newly-paired token and on channel DEV (no pinned release for v1.7.1 yet → device reports CHECKED, no OFFERED)

Steps:

- [ ] Tap screen to wake; confirm PIN screen shows
- [ ] Enter PIN `111111` (Bartender MGR) — six digits; tap Login
- [ ] Stay logged in; let the app sit for ~15 min — do not force-close
- [ ] Expected: within the 15-min window, three tier-3 update polls fire (first on login, second ~5 min later if connectivity stays up, third ~5 min after that)
- [ ] After the third 401 with `device_token_unknown`, the app MUST show the pairing screen with the blocking message. Take a photo.
- [ ] If the blocking message does NOT appear within 20 min, capture `adb logcat` to a file — something in the tracker is not firing and that needs code investigation
- [ ] Issue a new activation code in MC admin UI for .61
- [ ] Enter code on the pairing screen; tap Pair
- [ ] Confirm app reaches login screen again; log in with any PIN
- [ ] Wait ~5 min for the post-pair update poll; it must return 200 (no recovery re-trigger)
- [ ] Check MC fleet dashboard: .61's row shows `lastCheckAt` within the last 5 min, `lastUpdateStatus=OK`

If the test passes: Task #23 fully closed for register.
If the test fails: capture `adb logcat -b all -d` output + NUC `docker logs --since 30m gwi-pos | grep android-update-proxy`, and file a follow-up.

### Optional — devices .62 and .63

If time permits, repeat steps on .62 and .63. Same flow, same success criteria. Three successes is a better proof than one.

---

## 2. CFD fresh-pair — device .19

Device state before you start:
- CFD on `com.gwi.cfd` **v1.0.0** (code 1) — current state
- Cert mismatch blocks in-place upgrade (see `android-fleet-migration-gotchas.md` rule #1)

This is NOT a stale-token recovery test (uninstall wipes the token). It's a fresh-pair proof for v1.1.1.

Steps:

- [ ] On your laptop: `adb connect 172.16.1.19:<connect-port>` (check MC admin UI if port unknown — requires wireless-debugging pairing that's already set up)
- [ ] `adb -s 172.16.1.19:<port> uninstall com.gwi.cfd` → expect `Success`
- [ ] `adb -s 172.16.1.19:<port> install /tmp/gwi-apks/cfd-1.1.1.apk` → expect `Success`
- [ ] Launch CFD app (may auto-start on reboot; if not: `adb ... shell am start -n com.gwi.cfd/...`)
- [ ] Pairing screen should appear — enter a fresh activation code from MC admin UI
- [ ] Confirm pair completes; app shows CFD idle/ready screen
- [ ] Monument NUC `docker logs --since 2m gwi-pos | grep android-update-proxy` → expect at least one `outcome:"miss"` entry (CFD polled `/api/android/update/latest` successfully)
- [ ] MC fleet dashboard: .19 row shows `lastCheckAt` within last 5 min, `installedVersionCode=3`

If the test passes: Phase 9 CFD validated end-to-end at Monument (minus auto-install which is still deferred to the kiosk-lockdown phase).

---

## 3. PAX A6650 — device .65

Not blocking today. Needs wireless debugging enabled at the device first (Developer Options → Wireless debugging ON, PAX admin PIN may be required — default `9876`).

Once wireless debugging is on:

- [ ] Collect pairing code + connect port from the Wireless debugging screen
- [ ] `adb pair 172.16.1.65:<pair-port> <code>`
- [ ] `adb connect 172.16.1.65:<connect-port>`
- [ ] `adb -s 172.16.1.65:<port> install -r /tmp/gwi-apks/pax-1.2.1.apk` — if cert-mismatch, uninstall first
- [ ] Walk through the same register-style validation (login, wait 15 min, verify reset-to-pairing), using PAX admin PIN
- [ ] If PAX v1.2.1 still has versionCode=1 (CI-fetch-depth fix not deployed), it won't register in MC — coordinate with remote team to retag v1.2.1 AFTER `gwi-pax-a6650 PR #5` merges

---

## 4. Reporting

After the visit, attach to the Task #23 closing notes:
- Photo of register .61 on the pairing screen with the blocking message (success) OR `adb logcat` dump (failure)
- Monument NUC `docker logs --since 1h gwi-pos | grep android-update-proxy` — dump to file, attach
- MC fleet dashboard screenshot showing .61's post-pair state

If everything passes, close the open real-hardware items on Task #23 / Task #15 / Task #20. If anything fails, file a follow-up task with the captured evidence.
