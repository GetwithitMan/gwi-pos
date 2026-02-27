# Skill 408 — Sync Agent Boot-Time Self-Update

**Domain:** Infrastructure / NUC
**Date:** 2026-02-21
**Addresses:** NUCs that were offline or missed a FORCE_UPDATE continuing to run stale sync-agent.js after a reboot

---

## Overview

On every startup of the `thepasspos-sync` systemd service, the sync agent now checks GitHub for a newer version of itself. If the file has changed, it replaces itself atomically and immediately exits — causing systemd to restart it with the new code. If content is identical or any check fails, startup continues normally.

---

## Problem and Motivation

Skill 399 introduced a self-copy mechanism inside `FORCE_UPDATE`: after a successful deploy, the handler copies the freshly-built `public/sync-agent.js` to `/opt/gwi-pos/sync-agent.js` and restarts `thepasspos-sync`. This covers the happy path — the NUC is online and receives the fleet command.

Two gaps remained:

1. **NUC was offline during a FORCE_UPDATE.** The fleet command expires (2h TTL). When the NUC comes back online, its sync agent is still the old version. The new app code is present (installer fetches it fresh on start), but the agent is stale.

2. **NUC reboots after a FORCE_UPDATE that did NOT include a sync-agent change.** The NUC loaded the new agent during the FORCE_UPDATE restart, but on the NEXT reboot it would start from `/opt/gwi-pos/sync-agent.js` which may have been overwritten by a subsequent unrelated deploy that also touched `installer.run` or provisioning paths.

Without physical access or a successful FORCE_UPDATE delivery, there was no way to get a NUC onto a new sync agent. The boot self-update closes this gap permanently.

---

## How It Works

The function `checkBootUpdate(done)` runs at the very start of the sync agent, before `connectStream()` is called.

### Step-by-step flow

1. **Read credentials file**
   Reads `/opt/gwi-pos/.git-credentials` and extracts the GitHub PAT using the regex:
   ```
   https://([^:]+):x-oauth-basic@github.com
   ```
   If the file is missing or the token cannot be parsed, `done()` is called immediately and the agent starts normally.

2. **Fetch the canonical sync agent from GitHub**
   Makes an HTTPS GET to:
   ```
   api.github.com/repos/GetwithitMan/gwi-pos/contents/public/sync-agent.js
   ```
   with headers:
   ```
   Authorization: token <PAT>
   Accept: application/vnd.github.raw
   User-Agent: gwi-sync-agent
   ```
   A 15-second timeout is set on the request. On timeout, `req.destroy()` fires.

3. **Validate the response**
   If the HTTP status is not `200`, or the response body is fewer than 100 bytes, the download is discarded and `done()` is called. This guards against empty responses, GitHub errors, and accidental truncation.

4. **Compare to the running file**
   Reads `/opt/gwi-pos/sync-agent.js` (the file currently on disk). Compares it as a string to the downloaded content.

5a. **Identical — nothing to do**
    Logs `"sync-agent up to date"` and calls `done()`. Normal startup proceeds.

5b. **Different — self-update and exit**
    - Writes the downloaded content to `/opt/gwi-pos/sync-agent.js.tmp`
    - `fs.renameSync` moves `.tmp` to `/opt/gwi-pos/sync-agent.js` (atomic — no partial file window)
    - Logs `"sync-agent updated. Exiting for systemd restart..."`
    - `process.exit(0)` — systemd's `Restart=always` picks up the new file and starts a clean process

6. **Start section**
   Changed from calling `connectStream()` directly to:
   ```javascript
   checkBootUpdate(function() { connectStream() })
   ```

---

## Safety Mechanisms

| Guard | What it prevents |
|-------|-----------------|
| `settled` flag inside `checkBootUpdate` | `req.destroy()` on timeout fires both the timeout callback and the error handler; the flag ensures `done()` is called at most once, preventing a double-start of `connectStream()` |
| Size check (< 100 bytes rejected) | Empty GitHub API error payloads or HTML error pages being written as the new agent |
| All errors call `done()` | No code path in `checkBootUpdate` can hang the agent; every error falls through to normal startup |
| `.tmp` + `fs.renameSync` | Atomic replacement — a crash mid-write leaves a `.tmp` file behind, never a half-written agent |
| 15-second request timeout | Agent never waits more than 15 seconds on boot, even if GitHub is unreachable |

