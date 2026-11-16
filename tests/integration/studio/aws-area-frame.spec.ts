// The AWS area's frame parts in the built app served by `bun run serve`, in front of a real engine started for that
// Studio and a real emulator (test-criteria.md, issue 45, Flow checks; requirement R3, R4, R7): the breadcrumbs that
// start at EmuForge, and the emulator line ("Local emulator, not AWS") in its states as the engine reports them while
// the check stops and starts the emulator and the engine.
//
// `studio.aws-area-breadcrumbs-start-at-emuforge`, `studio.aws-area-emulator-line-shows-connected-endpoint`,
// `studio.aws-area-emulator-line-follows-emulator-stop-and-start`,
// `studio.aws-area-emulator-line-shows-engine-unreachable`, `studio.aws-area-emulator-line-keyboard-and-layout`,
// `studio.aws-area-shows-no-image`.
//
// Words: `support/aws-area.ts`. An endpoint, a port or the engine's origin is always the run's value.

import type { Page, Request } from '@playwright/test';

import { expect, startStack, test } from './support';
import {
  ABOUT_CONTROL,
  areaImages,
  LINE_CHANGE_BOUND_MS,
  CONNECTION_STATUS,
  connectedAt,
  connectionStatusLink,
  crumbLink,
  crumbs,
  documentIcons,
  emulatorLine,
  engineNotAnswering,
  expectLine,
  frameOrder,
  LINE_LABEL,
  lineContrast,
  lineControls,
  lineText,
  lineWidth,
  noticeParts,
  notStartedOn,
  reachableCrumbs,
} from './support/aws-area';
import {
  contentStopProblems,
  describeStop,
  expectNextContentStop,
  expectTarget,
  focusRing,
  hasFocus,
  pressTab,
} from './support/focus';
import { ACTION, addressOf, expectHome, frame, heading, SIDE_NAVIGATION } from './support/frame';
import { connectionView, markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';

const AWS = 'Amazon Web Services';
const S3 = 'Amazon Simple Storage Service';
const NOT_FOUND = 'Page not found';
const GO_HOME = 'Go to Home';
const SKIP = 'Skip to content';
const NO_SCREEN_S3 = `Studio has no screen for ${S3} yet.`;
const INDEX_DESCRIPTION =
  'EmuForge Studio works with a local emulator of AWS services. It is a stand-alone tool, not the AWS console and not an AWS feature.';

/** The area's three own pages, each with its `h1`. */
const PAGES = [
  { path: '/aws', h1: AWS },
  { path: '/aws/s3', h1: S3 },
  { path: '/aws/does-not-exist', h1: NOT_FOUND },
];

async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(addressOf(path));
  await expect(heading(page, h1)).toBeVisible();
}

async function narrow(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
}

