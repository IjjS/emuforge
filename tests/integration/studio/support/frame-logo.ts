// Studio's use of the marks as a user meets it (issue 36, test-criteria.md, "Words used below"): the tile in the
// frame's wordmark link, the document's icons and the three fixed-path files Studio's server answers. Used by
// `icons.spec.ts` and `frame-logo.spec.ts`; drawing and measuring a tile is `brand.ts`'s, reused here unchanged.
//
// - "The tile": the `svg` inside the wordmark link (the banner's link "EmuForge Studio").
// - A tile "drawn from the page": the page's own pixels, taken with a screenshot of the tile's box. To measure its
//   shape the page is opened in a context of device pixel ratio 4 and everything but the tile is made invisible
//   (`visibility`, which changes no layout) over a magenta ground, so the tile's square stands out from the bar.
// - A tile's "form": its square's pixels, the four corner triangles outside a rounded square left out, sorted into
//   the ground's colour, the symbol's colour and blends of the two; every colour is a token's colour as this Chromium
//   paints it (`brand.ts`, `tokenColours`), read from `tokens.css` at run time.
// - "The tile's rules": every style rule of the page's stylesheets that matches the tile or an element inside it,
//   with `:hover`, `:active` and the focus pseudo-classes taken to match and a pseudo-element standing for its
//   element; rules under a media condition count whatever the viewport.
// - "A fixed-path file": `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`.

import http from 'node:http';
import net from 'node:net';

import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from '@playwright/test';

import {
  channelDiff,
  draw,
  MAGENTA,
  offBlend,
  pixel,
  tokenColours,
  type Box,
  type Drawing,
  type Rgb,
  type Scheme,
  type TileColours,
  type TileDrawing,
} from './brand';
import { decodePng } from './brand-files';
import { expect, type Ctx } from './check';
import { ACTION, frame } from './frame';
import type { StudioServer } from './studio';

/** The three files Studio serves at a fixed path (R7.3), in the order the page links them (R7.1). */
export const FIXED_PATH_FILES = [
  { path: '/favicon.ico', name: 'favicon.ico', rel: 'icon', type: 'image/x-icon' },
  { path: '/favicon.svg', name: 'favicon.svg', rel: 'icon', type: 'image/svg+xml' },
  { path: '/apple-touch-icon.png', name: 'apple-touch-icon.png', rel: 'apple-touch-icon', type: 'image/png' },
] as const;

/** R8.4: where the code sign's box may be, as shares of `S`; the widest of its four ranges. */
export const CODE_SIGN_BOX = { left: 0.46, top: 0.52, right: 0.92, bottom: 0.84 };

/** A box in CSS pixels, as Playwright measures one. */
export interface CssBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- colours ---------------------------------------------------------------------------------------------------

/** Every token's colour in both schemes, read once; the returned function fails the check on an unknown token. */
export async function schemeTokens(page: Page, ctx: Ctx): Promise<(scheme: Scheme, name: string) => Rgb> {
  const schemes = {
    light: await tokenColours(page, ctx, 'light'),
    dark: await tokenColours(page, ctx, 'dark'),
  };
  return (scheme, name) => {
    const colour = schemes[scheme].get(name);
    expect(colour, `the ${scheme} colour of the token --st-${name} in tokens.css`).toBeDefined();
    return colour as Rgb;
  };
}

/** The tile's colours in a scheme (R6.1): the ground `accent`, the symbol `accent-ink`. */
export function tileColoursOf(token: (scheme: Scheme, name: string) => Rgb, scheme: Scheme): TileColours {
  return { ground: token(scheme, 'accent'), symbol: token(scheme, 'accent-ink') };
}

// --- the tile on the page --------------------------------------------------------------------------------------

/** The tile: the `svg` inside the wordmark link. */
export function tileOf(page: Page): Locator {
  return frame(page).wordmark.locator('svg');
}

/** The tile's box; throws, naming why, when the page has no tile or more than one. */
export async function tileBox(page: Page): Promise<CssBox> {
  const tile = tileOf(page);
  const n = await tile.count();
  if (n !== 1) throw new Error(`the wordmark link holds ${String(n)} svg elements, not one tile`);
  const box = await tile.boundingBox(ACTION);
  if (box === null) throw new Error('the tile is not drawn');
  return box;
}

/**
 * The box of the first occurrence of `word` in the text of `link`'s element: a range over that word alone, so the
 * space before "Studio" is not counted. `null` when the text holds no such word or it is not laid out.
 */
export async function wordBox(link: Locator, word: string): Promise<CssBox | null> {
  return link.evaluate(
    (el, w) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = (n as Text).data.indexOf(w);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + w.length);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }
      return null;
    },
    word,
    ACTION,
  );
}

