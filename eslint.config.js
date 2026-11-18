// Lint what the tests and the build cannot see: hooks used out of order,
// effects that read state they do not list, and plain mistakes like unused
// variables. Formatting is left alone.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'data/'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },

  // The browser bundle.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // The server, the build config and the tests run on Node.
  {
    files: ['server.mjs', 'server/**', 'test/**', '*.config.{js,mjs}', '.github/**'],
    languageOptions: { globals: globals.node },
  },

  // Component tests run in jsdom, under Vitest.
  {
    files: ['test/ui/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
