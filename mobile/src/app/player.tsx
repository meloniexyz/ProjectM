import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fmtTime } from '../../../src/renderer/src/lib/format'
import { LyricsCard, SongInfoCard } from '../components/Lyrics'
import { Slider } from '../components/Slider'
import { Artwork, Icon, IconButton, Txt } from '../components/ui'
import { cycleRepeat, next, prev, seek, sourceLabel, toggle, toggleShuffle, usePlayer } from '../lib/player'
import { useSettings } from '../lib/settings'
import { useColors, ui } from '../lib/theme'
import { openSaveSheet, openTrackSheet } from '../lib/ui'

export default function PlayerScreen() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const settings = useSettings()
  const track = usePlayer((s) => s.queue[s.index]?.track)
  const playing = usePlayer((s) => s.playing)
  const loading = usePlayer((s) => s.loading)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const quality = usePlayer((s) => s.quality)
  const via = usePlayer((s) => s.via)
  const error = usePlayer((s) => s.error)
  const [preview, setPreview] = useState<number | null>(null)

  if (!track) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }}>
        <Txt tone="text2">Nothing playing</Txt>
        <IconButton name="chevron-down" label="Close player" onPress={() => router.back()} />
      </View>
    )
  }

  const art = Math.min(width - ui.pad * 2, 420)
  const shown = preview ?? position
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 40, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
          <IconButton name="chevron-down" size={28} label="Close player" onPress={() => router.back()} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Txt tone="text2" size={11} weight="700">
              PLAYING FROM
            </Txt>
            <Txt size={13} weight="700" lines={1}>
              {sourceLabel(track, via)}
            </Txt>
          </View>
          <IconButton name="ellipsis-horizontal" label="More" onPress={() => openTrackSheet(track)} />
        </View>

        <View style={{ alignItems: 'center' }}>
          <Artwork src={track.artwork} size={art} radius={8} />
        </View>

        <View style={{ paddingHorizontal: ui.pad, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Txt size={22} weight="800" lines={1}>
              {track.title}
            </Txt>
            <Pressable onPress={() => {
              router.back()
              router.push({ pathname: '/search', params: { q: track.artist.split(',')[0] } })
            }}>
              <Txt tone="text2" size={16} lines={1}>
                {track.artist}
              </Txt>
            </Pressable>
          </View>
          <IconButton name="add-circle-outline" size={30} label="Save to playlist" onPress={() => openSaveSheet(track)} />
        </View>

        <View style={{ paddingHorizontal: ui.pad }}>
          <Slider
            label="Seek"
            value={duration ? shown / duration : 0}
            disabled={!duration || loading}
            onChange={(v) => setPreview(v * duration)}
            onCommit={(v) => {
              seek(v * duration)
              setPreview(null)
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Txt tone="text2" size={12}>
              {fmtTime(shown)}
            </Txt>
            <Txt tone="text2" size={12}>
              {fmtTime(duration)}
            </Txt>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: ui.pad + 4 }}>
          <IconButton name="shuffle" size={24} color={shuffle ? c.accent : c.text} label={shuffle ? 'Shuffle on' : 'Shuffle off'} onPress={toggleShuffle} />
          <IconButton name="play-skip-back" size={34} label="Previous" onPress={prev} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            testID="player-toggle"
            onPress={toggle}
            style={({ pressed }) => ({ width: 68, height: 68, borderRadius: 34, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
          >
            {loading ? <ActivityIndicator color={c.bg} /> : <Icon name={playing ? 'pause' : 'play'} size={32} color={c.bg} style={playing ? undefined : { marginLeft: 3 }} />}
          </Pressable>
          <IconButton name="play-skip-forward" size={34} label="Next" onPress={next} />
          <View>
            <IconButton name="repeat" size={24} color={repeat !== 'off' ? c.accent : c.text} label={`Repeat ${repeat}`} onPress={cycleRepeat} />
            {repeat === 'one' ? (
              <Txt size={9} weight="900" tone="accent" style={{ position: 'absolute', right: 2, top: 2 }}>
                1
              </Txt>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: ui.pad, flexWrap: 'wrap' }}>
          {quality ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.bg3 }}>
              <Txt tone="text2" size={12} weight="600" testID="quality-chip">
                {quality}
              </Txt>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Open queue" onPress={() => router.push('/queue')} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.bg3, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            <Icon name="list" size={14} color={c.text2} />
            <Txt tone="text2" size={12} weight="600">
              Queue
            </Txt>
          </Pressable>
        </View>
        {error ? (
          <Txt tone="text2" size={13} style={{ textAlign: 'center', paddingHorizontal: ui.pad }}>
            {error}
          </Txt>
        ) : null}

        {settings.showLyrics ? <LyricsCard track={track} /> : null}
        <SongInfoCard track={track} />
      </ScrollView>
    </View>
  )
}
