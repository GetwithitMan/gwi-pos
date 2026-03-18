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

  // Skip TypeScript checking during build — Prisma 7 generated client is large
  // and causes OOM on Vercel. Type safety is verified by `tsc --noEmit` separately.
  // TODO: Remove ignoreBuildErrors once CI typecheck (`tsc --noEmit`) is the trusted gate.
  // Kept only as a Vercel OOM workaround — the CI step is the real type-safety check.
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
      {
        key: 'Content-Security-Policy',
        value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; frame-ancestors 'none'",
      },
      // Stricter report-only CSP — logs violations without blocking.
      // Scripts lose 'unsafe-inline' and 'unsafe-eval' so we can detect inline script usage.
      // Once the report log is clean, promote this policy to the enforced CSP above.
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
