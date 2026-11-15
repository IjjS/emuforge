import path from 'node:path';

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// The import boundaries of Studio's two layers (studio/AGENTS.md, "Import boundaries"; requirement R6.6, R8.4,
// R10.2), checked on every import, re-export and `import()` of a file under `src/`, by the folder the import resolves
// to:
// - `@cloudscape-design/*` only under `providers/aws/area/` (a test elsewhere may read the AWS area it renders with
//   Cloudscape's own `components/test-utils`, which no built file contains);
// - `providers/<id>/area/` imports nothing from `app/`, `ui/`, `features/` or another provider's folder;
// - `ui/` and `features/` import nothing from any `providers/*/area/`;
// - outside `providers/<id>/area/` nothing imports it statically; only `providers/<id>/provider.ts` loads it, with
//   `import()`;
// - `lib/` imports nothing from `app/`, `ui/`, `features/` or `providers/` (a test of `lib/` may drive it through
//   the app, as `engine-client.test.ts` does with Home's test kit; no built file is a test);
// - no `expandToViewport` under `providers/aws/area/`: a Cloudscape overlay stays inside the area.

const SRC = path.join(import.meta.dirname, 'src');
const CLOUDSCAPE = '@cloudscape-design/';
const CLOUDSCAPE_IN_NODE_MODULES = `${path.sep}node_modules${path.sep}@cloudscape-design${path.sep}`;
const CLOUDSCAPE_TEST_UTILS = '@cloudscape-design/components/test-utils/';
const UI_FOLDERS = new Set(['app', 'ui', 'features']);

/** Where a file under `src/` sits: `app`, `ui`, `features`, `lib`, `test`, a provider's `area` or its other files. */
function placeOf(file) {
  const rel = path.relative(SRC, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { kind: 'outside' };
  }
  const parts = rel.split(path.sep);
  if (parts[0] === 'providers' && parts.length > 1) {
    return { kind: parts[2] === 'area' ? 'area' : 'provider', provider: parts[1], rel };
  }
  return { kind: parts[0], rel };
}

/** What an import's source names: Cloudscape, a place under `src/`, or a package Studio's layers may share. */
function targetOf(file, source) {
  if (source.startsWith(CLOUDSCAPE)) {
    return { kind: 'cloudscape' };
  }
  if (!source.startsWith('.')) {
    return { kind: 'package' };
  }
  const resolved = path.resolve(path.dirname(file), source);
  if (resolved.includes(CLOUDSCAPE_IN_NODE_MODULES)) {
    return { kind: 'cloudscape' };
  }
  return placeOf(resolved);
}

function isProviderEntry(from, provider) {
  return from.kind === 'provider' && from.rel === path.join('providers', provider, 'provider.ts');
}

/** Why `from` may not import `target`, or `undefined` when it may. */
function brokenBoundary(from, target, source, dynamic, isTest) {
  if (target.kind === 'cloudscape') {
    if (from.kind === 'area' && from.provider === 'aws') return undefined;
    if (isTest && source.startsWith(CLOUDSCAPE_TEST_UTILS)) return undefined;
    return `${source}: Cloudscape is imported only under providers/aws/area/.`;
  }
  if (from.kind === 'area') {
    if (UI_FOLDERS.has(target.kind)) {
      return `${source}: a provider's area imports nothing from Studio's own ${target.kind}/.`;
    }
    if ((target.kind === 'area' || target.kind === 'provider') && target.provider !== from.provider) {
      return `${source}: a provider's area imports nothing from another provider's folder.`;
    }
    return undefined;
  }
  if (target.kind === 'area') {
    if (from.kind === 'ui' || from.kind === 'features') {
      return `${source}: Studio's own ${from.kind}/ imports nothing from a provider's area.`;
    }
    if (!dynamic) {
      return `${source}: a provider's area is not imported statically outside it; its provider.ts loads it with import().`;
    }
    if (!isProviderEntry(from, target.provider)) {
      return `${source}: only providers/${target.provider}/provider.ts loads the area, with import().`;
    }
    return undefined;
  }
  if (from.kind === 'lib' && !isTest && (UI_FOLDERS.has(target.kind) || target.kind === 'provider')) {
    return `${source}: lib/ imports nothing from a UI folder.`;
  }
  return undefined;
}

const boundaries = {
  meta: {
    type: 'problem',
    docs: { description: "Keeps imports inside the boundaries of Studio's two layers." },
    schema: [],
  },
  create(context) {
    const file = context.filename;
    const from = placeOf(file);
    if (from.kind === 'outside') {
      return {};
    }
    const isTest = /\.test\.tsx?$/.test(file);
    const check = (node, sourceNode, dynamic) => {
      let source;
      if (sourceNode?.type === 'Literal' && typeof sourceNode.value === 'string') {
        source = sourceNode.value;
      } else if (sourceNode?.type === 'TemplateLiteral' && sourceNode.expressions.length === 0) {
        source = sourceNode.quasis[0].value.cooked;
      }
      if (source === undefined) {
        return;
      }
      const message = brokenBoundary(from, targetOf(file, source), source, dynamic, isTest);
      if (message !== undefined) {
        context.report({ node, message });
      }
    };
    const inAwsArea = from.kind === 'area' && from.provider === 'aws';
    const expandToViewport = (node) => {
      context.report({
        node,
        message: 'expandToViewport renders a Cloudscape overlay outside the AWS area; it is not used here.',
      });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source, false),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source, false),
      ExportAllDeclaration: (node) => check(node, node.source, false),
      ImportExpression: (node) => check(node, node.source, true),
      ...(inAwsArea && {
        "JSXAttribute[name.name='expandToViewport']": expandToViewport,
        "Property[key.name='expandToViewport']": expandToViewport,
        "Property[key.value='expandToViewport']": expandToViewport,
      }),
    };
  },
};

const studio = { rules: { boundaries } };

export default defineConfig(
  globalIgnores(['dist', 'coverage', 'node_modules', 'output', '.impeccable']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strict],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      studio,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'studio/boundaries': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render untrusted content as text; dangerouslySetInnerHTML is not allowed in Studio.',
        },
      ],
    },
  },
  {
    files: ['vite.config.ts', 'scripts/**/*.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
