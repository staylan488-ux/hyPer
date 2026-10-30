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

      // [{ id, title, subtitle?, symbol?, destructive?, disabled?, removes?, inline?, children? }]
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
  // The choice made in the open menu. Items keep the menu up when tapped, so
  // the choice is known before the menu starts to close: one that removes
  // the row runs at once and the lifted row fades where it is, as a delete
  // does in Notes; any other runs as soon as the menu is off screen.
  private var chosen: (id: String, removes: Bool)?
  private var pending: String?

  // UIKit's own close takes about 0.35 s; its completion comes only once the
  // returning row's spring settles, about 0.8 s later, which reads as lag.
  private static let closeTime: TimeInterval = 0.35

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
    pending = nil
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
    // A row on its way out has no place to return to: no preview fades it.
    chosen?.removes == true ? nil : preview()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willDisplayMenuFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    onOpen()
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    willEndFor configuration: UIContextMenuConfiguration,
    animator: UIContextMenuInteractionAnimating?
  ) {
    // A choice that opens something (a sheet, an alert, another screen)
    // waits for the menu to be off screen, whichever comes first of UIKit's
    // completion and its visible close.
    guard pending != nil else { return }
    animator?.addCompletion { [weak self] in self?.sendPending() }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.closeTime) { [weak self] in self?.sendPending() }
    if animator == nil { sendPending() }
  }

  // MARK: - Menu

  private func choose(_ id: String, removes: Bool) {
    guard chosen == nil else { return }
    chosen = (id, removes)
    if removes {
      onAction(["id": id])
    } else {
      pending = id
    }
    interaction?.dismissMenu()
  }

  private func sendPending() {
    guard let id = pending else { return }
    pending = nil
    onAction(["id": id])
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
    // The menu stays up when an item is tapped, so the view closes it
    // itself, knowing what was chosen (see `choose`).
    var attributes: UIMenuElement.Attributes = [.keepsMenuPresented]
    if item["destructive"] as? Bool == true { attributes.insert(.destructive) }
    if item["disabled"] as? Bool == true { attributes.insert(.disabled) }
    let removes = item["removes"] as? Bool == true
    let action = UIAction(title: title, image: image, attributes: attributes) { [weak self] _ in
      self?.choose(id, removes: removes)
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
