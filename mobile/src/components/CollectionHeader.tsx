import type { ReactNode } from 'react'
import { Switch, View } from 'react-native'
import type { Track } from '../../../src/shared/types'
import { fmtTotal } from '../../../src/renderer/src/lib/format'
import { useStore } from '../../../src/renderer/src/lib/store'
import { cacheStore } from '../lib/audioCache'
import { collectionProgress, downloadStore, setDownloaded, useCollection } from '../lib/downloads'
import { playTracks } from '../lib/player'
import { useColors, ui } from '../lib/theme'
import { Artwork, Button, Icon, Txt } from './ui'

/** Cover, title, Play / Shuffle and the Download switch for a playlist-like page. */
export function CollectionHeader({
  title,
  sub,
  artwork,
  art,
  tracks,
  downloadKey,
  extra,
}: {
  title: string
  sub?: string
  artwork?: string
  /** custom cover (e.g. the Liked Songs heart) instead of an image */
  art?: ReactNode
  tracks: Track[]
  downloadKey?: string
  extra?: ReactNode
}) {
  const c = useColors()
  const collection = useCollection(downloadKey ?? '')
  useStore(cacheStore, (s) => s.version)
  const running = useStore(downloadStore, (s) => s.current)
  const paused = useStore(downloadStore, (s) => s.paused)
  const on = !!collection
  const progress = collection ? collectionProgress(collection) : null
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0)

  return (
    <View style={{ paddingHorizontal: ui.pad, paddingBottom: 10, gap: 12 }}>
      <View style={{ alignItems: 'center', paddingTop: 4 }}>{art ?? <Artwork src={artwork} size={200} radius={6} />}</View>
      <View>
        <Txt size={24} weight="800" lines={2}>
          {title}
        </Txt>
        <Txt tone="text2" size={13} style={{ marginTop: 4 }}>
          {[sub, `${tracks.length} song${tracks.length === 1 ? '' : 's'}`, total ? fmtTotal(total) : null].filter(Boolean).join(' · ')}
        </Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {downloadKey ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Icon name={on && progress && progress.done === progress.total ? 'arrow-down-circle' : 'arrow-down-circle-outline'} size={24} color={on ? c.accent : c.text2} />
            <View style={{ flex: 1 }}>
              <Txt size={13} weight="700">
                Download
              </Txt>
              {on && progress ? (
                <Txt tone="text2" size={11} lines={1}>
                  {progress.done === progress.total
                    ? 'Available offline'
                    : running
                      ? `${progress.done} of ${progress.total} downloaded`
                      : `${progress.done} of ${progress.total} · ${paused ?? 'waiting'}`}
                </Txt>
              ) : null}
            </View>
            <Switch
              testID="download-switch"
              accessibilityLabel="Download for offline listening"
              value={on}
              onValueChange={(v) => setDownloaded(downloadKey, title, tracks, v)}
              trackColor={{ true: c.accent }}
            />
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Button small kind="secondary" icon="shuffle" title="Shuffle" disabled={!tracks.length} onPress={() => playTracks(tracks, Math.floor(Math.random() * tracks.length), true)} />
        <Button small icon="play" title="Play" disabled={!tracks.length} onPress={() => playTracks(tracks, 0, false)} />
      </View>
      {extra}
    </View>
  )
}
