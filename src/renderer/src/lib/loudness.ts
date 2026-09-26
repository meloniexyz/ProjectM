/**
 * Loudness normalization: every song from every source is brought to the same perceived
 * level, -14 LUFS (the level YouTube and Spotify's "Normalize volume" also use).
 *
 * Signal path:  <audio> -> normalize gain -> limiter -> volume -> speakers
 *                      \-> K-weighting filters -> meter (measures the raw song)
 *
 * The gain comes from, in order: our own earlier measurement of this song, loudness info the
 * source publishes (YouTube, ReplayGain tags), or a live measurement over the first seconds.
 */

/** gains below are stored relative to -14 LUFS; the chosen level shifts them all */
const REFERENCE_LUFS = -14
let targetOffsetDb = 0
const MIN_GAIN_DB = -15
const MAX_GAIN_DB = 9 // boosting quiet songs further risks noise; the limiter catches peaks
const MEASURE_FIRST_S = 4 // start correcting after this much audio
const MEASURE_LOCK_S = 60 // stop refining after this much audio (intros are often quieter)
const CACHE_KEY = 'projectm.loudness'
const CACHE_MAX = 5000

let ctx: AudioContext | null = null
let normalize: GainNode
// equalizer: headroom gain -> band filters (rebuilt when the band count changes)
let eqIn: GainNode
let eqFilters: BiquadFilterNode[] = []
let outMeter: AnalyserNode | null = null
let output: GainNode
let direct: GainNode
let limited: GainNode
let limitedTrim = 1
let limiterOn = false
let analyser: AnalyserNode
let buffer: Float32Array<ArrayBuffer>
let enabled = true

// per-song measurement state
let current: string | null = null
let blocks: number[] = [] // mean-square energy of each 400 ms block (after K-weighting)
let measuredSeconds = 0
let locked = false
let timer = 0

const cache: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch {
    return {}
  }
})()

function saveCache() {
  const keys = Object.keys(cache)
  if (keys.length > CACHE_MAX) for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k]
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // not critical
  }
}

const dbToGain = (db: number) => Math.pow(10, db / 20)
const clampDb = (db: number) => Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, db))

/** Routes the audio element through the normalizer. Call once. */
export function connectAudio(audio: HTMLAudioElement) {
  audio.crossOrigin = 'anonymous' // required so Web Audio may read the samples
  ctx = new AudioContext({ latencyHint: 'playback' })
  const source = ctx.createMediaElementSource(audio)

  normalize = ctx.createGain()
  output = ctx.createGain()
  eqIn = ctx.createGain()
  source.connect(eqIn)
  eqIn.connect(normalize) // no bands until setEq() is called

  // Two paths after the level gain: straight through (sound untouched), or through a
  // peak limiter. The limiter is only used while a song is boosted, where peaks could clip.
  direct = ctx.createGain()
  normalize.connect(direct).connect(output)

  const threshold = -1
  const ratio = 20
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = threshold
  limiter.knee.value = 0
  limiter.ratio.value = ratio
  limiter.attack.value = 0.002
  limiter.release.value = 0.2
  limited = ctx.createGain()
  normalize.connect(limiter).connect(limited).connect(output)
  // Chromium's compressor adds automatic "makeup gain"; undo it so levels stay exact
  const fullRangeDb = threshold + (0 - threshold) / ratio
  limitedTrim = dbToGain(0.6 * fullRangeDb)

  direct.gain.value = 1
  limited.gain.value = 0
  output.connect(ctx.destination)
  // diagnostics only: level of what actually goes to the speakers (before the volume stage)
  outMeter = ctx.createAnalyser()
  outMeter.fftSize = 2048
  limited.connect(outMeter)
  direct.connect(outMeter)

  // K-weighting (ITU BS.1770): high-pass ~38 Hz + high shelf +4 dB above ~1.5 kHz
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 38
  hp.Q.value = 0.5
  const shelf = ctx.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.value = 1500
  shelf.gain.value = 4
  analyser = ctx.createAnalyser()
  analyser.fftSize = 16384 // ~370 ms at 44.1 kHz, close to BS.1770's 400 ms blocks
  buffer = new Float32Array(analyser.fftSize)
  source.connect(hp).connect(shelf).connect(analyser)
}

