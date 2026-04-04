# Skill 399 — Self-Updating Sync Agent

**Domain:** Infrastructure / NUC
**Date:** 2026-02-20
**Commits:** a38a8cf (gwi-pos)
**Addresses:** Sync agent stuck on stale version, no self-update path after FORCE_UPDATE deploys

---

## Overview

The sync agent (`gwi-agent` Docker container, running `sync-agent.js`) is the long-running process on each NUC that listens for fleet commands from Mission Control via SSE. Previously, the agent was embedded as a heredoc inside `installer.run` and was never touched by `FORCE_UPDATE` deploys — only the POS app itself was updated. This meant any bug or protocol change in the sync agent required manual SSH intervention to fix.

This skill extracts the sync agent into a versioned file at `public/sync-agent.js`, wires `FORCE_UPDATE` to update the agent via container swap, and adds `SCHEDULE_REBOOT` / `CANCEL_REBOOT` fleet command handlers.

---

## Why This Exists

Two NUCs (Fruita Grill, Shanes Admin Demo) got stuck with `git pull --ff-only` because their sync agent had no mechanism to receive its own updates. The only fix was SSH access to manually replace the agent file. With a fleet of NUCs growing, this was unsustainable. Now the sync agent is containerized -- every `gwi-node.sh deploy` swaps both the `gwi-pos` and `gwi-agent` containers, so the agent always matches the deployed app version. This permanently closes the update gap.

---

## Architecture

```
FORCE_UPDATE fleet command received by gwi-agent container
    │
    ▼ gwi-node.sh deploy
    │   (pull Docker image, run migrations in container, swap container, health check)
    │
    ▼ Both gwi-pos and gwi-agent containers swapped to new image
    │   (sync-agent.js is baked into the Docker image)
    │
    ▼ ACK COMPLETED → MC updates deployment status
```

Because both containers are swapped together by `gwi-node.sh`, the sync agent always runs the same version as the POS app.

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

After a successful deploy, the handler calls `gwi-node.sh deploy` which swaps both containers:

```javascript
// gwi-agent triggers the deploy via gwi-node.sh
execSync('/opt/gwi-pos/gwi-node.sh deploy')
// gwi-node.sh pulls new image, runs migrations, swaps gwi-pos AND gwi-agent containers
// sync-agent.js is baked into the Docker image — no file copy needed
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

Sudoers entries for the `gwipos` user so the sync agent can manage containers and schedule reboots:

```
gwipos ALL=(ALL) NOPASSWD: /usr/bin/docker restart gwi-pos
gwipos ALL=(ALL) NOPASSWD: /usr/bin/docker restart gwi-agent
gwipos ALL=(ALL) NOPASSWD: /sbin/shutdown
gwipos ALL=(ALL) NOPASSWD: /usr/sbin/shutdown
```

---

## Fleet Command Reference

| Command | Payload | Effect |
|---------|---------|--------|
| `FORCE_UPDATE` | `{ gitRef?: string }` | `gwi-node.sh deploy` — pull image, migrate, swap both containers |
| `SCHEDULE_REBOOT` | `{ delayMinutes?: number }` | `sudo shutdown -r +N` (default 15 min) |
| `CANCEL_REBOOT` | — | `sudo shutdown -c` |

---

## Files Changed

| File | Change |
|------|--------|
| `public/sync-agent.js` | New — sync agent extracted from installer heredoc (~340 lines) |
| `public/installer.run` | Modified — heredoc replaced with container deploy; sudoers adds shutdown + docker restart |

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| Sync agent extracted to repo | `public/sync-agent.js` | Agent is now versioned and deployed with every release |
| FORCE_UPDATE swaps containers | `public/sync-agent.js` (handleForceUpdate) | Sync agent updates via `gwi-node.sh deploy` container swap |
| SCHEDULE_REBOOT handler | `public/sync-agent.js` | Fleet can schedule NUC reboots |
| CANCEL_REBOOT handler | `public/sync-agent.js` | Fleet can cancel pending reboots |
| installer.run heredoc → container | `public/installer.run` | New installs deploy agent as gwi-agent Docker container |
| sudoers expanded | `public/installer.run` | gwipos user can restart containers and run shutdown |