/**
 * Why the tile is not whole at `side` x `side`: not exactly one tile, another size (by more than half a pixel), not
 * inside the viewport, or cut by an element around it that clips its content.
 */
export async function tileWholeProblems(page: Page, side: number): Promise<string[]> {
  const n = await tileOf(page).count();
  if (n !== 1) return [`the wordmark link holds ${String(n)} svg elements, not one tile`];
  return tileOf(page).evaluate(
    (tile, s) => {
      const out: string[] = [];
      const r = tile.getBoundingClientRect();
      const box = `${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`;
      if (Math.abs(r.width - s) > 0.5 || Math.abs(r.height - s) > 0.5)
        out.push(`the tile is ${box}, not ${String(s)} x ${String(s)}`);
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) {
        out.push(`the tile (${box}) is not inside the viewport`);
      }
      for (let a = tile.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.clipPath !== 'none';
        if (!clips) continue;
        const c = a.getBoundingClientRect();
        if (r.left < c.left - 0.5 || r.top < c.top - 0.5 || r.right > c.right + 0.5 || r.bottom > c.bottom + 0.5) {
          out.push(`the tile (${box}) is cut by ${a.tagName.toLowerCase()}.${[...a.classList].join('.')}`);
        }
      }
      return out;
    },
    side,
    ACTION,
  );
}

/** The computed `color` of the element that holds the text `word` inside `link`'s element; `null` when none does. */
export async function wordColour(link: Locator, word: string): Promise<string | null> {
  return link.evaluate(
    (el, w) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if ((n as Text).data.includes(w) && n.parentElement) return getComputedStyle(n.parentElement).color;
      }
      return null;
    },
    word,
    ACTION,
  );
}

/** The page's pixels inside `clip` (CSS pixels), at the context's device pixel ratio. */
export async function shot(page: Page, clip: CssBox): Promise<Drawing> {
  const png = await page.screenshot({ clip, scale: 'device', animations: 'disabled', caret: 'hide' });
  return decodePng(png);
}

/** A box grown by `by` on every side, its edges on whole CSS pixels. */
export function grown(box: CssBox, by: number): CssBox {
  const x = Math.floor(box.x - by);
  const y = Math.floor(box.y - by);
  return { x, y, width: Math.ceil(box.x + box.width + by) - x, height: Math.ceil(box.y + box.height + by) - y };
}

/** The tile's own pixels at the page's device pixel ratio 1: its box and what is drawn there. */
export interface TileShot {
  box: CssBox;
  drawing: Drawing;
}

export async function tileShot(page: Page): Promise<TileShot> {
  const box = await tileBox(page);
  return { box, drawing: await shot(page, grown(box, 0)) };
}

/** Why two shots of the tile differ: its box by more than half a pixel, or a pixel by more than 2 of 255. */
export function tileShotDiffers(a: TileShot, b: TileShot): string[] {
  const out: string[] = [];
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    if (Math.abs(a.box[k] - b.box[k]) > 0.5) out.push(`${k} ${a.box[k].toFixed(1)} vs ${b.box[k].toFixed(1)}`);
  }
  if (a.drawing.width !== b.drawing.width || a.drawing.height !== b.drawing.height) {
    out.push(`drawn ${a.drawing.width} x ${a.drawing.height} vs ${b.drawing.width} x ${b.drawing.height}`);
    return out;
  }
  let differ = 0;
  for (let y = 0; y < a.drawing.height; y++) {
    for (let x = 0; x < a.drawing.width; x++) {
      if (channelDiff(pixel(a.drawing, x, y), pixel(b.drawing, x, y)) > 2) differ++;
    }
  }
  if (differ > 0) out.push(`${String(differ)} pixels differ by more than 2 of 255`);
  return out;
}

/** How a tile's square is painted, as shares of its pixels outside the four corner triangles. */
export interface TileForm {
  /** Pixels within 2 of 255 of the ground's colour. */
  ground: number;
  /** Pixels within 2 of 255 of the symbol's colour. */
  symbol: number;
  /** Pixels more than 3 of 255 from every blend of the two. */
  off: number;
  /** How many pixels were sorted. */
  pixels: number;
}

/**
 * Sorts the pixels of the square `square` of `d`: the corner triangles (fewer than a quarter of the side's steps
 * from a corner along the two edges, where a rounded square leaves the page showing) are left out.
 */
export function tileForm(d: Drawing, square: Box, colours: TileColours): TileForm {
  const side = Math.min(square.right - square.left, square.bottom - square.top);
  const corner = 0.25 * side;
  let ground = 0;
  let symbol = 0;
  let off = 0;
  let pixels = 0;
  for (let y = square.top; y < square.bottom; y++) {
    for (let x = square.left; x < square.right; x++) {
      const i = x - square.left;
      const j = y - square.top;
      const w = square.right - square.left;
      const h = square.bottom - square.top;
      if (Math.min(i, w - 1 - i) + Math.min(j, h - 1 - j) < corner) continue;
      const p = pixel(d, x, y);
      pixels++;
      if (channelDiff(p, colours.ground) <= 2) ground++;
      else if (channelDiff(p, colours.symbol) <= 2) symbol++;
      else if (offBlend(p, colours.ground, colours.symbol) > 3) off++;
    }
  }
  return { ground: ground / pixels, symbol: symbol / pixels, off: off / pixels, pixels };
}

