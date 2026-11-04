import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import * as compilerRuntime from 'react/compiler-runtime';
import * as jsxRuntime from 'react/jsx-runtime';
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../native');

type Babel = {
  transformSync: (code: string, options: Record<string, unknown>) => { code?: string | null } | null;
};

/**
 * The app's React Compiler pass (app.json enables it), from the app's own
 * packages. Any function in the file it can't compile fails the test, so a
 * test that relies on compiled memoization never quietly runs uncompiled code.
 */
function reactCompile(source: string, filename: string): string {
  const nativeRequire = createRequire(resolve(nativeRoot, 'package.json'));
  const babel = nativeRequire('@babel/core') as Babel;
  const result = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[nativeRequire.resolve('babel-plugin-react-compiler'), { panicThreshold: 'all_errors' }]],
  });
  if (!result?.code) throw new Error(`React Compiler produced nothing for ${filename}`);
  return result.code;
}

/**
 * Runs a native component's real hooks and callbacks in the DOM test renderer.
 * Native views and device services are supplied explicitly by each test; an
 * undeclared import fails instead of loading a native module or a real backend.
 * With `compile`, the component runs as the app ships it, memoized by the
 * React Compiler.
 */
export function loadNativeModule<Exports>(file: string, imports: Record<string, unknown>, options: { compile?: boolean } = {}): Exports {
  const path = resolve(nativeRoot, 'src', file);
  const read = readFileSync(path, 'utf8');
  const source = options.compile ? reactCompile(read, path) : read;
  const { outputText } = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022 },
  });
  const dependencies = { ...imports, react: React, 'react/jsx-runtime': jsxRuntime, 'react/compiler-runtime': compilerRuntime };
  const require = (name: string) => {
    if (!(name in dependencies)) throw new Error(`Test must supply ${name} for ${file}`);
    return dependencies[name as keyof typeof dependencies];
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports as Exports;
}
