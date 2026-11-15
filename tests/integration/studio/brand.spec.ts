// The symbol, the tile and the app icons drawn and measured (test-criteria.md, issue 36, Flow):
//
// - `studio.brand-symbol-holds-the-reference-numbers`: `symbol.svg` holds the numbers measured from the owner's
//   sheet (requirement R8.1) and paints only its ink, in the `accent` colour;
// - `studio.brand-tile-and-app-icons-hold-their-layout`: the tile of the favicon, of the logos and of the app icons
//   holds R8.2's layout, and the app icons R8.4's code sign and their grounds.
//
// The files are read from the checkout (`studio/brand/`, `studio/public/`) and drawn by the check's own Chromium
// (`support/brand.ts`); no Studio server, engine or emulator is needed to observe them. The reference numbers are
// R8.1's, written here; the sheet is not read.

import type { Page } from '@playwright/test';

import {
  brandPath,
  compareGrids,
  core,
  cornersOff,
  drawSymbol,
  drawTile,
  edgeLineOff,
  expect,
  holes,
  MAGENTA,
  measureSymbol,
  measureTile,
  offBlend,
  offColour,
  onTile,
  pixel,
  readBrandFile,
  test,
  tokenColours,
  viewBoxOf,
  WHITE,
  type Ctx,
  type Drawing,
  type Rgb,
  type Scheme,
  type TileColours,
} from './support';

/** R8.1, the sheet's symbol: the coverage grid of its ink box, 8 x 8, row by row. */
const REFERENCE_GRID = [
  [0.0, 0.0, 0.23, 0.58, 0.64, 0.18, 0.0, 0.0],
  [0.0, 0.01, 0.51, 1.0, 0.94, 0.77, 0.04, 0.0],
  [0.0, 0.11, 0.85, 1.0, 0.8, 0.69, 0.9, 0.42],
  [0.0, 0.17, 1.0, 0.99, 0.67, 0.38, 0.29, 0.29],
  [0.0, 0.5, 1.0, 0.43, 0.0, 0.0, 0.0, 0.0],
  [0.0, 0.77, 1.0, 0.13, 0.0, 0.0, 0.0, 0.0],
  [0.11, 0.99, 0.96, 0.01, 0.0, 0.0, 0.0, 0.0],
  [0.59, 0.94, 0.7, 0.0, 0.0, 0.0, 0.0, 0.0],
];

/** R8.1, the sheet's eye box as shares of the ink box. */
const REFERENCE_EYE = { left: 0.572, top: 0.22, right: 0.705, bottom: 0.326 };

/** The scale every measure is taken at: the ink box's width for the symbol, the tile's side for the rest (R8). */
const S = 664;

/** `expect` that `value` is within `[low, high]`, naming what it is. */
function expectWithin(value: number, low: number, high: number, what: string): void {
  const message = `${what}: ${value.toFixed(3)}, holds when ${low.toFixed(3)} to ${high.toFixed(3)}`;
  expect(value, message).toBeGreaterThanOrEqual(low);
  expect(value, message).toBeLessThanOrEqual(high);
}

/** The file's text; the check fails here, naming every file that does not exist, before anything is drawn. */
function readAll(ctx: Ctx, names: string[]): Map<string, string> {
  const files = new Map<string, string>();
  const missing: string[] = [];
  for (const name of names) {
    const text = readBrandFile(ctx, name);
    if (text === null) missing.push(brandPath(ctx, name));
    else files.set(name, text);
  }
  ctx.log(missing.length > 0 ? `missing: ${missing.join(', ')}` : `read: ${names.join(', ')}`);
  expect(missing, 'brand files that do not exist').toEqual([]);
  return files;
}

