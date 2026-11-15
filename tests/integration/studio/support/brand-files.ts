// Reading and drawing the brand files the logos, the social image, the colours and the rasters checks need (issue 36,
// test-criteria.md, "Words used below"). It builds on `brand.ts`, which draws a file as an image and measures its
// pixels; this file adds:
//
// - the raster files' own pixels: a PNG and the entries of an `.ico`, decoded here from their bytes, so what is
//   compared is what the file holds and not what a browser makes of it;
// - a vector file drawn on a transparent canvas at a raster's size, and the per-channel difference of two drawings;
// - a logo drawn at the scale where its tile's side `S` is a given number of pixels, and the ink of its letters;
// - live text in Studio's own Instrument Sans fitted over a drawn logo's letters;
// - a vector file placed in a page as markup, to read every colour it gives and each shape's place and computed paint,
//   and to draw it with and without Instrument Sans available.
//
// Colours are compared as this Chromium computes and paints them (`brand.ts`, `tokenColours`); no colour is copied
// here.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import type { Page } from '@playwright/test';

import {
  boxOf,
  brandPath,
  channelDiff,
  draw,
  drawTile,
  MAGENTA,
  offBlend,
  pixel,
  viewBoxOf,
  type Box,
  type Drawing,
  type Mask,
  type Rgb,
  type Scheme,
  type TileColours,
} from './brand';
import type { Ctx } from './check';

/** The bytes of a brand file, or `null` when it does not exist. */
export function readBrandBytes(ctx: Ctx, name: string): Buffer | null {
  const file = brandPath(ctx, name);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

/** Studio's own Instrument Sans for Latin text, the file its stylesheet serves (`studio/src/ui/fonts.css`). */
export function instrumentSans(ctx: Ctx): Buffer {
  return fs.readFileSync(path.join(ctx.studioDir, 'src', 'ui', 'fonts', 'instrument-sans-latin-wght-normal.woff2'));
}

// --- PNG and ICO -----------------------------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** The pixel size a PNG's `IHDR` states. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  if (!isPng(bytes) || bytes.toString('latin1', 12, 16) !== 'IHDR') throw new Error('not a PNG: no signature and IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * The pixels of a PNG, RGBA not premultiplied, row by row: 8 bits per sample, grey, grey with alpha, RGB, RGBA or a
 * palette (with `tRNS`), not interlaced. Any other form is an error that names it.
 */
export function decodePng(bytes: Buffer): Drawing {
  const { width, height } = pngSize(bytes);
  let bitDepth = 0;
  let colourType = -1;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const data: Buffer[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IHDR') {
      bitDepth = body[8] ?? 0;
      colourType = body[9] ?? -1;
      interlace = body[12] ?? 0;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colourType];
  if (bitDepth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(`PNG of bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace} is not read here`);
  }
  if (colourType === 3 && !palette) throw new Error('PNG with a palette colour type and no PLTE');
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is shorter than its size says');
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (line[i - channels] ?? 0) : 0;
      const b = previous[i] ?? 0;
      const c = i >= channels ? (previous[i - channels] ?? 0) : 0;
      const x = source[i] ?? 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (predicted === undefined) throw new Error(`PNG row ${y} has filter ${filter}`);
      line[i] = (x + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      let rgba: [number, number, number, number];
      if (colourType === 6) rgba = [line[s]!, line[s + 1]!, line[s + 2]!, line[s + 3]!];
      else if (colourType === 2) rgba = [line[s]!, line[s + 1]!, line[s + 2]!, 255];
      else if (colourType === 4) rgba = [line[s]!, line[s]!, line[s]!, line[s + 1]!];
      else if (colourType === 0) rgba = [line[s]!, line[s]!, line[s]!, 255];
      else {
        const k = line[s]!;
        const p = palette as Buffer;
        rgba = [p[3 * k] ?? 0, p[3 * k + 1] ?? 0, p[3 * k + 2] ?? 0, transparency?.[k] ?? 255];
      }
      out.set(rgba, o);
    }
    [previous, line] = [line, previous];
  }
  return { width, height, data: out };
}

/** One image of an `.ico`. */
export interface IcoEntry {
  /** The size the directory states (0 there means 256). */
  width: number;
  height: number;
  format: 'png' | 'bmp';
  image: Drawing;
}