/**
 * Why a form is not a square of `ground` with a symbol of `symbol`: the ground is the larger part (at least 0.40 of
 * the pixels), the symbol's colour is present (at least 0.03), and at most 0.02 of the pixels are neither colour nor
 * a blend of the two.
 */
export function formProblems(form: TileForm, what: string): string[] {
  const out: string[] = [];
  const f = (n: number) => n.toFixed(3);
  if (form.pixels === 0) return [`${what}: no pixel to sort`];
  if (form.ground < 0.4) out.push(`${what}: ${f(form.ground)} of the pixels are the ground's colour, not 0.40 or more`);
  if (form.symbol < 0.03)
    out.push(`${what}: ${f(form.symbol)} of the pixels are the symbol's colour, not 0.03 or more`);
  if (form.ground <= form.symbol) out.push(`${what}: the symbol's colour covers more than the ground's`);
  if (form.off > 0.02) out.push(`${what}: ${f(form.off)} of the pixels are neither colour nor a blend of the two`);
  return out;
}

/** The square of a tile shot in drawing pixels: the tile's box rounded to whole pixels of the shot. */
export function shotSquare(s: TileShot, clip: CssBox, scale = 1): Box {
  return {
    left: Math.round((s.box.x - clip.x) * scale),
    top: Math.round((s.box.y - clip.y) * scale),
    right: Math.round((s.box.x + s.box.width - clip.x) * scale),
    bottom: Math.round((s.box.y + s.box.height - clip.y) * scale),
  };
}

/** The form of the tile as the page draws it now. */
export async function pageTileForm(page: Page, colours: TileColours): Promise<TileForm> {
  const s = await tileShot(page);
  return tileForm(s.drawing, shotSquare(s, grown(s.box, 0)), colours);
}

// --- drawing served files --------------------------------------------------------------------------------------

/** The margin of magenta around a drawn icon, in pixels. */
const ICON_MARGIN = 4;

/**
 * Draws a whole square icon file (its `viewBox` being the tile) as an image at `side` pixels on magenta, in the
 * scheme the page is in. Returned as a `brand.ts` tile drawing.
 */
export async function drawSvgTile(page: Page, svg: string, side: number): Promise<TileDrawing> {
  const drawing = await draw(page, svg, {
    width: side + 2 * ICON_MARGIN,
    height: side + 2 * ICON_MARGIN,
    ground: MAGENTA,
    x: ICON_MARGIN,
    y: ICON_MARGIN,
    w: side,
    h: side,
  });
  return {
    drawing,
    tile: { left: ICON_MARGIN, top: ICON_MARGIN, right: ICON_MARGIN + side, bottom: ICON_MARGIN + side },
    side,
    found: { x: 0, y: 0, width: side, height: side },
  };
}

/**
 * Each entry of an `.ico`, drawn by the page as an image: the entry is put alone into an `.ico` of one entry, opened
 * as `image/x-icon` and drawn at its own size on magenta.
 */
export async function icoEntries(page: Page, bytes: Buffer): Promise<TileDrawing[]> {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    throw new Error('not an ICO: the header is not reserved 0, type 1');
  }
  const out: TileDrawing[] = [];
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const at = 6 + 16 * i;
    const side = bytes[at] || 256;
    const size = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    const one = Buffer.alloc(22 + size);
    one.writeUInt16LE(0, 0);
    one.writeUInt16LE(1, 2);
    one.writeUInt16LE(1, 4);
    bytes.copy(one, 6, at, at + 12);
    one.writeUInt32LE(22, 18);
    bytes.copy(one, 22, offset, offset + size);
    const source = `data:image/x-icon;base64,${one.toString('base64')}`;
    const encoded = await page.evaluate(
      async ({ source, side, margin }) => {
        const img = new Image();
        img.src = source;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = side + 2 * margin;
        canvas.height = side + 2 * margin;
        const paint = canvas.getContext('2d', { willReadFrequently: true })!;
        paint.fillStyle = 'rgb(255 0 255)';
        paint.fillRect(0, 0, canvas.width, canvas.height);
        paint.drawImage(img, margin, margin, side, side);
        const data = paint.getImageData(0, 0, canvas.width, canvas.height).data;
        let text = '';
        for (let k = 0; k < data.length; k += 0x8000) text += String.fromCharCode(...data.subarray(k, k + 0x8000));
        return btoa(text);
      },
      { source, side, margin: ICON_MARGIN },
    );
    out.push({
      drawing: {
        width: side + 2 * ICON_MARGIN,
        height: side + 2 * ICON_MARGIN,
        data: new Uint8Array(Buffer.from(encoded, 'base64')),
      },
      tile: { left: ICON_MARGIN, top: ICON_MARGIN, right: ICON_MARGIN + side, bottom: ICON_MARGIN + side },
      side,
      found: { x: 0, y: 0, width: side, height: side },
    });
  }
  return out;
}

