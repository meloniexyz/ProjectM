import AVFoundation
import Foundation

/// Integrated loudness (LUFS) of an audio file, per ITU BS.1770 / EBU R128:
/// K-weighting, 400 ms blocks with 75 % overlap, absolute (-70) and relative (-10 LU) gates.
enum Loudness {
  static func measure(url: URL) async -> Double? {
    let asset = AVURLAsset(url: url)
    guard let track = try? await asset.loadTracks(withMediaType: .audio).first else { return nil }
    guard let reader = try? AVAssetReader(asset: asset) else { return nil }
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsNonInterleaved: false,
      AVLinearPCMIsBigEndianKey: false,
    ]
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else { return nil }
    reader.add(output)
    guard reader.startReading() else { return nil }

    var meter: Meter?
    while let sample = output.copyNextSampleBuffer() {
      guard let desc = CMSampleBufferGetFormatDescription(sample),
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)?.pointee,
        let block = CMSampleBufferGetDataBuffer(sample)
      else { continue }
      if meter == nil { meter = Meter(sampleRate: asbd.mSampleRate, channels: Int(asbd.mChannelsPerFrame)) }
      let length = CMBlockBufferGetDataLength(block)
      var data = [Float](repeating: 0, count: length / MemoryLayout<Float>.size)
      let status = data.withUnsafeMutableBytes { raw in
        CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
      }
      if status == kCMBlockBufferNoErr { meter?.add(interleaved: data) }
    }
    if reader.status == .failed { return nil }
    return meter?.integrated()
  }
}

private struct KFilter {
  var b0, b1, b2, a1, a2: Double
  var z1 = 0.0, z2 = 0.0
  mutating func run(_ x: Double) -> Double {
    let y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    return y
  }
}

private struct Meter {
  let channels: Int
  let hop: Int // 100 ms
  var shelf: [KFilter]
  var highpass: [KFilter]
  var hopSum = 0.0
  var hopCount = 0
  /// mean square (summed over channels) of each 100 ms hop
  var hops: [Double] = []

  init(sampleRate fs: Double, channels: Int) {
    self.channels = max(1, channels)
    hop = max(1, Int(fs / 10))
    // stage 1: high shelf (+4 dB above ~1.7 kHz), coefficients for any sample rate (libebur128)
    var f0 = 1681.974450955533
    let G = 3.999843853973347
    var Q = 0.7071752369554196
    var K = tan(Double.pi * f0 / fs)
    let Vh = pow(10, G / 20)
    let Vb = pow(Vh, 0.4996667741545416)
    var a0 = 1 + K / Q + K * K
    let s = KFilter(
      b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0)
    // stage 2: high-pass at ~38 Hz
    f0 = 38.13547087602444
    Q = 0.5003270373238773
    K = tan(Double.pi * f0 / fs)
    a0 = 1 + K / Q + K * K
    let h = KFilter(b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0)
    shelf = Array(repeating: s, count: self.channels)
    highpass = Array(repeating: h, count: self.channels)
  }

  mutating func add(interleaved data: [Float]) {
    let frames = data.count / channels
    for i in 0..<frames {
      var sum = 0.0
      for c in 0..<channels {
        let y = highpass[c].run(shelf[c].run(Double(data[i * channels + c])))
        sum += y * y
      }
      hopSum += sum
      hopCount += 1
      if hopCount == hop {
        hops.append(hopSum / Double(hop))
        hopSum = 0
        hopCount = 0
      }
    }
  }

  func integrated() -> Double? {
    guard hops.count >= 4 else { return nil }
    // 400 ms blocks = 4 hops, stepping one hop (75 % overlap)
    var blocks: [Double] = []
    blocks.reserveCapacity(hops.count)
    for i in 0...(hops.count - 4) { blocks.append((hops[i] + hops[i + 1] + hops[i + 2] + hops[i + 3]) / 4) }
    let lufs = { (ms: Double) in -0.691 + 10 * log10(max(ms, 1e-12)) }
    let abs = blocks.filter { lufs($0) > -70 }
    guard !abs.isEmpty else { return nil }
    let relGate = lufs(abs.reduce(0, +) / Double(abs.count)) - 10
    let gated = abs.filter { lufs($0) > relGate }
    let use = gated.isEmpty ? abs : gated
    return lufs(use.reduce(0, +) / Double(use.count))
  }
}
