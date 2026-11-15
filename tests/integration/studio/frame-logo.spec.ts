// The tile in Studio's frame (test-criteria.md, issue 36, Flow; requirement R6), in the built app served by
// `bun run serve` in front of a real engine and an emulator:
//
// - `studio.frame-wordmark-shows-the-tile`: the wordmark link starts with the tile, drawn by the page in the tile's
//   colours and shape, at its sizes and gaps, with its focus ring, and nothing of it reaches the AWS area;
// - `studio.frame-tile-stays-while-engine-and-emulator-are-away`: the tile and the document's icons do not depend on
//   the engine or the emulator (the check's own emulator, stopped and started while the page is open);
// - `studio.frame-bar-fits-with-the-tile-in-every-language`: the bar holds the tile in each of the twelve languages
//   at 1280, 641, 640, 481 and 390, light and dark.
//
// Words: `support/frame-logo.ts`, `support/brand.ts`, `support/languages.ts`. Colours are the tokens of
// `tokens.css` read at run time; a language is set with a stored choice, its text read from the catalogues.

import type { Locator, Page, Request } from '@playwright/test';

import {
  CODE_SIGN_BOX,
  drawPageTile,
  expect,
  fetchRaw,
  FIXED_PATH_FILES,
  formProblems,
  iconLinks,
  MAGENTA,
  measureTile,
  mediaType,
  onTile,
  pageTileForm,
  recordFirstBarFrame,
  firstBarFrame,
  ringReport,
  schemeTokens,
  silentListener,
  startStack,
  surfaceBetween,
  test,
  tileBox,
  tileColoursOf,
  tileOf,
  tileRules,
  tileShot,
  tileShotDiffers,
  tileWatch,
  tileWholeProblems,
  watchTile,
  wordBox,
  wordColour,
  computedLook,
  grown,
  shot,
  type CssBox,
  type Rgb,
  type Scheme,
} from './support';
import { channelDiff } from './support/brand';
import { paintedColours } from './support/brand-files';
import { ACTION, expectHome, expectInAwsArea, frame } from './support/frame';
import { connectionView, markPage, stillSamePage, STATUSES } from './support/home';
import {
  faceItems,
  faceProblem,
  FACES,
  heightFor,
  language,
  languageContext,
  languageControl,
  LANGUAGES,
  layout,
  markAreaRoot,
  notOnTop,
  placed,
  settled,
  visibleText,
} from './support/languages';
import { Lines } from './support/lines';

/** Requirement 3.4 of issue 3: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

/** R6.4: the tile and its gap to "EmuForge" above 640px wide, and at 640px and below. */
const WIDE = { side: 28, gap: 6 };
const NARROW = { side: 24, gap: 5 };

/** The page's own `h1` is drawn: the document has rendered. */
async function rendered(page: Page): Promise<void> {
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: ACTION.timeout });
}

async function open(page: Page, path: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: heightFor(width) });
  await page.goto(path);
  await rendered(page);
}

