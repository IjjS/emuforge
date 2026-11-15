/// <reference lib="dom" />
// Writes EmuForge's brand files (requirement R4, R5): `bun run brand` in `studio/`.
//
// - The vector files, from the geometry of `src/ui/brand-paths.ts`: `brand/symbol.svg`, the four logo files
//   `brand/logo-<primary|compact>-<light|dark>.svg`, the app icons `brand/app-icon-<teal|cream|night>.svg` and
//   `brand/app-icon-teal-square.svg`, `public/favicon.svg`, and the social image `brand/social.svg`, which holds the
//   primary light logo's own path data.
// - The rasters, each its vector drawn at its size: `brand/app-icon-<ground>-<192|512>.png`,
//   `public/apple-touch-icon.png` (180, from the square teal icon), `public/favicon.ico` (16, 32 and 48, the light
//   favicon) and `brand/social-1200x630.png`.
//
// Every colour is the sRGB value of one of Studio's tokens (`src/ui/tokens.css`), as the Chromium of
// `@playwright/test` computes it from the token's OKLCH value; no colour is written here. The letters of the logos
// and of the social image's line are the outlines of Studio's own Instrument Sans
// (`src/ui/fonts/instrument-sans-latin-wght-normal.woff2`) at the weights the requirement names (R4.6), read with
// `fontkit`; no text element and no font is in any file. The
// rasters are drawn by the same Chromium at device pixel ratio 1 (the functions given to `page.evaluate` run in the
// page, hence the DOM types above). Nothing is fetched. The results are committed, so
// a build needs no browser; rerun after a change of the geometry, the tokens or the face.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { chromium, type Page } from '@playwright/test';

import { CODE_SIGN, SYMBOL_PATH, TILE_PATH, TILE_RADIUS, TILE_SIDE, TILE_TRANSFORM } from '../src/ui/brand-paths.ts';

const STUDIO = path.resolve(import.meta.dirname, '..');
const BRAND = path.join(STUDIO, 'brand');
const PUBLIC = path.join(STUDIO, 'public');
const TOKENS = path.join(STUDIO, 'src/ui/tokens.css');
const FACE = path.join(STUDIO, 'src/ui/fonts/instrument-sans-latin-wght-normal.woff2');

// --- the logos' layout, as shares of the tile's side S (R4.4, R4.5, R8.3) ---------------------------------------

/** "EmuForge": weight 650, tracking -0.01em (R4.6); its capitals' height and the gap from the tile. */
const NAME = { text: 'EmuForge', weight: 650, tracking: -0.01, capHeight: 0.364, gap: 0.18 } as const;
/** "STUDIO": weight 600, letter-spaced, its capitals' height; its width is about 0.565 of "EmuForge"'s. */
const LINE = { text: 'STUDIO', weight: 600, capHeight: 0.179, widthShare: 0.565 } as const;
/** The primary logo: the top of "EmuForge"'s capitals, and of "STUDIO"'s, from the tile's top. */
const PRIMARY = { nameTop: 0.154, lineTop: 0.667 } as const;

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

// --- colours ---------------------------------------------------------------------------------------------------

type Scheme = 'light' | 'dark';
type Colours = Record<Scheme, Map<string, string>>;

/** Every `--st-*` colour token of `tokens.css` in both schemes, as `#rrggbb`, painted by Chromium. */
async function tokenColours(page: Page): Promise<Colours> {
  const css = await readFile(TOKENS, 'utf8');
  const names = [...new Set([...css.matchAll(/(--st-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string))];
  const colours = {} as Colours;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setContent('<!doctype html><title>tokens</title>');
    await page.addStyleTag({ content: css });
    const painted = await page.evaluate((names) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const paint = canvas.getContext('2d', { willReadFrequently: true });
      if (!paint) throw new Error('no 2d canvas');
      const root = getComputedStyle(document.documentElement);
      const out: [string, number[]][] = [];
      for (const name of names) {
        const value = root.getPropertyValue(name).trim();
        if (value === '' || !CSS.supports('color', value)) continue;
        paint.clearRect(0, 0, 1, 1);
        paint.fillStyle = '#000';
        paint.fillStyle = value;
        paint.fillRect(0, 0, 1, 1);
        out.push([name, [...paint.getImageData(0, 0, 1, 1).data]]);
      }
      return out;
    }, names);
    const map = new Map<string, string>();
    for (const [name, rgba] of painted) {
      if (rgba[3] !== 255) continue;
      map.set(
        name.slice('--st-'.length),
        `#${rgba
          .slice(0, 3)
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')}`,
      );
    }
    colours[scheme] = map;
  }
  await page.emulateMedia({ colorScheme: 'light' });
  return colours;
}

