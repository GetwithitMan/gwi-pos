# Skill 399 — Self-Updating Sync Agent

**Domain:** Infrastructure / NUC
**Date:** 2026-02-20
**Commits:** a38a8cf (gwi-pos)
**Addresses:** Sync agent stuck on stale version, no self-update path after FORCE_UPDATE deploys

---

## Overview

The sync agent (`pulse-sync` systemd service) is the long-running process on each NUC that listens for fleet commands from Mission Control via SSE. Previously, the agent was embedded as a heredoc inside `installer.run` and was never touched by `FORCE_UPDATE` deploys — only the POS app itself was updated. This meant any bug or protocol change in the sync agent required manual SSH intervention to fix.

This skill extracts the sync agent into a versioned file at `public/sync-agent.js`, wires `FORCE_UPDATE` to self-copy the new agent after a successful deploy, and adds `SCHEDULE_REBOOT` / `CANCEL_REBOOT` fleet command handlers.

---

## Why This Exists

Two NUCs (Fruita Grill, Shanes Admin Demo) got stuck with `git pull --ff-only` because their sync agent had no mechanism to receive its own updates. The only fix was SSH access to manually replace the agent file. With a fleet of NUCs growing, this was unsustainable. Now every successful `FORCE_UPDATE` deploy also updates the agent itself and schedules a clean `pulse-sync` restart, permanently closing the gap.

---

## Architecture

```
FORCE_UPDATE fleet command received by sync agent
    │
    ▼ git pull + npm ci + npm run build + prisma db push
    │   (existing FORCE_UPDATE logic)
    │
    ▼ Self-copy: cp /opt/gwi-pos/app/public/sync-agent.js
    │                  /opt/gwi-pos/sync-agent.js
    │
    ▼ setTimeout(15s) → systemctl restart pulse-sync
        (fires AFTER SSE ACK is sent to Mission Control)
```

The 15-second delay ensures the ACK response reaches Mission Control before `pulse-sync` restarts and drops the SSE connection.

---

## Changes

### `public/sync-agent.js` (new standalone file)

Extracted from the heredoc inside `installer.run`. The sync agent is now a versioned file in the repository, deployed to `public/sync-agent.js` on Vercel and served as a static asset. The installer copies it to `/opt/gwi-pos/sync-agent.js` at provision time.

Approximately 340 lines covering:
- SSE connection to `GET /api/fleet/commands/stream` with `Last-Event-ID` resume
- HMAC-SHA256 heartbeat to `POST /api/fleet/heartbeat` every 60 seconds
- Fleet command dispatch: `FORCE_UPDATE`, `KILL_SWITCH`, `UPDATE_CONFIG`, `RESTART_KIOSK`, `RELOAD_TERMINALS`, `SCHEDULE_REBOOT`, `CANCEL_REBOOT`
- Reconnect backoff with jitter

### `handleForceUpdate` — self-copy + restart

After a successful deploy, the handler now runs:

```javascript
// Self-update the sync agent from the freshly-deployed app
const appAgentSrc = `${APP_DIR}/public/sync-agent.js`
const agentDest = `${SYNC_SCRIPT}`  // /opt/gwi-pos/sync-agent.js

fs.copyFileSync(appAgentSrc, agentDest)
fs.chmodSync(agentDest, 0o755)

// Schedule restart AFTER the ACK is sent (15s delay)
setTimeout(() => {
  execSync('systemctl restart pulse-sync')
}, 15_000)
```

### New fleet command handlers

#### `SCHEDULE_REBOOT`

```javascript
case 'SCHEDULE_REBOOT': {
  const delayMinutes = payload?.delayMinutes ?? 15
  execSync(`sudo shutdown -r +${delayMinutes}`)
  break
}
```

#### `CANCEL_REBOOT`

```javascript
case 'CANCEL_REBOOT': {
  execSync('sudo shutdown -c')
  break
}
```

### `installer.run` — heredoc replaced

The ~340-line sync agent heredoc in `installer.run` is replaced with a single copy command:

```bash
cp "$APP_DIR/public/sync-agent.js" "$SYNC_SCRIPT"
chmod +x "$SYNC_SCRIPT"
```

This means new installs always get the current agent from the deployed app bundle.

### `installer.run` — sudoers additions

Three new commands added to the `pulse` user's sudoers entry so the sync agent can restart itself and schedule reboots:

```
pulse ALL=(ALL) NOPASSWD: /bin/systemctl restart pulse-sync
pulse ALL=(ALL) NOPASSWD: /sbin/shutdown
pulse ALL=(ALL) NOPASSWD: /usr/sbin/shutdown
```

---

## Fleet Command Reference

| Command | Payload | Effect |
|---------|---------|--------|
| `FORCE_UPDATE` | `{ gitRef?: string }` | git pull + build + self-copy agent + restart pulse-sync (15s delay) |
| `SCHEDULE_REBOOT` | `{ delayMinutes?: number }` | `sudo shutdown -r +N` (default 15 min) |
| `CANCEL_REBOOT` | — | `sudo shutdown -c` |

---

## Files Changed

| File | Change |
|------|--------|
| `public/sync-agent.js` | New — sync agent extracted from installer heredoc (~340 lines) |
| `public/installer.run` | Modified — heredoc replaced with `cp` command; sudoers adds shutdown + systemctl restart pulse-sync |

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| Sync agent extracted to repo | `public/sync-agent.js` | Agent is now versioned and deployed with every release |
| FORCE_UPDATE self-copies agent | `public/sync-agent.js` (handleForceUpdate) | Sync agent updates itself on every fleet deploy |
| Delayed pulse-sync restart | `public/sync-agent.js` (handleForceUpdate) | ACK sent before restart drops SSE connection |
| SCHEDULE_REBOOT handler | `public/sync-agent.js` | Fleet can schedule NUC reboots |
| CANCEL_REBOOT handler | `public/sync-agent.js` | Fleet can cancel pending reboots |
| installer.run heredoc → cp | `public/installer.run` | New installs always get current agent from app bundle |
| sudoers expanded | `public/installer.run` | pulse user can restart pulse-sync and run shutdown |
