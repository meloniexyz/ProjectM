import { FlatList, Pressable, View } from 'react-native'
import { Artwork, Button, Header, IconButton, Txt } from '../components/ui'
import { clearUpcoming, jump, removeAt, usePlayer } from '../lib/player'
import { useColors, ui } from '../lib/theme'

export default function Queue() {
  const c = useColors()
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const upcoming = queue.slice(index + 1).map((q, i) => ({ ...q, at: index + 1 + i }))
  const cur = queue[index]
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Queue" right={upcoming.length ? <Button small kind="ghost" title="Clear" onPress={clearUpcoming} /> : null} />
      <FlatList
        data={upcoming.slice(0, 300)}
        keyExtractor={(q) => String(q.key)}
        ListHeaderComponent={
          cur ? (
            <View style={{ paddingHorizontal: ui.pad, paddingBottom: 8 }}>
              <Txt size={15} weight="800" style={{ marginBottom: 8 }}>
                Now playing
              </Txt>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Artwork src={cur.track.artwork} size={48} />
                <View style={{ flex: 1 }}>
                  <Txt tone="accent" weight="700" lines={1}>
                    {cur.track.title}
                  </Txt>
                  <Txt tone="text2" size={13} lines={1}>
                    {cur.track.artist}
                  </Txt>
                </View>
              </View>
              <Txt size={15} weight="800" style={{ marginTop: 18 }}>
                Next up
              </Txt>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Play ${item.track.title}`}
            onPress={() => jump(item.at)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: ui.pad, paddingVertical: 6, backgroundColor: pressed ? c.hover : 'transparent' })}
          >
            <Artwork src={item.track.artwork} size={44} />
            <View style={{ flex: 1 }}>
              <Txt weight="600" lines={1}>
                {item.track.title}
              </Txt>
              <Txt tone="text2" size={13} lines={1}>
                {item.track.artist}
              </Txt>
            </View>
            <IconButton name="remove-circle-outline" size={22} color={c.text2} label={`Remove ${item.track.title}`} onPress={() => removeAt(item.at)} />
          </Pressable>
        )}
        ListEmptyComponent={
          <Txt tone="text2" style={{ padding: ui.pad }}>
            Nothing queued after this song.
          </Txt>
        }
      />
    </View>
  )
}
