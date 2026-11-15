// The logos, the social image, the colours and the rasters (test-criteria.md, issue 36, Flow):
//
// - `studio.brand-logos-hold-their-layout`: the four logo files hold R8.3's layout, and their letters are Studio's
//   own Instrument Sans drawn as shapes that need no font;
// - `studio.brand-social-image-holds-its-layout`: `social.svg` holds R4.8's and R8.6's composition, and
//   `social-1200x630.png` is that file drawn;
// - `studio.brand-colours-are-studio-tokens`: every colour of every vector file is the colour of the token R4's
//   Colours table names for its element, read from `tokens.css` at run time;
// - `studio.brand-rasters-are-their-vectors-drawn`: each `.png` and each entry of `favicon.ico` is its vector drawn
//   (R5.3), and the favicon's small entries keep the eye and the neck.
//
// The files are read from the checkout (`studio/brand/`, `studio/public/`) and drawn by the check's own Chromium
// (`support/brand.ts`, `support/brand-files.ts`); no Studio server, engine or emulator is needed to observe them. A
// check reads every file it needs first and fails there, naming each one that does not exist.

import type { Page } from '@playwright/test';

import {
  brandPath,
  drawTile,
  expect,
  MAGENTA,
  measureTile,
  pixel,
  readBrandFile,
  test,
  tokenColours,
  viewBoxOf,
  type Ctx,
  type Rgb,
  type Scheme,
} from './support';
import { boxOf, channelDiff, draw, holes, offBlend, regions, type Box, type Region } from './support/brand';
import {
  alphaAt,
  decodeIco,
  decodePng,
  differingPixels,
  drawAsMarkup,
  drawClear,
  drawLogo,
  exactLabels,
  fitLiveText,
  fitOverDrawing,
  inkBox,
  instrumentSans,
  labelMask,
  lettersOf,
  meanDifference,
  paintedColours,
  partAt,
  partMask,
  partsOf,
  readBrandBytes,
  readMarkup,
  type Markup,
  type Part,
  type Parts,
  type Shape,
} from './support/brand-files';

/** The scale every measure of a logo is taken at: the tile's side (R8). */
const S = 664;

/** `expect` that `value` is within `[low, high]`, naming what it is. */
function expectWithin(value: number, low: number, high: number, what: string): void {
  const message = `${what}: ${value.toFixed(3)}, holds when ${low.toFixed(3)} to ${high.toFixed(3)}`;
  expect(value, message).toBeGreaterThanOrEqual(low);
  expect(value, message).toBeLessThanOrEqual(high);
}

/** The check fails here, naming every file of `names` that does not exist, before anything is drawn. */
function expectAllExist(ctx: Ctx, names: string[], read: (name: string) => unknown): void {
  const missing = names.filter((name) => read(name) === null).map((name) => brandPath(ctx, name));
  ctx.log(missing.length > 0 ? `missing: ${missing.join(', ')}` : `read: ${names.join(', ')}`);
  expect(missing, 'brand files that do not exist').toEqual([]);
}

/** Each file's text. */
function readAll(ctx: Ctx, names: string[]): Map<string, string> {
  expectAllExist(ctx, names, (name) => readBrandFile(ctx, name));
  return new Map(names.map((name) => [name, readBrandFile(ctx, name) as string]));
}

/** Each file's bytes. */
function readAllBytes(ctx: Ctx, names: string[]): Map<string, Buffer> {
  expectAllExist(ctx, names, (name) => readBrandBytes(ctx, name));
  return new Map(names.map((name) => [name, readBrandBytes(ctx, name) as Buffer]));
}

type Tokens = Record<Scheme, Map<string, Rgb>>;

async function readTokens(page: Page, ctx: Ctx): Promise<Tokens> {
  return { light: await tokenColours(page, ctx, 'light'), dark: await tokenColours(page, ctx, 'dark') };
}

/** The colour of `name` in `scheme`, from `tokens.css` at run time. */
function tokenOf(tokens: Tokens, scheme: Scheme, name: string): Rgb {
  const colour = tokens[scheme].get(name);
  expect(colour, `the ${scheme} colour of the token --st-${name} in tokens.css`).toBeDefined();
  return colour as Rgb;
}

const byLeft = (a: { box: Box }, b: { box: Box }) => a.box.left - b.box.left;
const show = (b: Box | null) => (b ? `${b.left},${b.top} to ${b.right},${b.bottom}` : 'none');

// --- studio.brand-logos-hold-their-layout ------------------------------------------------------------------------

interface LogoFile {
  name: string;
  scheme: Scheme;
  primary: boolean;
}

const LOGOS: LogoFile[] = [
  { name: 'logo-compact-light.svg', scheme: 'light', primary: false },
  { name: 'logo-compact-dark.svg', scheme: 'dark', primary: false },
  { name: 'logo-primary-light.svg', scheme: 'light', primary: true },
  { name: 'logo-primary-dark.svg', scheme: 'dark', primary: true },
];