// --- browser contexts ------------------------------------------------------------------------------------------

export interface ContextOptions {
  width?: number;
  scheme?: Scheme;
  /** The device pixel ratio; default 1. */
  scale?: number;
}

/**
 * A context of the same browser with the check's destination rule (the `proxy` fixture of `check.ts`), English, at
 * Studio's origin, owned by `ctx` and closed when the check ends, and a page in it.
 */
export async function brandContext(
  ctx: Ctx,
  browser: Browser,
  proxy: BrowserContextOptions['proxy'],
  studio: StudioServer,
  options: ContextOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const width = options.width ?? 1280;
  const context = await browser.newContext({
    proxy,
    baseURL: studio.origin,
    locale: 'en-US',
    colorScheme: options.scheme ?? 'light',
    viewport: { width, height: width <= 480 ? 844 : 800 },
    deviceScaleFactor: options.scale ?? 1,
    serviceWorkers: 'block',
  });
  ctx.own({ dispose: () => context.close() });
  return { context, page: await context.newPage() };
}

const SCALE = 4;

/**
 * Draws the tile of `path` from the page at 4 times its size: the page is opened in a context of device pixel ratio
 * 4 in `scheme`, everything but the tile is made invisible over a magenta ground, and the tile's box with one CSS
 * pixel around it is taken. Returned as a `brand.ts` tile drawing, its square being the tile's box.
 */
export async function drawPageTile(
  ctx: Ctx,
  browser: Browser,
  proxy: BrowserContextOptions['proxy'],
  studio: StudioServer,
  options: { path: string; scheme: Scheme; width?: number },
): Promise<TileDrawing> {
  const { context, page } = await brandContext(ctx, browser, proxy, studio, {
    scheme: options.scheme,
    width: options.width ?? 1280,
    scale: SCALE,
  });
  try {
    await page.goto(options.path);
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: ACTION.timeout });
    const box = await tileBox(page);
    await tileOf(page).evaluate((el) => el.setAttribute('data-emuforge-it-tile', ''), undefined, ACTION);
    await page.addStyleTag({
      content:
        'html, body { background: rgb(255 0 255) !important; } * { visibility: hidden !important; } ' +
        '[data-emuforge-it-tile], [data-emuforge-it-tile] * { visibility: visible !important; }',
    });
    const clip = grown(box, 1);
    const drawing = await shot(page, clip);
    const square = shotSquare({ box, drawing }, clip, SCALE);
    const side = square.right - square.left;
    ctx.log(
      `the tile of ${options.path} (${options.scheme}) at ${String(SCALE)}x: box ${JSON.stringify(box)}, square ${JSON.stringify(square)}`,
    );
    return {
      drawing,
      tile: { left: square.left, top: square.top, right: square.left + side, bottom: square.top + side },
      side,
      found: { x: box.x, y: box.y, width: box.width, height: box.height },
    };
  } finally {
    await context.close();
  }
}

// --- Studio's server -------------------------------------------------------------------------------------------

export interface RawAnswer {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: Buffer;
}

/** `GET http://127.0.0.1:<port><path>` with no proxy and no keep-alive: the answer's status, headers and bytes. */
export async function fetchRaw(port: number, path: string): Promise<RawAnswer> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, agent: false, timeout: 5_000 }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
        }
        resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`no answer from 127.0.0.1:${String(port)} within 5 s`)));
    request.on('error', reject);
  });
}

