import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { Lyrics as LyricsData, SongInfo, Track } from '../../../src/shared/types'
import { getLyrics } from '../../../src/main/lyrics'
import { getSongInfo } from '../../../src/main/songinfo'
import { canStream } from '../lib/net'
import { seek, usePlayer } from '../lib/player'
import { JsonFile } from '../lib/storage'
import { useColors, ui } from '../lib/theme'
import { Chip, Txt } from './ui'

/** Per song: which lyrics version you picked and how much you nudged the timing. */
const prefs = new JsonFile<Record<string, { id?: number; offset?: number }>>('lyrics-prefs.json', {})
/** Lyrics already fetched, kept so replays don't use data. */
const saved = new JsonFile<Record<string, LyricsData[]>>('lyrics-cache.json', {})

function useLyrics(track: Track) {
  const [options, setOptions] = useState<LyricsData[] | null>(() => saved.get()[track.uid] ?? null)
  useEffect(() => {
    let live = true
    const hit = saved.get()[track.uid]
    if (hit) {
      setOptions(hit)
      return
    }
    setOptions(null)
    if (!canStream()) {
      setOptions([])
      return
    }
    getLyrics(track.title, track.artist, track.album, track.duration).then((list) => {
      if (!live) return
      setOptions(list)
      const all = saved.get()
      const keys = Object.keys(all)
      const trimmed = keys.length > 800 ? Object.fromEntries(keys.slice(-600).map((k) => [k, all[k]])) : all
      saved.set({ ...trimmed, [track.uid]: list })
    })
    return () => {
      live = false
    }
  }, [track.uid, track.title, track.artist, track.album, track.duration])
  return options
}

export function LyricsCard({ track }: { track: Track }) {
  const c = useColors()
  const options = useLyrics(track)
  const duration = usePlayer((s) => s.duration)
  const position = usePlayer((s) => s.position)
  const [choice, setChoice] = useState<number | undefined>(() => prefs.get()[track.uid]?.id)
  const [offset, setOffset] = useState(() => prefs.get()[track.uid]?.offset ?? 0)
  const scroll = useRef<ScrollView>(null)
  const lineY = useRef<Record<number, number>>({})
  const boxH = useRef(300)

  useEffect(() => {
    setChoice(prefs.get()[track.uid]?.id)
    setOffset(prefs.get()[track.uid]?.offset ?? 0)
    lineY.current = {}
  }, [track.uid])

  // the version timed to the recording that's playing: closest length, unless you picked one
  const lyrics = useMemo(() => {
    if (!options?.length) return null
    const picked = choice != null ? options.find((o) => o.id === choice) : undefined
    if (picked) return picked
    const len = duration || track.duration
    return [...options].sort((a, b) => Number(!!b.synced) - Number(!!a.synced) || Math.abs((a.duration ?? len) - len) - Math.abs((b.duration ?? len) - len))[0]
  }, [options, choice, duration, track.duration])

  const lines = lyrics?.synced ?? null
  const at = position + offset
  let current = -1
  if (lines) for (let i = 0; i < lines.length; i++) if (lines[i].time <= at) current = i

  // keep the current line in the middle of the box
  useEffect(() => {
    if (current < 0) return
    const y = lineY.current[current]
    if (y == null) return
    scroll.current?.scrollTo({ y: Math.max(0, y - boxH.current / 2 + 20), animated: true })
  }, [current])

  const setPref = (patch: { id?: number; offset?: number }) => prefs.set({ ...prefs.get(), [track.uid]: { ...prefs.get()[track.uid], ...patch } })
  const nudge = (d: number) => {
    const next = Math.round((offset + d) * 10) / 10
    setOffset(next)
    setPref({ offset: next })
  }

  return (
    <View style={{ marginHorizontal: ui.pad, borderRadius: 10, backgroundColor: c.accentSoft, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt size={16} weight="800" style={{ flex: 1 }}>
          Lyrics
        </Txt>
        {lines ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Chip label="−0.5s" onPress={() => nudge(-0.5)} />
            <Txt tone="text2" size={12} style={{ minWidth: 44, textAlign: 'center' }}>
              {offset === 0 ? 'In sync' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}
            </Txt>
            <Chip label="+0.5s" onPress={() => nudge(0.5)} />
          </View>
        ) : null}
      </View>
      {options === null ? (
        <Txt tone="text2">Looking for lyrics…</Txt>
      ) : !lyrics ? (
        <Txt tone="text2">{canStream() ? 'No lyrics found for this song.' : 'Lyrics need a connection the first time.'}</Txt>
      ) : lyrics.instrumental ? (
        <Txt tone="text2">Instrumental</Txt>
      ) : lines ? (
        <ScrollView ref={scroll} style={{ maxHeight: 320 }} onLayout={(e) => (boxH.current = e.nativeEvent.layout.height)} nestedScrollEnabled>
          {lines.map((l, i) => (
            <Pressable key={i} onPress={() => seek(Math.max(0, l.time - offset))} onLayout={(e) => (lineY.current[i] = e.nativeEvent.layout.y)}>
              <Txt
                size={20}
                weight="800"
                style={{ paddingVertical: 5, color: i === current ? c.text : i < current ? c.text2 : c.text3 }}
              >
                {l.text || (i === current ? '♪ ♪ ♪' : '♪')}
              </Txt>
            </Pressable>
          ))}
          <View style={{ height: 120 }} />
        </ScrollView>
      ) : (
        <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
          <Txt size={17} weight="600" style={{ lineHeight: 26 }}>
            {lyrics.plain}
          </Txt>
        </ScrollView>
      )}
      {options && options.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {options.slice(0, 5).map((o, i) => (
            <Chip
              key={o.id ?? i}
              label={`${o.label ?? `Version ${i + 1}`}${o.duration ? ` · ${Math.floor(o.duration / 60)}:${String(Math.round(o.duration % 60)).padStart(2, '0')}` : ''}`}
              active={lyrics?.id === o.id}
              onPress={() => {
                setChoice(o.id)
                setPref({ id: o.id })
              }}
            />
          ))}
        </View>
      ) : null}
      <Txt tone="text3" size={11}>
        Lyrics from LRCLIB
      </Txt>
    </View>
  )
}

