# Offline & Sync Domain Changelog

## 2026-02-23 — Bugfix Sprint C+D: PWA & Disconnect Banner
- **#635**: PWA manifest added — standalone display mode, black theme, app-like experience (`public/manifest.json`)
- **#636**: Service worker — cache-first for static assets, network-first for API calls (`public/sw.js`, `ServiceWorkerRegistration.tsx`)
- **Offline disconnect banner** — Visual indicator when network is lost, auto-dismisses on reconnect (`OfflineDisconnectBanner.tsx`, `layout.tsx`)

## 2026-02-23 — Bugfix Sprint A+B: Offline Wiring (B9-B12)
- **B9**: Offline order creation wired to `OfflineManager.queueOrder()` — orders created while offline are queued for sync (`useActiveOrder.ts`)
- **B10**: Print jobs queued offline on failure — failed print attempts are stored for retry when connection restores (`orders/page.tsx`, `SplitCheckScreen.tsx`)
- **B11**: Already implemented — confirmed `markForOfflineCapture` exists and functions correctly
- **B12**: Already implemented — socket reconnect already re-joins rooms on connection restore

---

## 2026-02-09 — Domain Created
- Domain 20 established for Offline & Sync
- Covers offline queue management, IndexedDB, health monitoring, cloud sync
- Domain doc created at `/docs/domains/OFFLINE-SYNC-DOMAIN.md`