/** A device-independent bitmap of an `.ico` entry: 32 bits BGRA, or 24 bits BGR with the AND mask for alpha. */
function decodeDib(bytes: Buffer, width: number, height: number): Drawing {
  const headerSize = bytes.readUInt32LE(0);
  const bitCount = bytes.readUInt16LE(14);
  const compression = bytes.readUInt32LE(16);
  if (compression !== 0 || (bitCount !== 32 && bitCount !== 24)) {
    throw new Error(`ICO bitmap of ${bitCount} bits, compression ${compression} is not read here`);
  }
  const stride = Math.ceil((width * bitCount) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const pixels = headerSize;
  const mask = pixels + stride * height;
  const out = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let row = 0; row < height; row++) {
    const y = height - 1 - row;
    for (let x = 0; x < width; x++) {
      const s = pixels + row * stride + (x * bitCount) / 8;
      const o = (y * width + x) * 4;
      out[o] = bytes[s + 2] ?? 0;
      out[o + 1] = bytes[s + 1] ?? 0;
      out[o + 2] = bytes[s] ?? 0;
      out[o + 3] = bitCount === 32 ? (bytes[s + 3] ?? 0) : 255;
      if (bitCount === 32 && out[o + 3] !== 0) anyAlpha = true;
    }
  }
  if (bitCount === 24 || !anyAlpha) {
    for (let row = 0; row < height; row++) {
      const y = height - 1 - row;
      for (let x = 0; x < width; x++) {
        const bit = ((bytes[mask + row * maskStride + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        out[(y * width + x) * 4 + 3] = bit ? 0 : 255;
      }
    }
  }
  return { width, height, data: out };
}

/** The entries of an `.ico`, each decoded from its own bytes (a PNG, or a bitmap). */
export function decodeIco(bytes: Buffer): IcoEntry[] {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO: the header is not reserved 0, type 1');
  }
  const entries: IcoEntry[] = [];
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const at = 6 + 16 * i;
    const width = bytes[at] || 256;
    const height = bytes[at + 1] || 256;
    const size = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    const body = bytes.subarray(offset, offset + size);
    entries.push(
      isPng(body)
        ? { width, height, format: 'png', image: decodePng(body) }
        : { width, height, format: 'bmp', image: decodeDib(body, width, height) },
    );
  }
  return entries;
}

export function alphaAt(d: Drawing, x: number, y: number): number {
  return d.data[(y * d.width + x) * 4 + 3] ?? 0;
}

// --- drawing on a transparent canvas ---------------------------------------------------------------------------

/** Opens `svg` as an image and draws its whole `viewBox` over a transparent canvas of `width` x `height`. */
export async function drawClear(page: Page, svg: string, width: number, height: number): Promise<Drawing> {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const encoded = await page.evaluate(
    async ({ source, width, height }) => {
      const img = new Image();
      img.src = source;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const paint = canvas.getContext('2d', { willReadFrequently: true })!;
      paint.drawImage(img, 0, 0, width, height);
      const bytes = paint.getImageData(0, 0, width, height).data;
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    },
    { source, width, height },
  );
  return { width, height, data: new Uint8Array(Buffer.from(encoded, 'base64')) };
}

/**
 * The mean absolute difference of two drawings of one size, per channel, the colour channels taken premultiplied by
 * the pixel's alpha (a wholly transparent pixel is the same whatever colour it carries); `max` is the largest of the
 * four means.
 */
export function meanDifference(a: Drawing, b: Drawing): { r: number; g: number; b: number; a: number; max: number } {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`drawings of ${a.width} x ${a.height} and ${b.width} x ${b.height} cannot be compared`);
  }
  const sums = [0, 0, 0, 0];
  for (let i = 0; i < a.data.length; i += 4) {
    const aa = a.data[i + 3] ?? 0;
    const ba = b.data[i + 3] ?? 0;
    for (let c = 0; c < 3; c++) {
      sums[c]! += Math.abs(((a.data[i + c] ?? 0) * aa) / 255 - ((b.data[i + c] ?? 0) * ba) / 255);
    }
    sums[3]! += Math.abs(aa - ba);
  }
  const n = a.width * a.height;
  const [r, g, bl, al] = sums.map((s) => s / n) as [number, number, number, number];
  return { r, g, b: bl, a: al, max: Math.max(r, g, bl, al) };
}

// --- a logo at S -----------------------------------------------------------------------------------------------

export interface LogoDrawing {
  drawing: Drawing;
  /** The tile's square in the drawing: `side` x `side` pixels, its top left on a whole pixel. */
  tile: Box;
  side: number;
  /** Where the file's whole `viewBox` is drawn on the canvas, in pixels. */
  place: { x: number; y: number; w: number; h: number };
  ground: Rgb;
}

/** The margin of ground around a logo drawing, in pixels. */
const LOGO_MARGIN = 8;

