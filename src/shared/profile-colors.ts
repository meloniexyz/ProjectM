// Identical copy in ProjectMobile: src/core/profile-colors.ts

/** Default profile colours, like Discord's: a profile with no photo or banner gets one of these. */
const PALETTE = ['#5865f2', '#eb459e', '#3ba55c', '#faa61a', '#ed4245', '#9b59b6', '#1abc9c', '#e67e22', '#3498db', '#f47fff']

/**
 * The solid colour of a profile without pictures (its photo behind the letter, and its banner).
 * Picked from the @username (or name), so a person has the same colour on every device.
 */
export function defaultProfileColor(key: string | null | undefined) {
  let h = 0
  for (const ch of (key ?? '').toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Text colour that reads on a background colour (#rrggbb). */
export function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#111111' : '#ffffff'
}
