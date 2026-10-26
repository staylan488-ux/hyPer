// The shared web code (../src) reads build settings from Vite's
// `import.meta.env`. Hermes has no `import.meta`, so this rewrites every
// `import.meta.env` to a plain object built from Expo's public variables.
// It runs before babel-preset-expo, so the `process.env.EXPO_PUBLIC_*`
// reads it creates are inlined like any others.
module.exports = function viteEnvPlugin({ types: t }) {
  const publicEnv = (name) =>
    t.memberExpression(t.memberExpression(t.identifier('process'), t.identifier('env')), t.identifier(name));

  const envObject = () =>
    t.objectExpression([
      // DEV gates browser-only preview tools (URL flags, session storage).
      t.objectProperty(t.identifier('DEV'), t.booleanLiteral(false)),
      t.objectProperty(t.identifier('PROD'), t.booleanLiteral(true)),
      t.objectProperty(t.identifier('MODE'), t.stringLiteral('native')),
      t.objectProperty(t.identifier('VITE_SUPABASE_URL'), publicEnv('EXPO_PUBLIC_SUPABASE_URL')),
      t.objectProperty(t.identifier('VITE_SUPABASE_ANON_KEY'), publicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY')),
      t.objectProperty(t.identifier('VITE_PHOTO_WORKER_URL'), publicEnv('EXPO_PUBLIC_PHOTO_WORKER_URL')),
    ]);

  const isImportMeta = (node) =>
    t.isMetaProperty(node) && node.meta.name === 'import' && node.property.name === 'meta';

  return {
    name: 'hyper-vite-env',
    visitor: {
      MemberExpression(path) {
        const { node } = path;
        if (isImportMeta(node.object) && t.isIdentifier(node.property, { name: 'env' }) && !node.computed) {
          path.replaceWith(envObject());
        }
      },
    },
  };
};