/**
 * Draws a whole logo file on `ground` at the scale where its tile's side is `side` pixels. The tile's square is found
 * as `brand.ts` finds it (`drawTile`: the first run of painted columns from the left); the drawing places the square's
 * top left on a whole pixel and holds the whole `viewBox` with a margin of ground around it.
 */
export async function drawLogo(
  page: Page,
  svg: string,
  colours: TileColours,
  options: { side: number; ground?: Rgb },
): Promise<LogoDrawing> {
  const ground = options.ground ?? MAGENTA;
  const vb = viewBoxOf(svg);
  if (!vb) throw new Error('the file has no viewBox to draw it by');
  const { found } = await drawTile(page, svg, colours, { side: options.side, ground });
  const scale = options.side / found.height;
  const left = LOGO_MARGIN + Math.ceil((found.x - vb.x) * scale);
  const top = LOGO_MARGIN + Math.ceil((found.y - vb.y) * scale);
  const place = {
    x: left - (found.x - vb.x) * scale,
    y: top - (found.y - vb.y) * scale,
    w: vb.width * scale,
    h: vb.height * scale,
  };
  const width = Math.ceil(place.x + place.w) + LOGO_MARGIN;
  const height = Math.ceil(place.y + place.h) + LOGO_MARGIN;
  const drawing = await draw(page, svg, { width, height, ground, ...place });
  return {
    drawing,
    tile: { left, top, right: left + options.side, bottom: top + options.side },
    side: options.side,
    place,
    ground,
  };
}

export interface Letters {
  /** Each word's ink, in the order of `wordColours`: pixels outside the tile nearest that word's colour. */
  words: Mask[];
  /** The first column right of the tile that holds anything painted. */
  left: number;
  /** Painted pixels outside the tile that are not letters: left of the letters, or not a blend of the ground with a word's colour. */
  stray: { count: number; first: string[] };
  /** The runs of rows that hold letter ink, top to bottom, as `[top, bottom)`. */
  rows: [number, number][];
}

/**
 * The letters of a logo drawing. Outside the tile's square (and the one pixel around it, its edge's blend), a pixel
 * is painted when it differs from the ground by more than 1 in a channel; a painted pixel is a letter's when it is a
 * blend of the ground and one word's colour within 2, and is that word's ink when it is nearer that colour than the
 * ground and the other word's.
 */
export function lettersOf(logo: LogoDrawing, wordColours: Rgb[]): Letters {
  const d = logo.drawing;
  const t = logo.tile;
  const nearTile = (x: number, y: number) => x >= t.left - 1 && x <= t.right && y >= t.top - 1 && y <= t.bottom;
  const words = wordColours.map(() => ({ width: d.width, height: d.height, bits: new Uint8Array(d.width * d.height) }));
  const palette = [logo.ground, ...wordColours];
  let left = d.width;
  const painted: [number, number, boolean][] = [];
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (nearTile(x, y)) continue;
      const p = pixel(d, x, y);
      if (channelDiff(p, logo.ground) <= 1) continue;
      const letter = wordColours.some((c) => offBlend(p, logo.ground, c) <= 2);
      painted.push([x, y, letter]);
      if (x > t.right) left = Math.min(left, x);
      let best = 0;
      for (let k = 1; k < palette.length; k++) {
        const c = palette[k] as Rgb;
        const b = palette[best] as Rgb;
        if (
          (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 <
          (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2
        )
          best = k;
      }
      if (best > 0) words[best - 1]!.bits[y * d.width + x] = 1;
    }
  }
  const stray = { count: 0, first: [] as string[] };
  for (const [x, y, letter] of painted) {
    if (letter && x >= left) continue;
    stray.count++;
    if (stray.first.length < 5) stray.first.push(`(${x},${y}) ${pixel(d, x, y).join(' ')}`);
  }
  const rows: [number, number][] = [];
  for (let y = 0; y < d.height; y++) {
    let any = false;
    for (let x = 0; x < d.width && !any; x++) any = words.some((w) => w.bits[y * d.width + x] === 1);
    const last = rows[rows.length - 1];
    if (any && last && last[1] === y) last[1] = y + 1;
    else if (any) rows.push([y, y + 1]);
  }
  return { words, left, stray, rows };
}

/** The union of masks' bounding boxes, or `null` when none has a pixel. */
export function inkBox(...masks: Mask[]): Box | null {
  let box: Box | null = null;
  for (const m of masks) {
    const b = boxOf(m);
    if (!b) continue;
    box = box
      ? {
          left: Math.min(box.left, b.left),
          top: Math.min(box.top, b.top),
          right: Math.max(box.right, b.right),
          bottom: Math.max(box.bottom, b.bottom),
        }
      : b;
  }
  return box;
}