async function wide(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-area-breadcrumbs-start-at-emuforge', async ({ ctx, page }) => {
  await startStack(ctx);
  const lines = new Lines(ctx);
  const f = frame(page);

  await lines.line('Open `/aws` → the crumbs are "EmuForge", "AWS"', async () => {
    await open(page, '/aws', AWS);
    await expect.poll(() => crumbs(page), { message: 'the crumbs' }).toEqual(['EmuForge', 'AWS']);
  });

  await lines.line(
    'Open `/aws/s3` → the crumbs are "EmuForge", "AWS", "S3"; open `/aws/dynamodb/tables/orders` → "EmuForge", "AWS", "DynamoDB"',
    async () => {
      await open(page, '/aws/s3', S3);
      await expect.poll(() => crumbs(page), { message: 'the crumbs on /aws/s3' }).toEqual(['EmuForge', 'AWS', 'S3']);
      await open(page, '/aws/dynamodb/tables/orders', 'Amazon DynamoDB');
      await expect
        .poll(() => crumbs(page), { message: 'the crumbs on /aws/dynamodb/tables/orders' })
        .toEqual(['EmuForge', 'AWS', 'DynamoDB']);
    },
  );

  await lines.line('Open `/aws/does-not-exist` → the crumbs are "EmuForge", "AWS", "Page not found"', async () => {
    await open(page, '/aws/does-not-exist', NOT_FOUND);
    await expect.poll(() => crumbs(page), { message: 'the crumbs' }).toEqual(['EmuForge', 'AWS', NOT_FOUND]);
  });

  await lines.line(
    'On each of those pages → no crumb reads "Amazon Web Services", and the frame\'s "AWS" is marked current',
    async () => {
      const found: string[] = [];
      for (const { path, h1 } of [
        { path: '/aws', h1: AWS },
        { path: '/aws/s3', h1: S3 },
        { path: '/aws/dynamodb/tables/orders', h1: 'Amazon DynamoDB' },
        { path: '/aws/does-not-exist', h1: NOT_FOUND },
      ]) {
        await open(page, path, h1);
        const shown = await crumbs(page);
        if (shown.length === 0) found.push(`${path}: no crumb is shown`);
        if (shown.includes(AWS)) found.push(`${path}: a crumb reads "${AWS}" (${JSON.stringify(shown)})`);
        const current = await f.aws.getAttribute('aria-current', ACTION);
        if (current !== 'page') found.push(`${path}: the frame's "AWS" has aria-current ${String(current)}`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'On `/aws/s3`, choose "AWS" in the crumbs → the address is `/aws`, the `h1` is "Amazon Web Services", and the document was not reloaded',
    async () => {
      await open(page, '/aws/s3', S3);
      await markPage(page);
      await crumbLink(page, 'AWS').click(ACTION);
      await expect(page).toHaveURL(addressOf('/aws'));
      await expect(heading(page, AWS)).toBeVisible();
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'On `/aws/s3`, choose "EmuForge" in the crumbs → the address is `/`, Home is shown, focus is on the content target named "Home", the document was not reloaded, and Back returns to `/aws/s3`',
    async () => {
      await open(page, '/aws/s3', S3);
      await markPage(page);
      await crumbLink(page, 'EmuForge').click(ACTION);
      await expectHome(page);
      await expectTarget(page, 'Home', 'Refresh');
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
      await page.goBack();
      await expect(page).toHaveURL(addressOf('/aws/s3'));
      await expect(heading(page, S3)).toBeVisible();
    },
  );

  await lines.line(
    'Open `/aws/s3`, at 390 wide → the crumbs can still be reached: opening the breadcrumbs\' collapsed entry lists "EmuForge" and "AWS" — 390 wide',
    async () => {
      await narrow(page);
      try {
        await open(page, '/aws/s3', S3);
        const reach = await reachableCrumbs(page);
        ctx.log(`crumbs at 390: ${reach.collapsed ? 'collapsed' : 'not collapsed'}, ${JSON.stringify(reach.texts)}`);
        // (provisional, decisions-needed.md) Cloudscape collapses crumbs by width only: when the three fit at 390,
        // there is no collapsed entry and the crumbs are reached as shown.
        expect(
          { emuforge: reach.texts.includes('EmuForge'), aws: reach.texts.includes('AWS') },
          `the crumbs reachable at 390 (${JSON.stringify(reach.texts)})`,
        ).toEqual({ emuforge: true, aws: true });
      } finally {
        await wide(page);
      }
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-area-emulator-line-shows-connected-endpoint', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const connected = connectedAt(stack.emulatorPort);

  await lines.line(
    'Open each of `/aws`, `/aws/s3`, `/aws/does-not-exist` with the emulator running → the emulator line reads "Local emulator, not AWS" and "Connected at `<endpoint>`", where `<endpoint>` is `https://127.0.0.1:` and the port of the run\'s emulator',
    async () => {
      for (const p of PAGES) {
        await open(page, p.path, p.h1);
        await expectLine(page, connected);
        ctx.log(`${p.path}: the line reads "${String(await lineText(page))}"`);
      }
    },
  );

  await lines.line(
    "On each of those pages → the line is below the crumbs and above the `h1`, inside the page's one `main` landmark, and it holds no button and no link",
    async () => {
      const found: string[] = [];
      for (const p of PAGES) {
        await open(page, p.path, p.h1);
        await expectLine(page, connected);
        const order = await frameOrder(page, p.h1);
        ctx.log(`${p.path}: ${JSON.stringify(order)}`);
        if (order.mains !== 1) found.push(`${p.path}: ${String(order.mains)} main landmarks`);
        if (!order.lineInMain) found.push(`${p.path}: the line is not inside the page's main`);
        if (order.crumbs === null || order.line === null || order.h1 === null) {
          found.push(`${p.path}: the crumbs, the line or the h1 is not drawn`);
        } else {
          if (order.line.y + 0.5 < order.crumbs.y + order.crumbs.height)
            found.push(`${p.path}: the line is not below the crumbs`);
          if (order.line.y + order.line.height > order.h1.y + 0.5)
            found.push(`${p.path}: the line is not above the h1`);
        }
        const controls = await lineControls(page);
        if (controls.buttons > 0 || controls.links > 0) {
          found.push(
            `${p.path}: the line holds ${String(controls.buttons)} buttons and ${String(controls.links)} links`,
          );
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'On each of those pages → the page shows no "These … are in your local emulator" notice and no "About the local emulator" control',
    async () => {
      const found: string[] = [];
      for (const p of PAGES) {
        await open(page, p.path, p.h1);
        await expectLine(page, connected);
        const parts = await noticeParts(page);
        if (parts.notices > 0) found.push(`${p.path}: ${String(parts.notices)} local-emulator notices`);
        if (parts.about > 0) found.push(`${p.path}: ${String(parts.about)} "${ABOUT_CONTROL}" controls`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Open `/aws` → the description under the `h1` reads "EmuForge Studio works with a local emulator of AWS services. It is a stand-alone tool, not the AWS console and not an AWS feature."',
    async () => {
      await open(page, '/aws', AWS);
      const description = page.getByRole('main').getByText(INDEX_DESCRIPTION, { exact: true });
      await expect(description, 'the index description').toBeVisible();
      const h1 = await heading(page, AWS).boundingBox(ACTION);
      const box = await description.boundingBox(ACTION);
      expect(h1 !== null && box !== null && box.y >= h1.y + h1.height - 0.5, 'the description is under the h1').toBe(
        true,
      );
    },
  );

  await lines.line('Reload `/aws/s3` → the line shows "Connected at `<endpoint>`" again', async () => {
    await open(page, '/aws/s3', S3);
    await expectLine(page, connected);
    await page.reload();
    await expect(heading(page, S3)).toBeVisible();
    await expectLine(page, connected);
  });

  await lines.line(
    "Open `/aws/s3` at 390 wide with the side navigation closed → the line is visible without opening anything and its whole text is inside the page's width — 390 wide",
    async () => {
      await narrow(page);
      try {
        await open(page, '/aws/s3', S3);
        await expect(
          page.locator(SIDE_NAVIGATION).filter({ visible: true }),
          'the side navigation is closed',
        ).toHaveCount(0);
        await expectLine(page, connected);
        await expect(emulatorLine(page), 'the emulator line').toBeVisible();
        const width = await lineWidth(page);
        ctx.log(`/aws/s3 at 390: ${JSON.stringify(width)}`);
        expect(width?.outside ?? ['no emulator line'], "the line's text inside the page's width").toEqual([]);
      } finally {
        await wide(page);
      }
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-area-emulator-line-follows-emulator-stop-and-start', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const lines = new Lines(ctx);
  const link = connectionStatusLink(page);

  await lines.line(
    'Open `/aws/s3` with the check\'s own emulator running → "Connected at `<endpoint>`" with that emulator\'s port',
    async () => {
      await open(page, '/aws/s3', S3);
      await expectLine(page, connectedAt(emulator.port));
    },
  );
  await markPage(page);

  await lines.line(
    'Stop that emulator while the page stays open → without a reload the line reads "Not started on port `<port>`" and shows the link "Connection status"; the `h1` and "Studio has no screen for Amazon Simple Storage Service yet." are still shown',
    async () => {
      await emulator.stop();
      await expectLine(page, notStartedOn(emulator.port));
      await expect(link, `the line's "${CONNECTION_STATUS}" link`).toBeVisible();
      await expect(heading(page, S3)).toBeVisible();
      await expect(page.getByRole('main')).toContainText(NO_SCREEN_S3);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'Start an emulator on the same port again → without a reload the line reads "Connected at `<endpoint>`" again and "Connection status" is gone',
    async () => {
      await emulator.startAgain();
      await expectLine(page, connectedAt(emulator.port));
      await expect(link, `the line's "${CONNECTION_STATUS}" link`).toHaveCount(0);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'Stop the emulator again and choose "Connection status" → the address is `/`, Home shows its connection status with the emulator "Not started", and the document was not reloaded',
    async () => {
      await emulator.stop();
      await expectLine(page, notStartedOn(emulator.port));
      await link.click(ACTION);
      await expectHome(page);
      await expect
        .poll(() => connectionView(page), {
          timeout: LINE_CHANGE_BOUND_MS,
          message: 'Home shows the emulator "Not started"',
        })
        .toMatchObject({ emulator: { status: 'Not started' } });
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-area-emulator-line-shows-engine-unreachable', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const engine = stack.engine;
  const unreachable = engineNotAnswering(engine.url);

  await lines.line(
    'Open `/aws` with the engine running, then stop the engine while the page stays open → without a reload the line reads "The EmuForge engine at `<engine origin>` is not answering" with "Connection status", and the line shows no `https://` address',
    async () => {
      await open(page, '/aws', AWS);
      await expectLine(page, connectedAt(stack.emulatorPort));
      await markPage(page);
      await engine.stop();
      await expectLine(page, unreachable);
      await expect(connectionStatusLink(page), `the line's "${CONNECTION_STATUS}" link`).toBeVisible();
      const text = (await lineText(page)) ?? '';
      expect(text.includes('https://'), `the line shows no https:// address ("${text}")`).toBe(false);
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'Start the engine again on the same port → without a reload the line reads "Connected at `<endpoint>`"',
    async () => {
      await engine.startAgain();
      await expectLine(page, connectedAt(stack.emulatorPort));
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  // A page of its own, opened once the engine is stopped.
  await engine.stop();
  const fresh = await context.newPage();

  await lines.line(
    'Open `/aws/s3` in a fresh page while the engine is stopped → the page still shows its `h1`, crumbs and "Go to Home", and the line reads "The EmuForge engine at `<engine origin>` is not answering"',
    async () => {
      await open(fresh, '/aws/s3', S3);
      await expect.poll(() => crumbs(fresh), { message: 'the crumbs' }).toEqual(['EmuForge', 'AWS', 'S3']);
      await expect(fresh.getByRole('link', { name: GO_HOME, exact: true })).toBeVisible();
      await expectLine(fresh, unreachable);
    },
  );

  await lines.line(
    'The same page and state at 390 wide → the line takes more than one row, every part of it (the label, the status with the engine\'s origin, "Connection status") is inside the page\'s width, and the page does not scroll sideways — 390 wide, light and dark',
    async () => {
      const found: string[] = [];
      await narrow(fresh);
      for (const colorScheme of ['light', 'dark'] as const) {
        await fresh.emulateMedia({ colorScheme });
        await open(fresh, '/aws/s3', S3);
        await expectLine(fresh, unreachable);
        await expect(connectionStatusLink(fresh)).toBeVisible();
        const width = await lineWidth(fresh);
        ctx.log(`/aws/s3, engine stopped, 390, ${colorScheme}: ${JSON.stringify(width)}`);
        if (width === null) {
          found.push(`${colorScheme}: no emulator line`);
          continue;
        }
        const joined = width.parts.join(' ');
        for (const [name, present] of [
          ['the label', joined.includes(LINE_LABEL)],
          ["the status with the engine's origin", unreachable.test(joined)],
          [`"${CONNECTION_STATUS}"`, joined.includes(CONNECTION_STATUS)],
        ] as const) {
          if (!present) found.push(`${colorScheme}: ${name} is not drawn in the line`);
        }
        if (width.rows <= 1) found.push(`${colorScheme}: the line takes ${String(width.rows)} row`);
        for (const o of width.outside) found.push(`${colorScheme}: ${o}`);
        if (width.pageScrolls) found.push(`${colorScheme}: the page scrolls sideways`);
      }
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.aws-area-emulator-line-keyboard-and-layout', async ({ ctx, page }) => {
  test.setTimeout(480_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const lines = new Lines(ctx);
  let running = true;

  /** Puts the check's emulator in the state a line needs. */
  async function emulatorIs(want: 'running' | 'stopped'): Promise<void> {
    if ((want === 'running') === running) return;
    if (want === 'stopped') await emulator.stop();
    else await emulator.startAgain();
    running = want === 'running';
  }

  /** The line's status for the emulator's current state. */
  function status(): RegExp {
    return running ? connectedAt(emulator.port) : notStartedOn(emulator.port);
  }

  await lines.line(
    'Fresh load of `/aws`, connected, Tab on from the crumb "EmuForge" → the next stop is "Amazon API Gateway" in the page\'s "Services"; nothing in the emulator line is a Tab stop',
    async () => {
      await emulatorIs('running');
      await open(page, '/aws', AWS);
      await expectLine(page, status());
      await crumbLink(page, 'EmuForge').focus(ACTION);
      const stop = await pressTab(page);
      expect(contentStopProblems(stop, 'Amazon API Gateway'), 'the next Tab reaches "Amazon API Gateway"').toEqual([]);
      expect((await lineControls(page)).tabStops, 'Tab stops in the emulator line').toEqual([]);
    },
  );

  await lines.line(
    'With the emulator stopped, fresh load of `/aws/s3`, Tab on from the last crumb link → the next stop is "Connection status", with a visible focus indicator, and the one after is "Go to Home"',
    async () => {
      await emulatorIs('stopped');
      await open(page, '/aws/s3', S3);
      await expectLine(page, status());
      await crumbLink(page, 'AWS').focus(ACTION);
      const stop = await pressTab(page);
      expect(contentStopProblems(stop, CONNECTION_STATUS), `the next Tab reaches "${CONNECTION_STATUS}"`).toEqual([]);
      expect(await hasFocus(connectionStatusLink(page)), `the line's "${CONNECTION_STATUS}" has focus`).toBe(true);
      expect(await focusRing(page), `"${CONNECTION_STATUS}" draws a focus indicator`).not.toBeNull();
      const after = await pressTab(page);
      expect(contentStopProblems(after, GO_HOME), `the Tab after reaches "${GO_HOME}"`).toEqual([]);
    },
  );

  await lines.line(
    'With the emulator stopped, fresh load of `/aws/s3`, "Skip to content", Enter → focus is on the content target named "Amazon Simple Storage Service", and the next Tab reaches "Connection status"',
    async () => {
      await emulatorIs('stopped');
      await open(page, '/aws/s3', S3);
      await expectLine(page, status());
      const skip = await pressTab(page);
      expect(skip?.name, `the first Tab reaches "${SKIP}" (it reached ${describeStop(skip)})`).toBe(SKIP);
      await page.keyboard.press('Enter');
      await expectTarget(page, S3, CONNECTION_STATUS);
      await expectNextContentStop(page, CONNECTION_STATUS);
    },
  );

  await lines.line(
    "Each of `/aws`, `/aws/s3`, `/aws/does-not-exist`, connected and with the emulator stopped → the page does not scroll sideways, and every part of the emulator line is inside the page's width — 1280 and 390 wide, light and dark",
    async () => {
      const found: string[] = [];
      for (const state of ['running', 'stopped'] as const) {
        await emulatorIs(state);
        for (const width of [1280, 390]) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
            await page.emulateMedia({ colorScheme });
            for (const p of PAGES) {
              const where = `${state}, ${p.path}, ${String(width)} wide, ${colorScheme}`;
              await open(page, p.path, p.h1);
              await expectLine(page, status());
              const report = await lineWidth(page);
              if (report === null) {
                found.push(`${where}: no emulator line`);
                continue;
              }
              if (report.pageScrolls) found.push(`${where}: the page scrolls sideways`);
              for (const o of report.outside) found.push(`${where}: ${o}`);
            }
          }
        }
      }
      await wide(page);
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'The same pages and states → the line\'s text and its "Connection status" link meet WCAG 2.2 AA contrast against what is behind them — light and dark',
    async () => {
      const found: string[] = [];
      for (const state of ['running', 'stopped'] as const) {
        await emulatorIs(state);
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme });
          for (const p of PAGES) {
            const where = `${state}, ${p.path}, ${colorScheme}`;
            await open(page, p.path, p.h1);
            await expectLine(page, status());
            const contrast = await lineContrast(page);
            ctx.log(`${where}: contrast checked ${JSON.stringify(contrast?.checked ?? null)}`);
            if (contrast === null || contrast.checked.length === 0) {
              found.push(`${where}: no text of the emulator line was measured`);
              continue;
            }
            if (state === 'stopped' && !contrast.checked.some((t) => t.includes(CONNECTION_STATUS))) {
              found.push(`${where}: "${CONNECTION_STATUS}" was not measured`);
            }
            for (const failure of contrast.failures) found.push(`${where}: ${failure}`);
          }
        }
      }
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

/** An image request: an image by its type or by the file name's extension. */
function isImageRequest(request: Request): boolean {
  const { pathname } = new URL(request.url());
  return request.resourceType() === 'image' || /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(pathname);
}

test('studio.aws-area-shows-no-image', async ({ ctx, page, context }) => {
  await startStack(ctx);
  const requested: string[] = [];
  context.on('request', (request) => {
    if (isImageRequest(request)) requested.push(request.url());
  });

  // Open each of `/aws`, `/aws/s3`, `/aws/does-not-exist` → the area holds no `img`, `picture` or `image` element and
  // no element whose background is an image file, and the page requested no image file for the area (Cloudscape's
  // own inline interface icons are not image files).
  const found: string[] = [];
  for (const p of PAGES) {
    requested.length = 0;
    await open(page, p.path, p.h1);
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    const images = await areaImages(page);
    if (images === null) found.push(`${p.path}: no AWS area on the page`);
    else for (const image of images) found.push(`${p.path}: ${image}`);
    // The document's own icons are Studio's, linked from every page; any other image request is the area's.
    const icons = await documentIcons(page);
    for (const url of requested.filter((u) => !icons.includes(u))) found.push(`${p.path}: requested the image ${url}`);
    ctx.log(`${p.path}: images ${JSON.stringify(images)}, image requests ${JSON.stringify(requested)}`);
  }
  expect(found).toEqual([]);
});
