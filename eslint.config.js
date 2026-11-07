import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated native projects, Babel helpers and local agent worktrees
  // (.claude/worktrees) are not application source.
  globalIgnores(['native/ios/**', 'native/android/**', 'native/.expo/**', 'native/babel/**', '.claude/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['native/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { __DEV__: 'readonly' },
    },
    rules: {
      // Native uses Reanimated shared values, callback refs, and controlled
      // input synchronization. Keep the Rules of Hooks and dependency checks
      // without applying these React Compiler restrictions to those patterns.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      // Metro requires static asset imports; lazy Expo module loads also let
      // shared tests import the module contracts without a native runtime.
      '@typescript-eslint/no-require-imports': ['error', { allow: ['^expo$', '\\.(png|svg)$'] }],
    },
  },
])