/** The media type of an answer without its parameters. */
export function mediaType(answer: RawAnswer): string {
  return (answer.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * A listener on `127.0.0.1:<port>` that accepts every connection and never answers: an engine whose first check is
 * still unanswered. Owned by `ctx`.
 */
export async function silentListener(
  ctx: Ctx,
  port: number,
): Promise<{ accepted: () => number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  let accepted = 0;
  const server = net.createServer((socket) => {
    accepted++;
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  ctx.log(`a listener that never answers holds 127.0.0.1:${String(port)}`);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.log(`the listener on 127.0.0.1:${String(port)} is closed after ${String(accepted)} connections`);
  };
  ctx.own({ dispose: close });
  return { accepted: () => accepted, close };
}

// --- the document's icons --------------------------------------------------------------------------------------

export interface IconLink {
  rel: string;
  /** The `href` attribute as written. */
  href: string | null;
  /** The address it resolves to in the document. */
  resolved: string;
  sizes: string | null;
  type: string | null;
}

/** The `link` elements of the document's `head` whose `rel` names an icon, in document order. */
export async function iconLinks(page: Page): Promise<IconLink[]> {
  return page.evaluate(() =>
    [...document.head.querySelectorAll('link')]
      .filter((l) => /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(l.rel))
      .map((l) => ({
        rel: l.rel,
        href: l.getAttribute('href'),
        resolved: l.href,
        sizes: l.getAttribute('sizes'),
        type: l.getAttribute('type'),
      })),
  );
}

/** The links R7.1 asks for, at `origin`: the rel and the address each resolves to. */
export function expectedIconLinks(origin: string): { rel: string; resolved: string }[] {
  return FIXED_PATH_FILES.map((f) => ({ rel: f.rel, resolved: `${origin}${f.path}` }));
}

// --- watching the tile and the icon links ----------------------------------------------------------------------

/**
 * Marks the tile and the icon links of the open document and starts recording every change to them: an attribute,
 * a child or a text of the tile or inside it, an attribute of an icon link, an icon link added to or removed from
 * the `head`. `tileWatch` reads what was recorded.
 */
export async function watchTile(page: Page): Promise<void> {
  await tileBox(page);
  await tileOf(page).evaluate(
    (tile) => {
      const w = window as unknown as { __emuforgeItTileWatch?: { changes: string[] } };
      const changes: string[] = [];
      w.__emuforgeItTileWatch = { changes };
      (tile as Element & { __emuforgeItTile?: boolean }).__emuforgeItTile = true;
      const isIcon = (n: Node) => n instanceof HTMLLinkElement && /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(n.rel);
      for (const l of document.head.querySelectorAll('link')) {
        if (isIcon(l)) (l as Element & { __emuforgeItIcon?: boolean }).__emuforgeItIcon = true;
      }
      new MutationObserver((records) => {
        for (const r of records) {
          const target = r.target;
          if (tile.contains(target) || target === tile) {
            changes.push(`the tile: ${r.type}${r.attributeName ? ` ${r.attributeName}` : ''}`);
          } else if (target.parentNode === tile.parentNode && [...r.removedNodes].includes(tile)) {
            changes.push('the tile was removed');
          } else if (isIcon(target)) {
            changes.push(`an icon link: ${r.type} ${r.attributeName ?? ''}`);
          } else if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].some(isIcon)) {
            changes.push('an icon link was added or removed');
          } else if (r.type === 'childList' && [...r.removedNodes].some((n) => n.contains(tile))) {
            changes.push('the tile was removed with its parent');
          }
        }
      }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
    },
    undefined,
    ACTION,
  );
}

/** What `watchTile` recorded, and whether the tile and the icon links are still the marked elements. */
export async function tileWatch(
  page: Page,
): Promise<{ changes: string[]; sameTile: boolean; sameIcons: boolean } | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __emuforgeItTileWatch?: { changes: string[] } };
    if (!w.__emuforgeItTileWatch) return null;
    const mark = [...document.querySelectorAll('header a, [role="banner"] a')].find(
      (a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim() === 'EmuForge Studio',
    );
    const tile = mark?.querySelector('svg') as (Element & { __emuforgeItTile?: boolean }) | null | undefined;
    const icons = [...document.head.querySelectorAll('link')].filter((l) =>
      /(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(l.rel),
    ) as (HTMLLinkElement & { __emuforgeItIcon?: boolean })[];
    return {
      changes: w.__emuforgeItTileWatch.changes,
      sameTile: tile?.__emuforgeItTile === true,
      sameIcons: icons.length > 0 && icons.every((l) => l.__emuforgeItIcon === true),
    };
  });
}

// --- the first frame -------------------------------------------------------------------------------------------

/** The first frame in which the bar is drawn, as the page was about to paint it. */
export interface FirstBarFrame {
  /** Milliseconds since the document started. */
  at: number;
  /** The wordmark link was in the bar. */
  wordmark: boolean;
  /** The tile in that frame; `null` when the wordmark link held no `svg`. */
  tile: {
    width: number;
    height: number;
    inViewport: boolean;
    /** Paths and their total length of path data: the drawing is there, not waiting for anything. */
    paths: number;
    pathData: number;
    /** Elements that would load something to draw (`image`, `use` with an address, `foreignObject`). */
    loaders: number;
  } | null;
}

/**
 * Records, from the document's start, the first animation frame in which the banner is drawn: the state just
 * before that frame is painted. Installed in every document `page` loads from now on.
 */
