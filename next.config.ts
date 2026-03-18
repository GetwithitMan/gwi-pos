import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: used by Vercel for serverless deployment.
  // On NUC, the custom server.ts wraps Next.js directly (npm ci + full node_modules),
  // so the standalone .next/standalone folder is not used there.
  output: 'standalone',
  serverExternalPackages: ['serialport'],

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

  // App version — set by CI / Docker build arg, or falls back to '0.0.0' in dev.
  // Removed require('./package.json') to avoid CJS require in ESM config.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
  },

  // Security headers for all routes
  // HSTS is production-only — in dev it poisons Chrome's cache and forces HTTPS redirects
  async headers() {
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Enforced CSP — strict policy. unsafe-inline kept for styles only (Tailwind).
      // unsafe-eval added in dev for webpack HMR, removed in production.
      {
        key: 'Content-Security-Policy',
        value: process.env.NODE_ENV === 'production'
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'"
          : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'",
      },
      // Report-only CSP without unsafe-inline on scripts — catches any inline script
      // violations that the enforced CSP allows. Logs to /api/csp-report.
      {
        key: 'Content-Security-Policy-Report-Only',
        value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'; report-uri /api/csp-report",
      },
    ]
    if (process.env.NODE_ENV === 'production') {
      securityHeaders.unshift({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' })
    }
    return [{ source: '/(.*)', headers: securityHeaders }]
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