// --- live text over a logo's letters ---------------------------------------------------------------------------

/** One word of a logo to draw as live text over its letters. */
export interface LiveWord {
  text: string;
  colour: Rgb;
  weight: number;
  /** The letter spacing in em, or `null` when it is fitted (the logos' "STUDIO" is spaced by an amount not stated). */
  tracking: number | null;
  /** The word's ink in the logo drawing. */
  ink: Mask;
  /** A capital of the word with a flat top and a flat foot ("E", "T"): its ink box in the logo drawing. */
  capital: { letter: string; box: Box };
}

export interface LiveFit {
  text: string;
  /** The word's ink pixels in the logo, and the pixels whose ink differs between the logo and the live text. */
  ink: number;
  differ: number;
  size: number;
  spacing: number;
  x: number;
  baseline: number;
}

/**
 * Draws each word as live text in Studio's Instrument Sans, at its weight and tracking, over the logo's letters, at the
 * size and place where it fits them best, and counts the pixels where the two inks differ. The size starts where the
 * live capital's height is the logo's, the baseline at the capital's foot and the left at the word's ink's left; then
 * the size, the place and (where it is not stated) the spacing are moved in shrinking steps while the count falls. A
 * pixel is ink when it is nearer the word's colour than the ground and the other words' colours, outside the tile.
 */
