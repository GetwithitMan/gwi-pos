# GWI POS Appliance Model

**Status:** Level 3 Convergent Appliance (PR #217, April 2026)

Every feature, update, and operational change must extend this model — never create a parallel lifecycle.

---

## The Rule

**Every component on the venue box must participate in one lifecycle: detect → reconcile → report → rollback.**

If a new feature cannot answer these questions, it is not appliance-ready:

1. Where is the desired version/state defined?
2. How does the venue detect drift?
3. How does it reconcile automatically?
4. How does it report degraded state?
5. How does it rollback on failure?
6. How is it validated in the shipped runtime?
7. Does it work under root-owned orchestration?

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Mission Control (Cloud)                                      │
│                                                              │
│  Owns: desired versions, rollout intent, fleet state         │
│  Publishes: release manifest, version-contract               │
│  Does NOT: execute deploys directly on venues                │
└──────────────────────────┬──────────────────────────────────┘
                           │ (release manifest + Docker image)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ gwi-node.sh — Single Venue Lifecycle Controller              │
│                                                              │
│  Subcommands:                                                │
│    deploy          Pull image, migrate, swap container        │
│    rollback        Restore LKG image                         │
│    converge        Single-run reconciliation (all components)│
│    converge-loop   Persistent self-healing (5min interval)   │
│    promote         HA: become primary                        │
│    rejoin          HA: become standby                        │
│    dashboard-check Dashboard convergence                     │
│    dashboard-rollback  Restore LKG dashboard                 │
│    status          Compact component summary                 │
│    full-status     Complete operator report                  │
│    venue-state     Machine-readable lifecycle JSON            │
│    cleanup         Prune old images + logs                   │
│                                                              │
│  Owns: deploy, schema migration, dashboard install,          │
│        rollback, convergence, health, state persistence      │
│                                                              │
│  Runs as: root (orchestration)                               │
│  Runtime: Docker container (gwi-pos) at minimum privilege    │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ gwi-pos      │  │ gwi-agent    │  │ gwi-dashboard │
│ (Docker)     │  │ (Docker)     │  │ (.deb)        │
│              │  │              │  │               │
│ Server +     │  │ Sync agent   │  │ NUC display   │
│ API + sync   │  │ + deploy     │  │ app (Tauri)   │
│ workers      │  │ trigger      │  │               │
└──────────────┘  └──────────────┘  └───────────────┘
```

---

## Venue State Machine

```
BOOTSTRAPPING ──→ CONVERGING ──→ CONVERGED
                      │  ↑            │
                      │  └────────────┘
                      ▼
                  DEGRADED ──→ BLOCKED
                      │
                      ▼
               ROLLING_BACK ──→ RECOVERY_REQUIRED
```

| State | Meaning | Operator Action |
|-------|---------|-----------------|
| BOOTSTRAPPING | First install, not yet converged | Wait |
| CONVERGING | Update in progress | Wait |
| CONVERGED | All managed components at target | None |
| DEGRADED | Server healthy, others behind | Auto-reconciling |
| BLOCKED | 5+ failed convergence attempts | Investigate |
| ROLLING_BACK | Active rollback in progress | Wait |
| RECOVERY_REQUIRED | Failed rollback | Engineer required |

Managed components: **server, schema, dashboard**
Informational: **baseline** (Ansible, tracked but not auto-reconciled)

---

## Authority Model

| Domain | Authority | NUC Role |
|--------|-----------|----------|
| Desired versions | MC release manifest | Read + cache |
| Neon schema (cloud) | Vercel build | Observe only, never mutate |
| Local PG schema | gwi-node (deploy-tools) | Apply forward migrations |
| Runtime process | Docker container | gwi-node starts/stops |
| Dashboard package | gwi-node (from version-contract) | Install + verify |
| Venue state | gwi-node + convergence loop | Write + report |

**NUC never invents truth.** It reads desired state from MC/version-contract and converges toward it.

---

## Runtime Contract

| Layer | What's Canonical | What's NOT |
|-------|-----------------|------------|
| App runtime | Docker container `gwi-pos` | ~~Host node process~~ |
| Deploy agent | `gwi-node.sh` | ~~deploy-release.sh~~ |
| Schema ops | `docker exec gwi-pos` (deploy-tools) | ~~Host /opt/gwi-pos/deploy-tools~~ |
| Service management | `docker start/stop gwi-pos` | ~~systemctl thepasspos~~ |
| Config/state | `/opt/gwi-pos/shared/state/` (host, mounted) | ~~Scattered host files~~ |
| Logs | `docker logs gwi-pos` | ~~journalctl -u thepasspos~~ |

---

## What's NOT Allowed (Enforced by CI)

These patterns fail the build via legacy regression guards:

1. `systemctl start thepasspos` in application source code
2. `rolling-restart.sh` as a hard installer dependency
3. `thepasspos` as a service in installer manifests
4. `thepasspos` sudoers grants
5. `deploy-release.sh` growing beyond 50 lines
6. `SCHEMA-AUTHORITY.md` referencing deploy-release.sh as canonical

---

## Convergence Loop

```
Every 5 minutes (gwi-converge.service):
  1. Read venue-state.json
  2. Read version-contract from running container
  3. For each managed component:
     a. Compare current vs target version
     b. If diverged: attempt reconciliation
     c. If reconciled: mark converged, reset attempt count
     d. If failed 5x: mark BLOCKED
  4. Write updated venue-state.json
```

Auto-installed on first successful deploy. Persistent across reboots via systemd.

---

## Rollback Policy

| Component | Rollback | Mechanism |
|-----------|----------|-----------|
| Server image | ✅ Supported | `gwi-node rollback` → LKG image |
| Dashboard .deb | ✅ If cached | `gwi-node dashboard-rollback` → cached LKG .deb |
| Schema | ❌ Forward-only | Migrations must be backward-compatible |

**Auto-rollback:** Health check failure after deploy triggers automatic LKG restore.

---

## Adding a New Managed Component

To add a new component to the appliance (e.g., KDS app, signage display):

1. Add to `venue-state.ts` component slots
2. Add version tracking in `version-contract.json`
3. Add convergence check in `gwi-node converge()`
4. Add LKG tracking on successful install
5. Add rollback mechanism
6. Add to `gwi-node full-status` output
7. Add CI validation for the shipped artifact
8. Document rollback policy

If you can't do all 8, the component is not appliance-managed.

---

## Operator Quick Reference

```bash
# What state is this box in?
gwi-node full-status

# Force reconciliation now
gwi-node converge

# Rollback server to last known good
gwi-node rollback

# Check/fix dashboard
gwi-node dashboard-check

# Machine-readable state for automation
gwi-node venue-state

# Validate the box is correctly configured
sudo bash /opt/gwi-pos/app/scripts/validate-sudo-paths.sh
```

---

*This document is the canonical reference for the GWI POS appliance model. All new features must extend this model. No parallel lifecycles.*
