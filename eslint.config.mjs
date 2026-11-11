import antfu from '@antfu/eslint-config'
import html from '@html-eslint/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig(
  globalIgnores(['dist/**', 'releases/**', 'coverage/**', 'vendor/**']),
  {
    files: ['**/*.{js,mjs,ts,tsx,json,jsonc,yaml,yml,md}'],
    extends: await antfu({
      type: 'app',
      // The extension is bundled without React Fast Refresh.
      react: { overrides: { 'react-refresh/only-export-components': 'off' } },
      test: false, // Tests use node:test, not Vitest.
      e18e: { performanceImprovements: false }, // Avoid unrelated algorithm/performance rewrites.
      typescript: {
        tsconfigPath: 'tsconfig.json',
        files: ['**/*.{js,mjs,ts,tsx}'],
      },
      lessOpinionated: true,
      formatters: false,
      rules: {
        'func-style': ['error', 'expression'],
        // Const callbacks may close over bindings initialized before they are invoked.
        'ts/no-use-before-define': ['error', { variables: false }],
        'style/padding-line-between-statements': [
          'error',
          { blankLine: 'always', prev: '*', next: '*' },
          { blankLine: 'any', prev: 'import', next: 'import' },
        ],
      },
    }),
  },
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
  {
    files: ['tests/helpers/**/*.{ts,tsx}'],
    rules: {
      'antfu/no-top-level-await': 'off',
      'import/no-mutable-exports': 'off',
    },
  },
  {
    files: ['**/*.html'],
    plugins: { html },
    extends: ['html/recommended'],
    language: 'html/html',
  },
)
