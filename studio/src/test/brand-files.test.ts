/// <reference types="node" />
// EmuForge's brand files as files (issue 36, test-criteria.md, "Unit — test/brand-files.test.ts"): which files exist
// (requirement R5.1), what each vector file holds and may not hold (R5.2), that the tile path keeps the symbol's head
// (R4.2), the code sign (R4.3), the favicon's two schemes (R7.2), the social image's logo (R8.6), the rasters' sizes
// (R5.1, R5.3), the script that writes the files and its font parser (R5.3, R5.4), and that nothing of the owner's
// reference sheet is tracked (R5.6). The files are read from the checkout; how they draw is the flow checks'
// (tests/integration/studio/brand.spec.ts and tests/integration/studio/brand-files.spec.ts).

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SYMBOL_PATH, TILE_PATH } from '../ui/brand-paths';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY = path.resolve(STUDIO, '..');

const LOGOS = ['logo-primary-light.svg', 'logo-primary-dark.svg', 'logo-compact-light.svg', 'logo-compact-dark.svg'];
const APP_ICONS = ['app-icon-teal.svg', 'app-icon-cream.svg', 'app-icon-night.svg', 'app-icon-teal-square.svg'];
/** Every vector file of R5.1's table that places the tile path: all but `symbol.svg`. */
const TILE_FILES = [...LOGOS, ...APP_ICONS, 'favicon.svg', 'social.svg'];
const VECTOR_FILES = ['symbol.svg', ...TILE_FILES];
/** How many times a file places the tile path: the social image's logo and its window's tile; once elsewhere. */
const TILES_IN: Record<string, number> = { 'social.svg': 2 };

/** R5.1's table: the files of `brand/` and of `public/`, and no other. */
const BRAND_FILES = [
  'symbol.svg',
  ...LOGOS,
  ...APP_ICONS,
  ...['teal', 'cream', 'night'].flatMap((g) => [`app-icon-${g}-192.png`, `app-icon-${g}-512.png`]),
  'social.svg',
  'social-1200x630.png',
];
const PUBLIC_FILES = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'];

/** The file of R5.1's table: the three files Studio serves at a fixed path are in `public/`, the rest in `brand/`. */
function brandFile(name: string): string {
  const folder = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png'].includes(name) ? 'public' : 'brand';
  return path.join(STUDIO, folder, name);
}

function read(name: string): string {
  return readFileSync(brandFile(name), 'utf8');
}

function parse(name: string): Document {
  const doc = new DOMParser().parseFromString(read(name), 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror'), `${name} parses as XML`).toHaveLength(0);
  return doc;
}

function elements(doc: Document): Element[] {
  return [...doc.getElementsByTagName('*')];
}

/** The `path` elements filled `evenodd`: the symbol path or the tile path (R5.2). */
function markPaths(doc: Document): Element[] {
  return elements(doc).filter((e) => e.localName === 'path' && e.getAttribute('fill-rule') === 'evenodd');
}

/** A path element is stroked when it has a stroke other than `none`, by attribute or by an ancestor's. */
function isStroked(e: Element): boolean {
  for (let at: Element | null = e; at; at = at.parentElement) {
    const stroke = at.getAttribute('stroke');
    if (stroke !== null) return stroke !== 'none';
  }
  return false;
}

// --- path data -------------------------------------------------------------------------------------------------

type Point = [number, number];

/** One drawing segment: its command and its points, absolute, in the path's own units. */
interface Segment {
  command: string;
  points: Point[];
}

/** The subpaths of absolute `M`, `L`, `C`, `Q` and `Z` path data, each a start point and its segments. */
function subpaths(d: string): { start: Point; segments: Segment[] }[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: { start: Point; segments: Segment[] }[] = [];
  let command = '';
  let i = 0;
  const number = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i] as string)) command = tokens[i++] as string;
    const current = out[out.length - 1];
    switch (command) {
      case 'M':
        out.push({ start: [number(), number()], segments: [] });
        command = 'L';
        break;
      case 'L':
        current?.segments.push({ command, points: [[number(), number()]] });
        break;
      case 'Q':
        current?.segments.push({
          command,
          points: [
            [number(), number()],
            [number(), number()],
          ],
        });
        break;
      case 'C':
        current?.segments.push({
          command,
          points: [
            [number(), number()],
            [number(), number()],
            [number(), number()],
          ],
        });
        break;
      case 'Z':
        current?.segments.push({ command, points: [] });
        break;
      default:
        throw new Error(`path data with the command ${command}: only absolute M, L, C, Q and Z are read`);
    }
  }
  return out;
}

