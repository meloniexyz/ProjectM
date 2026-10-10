import { useEffect, useRef } from 'react'
import { Animated, Easing, FlatList, Pressable, View, type ListRenderItem } from 'react-native'
import type { Track } from '../../../src/shared/types'
import { fmtTime } from '../../../src/renderer/src/lib/format'
import { useStore } from '../../../src/renderer/src/lib/store'
import { cacheStore, isDownloaded } from '../lib/audioCache'
import { availableNow, playTracks, usePlayer } from '../lib/player'
import { useConnection } from '../lib/net'
import { SOURCES } from '../lib/sources'
import { useColors, ui } from '../lib/theme'
import { openTrackSheet } from '../lib/ui'
import { useSettings } from '../lib/settings'
import { Artwork, Icon, IconButton, Txt } from './ui'

/** Three little bars for the playing song (animated on the GPU: transform only). */
export function Bars({ playing }: { playing: boolean }) {
  const c = useColors()
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0.4))).current
  useEffect(() => {
    if (!playing) {
      vals.forEach((v) => v.stopAnimation())
      return
    }
    const loops = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 380 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 380 + i * 90, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [playing, vals])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14, width: 14 }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 3, height: 14, backgroundColor: c.accent, borderRadius: 1, transform: [{ translateY: 7 }, { scaleY: v }, { translateY: -7 }] }} />
      ))}
    </View>
  )
}

export function TrackRow({
  track,
  onPress,
  playlistId,
  index,
  showSource = true,
}: {
  track: Track
  onPress: () => void
  playlistId?: string
  index?: number
  showSource?: boolean
}) {
  const c = useColors()
  const currentUid = usePlayer((s) => s.queue[s.index]?.track.uid)
  const playing = usePlayer((s) => s.playing)
  useStore(cacheStore, (s) => s.version)
  useConnection()
  useSettings()
  const active = currentUid === track.uid
  const downloaded = track.source !== 'local' && isDownloaded(track.uid)
  const available = availableNow(track)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${track.title} by ${track.artist}`}
      testID={`track-${index ?? 0}`}
      onPress={onPress}
      onLongPress={() => openTrackSheet(track, { playlistId })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: ui.pad,
        paddingVertical: 7,
        backgroundColor: pressed ? c.hover : 'transparent',
        opacity: available ? 1 : 0.38,
      })}
    >
      <Artwork src={track.artwork} size={48} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {active ? <Bars playing={playing} /> : null}
          <Txt size={15} weight="600" lines={1} tone={active ? 'accent' : 'text'} style={{ flexShrink: 1 }}>
            {track.title}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }}>
          {downloaded ? <Icon name="arrow-down-circle" size={13} color={c.accent} /> : null}
          {showSource ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: SOURCES[track.source].color }} /> : null}
          <Txt tone="text2" size={13} lines={1} style={{ flexShrink: 1 }}>
            {track.artist}
            {track.duration ? ` · ${fmtTime(track.duration)}` : ''}
          </Txt>
        </View>
      </View>
      <IconButton name="ellipsis-horizontal" size={20} color={c.text2} label={`More for ${track.title}`} onPress={() => openTrackSheet(track, { playlistId })} />
    </Pressable>
  )
}

/** A list of songs; tapping one plays the list from there. */
export function TrackList({
  tracks,
  header,
  footer,
  playlistId,
  onRefresh,
  refreshing,
  empty,
}: {
  tracks: Track[]
  header?: React.ReactElement | null
  footer?: React.ReactElement | null
  playlistId?: string
  onRefresh?: () => void
  refreshing?: boolean
  empty?: React.ReactElement | null
}) {
  const render: ListRenderItem<Track> = ({ item, index }) => (
    <TrackRow track={item} index={index} playlistId={playlistId} onPress={() => playTracks(tracks, index)} />
  )
  return (
    <FlatList
      data={tracks}
      keyExtractor={(t, i) => `${t.uid}:${i}`}
      renderItem={render}
      ListHeaderComponent={header}
      ListFooterComponent={footer ?? <View style={{ height: 140 }} />}
      ListEmptyComponent={empty}
      onRefresh={onRefresh}
      refreshing={refreshing ?? false}
      initialNumToRender={14}
      windowSize={9}
      removeClippedSubviews
    />
  )
}
