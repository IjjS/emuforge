// Generates the AWS area's scoped copies of Cloudscape's document-wide styles, so Cloudscape's base applies inside
// the area and nowhere else:
//
// - `index-base.scoped.css`: `@cloudscape-design/global-styles/index-base.css` (normalize and its dark-mode
//   `color-scheme`) with its `html` and `body` rules on the area's root and every other rule inside the area;
// - `base-theme-root.css`: the token block Cloudscape's base theme declares on `body`
//   (`@cloudscape-design/components/internal/base-theme/styles.scoped.css`), declared on the area's root as well, so
//   an alias token resolves there, in the area's mode.
//
// `bun scripts/aws-area-styles.ts` writes both files; `--check` fails when either differs from what it would write.
// A unit test runs the same check. Rerun after upgrading `@cloudscape-design/*`.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

import { AREA_ROOT_CLASS } from '../src/providers/aws/area/styles/root-class.ts';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLOUDSCAPE = path.join(STUDIO, 'node_modules/@cloudscape-design');
const OUT = path.join(STUDIO, 'src/providers/aws/area/styles');

const INDEX_BASE = 'global-styles/index-base.css';
const BASE_THEME = 'components/internal/base-theme/styles.scoped.css';

/** The area's root, at the specificity of nothing, so a rule keeps the specificity it had on `html` or `body`. */
const ROOT = `:where(.${AREA_ROOT_CLASS})`;

interface Rule {
  selectors: string[];
  declarations: string[];
}

interface Block {
  /** `@media not print` and the like; absent for the top level. */
  prelude?: string;
  rules: Rule[];
}

const COMMENT = /\/\*[\s\S]*?\*\//g;

/** The copyright and licence notices among the leading comments of a file. */
function notices(css: string): string {
  const head = /^(\s*\/\*[\s\S]*?\*\/)+/.exec(css)?.[0] ?? '';
  return (head.match(COMMENT) ?? []).filter((comment) => /copyright|license/i.test(comment)).join('\n');
}

function readRule(selectorText: string, body: string): Rule {
  return {
    selectors: selectorText
      .split(',')
      .map((selector) => selector.replace(/\s+/g, ' ').trim())
      .filter((selector) => selector !== ''),
    declarations: body
      .split(';')
      .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
      .filter((declaration) => declaration !== ''),
  };
}

/** A flat stylesheet: rules, and at-rules that hold rules (no deeper nesting, no `@import`). */
function parse(css: string): Block[] {
  const text = css.replace(COMMENT, '');
  const blocks: Block[] = [{ rules: [] }];
  let at = 0;
  let current: Block = blocks[0] as Block;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    const close = text.indexOf('}', at);
    if (close !== -1 && (open === -1 || close < open)) {
      if (text.slice(at, close).trim() !== '' || current.prelude === undefined) {
        throw new Error(`Unexpected "}" at ${String(close)}.`);
      }
      current = { rules: [] };
      blocks.push(current);
      at = close + 1;
      continue;
    }
    if (open === -1) {
      if (text.slice(at).trim() !== '') {
        throw new Error(`Unexpected text at the end: ${text.slice(at).trim()}`);
      }
      break;
    }
    const prelude = text.slice(at, open).trim();
    if (prelude.startsWith('@')) {
      if (current.prelude !== undefined) {
        throw new Error(`Nested at-rule ${prelude}.`);
      }
      current = { prelude, rules: [] };
      blocks.push(current);
      at = open + 1;
      continue;
    }
    const end = text.indexOf('}', open);
    if (end === -1 || text.slice(open + 1, end).includes('{')) {
      throw new Error(`Rule "${prelude}" is not a flat rule.`);
    }
    current.rules.push(readRule(prelude, text.slice(open + 1, end)));
    at = end + 1;
  }
  return blocks.filter((block) => block.rules.length > 0);
}

// `html:has(body.awsui-dark-mode)` gives the page's own scrollbars Cloudscape's dark `color-scheme` when `body` is
// dark. In Studio `body` is never dark: `html`'s `color-scheme` is Studio's own and follows the same system scheme.
const DROPPED = new Set(['html:has(body.awsui-dark-mode)']);

