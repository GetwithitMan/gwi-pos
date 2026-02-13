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
};

export default nextConfig;
