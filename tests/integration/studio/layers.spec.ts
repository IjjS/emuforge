// The two layers of Studio kept apart in the built app served by `bun run serve`, in front of a real engine and an
// emulator (test-criteria.md, issue 16, Integration checks): Cloudscape stays inside the AWS area, Studio's style stays
// outside it, both follow the system's colour scheme, and Studio's own layer keeps its contrast and focus indicators.
//
// `studio.cloudscape-stays-inside-aws-area`, `studio.studio-style-stays-outside-aws-area`,
// `studio.colour-scheme-follows-the-system-in-both-layers`, `studio.own-layer-contrast-and-focus`.
//
// Each check first asserts that what it inspects exists: the built app has a `studio` cascade layer holding rules from
// Studio's own source, and a page of the AWS area has the area's root (support/layers.ts says how both are found).

import type { Page } from '@playwright/test';

import { expect, NO_SCREEN_SERVICE, startStack, test, type Ctx } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { connectionView, markPage, stillSamePage } from './support/home';
import {
  backgroundToken,
  baseApplied,
  cloudscapeFontFamilies,
  fontFaces,
  indexBaseReference,
  layerReport,
  navigationLook,
  navigationReference,
  orderProblems,
  sourceReport,
  studioLayerMissing,
  studioFrame,
  studioSource,
  tabSweep,
  TEXT_PROPERTIES,
  textContrast,
  type LayerReport,
  type Scheme,
} from './support/layers';
import { Lines } from './support/lines';

