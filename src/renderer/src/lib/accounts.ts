import type { AccountStatus, RemotePlaylist, SourceId, Track } from '../../../shared/types'
import { cleanError } from './sources'
import { createStore, useStore } from './store'

/** Services you can sign in to, to see your own likes and playlists. */
export const ACCOUNT_SOURCES: SourceId[] = ['spotify', 'youtube', 'soundcloud']

export const accountStore = createStore<{ accounts: Partial<Record<SourceId, AccountStatus>> }>({ accounts: {} })

const api = window.api.accounts

export const useAccount = (source: SourceId) => useStore(accountStore, (s) => s.accounts[source])
export const isSignedIn = (source: SourceId) => !!accountStore.get().accounts[source]?.connected

function setStatus(source: SourceId, status: AccountStatus) {
  accountStore.set((s) => ({ accounts: { ...s.accounts, [source]: status } }))
}

/** The code to type at google.com/device while a YouTube sign-in is waiting. */
export const deviceCodeStore = createStore<{ code: { code: string; url: string } | null }>({ code: null })

let listening = false
export async function initAccounts() {
  if (!listening) {
    listening = true
    api.onCode((c) => deviceCodeStore.set({ code: { code: c.code, url: c.url } }))
  }
  await Promise.all(
    ACCOUNT_SOURCES.map((s) =>
      api.status(s).then(
        (status) => setStatus(s, status),
        () => setStatus(s, { connected: false, userName: null }),
      ),
    ),
  )
}

export async function connectAccount(source: SourceId, arg?: string) {
  try {
    setStatus(source, await api.login(source, arg))
    refreshAccount(source)
  } catch (err) {
    throw cleanError(err)
  } finally {
    deviceCodeStore.set({ code: null })
  }
}

export function cancelSignIn() {
  deviceCodeStore.set({ code: null })
  return api.cancel()
}

export async function disconnectAccount(source: SourceId) {
  refreshAccount(source)
  setStatus(source, await api.logout(source))
}

// Library calls are cached for the session; "Refresh" clears them.
const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let hit = cache.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = fn().catch((err) => {
      cache.delete(key)
      initAccounts() // a failed call may mean the login was dropped: refresh "connected" status
      throw cleanError(err)
    })
    cache.set(key, hit)
  }
  return hit
}

export const likedSongs = (s: SourceId) => cached<Track[]>(`${s}:liked`, () => api.liked(s))
export const topSongs = (s: SourceId) => cached<Track[]>(`${s}:top`, () => api.top(s))
export const remotePlaylists = (s: SourceId) => cached<RemotePlaylist[]>(`${s}:playlists`, () => api.playlists(s))
export const remotePlaylistTracks = (s: SourceId, id: string) =>
  cached<Track[]>(`${s}:playlist:${id}`, () => api.playlistTracks(s, id))

/** Forget one remote playlist's cached songs (after adding to it). */
export function forgetRemotePlaylist(source: SourceId, id: string) {
  cache.delete(`${source}:playlist:${id}`)
  cache.delete(`${source}:playlists`)
}

export function refreshAccount(source: SourceId) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${source}:`)) cache.delete(key)
}
