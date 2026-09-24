import type { AccountStatus, RemotePlaylist, StreamInfo, Track } from '../../shared/types'

export type { StreamInfo }

export interface StreamingSource {
  search(query: string, limit?: number): Promise<Track[]>
  resolve(id: string): Promise<StreamInfo>
}

/** A source you can sign in to, exposing your own library. */
export interface AccountSource {
  status(): Promise<AccountStatus> | AccountStatus
  login(arg?: string): Promise<AccountStatus>
  logout(): Promise<void>
  liked(): Promise<Track[]>
  playlists(): Promise<RemotePlaylist[]>
  playlistTracks(id: string): Promise<Track[]>
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
