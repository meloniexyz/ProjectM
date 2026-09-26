import type { SourceId } from '../../../shared/types'
import { ACCOUNT_SOURCES, accountStore, likedSongs } from './accounts'
import { createStore } from './store'

/** Song counts for the sidebar's Liked Songs entries (the lists themselves are cached in accounts.ts). */
export const likedCountStore = createStore<{ counts: Partial<Record<SourceId, number>> }>({ counts: {} })

const loading = new Set<SourceId>()

/** Loads each connected platform's liked songs in the background so the pages open instantly. */
export function preloadLiked() {
  const { accounts } = accountStore.get()
  for (const s of ACCOUNT_SOURCES) {
    if (!accounts[s]?.connected || loading.has(s) || likedCountStore.get().counts[s] != null) continue
    loading.add(s)
    likedSongs(s)
      .then((tracks) => likedCountStore.set((st) => ({ counts: { ...st.counts, [s]: tracks.length } })))
      .catch(() => {})
      .finally(() => loading.delete(s))
  }
}

export function forgetLikedCount(source: SourceId) {
  likedCountStore.set((st) => {
    const counts = { ...st.counts }
    delete counts[source]
    return { counts }
  })
}

// (re)load whenever an account connects
accountStore.subscribe(() => preloadLiked())
