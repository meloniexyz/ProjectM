import ExpoModulesCore

struct TrackRecord: Record {
  @Field var id: String = ""
  @Field var uri: String = ""
  @Field var title: String = ""
  @Field var artist: String = ""
  @Field var album: String = ""
  @Field var artwork: String? = nil
  @Field var duration: Double = 0
  @Field var gainDb: Double = 0

  var info: TrackInfo {
    TrackInfo(id: id, uri: uri, title: title, artist: artist, album: album, artwork: artwork, duration: duration, gainDb: gainDb)
  }
}

struct FilterRecord: Record {
  @Field var type: String = "peaking"
  @Field var freq: Double = 1000
  @Field var q: Double = 1
  @Field var gain: Double = 0

  var spec: FilterSpec {
    let kind: FilterSpec.Kind = type == "lowshelf" ? .lowshelf : type == "highshelf" ? .highshelf : .peaking
    return FilterSpec(kind: kind, freq: freq, q: q, gainDb: gain)
  }
}

public final class ProjectMAudioModule: Module {
  private var engine: PMPlayer?

  @MainActor private func player() -> PMPlayer {
    if let engine { return engine }
    let created = PMPlayer { [weak self] name, body in
      self?.sendEvent(name, body.compactMapValues { $0 })
    }
    engine = created
    return created
  }

  public func definition() -> ModuleDefinition {
    Name("ProjectMAudio")

    Events("onState", "onTrackChange", "onEnded", "onRemote", "onError")

    AsyncFunction("play") { (track: TrackRecord, startAt: Double, autoplay: Bool) async throws in
      try await self.player().play(track.info, startAt: startAt, autoplay: autoplay)
    }

    AsyncFunction("setNext") { (track: TrackRecord?) async throws in
      try await self.player().setNext(track?.info)
    }

    AsyncFunction("resume") { () async in
      await self.player().resume()
    }

    AsyncFunction("pause") { () async in
      await self.player().pause()
    }

    AsyncFunction("seek") { (seconds: Double) async in
      await self.player().seek(seconds)
    }

    AsyncFunction("stop") { () async in
      await self.player().stop()
    }

    AsyncFunction("setEq") { (filters: [FilterRecord], peakRiseDb: Double) async in
      await self.player().setEq(filters.map { $0.spec }, peakRiseDb: peakRiseDb)
    }

    AsyncFunction("setLevel") { (normalize: Bool, offsetDb: Double) async in
      await self.player().setLevel(normalize: normalize, offsetDb: offsetDb)
    }

    AsyncFunction("holdSilence") { (on: Bool) async in
      await self.player().holdSilence(on)
    }

    AsyncFunction("getState") { () async -> [String: Any] in
      await self.player().state().compactMapValues { $0 }
    }

    AsyncFunction("measureLoudness") { (uri: String) async -> Double? in
      guard let url = URL(string: uri) else { return nil }
      return await Loudness.measure(url: url)
    }
  }
}