export async function fitLiveText(
  page: Page,
  ctx: Ctx,
  logo: LogoDrawing,
  svg: string,
  words: LiveWord[],
): Promise<LiveFit[]> {
  const face = instrumentSans(ctx).toString('base64');
  const source = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const spec = { width: logo.drawing.width, height: logo.drawing.height, ...logo.place };
  const plain = words.map((w) => ({
    text: w.text,
    colour: [...w.colour],
    weight: w.weight,
    tracking: w.tracking,
    box: inkBox(w.ink),
    capital: w.capital,
  }));
  return page.evaluate(
    async ({ face, source, spec, ground, tile, words }) => {
      const family = 'EmuForge check Instrument Sans';
      const bytes = Uint8Array.from(atob(face), (c) => c.charCodeAt(0));
      const font = new FontFace(family, bytes, { weight: '400 700' });
      await font.load();
      document.fonts.add(font);

      const img = new Image();
      img.src = source;
      await img.decode();
      const logo = document.createElement('canvas');
      logo.width = spec.width;
      logo.height = spec.height;
      const lp = logo.getContext('2d', { willReadFrequently: true })!;
      lp.fillStyle = `rgb(${ground.join(' ')})`;
      lp.fillRect(0, 0, spec.width, spec.height);
      lp.drawImage(img, spec.x, spec.y, spec.w, spec.h);

      const palette = [ground, ...words.map((w) => w.colour)];
      const nearest = (r: number, g: number, b: number) => {
        let best = 0;
        let bestD = Infinity;
        palette.forEach((c, k) => {
          const d = (r - c[0]!) ** 2 + (g - c[1]!) ** 2 + (b - c[2]!) ** 2;
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        });
        return best;
      };
      const nearTile = (x: number, y: number) =>
        x >= tile.left - 1 && x <= tile.right && y >= tile.top - 1 && y <= tile.bottom;

      const results = [];
      for (const [k, w] of words.entries()) {
        if (!w.box) throw new Error(`the logo holds no ink of "${w.text}"`);
        const pad = Math.ceil((w.capital.box.bottom - w.capital.box.top) * 0.25) + 4;
        const region = {
          left: Math.max(0, w.box.left - pad),
          top: Math.max(0, w.box.top - pad),
          right: Math.min(spec.width, w.box.right + pad),
          bottom: Math.min(spec.height, w.box.bottom + pad),
        };
        const rw = region.right - region.left;
        const rh = region.bottom - region.top;
        const target = lp.getImageData(region.left, region.top, rw, rh).data;
        const want = new Uint8Array(rw * rh);
        let ink = 0;
        for (let i = 0; i < rw * rh; i++) {
          const x = region.left + (i % rw);
          const y = region.top + Math.floor(i / rw);
          if (nearTile(x, y)) continue;
          if (nearest(target[4 * i]!, target[4 * i + 1]!, target[4 * i + 2]!) === k + 1) {
            want[i] = 1;
            ink++;
          }
        }
        const live = document.createElement('canvas');
        live.width = rw;
        live.height = rh;
        const p = live.getContext('2d', { willReadFrequently: true })!;
        const fontOf = (size: number) => `${w.weight} ${size}px "${family}"`;
        const render = (size: number, spacing: number, x: number, baseline: number) => {
          p.fillStyle = `rgb(${ground.join(' ')})`;
          p.fillRect(0, 0, rw, rh);
          p.font = fontOf(size);
          p.letterSpacing = `${spacing}px`;
          p.fontKerning = 'normal';
          p.fillStyle = `rgb(${w.colour.join(' ')})`;
          p.fillText(w.text, x - region.left, baseline - region.top);
          const data = p.getImageData(0, 0, rw, rh).data;
          let differ = 0;
          for (let i = 0; i < rw * rh; i++) {
            const x0 = region.left + (i % rw);
            const y0 = region.top + Math.floor(i / rw);
            if (nearTile(x0, y0)) continue;
            const on = nearest(data[4 * i]!, data[4 * i + 1]!, data[4 * i + 2]!) === k + 1 ? 1 : 0;
            if (on !== want[i]) differ++;
          }
          return differ;
        };

        // The start: the capital's height and foot, the word's ink's left and (when fitted) its width.
        p.font = fontOf(100);
        p.letterSpacing = '0px';
        const capital = p.measureText(w.capital.letter);
        const size0 = ((w.capital.box.bottom - w.capital.box.top) / capital.actualBoundingBoxAscent) * 100;
        p.font = fontOf(size0);
        const tracked = (size: number, fitted: number) => (w.tracking === null ? fitted : w.tracking * size);
        let spacing0 = tracked(size0, 0);
        if (w.tracking === null) {
          p.letterSpacing = '0px';
          const m = p.measureText(w.text);
          spacing0 =
            (w.box.right - w.box.left - (m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) / (w.text.length - 1);
        }
        p.letterSpacing = `${spacing0}px`;
        const m0 = p.measureText(w.text);
        const state = {
          size: size0,
          fitted: spacing0,
          x: w.box.left + m0.actualBoundingBoxLeft,
          baseline: w.capital.box.bottom,
        };
        const score = (s: typeof state) => render(s.size, tracked(s.size, s.fitted), s.x, s.baseline);
        let best = score(state);
        const steps: Record<keyof typeof state, number> = { size: size0 * 0.01, fitted: 1, x: 1, baseline: 1 };
        const keys = (Object.keys(steps) as (keyof typeof state)[]).filter(
          (key) => key !== 'fitted' || w.tracking === null,
        );
        for (let round = 0; round < 12; round++) {
          let moved = true;
          for (let pass = 0; pass < 8 && moved; pass++) {
            moved = false;
            for (const key of keys) {
              for (const sign of [1, -1]) {
                const next = { ...state, [key]: state[key] + sign * steps[key] };
                const value = score(next);
                if (value < best) {
                  best = value;
                  Object.assign(state, next);
                  moved = true;
                }
              }
            }
          }
          for (const key of keys) steps[key] /= 2;
        }
        results.push({
          text: w.text,
          ink,
          differ: best,
          size: state.size,
          spacing: tracked(state.size, state.fitted),
          x: state.x,
          baseline: state.baseline,
        });
      }
      return results;
    },
    { face, source, spec, ground: [...logo.ground], tile: logo.tile, words: plain },
  );
}

// --- a vector file as markup -----------------------------------------------------------------------------------

/** The tags that hold no painted shape of their own: what is inside them is drawn only where something refers to it. */
const UNPAINTED = 'clipPath, mask, defs, symbol, marker, pattern';
/** The properties that give a colour in SVG. */
const COLOUR_PROPERTIES = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'];

/** A shape the file paints, as this Chromium computes it with the file placed in a page. */
export interface Shape {
  /** Paint order among the file's shapes, from 0. */
  order: number;
  /** `path[3]#bird.g` style: the tag, its index among the file's elements, its id and classes. */
  where: string;
  tag: string;
  /** The `d` of a path, as written. */
  d: string | null;
  /** The shape's geometry's box in the file's units (its transforms counted; a clip and a stroke not). */
  box: Box;
  /** The computed `fill` and `stroke`: a colour, `none`, or a paint server's `url(…)`. */
  fill: string;
  stroke: string;
  /** The ids of the `g` elements it is inside, outermost first. */
  groups: number[];
}

/** A colour the file gives: an attribute, a `style` attribute's property, or a declaration of a `style` element. */
export interface GivenColour {
  where: string;
  property: string;
  value: string;
}

export interface Markup {
  shapes: Shape[];
  given: GivenColour[];
}

/**
 * Places `svg` in a page of its own in `scheme` (parsed as XML, then adopted into the page, one file unit per CSS
 * pixel) and reads every colour it gives and every shape it paints: shapes inside `clipPath`, `mask`, `defs`,
 * `symbol`, `marker` or `pattern` are not painted by themselves and are left out.
 */
export async function readMarkup(page: Page, svg: string, scheme: Scheme): Promise<Markup> {
  const blank = await page.context().newPage();
  try {
    await blank.emulateMedia({ colorScheme: scheme });
    await blank.setContent('<!doctype html><title>markup</title><body style="margin:0">');
    return await blank.evaluate(
      ({ svg, unpainted, properties }) => {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const error = doc.querySelector('parsererror');
        if (error) throw new Error(`the file does not parse as XML: ${error.textContent ?? ''}`);
        const root = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
        const vb = root.viewBox.baseVal;
        root.setAttribute('width', String(vb.width));
        root.setAttribute('height', String(vb.height));
        root.style.display = 'block';
        document.body.append(root);
        const frame = root.getBoundingClientRect();
        const kx = vb.width / frame.width;
        const ky = vb.height / frame.height;

        const all = [root, ...root.querySelectorAll('*')];
        const describe = (el: Element) => {
          const id = el.getAttribute('id');
          const cls = el.getAttribute('class');
          return `${el.tagName}[${all.indexOf(el)}]${id ? `#${id}` : ''}${cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''}`;
        };
        const given: { where: string; property: string; value: string }[] = [];
        const walk = (rules: CSSRuleList, where: string) => {
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
              for (const property of properties) {
                const value = rule.style.getPropertyValue(property).trim();
                if (value) given.push({ where: `${where} rule "${rule.selectorText}"`, property, value });
              }
            }
            if ('cssRules' in rule && rule.cssRules instanceof CSSRuleList) {
              const condition = 'conditionText' in rule ? ` @media ${String(rule.conditionText)}` : '';
              walk(rule.cssRules, `${where}${condition}`);
            }
          }
        };
        for (const el of all) {
          for (const property of properties) {
            const attribute = el.getAttribute(property);
            if (attribute !== null) given.push({ where: describe(el), property, value: attribute.trim() });
            const styled = (el as SVGElement).style?.getPropertyValue(property).trim();
            if (styled) given.push({ where: `${describe(el)} style`, property, value: styled });
          }
          if (el.tagName === 'style') {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(el.textContent ?? '');
            walk(sheet.cssRules, describe(el));
          }
        }

        const groups = all.filter((el) => el.tagName === 'g');
        const shapes = all
          .filter((el) => el instanceof SVGGeometryElement && !el.closest(unpainted))
          .map((el, order) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            const inside: number[] = [];
            for (let p: Element | null = el.parentElement; p && p !== root; p = p.parentElement) {
              if (p.tagName === 'g') inside.unshift(groups.indexOf(p));
            }
            return {
              order,
              where: describe(el),
              tag: el.tagName,
              d: el.getAttribute('d'),
              box: {
                left: (r.left - frame.left) * kx + vb.x,
                top: (r.top - frame.top) * ky + vb.y,
                right: (r.right - frame.left) * kx + vb.x,
                bottom: (r.bottom - frame.top) * ky + vb.y,
              },
              fill: style.fill,
              stroke: style.stroke,
              groups: inside,
            };
          });
        return { shapes, given };
      },
      { svg, unpainted: UNPAINTED, properties: COLOUR_PROPERTIES },
    );
  } finally {
    await blank.close();
  }
}