function token(colours: Colours, scheme: Scheme, name: string): string {
  const value = colours[scheme].get(name);
  if (value === undefined) throw new Error(`tokens.css has no opaque colour --st-${name} in the ${scheme} scheme`);
  return value;
}

// --- letters ---------------------------------------------------------------------------------------------------

// `fontkit` ships no types; these are the parts of it this script reads. It decodes the WOFF2 file (Brotli and the
// transformed `glyf` table) and holds the face's variation data, but does not apply the variations to a WOFF2
// glyph's points, so the script applies them with fontkit's own variation processor (`gvar`, and `HVAR` for the
// advances) to the decoded points. That reads fontkit's private members (`_transformGlyfTable`, `_transformedGlyphs`,
// `_variationProcessor`), which the exact pin in `package.json` holds: move the pin only after rerunning
// `bun run brand` and `studio.brand-logos-hold-their-layout`, which compares the outlines with live Instrument Sans.

interface FontPoint {
  x: number;
  y: number;
  onCurve: boolean;
  endContour: boolean;
  copy(): FontPoint;
}

interface DecodedGlyph {
  numberOfContours: number;
  points?: FontPoint[];
}

interface FontGlyph {
  id: number;
  advanceWidth: number;
}

interface Font {
  unitsPerEm: number;
  capHeight: number;
  variationCoords: number[] | null;
  hmtx: { metrics: { get(id: number): { advance: number; bearing: number } } };
  _transformedGlyphs?: DecodedGlyph[];
  _transformGlyfTable(): void;
  _variationProcessor: { transformPoints(id: number, points: FontPoint[]): void } | null;
  layout(text: string): { glyphs: FontGlyph[]; positions: { xAdvance: number; xOffset: number }[] };
}

interface Fontkit {
  create(buffer: Buffer): Font;
}

const fontkit = createRequire(import.meta.url)('fontkit') as Fontkit;

/** One word's glyphs at a weight: each glyph's outline as TrueType points, in font units, and where it starts. */
interface Word {
  unitsPerEm: number;
  capHeight: number;
  glyphs: { points: FontPoint[]; x: number }[];
}

/**
 * The glyphs of `text` at `weight`, laid out by the face's own advances and kerning at that weight, with `tracking`
 * (in em) added after each glyph as CSS `letter-spacing` does.
 */
function shape(face: Buffer, text: string, weight: number, tracking: number): Word {
  // One instance decodes the glyphs at the default weight; another holds the variation at `weight`.
  const plain = fontkit.create(face);
  plain._transformGlyfTable();
  const varied = fontkit.create(face);
  varied.variationCoords = [weight];
  const processor = varied._variationProcessor;
  const decoded = plain._transformedGlyphs;
  if (!processor || !decoded) throw new Error('the face has no variation data or no glyphs');
  // Decoding the glyphs with the variation set fails in fontkit (a composite glyph's phantom points); the variation
  // instance lays the text out on the glyphs decoded at the default weight, and its points are varied below.
  varied._transformedGlyphs = decoded;
  const run = varied.layout(text);
  const glyphs: Word['glyphs'] = [];
  let pen = 0;
  run.glyphs.forEach((glyph, i) => {
    const source = decoded[glyph.id];
    const position = run.positions[i];
    if (source === undefined || source.numberOfContours === 0) {
      // A glyph with no outline (the space): its advance alone.
      pen += (position?.xAdvance ?? glyph.advanceWidth) + tracking * plain.unitsPerEm;
      return;
    }
    if (!source.points || source.numberOfContours < 0) throw new Error(`glyph ${String(glyph.id)} is not simple`);
    const points = source.points.map((p) => p.copy());
    const first = source.points[0] as FontPoint;
    const xMin = Math.min(...points.map((p) => p.x));
    const { bearing } = plain.hmtx.metrics.get(glyph.id);
    const origin = xMin - bearing;
    const make = first.copy.bind(first);
    const phantom = [make(), make(), make(), make()];
    phantom.forEach((p, k) => {
      p.x = k === 0 ? origin : origin + glyph.advanceWidth;
      p.y = 0;
      p.onCurve = false;
      p.endContour = true;
    });
    processor.transformPoints(glyph.id, [...points, ...phantom]);
    const shift = (phantom[0] as FontPoint).x;
    glyphs.push({
      points: points.map((p) => ({ ...p, x: p.x - shift })) as FontPoint[],
      x: pen + (position?.xOffset ?? 0),
    });
    pen += (position?.xAdvance ?? glyph.advanceWidth) + tracking * plain.unitsPerEm;
  });
  return { unitsPerEm: plain.unitsPerEm, capHeight: plain.capHeight, glyphs };
}

