import SwiftUI
import WidgetKit

// Home-screen and lock-screen widgets, in Blanc. They show what the app last
// wrote to the shared App Group (WidgetSnapshotStore; native/src/lib/widgets.ts
// builds it): one purpose each, as the app's cards.
// - Fuel: calories left today, protein left.
// - Training: today's session, and in the wider size the next few days.
// At midnight they turn to the new day on their own: Fuel starts from nothing
// eaten, Training reads the next day of the plan the app wrote ahead.

// MARK: - Snapshot

struct WidgetSnapshot: Decodable {
  struct Fuel: Decodable {
    let calories: Double
    let protein: Double
    let calorieTarget: Double
    let proteinTarget: Double
  }

  struct PlanDay: Decodable {
    /// yyyy-MM-dd, local.
    let day: String
    let title: String
    let detail: String?
    /// planned, rest, done, live, flexible or setup.
    let kind: String
  }

  let version: Int
  /// The local day the Fuel figures belong to.
  let day: String
  let fuel: Fuel?
  /// Today and the days after it.
  let plan: [PlanDay]

  static func load() -> WidgetSnapshot? {
    guard let data = WidgetSnapshotStore.read() else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }

  /// What the widget gallery shows before the app has written anything.
  static let sample = WidgetSnapshot(
    version: 1,
    day: dayKey(Date()),
    fuel: Fuel(calories: 1_885, protein: 96, calorieTarget: 3_125, proteinTarget: 150),
    plan: (0..<4).map { offset in
      let date = Calendar.current.date(byAdding: .day, value: offset, to: Date()) ?? Date()
      let titles = ["Upper A", "Lower A", "Rest day", "Upper B"]
      return PlanDay(day: dayKey(date), title: titles[offset], detail: offset == 0 ? "6 movements" : nil, kind: offset == 2 ? "rest" : "planned")
    }
  )
}

private func dayKey(_ date: Date) -> String {
  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = .current
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter.string(from: date)
}

private func weekday(_ key: String) -> String {
  let parser = DateFormatter()
  parser.calendar = Calendar(identifier: .gregorian)
  parser.locale = Locale(identifier: "en_US_POSIX")
  parser.timeZone = .current
  parser.dateFormat = "yyyy-MM-dd"
  guard let date = parser.date(from: key) else { return "" }
  let formatter = DateFormatter()
  formatter.setLocalizedDateFormatFromTemplate("EEE")
  return formatter.string(from: date)
}

private let wholeNumber: NumberFormatter = {
  let formatter = NumberFormatter()
  formatter.numberStyle = .decimal
  formatter.maximumFractionDigits = 0
  return formatter
}()

private func whole(_ value: Double) -> String {
  wholeNumber.string(from: NSNumber(value: value.rounded())) ?? String(Int(value.rounded()))
}

struct DayEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?

  /// Today's Fuel: the snapshot's figures on its own day, nothing eaten on a later one.
  var fuel: (left: Double, eaten: Double, target: Double, proteinLeft: Double, protein: Double, proteinTarget: Double)? {
    guard let fuel = snapshot?.fuel, fuel.calorieTarget > 0 else { return nil }
    let sameDay = snapshot?.day == dayKey(date)
    let eaten = sameDay ? fuel.calories : 0
    let protein = sameDay ? fuel.protein : 0
    return (fuel.calorieTarget - eaten, eaten, fuel.calorieTarget, fuel.proteinTarget - protein, protein, fuel.proteinTarget)
  }

  /// Today and the days after it, from the plan the app wrote ahead.
  var plan: ArraySlice<WidgetSnapshot.PlanDay> {
    let today = dayKey(date)
    guard let plan = snapshot?.plan, let index = plan.firstIndex(where: { $0.day == today }) else { return [] }
    return plan[index...]
  }
}