/** Moves the pointer off the frame and drops focus, so nothing is hovered or focused while it is measured. */
async function rest(page: Page): Promise<void> {
  const size = page.viewportSize();
  await page.mouse.move(1, (size?.height ?? 800) - 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settled(page);
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function fmt(box: CssBox | null): string {
  return box === null
    ? 'none'
    : `${box.x.toFixed(1)},${box.y.toFixed(1)} ${box.width.toFixed(1)}x${box.height.toFixed(1)}`;
}

/** Why the wordmark link does not show the tile, then "EmuForge" (and "Studio" when `withStudio`), at `size`. */
async function wordmarkProblems(
  page: Page,
  size: { side: number; gap: number },
  withStudio: boolean,
): Promise<string[]> {
  const f = frame(page);
  const out: string[] = [];
  const tile = await tileBox(page).catch((e: Error) => {
    out.push(e.message);
    return null;
  });
  const emu = await wordBox(f.wordmark, 'EmuForge');
  const studio = withStudio ? await wordBox(f.wordmark, 'Studio') : null;
  if (emu === null) out.push('"EmuForge" is not drawn in the wordmark link');
  if (withStudio && studio === null) out.push('"Studio" is not drawn in the wordmark link');
  if (tile === null || emu === null) return out;
  if (!near(tile.width, size.side, 0.5) || !near(tile.height, size.side, 0.5)) {
    out.push(`the tile is ${fmt(tile)}, not ${String(size.side)} x ${String(size.side)}`);
  }
  if (tile.x + tile.width > emu.x + 0.5) out.push(`the tile (${fmt(tile)}) is not left of "EmuForge" (${fmt(emu)})`);
  const gap = emu.x - (tile.x + tile.width);
  if (!near(gap, size.gap, 0.5))
    out.push(`the gap between the tile and "EmuForge" is ${gap.toFixed(2)}, not ${String(size.gap)}`);
  if (studio !== null && emu.x + emu.width > studio.x + 0.5) {
    out.push(`"EmuForge" (${fmt(emu)}) is not left of "Studio" (${fmt(studio)})`);
  }
  return out;
}

/** A colour the page computed, as this Chromium paints it. */
async function painted(page: Page, value: string | null): Promise<Rgb | null> {
  if (value === null) return null;
  const p = (await paintedColours(page, [value])).get(value);
  return p ? ([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0] as const) : null;
}

/** Tab from the page's start to the wordmark link: the skip link first, then the link. */
async function tabToWordmark(page: Page): Promise<void> {
  const f = frame(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await f.wordmark.evaluate((el) => el === document.activeElement, undefined, ACTION);
  if (!focused) throw new Error('the second Tab from the page start does not focus the wordmark link');
  await settled(page);
}

// ---------------------------------------------------------------------------------------------------------------
// studio.frame-wordmark-shows-the-tile
// ---------------------------------------------------------------------------------------------------------------

test('studio.frame-wordmark-shows-the-tile', async ({ ctx, page, context, browser, proxy }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const f = frame(page);
  const token = await schemeTokens(page, ctx);

  await lines.line(
    'Open `/` at 1280 → the wordmark link shows, from the left, the tile, then "EmuForge", then "Studio"; the tile is 28 x 28, the gap between the tile and "EmuForge" is 6, and the tile is centred on the bar\'s height within 1 pixel',
    async () => {
      await open(page, '/', 1280);
      await rest(page);
      const found = await wordmarkProblems(page, WIDE, true);
      const tile = await tileBox(page).catch(() => null);
      const bar = await f.banner.boundingBox(ACTION);
      ctx.log(`at 1280: tile ${fmt(tile)}, bar ${fmt(bar)}`);
      if (tile !== null && bar !== null) {
        const off = tile.y + tile.height / 2 - (bar.y + bar.height / 2);
        if (Math.abs(off) > 1) found.push(`the tile's middle is ${off.toFixed(2)} from the bar's`);
      }
      expect(found).toEqual([]);
    },
  );

  /** The tile's form and the words' colours in `scheme`. */
  const colourProblems = async (scheme: Scheme): Promise<string[]> => {
    const form = await pageTileForm(page, tileColoursOf(token, scheme));
    ctx.log(`the tile at 1280, ${scheme}: ${JSON.stringify(form)}`);
    const found = formProblems(form, `the tile, ${scheme}`);
    for (const [word, name] of [
      ['EmuForge', 'text'],
      ['Studio', 'text-2'],
    ] as const) {
      const colour = await painted(page, await wordColour(f.wordmark, word));
      const want = token(scheme, name);
      if (colour === null || channelDiff(colour, want) > 1) {
        found.push(
          `"${word}" is ${colour?.join(' ') ?? 'not drawn'}, not the ${scheme} ${name} colour ${want.join(' ')}`,
        );
      }
    }
    return found;
  };

  await lines.line(
    'The same page → the tile\'s ground is the `accent` colour and its symbol the `accent-ink` colour; "EmuForge" is the `text` colour and "Studio" the `text-2` colour — light',
    async () => {
      await page.emulateMedia({ colorScheme: 'light' });
      await open(page, '/', 1280);
      await rest(page);
      expect(await colourProblems('light')).toEqual([]);
    },
  );

  await lines.line(
    "The same page in a dark scheme → the tile's ground is the `accent` colour (dark) and its symbol the `accent-ink` colour (dark); switching the scheme while the page is open changes the tile without a reload — dark",
    async () => {
      const found: string[] = [];
      await page.emulateMedia({ colorScheme: 'dark' });
      await open(page, '/', 1280);
      await rest(page);
      found.push(...(await colourProblems('dark')).map((p) => `opened dark: ${p}`));
      await page.emulateMedia({ colorScheme: 'light' });
      await open(page, '/', 1280);
      await rest(page);
      await markPage(page);
      await page.emulateMedia({ colorScheme: 'dark' });
      await settled(page);
      const form = await pageTileForm(page, tileColoursOf(token, 'dark'));
      ctx.log(`the tile after switching to dark while open: ${JSON.stringify(form)}`);
      found.push(...formProblems(form, 'switched to dark while open'));
      if (!(await stillSamePage(page))) found.push('the page was reloaded when the scheme changed');
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Draw the tile's box from the page at 4 times its size → the crest's top is at 0.13 to 0.19, the beak's tip at 0.83 to 0.89, the ink touches only the bottom edge, and there is one hole: it is R8.2's tile, with no code sign",
    async () => {
      const colours = tileColoursOf(token, 'light');
      const t = await drawPageTile(ctx, browser, proxy, stack.studio, { path: '/', scheme: 'light' });
      const m = measureTile(t, colours, MAGENTA);
      ctx.log(
        `the page's tile at 4x: side ${String(t.side)}, crest top ${m.crestTop.toFixed(3)}, beak tip ${m.beakTip.toFixed(3)}, on edge ${JSON.stringify(m.onEdge)}, holes ${JSON.stringify(m.holes)}, other pieces ${JSON.stringify(m.others)}`,
      );
      const found: string[] = [];
      if (!(m.crestTop >= 0.13 && m.crestTop <= 0.19)) found.push(`the crest's top at ${m.crestTop.toFixed(3)} of S`);
      if (!(m.beakTip >= 0.83 && m.beakTip <= 0.89)) found.push(`the beak's tip at ${m.beakTip.toFixed(3)} of S`);
      if (m.onEdge.bottom === 0) found.push("the symbol's ink does not touch the bottom edge");
      for (const side of ['top', 'left', 'right'] as const) {
        if (m.onEdge[side] > 0)
          found.push(`the symbol's ink touches the ${side} edge (${String(m.onEdge[side])} pixels)`);
      }
      if (m.holes.length !== 1) found.push(`${String(m.holes.length)} holes in the symbol, not one`);
      const box = onTile(t, CODE_SIGN_BOX);
      let stray = 0;
      for (let y = box.top; y < box.bottom; y++) {
        for (let x = box.left; x < box.right; x++) {
          const i = y * t.drawing.width + x;
          if (m.ink.bits[i] && !m.symbol.bits[i]) stray++;
        }
      }
      if (stray > 0) found.push(`${String(stray)} pixels of ink in the code sign's box that are not the symbol's`);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open `/` and record frames and requests → the first frame that shows the bar shows the tile whole, and no request is made for an image to draw it',
    async () => {
      const p = await context.newPage();
      const requests: Request[] = [];
      p.on('request', (r) => requests.push(r));
      try {
        await recordFirstBarFrame(p);
        await p.setViewportSize({ width: 1280, height: 800 });
        await p.goto('/');
        await rendered(p);
        await p.waitForLoadState('networkidle', { timeout: 10_000 });
        const first = await firstBarFrame(p);
        ctx.log(`the first frame with the bar: ${JSON.stringify(first)}`);
        const fixed = new Set<string>(FIXED_PATH_FILES.map((x) => x.path));
        const images = requests
          .filter((r) => {
            const { pathname } = new URL(r.url());
            if (fixed.has(pathname)) return false;
            return r.resourceType() === 'image' || /\.(svg|png|jpe?g|gif|webp|avif|ico)$/i.test(pathname);
          })
          .map((r) => `${r.resourceType()} ${r.url()}`);
        ctx.log(`image requests besides the document's icons: ${images.join(', ') || 'none'}`);
        const found: string[] = [];
        if (first === null) found.push('no frame showed the bar');
        else if (!first.wordmark) found.push('the first frame with the bar has no wordmark link');
        else if (first.tile === null) found.push('the first frame with the bar has no tile');
        else {
          const t = first.tile;
          if (!near(t.width, WIDE.side, 0.5) || !near(t.height, WIDE.side, 0.5))
            found.push(`the first frame's tile is ${t.width.toFixed(1)} x ${t.height.toFixed(1)}`);
          if (!t.inViewport) found.push("the first frame's tile is not inside the viewport");
          if (t.paths === 0 || t.pathData === 0) found.push("the first frame's tile has no path drawn");
          if (t.loaders > 0)
            found.push(`the first frame's tile holds ${String(t.loaders)} elements that load what they draw`);
        }
        if (images.length > 0) found.push(`image requests: ${images.join(', ')}`);
        expect(found).toEqual([]);
      } finally {
        await p.close();
      }
    },
  );

  await lines.line(
    'Read the accessibility tree of the banner → one link named exactly "EmuForge Studio"; no image, graphic or unnamed node for the tile',
    async () => {
      await open(page, '/', 1280);
      expect(
        await f.banner.getByRole('link', { name: 'EmuForge Studio', exact: true }).count(),
        'links named "EmuForge Studio"',
      ).toBe(1);
      const tree = await f.wordmark.ariaSnapshot(ACTION);
      ctx.log(`the wordmark link's accessibility tree:\n${tree}`);
      const nodes = tree
        .split('\n')
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('- /url:') && !l.startsWith('- text:'));
      expect(nodes, 'nodes inside the wordmark link besides its text and address').toEqual([]);
      const banner = await f.banner.ariaSnapshot(ACTION);
      expect(
        banner.split('\n').filter((l) => /^\s*- (img|image|graphics-\w+|figure)\b/.test(l)),
        'images or graphics in the banner',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Click the tile on `/aws/s3` → Home opens, as a click on the text does; click the text → the same',
    async () => {
      await open(page, '/aws/s3', 1280);
      await expectInAwsArea(page, 'Amazon Simple Storage Service');
      await tileOf(page).click(ACTION);
      await expectHome(page);
      await open(page, '/aws/s3', 1280);
      await expectInAwsArea(page, 'Amazon Simple Storage Service');
      await f.wordmark.getByText('EmuForge', { exact: true }).click(ACTION);
      await expectHome(page);
    },
  );

  await lines.line(
    'Open `/`, `/does-not-exist`, `/aws`, `/aws/s3/buckets` → the tile is at the same place with the same size and colours on all four; go back and forward between them and reload one → it is unchanged',
    async () => {
      const found: string[] = [];
      await page.setViewportSize({ width: 1280, height: 800 });
      const paths = ['/', '/does-not-exist', '/aws', '/aws/s3/buckets'];
      const take = async (where: string) => {
        await rendered(page);
        await rest(page);
        const s = await tileShot(page);
        ctx.log(`the tile ${where}: ${fmt(s.box)}`);
        return s;
      };
      const first = await (async () => {
        await page.goto(paths[0]!);
        return take(`on ${paths[0]!}`);
      })();
      const compare = async (where: string) => {
        const now = await take(where);
        const d = tileShotDiffers(first, now);
        if (d.length > 0) found.push(`${where}: ${d.join('; ')}`);
      };
      for (const p of paths.slice(1)) {
        await page.goto(p);
        await compare(`on ${p}`);
      }
      await page.goBack();
      await compare('back on /aws');
      await page.goBack();
      await compare('back on /does-not-exist');
      await page.goForward();
      await compare('forward on /aws');
      await page.reload();
      await compare('after reloading /aws');
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Tab to the wordmark link → a ring in the `focus` colour surrounds the tile and the text together, 4 pixels out from the link's box; every side of the ring is inside the bar and not covered by the skip link, a tab or the viewport's edge — 1280 and 390, light and dark",
    async () => {
      const found: string[] = [];
      for (const width of [1280, 390]) {
        for (const scheme of ['light', 'dark'] as const) {
          const where = `${String(width)} ${scheme}`;
          try {
            await page.emulateMedia({ colorScheme: scheme });
            await open(page, '/', width);
            await rest(page);
            await tabToWordmark(page);
            const link = await f.wordmark.boundingBox(ACTION);
            const tile = await tileBox(page);
            const emu = await wordBox(f.wordmark, 'EmuForge');
            for (const [name, b] of [
              ['the tile', tile],
              ['"EmuForge"', emu],
            ] as const) {
              if (b === null || link === null) {
                found.push(`${where}: ${name} or the link is not drawn`);
                continue;
              }
              if (
                b.x < link.x - 0.5 ||
                b.y < link.y - 0.5 ||
                b.x + b.width > link.x + link.width + 0.5 ||
                b.y + b.height > link.y + link.height + 0.5
              )
                found.push(`${where}: ${name} (${fmt(b)}) is outside the link's box (${fmt(link)}), outside the ring`);
            }
            const ring = await ringReport(page, f.wordmark, f.banner, token(scheme, 'focus'));
            ctx.log(`${where}: outline ${JSON.stringify(ring.outline)}, sides ${JSON.stringify(ring.sides)}`);
            found.push(...ring.problems.map((p) => `${where}: ${p}`));
          } catch (e) {
            found.push(`${where}: ${(e as Error).message.split('\n')[0]}`);
          }
        }
      }
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "The focused wordmark link in dark → between the tile and the ring lie at least 3 pixels of the bar's `surface` colour on the tile's top, left and bottom sides",
    async () => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await open(page, '/', 1280);
      await rest(page);
      await tabToWordmark(page);
      const between = await surfaceBetween(page, await tileBox(page), token('dark', 'surface'), token('dark', 'focus'));
      ctx.log(`dark, focused: surface pixels between the tile and the ring ${JSON.stringify(between)}`);
      await page.emulateMedia({ colorScheme: 'light' });
      const found: string[] = [];
      for (const side of ['top', 'left', 'bottom'] as const) {
        if (between[side].ringAt === null) found.push(`${side}: no ring found outward of the tile`);
        if (between[side].surface < 3)
          found.push(`${side}: ${String(between[side].surface)} pixels of the surface colour`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line('Hover the wordmark link → nothing about it changes but the pointer', async () => {
    await open(page, '/', 1280);
    await rest(page);
    const link = await f.wordmark.boundingBox(ACTION);
    if (link === null) throw new Error('the wordmark link is not drawn');
    const clip = grown(link, 8);
    const before = { look: await computedLook(f.wordmark), shot: { box: clip, drawing: await shot(page, clip) } };
    await page.mouse.move(link.x + link.width / 2, link.y + link.height / 2);
    await settled(page);
    const after = { look: await computedLook(f.wordmark), shot: { box: clip, drawing: await shot(page, clip) } };
    const changed = Object.keys(before.look).filter((k) => before.look[k] !== after.look[k]);
    ctx.log(`hovered: computed properties changed ${changed.join(', ') || 'none'}`);
    expect(
      changed.map((k) => `${k}: ${before.look[k]} → ${after.look[k]}`),
      'computed properties that change on hover',
    ).toEqual([]);
    expect(tileShotDiffers(before.shot, after.shot), 'what is drawn around the link on hover').toEqual([]);
    await rest(page);
  });

  /** "Studio" is not drawn, the link is still named "EmuForge Studio", and the tile is at the narrow size. */
  const narrowProblems = async (where: string): Promise<string[]> => {
    const found = (await wordmarkProblems(page, NARROW, false)).map((p) => `${where}: ${p}`);
    const shown = await visibleText(page, f.wordmark);
    if (shown !== 'EmuForge') found.push(`${where}: the wordmark link draws "${shown}", not "EmuForge" alone`);
    if ((await f.wordmark.count()) !== 1) found.push(`${where}: no link named exactly "EmuForge Studio"`);
    return found;
  };
  const wideProblems = async (where: string): Promise<string[]> => {
    const found = (await wordmarkProblems(page, WIDE, true)).map((p) => `${where}: ${p}`);
    const shown = await visibleText(page, f.wordmark);
    if (shown !== 'EmuForge Studio') found.push(`${where}: the wordmark link draws "${shown}", not "EmuForge Studio"`);
    if ((await f.wordmark.count()) !== 1) found.push(`${where}: no link named exactly "EmuForge Studio"`);
    return found;
  };

  await lines.line(
    'Open `/` at 390 → the tile is 24 x 24 with a gap of 5 to "EmuForge"; "Studio" is not drawn; the link\'s accessible name is still exactly "EmuForge Studio" — 390 wide',
    async () => {
      await open(page, '/', 390);
      await rest(page);
      expect(await narrowProblems('390')).toEqual([]);
    },
  );

  await lines.line(
    'Resize from 641 to 640 wide and back → at 641 "Studio" is drawn and the tile is 28; at 640 "Studio" is not drawn and the tile is 24; the accessible name is "EmuForge Studio" at both',
    async () => {
      const found: string[] = [];
      await open(page, '/', 641);
      await rest(page);
      found.push(...(await wideProblems('641')));
      await page.setViewportSize({ width: 640, height: 800 });
      await settled(page);
      found.push(...(await narrowProblems('640 after 641')));
      await page.setViewportSize({ width: 641, height: 800 });
      await settled(page);
      found.push(...(await wideProblems('641 after 640')));
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Open `/aws/s3` → no element inside the AWS area's root has a class, a custom property or a computed colour that comes from the tile's rules, and the tile's rules are in the `studio` layer",
    async () => {
      await open(page, '/aws/s3', 1280);
      await expectInAwsArea(page, 'Amazon Simple Storage Service');
      expect(await markAreaRoot(page), "the AWS area's root is found").toBe(true);
      const r = await tileRules(page);
      ctx.log(`the tile's rules: ${JSON.stringify(r.rules)}; unreadable sheets ${JSON.stringify(r.unreadable)}`);
      expect(r.rules.length, 'rules that style the tile').toBeGreaterThan(0);
      expect(
        r.rules
          .filter((x) => x.layer !== 'studio' && !x.layer.startsWith('studio.'))
          .map((x) => `${x.selector} (layer "${x.layer}")`),
        "the tile's rules outside the studio layer",
      ).toEqual([]);
      expect(r.matchedInside, "elements inside the area's root matched by a tile rule").toEqual([]);
      expect(r.classesInside, "elements inside the area's root with a class of the tile's").toEqual([]);
      expect(r.customInside, "elements inside the area's root with a custom property of the tile's").toEqual([]);
    },
  );

  await lines.line(
    'Add four more links to the tab list from the check (the state of more providers than fit) at 700 wide → the tab list scrolls within the bar, the page does not scroll sideways, and the wordmark link keeps its width with the tile whole',
    async () => {
      await open(page, '/', 700);
      await rest(page);
      const before = await f.wordmark.boundingBox(ACTION);
      const added = await f.nav.evaluate(
        (nav) => {
          const model = nav.querySelector('a');
          if (!model) return 0;
          for (const name of ['Provider area one', 'Provider area two', 'Provider area three', 'Provider area four']) {
            const a = model.cloneNode(false) as HTMLAnchorElement;
            a.removeAttribute('aria-current');
            a.setAttribute('href', '#');
            a.textContent = name;
            nav.appendChild(a);
          }
          return 4;
        },
        undefined,
        ACTION,
      );
      await settled(page);
      const after = await f.wordmark.boundingBox(ACTION);
      const nav = await f.nav.evaluate((n) => ({ scroll: n.scrollWidth, client: n.clientWidth }), undefined, ACTION);
      const pageScrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      ctx.log(
        `700 wide, ${String(added)} links added: tab list ${JSON.stringify(nav)}, wordmark ${fmt(before)} → ${fmt(after)}`,
      );
      const found: string[] = [];
      if (added !== 4) found.push('the tab list has no link to copy');
      if (nav.scroll <= nav.client + 1)
        found.push(`the tab list does not scroll (${String(nav.scroll)} in ${String(nav.client)})`);
      if (pageScrolls) found.push('the page scrolls sideways');
      if (before === null || after === null || !near(before.width, after.width, 0.5))
        found.push(`the wordmark link's width changed: ${fmt(before)} → ${fmt(after)}`);
      found.push(...(await tileWholeProblems(page, WIDE.side)));
      if ((await tileOf(page).count()) === 1) {
        const covered = await notOnTop(page, tileOf(page));
        if (covered.length > 0) found.push(`the tile is covered at ${covered.join('; ')}`);
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.frame-tile-stays-while-engine-and-emulator-are-away
// ---------------------------------------------------------------------------------------------------------------

const KNOWN = STATUSES.filter((s) => s !== 'Checking' && s !== 'Unknown');

test('studio.frame-tile-stays-while-engine-and-emulator-are-away', async ({ ctx, page, context }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const lines = new Lines(ctx);
  const token = await schemeTokens(page, ctx);
  const light = tileColoursOf(token, 'light');

  const connected = async (p: Page) =>
    expect
      .poll(
        async () => {
          const v = await connectionView(p);
          return { engine: v.engine?.status ?? null, emulator: v.emulator?.status ?? null };
        },
        { timeout: CHANGE_BOUND_MS, message: 'both rows "Connected"' },
      )
      .toEqual({ engine: 'Connected', emulator: 'Connected' });

  // When connected: the tile as drawn, and `/favicon.svg` as served.
  await open(page, '/', 1280);
  await connected(page);
  await rest(page);
  const reference = await tileShot(page).catch((e: Error) => {
    ctx.log(`connected: no tile to take (${e.message})`);
    return null;
  });
  const svgWhenRunning = await fetchRaw(stack.studio.port, '/favicon.svg');
  ctx.log(
    `connected: tile ${fmt(reference?.box ?? null)}; /favicon.svg ${String(svgWhenRunning.status)} ${svgWhenRunning.headers['content-type'] ?? ''}`,
  );
  const sameAsConnected = (now: Awaited<ReturnType<typeof tileShot>>, where: string): string[] =>
    reference === null
      ? [`${where}: no tile was drawn when connected to compare with`]
      : tileShotDiffers(reference, now).map((d) => `${where}: ${d}`);

  await stack.engine.stop();

  await lines.line(
    'Open `/` with the engine not running → Home shows the engine as unreachable and the bar shows the tile, 28 x 28, in the same colours as when connected',
    async () => {
      await open(page, '/', 1280);
      await expect
        .poll(async () => (await connectionView(page)).engine?.status ?? null, {
          timeout: CHANGE_BOUND_MS,
          message: 'the Engine row',
        })
        .toBe('Unreachable');
      await rest(page);
      const found = await tileWholeProblems(page, WIDE.side);
      if (found.length === 0) {
        found.push(...formProblems(await pageTileForm(page, light), 'the tile, engine not running'));
        found.push(...sameAsConnected(await tileShot(page), 'engine not running'));
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open `/` while the first check is still unanswered → the tile is drawn before any status is known',
    async () => {
      const silent = await silentListener(ctx, stack.engine.port);
      const p = await context.newPage();
      try {
        await p.setViewportSize({ width: 1280, height: 800 });
        await p.goto('/');
        await rendered(p);
        await expect
          .poll(() => silent.accepted(), { timeout: 5_000, message: 'the page asked the engine' })
          .toBeGreaterThan(0);
        const view = await connectionView(p);
        const statuses = { engine: view.engine?.status ?? null, emulator: view.emulator?.status ?? null };
        const found = await tileWholeProblems(p, WIDE.side);
        if (found.length === 0) {
          const s = await tileShot(p);
          const form = await pageTileForm(p, light);
          found.push(...formProblems(form, 'the tile, first check unanswered'));
          found.push(...sameAsConnected(s, 'first check unanswered'));
        }
        const after = await connectionView(p);
        const later = { engine: after.engine?.status ?? null, emulator: after.emulator?.status ?? null };
        ctx.log(
          `first check unanswered: statuses ${JSON.stringify(statuses)} before the tile was read, ${JSON.stringify({ engine: after.engine?.status ?? null, emulator: after.emulator?.status ?? null })} after`,
        );
        for (const [when, seen] of [
          ['before the tile was read', statuses],
          ['after the tile was read', later],
        ] as const) {
          for (const [row, status] of Object.entries(seen)) {
            if (status !== null && KNOWN.includes(status)) found.push(`${when}, the ${row} row shows "${status}"`);
          }
        }
        expect(found).toEqual([]);
      } finally {
        await p.close();
        await silent.close();
      }
    },
  );

  await lines.line('Request `/favicon.svg` with the engine not running → the image, as when it runs', async () => {
    const answer = await fetchRaw(stack.studio.port, '/favicon.svg');
    ctx.log(
      `engine not running: /favicon.svg ${String(answer.status)} ${answer.headers['content-type'] ?? ''}, ${String(answer.body.length)} bytes`,
    );
    expect({ status: answer.status, type: mediaType(answer) }, '/favicon.svg with the engine not running').toEqual({
      status: 200,
      type: 'image/svg+xml',
    });
    expect(
      { status: svgWhenRunning.status, type: mediaType(svgWhenRunning) },
      '/favicon.svg when the engine runs',
    ).toEqual({
      status: 200,
      type: 'image/svg+xml',
    });
    expect(answer.body.equals(svgWhenRunning.body), 'the same bytes as when the engine runs').toBe(true);
  });

  await stack.engine.startAgain();

  await lines.line(
    "Stop the emulator while `/` is open, wait for Home to say so, start it again → the tile and the document's icon links never change and the page is not reloaded",
    async () => {
      await open(page, '/', 1280);
      await connected(page);
      await rest(page);
      const linksBefore = await iconLinks(page);
      await watchTile(page);
      await markPage(page);
      await emulator.stop();
      await expect
        .poll(async () => (await connectionView(page)).emulator?.status ?? null, {
          timeout: CHANGE_BOUND_MS,
          message: 'the Emulator row',
        })
        .toBe('Not started');
      await emulator.startAgain();
      await connected(page);
      await rest(page);
      const watch = await tileWatch(page);
      const linksAfter = await iconLinks(page);
      ctx.log(
        `while the emulator stopped and started: ${JSON.stringify(watch)}; icon links ${JSON.stringify(linksBefore)} → ${JSON.stringify(linksAfter)}`,
      );
      const found: string[] = [];
      if (watch === null) found.push('the watch was lost: the document changed');
      else {
        found.push(...watch.changes);
        if (!watch.sameTile) found.push('the tile is not the element it was');
        if (!watch.sameIcons) found.push('the icon links are not the elements they were');
      }
      if (linksBefore.length === 0) found.push('the document links no icon');
      if (JSON.stringify(linksBefore) !== JSON.stringify(linksAfter)) found.push('the icon links changed');
      if (!(await stillSamePage(page))) found.push('the page was reloaded');
      found.push(...sameAsConnected(await tileShot(page), 'after the emulator came back'));
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------
// studio.frame-bar-fits-with-the-tile-in-every-language
// ---------------------------------------------------------------------------------------------------------------

/** At most `n` lines of a list, with how many more there are. */
function cap(list: string[], n = 40): string[] {
  return list.length > n ? [...list.slice(0, n), `… and ${String(list.length - n)} more`] : list;
}

/** Why `locator`'s element is not inside the viewport or is covered at its centre. */
async function placeProblems(page: Page, name: string, locator: Locator): Promise<string[]> {
  try {
    const p = await placed(page, locator);
    const out: string[] = [];
    if (!p.inside) out.push(`${name} (${p.rect}) is not inside the viewport`);
    if (p.covered) out.push(`${name} (${p.rect}) is covered`);
    return out;
  } catch (e) {
    return [`${name}: ${(e as Error).message.split('\n')[0]}`];
  }
}

test('studio.frame-bar-fits-with-the-tile-in-every-language', async ({ ctx, browser, proxy }) => {
  test.setTimeout(1_500_000);
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const found: Record<'w1280' | 'w390' | 'w481' | 'w641' | 'area' | 'faces', string[]> = {
    w1280: [],
    w390: [],
    w481: [],
    w641: [],
    area: [],
    faces: [],
  };

  /** Measures the bar as drawn now, at `width`, in `tag`. */
  const measure = async (page: Page, tag: string, width: number, where: string): Promise<string[]> => {
    const f = frame(page);
    const out: string[] = [];
    const narrow = width <= 640;
    const l = await layout(page);
    if (l.pageScrolls) out.push('the page scrolls sideways');
    out.push(...(await tileWholeProblems(page, narrow ? NARROW.side : WIDE.side)));
    if ((await tileOf(page).count()) === 1) {
      const covered = await notOnTop(page, tileOf(page));
      if (covered.length > 0) out.push(`the tile is overlapped at ${covered.join('; ')}`);
      out.push(...(await placeProblems(page, 'the tile', tileOf(page))));
    }
    const nav = await f.nav.evaluate((n) => ({ scroll: n.scrollWidth, client: n.clientWidth }), undefined, ACTION);
    if (nav.scroll > nav.client + 1) out.push(`the tab list scrolls (${String(nav.scroll)} in ${String(nav.client)})`);
    out.push(...(await placeProblems(page, '"EmuForge"', f.wordmark.getByText('EmuForge', { exact: true }))));
    if (!narrow) out.push(...(await placeProblems(page, '"Studio"', f.wordmark.getByText('Studio', { exact: true }))));
    const links = f.nav.getByRole('link');
    for (let i = 0; i < (await links.count()); i++) {
      out.push(...(await placeProblems(page, `navigation link ${String(i + 1)}`, links.nth(i))));
    }
    out.push(...(await placeProblems(page, 'the language control', languageControl(page))));
    const shown = await visibleText(page, f.wordmark).catch(() => '(no wordmark link)');
    const want = narrow ? 'EmuForge' : 'EmuForge Studio';
    if (shown !== want) out.push(`the wordmark link draws "${shown}", not "${want}"`);
    if (width === 481 || width === 640) {
      const control = await visibleText(page, languageControl(page)).catch(() => null);
      if (control !== language(tag).name)
        out.push(`the control shows "${String(control)}", not "${language(tag).name}"`);
    }
    return out.map((p) => `${where}: ${p}`);
  };

  for (const l of LANGUAGES) {
    const { context, page } = await languageContext(ctx, browser, proxy, stack.studio, { stored: l.tag });
    const f = frame(page);
    try {
      for (const width of [1280, 390, 481, 640, 641]) {
        const bucket =
          width === 1280 ? found.w1280 : width === 390 ? found.w390 : width === 641 ? found.w641 : found.w481;
        try {
          await open(page, '/', width);
        } catch (e) {
          bucket.push(`${l.tag} / ${String(width)}: could not open: ${(e as Error).message.split('\n')[0]}`);
          continue;
        }
        for (const scheme of ['light', 'dark'] as const) {
          const where = `${l.tag} / ${String(width)} ${scheme}`;
          try {
            await page.emulateMedia({ colorScheme: scheme });
            await rest(page);
            bucket.push(...(await measure(page, l.tag, width, where)));
          } catch (e) {
            bucket.push(`${where}: could not measure: ${(e as Error).message.split('\n')[0]}`);
          }
        }
        if (width === 1280) {
          await page.emulateMedia({ colorScheme: 'light' });
          try {
            const items = (await faceItems(page)).filter((i) => i.wordmark);
            if (items.length === 0) found.faces.push(`${l.tag}: the wordmark's text was not drawn`);
            for (const i of items) {
              const p = faceProblem(i, [FACES.latin]);
              if (p) found.faces.push(`${l.tag}: ${p}`);
            }
          } catch (e) {
            found.faces.push(`${l.tag}: could not read the faces: ${(e as Error).message.split('\n')[0]}`);
          }
          if ((await f.wordmark.count()) !== 1) found.faces.push(`${l.tag}: no link named exactly "EmuForge Studio"`);
        }
      }

      if (l.tag === 'th' || l.tag === 'de') {
        await page.emulateMedia({ colorScheme: 'light' });
        for (const width of [390, 1280]) {
          const where = `${l.tag} ${String(width)}`;
          try {
            await open(page, '/', width);
            await rest(page);
            const home = await tileShot(page);
            await open(page, '/aws/s3', width);
            await expect(
              page.getByRole('heading', { level: 1, name: 'Amazon Simple Storage Service', exact: true }),
            ).toBeVisible();
            await rest(page);
            const area = await tileShot(page);
            ctx.log(`${where}: the tile on / ${fmt(home.box)}, on /aws/s3 ${fmt(area.box)}`);
            found.area.push(...tileShotDiffers(home, area).map((d) => `${where}: /aws/s3 against /: ${d}`));
          } catch (e) {
            found.area.push(`${where}: ${(e as Error).message.split('\n')[0]}`);
          }
        }
      }
    } finally {
      await context.close();
    }
  }

  await lines.line(
    'Each of the twelve languages on `/` at 1280 → no sideways scroll; the tile is whole and nothing overlaps it; the tab list does not scroll; the tile, "EmuForge", "Studio", every navigation link and the language control are inside the viewport and none is covered — light and dark',
    async () => expect(cap(found.w1280)).toEqual([]),
  );
  await lines.line(
    'The same at 390 → no sideways scroll; the tile is whole, 24 x 24, and nothing overlaps it; the tab list does not scroll; the tile, "EmuForge", every navigation link and the control are inside the viewport; "Studio" is not drawn — 390 wide, light and dark',
    async () => expect(cap(found.w390)).toEqual([]),
  );
  await lines.line(
    "The same at 481 and at 640 → as at 390, with the control showing the language's own name; Polish at 481, the tightest bar measured on the mock (`logs/measure-bar.json`), is among them and fits",
    async () => expect(cap(found.w481)).toEqual([]),
  );
  await lines.line(
    'The same at 641 → "Studio" is drawn, the tile is 28 x 28, the tab list does not scroll and nothing leaves the viewport',
    async () => expect(cap(found.w641)).toEqual([]),
  );
  await lines.line(
    'Thai and German on `/aws/s3` at 390 and 1280 → the bar is as on `/`: same tile, same place',
    async () => expect(cap(found.area)).toEqual([]),
  );
  await lines.line(
    'Every language → the wordmark\'s drawn text is in Instrument Sans alone, and the link\'s accessible name is "EmuForge Studio" untranslated',
    async () => expect(cap(found.faces)).toEqual([]),
  );

  lines.end();
});
