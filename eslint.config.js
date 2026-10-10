import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/', '**/coverage/', '**/.angular/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    // Angular components, services and the like are classes whose content lives in their decorator.
    files: ['packages/client/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    // Every declaration in the packages' sources carries JSDoc, exported or not (ADR-0059). Test and config files are
    // left out: test names document behaviour.
    files: ['packages/*/src/**/*.ts', 'packages/*/scripts/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    extends: [jsdoc.configs['flat/recommended-typescript-error']],
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          // `--fix` would insert empty blocks, which satisfy this rule and document nothing.
          enableFixer: false,
          exemptEmptyConstructors: false,
          require: {
            ClassDeclaration: true,
            FunctionDeclaration: true,
            MethodDefinition: true,
          },
          contexts: [
            // Module-level constants, arrow functions assigned to them included; `declare const` too.
            'Program > VariableDeclaration',
            'Program > ExportNamedDeclaration[declaration.type="VariableDeclaration"]',
            // `export default fp(…)`: a Fastify plugin.
            'Program > ExportDefaultDeclaration',
            // Each value of a closed string set, as for enum members (ADR-0043). The event-name objects are left out:
            // `satisfies` ties each key to its event in the event maps, where the event is documented.
            ':matches(Program, ExportNamedDeclaration) > VariableDeclaration > VariableDeclarator > TSAsExpression > ObjectExpression > Property',
            'PropertyDefinition',
            'TSDeclareFunction',
            'TSEnumDeclaration',
            'TSEnumMember',
            'TSInterfaceDeclaration',
            // Members of named types only, not of inline types in casts or type arguments.
            ':matches(TSInterfaceDeclaration, TSTypeAliasDeclaration) :matches(TSMethodSignature, TSPropertySignature)',
            'TSTypeAliasDeclaration',
          ],
        },
      ],
      // A destructured parameter is documented as a whole; its fields are documented on their type.
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      // A getter is read like a property: its description says what it returns.
      'jsdoc/require-returns': ['error', { checkGetters: false }],
      // A description, not only tags: an empty block satisfies `require-jsdoc`.
      'jsdoc/require-description': 'error',
      // A description that only repeats the name it documents (`@param roomId The room's id.`) does not count.
      'jsdoc/informative-docs': 'error',
      // TypeScript carries the types: `@throws` says when, not what (`no-types` covers the other tags).
      'jsdoc/require-throws-type': 'off',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