struct DayProvider: TimelineProvider {
  func placeholder(in context: Context) -> DayEntry {
    DayEntry(date: Date(), snapshot: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
    completion(DayEntry(date: Date(), snapshot: context.isPreview ? (WidgetSnapshot.load() ?? .sample) : WidgetSnapshot.load()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
    let now = Date()
    let snapshot = WidgetSnapshot.load()
    let calendar = Calendar.current
    let midnight = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
    let entries = [DayEntry(date: now, snapshot: snapshot), DayEntry(date: midnight, snapshot: snapshot)]
    completion(Timeline(entries: entries, policy: .after(midnight)))
  }
}

// MARK: - Pieces

private struct Mark: View {
  let blanc: Blanc
  var body: some View {
    Text("P")
      .font(brandMark(size: 17))
      .foregroundStyle(blanc.brand)
      .accessibilityHidden(true)
  }
}

/// A thin bar: how much of a target is used.
private struct Meter: View {
  let progress: Double
  let blanc: Blanc
  var over = false

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(blanc.track)
        Capsule()
          .fill(over ? blanc.live : blanc.ink)
          .frame(width: proxy.size.width * min(1, max(0, progress)))
      }
    }
    .frame(height: 4)
    .widgetAccentable()
  }
}

private extension View {
  /// Blanc's ground behind the widget, on every iOS the app supports.
  @ViewBuilder
  func widgetGround(_ color: Color) -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(color, for: .widget)
    } else {
      padding().background(color)
    }
  }
}

private struct Placeholder: View {
  let line: String
  let blanc: Blanc
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Mark(blanc: blanc)
      Spacer(minLength: 0)
      Text(line)
        .font(.footnote)
        .foregroundStyle(blanc.graphite)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

// MARK: - Fuel

private struct FuelView: View {
  let entry: DayEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let blanc = Blanc.of(scheme)
    Group {
      if let fuel = entry.fuel {
        switch family {
        case .accessoryCircular:
          Gauge(value: min(fuel.eaten, fuel.target), in: 0...fuel.target) {
            Text("kcal")
          } currentValueLabel: {
            Text(fuel.left >= 1_000 ? String(format: "%.1fk", fuel.left / 1_000) : whole(fuel.left))
          }
          .gaugeStyle(.accessoryCircular)
        case .accessoryRectangular:
          VStack(alignment: .leading, spacing: 1) {
            Text("\(whole(abs(fuel.left))) kcal \(fuel.left >= 0 ? "left" : "over")")
              .font(.headline)
              .widgetAccentable()
            Text(proteinLine(fuel.proteinLeft))
              .font(.caption)
            Gauge(value: min(fuel.eaten, fuel.target), in: 0...fuel.target) { EmptyView() }
              .gaugeStyle(.accessoryLinearCapacity)
          }
        case .accessoryInline:
          Text("\(whole(abs(fuel.left))) kcal \(fuel.left >= 0 ? "left" : "over")")
        case .systemMedium:
          HStack(alignment: .bottom, spacing: 18) {
            VStack(alignment: .leading, spacing: 0) {
              Mark(blanc: blanc)
              Spacer(minLength: 0)
              figure(fuel.left, blanc: blanc, size: 46)
            }
            VStack(alignment: .leading, spacing: 14) {
              meterRow("Eaten", value: whole(fuel.eaten), of: whole(fuel.target), progress: fuel.eaten / fuel.target, over: fuel.left < 0, blanc: blanc)
              meterRow("Protein", value: whole(fuel.protein), of: "\(whole(fuel.proteinTarget)) g", progress: fuel.proteinTarget > 0 ? fuel.protein / fuel.proteinTarget : 0, over: false, blanc: blanc)
            }
            .frame(maxWidth: .infinity)
          }
        default:
          VStack(alignment: .leading, spacing: 0) {
            Mark(blanc: blanc)
            Spacer(minLength: 0)
            figure(fuel.left, blanc: blanc, size: 40)
            Meter(progress: fuel.eaten / fuel.target, blanc: blanc, over: fuel.left < 0)
              .padding(.top, 8)
            Text(proteinLine(fuel.proteinLeft))
              .font(.caption)
              .foregroundStyle(blanc.graphite)
              .padding(.top, 6)
              .lineLimit(1)
          }
        }
      } else if family == .accessoryInline || family == .accessoryCircular || family == .accessoryRectangular {
        Text(entry.snapshot == nil ? "Open hyPer" : "No calorie target")
      } else {
        Placeholder(line: entry.snapshot == nil ? "Open hyPer to see what's left today." : "Set a calorie target in hyPer.", blanc: blanc)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetGround(blanc.ground)
    .widgetURL(appURL("fuel"))
  }

  private func figure(_ left: Double, blanc: Blanc, size: CGFloat) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(whole(abs(left)))
        .font(.system(size: size, weight: .thin))
        .monospacedDigit()
        .minimumScaleFactor(0.6)
        .lineLimit(1)
        .foregroundStyle(blanc.ink)
        .widgetAccentable()
      Text(left >= 0 ? "kcal left" : "kcal over")
        .font(.footnote)
        .foregroundStyle(left >= 0 ? blanc.graphite : blanc.live)
    }
    .accessibilityElement(children: .combine)
  }

