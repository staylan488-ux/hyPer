import AVFoundation
import Foundation

/// The run's audio cues, the same tones as the web app's src/lib/runTrackerCues.ts:
/// a lap is a double 880 Hz blip, a sprint start rises and a sprint end falls,
/// each a soft triangle wave. They mix over music and play with the screen
/// locked (the audio background mode), since a runner hears them with the
/// phone stowed. Main queue only.
final class RunCuePlayer {
  static let shared = RunCuePlayer()

  private struct Tone {
    let frequency: Double
    let at: Double
    let duration: Double
  }

  private let sampleRate = 44_100.0
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private lazy var format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
  private var attached = false
  private var playing = 0

  func play(_ kind: String) {
    let tones: [Tone]
    switch kind {
    case "lap":
      tones = [Tone(frequency: 880, at: 0, duration: 0.18), Tone(frequency: 880, at: 0.24, duration: 0.18)]
    case "sprintStart":
      tones = [Tone(frequency: 660, at: 0, duration: 0.14), Tone(frequency: 990, at: 0.16, duration: 0.22)]
    case "sprintEnd":
      tones = [Tone(frequency: 990, at: 0, duration: 0.14), Tone(frequency: 660, at: 0.16, duration: 0.22)]
    default:
      return
    }
    guard let buffer = render(tones) else { return }

    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try session.setActive(true)
      if !attached {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        attached = true
      }
      if !engine.isRunning { try engine.start() }
    } catch {
      // Cues are best effort; the haptic still marks the moment.
      return
    }
    playing += 1
    player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else { return }
        self.playing -= 1
        if self.playing == 0 { self.release() }
      }
    }
    if !player.isPlaying { player.play() }
  }

  /// Stops the engine and lets other audio return to full volume.
  func release() {
    guard playing == 0, engine.isRunning else { return }
    player.stop()
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  /// The tones as one buffer: each rises from silence in 20 ms and fades away
  /// exponentially, as the web cue's gain ramps do.
  private func render(_ tones: [Tone]) -> AVAudioPCMBuffer? {
    let total = (tones.map { $0.at + $0.duration }.max() ?? 0) + 0.05
    let frames = AVAudioFrameCount(total * sampleRate)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames), let channel = buffer.floatChannelData?[0] else {
      return nil
    }
    buffer.frameLength = frames
    for index in 0..<Int(frames) { channel[index] = 0 }
    let peak = 0.3
    let floor = 0.0001
    let attack = 0.02
    for tone in tones {
      let start = Int(tone.at * sampleRate)
      let count = min(Int(tone.duration * sampleRate), Int(frames) - start)
      guard count > 0 else { continue }
      for offset in 0..<count {
        let t = Double(offset) / sampleRate
        let phase = (t * tone.frequency).truncatingRemainder(dividingBy: 1)
        let triangle = 4 * abs(phase - 0.5) - 1
        let envelope = t < attack
          ? floor * pow(peak / floor, t / attack)
          : peak * pow(floor / peak, (t - attack) / max(0.001, tone.duration - attack))
        channel[start + offset] += Float(triangle * envelope)
      }
    }
    return buffer
  }
}
