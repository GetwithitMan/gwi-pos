# KDS Domain Changelog

## 2026-02-10 — KDS Browser Compatibility Fix (Chrome 108 oklch)

### Problem
KDS paired device (KA-15PCAPAIO4, Android 10, Chrome 108) showed a completely white screen on all pages. The pair page (`/kds/pair`) and main KDS page (`/kds`) both rendered as blank white.

### Root Cause
Tailwind CSS v4 defines **all** theme colors using `oklch()` color space (e.g., `--color-gray-900: oklch(15.6% 0.014 285.823)`). Chrome 108 does NOT support `oklch()` — it requires Chrome 111+. When CSS custom properties containing oklch() values are used as color values, Chrome 108 silently discards them → transparent/initial values → white background, invisible text.

### Why `browserslist` Didn't Fix It
1. `@tailwindcss/postcss` v4 skips Lightning CSS optimization in dev mode (`optimize` defaults to `process.env.NODE_ENV === "production"`)
2. Even in production mode, the optimize targets are **hardcoded** in `@tailwindcss/node` to Chrome 111 — which already supports oklch(), so no transpilation would occur

### Fix Applied
Installed `@csstools/postcss-oklab-function` PostCSS plugin with `preserve: false`:

**`postcss.config.mjs`:**
```mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    "@csstools/postcss-oklab-function": { preserve: false },
  },
};
```

**Key details:**
- `preserve: false` is **critical** — with `preserve: true`, both rgb() and oklch() are output, but oklch() wins in the cascade and Chrome 108 still fails
- Plugin runs after Tailwind, transpiling all oklch() → rgb() values
- Zero visual difference on modern browsers (rgb() is universally supported)
- Only theoretical loss: wide-gamut color precision, imperceptible for POS UI

### KDS Pair Page Redirect Fix
Also fixed the pair page redirect logic to always include the screen slug from the API response:

```typescript
// Before: could redirect to /kds without ?screen= param
router.push(returnTo)

// After: always includes slug from pairing response
const slug = data.screen.slug || screenSlug
const targetUrl = slug ? `/kds?screen=${slug}` : returnTo
router.push(targetUrl)
```

### Device Info (from DB)
```json
{
  "name": "Kitchen",
  "slug": "kitchen",
  "isPaired": true,
  "deviceInfo": {
    "userAgent": "Chrome/108.0.0.0 on Android 10 (KA-15PCAPAIO4)",
    "screenWidth": 1920,
    "screenHeight": 1080,
    "platform": "Linux aarch64"
  }
}
```

### Files Modified
- `postcss.config.mjs` — Added oklch transpilation plugin
- `package.json` — Added `@csstools/postcss-oklab-function` dependency + `browserslist` config
- `src/app/(kds)/kds/pair/page.tsx` — Fixed redirect to use API response slug

### Status
- KDS device confirmed "mostly working" after fix

### Resume
1. Say: `PM Mode: KDS`
2. Check if any other KDS devices have browser compatibility issues
3. Verify the full pair → auth → display flow end-to-end on the Kitchen screen

---

## Sessions

_Changelog created during 2026-02-09 codebase audit. First session logged 2026-02-10._
