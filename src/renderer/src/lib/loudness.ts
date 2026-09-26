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
let outK: AnalyserNode | null = null

/** Diagnostics: K-weighted mean square of the output right now. */
export function outputMeanSquare() {
  if (!outK) return 0
  const b = new Float32Array(outK.fftSize)
  outK.getFloatTimeDomainData(b)
  return b.reduce((a, v) => a + v * v, 0) / b.length
}
let output: GainNode
let direct: GainNode
let limited: GainNode
let limitedTrim = 1
let limiterOn = false
/** leveling gain currently applied (dB) */
let levelDb = 0
/** how far the EQ can push any frequency above the original, after loudness compensation (dB) */
let eqPeakRiseDb = 0
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
  // diagnostics only: K-weighted copy of the output, to check perceived loudness
  const khp = ctx.createBiquadFilter()
  khp.type = 'highpass'
  khp.frequency.value = 38
  khp.Q.value = 0.5
  const kshelf = ctx.createBiquadFilter()
  kshelf.type = 'highshelf'
  kshelf.frequency.value = 1500
  kshelf.gain.value = 4
  outK = ctx.createAnalyser()
  outK.fftSize = 8192
  limited.connect(khp)
  direct.connect(khp)
  khp.connect(kshelf).connect(outK)

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

// ---------- equalizer ----------
//
// The 3/5/7 dots you drag define a smooth curve (monotone cubic interpolation on a log
// frequency axis: it passes through every dot and never overshoots between them). A bank of
// ~24 filters, half an octave apart, is then solved to follow that curve, so neighbouring dots
// connect smoothly instead of forming separate bumps.

const BANK: { type: BiquadFilterType; freq: number; q: number; solveAt: number }[] = [
  { type: 'lowshelf', freq: 32, q: 0.7, solveAt: 25 },
  // half-octave steps, tightened to quarter-octave above 10 kHz where digital filters get
  // squeezed (frequency warping near the top of the audio range), plus one below 40 Hz
  ...[28, ...Array.from({ length: 17 }, (_, k) => 40 * Math.pow(2, k / 2)), 12177, 14482, 17222, 20480].map((freq) => ({
    type: 'peaking' as BiquadFilterType,
    freq,
    q: 1.4,
    solveAt: freq,
  })),
  { type: 'highshelf', freq: 18000, q: 0.7, solveAt: 19500 },
]
const SOLVE_FREQS = new Float32Array(BANK.map((b) => b.solveAt))
let probes: BiquadFilterNode[] = []