  private func meterRow(_ label: String, value: String, of target: String, progress: Double, over: Bool, blanc: Blanc) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text(label).foregroundStyle(blanc.graphite)
        Spacer(minLength: 4)
        (Text(value).foregroundColor(blanc.ink).fontWeight(.medium) + Text(" / \(target)").foregroundColor(blanc.graphite))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .font(.footnote)
      Meter(progress: progress, blanc: blanc, over: over)
    }
  }

  private func proteinLine(_ left: Double) -> String {
    left >= 0 ? "\(whole(left)) g protein left" : "Protein target met"
  }
}

struct FuelWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "hyper.fuel", provider: DayProvider()) { entry in
      FuelView(entry: entry)
    }
    .configurationDisplayName("Fuel")
    .description("Calories and protein left today.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

// MARK: - Training

private struct TrainingView: View {
  let entry: DayEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let blanc = Blanc.of(scheme)
    let days = entry.plan
    Group {
      if let today = days.first {
        switch family {
        case .accessoryRectangular:
          VStack(alignment: .leading, spacing: 1) {
            Text(today.title).font(.headline).widgetAccentable()
            if let detail = today.detail { Text(detail).font(.caption) }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        case .accessoryInline:
          Text(today.title)
        case .systemMedium:
          let upcoming = Array(days.dropFirst().prefix(3))
          VStack(alignment: .leading, spacing: 0) {
            header(today, blanc: blanc)
            Spacer(minLength: 0)
            HStack(alignment: .bottom, spacing: 16) {
              todayText(today, blanc: blanc)
              if !upcoming.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                  ForEach(upcoming, id: \.day) { day in
                    HStack(spacing: 10) {
                      Text(weekday(day.day))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(blanc.graphite)
                        .frame(width: 34, alignment: .leading)
                      Text(day.kind == "rest" ? "Rest" : day.title)
                        .font(.footnote.weight(day.kind == "rest" ? .regular : .medium))
                        .foregroundStyle(day.kind == "rest" ? blanc.graphite : blanc.ink)
                        .lineLimit(1)
                    }
                  }
                }
                .frame(width: 136, alignment: .leading)
                .accessibilityElement(children: .combine)
              }
            }
          }
        default:
          todayBlock(today, blanc: blanc)
        }
      } else if family == .accessoryInline || family == .accessoryRectangular {
        Text("Open hyPer")
      } else {
        Placeholder(line: "Open hyPer to see today's session.", blanc: blanc)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetGround(blanc.ground)
    .widgetURL(appURL("train"))
  }

  private func todayBlock(_ today: WidgetSnapshot.PlanDay, blanc: Blanc) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      header(today, blanc: blanc)
      Spacer(minLength: 0)
      todayText(today, blanc: blanc)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  /// The P, and the day (or a red dot while a session is live).
  private func header(_ today: WidgetSnapshot.PlanDay, blanc: Blanc) -> some View {
    HStack {
      Mark(blanc: blanc)
      Spacer()
      if today.kind == "live" {
        Circle().fill(blanc.live).frame(width: 6, height: 6).accessibilityLabel("In progress")
      } else {
        Text(weekday(today.day)).font(.caption).foregroundStyle(blanc.graphite)
      }
    }
  }

  private func todayText(_ today: WidgetSnapshot.PlanDay, blanc: Blanc) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(today.title)
        .font(.system(size: 19, weight: .semibold))
        .foregroundStyle(blanc.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
        .widgetAccentable()
      if let detail = today.detail {
        Text(detail)
          .font(.footnote)
          .foregroundStyle(blanc.graphite)
          .lineLimit(2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }
}

struct TrainingWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "hyper.training", provider: DayProvider()) { entry in
      TrainingView(entry: entry)
    }
    .configurationDisplayName("Training")
    .description("Today's session and the days ahead.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
  }
}
