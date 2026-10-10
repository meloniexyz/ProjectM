import AVFoundation
import Foundation
import MediaToolbox
import os

/// One EQ filter, described the same way as a Web Audio BiquadFilterNode (so the desktop
/// app's EQ curves sound identical here).
struct FilterSpec {
  enum Kind { case peaking, lowshelf, highshelf }
  let kind: Kind
  let freq: Double
  let q: Double
  let gainDb: Double
}

/// Normalized biquad coefficients (a0 = 1).
struct Biquad {
  var b0 = 1.0, b1 = 0.0, b2 = 0.0, a1 = 0.0, a2 = 0.0

  /// Web Audio's formulas (Audio EQ Cookbook; shelves use slope S = 1 and ignore Q).
  static func make(_ f: FilterSpec, sampleRate: Double) -> Biquad {
    let nyquist = sampleRate / 2
    let freq = min(max(f.freq, 10), nyquist * 0.999)
    let A = pow(10, f.gainDb / 40)
    let w0 = 2 * Double.pi * freq / sampleRate
    let cw = cos(w0)
    let sw = sin(w0)
    var b0 = 1.0, b1 = 0.0, b2 = 0.0, a0 = 1.0, a1 = 0.0, a2 = 0.0
    switch f.kind {
    case .peaking:
      let alpha = sw / (2 * max(f.q, 0.0001))
      b0 = 1 + alpha * A
      b1 = -2 * cw
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cw
      a2 = 1 - alpha / A
    case .lowshelf:
      let alpha = sw / 2 * sqrt(2.0)
      let k = 2 * sqrt(A) * alpha
      b0 = A * ((A + 1) - (A - 1) * cw + k)
      b1 = 2 * A * ((A - 1) - (A + 1) * cw)
      b2 = A * ((A + 1) - (A - 1) * cw - k)
      a0 = (A + 1) + (A - 1) * cw + k
      a1 = -2 * ((A - 1) + (A + 1) * cw)
      a2 = (A + 1) + (A - 1) * cw - k
    case .highshelf:
      let alpha = sw / 2 * sqrt(2.0)
      let k = 2 * sqrt(A) * alpha
      b0 = A * ((A + 1) + (A - 1) * cw + k)
      b1 = -2 * A * ((A - 1) + (A + 1) * cw)
      b2 = A * ((A + 1) + (A - 1) * cw - k)
      a0 = (A + 1) - (A - 1) * cw + k
      a1 = 2 * ((A - 1) - (A + 1) * cw)
      a2 = (A + 1) - (A - 1) * cw - k
    }
    return Biquad(b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0)
  }
}

/// Settings shared by every playing item: EQ filters, leveling target and on/off.
/// Written from the main thread, read (as a snapshot) from the audio thread.
final class DspParams {
  private var lock = os_unfair_lock()
  private var filters: [FilterSpec] = []
  private var eqPeakRiseDb = 0.0
  private var normalize = true
  private var offsetDb = 0.0
  private var version = 1

  struct Snapshot {
    let version: Int
    let filters: [FilterSpec]
    let eqPeakRiseDb: Double
    let normalize: Bool
    let offsetDb: Double
  }

  func setEq(_ f: [FilterSpec], peakRiseDb: Double) {
    os_unfair_lock_lock(&lock)
    filters = f
    eqPeakRiseDb = peakRiseDb
    version += 1
    os_unfair_lock_unlock(&lock)
  }

  func setLevel(normalize n: Bool, offsetDb o: Double) {
    os_unfair_lock_lock(&lock)
    normalize = n
    offsetDb = o
    version += 1
    os_unfair_lock_unlock(&lock)
  }

  var currentVersion: Int {
    os_unfair_lock_lock(&lock)
    defer { os_unfair_lock_unlock(&lock) }
    return version
  }

  func snapshot() -> Snapshot {
    os_unfair_lock_lock(&lock)
    defer { os_unfair_lock_unlock(&lock) }
    return Snapshot(version: version, filters: filters, eqPeakRiseDb: eqPeakRiseDb, normalize: normalize, offsetDb: offsetDb)
  }
}

/// Per-item processing state: filter memory, the song's own leveling gain and the limiter.
final class TapContext {
  let params: DspParams
  /// gain (dB) that brings this song to the reference loudness
  var trackGainDb: Double

  private var sampleRate = 44100.0
  private var channels = 2
  private var interleaved = false
  private var isFloat = true
  private var version = -1
  private var coeffs: [Biquad] = []
  /// filter memory, flat: [channel][filter][z1, z2]
  private var z: [Double] = []
  private var gain: Float = 1
  private var targetGain: Float = 1
  private var limiterOn = false
  private var env: Float = 1
  private var release: Float = 0.001

  init(params: DspParams, trackGainDb: Double) {
    self.params = params
    self.trackGainDb = trackGainDb
  }

  func prepare(_ format: AudioStreamBasicDescription) {
    sampleRate = format.mSampleRate > 0 ? format.mSampleRate : 44100
    channels = max(1, Int(format.mChannelsPerFrame))
    interleaved = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0 && channels > 1
    isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0 && format.mBitsPerChannel == 32
    // 60 ms release: quick enough that a boost stays audible, slow enough not to distort
    release = Float(1 - exp(-1 / (0.06 * sampleRate)))
    version = -1
  }

