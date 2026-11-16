// The document's icons as Studio serves them (test-criteria.md, issue 36, Flow; requirement R7), in the built app
// served by `bun run serve` in front of a real engine and the run's emulator:
//
// - `studio.document-icons-are-served-as-images`: the page links the three fixed-path files from Studio's own
//   origin, and Studio's server answers each with the image, its type and `Cache-Control: no-cache`;
// - `studio.favicon-follows-the-colour-scheme`: `/favicon.svg` as served is drawn in the light form in a light scheme
//   and in the dark form in a dark one, and every entry of `/favicon.ico` is the light form.
//
// Words: `support/frame-logo.ts`, `support/brand.ts`. Colours are the tokens of `tokens.css` read at run time.

import fs from 'node:fs';
import path from 'node:path';

import type { Page, Request, Response } from '@playwright/test';

import {
  CODE_SIGN_BOX,
  drawSvgTile,
  expect,
  expectedIconLinks,
  fetchRaw,
  FIXED_PATH_FILES,
  formProblems,
  iconLinks,
  icoEntries,
  measureTile,
  mediaType,
  NO_SCREEN_SERVICE,
  onTile,
  readBrandBytes,
  schemeTokens,
  startStack,
  test,
  tileColoursOf,
  tileForm,
  type Scheme,
} from './support';
import { ACTION, frame } from './support/frame';
import { Lines } from './support/lines';

/** The page's own `h1` is drawn: the document has rendered. */
async function rendered(page: Page): Promise<void> {
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: ACTION.timeout });
}

/** An icon request: an image, or one of the icon files by its name. */
function isIconRequest(request: Request): boolean {
  const { pathname } = new URL(request.url());
  return (
    request.resourceType() === 'image' ||
    /\.(ico|png|svg)$/i.test(pathname) ||
    /favicon|apple-touch-icon/i.test(pathname)
  );
}