export async function recordFirstBarFrame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __emuforgeItFirstBar?: unknown };
    const look = () => {
      const banner = [...document.querySelectorAll('header, [role="banner"]')].find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!banner) {
        requestAnimationFrame(look);
        return;
      }
      const mark = [...banner.querySelectorAll('a')].find(
        (a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim() === 'EmuForge Studio',
      );
      const svg = mark?.querySelector('svg') ?? null;
      let tile = null;
      if (svg) {
        const r = svg.getBoundingClientRect();
        const paths = [...svg.querySelectorAll('path')];
        tile = {
          width: r.width,
          height: r.height,
          inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          paths: paths.length,
          pathData: paths.reduce((n, p) => n + (p.getAttribute('d') ?? '').length, 0),
          loaders: svg.querySelectorAll('image, foreignObject, use[href], use[*|href]').length,
        };
      }
      w.__emuforgeItFirstBar = { at: performance.now(), wordmark: mark !== undefined, tile };
    };
    requestAnimationFrame(look);
  });
}

export async function firstBarFrame(page: Page): Promise<FirstBarFrame | null> {
  return page.evaluate(
    () =>
      ((window as unknown as { __emuforgeItFirstBar?: unknown }).__emuforgeItFirstBar ?? null) as FirstBarFrame | null,
  );
}

// --- the focus ring --------------------------------------------------------------------------------------------

export interface RingReport {
  outline: { style: string; width: number; offset: number; colour: string };
  /** Per side: positions sampled, positions where no pixel of the focus colour was found, the distances seen. */
  sides: Record<'top' | 'right' | 'bottom' | 'left', { sampled: number; missing: number; distances: number[] }>;
  problems: string[];
}

type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * The focus ring of the focused `link`, from the page's pixels (device pixel ratio 1): along each side of the
 * link's box, away from the rounded corners, the first pixel of `focus` (within 2 of 255) going outward from the
 * box; its distance from the box is the ring's offset as drawn. The ring's outer box must be inside `bar` and the
 * viewport.
 */
export async function ringReport(page: Page, link: Locator, bar: Locator, focus: Rgb): Promise<RingReport> {
  const box = await link.boundingBox(ACTION);
  const barBox = await bar.boundingBox(ACTION);
  if (box === null || barBox === null) throw new Error('the wordmark link or the bar is not drawn');
  const style = await link.evaluate(
    (el) => {
      const cs = getComputedStyle(el);
      return {
        style: cs.outlineStyle,
        width: parseFloat(cs.outlineWidth) || 0,
        offset: parseFloat(cs.outlineOffset) || 0,
        colour: cs.outlineColor,
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
      };
    },
    undefined,
    ACTION,
  );
  const problems: string[] = [];
  const reach = Math.max(style.offset + style.width, 0) + 3;
  const outer = {
    left: box.x - style.offset - style.width,
    top: box.y - style.offset - style.width,
    right: box.x + box.width + style.offset + style.width,
    bottom: box.y + box.height + style.offset + style.width,
  };
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  const barBottom = barBox.y + barBox.height;
  if (
    outer.left < barBox.x - 0.5 ||
    outer.top < barBox.y - 0.5 ||
    outer.right > barBox.x + barBox.width + 0.5 ||
    outer.bottom > barBottom + 0.5
  ) {
    problems.push(`the ring's box ${JSON.stringify(outer)} is not inside the bar ${JSON.stringify(barBox)}`);
  }
  if (outer.left < -0.5 || outer.top < -0.5 || outer.right > size.width + 0.5 || outer.bottom > size.height + 0.5) {
    problems.push(`the ring's box ${JSON.stringify(outer)} is not inside the viewport`);
  }
  const clipX = Math.max(0, Math.floor(box.x - reach));
  const clipY = Math.max(0, Math.floor(box.y - reach));
  const clip = {
    x: clipX,
    y: clipY,
    width: Math.min(size.width, Math.ceil(box.x + box.width + reach)) - clipX,
    height: Math.min(size.height, Math.ceil(box.y + box.height + reach)) - clipY,
  };
  const d = await shot(page, clip);
  // The outline runs straight along the box's edge wherever the border does: away from the corners' radius.
  const keep = style.radius > 0 ? style.radius + 1 : 1;
  const sides: RingReport['sides'] = {
    top: { sampled: 0, missing: 0, distances: [] },
    right: { sampled: 0, missing: 0, distances: [] },
    bottom: { sampled: 0, missing: 0, distances: [] },
    left: { sampled: 0, missing: 0, distances: [] },
  };
  const at = (x: number, y: number): Rgb | null =>
    x >= 0 && y >= 0 && x < d.width && y < d.height ? pixel(d, x, y) : null;
  const scan = (side: Side, along: number) => {
    // From the first pixel outside the link's box outward, at most `reach` pixels.
    for (let k = 0; k < reach + 1; k++) {
      let x: number;
      let y: number;
      let distance: number;
      if (side === 'top') {
        y = Math.floor(box.y) - 1 - k;
        x = along;
        distance = box.y - (y + 1);
      } else if (side === 'bottom') {
        y = Math.ceil(box.y + box.height) + k;
        x = along;
        distance = y - (box.y + box.height);
      } else if (side === 'left') {
        x = Math.floor(box.x) - 1 - k;
        y = along;
        distance = box.x - (x + 1);
      } else {
        x = Math.ceil(box.x + box.width) + k;
        y = along;
        distance = x - (box.x + box.width);
      }
      const p = at(x - clip.x, y - clip.y);
      if (p !== null && channelDiff(p, focus) <= 2) return distance;
    }
    return null;
  };
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const horizontal = side === 'top' || side === 'bottom';
    const from = Math.ceil((horizontal ? box.x : box.y) + keep);
    const to = Math.floor((horizontal ? box.x + box.width : box.y + box.height) - keep);
    for (let along = from; along < to; along++) {
      sides[side].sampled++;
      const distance = scan(side, along);
      if (distance === null) sides[side].missing++;
      else if (!sides[side].distances.includes(Math.round(distance * 10) / 10))
        sides[side].distances.push(Math.round(distance * 10) / 10);
    }
    if (sides[side].sampled === 0) problems.push(`the ${side} side is too short to sample away from its corners`);
    if (sides[side].missing > 0) {
      problems.push(
        `the ${side} side: no pixel of the focus colour at ${String(sides[side].missing)} of ${String(sides[side].sampled)} places`,
      );
    }
    const far = sides[side].distances.filter((x) => x < 3 || x > 5);
    if (far.length > 0) {
      problems.push(`the ${side} side: the ring starts ${far.join(', ')} pixels out from the link's box, not 4`);
    }
  }
  return {
    outline: { style: style.style, width: style.width, offset: style.offset, colour: style.colour },
    sides,
    problems,
  };
}

