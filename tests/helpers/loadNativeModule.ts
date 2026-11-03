import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript';

/**
 * Runs a native component's real hooks and callbacks in the DOM test renderer.
 * Native views and device services are supplied explicitly by each test; an
 * undeclared import fails instead of loading a native module or a real backend.
 */
export function loadNativeModule<Exports>(file: string, imports: Record<string, unknown>): Exports {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../native/src', file), 'utf8');
  const { outputText } = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, target: ScriptTarget.ES2022 },
  });
  const dependencies = { ...imports, react: React, 'react/jsx-runtime': jsxRuntime };
  const require = (name: string) => {
    if (!(name in dependencies)) throw new Error(`Test must supply ${name} for ${file}`);
    return dependencies[name as keyof typeof dependencies];
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports);
  return module.exports as Exports;
}
