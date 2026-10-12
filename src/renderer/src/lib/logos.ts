import { useSettings } from './settings'
import { themeById } from './themes'

/**
 * The ProjectM logo, drawn in the accent colour: the M ("mark") or round M ("avatar"), on the
 * theme's surface, on dark charcoal, or filled with the colour ("dark" M). Same artwork as the
 * logo pack (ProjectM-logos), so any accent colour works, including custom ones.
 */
export const LOGO_VARIANTS = [
  { id: 'mark-onsurface', name: 'M · surface' },
  { id: 'mark-darkm', name: 'M · dark' },
  { id: 'mark-charcoal', name: 'M · charcoal' },
  { id: 'avatar-onsurface', name: 'Round · surface' },
  { id: 'avatar-darkm', name: 'Round · dark' },
  { id: 'avatar-charcoal', name: 'Round · charcoal' },
] as const

const lighten = (hex: string, amount: number) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`
}

export function logoSvg(variant: string, accent: string, themeId: string) {
  const t = themeById(themeId)
  const [shape, bg] = variant.split('-') as ['mark' | 'avatar', 'onsurface' | 'darkm' | 'charcoal']
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${lighten(accent, 0.22)}"/></linearGradient></defs>`
  const surface = bg === 'onsurface' ? `fill="${t.bg2}" stroke="${t.line2}" stroke-width="2"` : bg === 'charcoal' ? 'fill="#111116" stroke="#1f1f28" stroke-width="2"' : 'fill="url(#g)"'
  const base = shape === 'avatar' ? `<circle cx="50" cy="50" r="${bg === 'darkm' ? 48 : 47}" ${surface}/>` : `<rect x="2" y="2" width="96" height="96" rx="26" ${surface}/>`
  const m = shape === 'avatar' ? 'M31 70 V34 L50 57 L69 34 V70' : 'M31 71 V33 L50 57 L69 33 V71'
  const stroke = bg === 'darkm' ? '#0c0a18' : 'url(#g)'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${grad}${base}<path d="${m}" fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

export const logoUrl = (variant: string, accent: string, themeId: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg(variant, accent, themeId))}`

/** The logo for the current accent colour, theme and chosen style. */
export function useLogo() {
  const s = useSettings()
  return logoUrl(s.logo, s.accent ?? themeById(s.theme).accent, s.theme)
}

/** Draws the logo as a PNG and makes it the window, taskbar, desktop and Start menu icon. */
export async function applyAppIcon(variant: string, accent: string, themeId: string) {
  const img = new Image()
  img.src = logoUrl(variant, accent, themeId)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  canvas.getContext('2d')!.drawImage(img, 0, 0, 256, 256)
  await window.api.app.setIcon(canvas.toDataURL('image/png'))
}
