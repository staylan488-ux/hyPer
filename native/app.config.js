// Two builds of the one app (app.json is the base):
// - the test app, by default: "hyPer Native", app.hyper.native, scheme
//   hyper-native, installed beside the Capacitor app;
// - the released app, with HYPER_APP=release: it takes over the Capacitor
//   app's identity (bundle ID app.hyper.mobile, scheme app.hyper.mobile, the
//   widget extension's app.hyper.mobile.HyperWidgets), so it replaces that app
//   on TestFlight and on the phone, keeping its sign-in, Health permission and
//   the WHOOP and sign-in return addresses.
// HYPER_BUILD_NUMBER sets the build number (TestFlight needs a new one each upload).
module.exports = ({ config }) => {
  const buildNumber = process.env.HYPER_BUILD_NUMBER;
  if (buildNumber && !/^\d+$/.test(buildNumber)) throw new Error('HYPER_BUILD_NUMBER must be a whole number.');
  const base = buildNumber ? { ...config, ios: { ...config.ios, buildNumber } } : config;
  if (process.env.HYPER_APP !== 'release') return base;
  return {
    ...base,
    scheme: 'app.hyper.mobile',
    version: '2.0.0',
    ios: {
      ...base.ios,
      bundleIdentifier: 'app.hyper.mobile',
      infoPlist: { ...base.ios.infoPlist, CFBundleDisplayName: 'hyPer' },
    },
    extra: { ...base.extra, widgetBundleIdentifier: 'app.hyper.mobile.HyperWidgets' },
  };
};
