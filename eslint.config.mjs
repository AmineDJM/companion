import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Plan-key branching is exactly what the entitlement resolver exists
          // to prevent; a plan must never be hard-coded in product logic.
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/] > Literal[value=/^(free|personal|pro|business)$/]",
          message:
            'Do not branch on a plan key. Ask the resolved entitlements instead (resolveEntitlements).',
        },
      ],
    },
  },
  {
    // The web app is bundled, not run through Node's ESM resolver, so relative
    // specifiers must not carry a `.js` extension. Catching it here stops a
    // whole class of runtime-only module-not-found failures.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*.js', '../*.js', './**/*.js', '../**/*.js'],
              message:
                'Relative imports in apps/web must not use a .js extension (bundler resolution).',
            },
          ],
        },
      ],
    },
  },
  {
    // Worker and packages compile with NodeNext, where the extension is required.
    files: ['packages/**/*.ts', 'apps/worker/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['**/*.config.{ts,mjs,js}', 'scripts/**/*', 'packages/db/src/{migrate,seed}.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
