import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error'
    }
  },
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/'] }
];