/** The ink box of a word in font units. */
function inkOf(word: Word): { left: number; right: number } {
  const xs = word.glyphs.flatMap((g) => g.points.map((p) => p.x + g.x));
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

const n = (value: number) => String(Math.round(value * 100) / 100);

/** A glyph's TrueType contours as SVG path data, placed by `at` (font units to the file's). */
function glyphPath(points: FontPoint[], at: (x: number, y: number) => [number, number]): string {
  const contours: FontPoint[][] = [];
  let current: FontPoint[] = [];
  for (const p of points) {
    current.push(p);
    if (p.endContour) {
      contours.push(current);
      current = [];
    }
  }
  const out: string[] = [];
  const xy = (x: number, y: number) => at(x, y).map(n).join(' ');
  for (const contour of contours) {
    if (contour.length === 0) continue;
    // Start on a point on the curve; when every point is off it, at the middle of the first two.
    type Ring = { x: number; y: number; on: boolean }[];
    let ring: Ring = contour.map((p) => ({ x: p.x, y: p.y, on: p.onCurve }));
    const startIndex = ring.findIndex((p) => p.on);
    if (startIndex >= 0) {
      ring = [...ring.slice(startIndex), ...ring.slice(0, startIndex)];
    } else {
      const a = ring[0] as Ring[number];
      const b = ring[1] ?? a;
      ring = [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true }, ...ring.slice(1), a];
    }
    const start = ring[0] as Ring[number];
    out.push(`M ${xy(start.x, start.y)}`);
    let control: Ring[number] | null = null;
    for (const p of [...ring.slice(1), start]) {
      if (p.on) {
        out.push(control ? `Q ${xy(control.x, control.y)} ${xy(p.x, p.y)}` : `L ${xy(p.x, p.y)}`);
        control = null;
      } else if (control) {
        out.push(`Q ${xy(control.x, control.y)} ${xy((control.x + p.x) / 2, (control.y + p.y) / 2)}`);
        control = p;
      } else {
        control = p;
      }
    }
    out.push('Z');
  }
  return out.join(' ');
}

/**
 * A word as one group of paths, one path per glyph: its capitals `capHeight` tall (in the file's units), the left of
 * its ink at `left` and the top of its capitals at `top`.
 */
function letters(word: Word, fill: string, options: { capHeight: number; left: number; top: number }): string {
  const scale = options.capHeight / word.capHeight;
  const ink = inkOf(word);
  const baseline = options.top + options.capHeight;
  const paths = word.glyphs.map(
    (g) =>
      `<path d="${glyphPath(g.points, (x, y) => [options.left + (g.x + x - ink.left) * scale, baseline - y * scale])}"/>`,
  );
  return `<g fill="${fill}">${paths.join('')}</g>`;
}

/** The width of a word's ink in the file's units at a capital height. */
function inkWidth(word: Word, capHeight: number): number {
  const ink = inkOf(word);
  return ((ink.right - ink.left) * capHeight) / word.capHeight;
}

