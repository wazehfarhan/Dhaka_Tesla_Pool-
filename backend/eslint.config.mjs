import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Logging goes through the Pino logger only (architecture.md §8).
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // CLI seed script is allowed to log to stdout/stderr
    files: ['prisma/seed.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Tests may use type assertions for mocks
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);

