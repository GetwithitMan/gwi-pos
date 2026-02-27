# Skill 453: Rebrand pulse-pos → thepasspos + Infra Updates

**Date:** 2026-02-26
**Commits:** `ab89ccb`, `79dd23b`
**Status:** DONE

## Overview

Renamed all references from `pulse-pos`/`pulse_pos`/`pulse-kiosk` to `thepasspos`/`thepasspos-kiosk` across documentation, installer, and configuration files. Also added PWA icons and bumped dev memory limit.

## Rebrand Changes (13 files)

| File | Changes |
|------|---------|
| `CLAUDE.md` | DB name, env examples, installer description |
| `docs/INSTALL.txt` | All systemctl commands, DB name, service paths |
| `docs/architecture/COMPLETE-SYSTEM-REFERENCE.md` | Service names in NUC spec and architecture diagram |
| `docs/architecture/GWI-ARCHITECTURE.md` | DB URL and local PG reference |
| `docs/deployment/INSTALLER-SPEC.md` | Service names and DB references |
| `docs/planning/PILOT-READINESS-CHECKLIST.md` | Service name reference |
| `docs/skills/345-INSTALLER-PACKAGE.md` | Service name references |
| `docs/skills/381-RELEASE-KIOSK-RESTART.md` | Service name references |
| `docs/skills/407-NUC-REMOTE-GIT-REPAIR.md` | Service name references |
| `docs/skills/408-SYNC-AGENT-BOOT-SELF-UPDATE.md` | Service name references |
| `docs/skills/447-NUC-DEPLOYMENT-PIPELINE.md` | Service name references |
| `docs/skills/449-NUC-SYNC-HARDENING.md` | DB name reference |
| `public/installer.run` | Service names in installer script |

## Infrastructure Changes

- **Dev memory**: Added `NODE_OPTIONS='--max-old-space-size=8192'` to `npm run dev` script in `package.json`
- **PWA icons**: Added `public/icon-192.png` and `public/icon-512.png`
- **Schema SQL**: Regenerated `prisma/schema.sql` reflecting current schema state (+654/-128 lines)
