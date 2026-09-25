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

const TARGET_LUFS = -14
const MIN_GAIN_DB = -15
const MAX_GAIN_DB = 9 // boosting quiet songs further risks noise; the limiter catches peaks
const MEASURE_FIRST_S = 4 // start correcting after this much audio
const MEASURE_LOCK_S = 60 // stop refining after this much audio (intros are often quieter)
const CACHE_KEY = 'projectm.loudness'
const CACHE_MAX = 5000

let ctx: AudioContext | null = null
let normalize: GainNode
let output: GainNode
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
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.25
  output = ctx.createGain()
  source.connect(normalize).connect(limiter).connect(output).connect(ctx.destination)

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
export function setOutputVolume(level: number) {
  if (!ctx) return
  output.gain.setTargetAtTime(level, ctx.currentTime, 0.03)
}

export function resumeAudio() {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {})
}

function applyGain(db: number, seconds: number) {
  if (!ctx) return
  normalize.gain.cancelScheduledValues(ctx.currentTime)
  normalize.gain.setTargetAtTime(enabled ? dbToGain(db) : 1, ctx.currentTime, seconds)
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
  const target = clampDb(TARGET_LUFS - lufs)
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
  }
}