test('studio.brand-logos-hold-their-layout', async ({ ctx, page }) => {
  const files = readAll(
    ctx,
    LOGOS.map((f) => f.name),
  );
  const tokens = await readTokens(page, ctx);

  let primaryLight: { logo: Awaited<ReturnType<typeof drawLogo>>; letters: ReturnType<typeof lettersOf> } | null = null;
  for (const f of LOGOS) {
    const svg = files.get(f.name) as string;
    // R4's table: the tile `accent` with the symbol `accent-ink`; "EmuForge" `text`, "STUDIO" `accent`, each of the
    // file's ground (the dark logo's colours are the dark scheme's).
    const colours = { ground: tokenOf(tokens, f.scheme, 'accent'), symbol: tokenOf(tokens, f.scheme, 'accent-ink') };
    const wordColours = f.primary
      ? [tokenOf(tokens, f.scheme, 'text'), tokenOf(tokens, f.scheme, 'accent')]
      : [tokenOf(tokens, f.scheme, 'text')];
    const logo = await drawLogo(page, svg, colours, { side: S });
    const letters = lettersOf(logo, wordColours);
    const emuForge = regions(letters.words[0]!).sort(byLeft);
    const e = emuForge[0];
    const emuBox = inkBox(letters.words[0]!);
    ctx.log(
      `${f.name} at S ${S}: tile ${show(logo.tile)}, letters from x ${letters.left}, stray ${JSON.stringify(letters.stray)}, ` +
        `rows ${JSON.stringify(letters.rows)}, "EmuForge" ink ${show(emuBox)} in ${emuForge.length} pieces, "E" ${show(e?.box ?? null)}`,
    );

    // Draw each of the four logo files at `S` = 664 → from the left: the tile, a gap of 0.15 to 0.22, then the
    // letters; nothing else is painted.
    expect(letters.left, `${f.name}: something painted right of the tile`).toBeLessThan(logo.drawing.width);
    expectWithin(
      (letters.left - logo.tile.right) / S,
      0.15,
      0.22,
      `${f.name}: the gap between the tile and the letters`,
    );
    expect(letters.stray.count, `${f.name}: painted pixels that are neither the tile nor letters`).toBe(0);

    // The same drawings → "EmuForge"'s capital height is 0.33 to 0.41.
    expect(e, `${f.name}: the ink of "EmuForge"`).toBeDefined();
    const eBox = (e as Region).box;
    expectWithin((eBox.bottom - eBox.top) / S, 0.33, 0.41, `${f.name}: the capital height of "EmuForge" ("E")`);

    if (!f.primary) {
      // Draw the two compact logos → the middle of the capitals' height is at 0.45 to 0.55 from the tile's top, and
      // there is one line of letters.
      expectWithin(
        ((eBox.top + eBox.bottom) / 2 - logo.tile.top) / S,
        0.45,
        0.55,
        `${f.name}: the middle of the capitals' height from the tile's top`,
      );
      expect(letters.rows.length, `${f.name}: runs of rows holding letters (lines of letters)`).toBe(1);
      continue;
    }

    // Draw the two primary logos → "STUDIO"'s capital height is 0.15 to 0.21, its left edge is within 0.02 of
    // "EmuForge"'s, its width is 0.50 to 0.63 of "EmuForge"'s, the top of "E" is not above 0.10 and the bottom of
    // "STUDIO" not below 0.90.
    const studio = regions(letters.words[1]!).sort(byLeft);
    const studioBox = inkBox(letters.words[1]!);
    ctx.log(
      `${f.name}: "STUDIO" ink ${show(studioBox)} in ${studio.length} pieces: ${studio.map((r) => show(r.box)).join('; ')}`,
    );
    expect(studio.length, `${f.name}: separate letters of "STUDIO"`).toBeGreaterThanOrEqual(2);
    const t = studio[1]!.box;
    const sb = studioBox as Box;
    const eb = emuBox as Box;
    expectWithin((t.bottom - t.top) / S, 0.15, 0.21, `${f.name}: the capital height of "STUDIO" ("T")`);
    expectWithin(Math.abs(sb.left - eb.left) / S, 0, 0.02, `${f.name}: "STUDIO"'s left edge against "EmuForge"'s`);
    expectWithin(
      (sb.right - sb.left) / (eb.right - eb.left),
      0.5,
      0.63,
      `${f.name}: "STUDIO"'s width over "EmuForge"'s`,
    );
    expectWithin((eBox.top - logo.tile.top) / S, 0.1, 1, `${f.name}: the top of "E" from the tile's top`);
    expectWithin((sb.bottom - logo.tile.top) / S, 0, 0.9, `${f.name}: the bottom of "STUDIO" from the tile's top`);
    if (f.name === 'logo-primary-light.svg') primaryLight = { logo, letters };
  }

  // Draw "EmuForge" in Instrument Sans at weight 650 with -0.01em tracking, and "STUDIO" at weight 600, as live text
  // at the logo's size and place, over the drawn primary light logo → the letters' ink differs in at most 2% of its
  // pixels (the outlines are Studio's own face, not another).
  {
    const { logo, letters } = primaryLight as NonNullable<typeof primaryLight>;
    const capital = (mask: (typeof letters.words)[number], index: number) => regions(mask).sort(byLeft)[index]!.box;
    const fits = await fitLiveText(page, ctx, logo, files.get('logo-primary-light.svg') as string, [
      {
        text: 'EmuForge',
        colour: tokenOf(tokens, 'light', 'text'),
        weight: 650,
        tracking: -0.01,
        ink: letters.words[0]!,
        capital: { letter: 'E', box: capital(letters.words[0]!, 0) },
      },
      {
        text: 'STUDIO',
        colour: tokenOf(tokens, 'light', 'accent'),
        weight: 600,
        tracking: null,
        ink: letters.words[1]!,
        capital: { letter: 'T', box: capital(letters.words[1]!, 1) },
      },
    ]);
    ctx.log(`live text over logo-primary-light.svg: ${JSON.stringify(fits)}`);
    const ink = fits.reduce((n, f) => n + f.ink, 0);
    const differ = fits.reduce((n, f) => n + f.differ, 0);
    expect(
      differ / ink,
      `the share of the letters' ink that differs from live Instrument Sans: ${differ} of ${ink}`,
    ).toBeLessThanOrEqual(0.02);
  }

  // Draw a logo file in a browser context with no Instrument Sans available → the same pixels as with it (the file
  // needs no font). A file drawn as an image never sees a page's fonts, so each file is placed in a page as markup
  // (at the size of `S` = 664), once in a page that holds Studio's Instrument Sans and once in one that does not.
  const face = instrumentSans(ctx);
  for (const f of LOGOS) {
    const svg = files.get(f.name) as string;
    const vb = viewBoxOf(svg);
    expect(vb, `${f.name}: a viewBox`).not.toBeNull();
    const logo = await drawLogo(
      page,
      svg,
      { ground: tokenOf(tokens, f.scheme, 'accent'), symbol: tokenOf(tokens, f.scheme, 'accent-ink') },
      { side: S },
    );
    const size = { width: logo.place.w, height: logo.place.h };
    const withFace = await drawAsMarkup(page, svg, size, face);
    const withoutFace = await drawAsMarkup(page, svg, size, null);
    const differ = differingPixels(withFace.drawing, withoutFace.drawing);
    ctx.log(
      `${f.name} as markup at ${size.width.toFixed(1)} x ${size.height.toFixed(1)}: Instrument Sans drawn with ${String(withFace.instrumentSans)}, ` +
        `without ${String(withoutFace.instrumentSans)}; pixels that differ ${differ}`,
    );
    expect(withFace.instrumentSans, 'the page with the face draws text in Instrument Sans').toBe(true);
    expect(withoutFace.instrumentSans, 'the page without the face has no Instrument Sans').toBe(false);
    expect(differ, `${f.name}: pixels that differ with and without Instrument Sans`).toBe(0);
  }
});

// --- studio.brand-social-image-holds-its-layout -------------------------------------------------------------------

const SOCIAL = { width: 1200, height: 630 };
const GREEN: Rgb = [0, 255, 0];

/** The top of a part's pixels in column `x`, or `null` when it has none there. */
function topIn(p: Parts, part: Part, x: number): number | null {
  for (let y = part.box.top; y < part.box.bottom; y++) if (p.labels[y * p.width + x] === part.id) return y;
  return null;
}

/** `a`'s box is inside `b`'s. */
const within = (a: Box, b: Box, eps = 0) =>
  a.left >= b.left - eps && a.top >= b.top - eps && a.right <= b.right + eps && a.bottom <= b.bottom + eps;

