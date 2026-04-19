# Pre-Launch Security Checklist — Android Update System

**Owner:** operations team
**Completion gate:** before first PRODUCTION channel promotion
**Related:** Task #13 (R2 token rotation), `ANDROID-UPDATE-RUNBOOK.md` §7

---

## 1. R2 token rotation

**Why:** A short-lived R2 token (`android-artifact-upload`) was provisioned 2026-04-17 during Phase 3 and shared across 4 CI pipelines. Pre-production, rotate to a fresh token before opening to non-DEV venues.

### 1.1 Pre-rotation verification

- [ ] Confirm ALL four app repos can currently register a release:
  - [ ] gwi-android-register (last known green: v1.7.1 at 2026-04-18)
  - [ ] gwi-pax-a6650 (last known green: v1.2.1)
  - [ ] gwi-kds-android (last known green: v1.1.1)
  - [ ] gwi-cfd (last known green: v1.1.1)
- [ ] Confirm both MC and gwi-pos Vercel projects can read the current R2 env (hit `/api/admin/android/releases` with any auth; should list without 5xx).

### 1.2 Rotation

- [ ] Cloudflare R2 dashboard → API tokens → **Create token**
  - Name: `android-artifact-upload-rotation-YYYYMMDD`
  - Permissions: Object Read & Write on bucket `gwi-pos-artifacts`
  - Expiry: none (or ≥ 12 months)
- [ ] Record new `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` in a secure vault
- [ ] Sanity-test from local shell:
  ```
  AWS_ACCESS_KEY_ID=<new-id> AWS_SECRET_ACCESS_KEY=<new-secret> \
    aws s3 ls s3://gwi-pos-artifacts \
    --endpoint-url https://45325ffd511728b7bbb7089379193b96.r2.cloudflarestorage.com
  ```
  → expect listing success

### 1.3 Distribute (use `printf`, NOT `echo` — trailing-newline bug)

**Vercel — gwi-pos:**
- [ ] `printf '%s' "<new-id>" | vercel env add R2_ACCESS_KEY_ID production`
- [ ] `printf '%s' "<new-secret>" | vercel env add R2_SECRET_ACCESS_KEY production`
- [ ] Redeploy: `vercel --prod` (or via dashboard)

**Vercel — gwi-mission-control:**
- [ ] Same two env vars with `printf '%s'`
- [ ] Redeploy

**GitHub org secrets** (all four app repos share via org-level secrets):
- [ ] `gh secret set R2_ACCESS_KEY_ID --org GetwithitMan --body "<new-id>"`
- [ ] `gh secret set R2_SECRET_ACCESS_KEY --org GetwithitMan --body "<new-secret>"`
  - Or via GitHub web UI: Settings → Secrets → Actions (org level)

### 1.4 Validate post-rotation

- [ ] Tag a no-op release on register: `git tag v0.0.0-r2-rotation-test origin/main && git push origin v0.0.0-r2-rotation-test`
  - [ ] Expect CI workflow green
  - [ ] Expect R2 HEAD of new artifact returns 200
  - [ ] Expect MC registered new release
  - Delete the tag after: `git tag -d v0.0.0-r2-rotation-test && git push origin :v0.0.0-r2-rotation-test`

### 1.5 Revoke old token

- [ ] Wait 24h post-rotation with no CI failures
- [ ] Cloudflare R2 dashboard → find old `android-artifact-upload` token → **Revoke**
- [ ] Re-run one CI to confirm nothing was secretly pinned to old token

---

## 2. `FLEET_CI_HMAC_SECRET` rotation (optional — only if compromised)

The current value was rotated 2026-04-17 after the initial leak and has not been exposed since. Leave alone unless a new incident requires rotation.

If rotation is needed, follow runbook §7.2.

---

## 3. Per-NUC `SERVER_API_KEY` audit

For each venue NUC connected to the fleet:

- [ ] List current keys in MC admin UI → **Servers** → venue
- [ ] Confirm no shared keys across multiple venues (each NUC must have a unique key)
- [ ] Age-audit: any key issued >12 months ago without rotation should be flagged
- [ ] Rotate as needed via **Rotate API key** action (both updates MC + the NUC's `/opt/gwi-pos/.env`)

---

## 4. Signing keystore

- [ ] `gwi-pos-release.jks` stored securely (passphrase `BlueUnicorn0404*`, alias `gwi-pos`)
- [ ] Same keystore present in GitHub secrets for all four app repos as `KEYSTORE_BASE64`
- [ ] Cert SHA-256 at MC-registered releases matches `9DCB7DDEF046C61DDCCC49C9809C9FBC740795AD633B0A813CB3DE7E15255CFC`
- [ ] **DO NOT rotate** without a multi-signer bridge release (runbook §7.4)

---

## 5. Fleet database audit

- [ ] No orphaned `Terminal.deviceToken` rows for decommissioned devices (Task #23 now auto-resets these, but legacy rows still exist in DB)
- [ ] `Release` rows with null `gitCommitSha` flagged for review (suggest: pre-Phase-3 releases)
- [ ] `AndroidChannelPin` rows point to releases that still exist in R2 (stale pin detection)

Runnable:
```sql
-- on MC DB
SELECT r.id, r.appKind, r.versionCode, r.r2Key
FROM "Release" r
LEFT JOIN "AndroidChannelPin" p ON p.releaseId = r.id
WHERE p.id IS NOT NULL
  AND r.gitCommitSha IS NULL;
```

---

## 6. Reaper liveness

- [ ] `reaper_last_tick` row/metric updated within the last 5 min
- [ ] If stale, investigate MC `src/server/android-reaper.ts` — reaper reconciles `missingHeartbeat`, `lastUpdateStatus = STALE`, and venue `venueHealth`; its absence means stale dashboards

---

## 7. Sign-off

When all sections above are checked:

- [ ] **Operations sign-off:** ______________________ (name, date)
- [ ] **Engineering sign-off:** ______________________ (name, date)

Only after both signatures: promote first venue beyond DEV.

---

## Notes

- This checklist is NOT blocking for DEV canary validation. Only required before PRODUCTION promotion.
- Runbook §7 has fuller procedures for each rotation; this checklist is the tactical punch-list.
- If any step fails, stop — do not work around. Rotations are sensitive; a half-done state is worse than the starting state.
