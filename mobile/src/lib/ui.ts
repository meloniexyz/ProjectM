import type { Track } from '../../../src/shared/types'
import { createStore } from '../../../src/renderer/src/lib/store'

/** Short messages at the bottom of the screen. */
export const toastStore = createStore<{ items: { id: number; text: string }[] }>({ items: [] })
let toastId = 0

export function toast(text: string) {
  const id = ++toastId
  toastStore.set((s) => ({ items: [...s.items.slice(-2), { id, text }] }))
  setTimeout(() => toastStore.set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 3200)
}

/** The song whose action sheet (long press / ⋯) is open. */
export const trackSheetStore = createStore<{ track: Track | null; playlistId?: string; queueIndex?: number }>({ track: null })
export const openTrackSheet = (track: Track, ctx: { playlistId?: string; queueIndex?: number } = {}) =>
  trackSheetStore.set({ track, ...ctx })
export const closeTrackSheet = () => trackSheetStore.set({ track: null, playlistId: undefined, queueIndex: undefined })

/** The song being saved with the + button ("Save in" sheet). */
export const saveSheetStore = createStore<{ track: Track | null }>({ track: null })
export const openSaveSheet = (track: Track) => saveSheetStore.set({ track })
export const closeSaveSheet = () => saveSheetStore.set({ track: null })
