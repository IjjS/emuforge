// Drawing a brand file and measuring what it paints (issue 36, test-criteria.md, "Words used below"). A file is read
// from the checkout and opened by the check's own Chromium as an image on a canvas filled with the stated ground, at
// device pixel ratio 1, and the canvas's pixels are read back. Every measure here works on those pixels: of the
// file's markup only the root's `viewBox` is read, to know how large to draw it.
//
// - "Ink": a pixel nearer the mark's colour than the ground's. "The ink box": the ink's bounding box.
// - A hole: a region of pixels that are not ink, enclosed by ink. Pixels count as joined across corners, ink and
//   not ink alike, so a gap that is open by a diagonal step is not a hole.
// - A tile is drawn at the scale where its side `S` is a given number of pixels. Its square is found in the drawing:
//   the first run of painted columns from the left, as tall as its painted rows.
// - "A token's colour": what this Chromium paints for the token's value in `studio/src/ui/tokens.css`, read at run
//   time in the light or the dark scheme; no colour is copied here.

import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import type { Ctx } from './check';

export type Rgb = readonly [number, number, number];

/** A ground that is none of Studio's colours, against which every painted pixel stands out. */
export const MAGENTA: Rgb = [255, 0, 255];
export const WHITE: Rgb = [255, 255, 255];

/** The three files Studio serves at a fixed path are in `studio/public/`; every other brand file in `studio/brand/`. */
const PUBLIC = new Set(['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']);

/** Where a brand file of R5.1's table is in the checkout. */
export function brandPath(ctx: Ctx, name: string): string {
  return path.join(ctx.studioDir, PUBLIC.has(name) ? 'public' : 'brand', name);
}