export function SongInfoCard({ track }: { track: Track }) {
  const c = useColors()
  const [info, setInfo] = useState<SongInfo | null | undefined>(undefined)
  useEffect(() => {
    if (!canStream()) return setInfo(null)
    let live = true
    setInfo(undefined)
    getSongInfo(track.title, track.artist, track.duration).then((i) => live && setInfo(i))
    return () => {
      live = false
    }
  }, [track.title, track.artist, track.duration])
  if (!info) return null
  return (
    <View style={{ marginHorizontal: ui.pad, borderRadius: 10, backgroundColor: c.bg3, padding: 14, gap: 6 }}>
      <Txt size={16} weight="800">
        About this song
      </Txt>
      {info.album ? <Txt tone="text2">{`${info.albumType ? `${info.albumType}: ` : ''}${info.album}`}</Txt> : null}
      {info.released ? <Txt tone="text2">Released {info.released}</Txt> : null}
      {info.recordedAt.slice(0, 3).map((r, i) => (
        <Txt key={i} tone="text2">
          {`${r.what[0].toUpperCase()}${r.what.slice(1)} at ${r.place}${r.area ? `, ${r.area}` : ''}${r.date ? ` (${r.date}${r.until && r.until !== r.date ? ` – ${r.until}` : ''})` : ''}`}
        </Txt>
      ))}
      {info.credits.slice(0, 6).map((cr, i) => (
        <Txt key={`c${i}`} tone="text2" size={13}>
          <Txt size={13} weight="700">
            {cr.role}:{' '}
          </Txt>
          {cr.names.join(', ')}
        </Txt>
      ))}
      <Txt tone="text3" size={11}>
        From MusicBrainz
      </Txt>
    </View>
  )
}
