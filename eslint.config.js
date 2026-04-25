import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'eval/out']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      // Most of the codebase runs in the browser (Vite), but a handful of
      // files (src/api/openrouter.js and everything under eval/) also have
      // to load under Node for the eval harness. Expose both globals here
      // rather than scatter /* global process */ pragmas through the code.
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  // The eval harness is pure Node (no JSX, no React). Relax the
  // react-refresh rule for everything under eval/.
  {
    files: ['eval/**/*.js'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