---

## Timing Characteristics

| Scenario | Boot delay |
|----------|-----------|
| GitHub responds quickly, content identical | ~1–2 seconds |
| GitHub responds quickly, update available | ~2–3 seconds to download and write, then systemd restart (effectively instant) |
| GitHub unreachable, timeout fires | 15 seconds, then normal startup |
| Credentials file missing | ~0ms (skips immediately) |
| GitHub returns non-200 or tiny body | < 1 second to receive error, then normal startup |

The worst case is a 15-second delay before `connectStream()` runs. This is acceptable on boot — systemd does not mark the service as failed during this window, and the NUC's POS app starts independently under the `thepasspos` service.

---

## What It Updates and What It Does Not

| | Updated by boot self-update |
|---|---|
| `public/sync-agent.js` → `/opt/gwi-pos/sync-agent.js` | Yes |
| POS app code (`thepasspos`, Next.js build) | No |
| Database schema | No |
| Any other file on the NUC | No |

POS app updates remain intentional — they are delivered exclusively via `FORCE_UPDATE` fleet commands from Mission Control, which trigger `git pull`, `npm ci`, `prisma db push`, and `npm run build`. The boot self-update is a narrow, targeted mechanism for the sync agent only.

---

## Interaction with FORCE_UPDATE

These are two independent update paths. Either can update the sync agent:

| Path | Trigger | When it fires |
|------|---------|---------------|
| FORCE_UPDATE self-copy (Skill 399) | Fleet command delivered via SSE | When NUC is online and MC sends the command |
| Boot self-update (this skill) | Every `thepasspos-sync` startup | On every reboot, crash-restart, or manual `systemctl restart thepasspos-sync` |

If both fire in sequence (e.g., FORCE_UPDATE restarts thepasspos-sync, which then runs checkBootUpdate on the new agent), the boot check compares the already-updated file to GitHub and finds them identical — no-op.

The FORCE_UPDATE handler for reference (Skill 399):
```javascript
fs.copyFileSync(newAgentPath, '/opt/gwi-pos/sync-agent.js')
setTimeout(() => run('sudo systemctl restart thepasspos-sync', ...), 15000)
```

---

## Edge Cases Handled

| Edge case | Behavior |
|-----------|----------|
| NUC was offline during all FORCE_UPDATE commands | Boot self-update fetches from GitHub on next reboot; NUC gets current agent |
| `.git-credentials` file missing (freshly provisioned NUC before creds written) | Skips update check entirely, starts normally |
| GitHub API rate-limited (403) | Non-200 status → skips, starts normally |
| GitHub returns a redirect | Treated as non-200 unless followed; download skipped |
| Response body is a GitHub error JSON (small payload) | < 100 byte guard rejects it |
| `fs.renameSync` fails (e.g., cross-device) | Error caught, `done()` called, agent starts normally |
| `process.exit(0)` fires but systemd doesn't restart | Unlikely given `Restart=always`, but in that case the NUC simply has the new agent on disk ready for the next manual start |
| Two rapid reboots while update is in flight | Second boot runs checkBootUpdate again — GitHub now returns same content as newly written file, no-op |

---

## Key Constants

```
CREDS_FILE  = '/opt/gwi-pos/.git-credentials'
SELF_PATH   = '/opt/gwi-pos/sync-agent.js'
GitHub path = /repos/GetwithitMan/gwi-pos/contents/public/sync-agent.js
Timeout     = 15 000 ms
Min size    = 100 bytes
```

---

## Files Changed

| File | Change |
|------|--------|
| `public/sync-agent.js` | Added `checkBootUpdate(done)` function; changed Start section from `connectStream()` to `checkBootUpdate(function() { connectStream() })` |
