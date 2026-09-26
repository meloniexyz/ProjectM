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

export async function updateSettings(patch: Partial<Settings>) {
  // update the UI right away, then persist
  settingsStore.set((s) => ({ settings: { ...s.settings, ...patch } }))
  settingsStore.set({ settings: await window.api.settings.set(patch) })
}

/** Loudness targets, same idea as Spotify's Quiet / Normal / Loud. */
export const LOUDNESS_LUFS: Record<Settings['loudnessLevel'], number> = { quiet: -23, normal: -14, loud: -11 }
