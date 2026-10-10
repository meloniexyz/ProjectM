import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { collator } from '../../../src/renderer/src/lib/format'
import { useStore } from '../../../src/renderer/src/lib/store'
import { TrackList } from '../components/TrackRow'
import { Button, Chip, Empty, Header, Txt } from '../components/ui'
import { importSongs, libStore, scanMusic } from '../lib/library'
import { useColors, ui } from '../lib/theme'
import { toast } from '../lib/ui'

type Sort = 'title' | 'artist' | 'album'

export default function LocalFiles() {
  const c = useColors()
  const tracks = useStore(libStore, (s) => s.tracks)
  const scanning = useStore(libStore, (s) => s.scanning)
  const [sort, setSort] = useState<Sort>('title')
  const sorted = useMemo(() => [...tracks].sort((a, b) => collator.compare(a[sort], b[sort])), [tracks, sort])
  const add = async () => {
    const n = await importSongs()
    if (n) toast(`Added ${n} song${n === 1 ? '' : 's'}`)
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Local files" right={<Button small title="Add songs" icon="add" onPress={add} />} />
      <TrackList
        tracks={sorted}
        onRefresh={() => scanMusic()}
        refreshing={scanning}
        header={
          <View style={{ paddingHorizontal: ui.pad, paddingBottom: 8, gap: 10 }}>
            <Txt tone="text2" size={13}>
              Songs on this phone. Add them with the button above, or copy files into "On My iPhone → ProjectM → Music" in the Files app (or from a PC with iTunes / the Apple Devices app), then pull down to refresh.
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['title', 'artist', 'album'] as Sort[]).map((s) => (
                <Chip key={s} label={s[0].toUpperCase() + s.slice(1)} active={sort === s} onPress={() => setSort(s)} />
              ))}
            </View>
          </View>
        }
        empty={!scanning ? <Empty icon="folder-open-outline" title="No local songs yet" text="MP3, AAC/M4A, ALAC, FLAC, WAV and AIFF work." action={<Button small kind="secondary" title="Add songs" onPress={add} />} /> : null}
      />
    </View>
  )
}
