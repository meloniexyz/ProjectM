import { Alert, ScrollView, Switch, View } from 'react-native'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { Button, Chip, Header, Row, Txt } from '../../components/ui'
import { cacheStore, clearCache, removeDownload, storageStats } from '../../lib/audioCache'
import { collectionProgress, downloadStore, setDownloaded } from '../../lib/downloads'
import { getPlayer } from '../../lib/player'
import { updateSettings, useSettings } from '../../lib/settings'
import { fmtBytes } from '../../lib/storage'
import { useColors, ui } from '../../lib/theme'

const LIMITS = [256, 512, 1024, 2048, 5120]

export default function StorageSettings() {
  const c = useColors()
  const s = useSettings()
  useStore(cacheStore, (st) => st.version)
  const collections = useStore(downloadStore, (st) => st.collections)
  const current = useStore(downloadStore, (st) => st.current)
  const paused = useStore(downloadStore, (st) => st.paused)
  const stats = storageStats()
  const playingUid = () => new Set([getPlayer().queue[getPlayer().index]?.track.uid].filter(Boolean) as string[])

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Downloads and storage" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <Row
          title="Offline mode"
          sub="Only play downloaded songs (and ones already saved on the phone)"
          icon="airplane-outline"
          right={<Switch accessibilityLabel="Offline mode" value={s.offlineMode} onValueChange={(v) => updateSettings({ offlineMode: v })} trackColor={{ true: c.accent }} />}
        />
        <View style={{ flexDirection: 'row', gap: 10, padding: ui.pad }}>
          <View style={{ flex: 1, backgroundColor: c.bg3, borderRadius: 10, padding: 14 }}>
            <Txt tone="text2" size={12}>
              Downloads
            </Txt>
            <Txt size={20} weight="800">
              {fmtBytes(stats.downloads)}
            </Txt>
            <Txt tone="text2" size={12}>
              {stats.downloadCount} songs
            </Txt>
          </View>
          <View style={{ flex: 1, backgroundColor: c.bg3, borderRadius: 10, padding: 14 }}>
            <Txt tone="text2" size={12}>
              Recently played (cache)
            </Txt>
            <Txt size={20} weight="800">
              {fmtBytes(stats.cache)}
            </Txt>
            <Txt tone="text2" size={12}>
              of {fmtBytes(s.cacheLimitMb * 1e6)}
            </Txt>
          </View>
        </View>

        <Txt size={16} weight="800" style={{ paddingHorizontal: ui.pad, marginTop: 6 }}>
          Cache size
        </Txt>
        <Txt tone="text2" size={13} style={{ paddingHorizontal: ui.pad, marginTop: 2 }}>
          Songs you play are kept here so replays need no data. The oldest are removed when it's full.
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: ui.pad }}>
          {LIMITS.map((mb) => (
            <Chip key={mb} label={mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`} active={s.cacheLimitMb === mb} onPress={() => updateSettings({ cacheLimitMb: mb })} />
          ))}
        </View>
        <Button
          small
          kind="secondary"
          title="Clear cache"
          style={{ alignSelf: 'flex-start', marginHorizontal: ui.pad }}
          onPress={() => clearCache(playingUid())}
        />

        <Txt size={16} weight="800" style={{ paddingHorizontal: ui.pad, marginTop: 26 }}>
          Downloaded for offline
        </Txt>
        {current ? (
          <Txt tone="text2" size={13} style={{ paddingHorizontal: ui.pad, marginTop: 2 }}>
            Downloading {current.done + 1} of {current.total}: {current.title}
          </Txt>
        ) : paused ? (
          <Txt tone="text2" size={13} style={{ paddingHorizontal: ui.pad, marginTop: 2 }}>
            {paused}
          </Txt>
        ) : null}
        {Object.values(collections).length ? (
          Object.values(collections).map((col) => {
            const p = collectionProgress(col)
            return (
              <Row
                key={col.key}
                title={col.name}
                sub={`${p.done} of ${p.total} downloaded`}
                icon="arrow-down-circle"
                right={
                  <Button
                    small
                    kind="ghost"
                    title="Remove"
                    onPress={() =>
                      Alert.alert(`Remove "${col.name}" from downloads?`, 'Its songs stay in the cache until space is needed.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: () => setDownloaded(col.key, col.name, col.tracks, false) },
                      ])
                    }
                  />
                }
              />
            )
          })
        ) : (
          <Txt tone="text2" size={13} style={{ paddingHorizontal: ui.pad, marginTop: 6 }}>
            Turn on Download on a playlist or Liked Songs to listen without a connection.
          </Txt>
        )}
        {Object.values(collections).length ? (
          <Button
            small
            kind="danger"
            title="Remove all downloads"
            style={{ alignSelf: 'flex-start', margin: ui.pad }}
            onPress={() =>
              Alert.alert('Remove all downloads?', 'Downloaded songs are deleted from this phone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove all',
                  style: 'destructive',
                  onPress: () => {
                    for (const col of Object.values(collections)) {
                      setDownloaded(col.key, col.name, col.tracks, false)
                      for (const t of col.tracks) removeDownload(t.uid)
                    }
                  },
                },
              ])
            }
          />
        ) : null}
      </ScrollView>
    </View>
  )
}
