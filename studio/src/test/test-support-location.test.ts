// @vitest-environment node
/// <reference types="node" />
// Where shared unit-test support lives (issue #14, requirement R1 to R3): the app project compiles no test support
// and the test project compiles all of it. Each project's file list is the TypeScript compiler's own answer from the
// project's own tsconfig, the set `tsc -p <project> --listFilesOnly` prints. A file the case adds is held in memory
// by the compiler host and never written; this file writes nothing and starts no process.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(STUDIO, 'src');
const TEST_DIR = path.join(SRC, 'test');
const COMPILE_TIMEOUT = 60_000;

/** `file` relative to `studio/`, with forward slashes. */
function rel(file: string): string {
  return path.relative(STUDIO, file).split(path.sep).join('/');
}

function isUnder(file: string, dir: string): boolean {
  const relative = path.relative(dir, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The options and root files of `studio/<project>`, as its own tsconfig gives them. */
function readProject(project: string): ts.ParsedCommandLine {
  const configPath = path.join(STUDIO, project);
  const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, STUDIO, undefined, configPath);
  expect(
    parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    `${project} parses`,
  ).toEqual([]);
  return parsed;
}

/**
 * The absolute paths of every file `studio/<project>` compiles, with `extra` (paths under `studio/` to source text)
 * added as root files that exist only in the compiler host's memory.
 */
function compiledFiles(project: string, extra: Record<string, string> = {}): string[] {
  const parsed = readProject(project);
  const memory = new Map(Object.entries(extra).map(([file, text]) => [path.join(STUDIO, file), text]));
  const host = ts.createCompilerHost(parsed.options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => memory.has(path.resolve(file)) || fileExists.call(host, file);
  host.readFile = (file) => memory.get(path.resolve(file)) ?? readFile.call(host, file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) => {
    const text = memory.get(path.resolve(file));
    return text === undefined
      ? getSourceFile.call(host, file, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(file, text, languageVersion, true);
  };
  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, ...memory.keys()],
    options: parsed.options,
    host,
  });
  return program.getSourceFiles().map((source) => path.resolve(source.fileName));
}

/** Every module specifier `source` names: import, export from, `import()`, `import x = require()`, type imports. */
function specifiersOf(source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteralLike(first)) found.push(first.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (ts.isStringLiteralLike(expression)) found.push(expression.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteralLike(literal)) found.push(literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function parse(file: string, text: string = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** `vitest`, `@testing-library/*` or `@cloudscape-design/components/test-utils/*`. */
function isTestOnlyPackage(specifier: string): boolean {
  return (
    specifier === 'vitest' ||
    specifier.startsWith('vitest/') ||
    specifier.startsWith('@testing-library/') ||
    specifier.startsWith('@cloudscape-design/components/test-utils/')
  );
}

/**
 * The test support among `files` (absolute paths), relative to `studio/` and sorted: each file under `src/` that is
 * under `src/test/` or imports a test-only package. `extra` holds the text of files that exist only in memory.
 */
function testSupportIn(files: string[], extra: Record<string, string> = {}): string[] {
  const memory = new Map(Object.entries(extra).map(([file, text]) => [path.join(STUDIO, file), text]));
  return files
    .filter((file) => isUnder(file, SRC))
    .filter(
      (file) =>
        isUnder(file, TEST_DIR) || specifiersOf(parse(file, memory.get(file))).some((s) => isTestOnlyPackage(s)),
    )
    .map(rel)
    .sort();
}

/** Every file under `dir`, recursively, as absolute paths. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** What a relative `specifier` written in `file` names under `studio/`, without its extension. */
function targetOf(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  return rel(path.resolve(path.dirname(file), specifier)).replace(/\.(tsx?|jsx?)$/, '');
}

/** The targets of the relative imports of `studio/<file>`. */
function importTargets(file: string): string[] {
  const absolute = path.join(STUDIO, file);
  return specifiersOf(parse(absolute)).flatMap((s) => targetOf(absolute, s) ?? []);
}

const KIT = 'src/test/home-test-kit';
const OLD_KIT = 'src/features/home/home-test-kit';

describe('test support: the app project', () => {
  it(
    'lists the files the app project compiles → none is under src/test/ and none imports a test-only package',
    () => {
      expect(testSupportIn(compiledFiles('tsconfig.app.json'))).toEqual([]);
    },
    COMPILE_TIMEOUT,
  );

  it(
    'adds src/features/home/x.tsx importing @testing-library/react, in memory → the check reports that file only',
    () => {
      const extra = {
        'src/features/home/x.tsx': "import { render } from '@testing-library/react';\n\nexport const used = render;\n",
      };
      expect(existsSync(path.join(STUDIO, 'src/features/home/x.tsx')), 'x.tsx is not on disk').toBe(false);
      expect(testSupportIn(compiledFiles('tsconfig.app.json', extra), extra)).toEqual(['src/features/home/x.tsx']);
    },
    COMPILE_TIMEOUT,
  );

  it(
    'adds src/features/home/y.tsx importing src/test/setup.ts, in memory → the check reports src/test/setup.ts only',
    () => {
      const extra = { 'src/features/home/y.tsx': "import '../../test/setup';\n\nexport const used = true;\n" };
      expect(existsSync(path.join(STUDIO, 'src/features/home/y.tsx')), 'y.tsx is not on disk').toBe(false);
      expect(testSupportIn(compiledFiles('tsconfig.app.json', extra), extra)).toEqual(['src/test/setup.ts']);
    },
    COMPILE_TIMEOUT,
  );
});

describe('test support: the test project', () => {
  it(
    'lists the files the test project compiles → every file under src/test/ is among them, home-test-kit.tsx included',
    () => {
      const compiled = new Set(compiledFiles('tsconfig.test.json').map(rel));
      const underTest = filesUnder(TEST_DIR).map(rel).sort();
      expect(underTest.filter((file) => !compiled.has(file))).toEqual([]);
      expect([...compiled]).toContain('src/test/home-test-kit.tsx');
    },
    COMPILE_TIMEOUT,
  );

  it('reads the imports of the five test files → each imports src/test/home-test-kit.tsx, none the old path', () => {
    const users = [
      'src/app/app.test.tsx',
      'src/features/home/command-block.test.tsx',
      'src/features/home/connection-status.test.tsx',
      'src/features/home/home-page.test.tsx',
      'src/lib/engine/engine-client.test.ts',
    ];
    const notImportingKit = users.filter((file) => !importTargets(file).includes(KIT));
    const importingOldPath = filesUnder(SRC)
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))
      .map(rel)
      .filter((file) => importTargets(file).includes(OLD_KIT))
      .sort();
    expect({ notImportingKit, importingOldPath }).toEqual({ notImportingKit: [], importingOldPath: [] });
  });
});
