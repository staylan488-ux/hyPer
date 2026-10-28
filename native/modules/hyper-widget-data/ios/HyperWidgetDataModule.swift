import ExpoModulesCore
import WidgetKit

/// Hands the widgets their data: the app writes a small JSON snapshot of
/// today's Fuel and Training (native/src/lib/widgets.ts) whenever it changes,
/// and WidgetKit redraws. Signing out clears it.
public final class HyperWidgetDataModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HyperWidgetData")

    AsyncFunction("setSnapshot") { (json: String) in
      WidgetSnapshotStore.write(json)
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("clear") {
      WidgetSnapshotStore.write(nil)
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