test('studio.brand-social-image-holds-its-layout', async ({ ctx, page }) => {
  const files = readAll(ctx, ['social.svg', 'logo-primary-light.svg']);
  const png = readAllBytes(ctx, ['social-1200x630.png']).get('social-1200x630.png') as Buffer;
  const svg = files.get('social.svg') as string;
  const logoSvg = files.get('logo-primary-light.svg') as string;
  const tokens = await readTokens(page, ctx);
  const NAMES = ['bg', 'text', 'accent', 'accent-ink', 'accent-wash', 'surface', 'line-strong'] as const;
  const palette: Rgb[] = [...NAMES.map((n) => tokenOf(tokens, 'light', n)), tokenOf(tokens, 'dark', 'accent')];
  const at = (name: (typeof NAMES)[number] | 'accent-dark') =>
    name === 'accent-dark' ? NAMES.length : (NAMES as readonly string[]).indexOf(name);
  const { width: W, height: H } = SOCIAL;
  const half = W / 2;
  const whole = { x: 0, y: 0, w: W, h: H };

  // Draw `social.svg` at 1200 x 630 → every pixel is painted, and the ground is the `bg` token's colour.
  const d = await draw(page, svg, { width: W, height: H, ground: MAGENTA, ...whole });
  const onGreen = await draw(page, svg, { width: W, height: H, ground: GREEN, ...whole });
  const unpainted = differingPixels(d, onGreen);
  const counts = new Map<string, number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const key = pixel(d, x, y).join(' ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const [mostKey, most] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const ground = mostKey.split(' ').map(Number) as unknown as Rgb;
  ctx.log(
    `social.svg: pixels that show the canvas's ground ${unpainted}; most common colour ${mostKey} (${most} pixels)`,
  );
  expect(unpainted, 'pixels of social.svg that show the ground under it (not painted)').toBe(0);
  expect(channelDiff(ground, palette[at('bg')]!), `the ground ${mostKey} against the bg token`).toBeLessThanOrEqual(1);

  const labels = exactLabels(d, palette);
  const partsFor = (name: Parameters<typeof at>[0]) => partsOf(labelMask(d, labels, at(name)));
  const accentParts = partsFor('accent');
  const accent = accentParts.parts.filter((p) => p.size >= 20);
  const inkPieces = partsFor('accent-ink').parts;

  // The same drawing → the primary light logo is wholly in the left half; under it are two rows of text ink in the
  // `text` colour whose left edges are within 4 pixels of the tile's left edge.
  const isSquare = (b: Box, tolerance = 0.1) => {
    const w = b.right - b.left;
    const h = b.bottom - b.top;
    return Math.abs(w - h) <= tolerance * Math.max(w, h);
  };
  const logoTile = accent.filter((r) => r.box.right <= half && isSquare(r.box)).sort((a, b) => b.size - a.size)[0];
  expect(logoTile, "an accent square in the left half (the logo's tile)").toBeDefined();
  const lt = (logoTile as Part).box;
  const logoVb = viewBoxOf(logoSvg);
  expect(logoVb, 'logo-primary-light.svg: a viewBox').not.toBeNull();
  const lvb = logoVb as NonNullable<typeof logoVb>;
  const { found } = await drawTile(
    page,
    logoSvg,
    { ground: palette[at('accent')]!, symbol: palette[at('accent-ink')]! },
    { side: S },
  );
  const k = (lt.bottom - lt.top + 1) / found.height;
  const start = {
    x: lt.left - 0.5 - (found.x - lvb.x) * k,
    y: lt.top - 0.5 - (found.y - lvb.y) * k,
    w: lvb.width * k,
    h: lvb.height * k,
  };
  const fit = await fitOverDrawing(page, { svg, ...SOCIAL }, { svg: logoSvg, ground: palette[at('bg')]! }, start);
  const fk = fit.place.w / lvb.width;
  const tileLeft = fit.place.x + (found.x - lvb.x) * fk;
  ctx.log(
    `logo-primary-light.svg over social.svg: tile found at ${show(lt)}, fitted at ${JSON.stringify(fit.place)}, ` +
      `tile's left ${tileLeft.toFixed(2)}, painted ${show(fit.painted)}, mean difference ${fit.mean.toFixed(3)} over ${show(fit.box)}`,
  );
  expect(
    fit.mean,
    'mean difference per channel of logo-primary-light.svg over its place in social.svg',
  ).toBeLessThanOrEqual(2);
  const logoBox = fit.painted as Box;
  expect(logoBox.left >= 0 && logoBox.right <= half, `the logo ${show(logoBox)} is wholly in the left half`).toBe(true);

  const textInk = {
    width: W,
    height: H,
    bits: new Uint8Array(W * H),
  };
  for (let y = logoBox.bottom; y < H; y++) {
    for (let x = 0; x < half; x++) {
      const p = pixel(d, x, y);
      let best = 0;
      palette.forEach((c, i) => {
        const b = palette[best]!;
        if (
          (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 <
          (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2
        )
          best = i;
      });
      if (best === at('text')) textInk.bits[y * W + x] = 1;
    }
  }
  const rows: Box[] = [];
  for (let y = logoBox.bottom; y < H; y++) {
    const box = boxOf(textInk, { left: 0, top: y, right: half, bottom: y + 1 });
    const last = rows[rows.length - 1];
    if (box && last && last.bottom === y) {
      last.bottom = y + 1;
      last.left = Math.min(last.left, box.left);
      last.right = Math.max(last.right, box.right);
    } else if (box) rows.push(box);
  }
  ctx.log(`text rows under the logo: ${rows.map(show).join('; ')}`);
  expect(rows.length, 'rows of text ink in the text colour under the logo').toBe(2);
  for (const [i, row] of rows.entries()) {
    expectWithin(
      Math.abs(row.left - tileLeft),
      0,
      4,
      `row ${i + 1}'s left edge against the tile's left edge, in pixels`,
    );
  }

  // The same drawing → the right half holds the three windows, a tile with a code sign and three check marks, and
  // none of them crosses into the left half.
  const minPiece = (r: Part) => r.size >= 3;
  const piecesIn = (b: Box) => inkPieces.filter((p) => minPiece(p) && within(p.box, b));
  const filledShare = (r: Part) => {
    const enclosed = holes(partMask(accentParts, r.id), r.box).reduce((n, h) => n + h.size, 0);
    return (r.size + enclosed) / ((r.box.right - r.box.left) * (r.box.bottom - r.box.top));
  };
  // A tile with a code sign: an accent square holding the symbol (its largest piece of accent-ink, the neck reaching
  // the square's bottom edge) and three more.
  const reachesBottom = (piece: Part | undefined, r: Part) =>
    piece !== undefined && piece.box.bottom >= r.box.bottom - 2;
  const tiles = accent
    .filter((r) => r !== logoTile && isSquare(r.box))
    .map((r) => {
      const area = (r.box.right - r.box.left) * (r.box.bottom - r.box.top);
      const pieces = piecesIn(r.box)
        .filter((p) => p.size >= 0.002 * area)
        .sort((a, b) => b.size - a.size);
      return { r, symbol: pieces[0], code: pieces.slice(1) };
    })
    .filter((t) => reachesBottom(t.symbol, t.r) && t.code.length === 3);
  // Check marks: accent discs, each holding one piece of accent-ink (the tick) that stays inside it.
  const discs = accent
    .filter((r) => r !== logoTile && isSquare(r.box, 0.15) && filledShare(r) >= 0.7 && filledShare(r) <= 0.86)
    .map((r) => ({ r, ticks: piecesIn(r.box) }))
    .filter((c) => c.ticks.length === 1 && !reachesBottom(c.ticks[0], c.r));
  // The back window: three accent-ink dots in a row on one accent title bar, over an accent-wash body.
  const loose = inkPieces.filter(
    (p) =>
      minPiece(p) &&
      isSquare(p.box, 0.3) &&
      !tiles.some((t) => within(p.box, t.r.box)) &&
      !discs.some((c) => within(p.box, c.r.box)) &&
      !within(p.box, lt),
  );
  const dotRows = loose
    .map((a) =>
      loose.filter(
        (b) =>
          Math.abs((a.box.top + a.box.bottom) / 2 - (b.box.top + b.box.bottom) / 2) <= 2 &&
          Math.max(a.size, b.size) / Math.min(a.size, b.size) <= 1.5,
      ),
    )
    .filter((row) => row.length === 3);
  const dots = dotRows[0] ?? [];
  const bar = accent.find((r) => dots.length === 3 && dots.every((p) => within(p.box, r.box)));
  const bodyBelowBar = dots.map((p) => {
    const x = Math.floor((p.box.left + p.box.right) / 2);
    for (let y = p.box.bottom; y < H; y++) {
      const l = labels[y * W + x]!;
      if (l === -1 || l === at('accent') || l === at('accent-ink')) continue;
      return NAMES[l] ?? 'accent-dark';
    }
    return 'nothing';
  });
  // The middle window and the card: the surface around the tile, and around the discs.
  const surfaceParts = partsFor('surface');
  const surfaceLeftOf = (b: Box) => {
    const y = Math.floor((b.top + b.bottom) / 2);
    for (let x = b.left - 1; x >= 0; x--) {
      const l = labels[y * W + x]!;
      if (l === -1) continue;
      return l === at('surface') ? partAt(surfaceParts, x, y) : undefined;
    }
    return undefined;
  };
  const tile = tiles[0];
  const middle = tile ? surfaceLeftOf(tile.r.box) : undefined;
  const cards = discs.map((c) => surfaceLeftOf(c.r.box));
  ctx.log(
    `right half: tiles with a code sign ${JSON.stringify(tiles.map((t) => ({ tile: show(t.r.box), symbol: show(t.symbol?.box ?? null), code: t.code.map((c) => show(c.box)) })))}; ` +
      `discs with a tick ${JSON.stringify(discs.map((c) => ({ disc: show(c.r.box), share: Number(filledShare(c.r).toFixed(3)), tick: show(c.ticks[0]!.box) })))}; ` +
      `dots ${JSON.stringify(dots.map((p) => show(p.box)))} on bar ${show(bar?.box ?? null)}, under them ${JSON.stringify(bodyBelowBar)}; ` +
      `middle window ${show(middle?.box ?? null)}; card ${JSON.stringify(cards.map((c) => show(c?.box ?? null)))}`,
  );
  expect(tiles.length, 'accent squares holding a symbol and a code sign of three pieces').toBe(1);
  expect(discs.length, 'accent discs holding one tick each (check marks)').toBe(3);
  expect(dots.length, 'three accent-ink dots in a row (the back window title bar)').toBe(3);
  expect(bar, 'the accent title bar holding the three dots').toBeDefined();
  expect(bodyBelowBar, 'what is under the title bar at each dot: the back window body').toEqual([
    'accent-wash',
    'accent-wash',
    'accent-wash',
  ]);
  expect(middle, 'the surface of the window that holds the tile').toBeDefined();
  expect(
    cards.every((c) => c !== undefined && c === cards[0]),
    'the three discs are on one surface (the checklist card)',
  ).toBe(true);
  expect(cards[0] !== middle, 'the card and the middle window are two surfaces').toBe(true);
  const parts: [string, Box][] = [
    ['the title bar', (bar as Part).box],
    ...dots.map((p, i): [string, Box] => [`dot ${i + 1}`, p.box]),
    ['the tile with the code sign', (tile as NonNullable<typeof tile>).r.box],
    ['the middle window', (middle as Part).box],
    ['the checklist card', (cards[0] as Part).box],
    ...discs.map((c, i): [string, Box] => [`check mark ${i + 1}`, c.r.box]),
  ];
  expect(
    parts.filter(([, b]) => b.left < half).map(([name, b]) => `${name} ${show(b)}`),
    'parts of the illustration that cross into the left half',
  ).toEqual([]);
  // The left half holds the logo, the two rows and the bands alone: nothing of a window shows there.
  const allowed = [at('bg'), at('accent-wash'), at('accent-dark')];
  const exempt = [logoBox, ...rows].map((b) => ({
    left: b.left - 2,
    top: b.top - 2,
    right: b.right + 2,
    bottom: b.bottom + 2,
  }));
  const others: string[] = [];
  let otherCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < half; x++) {
      if (exempt.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom)) continue;
      const l = labels[y * W + x]!;
      if (allowed.includes(l)) continue;
      const p = pixel(d, x, y);
      const pairs: [number, number][] = [
        [at('bg'), at('accent-wash')],
        [at('bg'), at('accent-dark')],
        [at('accent-wash'), at('accent-dark')],
      ];
      if (l === -1 && pairs.some(([a, b]) => offBlend(p, palette[a]!, palette[b]!) <= 2)) continue;
      otherCount++;
      if (others.length < 5) others.push(`(${x},${y}) ${p.join(' ')}`);
    }
  }
  ctx.log(
    `left half, outside the logo and the rows: ${otherCount} pixels of neither the ground nor a band: ${others.join('; ')}`,
  );
  expect(otherCount, 'pixels in the left half that are not the logo, the rows, the ground or a band').toBe(0);

  // The same drawing → two bands, one in the `accent-wash` colour and one in the `accent-dark` colour, each touching
  // the bottom edge and rising to the right edge.
  // A band is every piece of its colour that reaches the bottom or the right edge: a window in front of it may cut it
  // in two, and the back window and the row bars reach neither edge.
  for (const name of ['accent-wash', 'accent-dark'] as const) {
    const bandParts = partsFor(name);
    const pieces = bandParts.parts.filter((r) => r.box.bottom === H || r.box.right === W);
    const atBottom = pieces.filter((r) => r.box.bottom === H);
    const atRight = pieces.filter((r) => r.box.right === W);
    const topAt = (x: number) =>
      pieces.reduce<number | null>((top, r) => {
        const y = x >= r.box.left && x < r.box.right ? topIn(bandParts, r, x) : null;
        return y === null ? top : top === null ? y : Math.min(top, y);
      }, null);
    const left = Math.min(...atBottom.map((r) => r.box.left));
    const rise = { left, atLeft: atBottom.length > 0 ? topAt(left) : null, atRight: topAt(W - 1) };
    ctx.log(
      `${name} band: pieces ${pieces.map((r) => show(r.box)).join('; ')}; its top at its left end and at the right edge ${JSON.stringify(rise)}`,
    );
    expect(
      { bottom: atBottom.length > 0, right: atRight.length > 0 },
      `the ${name} band touches the bottom edge and the right edge`,
    ).toEqual({ bottom: true, right: true });
    expect(
      rise.atRight !== null && rise.atLeft !== null && rise.atRight < rise.atLeft - 10,
      `the ${name} band rises from its left end (top ${String(rise.atLeft)}) to the right edge (top ${String(rise.atRight)})`,
    ).toBe(true);
  }

  // Compare `social-1200x630.png` with that drawing → the mean difference is at most 2 of 255 per channel.
  const raster = decodePng(png);
  expect({ width: raster.width, height: raster.height }, 'social-1200x630.png size').toEqual(SOCIAL);
  const diff = meanDifference(raster, await drawClear(page, svg, W, H));
  ctx.log(`social-1200x630.png against social.svg drawn: ${JSON.stringify(diff)}`);
  expect(diff.max, 'the largest per-channel mean difference of social-1200x630.png').toBeLessThanOrEqual(2);
});

