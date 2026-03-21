# Verification Handoff — Node Baseline Enforcement + Fleet Observability

This is not "it ran once."
I need proof the implementation is correct, safe, idempotent, reboot-safe, and does not break existing fleet behavior.

## Deliverables required back from dev

I want all of this back in one verification package:
1. A short summary of what was built vs spec.
2. Test results for every acceptance gate.
3. Exact commands run.
4. Key output files/artifacts.
5. Screenshots or pasted output for pass/fail evidence.
6. Any deviations from spec, no matter how small.
7. A list of known limitations or follow-up items.

---

## Rules for verification

- Do not mark anything "passed" without evidence.
- If something is partial, call it partial.
- If anything was changed from spec, document it clearly.
- No hand-waving like "should work" or "looks fine."
- All failures must be captured, even if rollout mode is non-fatal.

---

## Environment matrix to test

Minimum required matrix:
1. Ubuntu 22.04 GNOME
2. Ubuntu 22.04 KDE
3. Ubuntu 24.04 GNOME
4. Ubuntu 24.04 KDE

Also test:
5. Existing pre-baseline NUC upgrade path
6. Offline / MC-unreachable scenario
7. Reboot-required scenario
8. Required-if-applicable hardware scenario
9. No-hardware-present scenario
10. Legacy heartbeat compatibility scenario

---

## What I need verified

### 1. Stage 11 integration

Verify:
- installer.run includes system_hardening in STAGES
- 11-system-hardening.sh exists and is called correctly
- existing stages 1-10 are untouched in behavior
- Stage 11 can be invoked from full install and --resume-from=system_hardening

Evidence required:
- diff or commit list
- command output from fresh full install
- command output from resume-only run

Pass criteria:
- fresh install reaches Stage 11
- resume-from system_hardening works
- no regression to stages 1-10

---

### 2. Locking and run-state model

Verify:
- all execution entrypoints use same flock lock
- baseline.lock is flock-only
- metadata lives in run-state.json
- second execution blocks/fails cleanly while first is active
- stale-lock handling behaves per spec
- force unlock requires explicit command + audit entry
- reboot clears flock and verify reacquires correctly

Test cases:
1. Start Stage 11, then trigger another Stage 11
2. Start Stage 11, then trigger support run
3. Start Stage 11, simulate long-running execution >15 min warning path if possible
4. Reboot during pending_reboot path and verify lock state recovers

Evidence required:
- run-state.json before, during, after
- install event entries
- lock contention logs/output
- force unlock evidence

Pass criteria:
- no overlapping runs
- run-state transitions are correct
- lock not stranded after reboot

---

### 3. JSON schema discipline

Verify every artifact:
- includes required common fields: schema_version, producer, generated_at, node_id, baseline_version
- matches its schema in docs/schemas
- schema files exist for all listed artifacts

