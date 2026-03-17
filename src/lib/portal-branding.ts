/**
 * Portal branding utilities — CSS custom property generation for venue portals.
 */

export function getPortalCSSVariables(
  brandColor: string,
  brandColorSecondary?: string,
): Record<string, string> {
  return {
    '--brand-primary': brandColor,
    '--brand-secondary': brandColorSecondary || brandColor,
  }
}
