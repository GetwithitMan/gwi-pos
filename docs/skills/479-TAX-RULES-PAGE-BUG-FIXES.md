# Skill 479 — Tax Rules Page Bug Fixes

**Status:** DONE
**Date:** 2026-03-03
**Domain:** Settings / Admin UI / Infrastructure
**Dependencies:** Skill 36 (Tax), Skill 400 (Settings Admin UI)

---

## Overview

Four separate bugs prevented the Tax Rules admin page from functioning. Fixes span the API auth layer, the shared CRUD hook, the service worker, and the React hydration guard.

---

## Bug 1 — `requestingEmployeeId` Missing from GET Query Params

**Symptom:** "Failed to load tax rules" error on page load (HTTP 401).
**Root Cause:** `useAdminCRUD`'s `loadItems` only appended `locationId` to the fetch URL. The `/api/tax-rules` GET handler calls `requirePermission(requestingEmployeeId, ...)`, which returns 401 when `requestingEmployeeId` is null.
**Fix:** Added `requestingEmployeeId?: string` to `UseAdminCRUDConfig<T>`. The `loadItems` callback now appends it to `URLSearchParams` when present.

**Files changed:**
- `src/hooks/useAdminCRUD.ts` — added config field + URL param
- `src/app/(admin)/tax-rules/page.tsx` — passed `requestingEmployeeId: employee?.id`
- `src/app/(admin)/customers/page.tsx` — added param to custom `loadCustomers` fetch

---

## Bug 2 — `requestingEmployeeId` Missing from POST Body

**Symptom:** "Employee ID is required" error when submitting the Add Tax Rule form.
**Root Cause:** `handleSubmitForm` in `tax-rules/page.tsx` built the payload without `requestingEmployeeId`. The `/api/tax-rules` POST handler reads it from the request body for `requirePermission()`.
**Fix:** Added `requestingEmployeeId: employee.id` to the payload object in `handleSubmitForm`.

**Files changed:**
- `src/app/(admin)/tax-rules/page.tsx`

---

## Bug 3 — Service Worker Intercepting `/api/*` Calls (TypeError: Failed to fetch)

**Symptom:** Intermittent `TypeError: Failed to fetch` on all `/api/*` requests, especially during Turbopack HMR recompilation windows. `loadCategories` → `/api/menu` would fail with a network-level TypeError, not an HTTP error.
**Root Cause:** The v1 service worker (`gwi-pos-v1`) had a broken API proxy:
```js
event.respondWith(
  fetch(event.request).catch(() => caches.match(event.request))
)
```
When the internal `fetch()` failed (e.g., during a Turbopack HMR window), `caches.match()` returned `undefined` (API responses are never cached). `respondWith(undefined)` → `TypeError: Failed to fetch`.

**Fix — `public/sw.js` (v2):**
- Removed API interception entirely. `/api/*` requests now `return` without calling `respondWith`, letting the browser fetch them directly.
- Bumped `CACHE_NAME` to `gwi-pos-v2` to force old caches to delete on activation.

**Fix — `src/components/ServiceWorkerRegistration.tsx`:**
- Added stale cache detection on mount: if the `gwi-pos-v1` cache exists, it means the old broken SW is (or was recently) active.
- When detected: unregisters all service workers, deletes the old cache, reloads the page. On the next load, the new SW (v2) registers and API calls are never intercepted.

**Files changed:**
- `public/sw.js`
- `src/components/ServiceWorkerRegistration.tsx`

---

## Bug 4 — Infinite Render Loop in `useAdminCRUD` (Toast Flood)

**Symptom:** Dozens of "Failed to load tax rules" toasts in rapid succession; page making 10+ API calls per second.
**Root Cause:** `parseResponse` was passed as an inline arrow function from the page component:
```ts
parseResponse: (data) => data.taxRules || []
```
This created a new function reference on every render. The chain: `parseResponse` (new ref) → `extractItems` (new ref) → `loadItems` (useCallback dep changed) → `useEffect` re-runs → `loadItems()` called → `setItems()` → re-render → loop.

**Fix:** Use a ref to stabilize `extractItems` regardless of how `parseResponse` is provided:
```ts
const parseResponseRef = useRef(parseResponse)
parseResponseRef.current = parseResponse  // always sync, never stale

const extractItems = useCallback((data: any): T[] => {
  if (parseResponseRef.current) return parseResponseRef.current(data)
  const pluralKey = resourceName + 's'
  return data[pluralKey] || data.data || data
}, [resourceName])  // stable — doesn't depend on parseResponse
```
`extractItems` now depends only on `resourceName` (a string constant). `loadItems` is stable. The `useEffect` runs exactly once on mount and once after each save.

**Files changed:**
- `src/hooks/useAdminCRUD.ts`

---

## Bug 5 — Zustand Hydration Race in `useAuthenticationGuard`

**Symptom:** On page refresh, the auth guard occasionally redirected to `/login` before Zustand had finished reading `localStorage`, aborting in-flight API fetches and causing additional TypeErrors.
**Root Cause:** The one-tick wait (`useEffect(() => setHydrated(true), [])`) doesn't guarantee Zustand 5's async persist middleware has finished rehydrating from `localStorage`.
**Fix:** Use Zustand 5's `persist.hasHydrated()` and `persist.onFinishHydration()` APIs:
```ts
const [hydrated, setHydrated] = useState(
  () => useAuthStore.persist.hasHydrated()
)
useEffect(() => {
  if (useAuthStore.persist.hasHydrated()) { setHydrated(true); return }
  return useAuthStore.persist.onFinishHydration(() => setHydrated(true))
}, [])
```
If already hydrated on first render (common for returning users), `hydrated` starts as `true` immediately and no unnecessary wait occurs.

**Files changed:**
- `src/hooks/useAuthenticationGuard.ts`

---

## Testing

Verified via headless Chrome (CDP) with fresh profile + new SW:
- `/api/tax-rules?locationId=loc-1&requestingEmployeeId=emp-super-admin` → 200
- `/api/menu?locationId=loc-1` → 200
- No TypeErrors, no toast flood
- Tax rule creation (POST) succeeds with `requestingEmployeeId` in body

---

## Key Rule Going Forward

Every admin page that uses `useAdminCRUD` must pass `requestingEmployeeId: employee?.id`. Every custom fetch on a permission-protected route must include it in query params. Every mutation payload on a permission-protected route must include it in the body.