/** The text of a brand file, or `null` when it does not exist. */
export function readBrandFile(ctx: Ctx, name: string): string | null {
  const file = brandPath(ctx, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The root `svg` element's `viewBox`, or `null` when it has none. */
export function viewBoxOf(svg: string): ViewBox | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  const value = root ? /\sviewBox\s*=\s*["']([^"']*)["']/.exec(root)?.[1] : undefined;
  if (value === undefined) return null;
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = numbers as [number, number, number, number];
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

// --- colours ---------------------------------------------------------------------------------------------------

export type Scheme = 'light' | 'dark';

/**
 * Every `--st-*` token of `tokens.css` whose value is an opaque colour, by name without `--st-`, as this Chromium
 * paints it in `scheme`: the stylesheet is applied to a blank page of its own with the scheme emulated, each
 * token's computed value is painted on a canvas and the pixel is read back as sRGB.
 */
export async function tokenColours(page: Page, ctx: Ctx, scheme: Scheme): Promise<Map<string, Rgb>> {
  const css = fs.readFileSync(path.join(ctx.studioDir, 'src', 'ui', 'tokens.css'), 'utf8');
  const names = [...new Set([...css.matchAll(/(--st-[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string))];
  const blank = await page.context().newPage();
  try {
    await blank.emulateMedia({ colorScheme: scheme });
    await blank.setContent('<!doctype html><title>tokens</title>');
    await blank.addStyleTag({ content: css });
    const painted = await blank.evaluate((names) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const paint = canvas.getContext('2d', { willReadFrequently: true })!;
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
    const colours = new Map<string, Rgb>();
    for (const [name, [r, g, b, a]] of painted) {
      if (a === 255) colours.set(name.slice('--st-'.length), [r ?? 0, g ?? 0, b ?? 0]);
    }
    return colours;
  } finally {
    await blank.close();
  }
}

/** The largest channel difference between two colours. */
export function channelDiff(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function distance2(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** The index of the colour of `palette` nearest to `p`. */
function nearest(p: Rgb, palette: readonly Rgb[]): number {
  let best = 0;
  for (let i = 1; i < palette.length; i++) {
    if (distance2(p, palette[i] as Rgb) < distance2(p, palette[best] as Rgb)) best = i;
  }
  return best;
}

/**
 * How far `p` is from every blend of `ground` and `ink` (an edge pixel drawn over the ground is such a blend): the
 * largest channel difference from the nearest point of the segment between the two colours.
 */
export function offBlend(p: Rgb, ground: Rgb, ink: Rgb): number {
  const d = [ink[0] - ground[0], ink[1] - ground[1], ink[2] - ground[2]] as const;
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = len2 === 0 ? 0 : ((p[0] - ground[0]) * d[0] + (p[1] - ground[1]) * d[1] + (p[2] - ground[2]) * d[2]) / len2;
  const s = Math.min(1, Math.max(0, t));
  return channelDiff(p, [ground[0] + s * d[0], ground[1] + s * d[1], ground[2] + s * d[2]]);
}

// --- drawing ---------------------------------------------------------------------------------------------------

/** The pixels of a canvas, RGBA, row by row. */
export interface Drawing {
  width: number;
  height: number;
  data: Uint8Array;
}

export function pixel(d: Drawing, x: number, y: number): Rgb {
  const i = (y * d.width + x) * 4;
  return [d.data[i] ?? 0, d.data[i + 1] ?? 0, d.data[i + 2] ?? 0];
}

export function alpha(d: Drawing, x: number, y: number): number {
  return d.data[(y * d.width + x) * 4 + 3] ?? 0;
}

interface DrawSpec {
  /** The canvas's size in pixels. */
  width: number;
  height: number;
  ground: Rgb;
  /** Where the file's whole `viewBox` is drawn on the canvas, in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Mirror the drawing left to right (the ground is the same). */
  mirror?: boolean;
}

/** Opens `svg` as an image and draws it on a canvas of `spec.ground`; the canvas's pixels are read back. */
export async function draw(page: Page, svg: string, spec: DrawSpec): Promise<Drawing> {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const encoded = await page.evaluate(
    async ({ source, spec }) => {
      const img = new Image();
      img.src = source;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = spec.width;
      canvas.height = spec.height;
      const paint = canvas.getContext('2d', { willReadFrequently: true })!;
      paint.fillStyle = `rgb(${spec.ground.join(' ')})`;
      paint.fillRect(0, 0, spec.width, spec.height);
      if (spec.mirror) {
        paint.translate(spec.width, 0);
        paint.scale(-1, 1);
      }
      paint.drawImage(img, spec.x, spec.y, spec.w, spec.h);
      const bytes = paint.getImageData(0, 0, spec.width, spec.height).data;
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(text);
    },
    { source, spec },
  );
  return {
    width: spec.width,
    height: spec.height,
    data: new Uint8Array(Buffer.from(encoded, 'base64')),
  };
}

// --- regions ---------------------------------------------------------------------------------------------------

/** A box of pixels: `right` and `bottom` are exclusive. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A mask over a drawing: 1 where the pixel belongs. */
export interface Mask {
  width: number;
  height: number;
  bits: Uint8Array;
}

function maskOf(d: Drawing, test: (p: Rgb, x: number, y: number) => boolean): Mask {
  const bits = new Uint8Array(d.width * d.height);
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) bits[y * d.width + x] = test(pixel(d, x, y), x, y) ? 1 : 0;
  }
  return { width: d.width, height: d.height, bits };
}

/** The pixels nearer `ink` than `ground`. */
export function inkMask(d: Drawing, ink: Rgb, ground: Rgb): Mask {
  return maskOf(d, (p) => distance2(p, ink) < distance2(p, ground));
}

/** The bounding box of a mask's pixels inside `within`, or `null` when it has none. */
export function boxOf(m: Mask, within?: Box): Box | null {
  const w = within ?? { left: 0, top: 0, right: m.width, bottom: m.height };
  let box: Box | null = null;
  for (let y = w.top; y < w.bottom; y++) {
    for (let x = w.left; x < w.right; x++) {
      if (!m.bits[y * m.width + x]) continue;
      if (!box) box = { left: x, top: y, right: x + 1, bottom: y + 1 };
      else {
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        box.right = Math.max(box.right, x + 1);
        box.bottom = Math.max(box.bottom, y + 1);
      }
    }
  }
  return box;
}

export function count(m: Mask, within?: Box): number {
  const w = within ?? { left: 0, top: 0, right: m.width, bottom: m.height };
  let n = 0;
  for (let y = w.top; y < w.bottom; y++) for (let x = w.left; x < w.right; x++) n += m.bits[y * m.width + x] ?? 0;
  return n;
}

export interface Region {
  size: number;
  box: Box;
  /** The region's own pixels. */
  mask: Mask;
  /** Whether it reaches the edge of the area it was found in. */
  touchesEdge: boolean;
}

/** The connected regions (joined across corners) of the mask's pixels inside `within`, largest first. */
export function regions(m: Mask, within?: Box): Region[] {
  const w = within ?? { left: 0, top: 0, right: m.width, bottom: m.height };
  const seen = new Uint8Array(m.width * m.height);
  const found: Region[] = [];
  const stack: number[] = [];
  for (let y0 = w.top; y0 < w.bottom; y0++) {
    for (let x0 = w.left; x0 < w.right; x0++) {
      const start = y0 * m.width + x0;
      if (!m.bits[start] || seen[start]) continue;
      const own = new Uint8Array(m.width * m.height);
      const box: Box = { left: x0, top: y0, right: x0 + 1, bottom: y0 + 1 };
      let size = 0;
      let touchesEdge = false;
      seen[start] = 1;
      stack.push(start);
      while (stack.length > 0) {
        const i = stack.pop() as number;
        const x = i % m.width;
        const y = (i - x) / m.width;
        own[i] = 1;
        size++;
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        box.right = Math.max(box.right, x + 1);
        box.bottom = Math.max(box.bottom, y + 1);
        if (x === w.left || y === w.top || x === w.right - 1 || y === w.bottom - 1) touchesEdge = true;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < w.left || ny < w.top || nx >= w.right || ny >= w.bottom) continue;
            const j = ny * m.width + nx;
            if (m.bits[j] && !seen[j]) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
      found.push({
        size,
        box,
        mask: { width: m.width, height: m.height, bits: own },
        touchesEdge,
      });
    }
  }
  return found.sort((a, b) => b.size - a.size);
}

function invert(m: Mask): Mask {
  return {
    width: m.width,
    height: m.height,
    bits: m.bits.map((b) => (b ? 0 : 1)),
  };
}

/** The holes of `ink` inside `within`: regions of other pixels that do not reach the edge of `within`. */
export function holes(ink: Mask, within?: Box): Region[] {
  return regions(invert(ink), within).filter((r) => !r.touchesEdge);
}

/** The pixels of `m` whose eight neighbours are all in `m` too: a region without its anti-aliased rim. */
export function core(m: Mask): Mask {
  const bits = new Uint8Array(m.width * m.height);
  for (let y = 1; y < m.height - 1; y++) {
    for (let x = 1; x < m.width - 1; x++) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1 && all; dx++) if (!m.bits[(y + dy) * m.width + x + dx]) all = false;
      }
      bits[y * m.width + x] = all ? 1 : 0;
    }
  }
  return { width: m.width, height: m.height, bits };
}

/** The pixels of `m` whose colour differs from `colour` by more than `tolerance` in a channel. */
export function offColour(d: Drawing, m: Mask, colour: Rgb, tolerance = 1): number {
  let n = 0;
  for (let i = 0; i < m.bits.length; i++) {
    if (!m.bits[i]) continue;
    if (channelDiff(pixel(d, i % d.width, Math.floor(i / d.width)), colour) > tolerance) n++;
  }
  return n;
}

/** A box as shares of `of`, from its top left: left and right of its width, top and bottom of its height. */
export function shares(box: Box, of: Box): { left: number; top: number; right: number; bottom: number } {
  const w = of.right - of.left;
  const h = of.bottom - of.top;
  return {
    left: (box.left - of.left) / w,
    top: (box.top - of.top) / h,
    right: (box.right - of.left) / w,
    bottom: (box.bottom - of.top) / h,
  };
}

// --- the symbol ------------------------------------------------------------------------------------------------

/** The margin of ground around a drawing, in pixels. */
const MARGIN = 8;

/**
 * Draws `symbol.svg` on `ground` at the scale where its ink box is `inkWidth` pixels wide: drawn once to find the
 * ink box in the file's units, then again at that scale with a margin of ground on every side.
 */
export async function drawSymbol(
  page: Page,
  svg: string,
  options: { inkWidth: number; ink: Rgb; ground: Rgb; mirror?: boolean },
): Promise<Drawing> {
  const vb = viewBoxOf(svg);
  if (!vb) throw new Error('symbol.svg has no viewBox to draw it by');
  const probe = 1000 / vb.width;
  const first = await draw(page, svg, {
    width: Math.ceil(vb.width * probe) + 2 * MARGIN,
    height: Math.ceil(vb.height * probe) + 2 * MARGIN,
    ground: options.ground,
    x: MARGIN,
    y: MARGIN,
    w: vb.width * probe,
    h: vb.height * probe,
  });
  const box = boxOf(inkMask(first, options.ink, options.ground));
  if (!box) throw new Error('symbol.svg paints no ink in its colour');
  const scale = (options.inkWidth / (box.right - box.left)) * probe;
  return draw(page, svg, {
    width: Math.ceil(vb.width * scale) + 2 * MARGIN,
    height: Math.ceil(vb.height * scale) + 2 * MARGIN,
    ground: options.ground,
    x: MARGIN,
    y: MARGIN,
    w: vb.width * scale,
    h: vb.height * scale,
    ...(options.mirror ? { mirror: true } : {}),
  });
}

export interface SymbolMeasure {
  /** The ink box in pixels. */
  box: Box;
  /** Width : height of the ink box. */
  ratio: number;
  /** Ink pixels over the ink box's area. */
  inkShare: number;
  /** The holes of the ink: each box as shares of the ink box, each area as a share of the ink. */
  holes: {
    box: ReturnType<typeof shares>;
    areaShare: number;
    region: Region;
  }[];
  /** The middle of the rightmost ink column's ink, as a share of the box's height from its top. */
  beakTip: number;
  /** The ink fraction of each cell of the ink box divided into 8 x 8 equal cells, row by row. */
  grid: number[][];
  ink: Mask;
}

/** Measures a drawing of the symbol (R8.1, how the numbers were taken). */
export function measureSymbol(d: Drawing, ink: Rgb, ground: Rgb): SymbolMeasure {
  const mask = inkMask(d, ink, ground);
  const box = boxOf(mask);
  if (!box) throw new Error('the drawing holds no ink');
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const inkCount = count(mask);
  const right = box.right - 1;
  let first = -1;
  let last = -1;
  for (let y = box.top; y < box.bottom; y++) {
    if (mask.bits[y * mask.width + right]) {
      if (first < 0) first = y;
      last = y;
    }
  }
  return {
    box,
    ratio: w / h,
    inkShare: inkCount / (w * h),
    holes: holes(mask).map((r) => ({
      box: shares(r.box, box),
      areaShare: r.size / inkCount,
      region: r,
    })),
    beakTip: ((first + last + 1) / 2 - box.top) / h,
    grid: coverageGrid(mask, box),
    ink: mask,
  };
}

/** The ink fraction of each of `n` x `n` equal cells of `box`, row by row. */
export function coverageGrid(m: Mask, box: Box, n = 8): number[][] {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const grid: number[][] = [];
  for (let row = 0; row < n; row++) {
    const cells: number[] = [];
    const top = box.top + Math.floor((row * h) / n);
    const bottom = box.top + Math.floor(((row + 1) * h) / n);
    for (let col = 0; col < n; col++) {
      const left = box.left + Math.floor((col * w) / n);
      const right = box.left + Math.floor(((col + 1) * w) / n);
      cells.push(count(m, { left, top, right, bottom }) / ((right - left) * (bottom - top)));
    }
    grid.push(cells);
  }
  return grid;
}

/** The mean and the largest absolute difference between two grids' cells. */
export function compareGrids(a: number[][], b: number[][]): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  let cells = 0;
  for (let row = 0; row < a.length; row++) {
    for (let col = 0; col < (a[row]?.length ?? 0); col++) {
      const diff = Math.abs((a[row]?.[col] ?? 0) - (b[row]?.[col] ?? 0));
      sum += diff;
      max = Math.max(max, diff);
      cells++;
    }
  }
  return { mean: sum / cells, max };
}

// --- the tile --------------------------------------------------------------------------------------------------

/** The colours a tile is classified by: its square's ground and its symbol's colour. */
export interface TileColours {
  ground: Rgb;
  symbol: Rgb;
}

export interface TileDrawing {
  drawing: Drawing;
  /** The tile's square in the drawing: `side` x `side` pixels. */
  tile: Box;
  side: number;
  /** The square as found in the file's first drawing, in the file's units, before it was drawn at `side`. */
  found: { x: number; y: number; width: number; height: number };
}

/** The margin of the page's ground around a tile drawing, in pixels. */
const TILE_MARGIN = 4;

/**
 * Draws the tile of `svg` (the whole file for an icon, the tile at the left of a logo) on `ground` at the scale
 * where its side is `side` pixels. A first drawing finds the square: the first run of painted columns from the left
 * (a pixel is painted where it is nearer the tile's colours than the ground), as tall as those columns' painted rows;
 * an edge within a pixel and a half of the `viewBox`'s edge is taken to be on it. The second drawing places the
 * square's top left at a whole pixel and holds the square and a margin of ground around it.
 */
export async function drawTile(
  page: Page,
  svg: string,
  colours: TileColours,
  options: { side: number; ground?: Rgb },
): Promise<TileDrawing> {
  const ground = options.ground ?? MAGENTA;
  const vb = viewBoxOf(svg);
  if (!vb) throw new Error('the file has no viewBox to draw it by');
  const probe = 1200 / Math.max(vb.width, vb.height);
  const first = await draw(page, svg, {
    width: Math.ceil(vb.width * probe) + 2 * TILE_MARGIN,
    height: Math.ceil(vb.height * probe) + 2 * TILE_MARGIN,
    ground,
    x: TILE_MARGIN,
    y: TILE_MARGIN,
    w: vb.width * probe,
    h: vb.height * probe,
  });
  const palette = [ground, colours.ground, colours.symbol];
  const painted = maskOf(first, (p) => nearest(p, palette) !== 0);
  const columns: boolean[] = [];
  for (let x = 0; x < first.width; x++) {
    let any = false;
    for (let y = 0; y < first.height && !any; y++) any = painted.bits[y * first.width + x] === 1;
    columns.push(any);
  }
  const left = columns.indexOf(true);
  if (left < 0) throw new Error('the file paints nothing');
  let right = left;
  while (right < columns.length && columns[right]) right++;
  const run = boxOf(painted, { left, top: 0, right, bottom: first.height });
  if (!run) throw new Error('the file paints nothing');
  // From pixels of the first drawing to the file's units, an edge near the viewBox's taken to be on it.
  const snap = (px: number, low: number, high: number) => {
    const units = (px - TILE_MARGIN) / probe;
    if (Math.abs(units - low) * probe <= 1.5) return low;
    if (Math.abs(units - high) * probe <= 1.5) return high;
    return units;
  };
  const x0 = snap(run.left, 0, vb.width);
  const y0 = snap(run.top, 0, vb.height);
  const y1 = snap(run.bottom, 0, vb.height);
  const x1 = snap(run.right, 0, vb.width);
  const height = y1 - y0;
  const scale = options.side / height;
  const drawing = await draw(page, svg, {
    width: options.side + 2 * TILE_MARGIN,
    height: options.side + 2 * TILE_MARGIN,
    ground,
    x: TILE_MARGIN - x0 * scale,
    y: TILE_MARGIN - y0 * scale,
    w: vb.width * scale,
    h: vb.height * scale,
  });
  const tile = {
    left: TILE_MARGIN,
    top: TILE_MARGIN,
    right: TILE_MARGIN + options.side,
    bottom: TILE_MARGIN + options.side,
  };
  return {
    drawing,
    tile,
    side: options.side,
    found: { x: x0 + vb.x, y: y0 + vb.y, width: x1 - x0, height },
  };
}

export interface TileMeasure {
  /** The square's corner radius as a share of `S`, from the ground showing in its four corners. */
  radius: number;
  /** The top of the symbol's ink, as a share of `S` from the square's top. */
  crestTop: number;
  /** The right edge of the symbol's ink (the beak's tip), as a share of `S` from the square's left. */
  beakTip: number;
  /** Pixels of the symbol's ink in the square's outermost row or column on each side. */
  onEdge: { top: number; left: number; right: number; bottom: number };
  /** The holes of the symbol's ink inside the square, and how many of each one's inner pixels are not `ground`. */
  holes: { box: ReturnType<typeof shares>; size: number; offGround: number }[];
  /** The pieces of ink in the symbol's colour other than the symbol (the largest), as shares of `S`. */
  others: { box: ReturnType<typeof shares>; size: number }[];
  /** The symbol's ink: the largest piece of ink in the symbol's colour. */
  symbol: Mask;
  /** Every pixel of the square nearer the symbol's colour than the square's ground and the page's ground. */
  ink: Mask;
}

/** Measures a tile drawing: each pixel of the square is the page's ground, the square's ground or the symbol's. */
export function measureTile(t: TileDrawing, colours: TileColours, pageGround: Rgb = MAGENTA): TileMeasure {
  const d = t.drawing;
  const palette = [pageGround, colours.ground, colours.symbol];
  const inTile = (x: number, y: number) => x >= t.tile.left && x < t.tile.right && y >= t.tile.top && y < t.tile.bottom;
  const outside = maskOf(d, (p, x, y) => inTile(x, y) && nearest(p, palette) === 0);
  const ink = maskOf(d, (p, x, y) => inTile(x, y) && nearest(p, palette) === 2);
  const pieces = regions(ink, t.tile);
  const symbol = pieces[0]?.mask ?? {
    width: d.width,
    height: d.height,
    bits: new Uint8Array(d.width * d.height),
  };
  const S = t.side;
  // The page's ground in each corner square of 0.35 S: a quarter circle of radius r leaves r²(1 - π/4) outside it.
  const c = Math.round(0.35 * S);
  const corners = [
    {
      left: t.tile.left,
      top: t.tile.top,
      right: t.tile.left + c,
      bottom: t.tile.top + c,
    },
    {
      left: t.tile.right - c,
      top: t.tile.top,
      right: t.tile.right,
      bottom: t.tile.top + c,
    },
    {
      left: t.tile.left,
      top: t.tile.bottom - c,
      right: t.tile.left + c,
      bottom: t.tile.bottom,
    },
    {
      left: t.tile.right - c,
      top: t.tile.bottom - c,
      right: t.tile.right,
      bottom: t.tile.bottom,
    },
  ];
  const outsideMean = corners.reduce((sum, box) => sum + count(outside, box), 0) / 4;
  const symbolBox = boxOf(symbol, t.tile);
  const row = (y: number): Box => ({
    left: t.tile.left,
    top: y,
    right: t.tile.right,
    bottom: y + 1,
  });
  const col = (x: number): Box => ({
    left: x,
    top: t.tile.top,
    right: x + 1,
    bottom: t.tile.bottom,
  });
  return {
    radius: Math.sqrt(outsideMean / (1 - Math.PI / 4)) / S,
    crestTop: symbolBox ? (symbolBox.top - t.tile.top) / S : NaN,
    beakTip: symbolBox ? (symbolBox.right - t.tile.left) / S : NaN,
    onEdge: {
      top: count(symbol, row(t.tile.top)),
      left: count(symbol, col(t.tile.left)),
      right: count(symbol, col(t.tile.right - 1)),
      bottom: count(symbol, row(t.tile.bottom - 1)),
    },
    holes: holes(symbol, t.tile).map((h) => ({
      box: shares(h.box, t.tile),
      size: h.size,
      offGround: offColour(d, core(h.mask), colours.ground),
    })),
    others: pieces.slice(1).map((p) => ({ box: shares(p.box, t.tile), size: p.size })),
    symbol,
    ink,
  };
}

/** A box given as shares of `S` placed on the tile's square, in pixels. */
export function onTile(t: TileDrawing, s: { left: number; top: number; right: number; bottom: number }): Box {
  return {
    left: t.tile.left + Math.round(s.left * t.side),
    top: t.tile.top + Math.round(s.top * t.side),
    right: t.tile.left + Math.round(s.right * t.side),
    bottom: t.tile.top + Math.round(s.bottom * t.side),
  };
}

/** The pixels of `box` whose colour differs from `colour` by more than `tolerance` in a channel. */
export function offColourIn(d: Drawing, box: Box, colour: Rgb, tolerance = 1): number {
  let n = 0;
  for (let y = box.top; y < box.bottom; y++) {
    for (let x = box.left; x < box.right; x++) if (channelDiff(pixel(d, x, y), colour) > tolerance) n++;
  }
  return n;
}

/** The pixels in the corner triangles of the square (`x + y` below `share` of `S` from each corner) not `colour`. */
export function cornersOff(t: TileDrawing, colour: Rgb, share: number): number {
  const limit = share * t.side;
  let n = 0;
  for (let j = 0; j < t.side; j++) {
    for (let i = 0; i < t.side; i++) {
      // Steps to the nearest corner along the two edges.
      if (Math.min(i, t.side - 1 - i) + Math.min(j, t.side - 1 - j) >= limit) continue;
      if (channelDiff(pixel(t.drawing, t.tile.left + i, t.tile.top + j), colour) > 1) n++;
    }
  }
  return n;
}

/**
 * The square's edge as a line of `line` one pixel wide, sampled at every pixel from 0.3 to 0.7 of `S` along each
 * side: the square's outermost pixel is `line`, the pixel inward of it is not, and the pixel outward of it is the
 * page's ground. A place where the symbol's ink meets the edge (the neck at the bottom) is not sampled. Returns the
 * samples that do not hold, per side.
 */
export function edgeLineOff(
  t: TileDrawing,
  colours: TileColours & { line: Rgb },
  pageGround: Rgb = MAGENTA,
): Record<'top' | 'left' | 'right' | 'bottom', string[]> {
  const d = t.drawing;
  const { left, top, right, bottom } = t.tile;
  const sides = {
    top: (k: number) => ({ x: k, y: top, ix: 0, iy: 1 }),
    bottom: (k: number) => ({ x: k, y: bottom - 1, ix: 0, iy: -1 }),
    left: (k: number) => ({ x: left, y: k, ix: 1, iy: 0 }),
    right: (k: number) => ({ x: right - 1, y: k, ix: -1, iy: 0 }),
  };
  const off: Record<'top' | 'left' | 'right' | 'bottom', string[]> = {
    top: [],
    left: [],
    right: [],
    bottom: [],
  };
  for (const [name, at] of Object.entries(sides) as [
    keyof typeof sides,
    (k: number) => { x: number; y: number; ix: number; iy: number },
  ][]) {
    const start = name === 'top' || name === 'bottom' ? left : top;
    for (let k = start + Math.round(0.3 * t.side); k < start + Math.round(0.7 * t.side); k++) {
      const { x, y, ix, iy } = at(k);
      const outer = pixel(d, x, y);
      const inward = pixel(d, x + ix, y + iy);
      const outward = pixel(d, x - ix, y - iy);
      if (distance2(inward, colours.symbol) < distance2(inward, colours.ground)) continue;
      const fine =
        channelDiff(outer, colours.line) <= 1 &&
        channelDiff(inward, colours.line) > 1 &&
        channelDiff(outward, pageGround) <= 1;
      if (!fine) off[name].push(`(${x},${y}) ${outer.join(' ')} in ${inward.join(' ')} out ${outward.join(' ')}`);
    }
  }
  return off;
}
