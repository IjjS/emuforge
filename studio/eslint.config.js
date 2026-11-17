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
// - no `expandToViewport` under `providers/aws/area/`: a Cloudscape overlay stays inside the area;
// - `i18n/`, Studio's own layer's only source of text (issue #17, requirement R4.10), imports nothing from `app/`,
//   `ui/`, `features/` or `providers/` (a test of `i18n/` may render what reads it, as a test of `lib/` may), and
//   `providers/<id>/area/` and `lib/` import nothing from it;
// - a service's folder `providers/<id>/area/services/<service>/` (issue 386, requirement R3.2, R3.5, R8.1): no file
//   of the area outside `services/` names one in an import, a re-export or an `import()` (a test may), and a service
//   folder imports nothing from another's, its tests included;
// - an AWS SDK client (`<Name>Client`) or aggregated class (`<Name>`) imported from an `@aws-sdk/client-*` package is
//   constructed with `new` only under `lib/aws/` or in a test (R6.8); a command, an error or a paginator may be;
// - a file pattern (`import.meta.glob`) is no import to the rules above, so it has its own (R8.1): none outside
//   `providers/<id>/area/` but the one pattern `./area/services/*/service.json` of `providers/aws/services.ts` (data
//   only, R13.3) and the catalogues' `./messages/*.json` of `i18n/bundled.ts`; inside the area outside `services/`, none that names a service's folder rather than `services/*`;
//   inside a service folder, none that leaves it. A test may use any.

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
    if (parts[2] !== 'area') {
      return { kind: 'provider', provider: parts[1], rel };
    }
    // `providers/<id>/area/services/<service>/…`: the service's folder, or anything in it.
    const service = parts[3] === 'services' && parts.length > 4 ? parts[4] : undefined;
    return { kind: 'area', provider: parts[1], service, rel };
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
  if (target.kind === 'i18n') {
    if (from.kind === 'area') {
      return `${source}: a provider's area imports nothing from Studio's own i18n/; it is English as its console.`;
    }
    if (from.kind === 'lib' && !isTest) {
      return `${source}: lib/ imports nothing from i18n/.`;
    }
    return undefined;
  }
  if (
    from.kind === 'i18n' &&
    !isTest &&
    (UI_FOLDERS.has(target.kind) || target.kind === 'area' || target.kind === 'provider')
  ) {
    return `${source}: i18n/ imports nothing from app/, ui/, features/ or providers/.`;
  }
  if (from.kind === 'area') {
    if (UI_FOLDERS.has(target.kind)) {
      return `${source}: a provider's area imports nothing from Studio's own ${target.kind}/.`;
    }
    if ((target.kind === 'area' || target.kind === 'provider') && target.provider !== from.provider) {
      return `${source}: a provider's area imports nothing from another provider's folder.`;
    }
    if (target.kind === 'area' && target.service !== undefined) {
      if (from.service === undefined && !isTest) {
        return `${source}: no file of the area outside services/ names a service's folder; the area collects services/*/screens.ts by pattern.`;
      }
      if (from.service !== undefined && from.service !== target.service) {
        return `${source}: a service folder imports nothing from another service's folder; what two share goes to components/ or lib/.`;
      }
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

const SDK_CLIENT_PACKAGE = /^@aws-sdk\/client-([a-z0-9-]+)$/;

/**
 * Whether `name`, imported from the package `@aws-sdk/client-<id>`, is its client class or its aggregated class:
 * the service's name as the package spells it (`SNS` for `client-sns`, `APIGateway` for `client-api-gateway`), with
 * or without `Client`. Commands, errors and paginators have other names.
 */
function isSdkClientClass(name, id) {
  const service = id.replaceAll('-', '');
  const lower = name.toLowerCase();
  return lower === service || lower === `${service}client`;
}

/** The variable `name` refers to at `node`, from its scope outward. */
function variableAt(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope !== null; scope = scope.upper) {
    const variable = scope.set.get(name);
    if (variable !== undefined) return variable;
  }
  return undefined;
}

/** The SDK client class `new` constructs at `node`, as `<package> <name>`, or `undefined` when it constructs none. */
function constructedSdkClient(sourceCode, node) {
  const callee = node.callee;
  const local = callee.type === 'Identifier' ? callee : callee.type === 'MemberExpression' ? callee.object : null;
  if (local?.type !== 'Identifier') return undefined;
  const definition = variableAt(sourceCode, node, local.name)?.defs[0];
  if (definition?.type !== 'ImportBinding') return undefined;
  const source = definition.parent.source.value;
  const id = SDK_CLIENT_PACKAGE.exec(source)?.[1];
  if (id === undefined) return undefined;
  let name;
  if (callee.type === 'Identifier' && definition.node.type === 'ImportSpecifier') {
    name =
      definition.node.imported.type === 'Identifier' ? definition.node.imported.name : definition.node.imported.value;
  } else if (
    callee.type === 'MemberExpression' &&
    definition.node.type === 'ImportNamespaceSpecifier' &&
    !callee.computed &&
    callee.property.type === 'Identifier'
  ) {
    name = callee.property.name;
  }
  return name !== undefined && isSdkClientClass(name, id) ? `${source} ${name}` : undefined;
}

/** The text of a literal string, or of a template without expressions; `undefined` for anything else. */
function stringOf(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}

/** The patterns of an `import.meta.glob` call: its first argument, a string or a list of them. */
function globPatterns(node) {
  const first = node.arguments[0];
  const items = first?.type === 'ArrayExpression' ? first.elements : [first];
  return items.map((item) => stringOf(item));
}

/**
 * The patterns allowed outside an area, by file: `providers/aws/services.ts` collects each service's `service.json`
 * (R13.3), and `i18n/bundled.ts` bundles Studio's own catalogues, which are no file of an area.
 */
const PATTERNS_OUTSIDE_AREAS = new Map([
  [path.join('providers', 'aws', 'services.ts'), './area/services/*/service.json'],
  [path.join('i18n', 'bundled.ts'), './messages/*.json'],
]);

/** Why `from`, at `file`, may not use the file patterns `patterns`, or `undefined` when it may. */
function brokenPattern(file, from, patterns) {
  if (from.kind !== 'area') {
    if (patterns.length === 1 && patterns[0] === PATTERNS_OUTSIDE_AREAS.get(from.rel)) {
      return undefined;
    }
    return "import.meta.glob is used only inside a provider's area, but for providers/aws/services.ts's ./area/services/*/service.json and i18n/bundled.ts's ./messages/*.json.";
  }
  for (const pattern of patterns) {
    if (pattern === undefined) {
      return 'import.meta.glob takes literal patterns here, so the boundaries can be checked.';
    }
    const bare = pattern.replace(/^!/, '');
    const resolved = bare.startsWith('/')
      ? path.join(import.meta.dirname, bare)
      : path.resolve(path.dirname(file), bare);
    const target = placeOf(resolved);
    if (from.service !== undefined) {
      if (target.kind !== 'area' || target.provider !== from.provider || target.service !== from.service) {
        return `${pattern}: a service folder's file pattern stays inside its own folder.`;
      }
    } else if (
      target.kind === 'area' &&
      target.service !== undefined &&
      target.service !== '*' &&
      target.service !== '**'
    ) {
      return `${pattern}: a file pattern of the area outside services/ names no service's folder; it reads services/*.`;
    }
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
    const sdkClientsAllowed =
      isTest || (from.kind === 'lib' && from.rel.startsWith(path.join('lib', 'aws') + path.sep));
    const newOfClient = (node) => {
      const client = constructedSdkClient(context.sourceCode, node);
      if (client !== undefined) {
        context.report({
          node,
          message: `new ${client}: an AWS SDK client is constructed only in src/lib/aws, by the client factory.`,
        });
      }
    };
    const filePattern = (node) => {
      const message = brokenPattern(file, from, globPatterns(node));
      if (message !== undefined) {
        context.report({ node, message });
      }
    };
    return {
      ...(!sdkClientsAllowed && { NewExpression: newOfClient }),
      ...(!isTest && {
        "CallExpression[callee.type='MemberExpression'][callee.object.type='MetaProperty'][callee.object.meta.name='import'][callee.object.property.name='meta'][callee.property.name='glob']":
          filePattern,
      }),
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
