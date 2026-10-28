import SwiftUI

// Blanc's tokens for the extension (native/src/theme/blanc.ts): chalk and black
// ink, following the system appearance, with the red italic P.

struct Blanc {
  let ground: Color
  let label: Color
  let ink: Color
  let graphite: Color
  let track: Color
  let live: Color
  let brand: Color

  static let light = Blanc(
    ground: Color(hex: 0xF2F1ED),
    label: Color(hex: 0xFFFFFF),
    ink: Color(hex: 0x0B0B0B),
    graphite: Color(hex: 0x66665F),
    track: Color(hex: 0xDCDBD6),
    live: Color(hex: 0xD23B2E),
    brand: Color(hex: 0xA8352A)
  )
  static let dark = Blanc(
    ground: .black,
    label: Color(hex: 0x141414),
    ink: Color(hex: 0xF4F4F2),
    graphite: Color(hex: 0xA3A39C),
    track: Color(hex: 0x2B2B29),
    live: Color(hex: 0xFF5A4C),
    brand: Color(hex: 0xE58477)
  )

  static func of(_ scheme: ColorScheme) -> Blanc { scheme == .dark ? dark : light }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

/// The P, in the app's own face (bundled into this extension).
func brandMark(size: CGFloat) -> Font {
  .custom("FrauncesMark-MediumItalic", size: size)
}

/// Opens a screen of the app (Expo Router path, such as "run" or "fuel").
func appURL(_ path: String) -> URL? {
  URL(string: "\(WidgetSnapshotStore.appScheme)://\(path)")
}
