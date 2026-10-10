import type { EqSettings } from '../../../src/shared/types'
import { createStore, useStore } from '../../../src/renderer/src/lib/store'
import { JsonFile } from './storage'

/** Spotify-style quality steps. What each means per source is in quality.ts. */
export type Quality = 'low' | 'mid' | 'best'

export interface MobileSettings {
  /** streaming quality on Wi-Fi */
  wifiQuality: Quality
  /** streaming quality on mobile data */
  cellularQuality: Quality
  /** quality of songs saved for offline listening */
  downloadQuality: Quality
  /** let offline downloads run on mobile data (off = Wi-Fi only, like Spotify) */
  downloadOnCellular: boolean
  /** only play what's downloaded; no network use at all for music */
  offlineMode: boolean
  /** room for recently played songs (MB); played songs are kept so replays use no data */
  cacheLimitMb: number
  /** loudness all songs are leveled to, like Spotify's Quiet / Normal / Loud */
  loudnessLevel: 'quiet' | 'normal' | 'loud'
  normalize: boolean
  eq: EqSettings
  theme: string
  accent: string | null
  showLyrics: boolean
  /** hide local audio under 30 s (samples, voice memos) */
  hideShortClips: boolean
}

export const DEFAULT_MOBILE_SETTINGS: MobileSettings = {
  wifiQuality: 'best',
  cellularQuality: 'mid',
  downloadQuality: 'best',
  downloadOnCellular: false,
  offlineMode: false,
  cacheLimitMb: 1024,
  loudnessLevel: 'normal',
  normalize: true,
  eq: { enabled: false, bands: 7, gains: [0, 0, 0, 0, 0, 0, 0], preset: 'Flat', custom: [] },
  theme: 'amoled',
  accent: '#ff4d5e',
  showLyrics: true,
  hideShortClips: true,
}

export const LOUDNESS_LUFS: Record<MobileSettings['loudnessLevel'], number> = { quiet: -23, normal: -14, loud: -11 }

const file = new JsonFile<Partial<MobileSettings>>('settings.json', {})
export const settingsStore = createStore<{ settings: MobileSettings }>({ settings: DEFAULT_MOBILE_SETTINGS })

export function initSettings() {
  settingsStore.set({ settings: { ...DEFAULT_MOBILE_SETTINGS, ...file.load() } })
}

export const getSettings = () => settingsStore.get().settings
export const useSettings = () => useStore(settingsStore, (s) => s.settings)

export function updateSettings(patch: Partial<MobileSettings>) {
  const settings = { ...getSettings(), ...patch }
  settingsStore.set({ settings })
  file.set(settings)
}