/**
 * Counts, from the tile's top, left and bottom edges outward, the pixels of `surface` (within 2 of 255) before the
 * first pixel of `focus`, at the middle of each side; the page at device pixel ratio 1.
 */
export async function surfaceBetween(
  page: Page,
  tile: CssBox,
  surface: Rgb,
  focus: Rgb,
): Promise<Record<'top' | 'left' | 'bottom', { surface: number; ringAt: number | null }>> {
  const clip = grown(tile, 12);
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  clip.x = Math.max(0, clip.x);
  clip.y = Math.max(0, clip.y);
  clip.width = Math.min(size.width - clip.x, clip.width);
  clip.height = Math.min(size.height - clip.y, clip.height);
  const d = await shot(page, clip);
  const midX = Math.floor(tile.x + tile.width / 2) - clip.x;
  const midY = Math.floor(tile.y + tile.height / 2) - clip.y;
  const walk = (x0: number, y0: number, dx: number, dy: number) => {
    let surfaceCount = 0;
    for (let k = 0; ; k++) {
      const x = x0 + dx * k;
      const y = y0 + dy * k;
      if (x < 0 || y < 0 || x >= d.width || y >= d.height) return { surface: surfaceCount, ringAt: null };
      const p = pixel(d, x, y);
      if (channelDiff(p, focus) <= 2) return { surface: surfaceCount, ringAt: k };
      if (channelDiff(p, surface) <= 2) surfaceCount++;
    }
  };
  return {
    top: walk(midX, Math.floor(tile.y) - 1 - clip.y, 0, -1),
    left: walk(Math.floor(tile.x) - 1 - clip.x, midY, -1, 0),
    bottom: walk(midX, Math.ceil(tile.y + tile.height) - clip.y, 0, 1),
  };
}

// --- the look of an element and its contents -------------------------------------------------------------------

/** Every computed property of `locator`'s element and of each element inside it, `cursor` left out. */
export async function computedLook(locator: Locator): Promise<Record<string, string>> {
  return locator.evaluate(
    (root) => {
      const out: Record<string, string> = {};
      const all = [root, ...root.querySelectorAll('*')];
      for (const [i, el] of all.entries()) {
        for (const a of el.getAnimations()) a.finish();
        const cs = getComputedStyle(el);
        for (let k = 0; k < cs.length; k++) {
          const name = cs.item(k);
          if (name === 'cursor') continue;
          out[`${String(i)} ${el.tagName.toLowerCase()} ${name}`] = cs.getPropertyValue(name);
        }
      }
      return out;
    },
    undefined,
    ACTION,
  );
}

// --- the tile's rules ------------------------------------------------------------------------------------------

