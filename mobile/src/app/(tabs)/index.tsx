import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RemotePlaylist, SourceId, Track } from '../../../../src/shared/types'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { Artwork, Chip, Icon, IconButton, SectionTitle, Txt } from '../../components/ui'
import { ACCOUNT_SOURCES, accountStore, fetchers, keys, useList } from '../../lib/accounts'
import { historyStore, mostPlayed, recentTracks } from '../../lib/history'
import { libStore } from '../../lib/library'
import { useConnection } from '../../lib/net'
import { playTracks } from '../../lib/player'
import { SOURCES } from '../../lib/sources'
import { useColors, ui } from '../../lib/theme'
import { openTrackSheet } from '../../lib/ui'
import { useSettings } from '../../lib/settings'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** 2-column tile, like Spotify's "Jump back in". */
function Tile({ title, artwork, onPress, onLongPress }: { title: string; artwork?: string; onPress: () => void; onLongPress?: () => void }) {
  const c = useColors()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: pressed ? c.bg4 : c.bg3, borderRadius: 6, overflow: 'hidden' })}
    >
      <Artwork src={artwork} size={52} radius={0} />
      <Txt size={13} weight="700" lines={2} style={{ flex: 1, paddingRight: 6 }}>
        {title}
      </Txt>
    </Pressable>
  )
}

function Card({ title, sub, artwork, onPress }: { title: string; sub?: string; artwork?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={{ width: 132 }}>
      <Artwork src={artwork} size={132} radius={6} />
      <Txt size={13} weight="700" lines={1} style={{ marginTop: 6 }}>
        {title}
      </Txt>
      {sub ? (
        <Txt tone="text2" size={12} lines={1}>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
  )
}

function SongRow({ tracks, index }: { tracks: Track[]; index: number }) {
  const t = tracks[index]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.title}
      onPress={() => playTracks(tracks, index)}
      onLongPress={() => openTrackSheet(t)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: ui.pad, paddingVertical: 6 }}
    >
      <Txt tone="text3" size={13} style={{ width: 18, textAlign: 'right' }}>
        {index + 1}
      </Txt>
      <Artwork src={t.artwork} size={44} />
      <View style={{ flex: 1 }}>
        <Txt size={14} weight="600" lines={1}>
          {t.title}
        </Txt>
        <Txt tone="text2" size={12} lines={1}>
          {t.artist}
        </Txt>
      </View>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: SOURCES[t.source].color }} />
    </Pressable>
  )
}

function SpotifyTop() {
  const { data } = useList(keys.top('spotify'), fetchers.top('spotify'))
  const list = (data ?? []).slice(0, 10)
  return (
    <>
      {list.map((_, i) => (
        <SongRow key={list[i].uid} tracks={list} index={i} />
      ))}
    </>
  )
}

function RemotePlaylistRail({ source }: { source: SourceId }) {
  const { data } = useList<RemotePlaylist[]>(keys.playlists(source), fetchers.playlists(source))
  if (!data?.length) return null
  return (
    <>
      {data.slice(0, 20).map((p) => (
        <Card
          key={`${source}:${p.id}`}
          title={p.name}
          sub={SOURCES[source].name}
          artwork={p.artwork}
          onPress={() => router.push({ pathname: '/remote/[source]/[id]', params: { source, id: p.id, name: p.name } })}
        />
      ))}
    </>
  )
}

export default function Home() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  useSettings()
  useConnection()
  const entries = useStore(historyStore, (s) => s.entries)
  const playlists = useStore(libStore, (s) => s.playlists)
  const accounts = useStore(accountStore, (s) => s.accounts)
  const connected = ACCOUNT_SOURCES.filter((s) => accounts[s]?.connected)
  const recent = useMemo(() => recentTracks(entries, 6), [entries])
  const top = useMemo(() => mostPlayed(entries, 10).map((t) => t.track!).filter(Boolean), [entries])
  const [topTab, setTopTab] = useState<'here' | 'spotify'>('here')

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 40 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: ui.pad }}>
        <Txt size={ui.font.title} weight="800" style={{ flex: 1 }}>
          {greeting()}
        </Txt>
        <IconButton name="time-outline" label="Listening history" onPress={() => router.push('/history')} />
        <IconButton name="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
      </View>

      {recent.length ? (
        <>
          <SectionTitle title="Jump back in" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: ui.pad }}>
            {recent.map((t, i) => (
              <Tile key={t.uid} title={t.title} artwork={t.artwork} onPress={() => playTracks(recent, i)} onLongPress={() => openTrackSheet(t)} />
            ))}
          </View>
        </>
      ) : (
        <View style={{ padding: ui.pad, gap: 6 }}>
          <Txt tone="text2" size={15}>
            Search for something to play, or connect your accounts in Settings to bring in your liked songs and playlists.
          </Txt>
        </View>
      )}

      {(top.length > 0 || accounts.spotify?.connected) && (
        <>
          <SectionTitle title="Top songs" />
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: ui.pad, marginBottom: 6 }}>
            <Chip label="Most played here" active={topTab === 'here'} onPress={() => setTopTab('here')} />
            {accounts.spotify?.connected ? <Chip label="Spotify" color={SOURCES.spotify.color} active={topTab === 'spotify'} onPress={() => setTopTab('spotify')} /> : null}
          </View>
          {topTab === 'here' ? top.map((_, i) => <SongRow key={top[i].uid} tracks={top} index={i} />) : <SpotifyTop />}
          {topTab === 'here' && !top.length ? (
            <Txt tone="text2" size={14} style={{ paddingHorizontal: ui.pad }}>
              Songs you play more than once show up here.
            </Txt>
          ) : null}
        </>
      )}

      {connected.length ? (
        <>
          <SectionTitle title="Liked Songs" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: ui.pad }}>
            {connected.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityLabel={`Liked Songs on ${SOURCES[s].name}`}
                onPress={() => router.push({ pathname: '/liked/[source]', params: { source: s } })}
                style={{ width: 132 }}
              >
                <View style={{ width: 132, height: 132, borderRadius: 6, backgroundColor: SOURCES[s].color, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="heart" size={44} color="#fff" />
                </View>
                <Txt size={13} weight="700" style={{ marginTop: 6 }}>
                  Liked Songs
                </Txt>
                <Txt tone="text2" size={12}>
                  {SOURCES[s].name}
                </Txt>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      {(playlists.length > 0 || connected.length > 0) && (
        <>
          <SectionTitle title="Your playlists" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: ui.pad }}>
            {playlists.map((p) => (
              <Card
                key={p.id}
                title={p.name}
                sub="ProjectM"
                artwork={p.cover ?? p.tracks[0]?.artwork}
                onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: p.id } })}
              />
            ))}
            {connected.map((s) => (
              <RemotePlaylistRail key={s} source={s} />
            ))}
          </ScrollView>
        </>
      )}
    </ScrollView>
  )
}
