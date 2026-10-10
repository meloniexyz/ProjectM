import { File } from 'expo-file-system'
import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { Track } from '../../../../src/shared/types'
import { getLyrics } from '../../../../src/main/lyrics'
import { getSongInfo } from '../../../../src/main/songinfo'
import { PRESETS, curveToBands } from '../../../../src/renderer/src/lib/eq'
import { hasNativeAudio, NativeAudio } from '../../../modules/projectm-audio'
import { Button, Header, Icon, Txt } from '../../components/ui'
import { ensureOnPhone, fileUri, lookup, removeDownload } from '../../lib/audioCache'
import { eqFilters } from '../../lib/eq'
import { getPlayer, playTracks, toggle } from '../../lib/player'
import { DEFAULT_MOBILE_SETTINGS } from '../../lib/settings'
import { resolvePlan, soundcloud, youtube } from '../../lib/sources'
import { dataDir } from '../../lib/storage'
import { useColors, ui } from '../../lib/theme'

interface Result {
  name: string
  ok: boolean
  detail: string
  ms: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Self-test of everything that talks to the outside world or the audio engine. */
async function runAll(report: (r: Result) => void) {
  const run = async (name: string, fn: () => Promise<string>) => {
    const t0 = Date.now()
    try {
      const detail = await fn()
      report({ name, ok: true, detail, ms: Date.now() - t0 })
      return true
    } catch (err) {
      report({ name, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 })
      return false
    }
  }

  await run('Native audio engine', async () => {
    if (!hasNativeAudio) throw new Error('not loaded (web preview?)')
    const s = await NativeAudio.getState()
    return `ok (queued ${String((s as { queued?: number }).queued ?? 0)})`
  })

  let yt: Track | null = null
  await run('YouTube search', async () => {
    const r = await youtube.search('Daft Punk One More Time', 5)
    if (!r.length) throw new Error('no results')
    yt = r[0]
    return `${r.length} results, first: ${r[0].title} – ${r[0].artist}`
  })

  await run('YouTube playback token', async () => {
    const s = await youtube.potSession()
    return `token ${s.token.length} chars, valid until ${new Date(s.expiresAt).toLocaleTimeString()}`
  })

  let ytFile: string | null = null
  if (yt) {
    const track: Track = yt
    await run('YouTube download (mid)', async () => {
      removeDownload(track.uid)
      const e = await ensureOnPhone(track, 'mid')
      ytFile = fileUri(e)
      return `${e.label}, ${(e.bytes / 1e6).toFixed(2)} MB, gain ${e.gainDb?.toFixed(1) ?? '?'} dB`
    })
  }

  if (ytFile) {
    const uri: string = ytFile
    await run('Loudness measurement', async () => {
      const lufs = await NativeAudio.measureLoudness(uri)
      if (lufs == null) throw new Error('no result')
      return `${lufs.toFixed(1)} LUFS`
    })
  }

  if (yt) {
    const track: Track = yt
    await run('Playback (YouTube)', async () => {
      playTracks([track], 0, false)
      for (let i = 0; i < 30 && !(getPlayer().playing && getPlayer().position > 1.5); i++) await sleep(500)
      const s = getPlayer()
      if (!s.playing || s.position < 1.5) throw new Error(`not playing (position ${s.position.toFixed(1)} s, error: ${s.error ?? 'none'})`)
      const pos = s.position
      toggle()
      return `played to ${pos.toFixed(1)} s · ${s.quality ?? ''}`
    })
  }

  let sc: Track | null = null
  await run('SoundCloud search', async () => {
    const r = await soundcloud.search('alan walker faded', 5)
    if (!r.length) throw new Error('no results')
    sc = r[0]
    return `${r.length} results, first: ${r[0].title}`
  })
  if (sc) {
    const track: Track = sc
    await run('SoundCloud download (best, AAC over HLS)', async () => {
      removeDownload(track.uid)
      const e = await ensureOnPhone(track, 'best')
      return `${e.label}, ${(e.bytes / 1e6).toFixed(2)} MB`
    })
    await run('Playback (SoundCloud)', async () => {
      playTracks([track], 0, false)
      for (let i = 0; i < 30 && !(getPlayer().playing && getPlayer().position > 1.5); i++) await sleep(500)
      const s = getPlayer()
      if (!s.playing || s.position < 1.5) throw new Error(`not playing (position ${s.position.toFixed(1)} s, error: ${s.error ?? 'none'})`)
      toggle()
      return `played to ${s.position.toFixed(1)} s · ${s.quality ?? ''}`
    })
    await run('SoundCloud low quality plan', async () => {
      const p = await soundcloud.plan(track.id, 'low')
      return `${p.quality} (${p.kind})`
    })
  }

  await run('Spotify song → YouTube/SoundCloud match', async () => {
    const fake: Track = { uid: 'spotify:diag', source: 'spotify', id: 'diag', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 }
    const r = await resolvePlan(fake, 'mid')
    return `${r.via?.source}: ${r.via?.title} · ${r.plan.quality}`
  })

  await run('Lyrics (LRCLIB)', async () => {
    const l = await getLyrics('One More Time', 'Daft Punk', 'Discovery', 320)
    if (!l.length) throw new Error('none found')
    return `${l.length} versions, synced: ${l.some((x) => x.synced) ? 'yes' : 'no'}`
  })

  await run('Song info (MusicBrainz)', async () => {
    const i = await getSongInfo('One More Time', 'Daft Punk', 320)
    if (!i) throw new Error('not found')
    return `${i.album ?? '?'} · ${i.released ?? '?'}`
  })

  await run('Equalizer solver', async () => {
    const bass = PRESETS.find((p) => /bass/i.test(p.name)) ?? PRESETS[1]
    const t0 = Date.now()
    const { filters, peakRiseDb } = eqFilters({ ...DEFAULT_MOBILE_SETTINGS.eq, enabled: true, preset: bass.name, gains: curveToBands(bass.curve, 7) })
    await NativeAudio.setEq(filters, peakRiseDb)
    await NativeAudio.setEq([], 0)
    return `${bass.name}: ${filters.length} filters, +${peakRiseDb.toFixed(1)} dB peak, solved in ${Date.now() - t0} ms`
  })

  await run('Cache', async () => {
    const e = yt ? lookup((yt as Track).uid) : null
    return e ? `YouTube song cached (${e.quality})` : 'nothing cached'
  })
}

export default function Diagnostics() {
  const c = useColors()
  const params = useLocalSearchParams<{ run?: string }>()
  const [results, setResults] = useState<Result[]>([])
  const [running, setRunning] = useState(false)
  const started = useRef(false)

  const start = async () => {
    setRunning(true)
    setResults([])
    const all: Result[] = []
    await runAll((r) => {
      all.push(r)
      console.log(`[diag] ${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.ms} ms): ${r.detail}`)
      setResults([...all])
    })
    const passed = all.filter((r) => r.ok).length
    console.log(`[diag] DONE ${passed}/${all.length}`)
    try {
      new File(dataDir, 'diagnostics.json').write(JSON.stringify({ at: new Date().toISOString(), passed, total: all.length, results: all }, null, 1))
    } catch {
      // only used by the automated test
    }
    setRunning(false)
  }

  useEffect(() => {
    if (params.run && !started.current) {
      started.current = true
      start()
    }
  }, [params.run])

  const passed = results.filter((r) => r.ok).length
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Diagnostics" right={<Button small title={running ? 'Running…' : 'Run'} busy={running} onPress={start} />} />
      <ScrollView contentContainerStyle={{ padding: ui.pad, gap: 10, paddingBottom: 60 }}>
        <Txt tone="text2" size={13}>
          Tests search, downloads, playback and lyrics on this phone. It downloads two songs (about 10 MB) and plays each for a moment.
        </Txt>
        {results.length ? (
          <Txt size={16} weight="800" testID="diag-summary">
            {running ? `Running… ${passed}/${results.length} passed` : `Done: ${passed}/${results.length} passed`}
          </Txt>
        ) : null}
        {results.map((r) => (
          <View key={r.name} style={{ flexDirection: 'row', gap: 10, backgroundColor: c.bg3, borderRadius: 8, padding: 10 }}>
            <Icon name={r.ok ? 'checkmark-circle' : 'close-circle'} size={20} color={r.ok ? '#3ddc84' : '#ff5d6c'} />
            <View style={{ flex: 1 }}>
              <Txt weight="700">{`${r.name} · ${(r.ms / 1000).toFixed(1)} s`}</Txt>
              <Txt tone="text2" size={12}>
                {r.detail}
              </Txt>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
