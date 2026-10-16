import type { AccountStatus, Entity, EntityKind, EntityPage, RemotePlaylist, StreamInfo, Track } from '../../shared/types'

export type { StreamInfo }

export interface StreamingSource {
  search(query: string, limit?: number): Promise<Track[]>
  resolve(id: string): Promise<StreamInfo>
  /** artists, public playlists or profiles (search tabs) */
  searchEntities?(query: string, kind: EntityKind): Promise<Entity[]>
  /** what opening one shows */
  entityPage?(entity: Entity): Promise<EntityPage>
  /** new releases from the people you follow (Home); single songs longer than maxSeconds are left out (0 = any length) */
  newReleases?(maxSeconds: number): Promise<Entity[]>
}

/** A source you can sign in to, exposing your own library. */
export interface AccountSource {
  status(): Promise<AccountStatus> | AccountStatus
  login(arg?: string): Promise<AccountStatus>
  logout(): Promise<void>
  liked(): Promise<Track[]>
  playlists(): Promise<RemotePlaylist[]>
  playlistTracks(id: string): Promise<Track[]>
  /** whether each song is in your liked songs on this platform (if the platform supports it) */
  isLiked?(ids: string[]): Promise<boolean[]>
  /** like / unlike a song on this platform */
  setLiked?(id: string, liked: boolean): Promise<void>
  /** add a song (this platform's id) to one of your playlists on this platform */
  addToPlaylist?(playlistId: string, trackId: string): Promise<void>
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