Artifacts to verify:
- run-state.json
- stage11-result.json
- baseline-applied.json
- policy-applied.json
- artifact-manifest.json
- hardening-status.json
- inventory.json
- drift-scan.json
- install-events.jsonl
- report-queue/*.json
- bundle-manifest.json
- ansible-result.json if treated as contract artifact

Evidence required:
- directory listing
- sample payload for each
- validation output against schema

Pass criteria:
- all present where expected
- all validate
- no missing required fields

---

### 4. Ansible JSON callback output

Verify:
- Stage 11 uses ANSIBLE_STDOUT_CALLBACK=json
- stdout goes only to ansible-result.json
- stderr goes to ansible-stderr.log
- ansible-result.json is always valid JSON
- no control flow depends on grep against human-readable logs

Evidence required:
- snippet of 11-system-hardening.sh
- sample ansible-result.json
- sample ansible-stderr.log
- exact parsing logic used to derive stage11-result.json

Pass criteria:
- ansible-result.json valid JSON every run
- role failures classified from structured output only

---

### 5. Idempotency

Verify:
- second run produces zero meaningful changes
- no required role changes on second run
- observational files may refresh only by timestamp
- stage11-result.json.changed_count = 0 for non-observational roles on second run

Test cases:
1. Fresh install then rerun Stage 11 immediately
2. Rerun after no-op reboot
3. Rerun after drift injection and remediation

Evidence required:
- first-run vs second-run summaries
- changed counts by role
- stage11-result.json from both runs

Pass criteria:
- second run clean
- only observational timestamp churn allowed

---

### 6. Required / required_if_applicable / optional behavior

Verify classification behavior exactly.

**Required** — Must verify failure classification for:
- os_hardening
- firewall
- display_manager
- sshd_hardening
- post_reboot_verify
- reboot_manager

**Required-if-applicable** — Must verify:
- if manifest says expected and device/config missing, role fails
- if manifest says not expected, role skips cleanly
- live discovery does not lower requiredness

**Optional** — Must verify:
- optional failures produce warnings, not masked success

Evidence required:
- test manifests used
- resulting role outcomes
- stage11-result.json
- run-state.json
- derived degraded state where applicable

Pass criteria:
- exact classification behavior matches spec

---

### 7. Reboot behavior

Verify:
- max 1 reboot per baseline run
- minimum 60 second grace used
- reboot_manager writes state before reboot
- verify resumes after reboot using same run-state model
- triggered_by=verify_after_reboot
- final state lands in idle or degraded
- no reboot loop

Test cases:
1. Change requiring reboot
2. Guarded reboot path with no active orders
3. Guarded reboot deferral path with active orders
4. Max 3 defer attempts then MC approval queue behavior

Evidence required:
- run-state before reboot
- reboot trigger evidence
- verify-on-boot evidence
- final hardening status
- install-events sequence

Pass criteria:
- one reboot only
- correct defer/approve behavior
- no stranded pending state

---

### 8. Guarded reboot decision logic

Because this is locked to Option C, verify:
- local /api/system/batch-status is consulted
- if no active orders in 30 minutes, guarded reboot proceeds
- if active orders exist, reboot defers
- after 3 attempts, MC approval queue path is used

Evidence required:
- exact test setup
- API responses used
- logs/events for allow vs defer
- queued approval artifact if applicable

Pass criteria:
- behavior matches decision exactly

---

### 9. Legacy migration safety

Verify pre-existing node behavior:
- pre-baseline NUC with SERVER_NODE_ID and no policy-applied.json
- inventory collector runs
- policy-applied.json created with:
  - policy_version=bootstrap-auto
  - policy_source=bootstrap-auto
- baseline-applied.json written
- node is not marked drifted immediately
- later replacement with real policy works
- bootstrap-auto does not recreate after real policy exists

Evidence required:
- before/after state files
- MC-visible result or simulated derived logic
- replacement test with real policy

Pass criteria:
- legacy nodes onboard cleanly without false drift

---

### 10. Baseline unavailable distinction

Verify both cases:

**Case A** — Node deployed before baseline existed:
- missing installer baseline content
- outcome skipped_unavailable
- no degradation

**Case B** — Node deployed after baseline existed but baseline files missing unexpectedly:
- outcome failed_required
- install state degraded

Evidence required:
- exact detection logic
- outputs for both scenarios

Pass criteria:
- distinction works exactly as spec says

---

### 11. Offline / degraded-network behavior

Verify:
- Stage 11 runs without MC
- no destructive actions blocked incorrectly
- reports queue locally
- backoff works
- queue retention works
- support bundle still works offline
- last known good policy retained
- no hard dependency on live MC for baseline execution

Test cases:
1. MC unreachable during Stage 11
2. MC unreachable during report flush
3. DNS broken
4. node offline > queue retention threshold

Evidence required:
- queue directory contents
- retry_count / next_retry_at changes
- pruning evidence
- local state updates while offline

Pass criteria:
- node still converges locally
- reporting degrades gracefully

---

### 12. Queue retention and queue schema

Verify:
- queue files use required schema
- max 50 files
- max 10 MB
- prune older than 7 days
- on overflow, oldest deleted first
- pruning is visible in logs/events, not silent

Evidence required:
- generated queue samples
- forced overflow test
- forced old-age pruning test

Pass criteria:
- retention logic works exactly as specified

---

### 13. Support tools

Verify all three tools are installed and usable:

**generate-support-bundle.sh** — Must verify:
- tarball created successfully
- contains expected files
- includes bundle-manifest.json
- secrets are redacted
- hardware fingerprint hashed for external sharing
- no DB dumps included
- log truncation enforced

**baseline-diff** — Must verify:
- human-readable output
- --json output
- detects real drift cases
- suggested fixes sane

**gwi-baseline-restore.sh** — Must verify:
- restores config snapshot only
- clearly does not claim full rollback
- usable after simulated bad config change

Evidence required:
- tool output
- tarball manifest
- redaction examples
- restore test before/after

Pass criteria:
- support can use these without dev intervention

---

### 14. Artifact manifest and version capture

Verify capture of:
- app commit SHA
- baseline version
- baseline SHA
- policy version
- installer version
- ansible-core version
- package versions for PostgreSQL, Node.js, Chromium

Evidence required:
- artifact-manifest.json
- how values are sourced
- one example from fresh install
- one example from reinstall

Pass criteria:
- all present and correct

---

### 15. Reinstall / recovery behavior

This is the part I especially want checked.

Verify reinstall does not hardcode stale targets.

I want explicit proof for:
- installer does not hardcode a schema version
- installer does not hardcode a stale deploy target
- reinstall converges to the latest approved app release for the node's rollout channel
- schema/migration gate is re-run safely
- reinstall preserves node identity and data
- reinstall does not silently downgrade app/schema
- reboot/boot path checks schema compatibility

Test cases:
1. Reinstall on healthy current node
2. Reinstall on stale app node
3. Reinstall on schema-skewed node
4. Reinstall after partial failed deploy
5. Reboot after reinstall with pending schema drift

Evidence required:
- exact release selection logic
- exact schema/migration invocation path
- before/after app version
- before/after schema state
- proof that latest approved channel target is used, not a hardcoded value

Pass criteria:
- reinstall is safe, convergent, and channel-aware

---

### 16. No hardcoded wrong deployment/schema targets

I want code review evidence on this point.

Developers must confirm and show:
- no hardcoded schema version in installer/baseline logic
- no hardcoded app tag except documented emergency fallback, if any
- no hardcoded policy version beyond bootstrap behavior
- deployment target comes from rollout policy/channel logic
- schema authority belongs to app migration gate, not installer constants

Evidence required:
- grep/search results or code snippets
- explanation of where deploy target is sourced
- explanation of where schema authority is sourced

Pass criteria:
- no stale hardcoding risk

---

### 17. OS matrix

Verify full pass on:
- Ubuntu 22.04 GNOME
- Ubuntu 22.04 KDE
- Ubuntu 24.04 GNOME
- Ubuntu 24.04 KDE

Evidence required:
- matrix table with pass/fail
- notes per distro/desktop
- any distro-specific exceptions

Pass criteria:
- all pass or documented blocker with severity

---

### 18. Existing heartbeat compatibility

Verify:
- existing heartbeat consumers are not broken
- added fields are additive only
- no renamed or retyped existing fields

Evidence required:
- before/after payload examples
- compatibility test results

Pass criteria:
- Phase A does not break fleet transport

---

### 19. Drift detection

Verify manual drift injection for at least:
- firewall disabled
- sleep targets unmasked
- autologin drift
- printer expected but missing
- unsupported desktop env if possible
- clock unhealthy

Evidence required:
- injected condition
- drift-scan.json
- baseline-diff output
- derived classification

Pass criteria:
- correct detection and severity

---

### 20. Final acceptance summary

I want a final table with these gates and explicit pass/fail:

| # | Gate | Pass/Fail | Evidence |
|---|------|-----------|----------|
| 1 | Fresh install | | |
| 2 | Idempotency | | |
| 3 | Reboot recovery | | |
| 4 | Offline mode | | |
| 5 | Required-if-applicable | | |
| 6 | Supportability | | |
| 7 | Drift detection | | |
| 8 | Schema discipline | | |
| 9 | OS matrix | | |
| 10 | No transport breakage | | |
| 11 | Legacy migration safety | | |
| 12 | Reinstall/recovery safety | | |
| 13 | No hardcoded stale version/schema behavior | | |

If anything fails, include:
- root cause
- impact
- workaround
- ETA
- whether it blocks rollout

---

## Short version

I need full verification evidence, not just "done." Test fresh install, Stage 11 resume, reboot recovery, offline mode, legacy migration, reinstall behavior, and OS matrix. Prove locking, schema-versioned artifacts, queue retention, support bundle redaction, required-if-applicable behavior, and heartbeat compatibility. Most importantly, prove reinstall does not hardcode schema or stale deployment targets and that it converges to the latest approved release for the node's rollout channel, with schema compatibility checked safely on reinstall and boot. Return commands run, outputs, artifacts, and pass/fail for every acceptance gate.