/**
 * The colour each value paints, as this Chromium paints it over a transparent pixel, RGBA; `null` for a value that is
 * not a colour (`none`, `url(…)`, a keyword such as `currentColor` that the computed paint resolves instead).
 */
export async function paintedColours(page: Page, values: string[]): Promise<Map<string, readonly number[] | null>> {
  const unique = [...new Set(values)];
  const painted = await page.evaluate((values) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true })!;
    return values.map((value) => {
      if (!CSS.supports('color', value) || /^(currentcolor|inherit|initial|unset|revert)$/i.test(value)) return null;
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = '#000';
      paint.fillStyle = value;
      paint.fillRect(0, 0, 1, 1);
      return [...paint.getImageData(0, 0, 1, 1).data];
    });
  }, unique);
  return new Map(unique.map((value, i) => [value, painted[i] ?? null]));
}

// --- a vector file drawn as markup, with and without Instrument Sans ---------------------------------------------

/**
 * Places `svg` in a page of its own at `width` x `height` CSS pixels over a magenta page and takes the page's pixels
 * there. With `face`, the page first holds Studio's Instrument Sans under its own name; `instrumentSans` says whether
 * text set in "Instrument Sans" is drawn in it on that page (measured: its width differs from the fallback's).
 */
export async function drawAsMarkup(
  page: Page,
  svg: string,
  size: { width: number; height: number },
  face: Buffer | null,
): Promise<{ drawing: Drawing; instrumentSans: boolean }> {
  const blank = await page.context().newPage();
  try {
    const width = Math.ceil(size.width);
    const height = Math.ceil(size.height);
    await blank.setViewportSize({ width: Math.max(width, 64), height: Math.max(height, 64) });
    await blank.setContent('<!doctype html><title>markup</title><body style="margin:0;background:rgb(255 0 255)">');
    const instrumentSans = await blank.evaluate(
      async ({ svg, width, height, face }) => {
        if (face) {
          const bytes = Uint8Array.from(atob(face), (c) => c.charCodeAt(0));
          const font = new FontFace('Instrument Sans', bytes, { weight: '400 700' });
          await font.load();
          document.fonts.add(font);
        }
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const root = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
        root.setAttribute('width', String(width));
        root.setAttribute('height', String(height));
        root.style.display = 'block';
        document.body.append(root);
        await document.fonts.ready;
        const canvas = document.createElement('canvas').getContext('2d')!;
        canvas.font = '650 40px monospace';
        const fallback = canvas.measureText('EmuForge STUDIO').width;
        canvas.font = '650 40px "Instrument Sans", monospace';
        return canvas.measureText('EmuForge STUDIO').width !== fallback;
      },
      { svg, width, height, face: face ? face.toString('base64') : null },
    );
    const shot = await blank.screenshot({
      clip: { x: 0, y: 0, width, height },
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    });
    return { drawing: decodePng(shot), instrumentSans };
  } finally {
    await blank.close();
  }
}