/** One selector of `index-base.css`, moved into the area; `[]` when it styles only what is outside the area. */
function scopeSelector(selector: string): string[] {
  if (selector === 'html' || selector === 'body') {
    return [ROOT];
  }
  if (DROPPED.has(selector)) {
    return [];
  }
  if (selector === '.awsui-dark-mode') {
    return [`${ROOT}.awsui-dark-mode`, `${ROOT} .awsui-dark-mode`];
  }
  if (/(^|[\s>+~(,])(html|body)\b/.test(selector) || selector.startsWith(':root')) {
    throw new Error(`index-base.css has a selector this script does not know how to scope: ${selector}`);
  }
  return [`${ROOT} ${selector}`];
}

function print(blocks: Block[]): string {
  return blocks
    .map((block) => {
      const rules = block.rules
        .map((rule) => ({ ...rule, selectors: rule.selectors.flatMap(scopeSelector) }))
        .filter((rule) => rule.selectors.length > 0)
        .map((rule) => `${rule.selectors.join(',\n')} {\n${rule.declarations.map((d) => `  ${d};`).join('\n')}\n}`)
        .join('\n\n');
      return block.prelude === undefined ? rules : `${block.prelude} {\n${rules}\n}`;
    })
    .join('\n\n');
}

function scopeIndexBase(source: string): string {
  return `${notices(source)}\n\n${print(parse(source))}\n`;
}

/** The base theme's `body` token block, declared on the area's root, in the base theme's own layer. */
function rootBaseTheme(source: string): string {
  const layer = '@layer awsui-base-theme {';
  const start = source.indexOf('\n  body {');
  if (!source.includes(layer) || start === -1 || source.indexOf('\n  body {', start + 1) !== -1) {
    throw new Error('The base theme no longer has exactly one `body` block in `@layer awsui-base-theme`.');
  }
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n  }', open);
  const body = source.slice(open + 1, close);
  if (body.includes('{') || body.includes('}')) {
    throw new Error('The base theme `body` block is not a flat list of declarations.');
  }
  return `${notices(source)}\n\n${layer}\n  ${ROOT} {${body}\n  }\n}\n`;
}

const GENERATED = (from: string) =>
  `/* Generated by studio/scripts/aws-area-styles.ts from @cloudscape-design/${from}. Do not edit. */`;

/** Every generated file, by its path under `studio/`, with the content the script writes. */
export async function generateAreaStyles(): Promise<Map<string, string>> {
  const files: [string, string, (source: string) => string][] = [
    ['index-base.scoped.css', INDEX_BASE, scopeIndexBase],
    ['base-theme-root.css', BASE_THEME, rootBaseTheme],
  ];
  const result = new Map<string, string>();
  for (const [name, from, transform] of files) {
    const source = await readFile(path.join(CLOUDSCAPE, from), 'utf8');
    const target = path.join(OUT, name);
    const options = (await resolveConfig(target)) ?? {};
    const css = await format(`${GENERATED(from)}\n${transform(source)}`, { ...options, parser: 'css' });
    result.set(path.relative(STUDIO, target), css);
  }
  return result;
}

/** The generated files whose content on disk differs from what the script writes. */
export async function staleAreaStyles(): Promise<string[]> {
  const stale: string[] = [];
  for (const [file, css] of await generateAreaStyles()) {
    const current = await readFile(path.join(STUDIO, file), 'utf8').catch(() => '');
    if (current !== css) {
      stale.push(file);
    }
  }
  return stale;
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const stale = await staleAreaStyles();
    if (stale.length > 0) {
      console.error(`Out of date, run bun scripts/aws-area-styles.ts: ${stale.join(', ')}`);
      process.exit(1);
    }
    return;
  }
  for (const [file, css] of await generateAreaStyles()) {
    await writeFile(path.join(STUDIO, file), css);
    console.log(`wrote ${file}`);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