/** The player's volume (0..1 already curved), applied after normalization. */
/**
 * Applies an equalizer curve. Bands are rebuilt only when their layout changes; gain changes
 * glide so dragging a band doesn't click. Boosts are balanced by lowering the input just
 * enough that the loudest frequency stays at 0 dB (no clipping).
 */
export function setEq(eq: { enabled: boolean; bands: { freq: number; type: BiquadFilterType; q: number; gain: number }[] }) {
  if (!ctx) return
  const layout = eq.bands.map((b) => `${b.type}@${b.freq}`).join(',')
  const current = eqFilters.map((f) => `${f.type}@${f.frequency.value}`).join(',')
  if (layout !== current) {
    eqIn.disconnect()
    for (const f of eqFilters) f.disconnect()
    eqFilters = eq.bands.map((b) => {
      const f = ctx!.createBiquadFilter()
      f.type = b.type
      f.frequency.value = b.freq
      f.Q.value = b.q
      f.gain.value = 0
      return f
    })
    let node: AudioNode = eqIn
    for (const f of eqFilters) node = node.connect(f)
    node.connect(normalize)
  }
  const t = ctx.currentTime
  eq.bands.forEach((b, i) => eqFilters[i].gain.setTargetAtTime(eq.enabled ? b.gain : 0, t, 0.03))
  const peak = eq.enabled ? eqPeakDb(eq.bands.map((b) => (eq.enabled ? b.gain : 0))) : 0
  eqIn.gain.setTargetAtTime(dbToGain(-Math.max(0, peak)), t, 0.03)
}

const RESPONSE_FREQS = new Float32Array(Array.from({ length: 160 }, (_, i) => 20 * Math.pow(1000, i / 159))) // 20 Hz..20 kHz

/** Combined response of the EQ bands (dB) at the given frequencies, using the target gains. */
export function eqResponse(freqs: Float32Array<ArrayBuffer>, gains: number[]) {
  const out = new Float32Array(freqs.length)
  if (!ctx || eqFilters.length !== gains.length) return out
  const mag = new Float32Array(freqs.length)
  const phase = new Float32Array(freqs.length)
  eqFilters.forEach((f, i) => {
    // measure each band at its target gain (the live value may still be gliding)
    const probe = ctx!.createBiquadFilter()
    probe.type = f.type
    probe.frequency.value = f.frequency.value
    probe.Q.value = f.Q.value
    probe.gain.value = gains[i]
    probe.getFrequencyResponse(freqs, mag, phase)
    for (let k = 0; k < freqs.length; k++) out[k] += 20 * Math.log10(mag[k] || 1e-6)
  })
  return out
}

function eqPeakDb(gains: number[]) {
  const r = eqResponse(RESPONSE_FREQS, gains)
  return r.reduce((m, v) => Math.max(m, v), -Infinity)
}

export function setOutputVolume(level: number) {
  if (!ctx) return
  output.gain.setTargetAtTime(level, ctx.currentTime, 0.03)
}

export function resumeAudio() {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
}

function applyGain(db: number, seconds: number) {
  if (!ctx) return
  const total = enabled ? db + targetOffsetDb : 0
  normalize.gain.cancelScheduledValues(ctx.currentTime)
  normalize.gain.setTargetAtTime(dbToGain(total), ctx.currentTime, seconds)
  useLimiter(total > 0.5)
}

/** Crossfades between the untouched path and the limited path (only needed when boosting). */
function useLimiter(on: boolean) {
  if (!ctx || on === limiterOn) return
  limiterOn = on
  const t = ctx.currentTime
  direct.gain.setTargetAtTime(on ? 0 : 1, t, 0.02)
  limited.gain.setTargetAtTime(on ? limitedTrim : 0, t, 0.02)
}

/** Loudness level all songs are brought to (e.g. -23 quiet, -14 normal, -11 loud). */
export function setTargetLufs(lufs: number) {
  targetOffsetDb = lufs - REFERENCE_LUFS
  if (current) applyGain(lastGain, 0.3)
}

