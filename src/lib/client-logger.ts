/**
 * Client-side logger — dev-only console output, silent in production.
 * Use instead of console.log/warn in React components, hooks, and stores.
 * In production builds, these calls compile to no-ops (dead code eliminated).
 */

const isDev = process.env.NODE_ENV !== 'production'

export const clientLog = {
  debug: isDev ? console.log.bind(console) : () => {},
  info: isDev ? console.log.bind(console) : () => {},
  warn: isDev ? console.warn.bind(console) : () => {},
  error: console.error.bind(console), // Always log errors, even in production
}
