import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountStatus, RemotePlaylist, SourceId, Track } from '../../../src/shared/types'
import { createStore, useStore } from '../../../src/renderer/src/lib/store'
import { canStream, onWifi } from './net'
import { cleanError, soundcloud, spotify, youtube } from './sources'
import type { DeviceCode } from './sources/youtube'
import { JsonFile } from './storage'

export const ACCOUNT_SOURCES: SourceId[] = ['spotify', 'youtube', 'soundcloud']

export const accountStore = createStore<{ accounts: Partial<Record<SourceId, AccountStatus>> }>({ accounts: {} })
export const useAccount = (s: SourceId) => useStore(accountStore, (st) => st.accounts[s])
export const isConnected = (s: SourceId) => !!accountStore.get().accounts[s]?.connected

/** The code to type at google.com/device while a YouTube sign-in waits. */
export const deviceCodeStore = createStore<{ code: DeviceCode | null }>({ code: null })
youtube.onDeviceCode = (code) => deviceCodeStore.set({ code })

function statusOf(s: SourceId): AccountStatus {
  if (s === 'youtube') return youtube.status()
  if (s === 'soundcloud') return soundcloud.status()
  if (s === 'spotify') return spotify.status()
  return { connected: false, userName: null }
}

export function refreshStatuses() {
  const accounts: Partial<Record<SourceId, AccountStatus>> = {}
  for (const s of ACCOUNT_SOURCES) accounts[s] = statusOf(s)
  accountStore.set({ accounts })
}

export function initAccounts() {
  refreshStatuses()
  // YouTube looks up your name in the background; pick it up a bit later
  setTimeout(refreshStatuses, 4000)
}

export async function connectYouTube() {
  try {
    await youtube.login()
  } finally {
    deviceCodeStore.set({ code: null })
    refreshStatuses()
  }
}
export function cancelYouTube() {
  youtube.cancelLogin()
}

export async function connectSoundCloud(input: string) {
  await soundcloud.connect(input)
  forget('soundcloud')
  refreshStatuses()
}

export async function disconnect(source: SourceId) {
  if (source === 'youtube') await youtube.logout()
  if (source === 'soundcloud') soundcloud.logout()
  if (source === 'spotify') await spotify.logout()
  forget(source)
  refreshStatuses()
}

// ---------- your libraries, kept on the phone ----------

/** Lists from the services, saved so they open instantly and work offline. */
const lists = new JsonFile<Record<string, { at: number; data: unknown }>>('library-cache.json', {})
const listsStore = createStore<{ version: number }>({ version: 0 })

function forget(source: SourceId) {
  const next = { ...lists.get() }
  for (const k of Object.keys(next)) if (k.includes(`:${source}`)) delete next[k]
  lists.set(next)
  listsStore.set((s) => ({ version: s.version + 1 }))
}

export function forgetList(key: string) {
  const next = { ...lists.get() }
  delete next[key]
  lists.set(next)
  listsStore.set((s) => ({ version: s.version + 1 }))
}

const HOUR = 3600_000
/** How long a saved list is used before asking the service again (longer on mobile data). */
const maxAge = (key: string) => {
  const base = key.startsWith('top:') ? 24 * HOUR : key.startsWith('liked:') ? 6 * HOUR : 12 * HOUR
  return onWifi() ? base : base * 4
}

const running = new Map<string, Promise<unknown>>()

async function fetchList<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  let job = running.get(key) as Promise<T> | undefined
  if (!job) {
    job = fetcher()
      .then((data) => {
        lists.set({ ...lists.get(), [key]: { at: Date.now(), data } })
        if (key === 'liked:youtube') youtube.rememberLiked(data as unknown as Track[])
        return data
      })
      .finally(() => running.delete(key))
    running.set(key, job)
  }
  return job
}

export function cachedList<T>(key: string): T | null {
  return (lists.get()[key]?.data as T) ?? null
}

