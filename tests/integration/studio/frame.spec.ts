// Studio's frame between its own layer and the AWS area, and the AWS area's code loaded only when the area is opened,
// in the built app served by `bun run serve` in front of a real engine and the run's emulator (test-criteria.md,
// issue 16, Integration checks): `studio.frame-leads-between-layers`, `studio.aws-area-loads-only-when-opened`.

import type { Page, Response } from '@playwright/test';

import { expect, startStack, test } from './support';
import {
  ACTION,
  addressOf,
  cloudscapeElements,
  expectHome,
  expectInAwsArea,
  frame,
  heading,
  providersSection,
  titleOf,
} from './support/frame';
import { Lines } from './support/lines';
import { lookOf, markDiffers, type LinkLook } from './support/marks';

/** Each page of R4.4 with its `h1`; `null` is Home. */
const PAGES: { path: string; h1: string | null }[] = [
  { path: '/', h1: null },
  { path: '/aws', h1: 'Amazon Web Services' },
  { path: '/aws/s3', h1: 'Amazon Simple Storage Service' },
  { path: '/aws/does-not-exist', h1: 'Page not found' },
  { path: '/does-not-exist', h1: 'Page not found' },
];

async function openPage(page: Page, path: string, h1: string | null): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1 ?? 'Home')).toBeVisible();
}