export interface TileRules {
  /** Each tile rule: its selector, its cascade layer (`''` outside every layer) and its sheet. */
  rules: { selector: string; layer: string; sheet: string }[];
  /** Elements inside the area's root that a tile rule matches. */
  matchedInside: string[];
  /** Elements inside the area's root that carry a class of the tile's that a tile rule names. */
  classesInside: string[];
  /** Elements inside the area's root whose value of a custom property a tile rule declares is not the document's. */
  customInside: string[];
  /** Stylesheets whose rules could not be read. */
  unreadable: string[];
}

/**
 * The tile's rules and what of them reaches the area's root `root` (found by the caller and marked with the
 * property `__emuforgeItRoot`; `null` when the page has no area).
 */
export async function tileRules(page: Page): Promise<TileRules> {
  await tileBox(page);
  return tileOf(page).evaluate(
    (tile) => {
      const widen = (selector: string) =>
        selector
          .replace(/::?(before|after|marker|placeholder|selection|first-line|first-letter|backdrop)\b/g, '')
          .replace(/:(hover|active|focus-visible|focus-within|focus)\b/g, '');
      const layerOf = (rule: CSSRule): string[] => {
        const names: string[] = [];
        for (let r: CSSRule | null = rule; r; r = r.parentRule) {
          if (r instanceof CSSLayerBlockRule) names.unshift(r.name || '(anonymous)');
        }
        return names;
      };
      const found: { rule: CSSStyleRule; selector: string; layer: string; sheet: string }[] = [];
      const unreadable: string[] = [];
      const all: { rule: CSSStyleRule; selector: string; layer: string; sheet: string }[] = [];
      const walk = (rules: CSSRuleList, sheet: string, parent: string | null, layers: string[]) => {
        for (const rule of rules) {
          if (rule instanceof CSSImportRule) {
            try {
              if (rule.styleSheet) {
                walk(
                  rule.styleSheet.cssRules,
                  rule.href,
                  null,
                  rule.layerName !== null ? [...layers, rule.layerName] : layers,
                );
              }
            } catch {
              unreadable.push(rule.href);
            }
          } else if (rule instanceof CSSStyleRule) {
            const own = rule.selectorText;
            const selector =
              parent === null ? own : own.includes('&') ? own.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${own}`;
            all.push({ rule, selector, layer: [...layers, ...layerOf(rule)].join('.'), sheet });
            if (rule.cssRules.length > 0) walk(rule.cssRules, sheet, selector, layers);
          } else if ('cssRules' in rule) {
            walk((rule as CSSGroupingRule).cssRules, sheet, parent, layers);
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules, sheet.href ?? '(inline)', null, []);
        } catch {
          unreadable.push(sheet.href ?? '(inline)');
        }
      }
      const tileElements = [tile, ...tile.querySelectorAll('*')];
      const matches = (el: Element, selector: string) => {
        try {
          return el.matches(widen(selector));
        } catch {
          return false;
        }
      };
      for (const r of all) if (tileElements.some((el) => matches(el, r.selector))) found.push(r);
      const describe = (el: Element) =>
        `${el.tagName.toLowerCase()}${el.classList.length > 0 ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}`;
      const root = [...document.querySelectorAll('*')].find(
        (el) => (el as Element & { __emuforgeItRoot?: boolean }).__emuforgeItRoot === true,
      );
      const inside = root ? [root, ...root.querySelectorAll('*')] : [];
      const tileClasses = new Set(tileElements.flatMap((el) => [...el.classList]));
      const named = new Set<string>();
      for (const r of found) {
        for (const m of r.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) if (tileClasses.has(m[1]!)) named.add(m[1]!);
      }
      const custom = new Set<string>();
      for (const r of found) {
        for (let k = 0; k < r.rule.style.length; k++) {
          const name = r.rule.style.item(k);
          if (name.startsWith('--')) custom.add(name);
        }
      }
      const docStyle = getComputedStyle(document.documentElement);
      const matchedInside: string[] = [];
      const classesInside: string[] = [];
      const customInside: string[] = [];
      for (const el of inside) {
        const hit = found.find((r) => matches(el, r.selector));
        if (hit) matchedInside.push(`${describe(el)} by ${hit.selector}`);
        const cls = [...el.classList].filter((c) => named.has(c));
        if (cls.length > 0) classesInside.push(`${describe(el)}: ${cls.join(' ')}`);
        const cs = getComputedStyle(el);
        for (const name of custom) {
          const v = cs.getPropertyValue(name).trim();
          if (v !== '' && v !== docStyle.getPropertyValue(name).trim())
            customInside.push(`${describe(el)}: ${name} ${v}`);
        }
      }
      const cap = (list: string[]) => [...new Set(list)].slice(0, 20);
      return {
        rules: found.map((r) => ({ selector: r.selector, layer: r.layer, sheet: r.sheet })),
        matchedInside: cap(matchedInside),
        classesInside: cap(classesInside),
        customInside: cap(customInside),
        unreadable,
      };
    },
    undefined,
    ACTION,
  );
}