// --- the marks -------------------------------------------------------------------------------------------------

function svg(viewBox: string, title: string, body: string): string {
  return `<svg ${XMLNS} viewBox="${viewBox}"><title>${title}</title>${body}</svg>\n`;
}

/** The tile at the file's origin, side 100: the square, the line of its edge, the symbol, the code sign. */
function tile(options: {
  id: string;
  ground: string;
  symbol: string;
  edge?: string;
  code?: boolean;
  /** Class names instead of fills, for the favicon's own style rules. */
  classes?: { ground: string; symbol: string };
}): string {
  const fill = (colour: string, cls: string | undefined) => (cls ? `class="${cls}"` : `fill="${colour}"`);
  const square = `width="${String(TILE_SIDE)}" height="${String(TILE_SIDE)}" rx="${String(TILE_RADIUS)}"`;
  const parts = [
    `<defs><clipPath id="${options.id}"><rect ${square}/></clipPath></defs>`,
    `<rect ${fill(options.ground, options.classes?.ground)} ${square}/>`,
  ];
  if (options.edge) {
    // A line 1/512 of the side wide, inside the square, under the symbol (R4's table: the cream icon's edge).
    const w = TILE_SIDE / 512;
    parts.push(
      `<rect fill="none" stroke="${options.edge}" stroke-width="${String(w)}" x="${String(w / 2)}" y="${String(w / 2)}" ` +
        `width="${String(TILE_SIDE - w)}" height="${String(TILE_SIDE - w)}" rx="${String(TILE_RADIUS - w / 2)}"/>`,
    );
  }
  parts.push(
    `<g clip-path="url(#${options.id})"><path ${fill(options.symbol, options.classes?.symbol)} fill-rule="evenodd" ` +
      `transform="${TILE_TRANSFORM}" d="${TILE_PATH}"/></g>`,
  );
  if (options.code) {
    parts.push(
      ...CODE_SIGN.paths.map(
        (d) =>
          `<path fill="none" stroke="${options.symbol}" stroke-width="${String(CODE_SIGN.strokeWidth)}" ` +
          `stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`,
      ),
    );
  }
  return parts.join('');
}

/** The symbol alone, in `accent`, on no ground (R4's table). Its viewBox is its path's box. */
function symbolFile(colours: Colours): string {
  return svg(
    '0 0 167 140',
    'EmuForge symbol',
    `<path fill="${token(colours, 'light', 'accent')}" fill-rule="evenodd" d="${SYMBOL_PATH}"/>`,
  );
}

/** The favicon: the tile without the code sign, light by default and dark by the scheme's rule (R7.2). */
function faviconFile(colours: Colours): string {
  const rules = (scheme: Scheme) =>
    `.ground{fill:${token(colours, scheme, 'accent')}}.symbol{fill:${token(colours, scheme, 'accent-ink')}}`;
  return svg(
    '0 0 100 100',
    'EmuForge Studio favicon',
    `<style>${rules('light')}@media (prefers-color-scheme: dark){${rules('dark')}}</style>` +
      tile({ id: 'tile', ground: '', symbol: '', classes: { ground: 'ground', symbol: 'symbol' } }),
  );
}

type Ground = 'teal' | 'cream' | 'night';

/** An app icon on its ground (R4.7, R4's table); `square` draws the teal one on a full square. */
function appIconFile(colours: Colours, ground: Ground, square = false): string {
  const colour = {
    teal: { ground: token(colours, 'light', 'accent'), symbol: token(colours, 'light', 'accent-ink') },
    cream: {
      ground: token(colours, 'light', 'bg'),
      symbol: token(colours, 'light', 'accent'),
      edge: token(colours, 'light', 'line'),
    },
    night: { ground: token(colours, 'dark', 'accent-ink'), symbol: token(colours, 'dark', 'accent') },
  }[ground];
  if (square) {
    // The same tile on a square without corners, the source of `apple-touch-icon.png`: the device rounds it.
    const body =
      `<rect fill="${colour.ground}" width="${String(TILE_SIDE)}" height="${String(TILE_SIDE)}"/>` +
      tile({ id: 'tile', ...colour, code: true });
    return svg('0 0 100 100', 'EmuForge Studio app icon, teal, square', body);
  }
  // At 512 units across, so the cream icon's edge is one pixel at 512.
  const body = `<g transform="scale(5.12)">${tile({ id: 'tile', ...colour, code: true })}</g>`;
  return svg('0 0 512 512', `EmuForge Studio app icon, ${ground}`, body);
}

