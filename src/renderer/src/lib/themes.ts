/** A colour theme: surfaces from darkest (bg) to lightest (bg4), text tones and the accent. */
export interface Theme {
  id: string
  name: string
  bg: string
  bg1: string
  bg2: string
  bg3: string
  bg4: string
  hover: string
  line: string
  line2: string
  elev: string
  elev2: string
  text: string
  text2: string
  text3: string
  accent: string
}

export const THEMES: Theme[] = [
  { id: 'projectm', name: 'ProjectM', bg: '#09090c', bg1: '#111116', bg2: '#17171e', bg3: '#1f1f28', bg4: '#292935', hover: '#1a1a22', line: '#22222c', line2: '#2f2f3c', elev: '#20202a', elev2: '#2c2c39', text: '#ededf2', text2: '#a3a3b2', text3: '#6c6c7c', accent: '#8b7cff' },
  { id: 'green', name: 'Green Room', bg: '#000000', bg1: '#121212', bg2: '#181818', bg3: '#232323', bg4: '#2e2e2e', hover: '#1a1a1a', line: '#242424', line2: '#333333', elev: '#282828', elev2: '#3a3a3a', text: '#ffffff', text2: '#b3b3b3', text3: '#7a7a7a', accent: '#1ed760' },
  { id: 'midnight', name: 'Midnight', bg: '#060a13', bg1: '#0c1220', bg2: '#121a2c', bg3: '#1a243c', bg4: '#233050', hover: '#101829', line: '#18223a', line2: '#26324c', elev: '#162038', elev2: '#223050', text: '#e6ecff', text2: '#9aa7c4', text3: '#5f6b86', accent: '#4f8cff' },
  { id: 'crimson', name: 'Crimson', bg: '#0b0708', bg1: '#130d0e', bg2: '#1a1214', bg3: '#24191b', bg4: '#302124', hover: '#1c1416', line: '#261b1d', line2: '#36272a', elev: '#211719', elev2: '#302226', text: '#f3eaeb', text2: '#b9a4a7', text3: '#7e6b6e', accent: '#ff4d5e' },
  { id: 'sunset', name: 'Sunset', bg: '#0c0806', bg1: '#140e0b', bg2: '#1b1410', bg3: '#251b16', bg4: '#31241d', hover: '#1d1611', line: '#271e18', line2: '#372b23', elev: '#221913', elev2: '#31251d', text: '#f6ede7', text2: '#bdaa9d', text3: '#817164', accent: '#ff8a3d' },
  { id: 'rose', name: 'Rose', bg: '#0c070a', bg1: '#140c11', bg2: '#1b1117', bg3: '#25171f', bg4: '#311f29', hover: '#1d1218', line: '#27191f', line2: '#37252e', elev: '#22151c', elev2: '#31202a', text: '#f6eaf0', text2: '#bca4b1', text3: '#806975', accent: '#ff6fae' },
  { id: 'mint', name: 'Mint', bg: '#050f0c', bg1: '#0a1613', bg2: '#0f1e1a', bg3: '#162923', bg4: '#1e352e', hover: '#0e1b17', line: '#15261f', line2: '#20362e', elev: '#132520', elev2: '#1e352e', text: '#e6f5f0', text2: '#9dbcb2', text3: '#628076', accent: '#34d3a6' },
  { id: 'gold', name: 'Gold', bg: '#0b0a06', bg1: '#13110b', bg2: '#1a1810', bg3: '#242116', bg4: '#302c1e', hover: '#1b1911', line: '#252217', line2: '#353123', elev: '#211e13', elev2: '#302c1d', text: '#f5f1e4', text2: '#bdb59c', text3: '#817a63', accent: '#f5c542' },
  { id: 'graphite', name: 'Graphite', bg: '#0a0a0a', bg1: '#121212', bg2: '#191919', bg3: '#222222', bg4: '#2d2d2d', hover: '#1a1a1a', line: '#242424', line2: '#333333', elev: '#1f1f1f', elev2: '#2c2c2c', text: '#eeeeee', text2: '#a8a8a8', text3: '#6e6e6e', accent: '#e8e8ee' },
  { id: 'amoled', name: 'AMOLED Black', bg: '#000000', bg1: '#000000', bg2: '#0b0b0e', bg3: '#16161b', bg4: '#202027', hover: '#0e0e12', line: '#18181e', line2: '#26262e', elev: '#111116', elev2: '#1e1e25', text: '#f0f0f4', text2: '#a3a3b2', text3: '#66667a', accent: '#8b7cff' },
  { id: 'nord', name: 'Nord', bg: '#1b1f27', bg1: '#242933', bg2: '#2b313d', bg3: '#343b49', bg4: '#3e4656', hover: '#2a303b', line: '#313745', line2: '#3f4757', elev: '#2e3440', elev2: '#3b4252', text: '#eceff4', text2: '#c0c7d4', text3: '#818a9b', accent: '#88c0d0' },
  { id: 'dracula', name: 'Dracula', bg: '#1a1b23', bg1: '#21222c', bg2: '#282a36', bg3: '#313442', bg4: '#3b3e4f', hover: '#2a2c38', line: '#2e3040', line2: '#3c3f52', elev: '#2b2d3a', elev2: '#383b4c', text: '#f8f8f2', text2: '#c2c3d4', text3: '#7f82a0', accent: '#bd93f9' },
]

/** Preset accent colours for the "custom accent" picker. */
export const ACCENT_SWATCHES = ['#8b7cff', '#1ed760', '#4f8cff', '#ff4d5e', '#ff8a3d', '#ff6fae', '#34d3a6', '#f5c542', '#22d3ee', '#a3e635', '#f472b6', '#e8e8ee']

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Text colour on top of the accent (buttons): whichever of near-black/white reads better. */
const inkFor = (accent: string) => {
  const l = luminance(accent)
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#0c0a18' : '#ffffff'
}

export function themeById(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** Applies a theme (and optional custom accent) to the whole app via CSS variables. */
export function applyTheme(id: string, accentOverride?: string | null) {
  const t = themeById(id)
  const accent = accentOverride || t.accent
  const vars: Record<string, string> = {
    '--bg': t.bg,
    '--bg-1': t.bg1,
    '--bg-2': t.bg2,
    '--bg-3': t.bg3,
    '--bg-4': t.bg4,
    '--bg-hover': t.hover,
    '--line': t.line,
    '--line-2': t.line2,
    '--bg-elev': t.elev,
    '--bg-elev-2': t.elev2,
    '--text': t.text,
    '--text-2': t.text2,
    '--text-3': t.text3,
    '--accent': accent,
    '--accent-2': `color-mix(in srgb, ${accent} 78%, #ffffff)`,
    '--accent-ink': inkFor(accent),
  }
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v)
  // the native title bar buttons and window background follow the theme
  window.api.app.setWindowColors(t.bg, t.text2).catch(() => {})
}