// --- studio.brand-colours-are-studio-tokens -----------------------------------------------------------------------

const VECTOR_FILES = [
  'symbol.svg',
  'logo-primary-light.svg',
  'logo-primary-dark.svg',
  'logo-compact-light.svg',
  'logo-compact-dark.svg',
  'app-icon-teal.svg',
  'app-icon-cream.svg',
  'app-icon-night.svg',
  'app-icon-teal-square.svg',
  'social.svg',
  'favicon.svg',
];

type TokenKey = `${Scheme}:${string}`;
const key = (scheme: Scheme, name: string): TokenKey => `${scheme}:${name}`;

/** One paint of one element and the tokens R4's table allows for it (one, or the cream ground's two). */
interface Role {
  file: string;
  scheme: Scheme;
  part: string;
  where: string;
  property: 'fill' | 'stroke';
  value: string;
  expected: TokenKey[];
}

const paintsOf = (s: Shape): ['fill' | 'stroke', string][] =>
  (
    [
      ['fill', s.fill],
      ['stroke', s.stroke],
    ] as ['fill' | 'stroke', string][]
  ).filter(([, v]) => v !== 'none');

const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);

/**
 * Gives each painted shape of a file its part of R4's Colours table, from the shapes' places alone (no colour is
 * looked at): the bird is the path holding the tile path; its tile is the smallest square shape around the bird's
 * head, and the shapes inside that square are the tile's ground or, stroked and small, the code sign; letters are
 * right of a logo's tile, in one line or two; the social image's parts are told by what holds what. A shape no rule
 * places is returned with the part `unplaced` and no token, so the comparison reports it.
 */
