import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// What JS tells us about a song: the local file to play plus what the lock screen shows.
struct TrackInfo {
  let id: String
  let uri: String
  let title: String
  let artist: String
  let album: String
  let artwork: String?
  let duration: Double
  let gainDb: Double
}

/**
 Plays downloaded songs gaplessly with an AVQueuePlayer: the current song plus the next one
 (queued ahead by JS), so the next song starts on its own even while the phone is locked.
 Every item runs through our audio tap (EQ, leveling, limiter).
 */
@MainActor
final class PMPlayer {
  typealias Emit = (String, [String: Any?]) -> Void
  private let emit: Emit
  private let player = AVQueuePlayer()
  private let params = DspParams()
  /// what each queued item is
  private var infos: [ObjectIdentifier: TrackInfo] = [:]
  private var currentId: String?
  private var observers: [NSKeyValueObservation] = []
  private var itemObservers: [ObjectIdentifier: NSKeyValueObservation] = [:]
  private var timeObserver: Any?
  private var artworkKey: String?
  private var artwork: MPMediaItemArtwork?
  private var silence: AVAudioEngine?
  private var silenceNode: AVAudioPlayerNode?
  private var silenceTimer: Timer?
  private var wantsPlay = false
  /// bumps on every play()/setNext(), so slow file opens can't apply stale choices
  private var opSeq = 0

  init(emit: @escaping Emit) {
    self.emit = emit
    player.actionAtItemEnd = .advance
    player.automaticallyWaitsToMinimizeStalling = false // local files: start immediately
    configureSession()
    observePlayer()
    setupRemoteCommands()
  }

  // MARK: - session

