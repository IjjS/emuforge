/// <reference types="node" />
// Used by unit tests only; nothing in the app imports it. The bounds of Studio's unit cases (issue 469, requirement
// point 4): a case whose bound is above the default of 5000 ms carries `// Bound: <reason>` on the line directly
// above it, and nothing in a test file raises the bound of many cases at once. A test file is read with TypeScript's
// own parser, so a call inside a case (`setTimeout`, `vi.waitFor`, `findBy…`, `waitFor`) is never taken for the
// case's bound: only the arguments of the `it(` or `test(` call itself are.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** `studio/`. */
export const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The default bound of a case, in milliseconds. */
export const DEFAULT_BOUND_MS = 5000;

/** The comment a raised bound carries on the line directly above its case. */
export const BOUND_COMMENT = '// Bound:';

/** The setting that raises the default bound, refused wherever it appears in a test file. */
const DEFAULT_BOUND_SETTING = 'testTimeout';

/** A case whose bound is above the default. */
export interface RaisedBound {
  /** The 1-based line of the case's `it(` or `test(`. */
  line: number;
  /** The bound as written: `20_000`, `SLOW`, `AREA_LOAD_MS + 5_000`. */
  bound: string;
  /** Whether the line directly above the case starts with `// Bound:`. */
  commented: boolean;
}

/** What the scan names: a file, a 1-based line, and why. */
export interface Finding {
  file: string;
  line: number;
  reason: string;
}

const CASE_CALLS = new Set(['it', 'test']);
const SUITE_CALLS = new Set(['describe', 'suite']);

/** The name a call starts from: `it` of `it(`, `it.skip(`, `it.each([…])(`; `undefined` for anything else. */
function calledName(callee: ts.Expression): string | undefined {
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return calledName(callee.expression);
  }
  if (ts.isCallExpression(callee)) {
    return calledName(callee.expression);
  }
  return undefined;
}

/** Whether a bound as written is above the default: a number above 5000, or anything that is not a number. */
function raised(bound: ts.Expression): boolean {
  if (ts.isNumericLiteral(bound)) {
    return Number(bound.getText().replace(/_/g, '')) > DEFAULT_BOUND_MS;
  }
  return true;
}

/** The `timeout` of an options object, or `undefined` when the argument is not one or has none. */
function timeoutOption(argument: ts.Expression | undefined): ts.Expression | undefined {
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }
  for (const property of argument.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === 'timeout') {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'timeout') {
      return property.name;
    }
  }
  return undefined;
}

/** The bound a case call gives itself: an options object as its second or third argument, or a third argument. */
function caseBound(call: ts.CallExpression): ts.Expression | undefined {
  const [, second, third] = call.arguments;
  const fromOptions = timeoutOption(second) ?? timeoutOption(third);
  if (fromOptions !== undefined) {
    return fromOptions;
  }
  if (third !== undefined && !ts.isObjectLiteralExpression(third)) {
    return third;
  }
  return undefined;
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('case.test.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

/** Every call in `file`, outermost first. */
function calls(file: ts.SourceFile): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The cases of a test file's text whose bound is above the default, in the file's order. */
export function raisedBounds(source: string): RaisedBound[] {
  const file = parse(source);
  const lines = source.split(/\r?\n/);
  const bounds: RaisedBound[] = [];
  for (const call of calls(file)) {
    const name = calledName(call.expression);
    if (name === undefined || !CASE_CALLS.has(name)) {
      continue;
    }
    const bound = caseBound(call);
    if (bound === undefined || !raised(bound)) {
      continue;
    }
    const line = lineOf(file, call);
    const above = line >= 2 ? (lines[line - 2] ?? '') : '';
    bounds.push({ line, bound: bound.getText(file), commented: above.trim().startsWith(BOUND_COMMENT) });
  }
  return bounds;
}

/** What the scan names in one test file's text; `name` is how the file is named in a finding. */
export function scanCaseBounds(source: string, name: string): Finding[] {
  const findings: Finding[] = [];
  for (const bound of raisedBounds(source)) {
    if (!bound.commented) {
      findings.push({
        file: name,
        line: bound.line,
        reason: `a case bound of ${bound.bound} above ${String(DEFAULT_BOUND_MS)} ms with no "${BOUND_COMMENT}" comment on the line directly above`,
      });
    }
  }
  const file = parse(source);
  for (const call of calls(file)) {
    const called = calledName(call.expression);
    if (called === undefined || !SUITE_CALLS.has(called)) {
      continue;
    }
    if (call.arguments.some((argument) => timeoutOption(argument) !== undefined)) {
      findings.push({
        file: name,
        line: lineOf(file, call),
        reason: 'a suite given a timeout, which raises the bound of every case in it',
      });
    }
  }
  source.split(/\r?\n/).forEach((text, at) => {
    if (text.includes(DEFAULT_BOUND_SETTING)) {
      findings.push({
        file: name,
        line: at + 1,
        reason: `"${DEFAULT_BOUND_SETTING}", which raises the bound of many cases at once`,
      });
    }
  });
  return findings.sort((a, b) => a.line - b.line);
}

/** Every unit-test file under `studio/src/`, the set `vite.config.ts`'s `include` reads, relative to `studio/`. */
export function testFiles(): string[] {
  const src = path.join(STUDIO_DIR, 'src');
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => /\.test\.tsx?$/.test(entry))
    .map((entry) => `src/${entry}`)
    .sort();
}

/** A file under `studio/` as it is on disk. */
export function readStudioFile(file: string): string {
  return readFileSync(path.join(STUDIO_DIR, file), 'utf8');
}

/** What the scan names in every unit-test file under `studio/src/`. */
export function scanRepository(): Finding[] {
  return testFiles().flatMap((file) => scanCaseBounds(readStudioFile(file), file));
}