type Logo = 'primary' | 'compact';

/**
 * A logo's contents for a light or a dark ground (R4.4, R4.5, R4's table): the tile at the origin with side 100, then
 * the letters, nothing else; and the width they take.
 */
function logoBody(
  colours: Colours,
  words: { name: Word; line: Word },
  logo: Logo,
  scheme: Scheme,
): { body: string; width: number } {
  const S = TILE_SIDE;
  const left = S + NAME.gap * S;
  const nameCap = NAME.capHeight * S;
  const nameTop = logo === 'compact' ? (S - nameCap) / 2 : PRIMARY.nameTop * S;
  const width = left + inkWidth(words.name, nameCap);
  const parts = [
    tile({
      id: 'tile',
      ground: token(colours, scheme, 'accent'),
      symbol: token(colours, scheme, 'accent-ink'),
    }),
    letters(words.name, token(colours, scheme, 'text'), { capHeight: nameCap, left, top: nameTop }),
  ];
  if (logo === 'primary') {
    parts.push(
      letters(words.line, token(colours, scheme, 'accent'), {
        capHeight: LINE.capHeight * S,
        left,
        top: PRIMARY.lineTop * S,
      }),
    );
  }
  return { body: parts.join(''), width: Math.ceil(width * 100) / 100 };
}

/** A logo file: the logo's contents, its viewBox their box (R4.4, R4.5). */
function logoFile(colours: Colours, words: { name: Word; line: Word }, logo: Logo, scheme: Scheme): string {
  const { body, width } = logoBody(colours, words, logo, scheme);
  const title = logo === 'primary' ? 'EmuForge Studio' : 'EmuForge';
  return svg(`0 0 ${n(width)} ${String(TILE_SIDE)}`, `${title} logo, for a ${scheme} ground`, body);
}

// --- the social image ------------------------------------------------------------------------------------------

/**
 * The social image's layout on 1200 x 630 (R4.8, R8.6), in pixels. The left half: the primary light logo, and under
 * it the line in two rows whose ink starts at the tile's left edge. The right half: three stacked windows. Two bands
 * rise from the lower left to the right edge behind everything but the ground.
 */
const SOCIAL = {
  width: 1200,
  height: 630,
  logo: { x: 80, y: 136, scale: 1.3 },
  /** The line (not a brand commitment; Owner decisions, Q2), its rows, their capitals' height and their tops. */
  line: { rows: ['Your free, local', 'cloud workspace'], weight: 500, capHeight: 30, tops: [326, 384] },
  farBand: 'M 0 590 C 380 585 760 470 1200 260 L 1200 630 L 0 630 Z',
  nearBand: 'M 220 630 C 520 610 850 540 1200 410 L 1200 630 Z',
  back: { x: 650, y: 80, w: 360, h: 240, r: 14, bar: 44, dots: { x: 678, gap: 22, r: 7 } },
  middle: { x: 730, y: 180, w: 330, h: 250, r: 14, edge: 3, tile: { x: 772, y: 245, scale: 1.2 } },
  card: { x: 920, y: 300, w: 230, h: 260, r: 14, edge: 3, rows: [350, 430, 510], disc: { x: 962, r: 18 } },
} as const;

