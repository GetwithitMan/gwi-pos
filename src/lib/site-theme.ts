/**
 * Site Theme — CSS variable presets for the public ordering website.
 *
 * Three presets: modern (clean/minimal), classic (warm/traditional), bold (vibrant/high-contrast).
 * All themes respect venue branding (brandColor, brandColorSecondary) and generate
 * a full set of CSS custom properties for the (site) route group.
 */

export type ThemePreset = 'modern' | 'classic' | 'bold'

interface ThemeVariables {
  // Core brand
  '--site-brand': string
  '--site-brand-secondary': string
  '--site-brand-rgb': string

  // Typography
  '--site-heading-font': string
  '--site-body-font': string
  '--site-heading-weight': string

  // Surface & text
  '--site-bg': string
  '--site-bg-secondary': string
  '--site-text': string
  '--site-text-muted': string
  '--site-text-on-brand': string

  // Borders & shadows
  '--site-border': string
  '--site-border-radius': string
  '--site-shadow-sm': string
  '--site-shadow-md': string
  '--site-shadow-lg': string

  // Section spacing
  '--site-section-padding': string
  '--site-card-padding': string

  // Hero
  '--site-hero-overlay': string
  '--site-hero-text': string
  '--site-hero-min-height': string

  // Button
  '--site-btn-radius': string
  '--site-btn-font-weight': string
  '--site-btn-text-transform': string
}

// ── Preset Definitions ──────────────────────────────────────────────────────

const MODERN: Omit<ThemeVariables, '--site-brand' | '--site-brand-secondary' | '--site-brand-rgb' | '--site-heading-font'> = {
  '--site-body-font': "'Inter', system-ui, sans-serif",
  '--site-heading-weight': '700',
  '--site-bg': '#ffffff',
  '--site-bg-secondary': '#f9fafb',
  '--site-text': '#111827',
  '--site-text-muted': '#6b7280',
  '--site-text-on-brand': '#ffffff',
  '--site-border': '#e5e7eb',
  '--site-border-radius': '0.75rem',
  '--site-shadow-sm': '0 1px 2px rgba(0,0,0,0.05)',
  '--site-shadow-md': '0 4px 6px -1px rgba(0,0,0,0.1)',
  '--site-shadow-lg': '0 10px 15px -3px rgba(0,0,0,0.1)',
  '--site-section-padding': '4rem 1.5rem',
  '--site-card-padding': '1.5rem',
  '--site-hero-overlay': 'rgba(0,0,0,0.4)',
  '--site-hero-text': '#ffffff',
  '--site-hero-min-height': '28rem',
  '--site-btn-radius': '0.5rem',
  '--site-btn-font-weight': '600',
  '--site-btn-text-transform': 'none',
}

const CLASSIC: typeof MODERN = {
  '--site-body-font': "'Georgia', 'Times New Roman', serif",
  '--site-heading-weight': '700',
  '--site-bg': '#fefcf8',
  '--site-bg-secondary': '#f5f0e8',
  '--site-text': '#2d2418',
  '--site-text-muted': '#7c6f5e',
  '--site-text-on-brand': '#ffffff',
  '--site-border': '#e0d5c4',
  '--site-border-radius': '0.5rem',
  '--site-shadow-sm': '0 1px 3px rgba(45,36,24,0.08)',
  '--site-shadow-md': '0 4px 8px rgba(45,36,24,0.12)',
  '--site-shadow-lg': '0 8px 16px rgba(45,36,24,0.15)',
  '--site-section-padding': '4.5rem 1.5rem',
  '--site-card-padding': '1.75rem',
  '--site-hero-overlay': 'rgba(45,36,24,0.5)',
  '--site-hero-text': '#ffffff',
  '--site-hero-min-height': '32rem',
  '--site-btn-radius': '0.375rem',
  '--site-btn-font-weight': '600',
  '--site-btn-text-transform': 'none',
}

const BOLD: typeof MODERN = {
  '--site-body-font': "'Montserrat', system-ui, sans-serif",
  '--site-heading-weight': '900',
  '--site-bg': '#0f0f0f',
  '--site-bg-secondary': '#1a1a1a',
  '--site-text': '#f5f5f5',
  '--site-text-muted': '#a3a3a3',
  '--site-text-on-brand': '#ffffff',
  '--site-border': '#2a2a2a',
  '--site-border-radius': '1rem',
  '--site-shadow-sm': '0 1px 3px rgba(0,0,0,0.3)',
  '--site-shadow-md': '0 4px 10px rgba(0,0,0,0.4)',
  '--site-shadow-lg': '0 12px 24px rgba(0,0,0,0.5)',
  '--site-section-padding': '5rem 1.5rem',
  '--site-card-padding': '2rem',
  '--site-hero-overlay': 'rgba(0,0,0,0.6)',
  '--site-hero-text': '#ffffff',
  '--site-hero-min-height': '36rem',
  '--site-btn-radius': '9999px',
  '--site-btn-font-weight': '700',
  '--site-btn-text-transform': 'uppercase',
}

const PRESETS: Record<ThemePreset, typeof MODERN> = {
  modern: MODERN,
  classic: CLASSIC,
  bold: BOLD,
}

// ── Hex → RGB helper ────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return '59,130,246' // fallback blue
  return `${r},${g},${b}`
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getSiteThemeVariables(options: {
  themePreset: ThemePreset
  brandColor: string
  brandColorSecondary?: string
  headingFont?: string | null
}): ThemeVariables {
  const preset = PRESETS[options.themePreset] ?? PRESETS.modern

  const headingFontValue = options.headingFont
    ? `'${options.headingFont}', ${preset['--site-body-font']}`
    : preset['--site-body-font']

  return {
    ...preset,
    '--site-brand': options.brandColor,
    '--site-brand-secondary': options.brandColorSecondary || options.brandColor,
    '--site-brand-rgb': hexToRgb(options.brandColor),
    '--site-heading-font': headingFontValue,
  }
}

/**
 * Converts theme variables to a CSS string for injection into a <style> tag.
 * Scoped to :root or a data attribute for the site.
 */
export function getSiteThemeCSS(variables: ThemeVariables): string {
  const entries = Object.entries(variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
  return `[data-site-theme] {\n${entries}\n}`
}
