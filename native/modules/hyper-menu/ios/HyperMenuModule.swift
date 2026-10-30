import ExpoModulesCore
import UIKit

// iOS's own context menu on a React Native row: hold the row and it lifts out
// of its list over a blurred screen with the menu beside it, as a Mail
// message or a Files item does.
public class HyperMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HyperMenu")

    View(HyperMenuView.self) {
      Events("onAction", "onOpen")

      // [{ id, title, subtitle?, symbol?, destructive?, disabled?, inline?, children? }]
      Prop("actions") { (view: HyperMenuView, actions: [[String: Any]]?) in
        view.items = actions ?? []
      }
      Prop("previewColor") { (view: HyperMenuView, color: UIColor?) in
        view.previewColor = color
      }
      Prop("previewRadius") { (view: HyperMenuView, radius: Double?) in
        view.previewRadius = CGFloat(radius ?? 10)
      }
      Prop("enabled") { (view: HyperMenuView, enabled: Bool?) in
        view.menuEnabled = enabled ?? true
      }
    }
  }
}

final class HyperMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onAction = EventDispatcher()
  let onOpen = EventDispatcher()

  var items: [[String: Any]] = [] {
    didSet { interaction?.updateVisibleMenu { [weak self] current in self?.menu() ?? current } }
  }
  var previewColor: UIColor?
  var previewRadius: CGFloat = 10
  var menuEnabled = true

  private var interaction: UIContextMenuInteraction?
  // The choice waits until the menu has gone and the row is back in place,
  // so a sheet it opens never meets the menu still closing, and a row it
  // removes leaves from where it sits.
  private var showing = false
  private var chosen: String?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let interaction = UIContextMenuInteraction(delegate: self)
    addInteraction(interaction)
    self.interaction = interaction
  }

  // MARK: - UIContextMenuInteractionDelegate

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard menuEnabled, !items.isEmpty, !isTextInput(at: location) else { return nil }
    cancelReactNativeTouches()
    chosen = nil
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      self?.menu()
    }
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    highlightPreviewForItemWithIdentifier identifier: any NSCopying
  ) -> UITargetedPreview? {
    preview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configuration: UIContextMenuConfiguration,
    dismissalPreviewForItemWithIdentifier identifier: any NSCopying
  ) -> UITargetedPreview? {
    preview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    showing = true
    onOpen()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    let ended: () -> Void = { [weak self] in
      guard let self else { return }
      self.showing = false
      if let id = self.chosen {
        self.chosen = nil
        self.onAction(["id": id])
      }
    }
    if let animator {
      animator.addCompletion(ended)
    } else {
      ended()
    }
  }

  // MARK: - Menu

  private func choose(_ id: String) {
    if showing {
      chosen = id
    } else {
      onAction(["id": id])
    }
  }

  private func menu() -> UIMenu {
    UIMenu(title: "", children: items.compactMap(element))
  }

  private func element(_ item: [String: Any]) -> UIMenuElement? {
    let title = item["title"] as? String ?? ""
    let image = (item["symbol"] as? String).flatMap { UIImage(systemName: $0) }
    if let children = item["children"] as? [[String: Any]] {
      let options: UIMenu.Options = item["inline"] as? Bool == true ? .displayInline : []
      let submenu = UIMenu(title: title, image: image, options: options, children: children.compactMap(element))
      if let subtitle = item["subtitle"] as? String { submenu.subtitle = subtitle }
      return submenu
    }
    guard let id = item["id"] as? String else { return nil }
    var attributes: UIMenuElement.Attributes = []
    if item["destructive"] as? Bool == true { attributes.insert(.destructive) }
    if item["disabled"] as? Bool == true { attributes.insert(.disabled) }
    let action = UIAction(title: title, image: image, attributes: attributes) { [weak self] _ in
      self?.choose(id)
    }
    if let subtitle = item["subtitle"] as? String { action.subtitle = subtitle }
    return action
  }

  // A hold on a field in the row stays the field's own (the cursor, the
  // loupe, its edit menu).
  private func isTextInput(at location: CGPoint) -> Bool {
    var view = hitTest(location, with: nil)
    while let current = view, current !== self {
      if current is UITextField || current is UITextView { return true }
      view = current.superview
    }
    return false
  }

  // The row itself lifts, on the white of its label with the label's corners.
  private func preview() -> UITargetedPreview? {
    guard window != nil, bounds.width > 0, bounds.height > 0 else { return nil }
    let parameters = UIPreviewParameters()
    parameters.backgroundColor = previewColor ?? .clear
    parameters.visiblePath = UIBezierPath(roundedRect: bounds, cornerRadius: previewRadius)
    return UITargetedPreview(view: self, parameters: parameters)
  }

  // A hold released before the menu is fully up still reads as a tap to
  // React Native, so in-flight touches on the nearest surface are cancelled
  // when the menu starts, as expo-router's link menus do. The recognizer is
  // only toggled, never reset: UIKit still delivers touchesCancelled after
  // this, and a reset first would desync React Native's touch registry.
  private func cancelReactNativeTouches() {
    guard let touchHandlerClass = NSClassFromString("RCTSurfaceTouchHandler") else { return }
    var view: UIView? = self
    while let current = view {
      if let recognizer = current.gestureRecognizers?.first(where: { $0.isKind(of: touchHandlerClass) }) {
        if recognizer.isEnabled {
          recognizer.isEnabled = false
          recognizer.isEnabled = true
        }
        return
      }
      view = current.superview
    }
  }
}