  private func configureSession() {
    let session = AVAudioSession.sharedInstance()
    try? session.setCategory(.playback, mode: .default, policy: .longFormAudio)
    NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: session, queue: .main
    ) { [weak self] note in
      Task { @MainActor in self?.handleInterruption(note) }
    }
    NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
    ) { [weak self] note in
      Task { @MainActor in self?.handleRouteChange(note) }
    }
    NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main
    ) { [weak self] note in
      Task { @MainActor in self?.itemEnded(note.object as? AVPlayerItem) }
    }
    NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime, object: nil, queue: .main
    ) { [weak self] note in
      Task { @MainActor in
        guard let self, let item = note.object as? AVPlayerItem, let info = self.infos[ObjectIdentifier(item)] else { return }
        let err = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
        self.emit("onError", ["id": info.id, "message": err?.localizedDescription ?? "playback failed"])
      }
    }
  }

  private func activateSession() {
    try? AVAudioSession.sharedInstance().setActive(true)
  }

  private func handleInterruption(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    if type == .began {
      sendState()
    } else {
      let opts = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init) ?? []
      if opts.contains(.shouldResume) && wantsPlay {
        activateSession()
        player.play()
      }
      sendState()
    }
  }

  private func handleRouteChange(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
    else { return }
    // headphones unplugged / Bluetooth gone: pause, like every music app
    if reason == .oldDeviceUnavailable {
      wantsPlay = false
      player.pause()
      sendState()
    }
  }

  // MARK: - observing

  private func observePlayer() {
    observers.append(
      player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
        Task { @MainActor in self?.currentItemChanged() }
      })
    observers.append(
      player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
        Task { @MainActor in self?.sendState() }
      })
    timeObserver = player.addPeriodicTimeObserver(
      forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
    ) { [weak self] _ in
      Task { @MainActor in self?.sendState() }
    }
  }

  private func currentItemChanged() {
    guard let item = player.currentItem, let info = infos[ObjectIdentifier(item)] else { return }
    if info.id == currentId { return }
    currentId = info.id
    emit("onTrackChange", ["id": info.id])
    updateNowPlaying(info)
    cleanupFinishedItems()
  }

  private func itemEnded(_ item: AVPlayerItem?) {
    guard let item, let info = infos[ObjectIdentifier(item)] else { return }
    // the last queued song finished: tell JS, and keep the audio session alive briefly while
    // it fetches what comes next (iOS suspends apps that stop playing in the background)
    let remaining = player.items().filter { $0 !== item }
    if remaining.isEmpty {
      currentId = nil
      emit("onEnded", ["id": info.id])
      startSilence(seconds: 45)
    }
  }

  private func cleanupFinishedItems() {
    let live = Set(player.items().map { ObjectIdentifier($0) })
    for key in infos.keys where !live.contains(key) {
      infos.removeValue(forKey: key)
      itemObservers.removeValue(forKey: key)
    }
  }

  private func sendState() {
    let item = player.currentItem
    let info = item.flatMap { infos[ObjectIdentifier($0)] }
    let pos = player.currentTime().seconds
    var dur = item?.duration.seconds ?? 0
    if !dur.isFinite || dur <= 0 { dur = info?.duration ?? 0 }
    let playing = player.timeControlStatus == .playing || (player.rate > 0 && wantsPlay)
    let buffering = player.timeControlStatus == .waitingToPlayAtSpecifiedRate
    emit("onState", [
      "id": info?.id,
      "position": pos.isFinite ? pos : 0,
      "duration": dur,
      "playing": playing,
      "buffering": buffering,
    ])
    if var np = MPNowPlayingInfoCenter.default().nowPlayingInfo, info != nil {
      np[MPNowPlayingInfoPropertyElapsedPlaybackTime] = pos.isFinite ? pos : 0
      np[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
      np[MPMediaItemPropertyPlaybackDuration] = dur
      MPNowPlayingInfoCenter.default().nowPlayingInfo = np
      MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }
  }

  // MARK: - items

  private func makeItem(_ info: TrackInfo) async throws -> AVPlayerItem {
    guard let url = URL(string: info.uri), url.isFileURL || url.scheme == "https" || url.scheme == "http" else {
      throw NSError(domain: "ProjectMAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad file address: \(info.uri)"])
    }
    let asset = AVURLAsset(url: url)
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    guard let track = tracks.first else {
      throw NSError(domain: "ProjectMAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "No audio in this file"])
    }
    let item = AVPlayerItem(asset: asset)
    let ctx = TapContext(params: params, trackGainDb: info.gainDb)
    item.audioMix = makeAudioMix(track: track, context: ctx)
    return item
  }

  /// Queues an item at the end and remembers what it is.
  private func enqueue(_ item: AVPlayerItem, _ info: TrackInfo) {
    let key = ObjectIdentifier(item)
    infos[key] = info
    itemObservers[key] = item.observe(\.status, options: [.new]) { [weak self] it, _ in
      Task { @MainActor in
        guard let self, it.status == .failed, let info = self.infos[ObjectIdentifier(it)] else { return }
        self.emit("onError", ["id": info.id, "message": it.error?.localizedDescription ?? "can't play this file"])
      }
    }
    player.insert(item, after: player.items().last)
  }

  /// Replaces everything with this song.
  func play(_ info: TrackInfo, startAt: Double, autoplay: Bool) async throws {
    opSeq += 1
    let mine = opSeq
    let item = try await makeItem(info)
    if mine != opSeq { return } // a newer play()/setNext() came in while the file was opening
    stopSilence()
    player.removeAllItems()
    cleanupFinishedItems()
    enqueue(item, info)
    currentId = info.id
    updateNowPlaying(info)
    if startAt > 0.5 {
      await player.seek(to: CMTime(seconds: startAt, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
    if autoplay {
      wantsPlay = true
      activateSession()
      player.play()
    } else {
      wantsPlay = false
      player.pause()
    }
    sendState()
  }

  /// What plays after the current song (nil = nothing queued). Replaces any earlier choice.
  func setNext(_ info: TrackInfo?) async throws {
    opSeq += 1
    let mine = opSeq
    let current = player.currentItem
    for queued in player.items() where queued !== current { player.remove(queued) }
    cleanupFinishedItems()
    guard let info else { return }
    let item = try await makeItem(info)
    // superseded, or the song changed / ended while the file was opening: JS sends a fresh
    // choice after every song change, so this one is stale
    if mine != opSeq || player.currentItem == nil || player.currentItem !== current { return }
    enqueue(item, info)
  }

  func resume() {
    wantsPlay = true
    activateSession()
    if player.currentItem != nil {
      stopSilence()
      player.play()
    }
    sendState()
  }

  func pause() {
    wantsPlay = false
    player.pause()
    sendState()
  }

  func seek(_ seconds: Double) async {
    await player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    sendState()
  }

  func stop() {
    wantsPlay = false
    player.pause()
    player.removeAllItems()
    cleanupFinishedItems()
    currentId = nil
    stopSilence()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    sendState()
  }

  func setEq(_ filters: [FilterSpec], peakRiseDb: Double) {
    params.setEq(filters, peakRiseDb: peakRiseDb)
  }

  func setLevel(normalize: Bool, offsetDb: Double) {
    params.setLevel(normalize: normalize, offsetDb: offsetDb)
  }

  /// Keeps the app alive with silent audio while the next song downloads (or stops it).
  func holdSilence(_ on: Bool) {
    if on { startSilence(seconds: 60) } else { stopSilence() }
  }

  func state() -> [String: Any?] {
    let item = player.currentItem
    let info = item.flatMap { infos[ObjectIdentifier($0)] }
    let pos = player.currentTime().seconds
    return [
      "id": info?.id,
      "position": pos.isFinite ? pos : 0,
      "duration": info?.duration ?? 0,
      "playing": player.timeControlStatus == .playing,
      "queued": player.items().count,
    ]
  }

  // MARK: - silence keep-alive

  private func startSilence(seconds: Double) {
    if silence == nil {
      let engine = AVAudioEngine()
      let node = AVAudioPlayerNode()
      engine.attach(node)
      let format = engine.mainMixerNode.outputFormat(forBus: 0)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(max(1, format.sampleRate))) else { return }
      buffer.frameLength = buffer.frameCapacity // zero-filled = silence
      node.scheduleBuffer(buffer, at: nil, options: .loops)
      do {
        activateSession()
        try engine.start()
        node.play()
        silence = engine
        silenceNode = node
      } catch {
        return
      }
    }
    silenceTimer?.invalidate()
    silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
      Task { @MainActor in self?.stopSilence() }
    }
  }

  private func stopSilence() {
    silenceTimer?.invalidate()
    silenceTimer = nil
    silenceNode?.stop()
    silence?.stop()
    silenceNode = nil
    silence = nil
  }

  // MARK: - lock screen / Control Center

  private func setupRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.addTarget { [weak self] _ in
      Task { @MainActor in
        self?.resume()
        self?.emit("onRemote", ["command": "play"])
      }
      return .success
    }
    center.pauseCommand.addTarget { [weak self] _ in
      Task { @MainActor in
        self?.pause()
        self?.emit("onRemote", ["command": "pause"])
      }
      return .success
    }
    center.togglePlayPauseCommand.addTarget { [weak self] _ in
      Task { @MainActor in
        guard let self else { return }
        if self.wantsPlay { self.pause() } else { self.resume() }
        self.emit("onRemote", ["command": self.wantsPlay ? "play" : "pause"])
      }
      return .success
    }
    center.nextTrackCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.emit("onRemote", ["command": "next"]) }
      return .success
    }
    center.previousTrackCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.emit("onRemote", ["command": "previous"]) }
      return .success
    }
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      Task { @MainActor in
        guard let self else { return }
        Task { await self.seek(e.positionTime) }
        self.emit("onRemote", ["command": "seek", "position": e.positionTime])
      }
      return .success
    }
    center.skipForwardCommand.isEnabled = false
    center.skipBackwardCommand.isEnabled = false
  }

  private func updateNowPlaying(_ info: TrackInfo) {
    var np: [String: Any] = [
      MPMediaItemPropertyTitle: info.title,
      MPMediaItemPropertyArtist: info.artist,
      MPMediaItemPropertyAlbumTitle: info.album,
      MPMediaItemPropertyPlaybackDuration: info.duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
      MPNowPlayingInfoPropertyPlaybackRate: wantsPlay ? 1.0 : 0.0,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    if let art = artwork, artworkKey == info.artwork { np[MPMediaItemPropertyArtwork] = art }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = np
    loadArtwork(for: info)
  }

  private func loadArtwork(for info: TrackInfo) {
    guard let src = info.artwork, src != artworkKey, let url = URL(string: src) else { return }
    artworkKey = src
    artwork = nil
    Task.detached {
      let data: Data?
      if url.isFileURL {
        data = try? Data(contentsOf: url)
      } else {
        data = try? await URLSession.shared.data(from: url).0
      }
      guard let data, let image = UIImage(data: data) else { return }
      await MainActor.run { [weak self] in
        guard let self, self.artworkKey == src else { return }
        let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        self.artwork = art
        if var np = MPNowPlayingInfoCenter.default().nowPlayingInfo {
          np[MPMediaItemPropertyArtwork] = art
          MPNowPlayingInfoCenter.default().nowPlayingInfo = np
        }
      }
    }
  }
}