/** The segment count of path data: every drawing command, `Z` included. */
function segmentCount(d: string): number {
  return subpaths(d).reduce((n, s) => n + s.segments.length, 0);
}

/** The numbers of path data or an attribute with more than two decimals. */
function longNumbers(text: string): string[] {
  return text.match(/\d*\.\d{3,}/g) ?? [];
}

/** A `transform` of `translate` and `scale` only, as a scale and a translation. */
function transformOf(value: string | null): { scale: number; x: number; y: number } {
  let t = { scale: 1, x: 0, y: 0 };
  for (const [, name, args] of (value ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = (args ?? '')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (name === 'translate') t = { ...t, x: t.x + t.scale * (a[0] ?? 0), y: t.y + t.scale * (a[1] ?? 0) };
    else if (name === 'scale' && (a.length === 1 || a[0] === a[1])) t = { ...t, scale: t.scale * (a[0] ?? 1) };
    else throw new Error(`transform ${value ?? ''}: only translate and a uniform scale are read`);
  }
  return t;
}

/** Where an element's own units sit in its file's root units: its transform and its ancestors', composed. */
function placementOf(e: Element): { scale: number; x: number; y: number } {
  const chain: Element[] = [];
  for (let at: Element | null = e; at && at.localName !== 'svg'; at = at.parentElement) chain.unshift(at);
  return chain.reduce(
    (t, at) => {
      const own = transformOf(at.getAttribute('transform'));
      return { scale: t.scale * own.scale, x: t.x + t.scale * own.x, y: t.y + t.scale * own.y };
    },
    { scale: 1, x: 0, y: 0 },
  );
}

/** A file's root `viewBox`, mapped to a square of side 1 by its larger side: the units the file is drawn in. */
function viewBoxOf(doc: Document): { x: number; y: number; size: number } {
  const [x, y, w, h] = (doc.documentElement.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return { x: x ?? 0, y: y ?? 0, size: Math.max(w ?? 1, h ?? 1) };
}

// --- the files -------------------------------------------------------------------------------------------------

describe('the brand files', () => {
  it('brand/ and public/ hold exactly the files of R5.1, and no two files have the same bytes', () => {
    expect(readdirSync(path.join(STUDIO, 'brand')).sort()).toEqual([...BRAND_FILES].sort());
    expect(readdirSync(path.join(STUDIO, 'public')).sort()).toEqual([...PUBLIC_FILES].sort());
    const bytes = [...BRAND_FILES, ...PUBLIC_FILES].map((name) => readFileSync(brandFile(name)).toString('base64'));
    expect(new Set(bytes).size).toBe(bytes.length);
  });
});

const ALLOWED = new Set(['svg', 'path', 'rect', 'circle', 'g', 'clipPath', 'defs', 'title']);

describe('every vector file', () => {
  it.each(VECTOR_FILES)(
    '%s parses as XML with root svg, a viewBox and a non-empty title as its first child',
    (name) => {
      const root = parse(name).documentElement;
      expect(root.localName).toBe('svg');
      expect(
        root
          .getAttribute('viewBox')
          ?.trim()
          .split(/[\s,]+/),
      ).toHaveLength(4);
      const first = root.firstElementChild;
      expect(first?.localName).toBe('title');
      expect(first?.textContent?.trim()).not.toBe('');
    },
  );

  it.each(VECTOR_FILES)('%s holds only the allowed elements and no reference out of the file', (name) => {
    const doc = parse(name);
    const text = read(name);
    const kinds = new Set(elements(doc).map((e) => e.localName));
    const allowed = name === 'favicon.svg' ? new Set([...ALLOWED, 'style']) : ALLOWED;
    expect([...kinds].filter((k) => !allowed.has(k))).toEqual([]);
    for (const kind of ['image', 'text', 'filter', 'foreignObject', 'script']) {
      expect(doc.getElementsByTagName(kind), `${name}: no ${kind}`).toHaveLength(0);
    }
    const ids = new Set(
      elements(doc)
        .map((e) => e.getAttribute('id'))
        .filter((id) => id !== null),
    );
    const attributes = elements(doc).flatMap((e) => [...e.attributes]);
    expect(attributes.filter((a) => /^on/i.test(a.localName)).map((a) => a.name)).toEqual([]);
    expect(text).not.toMatch(/data:/i);
    for (const a of attributes.filter((a) => a.localName === 'href')) {
      expect(a.value.startsWith('#') && ids.has(a.value.slice(1)), `${name}: href ${a.value}`).toBe(true);
    }
    for (const [, target] of text.matchAll(/url\(\s*['"]?([^)'"]*)['"]?\s*\)/g)) {
      expect(target?.startsWith('#') && ids.has(target.slice(1)), `${name}: url(${target ?? ''})`).toBe(true);
    }
  });

  it.each(VECTOR_FILES)('%s has no opacity, no colour with alpha and no gradient', (name) => {
    const doc = parse(name);
    const text = read(name);
    expect(text).not.toMatch(/opacity/i);
    expect(doc.getElementsByTagName('linearGradient')).toHaveLength(0);
    expect(doc.getElementsByTagName('radialGradient')).toHaveLength(0);
    const colours = [
      ...elements(doc).flatMap((e) => ['fill', 'stroke', 'color'].map((a) => e.getAttribute(a) ?? '')),
      ...[...doc.getElementsByTagName('style')].map((s) => s.textContent ?? ''),
    ].join(' ');
    expect(colours).not.toMatch(/rgba|hsla|transparent|#[0-9a-f]{8}\b|#[0-9a-f]{4}\b|\/\s*[\d.]+%?\s*\)/i);
  });
});

describe('the symbol path and the tile path', () => {
  it('symbol.svg holds the symbol path: one evenodd path, two subpaths, no stroke, at most 60 segments', () => {
    const doc = parse('symbol.svg');
    const paths: Element[] = [...doc.getElementsByTagName('path')];
    expect(paths).toHaveLength(1);
    const mark = paths[0] as Element;
    expect(mark.getAttribute('fill-rule')).toBe('evenodd');
    expect(isStroked(mark)).toBe(false);
    const d = mark.getAttribute('d') ?? '';
    expect(d).toBe(SYMBOL_PATH);
    expect(subpaths(d)).toHaveLength(2);
    expect(segmentCount(d)).toBeLessThanOrEqual(60);
    expect(longNumbers(d)).toEqual([]);
  });

  it.each(TILE_FILES)('%s holds the tile path under the same limits, and not the symbol path', (name) => {
    const doc = parse(name);
    const marks = markPaths(doc);
    expect(marks).toHaveLength(TILES_IN[name] ?? 1);
    for (const mark of marks) {
      const d = mark.getAttribute('d') ?? '';
      expect(d).toBe(TILE_PATH);
      expect(isStroked(mark)).toBe(false);
      expect(subpaths(d)).toHaveLength(2);
      expect(segmentCount(d)).toBeLessThanOrEqual(60);
      expect(longNumbers(d)).toEqual([]);
    }
    expect(read(name)).not.toContain(SYMBOL_PATH);
  });

  it('the tile path differs from the symbol path', () => {
    expect(TILE_PATH).not.toBe(SYMBOL_PATH);
  });

  it.each(TILE_FILES)(
    "%s: the tile path's head and eye are the symbol path's after one uniform scale and one translation",
    (name) => {
      const doc = parse(name);
      const marks = markPaths(doc);
      expect(marks.length).toBeGreaterThan(0);
      for (const mark of marks) expectHeadOfSymbol(doc, mark);
    },
  );
});

/**
 * The tile path `mark` as its file places it keeps the symbol path's head and eye: after one uniform scale and one
 * translation they equal the symbol path's within 0.01, and only segments below the head differ.
 */
function expectHeadOfSymbol(doc: Document, mark: Element): void {
  // The tile path as the file places it, in units of its viewBox's larger side.
  const at = placementOf(mark);
  const box = viewBoxOf(doc);
  const place = ([x, y]: Point): Point => [
    (at.x + at.scale * x - box.x) / box.size,
    (at.y + at.scale * y - box.y) / box.size,
  ];
  const tile = subpaths(mark.getAttribute('d') ?? '');
  const symbol = subpaths(SYMBOL_PATH);
  // The one scale and translation from the placed tile path to the symbol path, by the first point and the eye's.
  const [p0, q0] = [place((tile[0] as { start: Point }).start), (symbol[0] as { start: Point }).start];
  const [p1, q1] = [place((tile[1] as { start: Point }).start), (symbol[1] as { start: Point }).start];
  const scale = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) / Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const map = ([x, y]: Point): Point => [q0[0] + (x - p0[0]) * scale, q0[1] + (y - p0[1]) * scale];
  const same = (a: Segment, b: Segment) =>
    a.command === b.command &&
    a.points.length === b.points.length &&
    a.points.every((p, k) => {
      const m = map(place(p));
      const s = b.points[k] as Point;
      return Math.abs(m[0] - s[0]) <= 0.01 && Math.abs(m[1] - s[1]) <= 0.01;
    });

  // The eye: the whole second subpath, start included.
  const tileEye = tile[1] as { start: Point; segments: Segment[] };
  const symbolEye = symbol[1] as { start: Point; segments: Segment[] };
  expect(tileEye.segments.length).toBe(symbolEye.segments.length);
  tileEye.segments.forEach((s, k) =>
    expect(same(s, symbolEye.segments[k] as Segment), `eye segment ${String(k)}`).toBe(true),
  );
  const eyeStart = map(place(tileEye.start));
  expect(Math.abs(eyeStart[0] - symbolEye.start[0]) + Math.abs(eyeStart[1] - symbolEye.start[1])).toBeLessThanOrEqual(
    0.02,
  );

  // The outline: from the beak's start round the crest to the neck, and from the neck under the beak to the
  // throat, the same segments; only the segments between differ, and they are all below the head.
  const a = (tile[0] as { segments: Segment[] }).segments;
  const b = (symbol[0] as { segments: Segment[] }).segments;
  let head = 0;
  while (head < Math.min(a.length, b.length) && same(a[head] as Segment, b[head] as Segment)) head++;
  let tail = 0;
  while (
    tail < Math.min(a.length, b.length) - head &&
    same(a[a.length - 1 - tail] as Segment, b[b.length - 1 - tail] as Segment)
  )
    tail++;
  const neck = b.slice(head, b.length - tail);
  expect(neck.length, 'symbol segments that differ').toBeGreaterThan(0);
  // Below the head: every point of the symbol's differing segments is lower than the eye and the beak, which
  // are in the top 0.45 of the symbol's height.
  const heights = symbol.flatMap((s) => [s.start, ...s.segments.flatMap((g) => g.points)]).map((p) => p[1]);
  const below = 0.45 * Math.max(...heights);
  const start = b[head - 1]?.points.at(-1) ?? [0, 0];
  for (const p of [start, ...neck.flatMap((s) => s.points)]) expect(p[1]).toBeGreaterThan(below);
}

describe('the logos, the app icons and the favicon', () => {
  it.each(LOGOS)('%s draws its letters as paths, in one group per line of letters', (name) => {
    const doc = parse(name);
    expect(doc.getElementsByTagName('text')).toHaveLength(0);
    expect(read(name)).not.toMatch(/font|@import|tspan/i);
    const groups = [...doc.documentElement.children].filter(
      (e) => e.localName === 'g' && !e.hasAttribute('clip-path') && e.getElementsByTagName('path').length > 0,
    );
    expect(groups).toHaveLength(name.startsWith('logo-primary-') ? 2 : 1);
    for (const g of groups) {
      expect([...g.children].every((c) => c.localName === 'path')).toBe(true);
    }
  });

  it.each(APP_ICONS)('%s holds the code sign as three stroked paths with round caps and joins', (name) => {
    const stroked = [...parse(name).getElementsByTagName('path')].filter(isStroked);
    expect(stroked).toHaveLength(3);
    for (const p of stroked) {
      expect(p.getAttribute('stroke-linecap')).toBe('round');
      expect(p.getAttribute('stroke-linejoin')).toBe('round');
    }
  });

  it.each(['favicon.svg', 'symbol.svg', ...LOGOS])('%s holds no stroked path', (name) => {
    expect([...parse(name).getElementsByTagName('path')].filter(isStroked)).toEqual([]);
  });

  it('favicon.svg: one style element, its only at-rule the dark scheme, one colour each for ground and bird', () => {
    const doc = parse('favicon.svg');
    const styles = [...doc.getElementsByTagName('style')];
    expect(styles).toHaveLength(1);
    const css = (styles[0] as Element).textContent ?? '';
    const atRules = [...css.matchAll(/@[^{]*/g)].map((m) => m[0].replace(/\s+/g, ' ').trim());
    expect(atRules).toEqual(['@media (prefers-color-scheme: dark)']);
    const inside = /@media[^{]*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? '';
    const outside = css.slice(0, css.indexOf('@media'));
    const mark = markPaths(doc)[0] as Element;
    const ground = [...doc.documentElement.children].find((e) => e.localName === 'rect') as Element;
    for (const [where, rules] of [
      ['outside', outside],
      ['inside', inside],
    ] as const) {
      for (const [part, element] of [
        ['ground', ground],
        ['bird', mark],
      ] as const) {
        const cls = element.getAttribute('class') ?? '';
        const fills = [...rules.matchAll(new RegExp(`\\.${cls}\\s*\\{[^}]*fill:\\s*([^;}]+)`, 'g'))].map((m) =>
          (m[1] ?? '').trim(),
        );
        expect(fills, `the ${part}'s colour ${where} the dark rule`).toHaveLength(1);
        expect(fills[0]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(ground.getAttribute('fill')).toBeNull();
    expect(mark.getAttribute('fill')).toBeNull();
  });
});

describe('the social image', () => {
  it('social.svg is 1200 x 630 and holds the tile path and the letter paths of logo-primary-light.svg', () => {
    const doc = parse('social.svg');
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 1200 630');
    const ds = (d: Document) => [...d.getElementsByTagName('path')].map((p) => p.getAttribute('d') ?? '');
    const social = new Set(ds(doc));
    expect(social.has(TILE_PATH)).toBe(true);
    const logo = parse('logo-primary-light.svg');
    const letterPaths = [...logo.getElementsByTagName('path')]
      .filter((p) => p.getAttribute('fill-rule') !== 'evenodd' && !isStroked(p))
      .map((p) => p.getAttribute('d') ?? '');
    expect(letterPaths.length).toBeGreaterThan(0);
    expect(letterPaths.filter((d) => !social.has(d))).toEqual([]);
  });
});

describe('the raster files', () => {
  it.each(
    ['teal', 'cream', 'night'].flatMap((g) => [192, 512].map((size) => [`app-icon-${g}-${String(size)}.png`, size])),
  )('%s is %i x %i', (name, size) => {
    expect(imageSize(readFileSync(brandFile(name as string)))).toEqual({ width: size, height: size });
  });

  it('social-1200x630.png is 1200 x 630 and apple-touch-icon.png 180 x 180', () => {
    expect(imageSize(readFileSync(brandFile('social-1200x630.png')))).toEqual({ width: 1200, height: 630 });
    expect(imageSize(readFileSync(brandFile('apple-touch-icon.png')))).toEqual({ width: 180, height: 180 });
  });

  it('favicon.ico holds exactly three entries, 16, 32 and 48 pixels square', () => {
    const ico = readFileSync(brandFile('favicon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const count = ico.readUInt16LE(4);
    expect(count).toBe(3);
    const entries = Array.from({ length: count }, (_, i) => {
      const at = 6 + 16 * i;
      const side = (byte: number) => (byte === 0 ? 256 : byte);
      const header = { width: side(ico.readUInt8(at)), height: side(ico.readUInt8(at + 1)) };
      const image = ico.subarray(ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8));
      return { header, image: imageSize(image) };
    });
    expect(entries.map((e) => e.header)).toEqual([16, 32, 48].map((n) => ({ width: n, height: n })));
    expect(entries.map((e) => e.image)).toEqual([16, 32, 48].map((n) => ({ width: n, height: n })));
  });
});

// --- the script, its font parser, the reference sheet -----------------------------------------------------------

interface PackageJson {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const PACKAGE = JSON.parse(readFileSync(path.join(STUDIO, 'package.json'), 'utf8')) as PackageJson;
const BRAND_SCRIPT = readFileSync(path.join(STUDIO, 'scripts', 'brand.ts'), 'utf8');

/** The packages a source text imports or requires. */
function importsOf(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|createRequire\([^)]*\)\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ].map((m) => m[1] as string);
}

/** The development dependency `scripts/brand.ts` loads that is not Studio's other tooling: the font parser. */
const FONT_PARSER = importsOf(BRAND_SCRIPT).find((source) => source === 'fontkit');

describe('bun run brand and its font parser', () => {
  it('package.json has a brand script, and the font parser is one exact development dependency', () => {
    expect(PACKAGE.scripts.brand).toMatch(/scripts\/brand\.ts/);
    expect(FONT_PARSER).toBe('fontkit');
    expect(PACKAGE.devDependencies[FONT_PARSER as string]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(PACKAGE.dependencies)).not.toContain(FONT_PARSER);
  });

  it('no file under src/ imports the font parser, or anything from brand/ or public/', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const file = path.join(dir, entry);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx|css)$/.test(entry)) files.push(file);
      }
    };
    walk(path.join(STUDIO, 'src'));
    const offending = files.flatMap((file) =>
      importsOf(readFileSync(file, 'utf8'))
        .filter((source) => {
          if (source === FONT_PARSER || source.startsWith(`${FONT_PARSER ?? ''}/`)) return true;
          if (!source.startsWith('.') && !source.startsWith('/')) return false;
          const resolved = path.resolve(path.dirname(file), source);
          return [path.join(STUDIO, 'brand'), path.join(STUDIO, 'public')].some(
            (folder) => resolved === folder || resolved.startsWith(folder + path.sep),
          );
        })
        .map((source) => `${path.relative(STUDIO, file)}: ${source}`),
    );
    expect(offending).toEqual([]);
  });
});

/** The size of a PNG, GIF or JPEG image from its header, or `null` for another file. */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.subarray(0, 3).toString('latin1') === 'GIF') {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 9 < bytes.length;) {
      const marker = bytes[at + 1] as number;
      const length = bytes.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      at += 2 + length;
    }
  }
  return null;
}

describe('the reference sheet', () => {
  it('git tracks nothing under .initial-refs/ and no image of the sheet’s size, 1774 x 887', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPOSITORY, encoding: 'utf8' })
      .split('\0')
      .filter((file) => file !== '');
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.filter((file) => file.startsWith('.initial-refs/'))).toEqual([]);
    const sheetSized = tracked
      .filter((file) => /\.(png|gif|jpe?g)$/i.test(file))
      .filter((file) => {
        const size = imageSize(readFileSync(path.join(REPOSITORY, file)));
        return size !== null && size.width === 1774 && size.height === 887;
      });
    expect(sheetSized).toEqual([]);
  });
});