/** The colour of `name` in `scheme`, from `tokens.css` at run time. */
async function tokens(page: Page, ctx: Ctx): Promise<(scheme: Scheme, name: string) => Rgb> {
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

/** How a symbol drawing is painted: every pixel a blend of the ground and the ink, inner pixels exactly one of them. */
function paintOf(d: Drawing, ink: Rgb, ground: Rgb) {
  const m = measureSymbol(d, ink, ground);
  let notABlend = 0;
  for (let y = 0; y < d.height; y++)
    for (let x = 0; x < d.width; x++) if (offBlend(pixel(d, x, y), ground, ink) > 2) notABlend++;
  const notInk = {
    width: m.ink.width,
    height: m.ink.height,
    bits: m.ink.bits.map((b) => (b ? 0 : 1)),
  };
  const eyes = holes(m.ink);
  return {
    notABlend,
    innerInkOff: offColour(d, core(m.ink), ink),
    innerGroundOff: offColour(d, core(notInk), ground),
    eyeOff: eyes.reduce((n, eye) => n + offColour(d, core(eye.mask), ground), 0),
    eyes: eyes.length,
  };
}

test('studio.brand-symbol-holds-the-reference-numbers', async ({ ctx, page }) => {
  const svg = readAll(ctx, ['symbol.svg']).get('symbol.svg') as string;
  const colour = await tokens(page, ctx);
  const accent = colour('light', 'accent');

  // Draw `symbol.svg` at an ink box 664 wide on white → the ink box's width : height is 1.12 to 1.24 and the ink
  // covers 0.30 to 0.38 of the box.
  const drawing = await drawSymbol(page, svg, {
    inkWidth: S,
    ink: accent,
    ground: WHITE,
  });
  const m = measureSymbol(drawing, accent, WHITE);
  ctx.log(
    `symbol on white: ink box ${JSON.stringify(m.box)}, ratio ${m.ratio.toFixed(3)}, ink share ${m.inkShare.toFixed(3)}, ` +
      `holes ${JSON.stringify(m.holes.map((h) => ({ box: h.box, areaShare: h.areaShare })))}, beak tip ${m.beakTip.toFixed(3)}`,
  );
  ctx.log(`symbol grid: ${JSON.stringify(m.grid.map((row) => row.map((c) => Number(c.toFixed(2)))))}`);
  expectWithin(m.box.right - m.box.left, S - 2, S + 2, 'the ink box width in pixels');
  expectWithin(m.ratio, 1.12, 1.24, "the ink box's width : height");
  expectWithin(m.inkShare, 0.3, 0.38, 'the ink share of the ink box');

  // The same drawing → exactly one hole in the ink (the eye); its box is within 0.05 of left 0.572, top 0.220, right
  // 0.705, bottom 0.326, and its area is 0.015 to 0.045 of the ink.
  expect(m.holes.length, 'holes in the ink').toBe(1);
  const eye = m.holes[0]!;
  for (const side of ['left', 'top', 'right', 'bottom'] as const) {
    expectWithin(eye.box[side], REFERENCE_EYE[side] - 0.05, REFERENCE_EYE[side] + 0.05, `the eye box's ${side}`);
  }
  expectWithin(eye.areaShare, 0.015, 0.045, "the eye's area, share of the ink");

  // The same drawing → the rightmost ink (the beak's tip) is at 0.33 to 0.44 of the box's height.
  expectWithin(m.beakTip, 0.33, 0.44, "the height of the rightmost ink, share of the box's height");

  // The same drawing, the 8 x 8 coverage grid against R8.1's grid → mean absolute difference at most 0.05 and no
  // cell more than 0.20.
  const grid = compareGrids(m.grid, REFERENCE_GRID);
  ctx.log(`grid against R8.1: mean ${grid.mean.toFixed(4)}, largest cell ${grid.max.toFixed(4)}`);
  expect(grid.mean, `the grid's mean absolute difference: ${grid.mean.toFixed(4)}`).toBeLessThanOrEqual(0.05);
  expect(grid.max, `the grid's largest cell difference: ${grid.max.toFixed(4)}`).toBeLessThanOrEqual(0.2);

  // The same drawing mirrored left to right, measured the same way → the grid comparison fails (the check refuses
  // another bird, so it is not passing by its tolerance alone).
  const mirrored = measureSymbol(
    await drawSymbol(page, svg, {
      inkWidth: S,
      ink: accent,
      ground: WHITE,
      mirror: true,
    }),
    accent,
    WHITE,
  );
  const other = compareGrids(mirrored.grid, REFERENCE_GRID);
  ctx.log(`mirrored grid against R8.1: mean ${other.mean.toFixed(4)}, largest cell ${other.max.toFixed(4)}`);
  expect(
    other.mean > 0.05 || other.max > 0.2,
    `the mirrored drawing fails the grid comparison (mean ${other.mean.toFixed(4)}, largest ${other.max.toFixed(4)})`,
  ).toBe(true);

  // Draw `symbol.svg` on white and on the `bg` token's colour → all ink is the `accent` token's colour and the rest
  // is the ground: the file paints no ground of its own and the eye shows the ground.
  for (const [name, ground] of [
    ['white', WHITE],
    ['bg', colour('light', 'bg')],
  ] as const) {
    const on = await drawSymbol(page, svg, {
      inkWidth: S,
      ink: accent,
      ground,
    });
    const paint = paintOf(on, accent, ground);
    ctx.log(`symbol on ${name} (${ground.join(' ')}), accent ${accent.join(' ')}: ${JSON.stringify(paint)}`);
    expect(paint, `symbol.svg drawn on ${name}: pixels off the accent and the ground`).toEqual({
      notABlend: 0,
      innerInkOff: 0,
      innerGroundOff: 0,
      eyeOff: 0,
      eyes: 1,
    });
  }
});

/** A file whose tile is measured, with the colours R4's table gives its square and its symbol. */
interface TileFile {
  name: string;
  ground: [Scheme, string];
  symbol: [Scheme, string];
}

const FAVICON: TileFile = {
  name: 'favicon.svg',
  ground: ['light', 'accent'],
  symbol: ['light', 'accent-ink'],
};
const LOGOS: TileFile[] = [
  {
    name: 'logo-compact-light.svg',
    ground: ['light', 'accent'],
    symbol: ['light', 'accent-ink'],
  },
  {
    name: 'logo-compact-dark.svg',
    ground: ['dark', 'accent'],
    symbol: ['dark', 'accent-ink'],
  },
  {
    name: 'logo-primary-light.svg',
    ground: ['light', 'accent'],
    symbol: ['light', 'accent-ink'],
  },
  {
    name: 'logo-primary-dark.svg',
    ground: ['dark', 'accent'],
    symbol: ['dark', 'accent-ink'],
  },
];
const APP_ICONS: TileFile[] = [
  {
    name: 'app-icon-teal.svg',
    ground: ['light', 'accent'],
    symbol: ['light', 'accent-ink'],
  },
  {
    name: 'app-icon-cream.svg',
    ground: ['light', 'bg'],
    symbol: ['light', 'accent'],
  },
  {
    name: 'app-icon-night.svg',
    ground: ['dark', 'accent-ink'],
    symbol: ['dark', 'accent'],
  },
];
const SQUARE: TileFile = {
  name: 'app-icon-teal-square.svg',
  ground: ['light', 'accent'],
  symbol: ['light', 'accent-ink'],
};

/** R8.4: where the code sign's box may be, as shares of `S`; the widest of the four ranges. */
const CODE_BOX = { left: 0.46, top: 0.52, right: 0.92, bottom: 0.84 };

test('studio.brand-tile-and-app-icons-hold-their-layout', async ({ ctx, page }) => {
  const all = [FAVICON, ...LOGOS, ...APP_ICONS, SQUARE];
  const files = readAll(
    ctx,
    all.map((f) => f.name),
  );
  const colour = await tokens(page, ctx);
  const coloursOf = (f: TileFile): TileColours => ({
    ground: colour(...f.ground),
    symbol: colour(...f.symbol),
  });
  // `favicon.svg` follows the scheme; it is drawn in the light one.
  await page.emulateMedia({ colorScheme: 'light' });

  const tileOf = async (f: TileFile, side = S) => {
    const colours = coloursOf(f);
    const t = await drawTile(page, files.get(f.name) as string, colours, {
      side,
    });
    const m = measureTile(t, colours);
    ctx.log(
      `${f.name} at S ${String(side)}: square found at ${JSON.stringify(t.found)} (file units); radius ${m.radius.toFixed(3)}, ` +
        `crest top ${m.crestTop.toFixed(3)}, beak tip ${m.beakTip.toFixed(3)}, on edge ${JSON.stringify(m.onEdge)}, ` +
        `holes ${JSON.stringify(m.holes)}, other pieces ${JSON.stringify(m.others)}`,
    );
    return { t, m, colours };
  };

  // Draw `favicon.svg` (light scheme), `logo-compact-light.svg`'s tile and each `app-icon-<ground>.svg` at `S` =
  // 664 → the square's corner radius is 0.19 to 0.25, the crest's top is at 0.13 to 0.19 and the beak's tip at 0.83
  // to 0.89 from the left.
  // The same drawings → the symbol's ink touches the square's bottom edge and no other edge.
  // The same drawings → the symbol has exactly one hole (the eye), and the eye shows the tile's ground colour.
  for (const f of [FAVICON, LOGOS[0]!, ...APP_ICONS]) {
    const { m } = await tileOf(f);
    expectWithin(m.radius, 0.19, 0.25, `${f.name}: the square's corner radius, share of S`);
    expectWithin(m.crestTop, 0.13, 0.19, `${f.name}: the crest's top, share of S`);
    expectWithin(m.beakTip, 0.83, 0.89, `${f.name}: the beak's tip from the left, share of S`);
    expect(m.onEdge.bottom, `${f.name}: symbol ink on the square's bottom edge`).toBeGreaterThan(0);
    expect(
      { top: m.onEdge.top, left: m.onEdge.left, right: m.onEdge.right },
      `${f.name}: symbol ink on the square's top, left and right edges`,
    ).toEqual({ top: 0, left: 0, right: 0 });
    expect(m.holes.length, `${f.name}: holes in the symbol`).toBe(1);
    expect(m.holes[0]!.offGround, `${f.name}: pixels inside the eye that are not the tile's ground`).toBe(0);
  }

  // Draw each `app-icon-<ground>.svg` at `S` = 664 → the code sign's box has its left at 0.46 to 0.56, top at 0.52
  // to 0.62, right at 0.82 to 0.92, bottom at 0.74 to 0.84; it is three separate pieces of ink, and none touches the
  // symbol's ink.
  for (const f of APP_ICONS) {
    const { m } = await tileOf(f);
    expect(m.others.length, `${f.name}: pieces of ink apart from the symbol (the code sign's strokes)`).toBe(3);
    const box = {
      left: Math.min(...m.others.map((o) => o.box.left)),
      top: Math.min(...m.others.map((o) => o.box.top)),
      right: Math.max(...m.others.map((o) => o.box.right)),
      bottom: Math.max(...m.others.map((o) => o.box.bottom)),
    };
    ctx.log(`${f.name}: code sign box ${JSON.stringify(box)}`);
    expectWithin(box.left, 0.46, 0.56, `${f.name}: the code sign's left`);
    expectWithin(box.top, 0.52, 0.62, `${f.name}: the code sign's top`);
    expectWithin(box.right, 0.82, 0.92, `${f.name}: the code sign's right`);
    expectWithin(box.bottom, 0.74, 0.84, `${f.name}: the code sign's bottom`);
  }

  // Draw `favicon.svg` and the logos' tiles → no ink in the code sign's box other than the symbol's: no code sign.
  for (const f of [FAVICON, ...LOGOS]) {
    const { t, m } = await tileOf(f);
    const box = onTile(t, CODE_BOX);
    let stray = 0;
    for (let y = box.top; y < box.bottom; y++) {
      for (let x = box.left; x < box.right; x++) {
        const i = y * t.drawing.width + x;
        if (m.ink.bits[i] && !m.symbol.bits[i]) stray++;
      }
    }
    expect(stray, `${f.name}: ink in the code sign's box that is not the symbol's`).toBe(0);
  }

  // Draw `app-icon-teal.svg`, `-cream.svg`, `-night.svg` on a magenta ground → the four corners outside the rounded
  // square show the magenta ground; draw `app-icon-teal-square.svg` → every pixel is painted, the corners in the
  // `accent` colour.
  for (const f of APP_ICONS) {
    const { t } = await tileOf(f);
    expect(cornersOff(t, MAGENTA, 0.05), `${f.name}: pixels of the corners outside the square not magenta`).toBe(0);
  }
  {
    // Painted: a pixel is the square's ground, the symbol's colour or a blend of the two, with none of the magenta
    // showing through; and the square is the whole file.
    const { t, colours } = await tileOf(SQUARE);
    const vb = viewBoxOf(files.get(SQUARE.name) as string);
    expect(t.found, `${SQUARE.name}: the painted square is the whole viewBox`).toEqual(vb);
    let unpainted = 0;
    for (let y = t.tile.top; y < t.tile.bottom; y++) {
      for (let x = t.tile.left; x < t.tile.right; x++) {
        if (offBlend(pixel(t.drawing, x, y), colours.ground, colours.symbol) > 2) unpainted++;
      }
    }
    expect(unpainted, `${SQUARE.name}: pixels of the square that show the magenta ground`).toBe(0);
    expect(cornersOff(t, colour('light', 'accent'), 0.05), `${SQUARE.name}: corner pixels not the accent colour`).toBe(
      0,
    );
  }

  // Draw `app-icon-cream.svg` at 512 → its edge is a line 1 pixel wide in the `line` token's colour, inside the
  // square.
  {
    const cream = APP_ICONS[1]!;
    const { t, colours } = await tileOf(cream, 512);
    const off = edgeLineOff(t, { ...colours, line: colour('light', 'line') });
    ctx.log(`${cream.name} at 512, edge samples off: ${JSON.stringify(off)}`);
    expect(
      {
        top: off.top.length,
        left: off.left.length,
        right: off.right.length,
        bottom: off.bottom.length,
      },
      `${cream.name} at 512: edge samples that are not a 1-pixel line of the line colour inside the square`,
    ).toEqual({ top: 0, left: 0, right: 0, bottom: 0 });
  }
});