test('studio.document-icons-are-served-as-images', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const studio = stack.studio;
  const lines = new Lines(ctx);
  const expected = expectedIconLinks(studio.origin);
  const index = fs.readFileSync(path.join(ctx.studioDir, 'dist', 'index.html'));
  const relsAndAddresses = async () => (await iconLinks(page)).map((l) => ({ rel: l.rel, resolved: l.resolved }));

  await lines.line(
    "Open `/` → the document's `head` links `/favicon.ico`, `/favicon.svg` and `/apple-touch-icon.png` in that order, and each address resolves to Studio's own origin",
    async () => {
      await page.goto('/');
      await rendered(page);
      const links = await iconLinks(page);
      ctx.log(`icon links on /: ${JSON.stringify(links)}`);
      expect(
        links.map((l) => ({ rel: l.rel, resolved: l.resolved })),
        "the head's icon links, in order",
      ).toEqual(expected);
    },
  );

  await lines.line(
    "Open `/aws/kinesis/streams` and `/does-not-exist/deeper/still` directly → the same three links resolve to the same three addresses at Studio's origin, not under the page's path",
    async () => {
      const found: string[] = [];
      for (const p of [NO_SCREEN_SERVICE.below, '/does-not-exist/deeper/still']) {
        await page.goto(p);
        await rendered(page);
        const links = await relsAndAddresses();
        ctx.log(`icon links on ${p}: ${JSON.stringify(links)}`);
        if (JSON.stringify(links) !== JSON.stringify(expected)) found.push(`${p}: ${JSON.stringify(links)}`);
      }
      expect(found, `icon links that are not ${JSON.stringify(expected)}`).toEqual([]);
    },
  );

  await lines.line(
    "Request each fixed-path file from Studio's server → the image itself with its type (`image/x-icon`, `image/svg+xml`, `image/png`), byte for byte the brand file, and not the page",
    async () => {
      const found: string[] = [];
      for (const f of FIXED_PATH_FILES) {
        const answer = await fetchRaw(studio.port, f.path);
        ctx.log(
          `GET ${f.path}: ${String(answer.status)} ${answer.headers['content-type'] ?? ''}, ${String(answer.body.length)} bytes`,
        );
        const brand = readBrandBytes(ctx, f.name);
        if (answer.status !== 200) found.push(`${f.path}: status ${String(answer.status)}`);
        if (mediaType(answer) !== f.type)
          found.push(`${f.path}: type "${answer.headers['content-type'] ?? ''}", not ${f.type}`);
        if (answer.body.equals(index)) found.push(`${f.path}: the page itself`);
        if (brand === null) found.push(`${f.path}: the brand file ${f.name} does not exist`);
        else if (!answer.body.equals(brand)) found.push(`${f.path}: not byte for byte the brand file ${f.name}`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'The same requests → each answer says `Cache-Control: no-cache`; a file under `/assets/` still says `immutable`, and `/` still says `no-cache`',
    async () => {
      const found: string[] = [];
      for (const f of FIXED_PATH_FILES) {
        const cache = (await fetchRaw(studio.port, f.path)).headers['cache-control'] ?? '(none)';
        ctx.log(`GET ${f.path}: Cache-Control ${cache}`);
        if (cache.trim() !== 'no-cache') found.push(`${f.path}: Cache-Control ${cache}`);
      }
      const asset = fs
        .readdirSync(path.join(ctx.studioDir, 'dist', 'assets'))
        .filter((n) => /\.(js|css)$/.test(n))
        .sort()[0];
      if (asset === undefined) found.push('no built file under dist/assets/ to request');
      else {
        const cache = (await fetchRaw(studio.port, `/assets/${asset}`)).headers['cache-control'] ?? '(none)';
        ctx.log(`GET /assets/${asset}: Cache-Control ${cache}`);
        if (!/\bimmutable\b/.test(cache)) found.push(`/assets/${asset}: Cache-Control ${cache}`);
      }
      const root = (await fetchRaw(studio.port, '/')).headers['cache-control'] ?? '(none)';
      ctx.log(`GET /: Cache-Control ${root}`);
      if (root.trim() !== 'no-cache') found.push(`/: Cache-Control ${root}`);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "Request `/favicon.png`, `/brand/symbol.svg` and `/logo-primary-light.svg` → the page (the server's fallback for a path that is no file), as an unknown path answered before: the masters of `studio/brand/` are not served",
    async () => {
      const found: string[] = [];
      for (const p of ['/favicon.png', '/brand/symbol.svg', '/logo-primary-light.svg']) {
        const answer = await fetchRaw(studio.port, p);
        ctx.log(
          `GET ${p}: ${String(answer.status)} ${answer.headers['content-type'] ?? ''}, ${String(answer.body.length)} bytes`,
        );
        if (answer.status !== 200 || mediaType(answer) !== 'text/html' || !answer.body.equals(index)) {
          found.push(`${p}: ${String(answer.status)} ${answer.headers['content-type'] ?? ''}, not the page`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  // The check's page with its cache emptied and turned off: every request and every script and stylesheet recorded.
  const requests: Request[] = [];
  const bodies: { url: string; kind: string; body: string }[] = [];
  const pending: Promise<unknown>[] = [];
  const recordRequest = (r: Request) => requests.push(r);
  const recordResponse = (response: Response) => {
    const type = response.request().resourceType();
    const contentType = response.headers()['content-type'] ?? '';
    const kind =
      type === 'script' || /javascript/.test(contentType)
        ? 'script'
        : type === 'stylesheet' || /text\/css/.test(contentType)
          ? 'stylesheet'
          : null;
    if (kind === null) return;
    pending.push(
      response
        .body()
        .then((b) => bodies.push({ url: response.url(), kind, body: b.toString('utf8') }))
        .catch(() => bodies.push({ url: response.url(), kind, body: '' })),
    );
  };

  await lines.line(
    "Open `/` with an empty cache and record every request until the page is idle → every icon request goes to Studio's origin; none goes to the engine, the emulator or another host",
    async () => {
      await page.goto('about:blank');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      context.on('request', recordRequest);
      context.on('response', recordResponse);
      await page.goto('/');
      await rendered(page);
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      await Promise.all(pending);
      ctx.log(`requests of a fresh load of /: ${requests.map((r) => `${r.resourceType()} ${r.url()}`).join(', ')}`);
      const icons = requests.filter(isIconRequest);
      ctx.log(`icon requests: ${icons.map((r) => r.url()).join(', ') || 'none'}`);
      expect(
        icons.filter((r) => new URL(r.url()).origin !== studio.origin).map((r) => r.url()),
        "icon requests to another origin than Studio's",
      ).toEqual([]);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await cdp.detach();
    },
  );

  await lines.line(
    'The same recording → no script and no stylesheet of a provider area is requested, as before this issue',
    async () => {
      expect(bodies.length, 'scripts and stylesheets received').toBeGreaterThan(0);
      expect(
        bodies.filter((b) => b.body.includes('awsui_')).map((b) => `${b.kind} ${b.url}`),
        'scripts and stylesheets with a Cloudscape class name (a provider area)',
      ).toEqual([]);
    },
  );
  context.off('request', recordRequest);
  context.off('response', recordResponse);

  await lines.line(
    "Reload `/`, then go to `/aws` and back to `/` → the document's three icon links are unchanged each time",
    async () => {
      const found: string[] = [];
      await page.goto('/');
      await rendered(page);
      const first = await iconLinks(page);
      if (JSON.stringify(first.map((l) => ({ rel: l.rel, resolved: l.resolved }))) !== JSON.stringify(expected)) {
        found.push(`on /: ${JSON.stringify(first)}`);
      }
      const same = async (where: string) => {
        const now = await iconLinks(page);
        if (JSON.stringify(now) !== JSON.stringify(first)) found.push(`${where}: ${JSON.stringify(now)}`);
      };
      await page.reload();
      await rendered(page);
      await same('after the reload');
      await frame(page).aws.click(ACTION);
      await expect(page.getByRole('heading', { level: 1, name: 'Amazon Web Services', exact: true })).toBeVisible();
      await same('on /aws');
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
      await same('back on /');
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

test('studio.favicon-follows-the-colour-scheme', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const token = await schemeTokens(page, ctx);
  const svgAnswer = await fetchRaw(stack.studio.port, '/favicon.svg');
  const icoAnswer = await fetchRaw(stack.studio.port, '/favicon.ico');
  ctx.log(
    `GET /favicon.svg: ${String(svgAnswer.status)} ${svgAnswer.headers['content-type'] ?? ''}; GET /favicon.ico: ${String(icoAnswer.status)} ${icoAnswer.headers['content-type'] ?? ''}`,
  );
  const served = () => {
    expect({ status: svgAnswer.status, type: mediaType(svgAnswer) }, '/favicon.svg as served: an SVG image').toEqual({
      status: 200,
      type: 'image/svg+xml',
    });
    return svgAnswer.body.toString('utf8');
  };
  const drawn = new Map<Scheme, Awaited<ReturnType<typeof drawSvgTile>>>();
  const drawIn = async (scheme: Scheme) => {
    await page.emulateMedia({ colorScheme: scheme });
    const t = await drawSvgTile(page, served(), 64);
    drawn.set(scheme, t);
    return t;
  };

  for (const scheme of ['light', 'dark'] as const) {
    await lines.line(
      scheme === 'light'
        ? 'Draw `/favicon.svg` as served, in a light scheme at 64 → the ground is the `accent` colour (light) and the symbol the `accent-ink` colour (light)'
        : 'Draw it in a dark scheme at 64 → the ground is the `accent` colour (dark) and the symbol the `accent-ink` colour (dark)',
      async () => {
        const t = await drawIn(scheme);
        const form = tileForm(t.drawing, t.tile, tileColoursOf(token, scheme));
        ctx.log(`/favicon.svg at 64, ${scheme}: ${JSON.stringify(form)}`);
        expect(formProblems(form, `/favicon.svg at 64, ${scheme}`)).toEqual([]);
      },
    );
  }

  await lines.line('Both drawings → the same ink shape, one hole, and no code sign', async () => {
    const found: string[] = [];
    const measured = (['light', 'dark'] as const).map((scheme) => {
      const t = drawn.get(scheme);
      if (!t) throw new Error(`/favicon.svg was not drawn in the ${scheme} scheme`);
      return { scheme, t, m: measureTile(t, tileColoursOf(token, scheme)) };
    });
    for (const { scheme, t, m } of measured) {
      ctx.log(
        `/favicon.svg at 64, ${scheme}: holes ${JSON.stringify(m.holes)}, other pieces ${JSON.stringify(m.others)}`,
      );
      if (m.holes.length !== 1) found.push(`${scheme}: ${String(m.holes.length)} holes in the symbol, not one`);
      const box = onTile(t, CODE_SIGN_BOX);
      let stray = 0;
      for (let y = box.top; y < box.bottom; y++) {
        for (let x = box.left; x < box.right; x++) {
          const i = y * t.drawing.width + x;
          if (m.ink.bits[i] && !m.symbol.bits[i]) stray++;
        }
      }
      if (stray > 0)
        found.push(`${scheme}: ${String(stray)} pixels of ink in the code sign's box that are not the symbol's`);
    }
    const [a, b] = measured as [(typeof measured)[0], (typeof measured)[0]];
    let differ = 0;
    let ink = 0;
    for (let i = 0; i < a.m.symbol.bits.length; i++) {
      if (a.m.symbol.bits[i]) ink++;
      if (a.m.symbol.bits[i] !== b.m.symbol.bits[i]) differ++;
    }
    ctx.log(`the symbol's ink: ${String(ink)} pixels in light, ${String(differ)} differ in dark`);
    if (ink === 0 || differ > 0.02 * ink) {
      found.push(`the symbol's ink differs between the schemes in ${String(differ)} of ${String(ink)} pixels`);
    }
    expect(found).toEqual([]);
  });

  await lines.line(
    'Draw each entry of `/favicon.ico` with the page in a dark scheme → each is the light form: ground `accent` (light), symbol `accent-ink` (light)',
    async () => {
      expect({ status: icoAnswer.status, type: mediaType(icoAnswer) }, '/favicon.ico as served: an icon').toEqual({
        status: 200,
        type: 'image/x-icon',
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      const entries = await icoEntries(page, icoAnswer.body);
      expect(entries.length, 'entries of /favicon.ico').toBeGreaterThan(0);
      const found: string[] = [];
      for (const e of entries) {
        const form = tileForm(e.drawing, e.tile, tileColoursOf(token, 'light'));
        ctx.log(`/favicon.ico entry ${String(e.side)}, page dark: ${JSON.stringify(form)}`);
        found.push(...formProblems(form, `/favicon.ico entry ${String(e.side)}`));
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});
