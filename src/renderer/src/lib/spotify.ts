import type { SpotifyPlaylist, SpotifyStatus, Track } from '../../../shared/types'
import { cleanError } from './sources'
import { createStore } from './store'

export const spotifyStore = createStore<{ status: SpotifyStatus | null }>({ status: null })

const api = window.api.spotify

export async function initSpotify() {
  spotifyStore.set({ status: await api.status() })
}

export async function connectSpotify(clientId: string) {
  try {
    spotifyStore.set({ status: await api.login(clientId) })
  } catch (err) {
    throw cleanError(err)
  }
}

export async function disconnectSpotify() {
  cache.clear()
  spotifyStore.set({ status: await api.logout() })
}

// Library calls are cached for the session; "Refresh" clears them.
const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let hit = cache.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = fn().catch((err) => {
      cache.delete(key)
      throw cleanError(err)
    })
    cache.set(key, hit)
  }
  return hit
}

export const likedSongs = () => cached<Track[]>('liked', api.liked)
export const spotifyPlaylists = () => cached<SpotifyPlaylist[]>('playlists', api.playlists)
export const spotifyPlaylistTracks = (id: string) => cached<Track[]>(`playlist:${id}`, () => api.playlistTracks(id))
export const refreshSpotify = () => cache.clear()