function rolesOf(file: string, scheme: Scheme, markup: Markup, tilePath: string, vbox: Box): Role[] {
  const shapes = markup.shapes.filter((s) => paintsOf(s).length > 0);
  const extent = Math.max(vbox.right - vbox.left, vbox.bottom - vbox.top);
  const eps = extent * 0.005;
  const part = new Map<Shape, { part: string; expected: TokenKey[] }>();
  const set = (s: Shape, name: string, ...expected: TokenKey[]) => part.set(s, { part: name, expected });
  const free = () => shapes.filter((s) => !part.has(s));
  const square = (b: Box) => Math.abs(b.right - b.left - (b.bottom - b.top)) <= 0.02 * Math.max(b.right - b.left, 1e-9);
  const t = (name: string, s: Scheme = scheme) => key(s, name);

  /** The bird's tile: the ground shapes in its square and the code sign's strokes. */
  const tileOf = (bird: Shape) => {
    const b = bird.box;
    const sq = shapes
      .filter(
        (s) =>
          s !== bird &&
          square(s.box) &&
          s.box.left <= b.left + eps &&
          s.box.right >= b.right - eps &&
          s.box.top <= b.top + eps &&
          s.box.bottom > b.top,
      )
      .sort((x, y) => area(x.box) - area(y.box))[0];
    if (!sq) return null;
    const margin = 0.01 * (sq.box.right - sq.box.left);
    const inside = shapes.filter((s) => s !== bird && within(s.box, sq.box, margin));
    const code = inside.filter((s) => s.stroke !== 'none' && area(s.box) < 0.25 * area(sq.box));
    return { square: sq.box, grounds: inside.filter((s) => !code.includes(s)), code };
  };

  /** Letters right of a tile, split into lines at the largest gap between their middles. */
  const lines = (letters: Shape[], count: 1 | 2): Shape[][] => {
    if (count === 1 || letters.length < 2) return [letters];
    const mid = (s: Shape) => (s.box.top + s.box.bottom) / 2;
    const sorted = [...letters].sort((a, b) => mid(a) - mid(b));
    let cut = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (mid(sorted[i]!) - mid(sorted[i - 1]!) > mid(sorted[cut]!) - mid(sorted[cut - 1]!)) cut = i;
    }
    return [sorted.slice(0, cut), sorted.slice(cut)];
  };

  const birds = shapes.filter((s) => s.d === tilePath);
  const logoColours = (s: Scheme) => ({ ground: key(s, 'accent'), symbol: key(s, 'accent-ink') });

  if (file === 'symbol.svg') {
    for (const s of shapes) set(s, 'symbol', key('light', 'accent'));
  } else if (file.startsWith('logo-')) {
    const s = file.endsWith('-dark.svg') ? 'dark' : 'light';
    for (const bird of birds) {
      const tile = tileOf(bird);
      set(bird, 'symbol', logoColours(s).symbol);
      if (!tile) continue;
      for (const g of tile.grounds) set(g, 'tile', logoColours(s).ground);
      const letters = free().filter((x) => x.box.left >= tile.square.right - eps);
      const [emuForge, studio] = lines(letters, file.startsWith('logo-primary') ? 2 : 1);
      for (const x of emuForge ?? []) set(x, '"EmuForge"', key(s, 'text'));
      for (const x of studio ?? []) set(x, '"STUDIO"', key(s, 'accent'));
    }
  } else if (file.startsWith('app-icon-')) {
    const colours: Record<string, { ground: TokenKey[]; symbol: TokenKey }> = {
      teal: { ground: [key('light', 'accent')], symbol: key('light', 'accent-ink') },
      cream: { ground: [key('light', 'bg'), key('light', 'line')], symbol: key('light', 'accent') },
      night: { ground: [key('dark', 'accent-ink')], symbol: key('dark', 'accent') },
    };
    const c = colours[/^app-icon-(teal|cream|night)/.exec(file)![1]!]!;
    for (const bird of birds) {
      const tile = tileOf(bird);
      set(bird, 'symbol', c.symbol);
      if (!tile) continue;
      for (const g of tile.grounds) set(g, 'ground', ...c.ground);
      for (const x of tile.code) set(x, 'code sign', c.symbol);
    }
  } else if (file === 'favicon.svg') {
    for (const bird of birds) {
      const tile = tileOf(bird);
      set(bird, 'symbol', t('accent-ink'));
      for (const g of tile?.grounds ?? []) set(g, 'tile', t('accent'));
    }
  } else if (file === 'social.svg') {
    const L = key('light', 'accent');
    const mid = (vbox.left + vbox.right) / 2;
    const cx = (s: Shape) => (s.box.left + s.box.right) / 2;
    for (const s of shapes) if (within(vbox, s.box, eps)) set(s, 'ground', key('light', 'bg'));
    const bands = free().filter((s) => s.box.bottom >= vbox.bottom - eps && s.box.right >= vbox.right - eps);
    if (bands[0]) set(bands[0], 'far band', key('light', 'accent-wash'));
    if (bands[1]) set(bands[1], 'near band', key('dark', 'accent'));
    const tiles = birds.map((bird) => ({ bird, tile: tileOf(bird) }));
    let logoSquare: Box | null = null;
    let windowSquare: Shape | null = null;
    for (const { bird, tile } of tiles) {
      const left = cx(bird) < mid;
      set(bird, left ? 'logo symbol' : 'window tile symbol', key('light', 'accent-ink'));
      if (!tile) continue;
      for (const g of tile.grounds) set(g, left ? 'logo tile' : 'window tile', L);
      for (const x of tile.code) set(x, 'code sign', key('light', 'accent-ink'));
      if (left) logoSquare = tile.square;
      else windowSquare = tile.grounds.sort((a, b) => area(b.box) - area(a.box))[0] ?? null;
    }
    if (logoSquare) {
      const sq: Box = logoSquare;
      const letters = free().filter(
        (s) => s.box.left >= sq.right - eps && s.box.right <= mid && (s.box.top + s.box.bottom) / 2 < sq.bottom,
      );
      const [emuForge, studio] = lines(letters, 2);
      for (const x of emuForge ?? []) set(x, 'logo "EmuForge"', key('light', 'text'));
      for (const x of studio ?? []) set(x, 'logo "STUDIO"', L);
      for (const s of free())
        if (cx(s) < mid && s.box.top >= sq.bottom - eps) set(s, 'line of text', key('light', 'text'));
    }
    const right = () => free().filter((s) => cx(s) >= mid);
    const holds = (outer: Shape, inner: Shape) => inner.order > outer.order && within(inner.box, outer.box, eps);
    const smallestHolding = (inner: Shape[]) =>
      right()
        .filter((s) => inner.every((i) => holds(s, i)))
        .sort((a, b) => area(a.box) - area(b.box))[0];
    const sameBox = (a: Box, b: Box) =>
      Math.max(
        Math.abs(a.left - b.left),
        Math.abs(a.top - b.top),
        Math.abs(a.right - b.right),
        Math.abs(a.bottom - b.bottom),
      ) <= eps;
    // The checklist card: discs that each hold one shape (the tick), inside one surface with an edge and row bars.
    const discs = right().filter((s) => square(s.box) && right().filter((i) => holds(s, i)).length === 1);
    for (const disc of discs) {
      set(disc, 'check disc', L);
      for (const tick of right().filter((i) => holds(disc, i))) set(tick, 'tick', key('light', 'accent-ink'));
    }
    const card = discs.length > 0 ? smallestHolding(discs) : undefined;
    if (card) {
      set(card, 'card', key('light', 'surface'));
      for (const edge of right().filter((s) => holds(card, s) && sameBox(s.box, card.box)))
        set(edge, 'card edge', key('light', 'line-strong'));
      for (const bar of right().filter((s) => holds(card, s))) set(bar, 'row bar', key('light', 'accent-wash'));
    }
    // The back window: three dots in one title bar, inside a body.
    const leaves = right().filter((s) => square(s.box) && !right().some((i) => holds(s, i)));
    const bar = right()
      .filter((s) => leaves.filter((l) => holds(s, l)).length >= 3)
      .sort((a, b) => area(a.box) - area(b.box))[0];
    if (bar) {
      for (const dot of leaves.filter((l) => holds(bar, l))) set(dot, 'title bar dot', key('light', 'accent-ink'));
      set(bar, 'title bar', L);
      const body = smallestHolding([bar]);
      if (body) set(body, 'back window', key('light', 'accent-wash'));
    }
    // The middle window: the body under the window's tile, with an accent edge.
    if (windowSquare) {
      const body = right()
        .filter((s) => s.order < windowSquare.order && within(windowSquare.box, s.box, eps))
        .sort((a, b) => area(a.box) - area(b.box))[0];
      if (body) {
        set(body, 'middle window', key('light', 'surface'));
        for (const edge of right().filter((s) => holds(body, s) && sameBox(s.box, body.box)))
          set(edge, 'middle window edge', L);
      }
    }
  }

  const roles: Role[] = [];
  for (const s of shapes) {
    const p = part.get(s) ?? { part: 'unplaced', expected: [] };
    for (const [property, value] of paintsOf(s)) {
      let expected = p.expected;
      // A shape that is both filled and stroked: its stroke is the edge R4 names beside its body.
      if (property === 'stroke' && s.fill !== 'none') {
        const edges: Record<string, TokenKey[]> = {
          'middle window': [key('light', 'accent')],
          card: [key('light', 'line-strong')],
          ground: file === 'app-icon-cream.svg' ? [key('light', 'line')] : [],
        };
        expected = edges[p.part] ?? [];
      }
      roles.push({ file, scheme, part: p.part, where: s.where, property, value, expected });
    }
  }
  return roles;
}

