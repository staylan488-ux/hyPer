import ExpoModulesCore
import Metal
import UIKit

// The molten-glass field behind the app (see HyperGlassFieldView). The functions reach every
// field that is on screen right now; positions are window points (a touch's pageX / pageY).
public class HyperGlassFieldModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HyperGlassField")

    Constant("available") { MTLCreateSystemDefaultDevice() != nil }

    // Build the shaders in the background as soon as the module loads.
    OnCreate {
      DispatchQueue.main.async { GlassGPU.prepare() }
    }

    /// A finger on the page: phase 0 down, 1 moved, 2 up or cancelled.
    Function("touch") { (phase: Int, x: Double, y: Double) in
      DispatchQueue.main.async {
        HyperGlassFieldView.reach { $0.touch(phase: phase, at: CGPoint(x: x, y: y)) }
      }
    }

    /// The page scrolled by (dx, dy) points.
    Function("stir") { (dx: Double, dy: Double) in
      DispatchQueue.main.async {
        HyperGlassFieldView.reach { $0.stir(dx: CGFloat(dx), dy: CGFloat(dy)) }
      }
    }

    /// The warm wave from a press at (x, y).
    Function("wave") { (x: Double, y: Double) in
      DispatchQueue.main.async {
        HyperGlassFieldView.reach { $0.wave(at: CGPoint(x: x, y: y)) }
      }
    }

    /// A raw splat in the reference's units: x, y in 0…1 (y up), forces as glass6.html's, colour 0 for none.
    Function("splat") { (x: Double, y: Double, dx: Double, dy: Double, r: Double, g: Double, b: Double, radius: Double) in
      DispatchQueue.main.async {
        HyperGlassFieldView.reach {
          $0.splat(x: Float(x), y: Float(y), dx: Float(dx), dy: Float(dy), color: SIMD3(Float(r), Float(g), Float(b)), radius: Float(radius))
        }
      }
    }

    /// 'dark', 'light', or null to follow each field's own appearance.
    Function("setAppearance") { (appearance: String?) in
      DispatchQueue.main.async {
        HyperGlassFieldView.appearanceOverride = appearance.map { $0 == "light" }
      }
    }

    /// true / false, or null to follow iOS's Reduce Motion.
    Function("setReduceMotion") { (on: Bool?) in
      DispatchQueue.main.async {
        HyperGlassFieldView.reduceMotionOverride = on
      }
    }

    View(HyperGlassFieldView.self) {
      Prop("appearance") { (view: HyperGlassFieldView, value: String?) in
        view.appearanceProp = value
      }
      Prop("reduceMotion") { (view: HyperGlassFieldView, value: Bool?) in
        view.reduceMotionProp = value
      }
      Prop("paused") { (view: HyperGlassFieldView, value: Bool?) in
        view.paused = value ?? false
      }
      Prop("debugStats") { (view: HyperGlassFieldView, value: Bool?) in
        view.debugStats = value ?? UserDefaults.standard.bool(forKey: "hyperGlassStats")
      }
      Prop("demo") { (view: HyperGlassFieldView, value: String?) in
        view.demo = value
      }
      Prop("demoFrameMs") { (view: HyperGlassFieldView, value: Double?) in
        view.demoFrameMs = value ?? 16
      }
      Prop("demoDot") { (view: HyperGlassFieldView, value: Bool?) in
        view.demoDot = value ?? false
      }
      Prop("snapshot") { (view: HyperGlassFieldView, value: String?) in
        view.snapshotSpec = value
      }
    }
  }
}
