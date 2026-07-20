import Capacitor

@objc(HyperBridgeViewController)
final class HyperBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // App-local plugins are not part of Capacitor's generated package list,
        // so register concrete instances after the bridge is available.
        bridge?.registerPluginInstance(HyperAuthPlugin())
        bridge?.registerPluginInstance(HyperRunPlugin())
        bridge?.registerPluginInstance(HyperHealthPlugin())
        bridge?.registerPluginInstance(HyperTimerPlugin())
        bridge?.registerPluginInstance(HyperBarcodePlugin())
    }
}
