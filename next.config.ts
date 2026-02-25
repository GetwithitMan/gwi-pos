import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  // This creates a self-contained build that includes only necessary node_modules
  output: 'standalone',

  // Disable x-powered-by header for security
  poweredByHeader: false,

  // Enable strict mode for better error catching
  reactStrictMode: true,

  // Inject app version from package.json at build time
  env: {
    NEXT_PUBLIC_APP_VERSION: require('./package.json').version,
  },

  // Security headers for all routes
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },

  // Proxy /admin routes to the Java backoffice service
  async rewrites() {
    const backofficeUrl = process.env.BACKOFFICE_API_URL
    if (!backofficeUrl) return []
    try {
      new URL(backofficeUrl)
    } catch {
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

export default nextConfig;
