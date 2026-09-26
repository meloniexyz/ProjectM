import { DEFAULT_SETTINGS, type Settings } from '../../../shared/types'
import { createStore, useStore } from './store'

export const settingsStore = createStore<{ settings: Settings; ready: boolean }>({
  settings: DEFAULT_SETTINGS,
  ready: false,
})

export const getSettings = () => settingsStore.get().settings
export const useSettings = () => useStore(settingsStore, (s) => s.settings)

export async function initSettings() {
  settingsStore.set({ settings: await window.api.settings.get(), ready: true })
}

let pending: Partial<Settings> = {}
let saveTimer = 0

/** Updates the UI immediately; writes to disk shortly after (batched, for things like dragging). */
export function updateSettings(patch: Partial<Settings>) {
  settingsStore.set((s) => ({ settings: { ...s.settings, ...patch } }))
  pending = { ...pending, ...patch }
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    const toSave = pending
    pending = {}
    window.api.settings.set(toSave).catch(() => {})
  }, 300)
}

/** Loudness targets, same idea as Spotify's Quiet / Normal / Loud. */
export const LOUDNESS_LUFS: Record<Settings['loudnessLevel'], number> = { quiet: -23, normal: -14, loud: -11 }
