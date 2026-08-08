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
  // The suite's game-clock law (plan 027 / CLAUDE.md testing rules): the
  // MAX_DELTA clamp dilates game time under load, so wall-clock waits
  // misread a healthy simulation. The only sanctioned exceptions are the
  // two Web Audio waits in tests/audio.spec.js (context-clock territory),
  // each carrying an eslint-disable comment naming the mechanism.
  {
    files: ['tests/**/*.js'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.property.name='waitForTimeout']",
        message: 'use waitGameSeconds/advance (game clock ≠ wall clock)'
      }]
    }
  },
  // public/original/ is the byte-for-byte May 2025 museum build — never linted, never touched.
  // video/ is a separate npm project (Remotion tooling) with its own deps; not linted here.
  { ignores: ['dist/', 'node_modules/', 'playwright-report/', 'test-results/', 'public/original/', 'video/'] }
];
