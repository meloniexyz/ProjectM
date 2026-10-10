import { useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { SourceId, Track } from '../../../../src/shared/types'
import { norm } from '../../../../src/renderer/src/lib/format'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { TrackList } from '../../components/TrackRow'
import { Chip, Empty, ErrorText, Icon, IconButton, Spinner, Txt } from '../../components/ui'
import { accountStore } from '../../lib/accounts'
import { libStore } from '../../lib/library'
import { canStream, useConnection } from '../../lib/net'
import { cleanError, search, SOURCES } from '../../lib/sources'
import { useColors, ui } from '../../lib/theme'

const cache = new Map<string, Track[]>()

export default function Search() {
  const c = useColors()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ q?: string }>()
  const [text, setText] = useState(params.q ?? '')
  const [query, setQuery] = useState(params.q ?? '')
  const [source, setSource] = useState<SourceId>('youtube')
  const [results, setResults] = useState<Track[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const spotifyOn = useStore(accountStore, (s) => !!s.accounts.spotify?.connected)
  const local = useStore(libStore, (s) => s.tracks)
  useConnection()

  useEffect(() => {
    if (params.q) {
      setText(params.q)
      setQuery(params.q)
    }
  }, [params.q])

  // wait for a pause in typing before searching (saves requests)
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 450)
    return () => clearTimeout(t)
  }, [text])

  const sources: SourceId[] = ['youtube', 'soundcloud', ...(spotifyOn ? (['spotify'] as SourceId[]) : []), 'local']

  const localResults = useMemo(() => {
    const q = norm(query)
    if (!q) return []
    return local.filter((t) => norm(`${t.title} ${t.artist} ${t.album}`).includes(q))
  }, [local, query])

  useEffect(() => {
    if (!query || source === 'local') {
      setResults(null)
      setError(null)
      return
    }
    const key = `${source}|${query.toLowerCase()}`
    const hit = cache.get(key)
    if (hit) {
      setResults(hit)
      setError(null)
      return
    }
    if (!canStream()) {
      setResults(null)
      setError("You're offline. Search works on your local files and downloads.")
      return
    }
    let live = true
    setLoading(true)
    setError(null)
    search(source, query)
      .then((r) => {
        if (!live) return
        cache.set(key, r)
        setResults(r)
      })
      .catch((err) => live && setError(cleanError(err).message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [query, source])

  const shown = source === 'local' ? localResults : (results ?? [])

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + 8 }}>
      <Txt size={ui.font.title} weight="800" style={{ paddingHorizontal: ui.pad, marginBottom: 10 }}>
        Search
      </Txt>
      <View style={{ marginHorizontal: ui.pad, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.text, borderRadius: 8, paddingHorizontal: 12 }}>
        <Icon name="search" size={20} color={c.bg} />
        <TextInput
          testID="search-input"
          accessibilityLabel="Search"
          value={text}
          onChangeText={setText}
          placeholder="What do you want to listen to?"
          placeholderTextColor="#666"
          returnKeyType="search"
          onSubmitEditing={() => setQuery(text.trim())}
          autoCorrect={false}
          style={{ flex: 1, color: c.bg, fontSize: 16, paddingVertical: 11, fontWeight: '600' }}
        />
        {text ? <IconButton name="close-circle" size={20} color={c.bg} label="Clear" onPress={() => setText('')} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, padding: ui.pad, paddingBottom: 6 }}>
        {sources.map((s) => (
          <Chip key={s} label={SOURCES[s].short} color={SOURCES[s].color} active={source === s} onPress={() => setSource(s)} />
        ))}
      </ScrollView>
      {loading && !shown.length ? <Spinner /> : null}
      {error ? <ErrorText text={error} /> : null}
      <TrackList
        tracks={shown}
        empty={
          query && !loading && !error ? (
            <Empty icon="search-outline" title={`No results for "${query}"`} text={source === 'local' ? 'Add music in Your Library → Local files.' : 'Try another spelling or another platform.'} />
          ) : !query ? (
            <Empty icon="musical-notes-outline" title="Search YouTube Music, SoundCloud and more" text="Songs from every platform play in the same queue." />
          ) : null
        }
      />
    </View>
  )
}