/** Builds the filter bank once and inserts it between the headroom gain and the leveling gain. */
function ensureBank() {
  if (!ctx || eqFilters.length) return
  eqIn.disconnect()
  eqFilters = BANK.map((b) => {
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
  // unconnected copies, only used to calculate responses
  probes = BANK.map((b) => {
    const p = ctx!.createBiquadFilter()
    p.type = b.type
    p.frequency.value = b.freq
    p.Q.value = b.q
    return p
  })
}

type Dot = { freq: number; gain: number }

/** Smooth curve through the dots: monotone cubic (Fritsch-Carlson) in log-frequency, flat outside. */
export function curveThrough(dots: Dot[], freq: number) {
  const n = dots.length
  if (!n) return 0
  const xs = dots.map((d) => Math.log(d.freq))
  const ys = dots.map((d) => d.gain)
  const x = Math.log(freq)
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  const h = xs.slice(1).map((v, i) => v - xs[i])
  const delta = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi)
  const m = ys.map((_, i) => (i === 0 ? delta[0] : i === n - 1 ? delta[n - 2] : (delta[i - 1] + delta[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / delta[i]
      const b = m[i + 1] / delta[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * delta[i]
        m[i + 1] = t * b * delta[i]
      }
    }
  }
  let i = 0
  while (x > xs[i + 1]) i++
  const t = (x - xs[i]) / h[i]
  const t2 = t * t
  const t3 = t2 * t
  return (
    (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
  )
}

/** Combined response (dB) of the filter bank at the given frequencies, for the given filter gains. */
function bankResponse(freqs: Float32Array<ArrayBuffer>, gains: number[]) {
  const out = new Float32Array(freqs.length)
  if (!probes.length) return out
  const mag = new Float32Array(freqs.length)
  const phase = new Float32Array(freqs.length)
  probes.forEach((p, i) => {
    if (!gains[i]) return
    p.gain.value = gains[i]
    p.getFrequencyResponse(freqs, mag, phase)
    for (let k = 0; k < freqs.length; k++) out[k] += 20 * Math.log10(mag[k] || 1e-6)
  })
  return out
}

let solveCache: { key: string; gains: number[] } | null = null

// dense check points across the audible range (log-spaced), where the fitted response must follow the curve
const FIT_FREQS = new Float32Array(Array.from({ length: 200 }, (_, i) => 20 * Math.pow(1000, i / 199)))
let fitBasis: Float32Array[] | null = null // per filter: dB response per dB of gain, at FIT_FREQS

/** Each filter's response shape per dB of gain (peaking/shelf responses scale ~linearly in dB). */
function basisAt(freqs: Float32Array<ArrayBuffer>) {
  const mag = new Float32Array(freqs.length)
  const phase = new Float32Array(freqs.length)
  return probes.map((p) => {
    p.gain.value = 6
    p.getFrequencyResponse(freqs, mag, phase)
    return Float32Array.from(mag, (m) => (20 * Math.log10(m || 1e-6)) / 6)
  })
}

/** Solves the small square system M x = v (Gaussian elimination with partial pivoting). */
function solveLinear(M: number[][], v: number[]) {
  const n = v.length
  const A = M.map((row, i) => [...row, v[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    const d = A[c][c] || 1e-12
    for (let r = c + 1; r < n; r++) {
      const k = A[r][c] / d
      for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let sum = A[r][n]
    for (let j = r + 1; j < n; j++) sum -= A[r][j] * x[j]
    x[r] = sum / (A[r][r] || 1e-12)
  }
  return x
}

/**
 * Filter gains whose combined response follows the smooth curve through the dots over the
 * whole range (weighted least squares; the dots themselves weigh most), then refined against
 * the exact filter responses. This is what keeps the curve smooth, without ripples or sags.
 */
function solveBank(dots: Dot[]) {
  ensureBank()
  const key = dots.map((d) => `${d.freq}:${d.gain}`).join(',')
  if (solveCache?.key === key) return solveCache.gains
  const n = BANK.length
  if (dots.every((d) => d.gain === 0)) {
    solveCache = { key, gains: new Array(n).fill(0) }
    return solveCache.gains
  }

  fitBasis ??= basisAt(FIT_FREQS)
  const dotFreqs = new Float32Array(dots.map((d) => d.freq))
  const dotBasis = basisAt(dotFreqs)
  const freqs = new Float32Array([...FIT_FREQS, ...dotFreqs])
  const basis = fitBasis.map((col, i) => Float32Array.from([...col, ...dotBasis[i]]))
  const weights = [...new Array(FIT_FREQS.length).fill(1), ...new Array(dots.length).fill(40)]
  const target = Array.from(freqs, (fq) => curveThrough(dots, fq))

  // normal equations  (Bᵀ W B + λI) g = Bᵀ W t
  const lambda = 0.005
  const M = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let sum = i === j ? lambda : 0
      for (let k = 0; k < freqs.length; k++) sum += weights[k] * basis[i][k] * basis[j][k]
      return sum
    }),
  )
  const project = (err: number[]) =>
    Array.from({ length: n }, (_, i) => {
      let sum = 0
      for (let k = 0; k < freqs.length; k++) sum += weights[k] * basis[i][k] * err[k]
      return sum
    })

  let gains = solveLinear(M, project(target))
  // refine: filters aren't perfectly linear in dB, so correct against their exact response
  for (let pass = 0; pass < 10; pass++) {
    const r = bankResponse(freqs, gains)
    const err = target.map((t, k) => t - r[k])
    if (Math.max(...err.map(Math.abs)) < 0.03) break
    const delta = solveLinear(M, project(err))
    gains = gains.map((g, i) => Math.max(-30, Math.min(30, g + delta[i])))
  }
  solveCache = { key, gains }
  return gains
}

/** What the EQ does (dB) at the given frequencies for these dots: exactly the curve you hear. */
export function eqResponse(freqs: Float32Array<ArrayBuffer>, dots: Dot[]) {
  if (!ctx) return new Float32Array(freqs.length)
  return bankResponse(freqs, solveBank(dots))
}

/** Applies the equalizer. Gains glide so dragging doesn't click. */
export function setEq(eq: { enabled: boolean; bands: Dot[] }) {
  if (!ctx) return
  ensureBank()
  const gains = eq.enabled ? solveBank(eq.bands) : BANK.map(() => 0)
  const t = ctx.currentTime
  eqFilters.forEach((f, i) => f.gain.setTargetAtTime(gains[i], t, 0.03))
  // No overall level change: boosting the bass only adds bass, the rest stays exactly as it
  // was. If that could push peaks past full scale, the limiter is switched into the path.
  const response = bankResponse(RESPONSE_FREQS, gains)
  eqPeakRiseDb = response.reduce((m, v) => Math.max(m, v), -Infinity)
  eqIn.gain.setTargetAtTime(1, t, 0.03)
  updateLimiter()
}

const RESPONSE_FREQS = new Float32Array(Array.from({ length: 160 }, (_, i) => 20 * Math.pow(1000, i / 159))) // 20 Hz..20 kHz

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
  const total = enabled ? db + targetOffsetDb : 0
  normalize.gain.cancelScheduledValues(ctx.currentTime)
  normalize.gain.setTargetAtTime(dbToGain(total), ctx.currentTime, seconds)
  levelDb = total
  updateLimiter()
}

/** The limiter is only in the path when leveling or the EQ can push peaks above the original. */
function updateLimiter() {
  useLimiter(levelDb + Math.max(0, eqPeakRiseDb) > 0.5)
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
    eq: { limiter: limiterOn, peakRiseDb: eqPeakRiseDb, headroomDb: eqIn ? 20 * Math.log10(eqIn.gain.value) : 0, bands: eqFilters.map((f) => `${f.type}@${f.frequency.value}:${f.gain.value.toFixed(1)}`) },
  }
}
