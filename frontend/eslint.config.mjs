import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the frontend.
 * Next.js-specific rules join this in Phase 10 once real pages exist; for now the scaffold is
 * linted with the shared JS + TypeScript recommendations (see todo.md Phase 1/11).
 */
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },
);