/** The pixels that differ by more than `tolerance` in a channel between two drawings of one size. */
export function differingPixels(a: Drawing, b: Drawing, tolerance = 1): number {
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) if (channelDiff(pixel(a, x, y), pixel(b, x, y)) > tolerance) n++;
  }
  return n;
}

// --- a drawing's exact colours ----------------------------------------------------------------------------------

/**
 * Each pixel's colour among `palette` when it is that colour within 1 per channel, else -1 (an edge's blend). The
 * interior of a painted area is its colour exactly, so areas of near colours (`surface`, `accent-ink`) stay apart.
 */
export function exactLabels(d: Drawing, palette: readonly Rgb[]): Int8Array {
  const labels = new Int8Array(d.width * d.height).fill(-1);
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const p = pixel(d, x, y);
      const k = palette.findIndex((c) => channelDiff(p, c) <= 1);
      labels[y * d.width + x] = k;
    }
  }
  return labels;
}

/** The mask of the pixels labelled `k`, inside `within` when given. */
export function labelMask(d: Drawing, labels: Int8Array, k: number, within?: Box): Mask {
  const w = within ?? { left: 0, top: 0, right: d.width, bottom: d.height };
  const bits = new Uint8Array(d.width * d.height);
  for (let y = w.top; y < w.bottom; y++) {
    for (let x = w.left; x < w.right; x++) if (labels[y * d.width + x] === k) bits[y * d.width + x] = 1;
  }
  return { width: d.width, height: d.height, bits };
}

// --- fitting a drawn file over another -------------------------------------------------------------------------

/**
 * Finds where `overlay` drawn over `ground` best matches `base` drawn at `base.width` x `base.height`: the overlay's
 * whole `viewBox` placed at `start` is moved and scaled in shrinking steps while the mean absolute difference over
 * the compared box falls. The compared box is the overlay's painted box at the start, with a margin of 4 pixels.
 * Returns the place, the box, and the mean difference per channel there (the largest of the three).
 */
