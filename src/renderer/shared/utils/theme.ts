/**
 * Design tokens.
 *
 * Values are taken from the reference build so the visual result matches:
 * white surfaces, near-black ink, and the original surface radii.
 */
export const palette = {
  ink: '#111111',
  inkSoft: 'rgba(17, 17, 17, 0.75)',
  paper: '#FFFFFF',
  paperAlt: 'rgba(119, 119, 119, 0.05)',
  line: 'rgba(119, 119, 119, 0.15)',
  lineSoft: 'rgba(119, 119, 119, 0.07)',
  white: '#FFFFFF',
  accent: '#1F5DF2',
  accentSoft: 'rgba(101, 138, 255, 1)',
  error: '#EC0F38',
  success: '#008770',
  overlay: 'rgba(17, 17, 17, 0.60)'
} as const

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 99
} as const

export const shadow = {
  bar: '0px 0px 20px 0px rgba(0, 0, 0, 0.15), 0px 25px 30px 0px rgba(0, 0, 0, 0.25)',
  popover: '0px 25px 30px 0px rgba(0, 0, 0, 0.25), 0px 0px 20px 0px rgba(0, 0, 0, 0.15)',
  card: '0px 4px 6px -2px rgba(17, 17, 17, 0.03), 0px 12px 16px -4px rgba(17, 17, 17, 0.1), 0px 0px 1px 0px rgba(242, 241, 240, 0.55)'
} as const

export const motion = {
  /** The bar's state transition curve, shared by every visual property. */
  bar: 'all 0.2s cubic-bezier(0.05, 0.6, 0.4, 0.95)',
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  shimmer: 'cubic-bezier(0.42, 0, 0.58, 1)',
  fade: 'opacity 0.2s ease'
} as const

export const font = {
  sans: '-apple-system, BlinkMacSystemFont, Arial, sans-serif',
  display: '"Prompt", "SF Pro", -apple-system, BlinkMacSystemFont, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'
} as const
