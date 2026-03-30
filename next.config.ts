import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

// Read version from package.json at build time (avoids CJS require in ESM config).
// Falls back to env var or '0.0.0' if package.json is unreadable.
let _pkgVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
  _pkgVersion = pkg.version || '0.0.0'
} catch {
  // Fallback: env var from CI/Docker
  _pkgVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'
}

const nextConfig: NextConfig = {
  // Standalone output: used by Vercel for serverless deployment.
  // On NUC, the custom server.ts wraps Next.js directly (npm ci + full node_modules),
  // so the standalone .next/standalone folder is not used there.
  output: 'standalone',
  serverExternalPackages: ['serialport', 'ws', 'accepts', 'negotiator'],

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // Enable strict mode for better error catching
  reactStrictMode: true,

  // TypeScript checking is enforced by CI (`tsc --noEmit` in .github/workflows/ci.yml).
  // Vercel build skips it because Prisma 7 generated client causes OOM on their VMs.
  // This is safe: CI catches all type errors before merge. Vercel only runs on main.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Limit body sizes to prevent resource exhaustion
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // Prevent source code from being exposed in production browser bundles
  productionBrowserSourceMaps: false,

  // App version — read from package.json at build time.
  // The update-agent stamps the MC-provided version into package.json after each deploy,
  // so this always reflects the deployed version after a build + restart cycle.
  env: {
    NEXT_PUBLIC_APP_VERSION: _pkgVersion,
  },

  // Security headers for all routes
  // HSTS is production-only — in dev it poisons Chrome's cache and forces HTTPS redirects
  async headers() {
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Enforced CSP — strict policy.
      // script-src 'unsafe-inline': Required by Next.js for inline script tags it
      //   injects (data hydration, next/script). Removing requires nonce-based CSP
      //   which needs Next.js middleware nonce injection on every response.
      // style-src 'unsafe-inline': Required by Tailwind CSS and shadcn/ui runtime
      //   style injection. Cannot be removed without a full CSS extraction strategy.
      // unsafe-eval: ONLY in dev for webpack HMR. NEVER in production.
      // DEBT: Move to nonce-based CSP to remove script unsafe-inline — requires
      // Next.js nonce injection on all Script components. Target: post-React 19 migration.
      {
        key: 'Content-Security-Policy',
        value: process.env.NODE_ENV === 'production'
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
          : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'",
      },
      // Report-only CSP — catches inline script violations. In dev, allow eval/inline
      // so webpack HMR doesn't flood the console with false positives.
      {
        key: 'Content-Security-Policy-Report-Only',
        value: process.env.NODE_ENV === 'production'
          ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'; report-uri /api/csp-report"
          : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'",
      },
      // Restrict unused browser APIs — POS has no camera/microphone/geolocation needs
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      },
      // Isolate browsing context to prevent cross-origin window attacks
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      // Restrict resource loading to same-origin (prevents speculative side-channel attacks)
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ]
    if (process.env.NODE_ENV === 'production') {
      securityHeaders.unshift({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' })
    }
    return [
      { source: '/(.*)', headers: securityHeaders },
      // Installer files must never be cached — NUCs must always get the latest version
      ...['/installer.run', '/installer-bundle.run', '/setup-remote.sh', '/install.sh', '/uninstall.sh', '/usb-remote-setup.sh'].map(source => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
          { key: 'CDN-Cache-Control', value: 'no-store' },
          { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
        ],
      })),
    ]
  },

  // Proxy /admin routes to the Java backoffice service
  async rewrites() {
    const backofficeUrl = process.env.BACKOFFICE_API_URL
    if (!backofficeUrl) return []
    try {
      new URL(backofficeUrl)
    } catch {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[next.config] BACKOFFICE_API_URL is set but not a valid URL — aborting build')
      }
      console.warn('[next.config] BACKOFFICE_API_URL is not a valid URL, skipping rewrite')
      return []
    }
    return [
      {
        source: '/admin/:path*',
        destination: `${backofficeUrl}/admin/:path*`,
      },
    ]
  },
};

export default nextConfig