/** The pages of the AWS area the checks open, with their `h1`. */
const AREA_PAGES = [
  { path: '/aws', h1: 'Amazon Web Services' },
  { path: NO_SCREEN_SERVICE.path, h1: NO_SCREEN_SERVICE.label },
  { path: '/aws/does-not-exist', h1: 'Page not found' },
];
const WIDTHS = [1280, 390];
const SCHEMES: Scheme[] = ['light', 'dark'];
/** Requirement 3.4: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

async function look(page: Page, width: number, scheme: Scheme): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
  await page.emulateMedia({ colorScheme: scheme });
}

/** Moves the pointer to the viewport's last pixel and drops focus, so nothing is hovered or focused. */
async function rest(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.mouse.move(size.width - 1, size.height - 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** Waits, with a bound, for the page's `h1` named `h1`; a finding when it does not come. */
async function shows(page: Page, h1: string): Promise<string[]> {
  const ok = await heading(page, h1)
    .waitFor({ state: 'visible', ...ACTION })
    .then(() => true)
    .catch(() => false);
  return ok ? [] : [`no "${h1}" header`];
}

/** Opens `path` in a fresh document and waits for its `h1`. */
async function open(page: Page, path: string, h1: string): Promise<string[]> {
  await page.goto(path);
  const found = await shows(page, h1);
  await rest(page);
  return found;
}

/** R8.1 on Studio's own layer: no Cloudscape class, no foreign rule with a real property. */
function leaks(r: LayerReport): string[] {
  return [
    ...r.rootProblems,
    ...r.unreadable.map((s) => `a stylesheet could not be read: ${s}`),
    ...r.cloudscapeOutside.map((e) => `an element of Studio's own layer has a Cloudscape class: ${e}`),
    ...r.foreignOnOutside.map((s) => `a rule outside the studio layer that declares a real property: ${s}`),
  ];
}

function logReport(ctx: Ctx, where: string, r: LayerReport): void {
  ctx.log(
    `${where}: root ${r.root ?? 'none'}, ${String(r.outside)} elements outside, ${String(r.inside)} inside, ${String(r.unmatchable)} rules unmatchable, awsui-dark-mode on ${JSON.stringify(r.darkModeHolders)}`,
  );
  if (r.unmatchableRules.length > 0)
    ctx.log(`${where}: rules the walk could not match: ${r.unmatchableRules.join('; ')}`);
}

const at = (where: string, list: string[]) => list.map((s) => `${where}: ${s}`);

/** The `studio` layer precondition, computed once per check on the page as loaded. */
function studioLayer(page: Page, ctx: Ctx): () => Promise<string[]> {
  let found: string[] | null = null;
  return async () => {
    found ??= await studioLayerMissing(page, ctx);
    return found;
  };
}

test('studio.cloudscape-stays-inside-aws-area', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  await startStack(ctx);
  const lines = new Lines(ctx);
  const f = studioFrame(page);
  const layer = studioLayer(page, ctx);

  await lines.line(
    'Open `/` fresh, at 1280 and 390, light and dark → no element outside has a Cloudscape class; no rule outside the `studio` layer that declares a property other than a custom property matches any element outside, `html` and `body` included (R8.1)',
    async () => {
      const found: string[] = [];
      for (const width of WIDTHS) {
        for (const scheme of SCHEMES) {
          const where = `/ fresh, ${String(width)} wide, ${scheme}`;
          await look(page, width, scheme);
          found.push(...at(where, await open(page, '/', 'Home')));
          if (width === WIDTHS[0] && scheme === SCHEMES[0]) found.push(...(await layer()));
          const r = await layerReport(page, false);
          logReport(ctx, where, r);
          found.push(...at(where, leaks(r)));
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open `/aws/kinesis`, then choose "Home" in the frame (no reload) → the same holds on `/` (R8.1)',
    async () => {
      await look(page, 1280, 'light');
      const found: string[] = [...(await layer())];
      found.push(...at(NO_SCREEN_SERVICE.path, await open(page, NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label)));
      const area = await layerReport(page, true);
      logReport(ctx, NO_SCREEN_SERVICE.path, area);
      found.push(...at(NO_SCREEN_SERVICE.path, area.rootProblems));
      await markPage(page);
      const chosen = await f.home
        .click(ACTION)
        .then(() => true)
        .catch(() => false);
      if (!chosen) {
        found.push('the frame has no "Home" link to choose');
        expect(found).toEqual([]);
      }
      await expect(page).toHaveURL(addressOf('/'));
      found.push(...at('/ after /aws/kinesis', await shows(page, 'Home')));
      if (!(await stillSamePage(page))) found.push('choosing "Home" reloaded the page');
      await rest(page);
      const r = await layerReport(page, false);
      logReport(ctx, '/ after /aws/kinesis', r);
      found.push(...at('/ after /aws/kinesis', leaks(r)));
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Open `/aws/kinesis` in dark → the area's root has `awsui-dark-mode`; `html` and `body` carry no `awsui-` class (a `data-awsui-focus-visible` attribute on `body` is allowed); in light → no element has `awsui-dark-mode` (R8.2)",
    async () => {
      const found: string[] = [];
      for (const scheme of SCHEMES) {
        const where = `/aws/kinesis, ${scheme}`;
        await look(page, 1280, scheme);
        found.push(...at(where, await open(page, NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label)));
        const r = await layerReport(page, true);
        logReport(ctx, where, r);
        found.push(...at(where, r.rootProblems));
        if (r.htmlBodyAwsui.length > 0) found.push(`${where}: html or body carries ${r.htmlBodyAwsui.join(' ')}`);
        if (scheme === 'dark') {
          if (r.root !== null && r.rootProblems.length === 0 && !r.rootDarkMode)
            found.push(`${where}: the area's root (${r.root}) has no awsui-dark-mode`);
          if (r.darkModeOutside.length > 0)
            found.push(`${where}: awsui-dark-mode outside the area's root, on ${r.darkModeOutside.join(', ')}`);
        } else if (r.darkModeHolders.length > 0) {
          found.push(`${where}: awsui-dark-mode on ${r.darkModeHolders.join(', ')}`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line('Open `/does-not-exist` fresh and after `/aws` → the same as `/` (R8.1)', async () => {
    const found: string[] = [...(await layer())];
    for (const width of WIDTHS) {
      for (const scheme of SCHEMES) {
        const where = `/does-not-exist fresh, ${String(width)} wide, ${scheme}`;
        await look(page, width, scheme);
        found.push(...at(where, await open(page, '/does-not-exist', 'Page not found')));
        const r = await layerReport(page, false);
        logReport(ctx, where, r);
        found.push(...at(where, leaks(r)));
      }
    }
    for (const scheme of SCHEMES) {
      const where = `/does-not-exist after /aws, ${scheme}`;
      await look(page, 1280, scheme);
      found.push(...at(where, await open(page, '/does-not-exist', 'Page not found')));
      await markPage(page);
      // Into the AWS area by the frame, and back with the browser's Back: the same document all along.
      const chosen = await f.aws
        .click(ACTION)
        .then(() => true)
        .catch(() => false);
      if (!chosen) found.push(`${where}: the frame has no "AWS" link to choose`);
      else {
        found.push(...at(`${where} (/aws)`, await shows(page, 'Amazon Web Services')));
        const area = await layerReport(page, true);
        found.push(...at(`${where} (/aws)`, area.rootProblems));
        await page.goBack();
        await expect(page).toHaveURL(addressOf('/does-not-exist'));
        found.push(...at(where, await shows(page, 'Page not found')));
      }
      if (!(await stillSamePage(page))) found.push(`${where}: the page was reloaded`);
      await rest(page);
      const r = await layerReport(page, false);
      logReport(ctx, where, r);
      found.push(...at(where, leaks(r)));
    }
    expect(found).toEqual([]);
  });

  await lines.line(
    "Open `/aws`, `/aws/kinesis` and `/aws/does-not-exist`, at 1280 and 390, light and dark (the AWS area mounted, its component styles, base theme and `index-base.css` loaded) → no element of Studio's own layer (the frame, `html`, `body` and every ancestor of the area's root) has a Cloudscape class, and no rule outside the `studio` layer that declares a property other than a custom property matches any of them (R8.1)",
    async () => {
      const found: string[] = [...(await layer())];
      for (const width of WIDTHS) {
        for (const scheme of SCHEMES) {
          await look(page, width, scheme);
          for (const { path, h1 } of AREA_PAGES) {
            const where = `${path}, ${String(width)} wide, ${scheme}`;
            found.push(...at(where, await open(page, path, h1)));
            const r = await layerReport(page, true);
            logReport(ctx, where, r);
            found.push(...at(where, leaks(r)));
          }
        }
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

test('studio.studio-style-stays-outside-aws-area', async ({ ctx, page, browser }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const layer = studioLayer(page, ctx);

  /** Opens each area page in each scheme at 1280 and hands its report to `each`. */
  async function eachAreaPage(
    each: (where: string, r: LayerReport, scheme: Scheme) => Promise<string[]>,
  ): Promise<string[]> {
    const found: string[] = [];
    for (const scheme of SCHEMES) {
      await look(page, 1280, scheme);
      for (const { path, h1 } of AREA_PAGES) {
        const where = `${path}, ${scheme}`;
        found.push(...at(where, await open(page, path, h1)));
        found.push(...(await layer()));
        const r = await layerReport(page, true);
        logReport(ctx, where, r);
        found.push(...at(where, r.rootProblems));
        if (r.rootProblems.length === 0) found.push(...at(where, await each(where, r, scheme)));
      }
    }
    return [...new Set(found)];
  }

  await lines.line(
    "Open `/aws`, `/aws/kinesis` and `/aws/does-not-exist`, light and dark → no rule of the `studio` layer matches the area's root or any element inside it (R8.3)",
    async () => {
      const found = await eachAreaPage(async (_where, r) =>
        r.studioInside.map((s) => `a rule of the studio layer reaches into the area: ${s}`),
      );
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "The same pages → on `html`, `body` and every ancestor of the area's root, no rule of the `studio` layer declares an inherited property other than `color-scheme` and `--st-*` custom properties (R8.3)",
    async () => {
      const found = await eachAreaPage(async (_where, r) =>
        r.studioInheritedOnAncestors.map((s) => `a rule of the studio layer on an ancestor of the area: ${s}`),
      );
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "The same pages → at the area's root, `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `color`, `letter-spacing`, `word-spacing`, `text-transform` and `text-align` equal those of `html` in a Cloudscape reference document with `index-base.css`, carrying `awsui-dark-mode` in dark — light and dark (R8.3)",
    async () => {
      const found = await eachAreaPage(async (where, r, scheme) => {
        const reference = await indexBaseReference(browser, ctx, scheme);
        ctx.log(`${where}: text at the area's root ${JSON.stringify(r.rootText)}`);
        if (r.rootText === null) return ["the area's root has no text properties to read"];
        return TEXT_PROPERTIES.filter((p) => r.rootText![p] !== reference.html[p]).map(
          (p) => `${p} is "${r.rootText![p]}" at the area's root, "${reference.html[p]}" in the reference document`,
        );
      });
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "The same pages → the rules of Cloudscape's `index-base.css` match elements inside the area (its `html` and `body` rules the area's root) and no element outside it; Cloudscape's fonts are loaded from the Studio origin (R8.3a)",
    async () => {
      const families = cloudscapeFontFamilies(ctx);
      const foreignFonts: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (request.resourceType() === 'font' && url.protocol !== 'data:' && url.origin !== stack.studio.origin)
          foreignFonts.push(request.url());
      });
      const found = await eachAreaPage(async (where, _r, scheme) => {
        const reference = await indexBaseReference(browser, ctx, scheme);
        const base = await baseApplied(page, reference);
        ctx.log(`${where}: index-base rules checked on ${String(base.checked)} element-rule pairs`);
        const out = [...base.findings];
        if (base.checked === 0) out.push('no rule of index-base.css was checked against the area');
        const fonts = await fontFaces(page, families);
        ctx.log(`${where}: font faces ${JSON.stringify(fonts)}`);
        if (fonts.faces.length === 0) out.push(`the page has no @font-face for ${families.join(', ')}`);
        for (const face of fonts.faces) {
          const own = face.sheet.startsWith(`${stack.studio.origin}/`) || face.sheet.endsWith('in the page');
          if (!own) out.push(`@font-face ${face.family} sits in ${face.sheet}, not on the Studio origin`);
          for (const s of face.sources)
            if (s !== 'data:' && !s.startsWith(`${stack.studio.origin}/`))
              out.push(`@font-face ${face.family} loads ${s}, not from the Studio origin`);
        }
        if (fonts.loaded === 0) out.push(`no face of ${families.join(', ')} is loaded`);
        return out;
      });
      found.push(...foreignFonts.map((u) => `a font was requested from another origin: ${u}`));
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "The built app's stylesheets → every rule from Studio's own source is inside the `studio` layer, and no declaration in that layer is `!important`; every custom property declared in the `studio` layer is named `--st-*` (R7.2)",
    async () => {
      const found: string[] = [];
      const { files, outsideLayer } = studioSource(ctx);
      ctx.log(`Studio's own source: ${Object.keys(files).join(', ') || 'no .css file'}`);
      if (Object.keys(files).length === 0) found.push("Studio's own source has no .css file");
      found.push(...outsideLayer);
      // `/aws` loads every stylesheet of the built app: Studio's own and the AWS area's.
      await look(page, 1280, 'light');
      found.push(...at('/aws', await open(page, '/aws', 'Amazon Web Services')));
      const r = await sourceReport(page, files);
      ctx.log(`source in the built app: ${JSON.stringify(r)}`);
      if (r.studioRules === 0) found.push("the built app's stylesheets have no `studio` cascade layer");
      else if (r.inStudio === 0) found.push("the built app's `studio` layer holds no rule of Studio's own source");
      found.push(...r.outsideStudio);
      found.push(...r.important.map((s) => `!important in the studio layer: ${s}`));
      found.push(...r.foreignCustom.map((s) => `a custom property of the studio layer not named --st-*: ${s}`));
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

test('studio.colour-scheme-follows-the-system-in-both-layers', async ({ ctx, page, context, browser }) => {
  test.setTimeout(300_000);
  await startStack(ctx);
  const lines = new Lines(ctx);

  const schemeNow = (p: Page) => p.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

  await lines.line(
    "Open `/aws/kinesis` dark → the side navigation's computed `background-color` and its links' `color` equal those of a Cloudscape `SideNavigation` in a Cloudscape reference document with `index.css` and `applyMode` dark on `body`; light → equal to the same in light (R8.2a)",
    async () => {
      const found: string[] = [];
      for (const scheme of ['dark', 'light'] as const) {
        const where = `/aws/kinesis, ${scheme}`;
        await look(page, 1280, scheme);
        found.push(...at(where, await open(page, NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label)));
        const r = await layerReport(page, true);
        found.push(...at(where, r.rootProblems));
        const here = await navigationLook(page);
        const reference = await navigationReference(browser, ctx, scheme);
        ctx.log(`${where}: side navigation ${JSON.stringify(here)}`);
        if (here === null) {
          found.push(`${where}: no side navigation`);
          continue;
        }
        if (here.background !== reference.background)
          found.push(`${where}: background-color ${here.background}, reference ${reference.background}`);
        if (here.header !== reference.header)
          found.push(`${where}: header link color ${here.header}, reference ${reference.header}`);
        if (JSON.stringify([...here.links].sort()) !== JSON.stringify([...reference.links].sort()))
          found.push(
            `${where}: link colors ${JSON.stringify(here.links)}, reference ${JSON.stringify(reference.links)}`,
          );
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Open `/` dark → `html`'s computed `color-scheme` is `dark`; light → `light`; in each scheme the top bar's computed `background-color` equals the value, resolved in that scheme, of the `--st-*` token its `studio` layer rule names, and that token's dark and light values differ (R7.4)",
    async () => {
      const found: string[] = [];
      const values: Partial<Record<Scheme, Record<string, string>>> = {};
      for (const scheme of ['dark', 'light'] as const) {
        const where = `/, ${scheme}`;
        await look(page, 1280, scheme);
        found.push(...at(where, await open(page, '/', 'Home')));
        const colorScheme = await schemeNow(page);
        if (colorScheme !== scheme) found.push(`${where}: html's color-scheme is "${colorScheme}"`);
        const bar = await backgroundToken(page);
        ctx.log(`${where}: top bar background ${JSON.stringify(bar)}`);
        if (bar === null) {
          found.push(`${where}: the page has no Studio frame banner`);
          continue;
        }
        values[scheme] = bar.tokens;
        const named = Object.keys(bar.tokens);
        if (named.length === 0)
          found.push(`${where}: no studio layer rule names a --st-* token for the top bar's background`);
        else if (!Object.values(bar.tokens).includes(bar.computed))
          found.push(
            `${where}: the top bar's background-color ${bar.computed} is none of ${JSON.stringify(bar.tokens)}`,
          );
      }
      if (values.dark && values.light) {
        const both = Object.keys(values.dark).filter((t) => t in values.light!);
        if (both.length === 0) found.push('the top bar names no same --st-* token in dark and light');
        for (const t of both)
          if (values.dark[t] === values.light[t]) found.push(`${t} is ${values.dark[t]} in dark and in light`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "On `/aws/kinesis`, switch the browser's scheme from light to dark without a reload, before any other user action → `html`'s `color-scheme` is `dark` and the area's root has `awsui-dark-mode`; switch back → both light again (R7.4)",
    async () => {
      const found: string[] = [];
      await look(page, 1280, 'light');
      found.push(...(await open(page, NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label)));
      const first = await layerReport(page, true);
      found.push(...first.rootProblems);
      if (found.length > 0) {
        expect(found).toEqual([]);
        return;
      }
      await markPage(page);
      const state = async () => {
        const r = await layerReport(page, true);
        return {
          html: await schemeNow(page),
          rootDarkMode: r.rootDarkMode,
          outside: r.darkModeOutside.length,
          holders: r.darkModeHolders.length,
        };
      };
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect
        .poll(state, { timeout: 5_000, message: 'after switching to dark' })
        .toMatchObject({ html: 'dark', rootDarkMode: true, outside: 0 });
      await page.emulateMedia({ colorScheme: 'light' });
      await expect
        .poll(state, { timeout: 5_000, message: 'after switching back to light' })
        .toEqual({ html: 'light', rootDarkMode: false, outside: 0, holders: 0 });
      expect(await stillSamePage(page), 'the page was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'Open `/`, `/aws/kinesis` and reload → nothing in `localStorage`, `sessionStorage` or cookies records a colour scheme, and the page has no control that sets one (R7.4)',
    async () => {
      const found: string[] = [];
      const SCHEME_WORDS = /dark|light|scheme|theme|colou?r|appearance|mode/i;
      const controls = async (where: string) => {
        const names = /dark|light|theme|colou?r ?scheme|appearance/i;
        for (const role of [
          'button',
          'switch',
          'checkbox',
          'radio',
          'combobox',
          'menuitem',
          'menuitemradio',
          'tab',
          'link',
          'option',
        ] as const) {
          const hits = await page.getByRole(role, { name: names }).filter({ visible: true }).allInnerTexts();
          for (const h of hits) found.push(`${where}: a ${role} "${h.trim()}" looks like a colour scheme control`);
        }
      };
      await look(page, 1280, 'light');
      found.push(...at('/', await open(page, '/', 'Home')));
      await controls('/');
      found.push(...at(NO_SCREEN_SERVICE.path, await open(page, NO_SCREEN_SERVICE.path, NO_SCREEN_SERVICE.label)));
      found.push(...at(NO_SCREEN_SERVICE.path, (await layerReport(page, true)).rootProblems));
      await page.reload();
      found.push(...at('/aws/kinesis reloaded', await shows(page, NO_SCREEN_SERVICE.label)));
      await controls(NO_SCREEN_SERVICE.path);
      const storage = await page.evaluate(() => ({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      }));
      const cookies = await context.cookies();
      ctx.log(`storage ${JSON.stringify(storage)}, cookies ${JSON.stringify(cookies.map((c) => c.name))}`);
      for (const [where, entries] of [
        ['localStorage', storage.local],
        ['sessionStorage', storage.session],
        ['cookies', cookies.map((c) => [c.name, c.value] as [string, string])],
      ] as const) {
        for (const [k, v] of entries)
          if (SCHEME_WORDS.test(k) || SCHEME_WORDS.test(v)) found.push(`${where} holds ${k}=${v.slice(0, 60)}`);
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

test('studio.own-layer-contrast-and-focus', async ({ ctx, page }) => {
  test.setTimeout(600_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const lines = new Lines(ctx);
  const text: string[] = [];
  const focus: string[] = [];

  /** Measures the page in both schemes: its text, and its focus indicators and order with Tab. */
  async function measure(name: string, path: string, h1: string, home: Record<string, unknown> | null): Promise<void> {
    for (const scheme of SCHEMES) {
      const where = `${name}, ${path}, ${scheme}`;
      await look(page, 1280, scheme);
      const opened = await open(page, path, h1);
      if (home !== null) {
        const reached = await expect
          .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS })
          .toMatchObject(home)
          .then(() => [])
          .catch(() => [`Home does not show ${JSON.stringify(home)}`]);
        opened.push(...reached);
      }
      await rest(page);
      text.push(...at(where, opened));
      focus.push(...at(where, opened));

      const t = await textContrast(page);
      ctx.log(`${where}: ${String(t.checked)} text nodes measured`);
      if (t.checked === 0) text.push(`${where}: no visible text of Studio's own layer to measure`);
      text.push(...at(where, t.failures));

      const sweep = await tabSweep(page);
      const own = sweep.stops.filter((s) => !s.inArea);
      ctx.log(`${where}: Tab stops ${own.map((s) => `${s.describe} (${s.detail})`).join(' → ')}`);
      if (own.length === 0) focus.push(`${where}: Tab reaches nothing of Studio's own layer`);
      for (const s of own) {
        if (s.indicator === null) focus.push(`${where}: ${s.describe} shows no visible focus indicator`);
        else if (s.ratio + 1e-9 < 3) focus.push(`${where}: ${s.describe}'s focus indicator, ${s.detail}, is below 3:1`);
      }
      focus.push(...at(where, orderProblems(own)));
      const reached = new Set(own.map((s) => s.index));
      sweep.tabbable.forEach((d, i) => {
        if (!reached.has(i)) focus.push(`${where}: ${d} is never focused with Tab`);
      });
    }
  }

  await measure('emulator running', '/', 'Home', {
    engine: { status: 'Connected' },
    emulator: { status: 'Connected' },
  });
  await measure('emulator running', '/does-not-exist', 'Page not found', null);
  await emulator.stop();
  await measure('emulator stopped', '/', 'Home', { emulator: { status: 'Not started' } });
  await emulator.startAgain();
  await emulator.kill();
  await measure('emulator killed', '/', 'Home', { emulator: { status: 'Unreachable' } });
  await stack.engine.stop();
  await measure('engine stopped', '/', 'Home', { engine: { status: 'Unreachable' } });

  await lines.line(
    "Open `/` with the emulator running, with it stopped, with it killed and with the engine stopped, and `/does-not-exist`, light and dark → every visible text node of Studio's own layer has a contrast ratio of at least 4.5:1 against the background behind it, 3:1 for text of 24px, or 18.66px at weight 700 and above (R7.5)",
    async () => expect(text).toEqual([]),
  );
  await lines.line(
    "The same pages → each focusable element of Studio's own layer, focused with Tab, shows an indicator whose colour has at least 3:1 contrast against the background next to it, and Tab order follows the visible order (R7.5)",
    async () => expect(focus).toEqual([]),
  );

  lines.end();
});