/** A saved list, refreshed from the service when it's old (or when `force`). */
export async function getList<T>(key: string, fetcher: () => Promise<T>, force = false): Promise<T> {
  const hit = lists.get()[key]
  if (hit && !force && (Date.now() - hit.at < maxAge(key) || !canStream())) return hit.data as T
  if (!canStream()) {
    if (hit) return hit.data as T
    throw new Error("You're offline")
  }
  try {
    return await fetchList(key, fetcher)
  } catch (err) {
    if (hit) return hit.data as T // couldn't refresh: show what we have
    throw cleanError(err)
  }
}

export const fetchers = {
  liked: (s: SourceId): (() => Promise<Track[]>) =>
    s === 'youtube' ? () => youtube.liked() : s === 'soundcloud' ? () => soundcloud.liked() : () => spotify.liked(),
  top: (s: SourceId): (() => Promise<Track[]>) => (s === 'spotify' ? () => spotify.top() : fetchers.liked(s)),
  playlists: (s: SourceId): (() => Promise<RemotePlaylist[]>) =>
    s === 'youtube' ? () => youtube.playlists() : s === 'soundcloud' ? () => soundcloud.playlists() : () => spotify.playlists(),
  playlistTracks: (s: SourceId, id: string): (() => Promise<Track[]>) =>
    s === 'youtube'
      ? () => youtube.playlistTracks(id)
      : s === 'soundcloud'
        ? () => soundcloud.playlistTracks(id)
        : () => spotify.playlistTracks(id),
}

export const keys = {
  liked: (s: SourceId) => `liked:${s}`,
  top: (s: SourceId) => `top:${s}`,
  playlists: (s: SourceId) => `playlists:${s}`,
  playlist: (s: SourceId, id: string) => `playlist:${s}:${id}`,
}

/** React hook: a saved list plus loading/error state and a refresh function. */
export function useList<T>(key: string | null, fetcher: (() => Promise<T>) | null) {
  const version = useStore(listsStore, (s) => s.version)
  const [data, setData] = useState<T | null>(() => (key ? cachedList<T>(key) : null))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(
    async (force: boolean) => {
      if (!key || !fetcherRef.current) return
      setLoading(true)
      setError(null)
      try {
        setData(await getList(key, fetcherRef.current, force))
      } catch (err) {
        setError(cleanError(err).message)
      } finally {
        setLoading(false)
      }
    },
    [key],
  )

  useEffect(() => {
    setData(key ? cachedList<T>(key) : null)
    load(false)
  }, [key, version, load])

  return { data, loading, error, refresh: () => load(true) }
}

// ---------- likes and remote playlist edits ----------

export const canLike = (s: SourceId) => (s === 'youtube' || s === 'spotify') && isConnected(s)

export async function isLikedOn(track: Track): Promise<boolean> {
  if (!canLike(track.source)) return false
  if (track.source === 'youtube') return (await youtube.isLiked([track.id]))[0]
  const cached = cachedList<Track[]>(keys.liked('spotify'))
  if (cached) return cached.some((t) => t.id === track.id)
  return (await spotify.isLiked([track.id]))[0]
}

export async function setLikedOn(track: Track, liked: boolean) {
  if (track.source === 'youtube') await youtube.setLiked(track.id, liked)
  else if (track.source === 'spotify') await spotify.setLiked(track.id, liked)
  else throw new Error("This platform doesn't let other apps save likes")
  // update the saved list right away
  const key = keys.liked(track.source)
  const cur = cachedList<Track[]>(key)
  if (cur) {
    const next = liked ? [{ ...track, likedAt: Date.now() }, ...cur.filter((t) => t.uid !== track.uid)] : cur.filter((t) => t.uid !== track.uid)
    lists.set({ ...lists.get(), [key]: { at: lists.get()[key]?.at ?? Date.now(), data: next } })
    listsStore.set((s) => ({ version: s.version + 1 }))
  }
}

export async function addToRemotePlaylist(source: SourceId, playlistId: string, track: Track) {
  if (source === 'youtube') await youtube.addToPlaylist(playlistId, track.id)
  else if (source === 'spotify') await spotify.addToPlaylist(playlistId, track.id)
  else throw new Error("SoundCloud doesn't let other apps add to playlists")
  forgetList(keys.playlist(source, playlistId))
}
