import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RemotePlaylist, SourceId } from '../../../../src/shared/types'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { Artwork, Chip, Icon, IconButton, Row, Txt } from '../../components/ui'
import { ACCOUNT_SOURCES, accountStore, fetchers, keys, useList } from '../../lib/accounts'
import { downloadStore } from '../../lib/downloads'
import { createPlaylist, libStore } from '../../lib/library'
import { SOURCES } from '../../lib/sources'
import { useColors, ui } from '../../lib/theme'

function RemoteRows({ source }: { source: SourceId }) {
  const { data } = useList<RemotePlaylist[]>(keys.playlists(source), fetchers.playlists(source))
  return (
    <>
      {(data ?? []).map((p) => (
        <Row
          key={`${source}:${p.id}`}
          title={p.name}
          sub={`${SOURCES[source].name} playlist${p.total ? ` · ${p.total} songs` : ''}${p.owner ? ` · ${p.owner}` : ''}`}
          left={<Artwork src={p.artwork} size={52} />}
          onPress={() => router.push({ pathname: '/remote/[source]/[id]', params: { source, id: p.id, name: p.name } })}
        />
      ))}
    </>
  )
}

type Filter = 'all' | 'playlists' | SourceId

export default function Library() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const playlists = useStore(libStore, (s) => s.playlists)
  const localCount = useStore(libStore, (s) => s.tracks.length)
  const accounts = useStore(accountStore, (s) => s.accounts)
  const dl = useStore(downloadStore, (s) => s)
  const connected = ACCOUNT_SOURCES.filter((s) => accounts[s]?.connected)
  const [filter, setFilter] = useState<Filter>('all')
  const show = (f: Filter) => filter === 'all' || filter === f

  const newPlaylist = () => {
    const open = (name?: string) => router.push({ pathname: '/playlist/[id]', params: { id: createPlaylist([], name) } })
    if (Platform.OS === 'ios') Alert.prompt('New playlist', 'Give it a name', (name) => open(name))
    else open()
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: ui.pad }}>
        <Txt size={ui.font.title} weight="800" style={{ flex: 1 }}>
          Your Library
        </Txt>
        <IconButton name="add" size={28} label="New playlist" onPress={newPlaylist} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, padding: ui.pad, paddingBottom: 8 }}>
        <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Playlists" active={filter === 'playlists'} onPress={() => setFilter('playlists')} />
        {connected.map((s) => (
          <Chip key={s} label={SOURCES[s].short} color={SOURCES[s].color} active={filter === s} onPress={() => setFilter(s)} />
        ))}
        <Chip label="Local" color={SOURCES.local.color} active={filter === 'local'} onPress={() => setFilter('local')} />
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        {dl.current || dl.paused ? (
          <Row
            title={dl.current ? `Downloading ${dl.current.done + 1} of ${dl.current.total}` : 'Downloads waiting'}
            sub={dl.current ? dl.current.title : (dl.paused ?? undefined)}
            icon="arrow-down-circle"
            onPress={() => router.push('/settings/storage')}
            chevron
          />
        ) : null}

        {connected
          .filter((s) => show(s))
          .map((s) => (
            <Row
              key={`liked-${s}`}
              title="Liked Songs"
              sub={SOURCES[s].name}
              left={
                <View style={{ width: 52, height: 52, borderRadius: 4, backgroundColor: SOURCES[s].color, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="heart" size={24} color="#fff" />
                </View>
              }
              onPress={() => router.push({ pathname: '/liked/[source]', params: { source: s } })}
              testID={`liked-${s}`}
            />
          ))}

        {(filter === 'all' || filter === 'playlists') &&
          playlists.map((p) => (
            <Row
              key={p.id}
              title={p.name}
              sub={`ProjectM playlist · ${p.tracks.length} song${p.tracks.length === 1 ? '' : 's'}`}
              left={<Artwork src={p.cover ?? p.tracks[0]?.artwork} size={52} />}
              onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: p.id } })}
            />
          ))}

        {show('local') ? (
          <Row
            title="Local files"
            sub={`${localCount} song${localCount === 1 ? '' : 's'} on this phone`}
            left={
              <View style={{ width: 52, height: 52, borderRadius: 4, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="folder" size={24} color={SOURCES.local.color} />
              </View>
            }
            onPress={() => router.push('/local')}
          />
        ) : null}

        {connected
          .filter((s) => filter === 'playlists' || show(s))
          .map((s) => (
            <RemoteRows key={`pl-${s}`} source={s} />
          ))}

        {filter === 'all' ? (
          <>
            <Row title="Listening history" sub="Everything you played, and your stats" icon="time-outline" onPress={() => router.push('/history')} chevron />
            {!connected.length ? (
              <Row title="Connect your accounts" sub="Bring in your liked songs and playlists from Spotify, YouTube Music and SoundCloud" icon="person-add-outline" onPress={() => router.push('/settings/accounts')} chevron />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}