/** The comparison: each role's paint against the tokens it may be, in `tokens`; which token each one matched. */
function compare(
  roles: Role[],
  colours: Map<string, readonly number[] | null>,
  tokens: Tokens,
): { mismatches: string[]; matched: (TokenKey | null)[] } {
  const mismatches: string[] = [];
  const matched = roles.map((r) => {
    const c = colours.get(r.value) ?? null;
    const hit =
      c && c[3] === 255
        ? (r.expected.find((k) => {
            const [scheme, name] = k.split(':') as [Scheme, string];
            const want = tokens[scheme].get(name);
            return want !== undefined && channelDiff([c[0]!, c[1]!, c[2]!], want) <= 1;
          }) ?? null)
        : null;
    if (!hit) {
      mismatches.push(
        `${r.file} (${r.scheme}) ${r.part} ${r.where} ${r.property} ${r.value} = ${c ? c.join(' ') : 'not a colour'}, ` +
          `R4 names ${r.expected.length > 0 ? r.expected.join(' or ') : 'nothing for it'}`,
      );
    }
    return hit;
  });
  return { mismatches, matched };
}

test('studio.brand-colours-are-studio-tokens', async ({ ctx, page }) => {
  const files = readAll(ctx, VECTOR_FILES);
  const tokens = await readTokens(page, ctx);
  ctx.log(
    `tokens: ${(['light', 'dark'] as const).map((s) => `${s} ${[...tokens[s]].map(([n, c]) => `${n} ${c.join(' ')}`).join(', ')}`).join(' | ')}`,
  );

  const readings: { file: string; scheme: Scheme; markup: Markup }[] = [];
  for (const file of VECTOR_FILES) {
    const svg = files.get(file) as string;
    for (const scheme of file === 'favicon.svg' ? (['light', 'dark'] as const) : (['light'] as const)) {
      readings.push({ file, scheme, markup: await readMarkup(page, svg, scheme) });
    }
  }
  // The tile path: the one path `d` every vector file but `symbol.svg` holds.
  const ds = VECTOR_FILES.filter((f) => f !== 'symbol.svg').map(
    (f) =>
      new Set(
        readings
          .find((r) => r.file === f)!
          .markup.shapes.map((s) => s.d)
          .filter((d): d is string => !!d),
      ),
  );
  const common = [...ds[0]!].filter((d) => ds.every((set) => set.has(d)));
  ctx.log(
    `path data common to every vector file but symbol.svg: ${common.length} (${common.map((d) => d.length).join(', ')} characters)`,
  );
  expect(common.length, 'the tile path: one path `d` held by every vector file but symbol.svg').toBe(1);
  const tilePath = common[0]!;

  const roles: Role[] = [];
  for (const r of readings) {
    const vb = viewBoxOf(files.get(r.file) as string);
    expect(vb, `${r.file}: a viewBox`).not.toBeNull();
    const v = vb as NonNullable<typeof vb>;
    roles.push(
      ...rolesOf(r.file, r.scheme, r.markup, tilePath, {
        left: v.x,
        top: v.y,
        right: v.x + v.width,
        bottom: v.y + v.height,
      }),
    );
  }
  const given = readings.flatMap((r) => r.markup.given.map((g) => ({ ...g, file: r.file })));
  const colours = await paintedColours(page, [...roles.map((r) => r.value), ...given.map((g) => g.value)]);
  for (const r of roles)
    ctx.log(`${r.file} (${r.scheme}) ${r.part}: ${r.where} ${r.property} ${r.value} → ${r.expected.join(' or ')}`);
  const { mismatches, matched } = compare(roles, colours, tokens);
  const isSocial = (m: string) => m.startsWith('social.svg ');
  const parts = (file: string) => new Set(roles.filter((r) => r.file === file).map((r) => r.part));

  // Read every `fill` and `stroke` of every vector file, and the colours of `favicon.svg`'s `style` → each is the
  // colour of the token R4's Colours table names for that element.
  const wanted: Record<string, string[]> = {
    'symbol.svg': ['symbol'],
    'logo-primary-light.svg': ['tile', 'symbol', '"EmuForge"', '"STUDIO"'],
    'logo-primary-dark.svg': ['tile', 'symbol', '"EmuForge"', '"STUDIO"'],
    'logo-compact-light.svg': ['tile', 'symbol', '"EmuForge"'],
    'logo-compact-dark.svg': ['tile', 'symbol', '"EmuForge"'],
    'app-icon-teal.svg': ['ground', 'symbol', 'code sign'],
    'app-icon-cream.svg': ['ground', 'symbol', 'code sign'],
    'app-icon-night.svg': ['ground', 'symbol', 'code sign'],
    'app-icon-teal-square.svg': ['ground', 'symbol', 'code sign'],
    'favicon.svg': ['tile', 'symbol'],
  };
  const absent = Object.entries(wanted).flatMap(([file, names]) =>
    names.filter((n) => !parts(file).has(n)).map((n) => `${file}: ${n}`),
  );
  const creamTokens = new Set(
    roles.map((r, i) => (r.file === 'app-icon-cream.svg' && r.part === 'ground' ? matched[i] : null)),
  );
  if (!creamTokens.has(key('light', 'line'))) absent.push('app-icon-cream.svg: the line edge');
  if (!creamTokens.has(key('light', 'bg'))) absent.push('app-icon-cream.svg: the bg ground');
  const faviconSchemes = new Set(roles.filter((r) => r.file === 'favicon.svg').map((r) => `${r.scheme} ${r.part}`));
  for (const s of ['light tile', 'light symbol', 'dark tile', 'dark symbol']) {
    if (!faviconSchemes.has(s)) absent.push(`favicon.svg: the ${s}`);
  }
  expect(absent, "parts of R4's Colours table the check does not find in their files").toEqual([]);
  expect(
    mismatches.filter((m) => !isSocial(m)),
    "paints that are not the colour of the token R4's Colours table names",
  ).toEqual([]);

  // The same reading over all vector files → no colour occurs that is not one of Studio's tokens' colours.
  const palette = [...tokens.light.values(), ...tokens.dark.values()];
  const foreign: string[] = [];
  const values = [
    ...given.map((g) => ({ at: `${g.file} ${g.where} ${g.property}`, value: g.value })),
    ...roles.map((r) => ({ at: `${r.file} (${r.scheme}) ${r.where} computed ${r.property}`, value: r.value })),
  ];
  for (const { at, value } of values) {
    if (/^(none|currentcolor|inherit|initial|unset|revert)$/i.test(value)) continue;
    const c = colours.get(value) ?? null;
    if (!c) {
      foreign.push(`${at}: ${value} is not a colour`);
      continue;
    }
    const rgb: Rgb = [c[0]!, c[1]!, c[2]!];
    if (c[3] !== 255 || !palette.some((p) => channelDiff(rgb, p) <= 1))
      foreign.push(`${at}: ${value} = ${c.join(' ')}`);
  }
  ctx.log(`colours given: ${given.length}, computed paints: ${roles.length}, not a token's: ${foreign.length}`);
  expect(foreign, "colours that are not one of Studio's tokens' colours").toEqual([]);

  // The same reading of `social.svg` → the line of text is `text`; the far band `accent-wash`, the near band
  // `accent-dark`; the back window `accent-wash` with an `accent` title bar and `accent-ink` dots; the middle window
  // `surface` with an `accent` edge; the checklist card `surface` with a `line-strong` edge, `accent` discs with
  // `accent-ink` ticks and `accent-wash` row bars.
  const social = parts('social.svg');
  const socialParts = [
    'ground',
    'logo tile',
    'logo symbol',
    'logo "EmuForge"',
    'logo "STUDIO"',
    'line of text',
    'far band',
    'near band',
    'back window',
    'title bar',
    'title bar dot',
    'middle window',
    'window tile',
    'window tile symbol',
    'code sign',
    'card',
    'check disc',
    'tick',
    'row bar',
  ];
  const count = (p: string) => roles.filter((r) => r.file === 'social.svg' && r.part === p).length;
  ctx.log(`social.svg parts: ${socialParts.map((p) => `${p} ${count(p)}`).join(', ')}`);
  expect(
    socialParts.filter((p) => !social.has(p)),
    'parts of the social image R4 names that the check does not find in social.svg',
  ).toEqual([]);
  const edges = roles.some(
    (r) =>
      r.file === 'social.svg' &&
      (r.part === 'middle window edge' || (r.part === 'middle window' && r.property === 'stroke')),
  );
  const cardEdges = roles.some(
    (r) => r.file === 'social.svg' && (r.part === 'card edge' || (r.part === 'card' && r.property === 'stroke')),
  );
  expect({ middleWindowEdge: edges, cardEdge: cardEdges }, 'the edges of the middle window and of the card').toEqual({
    middleWindowEdge: true,
    cardEdge: true,
  });
  expect(mismatches.filter(isSocial), 'paints of social.svg that are not the colour of the token R4 names').toEqual([]);

  // Change one token's value in a copy of the token list the check holds in memory → the comparison reports that
  // token's elements (the check reads the tokens from `tokens.css` at run time and holds no copy of a colour).
  const used = [...new Set(matched.filter((k): k is TokenKey => k !== null))];
  const wrong: string[] = [];
  for (const k of used) {
    const [scheme, name] = k.split(':') as [Scheme, string];
    const copy: Tokens = { light: new Map(tokens.light), dark: new Map(tokens.dark) };
    const was = copy[scheme].get(name) as Rgb;
    copy[scheme].set(name, [(was[0] + 128) % 256, (was[1] + 64) % 256, (was[2] + 32) % 256]);
    const after = compare(roles, colours, copy);
    const expectedNow = new Set(roles.map((_, i) => i).filter((i) => matched[i] === k || matched[i] === null));
    const reportedNow = new Set(roles.map((_, i) => i).filter((i) => after.matched[i] === null));
    const same = expectedNow.size === reportedNow.size && [...expectedNow].every((i) => reportedNow.has(i));
    ctx.log(`token ${k} changed: ${reportedNow.size} paints reported, ${expectedNow.size} expected`);
    if (!same) wrong.push(`${k}: reported ${reportedNow.size}, its elements and the earlier ones ${expectedNow.size}`);
  }
  expect(used.length, 'tokens the comparison matched').toBeGreaterThan(0);
  expect(wrong, "tokens whose change in the check's copy is not reported as that token's elements").toEqual([]);
});