/** Forget remembered per-song levels (they'll be measured again). */
export function clearLoudnessMemory() {
  for (const k of Object.keys(cache)) delete cache[k]
  saveCache()
}

export function setNormalizeEnabled(on: boolean) {
  enabled = on
  if (current) applyGain(cache[current] ?? lastGain, 0.3)
}

let lastGain = 0

/** A new song starts: set its gain straight away if we know it, and measure it if we don't. */
export function startSong(uid: string, publishedGainDb?: number) {
  // skipped before we finished measuring: a 10 s+ estimate is still better than none next time
  if (current && !locked && measuredSeconds >= 10) {
    cache[current] = Math.round(lastGain * 10) / 10
    saveCache()
  }
  current = uid
  blocks = []
  measuredSeconds = 0
  // Loudness the source measured over the whole song (YouTube, ReplayGain) beats our own
  // measurement of the first minute, so it's used as-is.
  const published = publishedGainDb != null ? clampDb(publishedGainDb) : undefined
  const known = published ?? cache[uid]
  // unknown songs start a little below unity so a loud one doesn't blast before it's measured
  lastGain = known ?? -3
  locked = known != null
  applyGain(lastGain, 0.01)
  clearInterval(timer)
  if (!locked) timer = window.setInterval(measure, 400)
}

/** Integrated loudness of the blocks so far, with BS.1770's absolute and relative gates. */
function integrated(): number | null {
  const toLufs = (ms: number) => -0.691 + 10 * Math.log10(2 * ms) // analyser is a mono downmix; x2 ~ stereo sum
  const abs = blocks.filter((ms) => toLufs(ms) > -70)
  if (!abs.length) return null
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const relGate = toLufs(mean(abs)) - 10
  const gated = abs.filter((ms) => toLufs(ms) > relGate)
  return toLufs(mean(gated.length ? gated : abs))
}

function measure() {
  if (!ctx || !current || locked) return
  const audio = mediaElement
  if (!audio || audio.paused || audio.seeking) return
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
  const ms = sum / buffer.length
  if (ms === 0) return // silence or not readable yet
  blocks.push(ms)
  measuredSeconds += 0.4

  if (measuredSeconds < MEASURE_FIRST_S) return
  const lufs = integrated()
  if (lufs == null) return
  const target = clampDb(REFERENCE_LUFS - lufs)
  // first correction is quick, later refinements drift slowly so the level doesn't audibly pump
  applyGain(target, measuredSeconds < 8 ? 1.5 : 6)
  lastGain = target
  if (measuredSeconds >= MEASURE_LOCK_S) {
    locked = true
    clearInterval(timer)
    cache[current] = Math.round(target * 10) / 10
    saveCache()
  }
}

let mediaElement: HTMLAudioElement | null = null
export function setMediaElement(audio: HTMLAudioElement) {
  mediaElement = audio
}

/** For the UI: the gain being applied right now, in dB (null when not normalizing). */
export const currentGainDb = () => (enabled && current ? lastGain : null)

/** Diagnostics: what the meter has seen for the current song. */
export function loudnessDebug() {
  analyser?.getFloatTimeDomainData(buffer)
  const peak = buffer ? buffer.reduce((m, v) => Math.max(m, Math.abs(v)), 0) : 0
  return {
    song: current,
    measuredSeconds: Math.round(measuredSeconds * 10) / 10,
    lufs: integrated(),
    gainDb: lastGain,
    locked,
    cached: current ? cache[current] : undefined,
    ctx: ctx?.state,
    paused: mediaElement?.paused,
    time: mediaElement?.currentTime,
    readyState: mediaElement?.readyState,
    peakNow: peak,
    outPeak: (() => {
      if (!outMeter) return 0
      const b = new Float32Array(outMeter.fftSize)
      outMeter.getFloatTimeDomainData(b)
      return b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    })(),
    eq: { headroomDb: eqIn ? 20 * Math.log10(eqIn.gain.value) : 0, bands: eqFilters.map((f) => `${f.type}@${f.frequency.value}:${f.gain.value.toFixed(1)}`) },
  }
}