export async function fitOverDrawing(
  page: Page,
  base: { svg: string; width: number; height: number },
  overlay: { svg: string; ground: Rgb },
  start: { x: number; y: number; w: number; h: number },
): Promise<{ place: { x: number; y: number; w: number; h: number }; box: Box; mean: number; painted: Box | null }> {
  const url = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  return page.evaluate(
    async ({ base, overlay, ground, start }) => {
      const load = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img;
      };
      const [b, o] = await Promise.all([load(base.src), load(overlay)]);
      const canvas = (w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c.getContext('2d', { willReadFrequently: true })!;
      };
      const bp = canvas(base.width, base.height);
      bp.drawImage(b, 0, 0, base.width, base.height);
      const baseData = bp.getImageData(0, 0, base.width, base.height).data;
      const op = canvas(base.width, base.height);
      const drawOverlay = (pl: typeof start) => {
        op.fillStyle = `rgb(${ground.join(' ')})`;
        op.fillRect(0, 0, base.width, base.height);
        op.drawImage(o, pl.x, pl.y, pl.w, pl.h);
        return op.getImageData(0, 0, base.width, base.height).data;
      };
      const paintedBox = (data: Uint8ClampedArray) => {
        let box: { left: number; top: number; right: number; bottom: number } | null = null;
        for (let y = 0; y < base.height; y++) {
          for (let x = 0; x < base.width; x++) {
            const i = 4 * (y * base.width + x);
            const off = Math.max(
              Math.abs(data[i]! - ground[0]!),
              Math.abs(data[i + 1]! - ground[1]!),
              Math.abs(data[i + 2]! - ground[2]!),
            );
            if (off <= 1) continue;
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
      };
      const first = paintedBox(drawOverlay(start));
      if (!first) throw new Error('the overlay paints nothing');
      const box = {
        left: Math.max(0, first.left - 4),
        top: Math.max(0, first.top - 4),
        right: Math.min(base.width, first.right + 4),
        bottom: Math.min(base.height, first.bottom + 4),
      };
      const mean = (pl: typeof start) => {
        const data = drawOverlay(pl);
        const sums = [0, 0, 0];
        for (let y = box.top; y < box.bottom; y++) {
          for (let x = box.left; x < box.right; x++) {
            const i = 4 * (y * base.width + x);
            for (let c = 0; c < 3; c++) sums[c]! += Math.abs(data[i + c]! - baseData[i + c]!);
          }
        }
        const n = (box.right - box.left) * (box.bottom - box.top);
        return Math.max(...sums.map((s) => s / n));
      };
      const ratio = start.h / start.w;
      const place = { ...start };
      let best = mean(place);
      const steps = { x: 1, y: 1, w: start.w * 0.01 };
      for (let round = 0; round < 10; round++) {
        let moved = true;
        for (let pass = 0; pass < 8 && moved; pass++) {
          moved = false;
          for (const key of ['x', 'y', 'w'] as const) {
            for (const sign of [1, -1]) {
              const next = { ...place, [key]: place[key] + sign * steps[key] };
              next.h = next.w * ratio;
              const value = mean(next);
              if (value < best) {
                best = value;
                Object.assign(place, next);
                moved = true;
              }
            }
          }
        }
        steps.x /= 2;
        steps.y /= 2;
        steps.w /= 2;
      }
      return { place, box, mean: best, painted: paintedBox(drawOverlay(place)) };
    },
    {
      base: { src: url(base.svg), width: base.width, height: base.height },
      overlay: url(overlay.svg),
      ground: [...overlay.ground],
      start,
    },
  );
}

// --- connected parts of a mask, labelled once ------------------------------------------------------------------

export interface Part {
  id: number;
  size: number;
  box: Box;
}

/** The connected parts (joined across corners) of a mask's pixels: a label per pixel (0 for none) and each part. */
export interface Parts {
  width: number;
  height: number;
  labels: Int32Array;
  parts: Part[];
}

export function partsOf(m: Mask): Parts {
  const labels = new Int32Array(m.width * m.height);
  const parts: Part[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (!m.bits[start] || labels[start]) continue;
    const id = parts.length + 1;
    const x0 = start % m.width;
    const y0 = (start - x0) / m.width;
    const part: Part = { id, size: 0, box: { left: x0, top: y0, right: x0 + 1, bottom: y0 + 1 } };
    labels[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % m.width;
      const y = (i - x) / m.width;
      part.size++;
      part.box.left = Math.min(part.box.left, x);
      part.box.top = Math.min(part.box.top, y);
      part.box.right = Math.max(part.box.right, x + 1);
      part.box.bottom = Math.max(part.box.bottom, y + 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
          const j = ny * m.width + nx;
          if (m.bits[j] && !labels[j]) {
            labels[j] = id;
            stack.push(j);
          }
        }
      }
    }
    parts.push(part);
  }
  return { width: m.width, height: m.height, labels, parts };
}

/** The pixels of one part as a mask. */
export function partMask(p: Parts, id: number): Mask {
  const bits = new Uint8Array(p.width * p.height);
  for (let i = 0; i < bits.length; i++) if (p.labels[i] === id) bits[i] = 1;
  return { width: p.width, height: p.height, bits };
}

/** The part holding the pixel at `(x, y)`, if any. */
export function partAt(p: Parts, x: number, y: number): Part | undefined {
  const id = p.labels[y * p.width + x] ?? 0;
  return id > 0 ? p.parts[id - 1] : undefined;
}