// --- studio.brand-rasters-are-their-vectors-drawn -----------------------------------------------------------------

test('studio.brand-rasters-are-their-vectors-drawn', async ({ ctx, page }) => {
  const GROUNDS = ['teal', 'cream', 'night'] as const;
  const svgs = readAll(ctx, [...GROUNDS.map((g) => `app-icon-${g}.svg`), 'app-icon-teal-square.svg', 'favicon.svg']);
  const rasters = readAllBytes(ctx, [
    ...GROUNDS.flatMap((g) => [`app-icon-${g}-192.png`, `app-icon-${g}-512.png`]),
    'apple-touch-icon.png',
    'favicon.ico',
  ]);
  const tokens = await readTokens(page, ctx);

  // Draw each `app-icon-<ground>.svg` at 192 and at 512 and compare with its `.png` → the mean difference is at most
  // 2 of 255 per channel, alpha included; the PNG's four corners are fully transparent.
  for (const g of GROUNDS) {
    for (const n of [192, 512]) {
      const name = `app-icon-${g}-${n}.png`;
      const png = decodePng(rasters.get(name) as Buffer);
      expect({ width: png.width, height: png.height }, `${name} size`).toEqual({ width: n, height: n });
      const diff = meanDifference(png, await drawClear(page, svgs.get(`app-icon-${g}.svg`) as string, n, n));
      const corners = [alphaAt(png, 0, 0), alphaAt(png, n - 1, 0), alphaAt(png, 0, n - 1), alphaAt(png, n - 1, n - 1)];
      ctx.log(
        `${name} against app-icon-${g}.svg drawn at ${n}: ${JSON.stringify(diff)}, corner alphas ${corners.join(' ')}`,
      );
      expect(diff.max, `${name}: the largest per-channel mean difference`).toBeLessThanOrEqual(2);
      expect(corners, `${name}: the alpha of its four corners`).toEqual([0, 0, 0, 0]);
    }
  }

  // Draw `app-icon-teal-square.svg` at 180 and compare with `apple-touch-icon.png` → at most 2 of 255 per channel on
  // average; no pixel of the PNG is transparent.
  {
    const png = decodePng(rasters.get('apple-touch-icon.png') as Buffer);
    expect({ width: png.width, height: png.height }, 'apple-touch-icon.png size').toEqual({ width: 180, height: 180 });
    const diff = meanDifference(png, await drawClear(page, svgs.get('app-icon-teal-square.svg') as string, 180, 180));
    let transparent = 0;
    for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) transparent++;
    ctx.log(
      `apple-touch-icon.png against app-icon-teal-square.svg drawn at 180: ${JSON.stringify(diff)}, pixels not opaque ${transparent}`,
    );
    expect(diff.max, 'apple-touch-icon.png: the largest per-channel mean difference').toBeLessThanOrEqual(2);
    expect(transparent, 'apple-touch-icon.png: pixels that are not fully opaque').toBe(0);
  }

  // Draw `favicon.svg` in the light scheme at 16, 32 and 48 and compare with the entries of `favicon.ico` → at most 2
  // of 255 per channel on average for each entry.
  await page.emulateMedia({ colorScheme: 'light' });
  const favicon = svgs.get('favicon.svg') as string;
  const entries = decodeIco(rasters.get('favicon.ico') as Buffer);
  ctx.log(
    `favicon.ico entries: ${entries.map((e) => `${e.width} x ${e.height} ${e.format} (${e.image.width} x ${e.image.height})`).join(', ')}`,
  );
  const entry = (n: number) => {
    const found = entries.filter((e) => e.image.width === n && e.image.height === n);
    expect(found.length, `favicon.ico entries of ${n} x ${n}`).toBe(1);
    return found[0]!.image;
  };
  for (const n of [16, 32, 48]) {
    const diff = meanDifference(entry(n), await drawClear(page, favicon, n, n));
    ctx.log(`favicon.ico ${n} against favicon.svg drawn at ${n}: ${JSON.stringify(diff)}`);
    expect(diff.max, `favicon.ico ${n}: the largest per-channel mean difference`).toBeLessThanOrEqual(2);
  }

  // Where the tile, the crest and the eye are, from favicon.svg drawn at S = 664, as pixels of an entry of `n`.
  const ground = tokenOf(tokens, 'light', 'accent');
  const symbol = tokenOf(tokens, 'light', 'accent-ink');
  const tile = await drawTile(page, favicon, { ground, symbol }, { side: S });
  const m = measureTile(tile, { ground, symbol });
  ctx.log(
    `favicon.svg at S ${S}: square ${JSON.stringify(tile.found)} (file units), crest top ${m.crestTop.toFixed(3)}, holes ${JSON.stringify(m.holes)}`,
  );
  expect(m.holes.length, 'favicon.svg at S 664: holes in the symbol (the eye)').toBe(1);
  const vb = viewBoxOf(favicon) as NonNullable<ReturnType<typeof viewBoxOf>>;
  const toPx = (n: number, shareX: number, shareY: number) => ({
    x: ((tile.found.x - vb.x + shareX * tile.found.width) / vb.width) * n,
    y: ((tile.found.y - vb.y + shareY * tile.found.height) / vb.height) * n,
  });
  const eyeBox = (n: number): Box => {
    const e = m.holes[0]!.box;
    const a = toPx(n, e.left, e.top);
    const b = toPx(n, e.right, e.bottom);
    return { left: Math.floor(a.x), top: Math.floor(a.y), right: Math.ceil(b.x), bottom: Math.ceil(b.y) };
  };
  /** How far a pixel is from the symbol's colour toward the ground's: 0 the symbol, 1 the ground. */
  const towardGround = (p: Rgb) => {
    const dir = [ground[0] - symbol[0], ground[1] - symbol[1], ground[2] - symbol[2]];
    const len2 = dir[0]! ** 2 + dir[1]! ** 2 + dir[2]! ** 2;
    return ((p[0] - symbol[0]) * dir[0]! + (p[1] - symbol[1]) * dir[1]! + (p[2] - symbol[2]) * dir[2]!) / len2;
  };
  const nearer = (p: Rgb, a: Rgb, b: Rgb) =>
    (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2 <
    (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2 + (p[2] - b[2]) ** 2;

  // Read `favicon.ico`'s 32-pixel entry → inside the eye's box at least one pixel is nearer the ground's colour than
  // the symbol's.
  {
    const e32 = entry(32);
    const box = eyeBox(32);
    const inside: string[] = [];
    let groundLike = 0;
    for (let y = box.top; y < box.bottom; y++) {
      for (let x = box.left; x < box.right; x++) {
        const p = pixel(e32, x, y);
        inside.push(p.join(' '));
        if (nearer(p, ground, symbol)) groundLike++;
      }
    }
    ctx.log(`favicon.ico 32, eye box ${show(box)}: ${inside.join(', ')}`);
    expect(groundLike, "favicon.ico 32: pixels in the eye's box nearer the ground than the symbol").toBeGreaterThan(0);
  }

  // Read `favicon.ico`'s 16-pixel entry → the tile's ground is the `accent` colour, the symbol's ink is present from
  // the crest to the bottom edge, and inside the eye's box the pixel most like the ground is at least a quarter of
  // the way from the symbol's colour to the ground's.
  {
    const e16 = entry(16);
    // The tile's ground: the pixels whose whole area is the ground in favicon.svg drawn 16 times larger.
    const fine = await drawClear(page, favicon, 256, 256);
    const groundCells: string[] = [];
    let cells = 0;
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        let pure = true;
        for (let y = j * 16; y < (j + 1) * 16 && pure; y++) {
          for (let x = i * 16; x < (i + 1) * 16 && pure; x++) {
            pure = alphaAt(fine, x, y) === 255 && channelDiff(pixel(fine, x, y), ground) <= 1;
          }
        }
        if (!pure) continue;
        cells++;
        const p = pixel(e16, i, j);
        if (alphaAt(e16, i, j) !== 255 || channelDiff(p, ground) > 1)
          groundCells.push(`(${i},${j}) ${p.join(' ')} a ${alphaAt(e16, i, j)}`);
      }
    }
    ctx.log(
      `favicon.ico 16: ${cells} pixels wholly ground in the vector; not the accent colour: ${groundCells.join('; ')}`,
    );
    expect(cells, 'favicon.ico 16: pixels wholly the tile ground in the vector').toBeGreaterThan(0);
    expect(groundCells, "favicon.ico 16: pixels of the tile's ground that are not the accent colour").toEqual([]);

    const crestRow = Math.ceil(toPx(16, 0, m.crestTop).y);
    const bottomRow = Math.ceil(toPx(16, 0, 1).y) - 1;
    const inkRows: number[] = [];
    for (let y = 0; y < 16; y++) {
      let any = false;
      for (let x = 0; x < 16 && !any; x++) any = alphaAt(e16, x, y) > 0 && nearer(pixel(e16, x, y), symbol, ground);
      if (any) inkRows.push(y);
    }
    ctx.log(
      `favicon.ico 16: rows with symbol ink ${inkRows.join(' ')}; the crest's row ${crestRow}, the bottom row ${bottomRow}`,
    );
    const first = inkRows[0] ?? 16;
    const gaps: number[] = [];
    for (let y = first; y <= bottomRow; y++) if (!inkRows.includes(y)) gaps.push(y);
    expect(first, "favicon.ico 16: the first row with symbol ink, not below the crest's").toBeLessThanOrEqual(crestRow);
    expect(gaps, 'favicon.ico 16: rows from the crest to the bottom edge without symbol ink').toEqual([]);

    const box = eyeBox(16);
    let most = -Infinity;
    for (let y = box.top; y < box.bottom; y++) {
      for (let x = box.left; x < box.right; x++) most = Math.max(most, towardGround(pixel(e16, x, y)));
    }
    ctx.log(
      `favicon.ico 16, eye box ${show(box)}: the most ground-like pixel is ${most.toFixed(3)} of the way to the ground`,
    );
    expect(
      most,
      "favicon.ico 16: the eye's most ground-like pixel, from the symbol (0) to the ground (1)",
    ).toBeGreaterThanOrEqual(0.25);
  }
});
