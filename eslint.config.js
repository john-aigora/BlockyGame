import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': 'error',
      'no-undef': 'error'
    }
  },
  // public/original/ is the byte-for-byte May 2025 museum build — never linted, never touched.
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'public/original/'] }
];