/** The social image (R4.8, R8.6): every colour one token's, light; the logo is `logo-primary-light.svg`'s body. */
function socialFile(colours: Colours, words: { name: Word; line: Word }, line: Word[]): string {
  const c = (name: string, scheme: Scheme = 'light') => token(colours, scheme, name);
  const { logo, back, middle, card } = SOCIAL;
  const rect = (x: number, y: number, w: number, h: number, r: number, paint: string) =>
    `<rect ${paint} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"/>`;
  const parts: string[] = [
    `<rect fill="${c('bg')}" width="${String(SOCIAL.width)}" height="${String(SOCIAL.height)}"/>`,
    `<path fill="${c('accent-wash')}" d="${SOCIAL.farBand}"/>`,
    `<path fill="${c('accent', 'dark')}" d="${SOCIAL.nearBand}"/>`,
    `<g transform="translate(${n(logo.x)} ${n(logo.y)}) scale(${n(logo.scale)})">` +
      logoBody(colours, words, 'primary', 'light').body +
      '</g>',
    ...line.map((row, i) =>
      letters(row, c('text'), {
        capHeight: SOCIAL.line.capHeight,
        left: logo.x,
        top: SOCIAL.line.tops[i] as number,
      }),
    ),
  ];

  // The back window: an accent-wash body, an accent title bar with its top corners rounded, three accent-ink dots.
  const barBottom = back.y + back.bar;
  const k = back.r * 0.45;
  const titleBar =
    `M ${n(back.x)} ${n(barBottom)} L ${n(back.x)} ${n(back.y + back.r)} ` +
    `C ${n(back.x)} ${n(back.y + back.r - k)} ${n(back.x + back.r - k)} ${n(back.y)} ${n(back.x + back.r)} ${n(back.y)} ` +
    `L ${n(back.x + back.w - back.r)} ${n(back.y)} ` +
    `C ${n(back.x + back.w - back.r + k)} ${n(back.y)} ${n(back.x + back.w)} ${n(back.y + back.r - k)} ` +
    `${n(back.x + back.w)} ${n(back.y + back.r)} L ${n(back.x + back.w)} ${n(barBottom)} Z`;
  const dots = [0, 1, 2].map(
    (i) =>
      `<circle fill="${c('accent-ink')}" cx="${n(back.dots.x + i * back.dots.gap)}" cy="${n(back.y + back.bar / 2)}" r="${n(back.dots.r)}"/>`,
  );
  parts.push(
    `<g>${rect(back.x, back.y, back.w, back.h, back.r, `fill="${c('accent-wash')}"`)}` +
      `<path fill="${c('accent')}" d="${titleBar}"/>${dots.join('')}</g>`,
  );

  // The middle window: a surface body with an accent edge, holding the tile with the code sign.
  const tileAt = middle.tile;
  parts.push(
    `<g>${rect(middle.x, middle.y, middle.w, middle.h, middle.r, `fill="${c('surface')}" stroke="${c('accent')}" stroke-width="${n(middle.edge)}"`)}` +
      `<g transform="translate(${n(tileAt.x)} ${n(tileAt.y)}) scale(${n(tileAt.scale)})">` +
      tile({ id: 'window-tile', ground: c('accent'), symbol: c('accent-ink'), code: true }) +
      '</g></g>',
  );

  // The checklist card: a surface body with a line-strong edge; three rows of an accent disc with an accent-ink tick
  // and an accent-wash bar.
  const rows = card.rows.map((y) => {
    const { x, r } = card.disc;
    const tick = `M ${n(x - 8)} ${n(y + 0.5)} L ${n(x - 2.5)} ${n(y + 6)} L ${n(x + 8.5)} ${n(y - 6)}`;
    const barLeft = x + r + 16;
    return (
      `<circle fill="${c('accent')}" cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>` +
      `<path fill="none" stroke="${c('accent-ink')}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" d="${tick}"/>` +
      rect(barLeft, y - 8, card.x + card.w - 26 - barLeft, 16, 8, `fill="${c('accent-wash')}"`)
    );
  });
  parts.push(
    `<g>${rect(card.x, card.y, card.w, card.h, card.r, `fill="${c('surface')}" stroke="${c('line-strong')}" stroke-width="${n(card.edge)}"`)}` +
      `${rows.join('')}</g>`,
  );

  return svg(`0 0 ${String(SOCIAL.width)} ${String(SOCIAL.height)}`, 'EmuForge Studio social image', parts.join(''));
}