  private func refresh() {
    let s = params.snapshot()
    if s.version == version { return }
    let changedFilters = coeffs.count != s.filters.count
    coeffs = s.filters.map { Biquad.make($0, sampleRate: sampleRate) }
    if changedFilters || z.count != channels * coeffs.count * 2 {
      z = Array(repeating: 0, count: channels * coeffs.count * 2)
    }
    let levelDb = s.normalize ? trackGainDb + s.offsetDb : 0
    targetGain = Float(pow(10, levelDb / 20))
    if version == -1 { gain = targetGain } // first buffer: start at the right level
    // limiter only when something can push peaks above the original
    limiterOn = levelDb + max(0, s.eqPeakRiseDb) > 0.5
    version = s.version
  }

  func process(_ abl: UnsafeMutableAudioBufferListPointer, frames: Int) {
    guard isFloat, frames > 0 else { return }
    refresh()
    coeffs.withUnsafeBufferPointer { cp in
      z.withUnsafeMutableBufferPointer { zp in
        run(abl, frames: frames, cp: cp, zp: zp)
      }
    }
  }

  private func run(
    _ abl: UnsafeMutableAudioBufferListPointer, frames: Int,
    cp: UnsafeBufferPointer<Biquad>, zp: UnsafeMutableBufferPointer<Double>
  ) {
    let nFilters = coeffs.count
    let startGain = gain
    let step = (targetGain - startGain) / Float(frames)
    let threshold: Float = 0.944 // -0.5 dBFS

    if interleaved {
      guard let data = abl[0].mData?.assumingMemoryBound(to: Float.self) else { return }
      for i in 0..<frames {
        let g = startGain + step * Float(i)
        var peak: Float = 0
        for c in 0..<channels {
          var x = Double(data[i * channels + c])
          if nFilters > 0 { x = Self.filter(x, base: c * nFilters * 2, cp: cp, zp: zp) }
          let y = Float(x) * g
          data[i * channels + c] = y
          peak = max(peak, abs(y))
        }
        if limiterOn {
          let want: Float = peak > threshold ? threshold / peak : 1
          if want < env { env = want } else { env += (1 - env) * release }
          if env < 0.9999 { for c in 0..<channels { data[i * channels + c] *= env } }
        }
      }
    } else {
      let count = min(channels, abl.count)
      var ptrs: [UnsafeMutablePointer<Float>] = []
      for c in 0..<count {
        guard let p = abl[c].mData?.assumingMemoryBound(to: Float.self) else { return }
        ptrs.append(p)
      }
      for i in 0..<frames {
        let g = startGain + step * Float(i)
        var peak: Float = 0
        for c in 0..<count {
          var x = Double(ptrs[c][i])
          if nFilters > 0 { x = Self.filter(x, base: c * nFilters * 2, cp: cp, zp: zp) }
          let y = Float(x) * g
          ptrs[c][i] = y
          peak = max(peak, abs(y))
        }
        if limiterOn {
          let want: Float = peak > threshold ? threshold / peak : 1
          if want < env { env = want } else { env += (1 - env) * release }
          if env < 0.9999 { for c in 0..<count { ptrs[c][i] *= env } }
        }
      }
    }
    gain = targetGain
  }

  /// Runs one sample through the filter chain (transposed direct form II).
  @inline(__always) private static func filter(
    _ input: Double, base: Int, cp: UnsafeBufferPointer<Biquad>, zp: UnsafeMutableBufferPointer<Double>
  ) -> Double {
    var x = input
    var i = base
    for k in cp {
      let y = k.b0 * x + zp[i]
      zp[i] = k.b1 * x - k.a1 * y + zp[i + 1]
      zp[i + 1] = k.b2 * x - k.a2 * y
      x = y
      i += 2
    }
    return x
  }
}

// MARK: - MTAudioProcessingTap glue (C callbacks)

private let tapInit: MTAudioProcessingTapInitCallback = { _, clientInfo, tapStorageOut in
  tapStorageOut.pointee = clientInfo
}

private let tapFinalize: MTAudioProcessingTapFinalizeCallback = { tap in
  Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).release()
}

private let tapPrepare: MTAudioProcessingTapPrepareCallback = { tap, _, format in
  let ctx = Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
  ctx.prepare(format.pointee)
}

private let tapUnprepare: MTAudioProcessingTapUnprepareCallback = { _ in }

private let tapProcess: MTAudioProcessingTapProcessCallback = { tap, numberFrames, _, bufferListInOut, numberFramesOut, flagsOut in
  let status = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferListInOut, flagsOut, nil, numberFramesOut)
  if status != noErr { return }
  let ctx = Unmanaged<TapContext>.fromOpaque(MTAudioProcessingTapGetStorage(tap)).takeUnretainedValue()
  ctx.process(UnsafeMutableAudioBufferListPointer(bufferListInOut), frames: Int(numberFramesOut.pointee))
}

/// An audio mix that runs the item's audio through our EQ / leveling / limiter.
func makeAudioMix(track: AVAssetTrack, context: TapContext) -> AVAudioMix? {
  var callbacks = MTAudioProcessingTapCallbacks(
    version: kMTAudioProcessingTapCallbacksVersion_0,
    clientInfo: UnsafeMutableRawPointer(Unmanaged.passRetained(context).toOpaque()),
    init: tapInit,
    finalize: tapFinalize,
    prepare: tapPrepare,
    unprepare: tapUnprepare,
    process: tapProcess
  )
  var tap: MTAudioProcessingTap?
  let status = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
  guard status == noErr, let tap else {
    Unmanaged<TapContext>.fromOpaque(callbacks.clientInfo!).release()
    return nil
  }
  let input = AVMutableAudioMixInputParameters(track: track)
  input.audioTapProcessor = tap
  let mix = AVMutableAudioMix()
  mix.inputParameters = [input]
  return mix
}
