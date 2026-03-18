// Sentry server config — intentionally empty.
// Sentry is initialized via dynamic import in instrumentation.ts register()
// to avoid OpenTelemetry deadlock that blocks both Turbopack and webpack compilation.
