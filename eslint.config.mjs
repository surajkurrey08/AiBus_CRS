import js from '@eslint/js';
import ts from 'typescript-eslint';

// Syntax/correctness lint; TypeScript checks types separately. Existing business
// code is not reformatted or forced through new stylistic rules by this change.
export default ts.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '.cache/**', 'backups/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['{frontend,admin,partner,backend}/src/**/*.{ts,tsx}', 'backend/tests/**/*.ts', 'integrations/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { parser: ts.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off', // tsc understands Node/DOM globals and TypeScript declarations.
      'no-unused-vars': 'off', // Not introduced retrospectively as a style migration.
      'no-redeclare': 'off', // TypeScript supports declaration merging.
      'no-useless-assignment': 'off', // Existing initialization style.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['backend/src/services/inventory.service.ts', 'backend/src/validators/common.schemas.ts'], rules: { 'no-control-regex': 'off' } }, // Input validation deliberately rejects control characters.
  { files: ['backend/tests/integration/system.test.ts'], rules: { 'no-irregular-whitespace': 'off' } }, // Existing embedded BOM before an import.
);
