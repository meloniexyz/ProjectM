import { useMemo, useState } from 'react'
import { Alert, FlatList, Pressable, ScrollView, View } from 'react-native'
import type { ListenEntry } from '../../../src/shared/types'
import { fmtTime } from '../../../src/renderer/src/lib/format'
import { useStore } from '../../../src/renderer/src/lib/store'
import { Artwork, Button, Chip, Empty, Header, Txt } from '../components/ui'
import { clearHistory, formatRanges, historyStore, stats, type Tally } from '../lib/history'
import { playTracks } from '../lib/player'
import { SOURCES } from '../lib/sources'
import { useColors, ui } from '../lib/theme'
import { openTrackSheet } from '../lib/ui'

const dayLabel = (t: number) => {
  const d = new Date(t)
  const today = new Date()
  const yest = new Date(Date.now() - 864e5)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const hours = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`)

type Item = { kind: 'day'; label: string; key: string } | { kind: 'entry'; e: ListenEntry; key: string }

export default function History() {
  const c = useColors()
  const entries = useStore(historyStore, (s) => s.entries)
  const [tab, setTab] = useState<'timeline' | 'stats'>('timeline')
  const items = useMemo(() => {
    const out: Item[] = []
    let last = ''
    for (const e of entries.slice(0, 1500)) {
      const label = dayLabel(e.startedAt)
      if (label !== last) {
        out.push({ kind: 'day', label, key: `d-${e.startedAt}` })
        last = label
      }
      out.push({ kind: 'entry', e, key: e.id })
    }
    return out
  }, [entries])

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header
        title="Listening history"
        right={
          entries.length ? (
            <Button
              small
              kind="ghost"
              title="Clear"
              onPress={() =>
                Alert.alert('Clear listening history?', 'Every recorded play is removed from this phone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: clearHistory },
                ])
              }
            />
          ) : null
        }
      />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: ui.pad, paddingBottom: 8 }}>
        <Chip label="Timeline" active={tab === 'timeline'} onPress={() => setTab('timeline')} />
        <Chip label="Stats" active={tab === 'stats'} onPress={() => setTab('stats')} />
      </View>
      {!entries.length ? (
        <Empty icon="time-outline" title="Nothing played yet" text="Every song you play shows up here, with the parts you listened to." />
      ) : tab === 'timeline' ? (
        <FlatList
          data={items}
          keyExtractor={(i) => i.key}
          contentContainerStyle={{ paddingBottom: 60 }}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <Txt size={15} weight="800" style={{ paddingHorizontal: ui.pad, paddingTop: 16, paddingBottom: 6 }}>
                {item.label}
              </Txt>
            ) : (
              <Pressable
                onPress={() => playTracks([item.e.track])}
                onLongPress={() => openTrackSheet(item.e.track)}
                style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: ui.pad, paddingVertical: 6, backgroundColor: pressed ? c.hover : 'transparent' })}
              >
                <Artwork src={item.e.track.artwork} size={44} />
                <View style={{ flex: 1 }}>
                  <Txt weight="600" lines={1}>
                    {item.e.track.title}
                  </Txt>
                  <Txt tone="text2" size={12} lines={1}>
                    {item.e.track.artist} · {SOURCES[item.e.track.source].short}
                    {item.e.via ? ` → ${SOURCES[item.e.via].short}` : ''}
                  </Txt>
                  <Txt tone="text3" size={12} lines={1}>
                    {formatRanges(item.e.segments, fmtTime) || 'a few seconds'}
                  </Txt>
                </View>
                <Txt tone="text3" size={12}>
                  {clock(item.e.startedAt)}
                </Txt>
              </Pressable>
            )
          }
        />
      ) : (
        <Stats entries={entries} />
      )}
    </View>
  )
}

const RANGES = [
  { label: '7 days', ms: 7 * 864e5 },
  { label: '4 weeks', ms: 28 * 864e5 },
  { label: '6 months', ms: 182 * 864e5 },
  { label: 'All time', ms: Infinity },
]

function Stats({ entries }: { entries: ListenEntry[] }) {
  const c = useColors()
  const [range, setRange] = useState(0)
  const s = useMemo(() => stats(entries, RANGES[range].ms === Infinity ? 0 : Date.now() - RANGES[range].ms), [entries, range])
  const list = (title: string, items: Tally[]) =>
    items.length ? (
      <View style={{ marginTop: 18 }}>
        <Txt size={18} weight="800" style={{ paddingHorizontal: ui.pad, marginBottom: 6 }}>
          {title}
        </Txt>
        {items.map((t, i) => (
          <Pressable
            key={t.key}
            onPress={() => t.track && playTracks([t.track])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: ui.pad, paddingVertical: 5 }}
          >
            <Txt tone="text3" size={13} style={{ width: 18, textAlign: 'right' }}>
              {i + 1}
            </Txt>
            <Artwork src={t.artwork} size={40} radius={title === 'Top artists' ? 20 : 4} />
            <View style={{ flex: 1 }}>
              <Txt weight="600" lines={1}>
                {t.label}
              </Txt>
              {t.sub ? (
                <Txt tone="text2" size={12} lines={1}>
                  {t.sub}
                </Txt>
              ) : null}
            </View>
            <Txt tone="text2" size={12}>
              {t.plays} play{t.plays === 1 ? '' : 's'}
            </Txt>
          </Pressable>
        ))}
      </View>
    ) : null
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: ui.pad, flexWrap: 'wrap' }}>
        {RANGES.map((r, i) => (
          <Chip key={r.label} label={r.label} active={range === i} onPress={() => setRange(i)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: ui.pad, marginTop: 14 }}>
        <View style={{ flex: 1, backgroundColor: c.bg3, borderRadius: 10, padding: 14 }}>
          <Txt tone="text2" size={12}>
            Listening time
          </Txt>
          <Txt size={22} weight="800">
            {hours(s.seconds)}
          </Txt>
        </View>
        <View style={{ flex: 1, backgroundColor: c.bg3, borderRadius: 10, padding: 14 }}>
          <Txt tone="text2" size={12}>
            Plays
          </Txt>
          <Txt size={22} weight="800">
            {s.plays.toLocaleString()}
          </Txt>
        </View>
      </View>
      {list('Top songs', s.tracks)}
      {list('Top artists', s.artists)}
      {list('Top albums', s.albums)}
    </ScrollView>
  )
}
