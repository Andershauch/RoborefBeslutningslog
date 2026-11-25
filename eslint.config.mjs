import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {ignores: ['public/client.js', 'node_modules/**', 'data/**']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-kode: server, scripts og tests.
    files: ['src/server/**', 'src/shared/**', 'scripts/**', 'tests/**'],
    languageOptions: {globals: globals.node},
  },
  {
    // Browserkode: React-brugerfladen.
    files: ['src/client/**'],
    languageOptions: {globals: globals.browser},
    plugins: {'react-hooks': reactHooks},
    rules: reactHooks.configs.recommended.rules,
  },
);
