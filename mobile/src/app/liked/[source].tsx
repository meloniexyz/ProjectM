import { useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { View } from 'react-native'
import type { SourceId, Track } from '../../../../src/shared/types'
import { CollectionHeader } from '../../components/CollectionHeader'
import { TrackList } from '../../components/TrackRow'
import { Empty, ErrorText, Header, Icon, Spinner } from '../../components/ui'
import { fetchers, keys, useAccount, useList } from '../../lib/accounts'
import { updateCollection } from '../../lib/downloads'
import { SOURCES } from '../../lib/sources'
import { useColors } from '../../lib/theme'

export default function Liked() {
  const c = useColors()
  const { source } = useLocalSearchParams<{ source: SourceId }>()
  const account = useAccount(source)
  const key = keys.liked(source)
  const { data, loading, error, refresh } = useList<Track[]>(account?.connected ? key : null, account?.connected ? fetchers.liked(source) : null)
  const tracks = data ?? []
  useEffect(() => {
    if (data) updateCollection(key, data)
  }, [data, key])
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title={`Liked Songs · ${SOURCES[source]?.name ?? ''}`} />
      <TrackList
        tracks={tracks}
        onRefresh={refresh}
        refreshing={loading && !!data}
        header={
          <>
            <CollectionHeader
              title="Liked Songs"
              sub={`${SOURCES[source]?.name}${account?.userName ? ` · ${account.userName}` : ''}`}
              tracks={tracks}
              downloadKey={key}
              art={
                <View style={{ width: 200, height: 200, borderRadius: 6, backgroundColor: SOURCES[source]?.color ?? c.bg3, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="heart" size={80} color="#fff" />
                </View>
              }
            />
            {loading && !data ? <Spinner /> : null}
            {error ? <ErrorText text={error} onRetry={refresh} /> : null}
          </>
        }
        empty={!loading && !error && data ? <Empty icon="heart-outline" title="No liked songs yet" /> : null}
      />
    </View>
  )
}