/** Moves the pointer off the frame and drops focus, so no link is hovered or focused while it is measured. */
async function rest(page: Page): Promise<void> {
  const size = page.viewportSize();
  await page.mouse.move(1, (size?.height ?? 800) - 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('studio.frame-leads-between-layers', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  await startStack(ctx);
  const lines = new Lines(ctx);
  const f = frame(page);

  await lines.line(
    'Open `/`, choose "AWS" in the frame → `/aws`, header "Amazon Web Services", "AWS" marked current; choose "Home" in the frame → `/`, "Home" marked current; choose "Amazon Web Services" in Home\'s "Providers" → `/aws`; choose "EmuForge Studio" → `/`',
    async () => {
      await page.goto('/');
      await expectHome(page);
      await f.aws.click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws'));
      await expectInAwsArea(page, 'Amazon Web Services');
      await expect(f.aws).toHaveAttribute('aria-current', 'page');
      await f.home.click(ACTION);
      await expectHome(page);
      await expect(f.home).toHaveAttribute('aria-current', 'page');
      await providersSection(page).getByRole('link', { name: 'Amazon Web Services', exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws'));
      await expectInAwsArea(page, 'Amazon Web Services');
      await f.wordmark.click(ACTION);
      await expectHome(page);
    },
  );

  await lines.line(
    "Each of `/`, `/aws`, `/aws/s3`, `/aws/does-not-exist` and `/does-not-exist` → exactly one `main` landmark, the frame's banner outside it, and the document title of R4.4",
    async () => {
      const found: string[] = [];
      for (const { path, h1 } of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }), `the page at ${path}`).toBeVisible();
        const own = await heading(page, h1 ?? 'Home')
          .waitFor({ state: 'visible', ...ACTION })
          .then(() => true)
          .catch(() => false);
        if (!own) found.push(`${path}: no "${h1 ?? 'Home'}" header`);
        const title = await page.title();
        if (title !== titleOf(h1)) found.push(`${path}: the title is "${title}", not "${titleOf(h1)}"`);
        const mains = await page.getByRole('main').count();
        if (mains !== 1) found.push(`${path}: ${String(mains)} main landmarks`);
        if ((await f.banner.count()) !== 1) {
          found.push(`${path}: ${String(await f.banner.count())} frame banners`);
          continue;
        }
        const nested = await f.banner.evaluate(
          (banner) =>
            [...document.querySelectorAll('main, [role="main"]')].some((m) => m.contains(banner) || banner.contains(m)),
          undefined,
          ACTION,
        );
        if (nested) found.push(`${path}: the frame's banner and a main landmark are nested`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open `/`, `/aws` and `/aws/s3`, light and dark, at 1280 and 390 → the frame link with `aria-current` differs from the frame link without it in computed `color` and in a second visible property that is not a colour of the text; on `/does-not-exist` no frame link shows that mark (R5.1)',
    async () => {
      const found: string[] = [];
      for (const width of [1280, 390]) {
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
          await page.emulateMedia({ colorScheme });
          let unmarked: LinkLook | null = null;
          for (const { path, h1, current, other } of [
            { path: '/', h1: null, current: f.home, other: f.aws },
            { path: '/aws', h1: 'Amazon Web Services', current: f.aws, other: f.home },
            { path: '/aws/s3', h1: 'Amazon Simple Storage Service', current: f.aws, other: f.home },
          ]) {
            const where = `${path}, ${String(width)} wide, ${colorScheme}`;
            await openPage(page, path, h1);
            await rest(page);
            if ((await current.getAttribute('aria-current', ACTION)) === null) {
              found.push(`${where}: the current link has no aria-current`);
              continue;
            }
            const marked = await lookOf(current);
            const plain = await lookOf(other);
            if (path === '/') unmarked = await lookOf(f.aws);
            const second = markDiffers(marked, plain);
            ctx.log(
              `${where}: color ${marked.color} vs ${plain.color}; also drawn differently: ${second.map((n) => `${n} ${marked.mark[n] ?? 'none'} vs ${plain.mark[n] ?? 'none'}`).join('; ') || 'nothing'}`,
            );
            if (marked.color === plain.color) found.push(`${where}: the marked link has the same color as the other`);
            if (second.length === 0) {
              found.push(
                `${where}: the marked link differs in no visible property besides the text colour${marked.cursor !== plain.cursor ? ' (only in cursor)' : ''}`,
              );
            }
          }
          const where = `/does-not-exist, ${String(width)} wide, ${colorScheme}`;
          await openPage(page, '/does-not-exist', 'Page not found');
          await rest(page);
          for (const [name, link] of [
            ['Home', f.home],
            ['AWS', f.aws],
          ] as const) {
            if ((await link.getAttribute('aria-current', ACTION)) !== null)
              found.push(`${where}: "${name}" has aria-current`);
            if (unmarked === null) continue;
            const look = await lookOf(link);
            const differs = markDiffers(look, unmarked);
            if (look.color !== unmarked.color) differs.unshift('color');
            if (differs.length > 0)
              found.push(`${where}: "${name}" is drawn unlike an unmarked link: ${differs.join(', ')}`);
          }
        }
      }
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 1280, height: 800 });
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open `/` and `/aws/s3` at 390 wide → "EmuForge Studio", "Home" and "AWS" are each inside the viewport and inside the bar, and the page does not scroll sideways — 390 wide',
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const found: string[] = [];
      for (const { path, h1 } of [
        { path: '/', h1: null },
        { path: '/aws/s3', h1: 'Amazon Simple Storage Service' },
      ]) {
        await openPage(page, path, h1);
        const bar = await f.banner.boundingBox(ACTION);
        if (bar === null) {
          found.push(`${path}: the frame's banner is not drawn`);
          continue;
        }
        for (const [name, link] of [
          ['EmuForge Studio', f.wordmark],
          ['Home', f.home],
          ['AWS', f.aws],
        ] as const) {
          await expect(link, `"${name}" on ${path}`).toBeVisible();
          const box = await link.boundingBox(ACTION);
          if (box === null) {
            found.push(`${path}: "${name}" is not drawn`);
            continue;
          }
          const inViewport = box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844;
          const inBar =
            box.x >= bar.x - 0.5 &&
            box.y >= bar.y - 0.5 &&
            box.x + box.width <= bar.x + bar.width + 0.5 &&
            box.y + box.height <= bar.y + bar.height + 0.5;
          if (!inViewport) found.push(`${path}: "${name}" is outside the viewport (${JSON.stringify(box)})`);
          if (!inBar)
            found.push(`${path}: "${name}" is outside the bar (${JSON.stringify(box)} in ${JSON.stringify(bar)})`);
        }
        const scrolls = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        if (scrolls) found.push(`${path}: the page scrolls sideways`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

/** A script or stylesheet the browser received, with its body. */
interface Received {
  url: string;
  kind: 'script' | 'stylesheet';
  body: string;
  at: number;
}

/** Records every script and stylesheet the page receives, by resource type or by content type. */
function recordAssets(page: Page): { received: Received[]; settle: () => Promise<void> } {
  const received: Received[] = [];
  const pending: Promise<unknown>[] = [];
  page.on('response', (response: Response) => {
    const type = response.request().resourceType();
    const contentType = response.headers()['content-type'] ?? '';
    const kind =
      type === 'script' || /javascript/.test(contentType)
        ? 'script'
        : type === 'stylesheet' || /text\/css/.test(contentType)
          ? 'stylesheet'
          : null;
    if (kind === null) return;
    const at = Date.now();
    pending.push(
      response
        .body()
        .then((body) => received.push({ url: response.url(), kind, body: body.toString('utf8'), at }))
        .catch(() => received.push({ url: response.url(), kind, body: '', at })),
    );
  });
  return { received, settle: async () => void (await Promise.all(pending)) };
}

/** The scripts and stylesheets of `received` whose text holds a Cloudscape class name. */
function withCloudscape(received: Received[]): string[] {
  return received.filter((r) => r.body.includes('awsui_')).map((r) => `${r.kind} ${new URL(r.url).pathname}`);
}

test('studio.aws-area-loads-only-when-opened', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  // Every load of this check fetches what it needs, so each fresh page's scripts and stylesheets are observed.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const assets = recordAssets(page);

  await lines.line(
    'Open `/` in a fresh page and wait for "Connected" → no script or stylesheet the page received contains a Cloudscape class name (`awsui_`), and no element has a Cloudscape class (R6.3)',
    async () => {
      await page.goto('/');
      await expect(page.getByText('Connected', { exact: true }), 'both rows "Connected"').toHaveCount(2);
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      await assets.settle();
      expect(assets.received.length, 'scripts and stylesheets received').toBeGreaterThan(0);
      expect(withCloudscape(assets.received), 'received with a Cloudscape class name').toEqual([]);
      expect(await cloudscapeElements(page), 'elements with a Cloudscape class').toEqual([]);
    },
  );

  let choice = 0;
  await lines.line('The same for Studio\'s "Page not found" at `/does-not-exist` → the same', async () => {
    choice = Date.now();
    await page.goto('/does-not-exist');
    await expect(heading(page, 'Page not found')).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await assets.settle();
    const here = assets.received.filter((r) => r.at >= choice);
    expect(here.length, 'scripts and stylesheets received').toBeGreaterThan(0);
    expect(withCloudscape(here), 'received with a Cloudscape class name').toEqual([]);
    expect(await cloudscapeElements(page), 'elements with a Cloudscape class').toEqual([]);
  });

  await lines.line(
    'Then choose "AWS" → the AWS area renders, and the scripts and stylesheets it needed came from the Studio origin after that choice',
    async () => {
      await assets.settle();
      choice = Date.now();
      await frame(page).aws.click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws'));
      await expectInAwsArea(page, 'Amazon Web Services');
      await page.waitForLoadState('networkidle', { timeout: 10_000 });
      await assets.settle();
      const after = assets.received.filter((r) => r.at >= choice);
      ctx.log(`received after choosing "AWS": ${after.map((r) => `${r.kind} ${r.url}`).join(', ') || 'nothing'}`);
      expect(
        after.filter((r) => r.kind === 'script' && r.body.includes('awsui_')).map((r) => r.url).length,
        'scripts with the AWS area’s Cloudscape code received after the choice',
      ).toBeGreaterThan(0);
      expect(
        after.filter((r) => new URL(r.url).origin !== stack.studio.origin).map((r) => r.url),
        'scripts and stylesheets from another origin',
      ).toEqual([]);
    },
  );

  lines.end();
});
