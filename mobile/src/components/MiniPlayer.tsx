import { router } from 'expo-router'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { toggle, usePlayer } from '../lib/player'
import { useColors } from '../lib/theme'
import { openSaveSheet } from '../lib/ui'
import { Artwork, IconButton, Txt } from './ui'

/** The bar above the tabs: what's playing, play/pause and save. Tap to open the full player. */
export function MiniPlayer() {
  const c = useColors()
  const track = usePlayer((s) => s.queue[s.index]?.track)
  const playing = usePlayer((s) => s.playing)
  const loading = usePlayer((s) => s.loading)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  if (!track) return null
  const progress = duration ? Math.min(1, position / duration) : 0
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open player"
      testID="mini-player"
      onPress={() => router.push('/player')}
      style={{ marginHorizontal: 8, marginBottom: 6, borderRadius: 8, backgroundColor: c.elev, overflow: 'hidden' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 10 }}>
        <Artwork src={track.artwork} size={40} radius={4} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} weight="700" lines={1}>
            {track.title}
          </Txt>
          <Txt tone="text2" size={12} lines={1}>
            {track.artist}
          </Txt>
        </View>
        <IconButton name="add-circle-outline" size={26} label="Save" onPress={() => openSaveSheet(track)} />
        {loading ? (
          <ActivityIndicator color={c.text} style={{ width: 38 }} />
        ) : (
          <IconButton name={playing ? 'pause' : 'play'} size={28} label={playing ? 'Pause' : 'Play'} onPress={toggle} />
        )}
      </View>
      <View style={{ height: 2, backgroundColor: c.bg4, marginHorizontal: 8 }}>
        <View style={{ height: 2, width: `${progress * 100}%`, backgroundColor: c.text }} />
      </View>
    </Pressable>
  )
}
