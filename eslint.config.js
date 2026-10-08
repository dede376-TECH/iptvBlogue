// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['dist/**', 'node_modules/**', '.astro/**', 'public/pagefind/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    files: ['**/*.{ts,js,mjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.astro'],
    rules: {
      // Astro components commonly declare props that are only used in the template.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
