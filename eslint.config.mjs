import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'content/**', 'public/assets/**', 'graphify-out/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Plain ES-module scripts run under Node; the layout verifier also evaluates code in the page.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly', Buffer: 'readonly', console: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        document: 'readonly', location: 'readonly', getComputedStyle: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly',
      },
    },
  },
);
