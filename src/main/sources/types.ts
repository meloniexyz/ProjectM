import type { StreamInfo, Track } from '../../shared/types'

export type { StreamInfo }

export interface StreamingSource {
  search(query: string, limit?: number): Promise<Track[]>
  resolve(id: string): Promise<StreamInfo>
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
