import ExpoModulesCore
import UIKit

// A view's frame in window points, as UIKit laid it out. React Native's own
// measure reads its layout tree, which does not know where iOS placed an item
// inside a navigation bar; the launch intro needs the real spot to land on.
public class HyperViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HyperView")

    AsyncFunction("windowFrame") { (view: UIView) -> [String: Double]? in
      // Off screen (another tab, a screen being torn down): nothing to land on.
      guard let window = view.window else { return nil }
      let frame = view.convert(view.bounds, to: window)
      return [
        "x": Double(frame.minX),
        "y": Double(frame.minY),
        "width": Double(frame.width),
        "height": Double(frame.height),
      ]
    }.runOnQueue(.main)
  }
}
