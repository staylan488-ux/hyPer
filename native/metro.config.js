// Metro setup for the native app.
//
// The app reuses the web app's tested logic in ../src (stores, data access,
// nutrition and training rules) without copying it:
// - `@/…` resolves to ../src, exactly as in the web app; `~/…` is this app's src.
// - Packages imported from ../src resolve from this app's node_modules, so there
//   is one React, one Zustand and one Supabase client.
// - A few browser- or Capacitor-only modules are swapped for native versions
//   from src/platform, whether they are imported by alias or relative path.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedSrc = path.resolve(projectRoot, '..', 'src');
const platformDir = path.join(projectRoot, 'src', 'platform');

/** Shared module (path inside ../src, without extension) -> native replacement. */
const replacements = {
  'lib/supabase': 'supabase.ts',
  'lib/nativeBridge': 'nativeBridge.ts',
  'lib/nativeAuth': 'nativeAuth.ts',
  'preview/flag': 'previewFlag.ts',
  'lib/appVisibility': 'appVisibility.ts',
  'lib/haptics': 'haptics.ts',
  'lib/keepAwake': 'keepAwake.ts',
  'lib/restNotifications': 'restNotifications.ts',
  'lib/liveActivity': 'liveActivity.ts',
  'lib/commitFocusedField': 'commitFocusedField.ts',
};
const replacementByFile = new Map();
for (const [shared, native] of Object.entries(replacements)) {
  for (const ext of ['.ts', '.tsx']) {
    replacementByFile.set(path.join(sharedSrc, shared + ext), path.join(platformDir, native));
  }
}

/** Packages the shared code imports that this app replaces outright. */
const packageReplacements = {
  '@capacitor/core': path.join(platformDir, 'capacitorShim.ts'),
  '@capacitor/app': path.join(platformDir, 'capacitorShim.ts'),
  // themeStore sets the status bar style only inside the Capacitor shell.
  '@capacitor/status-bar': path.join(platformDir, 'capacitorShim.ts'),
};

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), sharedSrc];

const upstreamResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstreamResolve ?? context.resolveRequest;
  if (packageReplacements[moduleName]) {
    return { type: 'sourceFile', filePath: packageReplacements[moduleName] };
  }
  let request = moduleName;
  let requestContext = context;

  if (moduleName.startsWith('@/')) {
    request = path.join(sharedSrc, moduleName.slice(2));
  } else if (moduleName.startsWith('~/')) {
    request = path.join(projectRoot, 'src', moduleName.slice(2));
  } else if (
    context.originModulePath.startsWith(sharedSrc + path.sep) &&
    !moduleName.startsWith('.') &&
    !path.isAbsolute(moduleName)
  ) {
    // A package imported by shared code: resolve it as if this app imported it.
    requestContext = { ...context, originModulePath: path.join(projectRoot, 'package.json') };
  }

  const result = resolve(requestContext, request, platform);
  if (result && result.type === 'sourceFile') {
    const replacement = replacementByFile.get(result.filePath);
    if (replacement) return { type: 'sourceFile', filePath: replacement };
  }
  return result;
};

module.exports = config;