/** "STUDIO" tracked so that its ink is `LINE.widthShare` of "EmuForge"'s. */
function lineWord(face: Buffer, name: Word): Word {
  const target = inkWidth(name, NAME.capHeight) * LINE.widthShare;
  const plain = shape(face, LINE.text, LINE.weight, 0);
  const gaps = LINE.text.length - 1;
  // Tracking adds `tracking * unitsPerEm` font units after each glyph; in the file at cap height `LINE.capHeight`.
  const perEm = (plain.unitsPerEm * LINE.capHeight) / plain.capHeight;
  const tracking = (target - inkWidth(plain, LINE.capHeight)) / gaps / perEm;
  return shape(face, LINE.text, LINE.weight, tracking);
}

// --- rasters ---------------------------------------------------------------------------------------------------

/** `file` drawn as an image at `width` x `height` on a transparent canvas, as PNG bytes. */
async function rasterise(page: Page, file: string, width: number, height: number): Promise<Buffer> {
  const source = `data:image/svg+xml;base64,${Buffer.from(file, 'utf8').toString('base64')}`;
  const encoded = await page.evaluate(
    async ({ source, width, height }) => {
      const img = new Image();
      img.src = source;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const paint = canvas.getContext('2d');
      if (!paint) throw new Error('no 2d canvas');
      paint.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    },
    { source, width, height },
  );
  return Buffer.from(encoded, 'base64');
}

/** An ICO file holding each PNG as one entry, square, 32 bits. */
function ico(entries: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size % 256, at);
    header.writeUInt8(size % 256, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

// --- main ------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const face = await readFile(FACE);
  const name = shape(face, NAME.text, NAME.weight, NAME.tracking);
  const words = { name, line: lineWord(face, name) };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'light' });
    const page = await context.newPage();
    const colours = await tokenColours(page);
    await page.setContent('<!doctype html><title>brand</title>');

    const vectors: Record<string, string> = {
      'brand/symbol.svg': symbolFile(colours),
      'public/favicon.svg': faviconFile(colours),
      'brand/app-icon-teal.svg': appIconFile(colours, 'teal'),
      'brand/app-icon-cream.svg': appIconFile(colours, 'cream'),
      'brand/app-icon-night.svg': appIconFile(colours, 'night'),
      'brand/app-icon-teal-square.svg': appIconFile(colours, 'teal', true),
    };
    for (const logo of ['primary', 'compact'] as const) {
      for (const scheme of ['light', 'dark'] as const) {
        vectors[`brand/logo-${logo}-${scheme}.svg`] = logoFile(colours, words, logo, scheme);
      }
    }
    const line = SOCIAL.line.rows.map((row) => shape(face, row, SOCIAL.line.weight, 0));
    vectors['brand/social.svg'] = socialFile(colours, words, line);

    const rasters: Record<string, Buffer> = {};
    for (const ground of ['teal', 'cream', 'night'] as const) {
      for (const size of [192, 512]) {
        rasters[`brand/app-icon-${ground}-${String(size)}.png`] = await rasterise(
          page,
          vectors[`brand/app-icon-${ground}.svg`] as string,
          size,
          size,
        );
      }
    }
    rasters['public/apple-touch-icon.png'] = await rasterise(
      page,
      vectors['brand/app-icon-teal-square.svg'] as string,
      180,
      180,
    );
    // The favicon's light form: the page's scheme is light, so its dark rule does not apply.
    const favicon = vectors['public/favicon.svg'] as string;
    const entries = [];
    for (const size of [16, 32, 48]) entries.push({ size, png: await rasterise(page, favicon, size, size) });
    rasters['public/favicon.ico'] = ico(entries);
    rasters['brand/social-1200x630.png'] = await rasterise(
      page,
      vectors['brand/social.svg'] as string,
      SOCIAL.width,
      SOCIAL.height,
    );

    await mkdir(BRAND, { recursive: true });
    await mkdir(PUBLIC, { recursive: true });
    for (const [file, content] of [...Object.entries(vectors), ...Object.entries(rasters)]) {
      await writeFile(path.join(STUDIO, file), content);
      console.log(`wrote ${file}`);
    }
  } finally {
    await browser.close();
  }
}

await main();
