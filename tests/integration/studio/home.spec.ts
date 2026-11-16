// The Home checks of issue 3, rewritten for issue 16 (test-criteria.md, issue 16, Integration checks; R9.3): the
// "Connection" section of the built app served by `bun run serve`, read in Studio's own elements by role and name,
// in front of a real engine started for that Studio and a real emulator, while the check stops, kills and starts
// them; and the finish of Studio's frame, Home and the AWS area (keyboard, colour scheme, layout at 1280 and 390).
//
// `studio.home-shows-connected`, `studio.home-shows-emulator-not-started-after-stop`,
// `studio.home-reconnects-after-emulator-kill-and-start`, `studio.home-shows-engine-unreachable-and-recovers`,
// `studio.home-shows-engine-unreachable-for-another-studio-origin`, `studio.shell-finish`.

import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';

import { directHealth, EnvError, expect, freePortExcept, NO_SCREEN_SERVICE, startStack, test } from './support';
import {
  connectionView,
  engineCommandLines,
  flagWithPort,
  layoutIssues,
  markPage,
  SERVICE_LABELS,
  startCommandLines,
  stillSamePage,
} from './support/home';
import { ACTION, frame, heading, NAVIGATION_TOGGLE, providersSection, SIDE_NAVIGATION } from './support/frame';
import { Lines } from './support/lines';
import { HEALTH_PATH, latestEmulatorMessage, Traffic } from './support/traffic';

/** Requirement 3.4: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

/** The label of the build-once disclosure's toggle (requirement R9.1). */
const BUILD_ONCE = 'First run? Build the image once, from the root of your EmuForge checkout';

/** `https://127.0.0.1:<port>`, not followed by another digit. */
function emulatorEndpoint(port: number): RegExp {
  return new RegExp(`https://127\\.0\\.0\\.1:${String(port)}(?!\\d)`);
}

/** Both rows "Connected", the Emulator row with the emulator's endpoint. */
function bothConnected(emulatorPort: number) {
  return {
    engine: { status: 'Connected' },
    emulator: { status: 'Connected', text: expect.stringMatching(emulatorEndpoint(emulatorPort)) },
  };
}

async function expectBothConnected(page: Page, emulatorPort: number, timeout: number) {
  await expect
    .poll(() => connectionView(page), { timeout, message: 'both rows "Connected"' })
    .toMatchObject(bothConnected(emulatorPort));
}

test('studio.home-shows-connected', async ({ ctx, page }) => {
  const stack = await startStack(ctx);

  // Open `/` with the engine and emulator running → within 5 seconds both rows show "Connected", the Emulator row
  // shows `https://127.0.0.1:<emulator port>`, and a direct call to the emulator's `/__admin/health` answers `ok`.
  await page.goto('/');
  await expectBothConnected(page, stack.emulatorPort, 5_000);
  expect(await directHealth(ctx.home, stack.emulatorPort)).toEqual({ status: 200, body: 'ok' });
});

test('studio.home-shows-emulator-not-started-after-stop', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  await page.goto('/');
  await expectBothConnected(page, emulator.port, CHANGE_BOUND_MS);

  // Stop the check's emulator cleanly while Home is open → within 10 seconds the Emulator row shows "Not started",
  // the Engine row "Connected", the notice names the emulator port; the emulator's directory is empty.
  await emulator.stop();
  await expect
    .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS })
    .toMatchObject({
      engine: { status: 'Connected' },
      emulator: { status: 'Not started' },
      notice: expect.stringMatching(new RegExp(`port ${String(emulator.port)}(?!\\d)`)),
    });
  // Requirement 5: `docker stop` empties `~/.aws/emulator/<port>/`; no file of the stopped run is left.
  const left = fs.existsSync(emulator.dir) ? fs.readdirSync(emulator.dir) : [];
  expect(left, `files left in ${emulator.dir}`).toEqual([]);
});

test('studio.home-reconnects-after-emulator-kill-and-start', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const traffic = Traffic.attach(ctx, context, page);
  await page.goto('/');
  await expectBothConnected(page, emulator.port, CHANGE_BOUND_MS);
  await markPage(page);
  const before = emulator.files();

  // Kill the check's emulator while Home is open → within 10 seconds the Emulator row shows "Unreachable" and the
  // notice holds the engine's message (the `emulator.message` of the engine's latest answer to the page).
  await emulator.kill();
  await expect
    .poll(
      async () => {
        await traffic.settle();
        const view = await connectionView(page);
        const message = latestEmulatorMessage(traffic);
        return {
          emulator: view.emulator?.status ?? null,
          noticeHoldsEngineMessage: message !== null && view.notice.includes(message.replace(/\s+/g, ' ').trim()),
        };
      },
      { timeout: CHANGE_BOUND_MS },
    )
    .toEqual({ emulator: 'Unreachable', noticeHoldsEngineMessage: true });

  // Start the emulator again on the same port, without reloading the page → within 10 seconds both rows show
  // "Connected", and a direct call to the emulator's `/__admin/health` with its new `ca.pem` answers `ok`.
  await emulator.startAgain();
  // The Given: the emulator started again with a new certificate (requirement 5). That is the emulator's doing, not
  // Studio's, so a run where it did not is an environment error.
  const after = emulator.files();
  if (before === null || after === null || after.caLines.join('') === before.caLines.join('')) {
    throw new EnvError(`emulator ${emulator.name} did not write a new ca.pem when it started again`);
  }
  await expectBothConnected(page, emulator.port, CHANGE_BOUND_MS);
  expect(await stillSamePage(page), 'the page was not reloaded').toBe(true);
  expect(await directHealth(ctx.home, emulator.port)).toEqual({ status: 200, body: 'ok' });
});

test('studio.home-shows-engine-unreachable-and-recovers', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const traffic = Traffic.attach(ctx, context, page);
  await page.goto('/');
  await expectBothConnected(page, stack.emulatorPort, CHANGE_BOUND_MS);
  await markPage(page);

  // Stop the check's engine while Home is open → within 10 seconds the Engine row shows "Unreachable", the Emulator
  // row "Unknown", the notice's command carries the engine's port, Studio's port and the emulator port reported before.
  await stack.engine.stop();
  await expect
    .poll(
      async () => {
        const view = await connectionView(page);
        return {
          engine: view.engine?.status ?? null,
          emulator: view.emulator?.status ?? null,
          enginePort: flagWithPort('--port', stack.engine.port).test(view.notice),
          studioPort: flagWithPort('--studio-port', stack.studio.port).test(view.notice),
          emulatorPort: flagWithPort('--emulator-port', stack.emulatorPort).test(view.notice),
        };
      },
      { timeout: CHANGE_BOUND_MS },
    )
    .toEqual({ engine: 'Unreachable', emulator: 'Unknown', enginePort: true, studioPort: true, emulatorPort: true });

  // Start the engine again on the same port, without reloading the page → within 10 seconds both rows show
  // "Connected" (the engine has a new session token).
  await traffic.settle();
  const tokensBefore = traffic.tokens.length;
  await stack.engine.startAgain();
  await expectBothConnected(page, stack.emulatorPort, CHANGE_BOUND_MS);
  expect(await stillSamePage(page), 'the page was not reloaded').toBe(true);
  await traffic.settle();
  const oldToken = traffic.tokens[tokensBefore - 1];
  const newToken = traffic.tokens.at(-1);
  const lastHealth = traffic.to(stack.engine.url, HEALTH_PATH).at(-1);
  expect(
    {
      newTokenHandedOut: traffic.tokens.length > tokensBefore && newToken !== oldToken,
      lastHealthCarriesNewToken: newToken !== undefined && lastHealth?.headers['x-emuforge-session'] === newToken,
    },
    'the page took the restarted engine’s new session token',
  ).toEqual({ newTokenHandedOut: true, lastHealthCarriesNewToken: true });
});

test('studio.home-shows-engine-unreachable-for-another-studio-origin', async ({ ctx, page }) => {
  // Start the check's engine with `--studio-port` set to a port other than the one Studio is served on, then open
  // `/` → within 10 seconds the Engine row shows "Unreachable" and the notice's command carries
  // `--studio-port <Studio's port>`.
  const other = await freePortExcept(ctx.home, [ctx.emulatorPort, ctx.enginePort, ctx.studioPort]);
  const stack = await startStack(ctx, { engineStudioPort: other });
  ctx.log(`engine started with --studio-port ${String(other)}; Studio is served on ${String(stack.studio.port)}`);
  await page.goto('/');
  await expect
    .poll(
      async () => {
        const view = await connectionView(page);
        return {
          engine: view.engine?.status ?? null,
          studioPort: flagWithPort('--studio-port', stack.studio.port).test(view.notice),
        };
      },
      { timeout: CHANGE_BOUND_MS },
    )
    .toEqual({ engine: 'Unreachable', studioPort: true });
});

/**
 * Starts recording, in the page, every element that receives focus. A target counts as reached when it, or an
 * element inside it, received focus.
 */
async function recordFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Element[] = [];
    (window as unknown as { __emuforgeItFocused: Element[] }).__emuforgeItFocused = seen;
    document.addEventListener('focusin', (event) => seen.push(event.target as Element), true);
  });
}

interface FocusTarget {
  name: string;
  locator: Locator;
  /** `every`: each element the locator matches must be reached; `any`: one of them is enough. */
  each: boolean;
}

/** The targets not reached yet; a target matching no element is not reached. */
async function unreached(targets: FocusTarget[]): Promise<string[]> {
  const missing: string[] = [];
  for (const target of targets) {
    const reached = await target.locator.evaluateAll((elements) => {
      const seen = (window as unknown as { __emuforgeItFocused?: Element[] }).__emuforgeItFocused ?? [];
      return elements.map((el) => seen.some((f) => f === el || el.contains(f)));
    });
    if (reached.length === 0) missing.push(`${target.name} (not on the page)`);
    else if (target.each) reached.forEach((r, i) => r || missing.push(`${target.name} #${String(i + 1)}`));
    else if (!reached.some(Boolean)) missing.push(target.name);
  }
  return missing;
}

/** Most Tab presses a keyboard walk may take: the frame and Home have about 30 stops, a notice a dozen more. */
const TAB_BOUND = 150;

/** Presses Tab, at most `TAB_BOUND` times, until focus is on (or inside) `target`. True when it got there. */
async function tabTo(page: Page, target: Locator): Promise<boolean> {
  for (let i = 0; i < TAB_BOUND; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))) {
      return true;
    }
  }
  return false;
}

/**
 * The AWS area's root as the page shows it in dark: the outermost element with `awsui-dark-mode` that holds the area
 * (its side navigation and the page's `h1`). Elements inside that root may carry the class too (Cloudscape's own
 * dropdowns do); `outside` lists the holders that are not inside it. Reports whether the root is `html` or `body`,
 * whether it holds the frame's banner, every holder (for the light case) and the `awsui-` classes of `body`.
 */
async function darkModeHolders(page: Page) {
  return page.evaluate((sideNavigation) => {
    const holders = [...document.querySelectorAll('.awsui-dark-mode')];
    const banner = [...document.querySelectorAll('header, [role="banner"]')].find((b) =>
      [...b.querySelectorAll('a')].some((a) => a.textContent?.replace(/\s+/g, ' ').trim() === 'EmuForge Studio'),
    );
    const nav = document.querySelector(sideNavigation);
    const h1 = document.querySelector('h1');
    const holdsArea = holders.filter((el) => nav !== null && h1 !== null && el.contains(nav) && el.contains(h1));
    const root = holdsArea.find((el) => !holdsArea.some((other) => other !== el && other.contains(el))) ?? null;
    const name = (el: Element) => el.tagName.toLowerCase();
    return {
      holders: holders.map(name),
      root: root === null ? null : name(root),
      outside: holders.filter((el) => root === null || !root.contains(el)).map(name),
      rootIsHtmlOrBody: root !== null && (root === document.documentElement || root === document.body),
      rootHoldsBanner: root !== null && banner !== undefined && root.contains(banner),
      bodyAwsuiClasses: [...document.body.classList].filter((c) => c.startsWith('awsui')),
    };
  }, SIDE_NAVIGATION);
}

/** True when `locator` is visible within the bound; false when it is not, never an error. */
async function shown(locator: Locator): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout: ACTION.timeout })
    .then(() => true)
    .catch(() => false);
}

async function htmlColorScheme(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

test('studio.shell-finish', async ({ ctx, page, context }) => {
  // Four states, five pages, two widths and two colour schemes, each page waited for.
  test.setTimeout(480_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const traffic = Traffic.attach(ctx, context, page);
  const lines = new Lines(ctx);
  const f = frame(page);
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  const connection = page.getByRole('region', { name: 'Connection', exact: true });

  await emulator.stop();
  await lines.line(
    '(changed) With the keyboard only, on `/` with the emulator stopped → focus reaches the frame\'s "EmuForge Studio", "Home" and "AWS" links, the header "Refresh", every link of Home\'s "Providers" section, the build-once toggle and every copy button, and Enter on "Refresh" sends a new check',
    async () => {
      await page.goto('/');
      await expect
        .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS, message: 'Home shows "Not started"' })
        .toMatchObject({ emulator: { status: 'Not started' } });
      await recordFocus(page);
      const targets: FocusTarget[] = [
        { name: 'frame "EmuForge Studio"', locator: f.wordmark, each: true },
        { name: 'frame "Home"', locator: f.home, each: true },
        { name: 'frame "AWS"', locator: f.aws, each: true },
        { name: 'header "Refresh"', locator: refresh, each: true },
        { name: '"Providers" link', locator: providersSection(page).getByRole('link'), each: true },
        {
          name: 'build-once toggle',
          locator: connection.locator('summary, [aria-expanded]').filter({ hasText: BUILD_ONCE }),
          each: false,
        },
        {
          name: 'copy button',
          locator: connection.getByRole('button', { name: /^Copy command: / }).filter({ visible: true }),
          each: true,
        },
      ];
      let missing = await unreached(targets);
      for (let i = 0; i < TAB_BOUND && missing.length > 0; i++) {
        await page.keyboard.press('Tab');
        missing = await unreached(targets);
      }
      expect(missing, `not reached with Tab in ${String(TAB_BOUND)} presses`).toEqual([]);

      expect(await tabTo(page, refresh), 'Tab reaches the header "Refresh"').toBe(true);
      // Right after an answer, the next timed check is 5 seconds away: a check sent within 2 seconds is Enter's.
      await page.waitForResponse((r) => new URL(r.url()).pathname === HEALTH_PATH, { timeout: CHANGE_BOUND_MS });
      const checks = traffic.to(stack.engine.url, HEALTH_PATH).length;
      await page.keyboard.press('Enter');
      await expect
        .poll(() => traffic.to(stack.engine.url, HEALTH_PATH).length, {
          timeout: 2_000,
          message: 'Enter on "Refresh" sends a health request',
        })
        .toBeGreaterThan(checks);
    },
  );

  await lines.line(
    'With the keyboard only, on `/aws/kinesis` and on `/does-not-exist` → focus reaches "Go to Home", and Enter on it opens Home',
    async () => {
      for (const path of [NO_SCREEN_SERVICE.path, '/does-not-exist']) {
        await page.goto(path);
        const goHome = page.getByRole('link', { name: 'Go to Home', exact: true });
        await expect(goHome).toBeVisible();
        expect(await tabTo(page, goHome), `Tab reaches "Go to Home" on ${path}`).toBe(true);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
        await expect(heading(page, 'Home')).toBeVisible();
      }
    },
  );

  await lines.line(
    "(changed) Open `/` with the browser's colour scheme dark → `html`'s computed `color-scheme` is `dark`; open `/aws/kinesis` → the area's root has `awsui-dark-mode` and `body` has no `awsui-` class; with the scheme light → `html`'s `color-scheme` is `light` and no element has `awsui-dark-mode` — 1280 wide",
    async () => {
      const found: string[] = [];
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/');
      await expect(heading(page, 'Home')).toBeVisible();
      const darkScheme = await htmlColorScheme(page);
      if (darkScheme !== 'dark') found.push(`/ in dark: html's color-scheme is "${darkScheme}"`);
      await page.goto(NO_SCREEN_SERVICE.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (!(await shown(heading(page, NO_SCREEN_SERVICE.label)))) {
        found.push('/aws/kinesis in dark: no "Amazon Kinesis" header');
      }
      const dark = await darkModeHolders(page);
      ctx.log(`awsui-dark-mode on /aws/kinesis in dark: ${JSON.stringify(dark)}`);
      if (dark.root === null) {
        const where = dark.holders.join(', ') || 'none';
        found.push(`/aws/kinesis in dark: no element with awsui-dark-mode holds the area (holders: ${where})`);
      }
      if (dark.root !== null && dark.outside.length > 0) {
        const count = String(dark.outside.length);
        found.push(
          `/aws/kinesis in dark: ${count} elements outside the area's root carry awsui-dark-mode (${dark.outside.join(', ')})`,
        );
      }
      if (dark.rootIsHtmlOrBody) found.push('/aws/kinesis in dark: awsui-dark-mode is on html or body');
      if (dark.rootHoldsBanner)
        found.push("/aws/kinesis in dark: the element with awsui-dark-mode holds the frame's banner");
      if (dark.bodyAwsuiClasses.length > 0)
        found.push(`/aws/kinesis in dark: body has ${dark.bodyAwsuiClasses.join(' ')}`);
      await page.emulateMedia({ colorScheme: 'light' });
      for (const path of ['/', NO_SCREEN_SERVICE.path]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const scheme = await htmlColorScheme(page);
        if (scheme !== 'light') found.push(`${path} in light: html's color-scheme is "${scheme}"`);
        const holders = (await darkModeHolders(page)).holders;
        if (holders.length > 0) found.push(`${path} in light: awsui-dark-mode on ${holders.join(', ')}`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "(changed) Open `/aws` at 390 wide → the area's side navigation is collapsed behind its toggle, and opening it lists the 19 services; open `/` at 390 wide → the frame's items are visible and Home's \"Providers\" section lists the 19 services — 390 wide",
    async () => {
      const found: string[] = [];
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/aws');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (!(await shown(heading(page, 'Amazon Web Services')))) found.push('/aws: no "Amazon Web Services" header');
      const nav = page.locator(SIDE_NAVIGATION);
      if (await shown(nav)) found.push('/aws at 390: the side navigation is not collapsed');
      else if (!(await shown(page.locator(NAVIGATION_TOGGLE)))) found.push('/aws at 390: no navigation toggle');
      else {
        await page.locator(NAVIGATION_TOGGLE).click(ACTION);
        await expect(nav, 'the side navigation, opened').toBeVisible();
        const listed = (await nav.getByRole('link').allInnerTexts()).map((t) => t.trim());
        const services = listed.filter((t) => SERVICE_LABELS.includes(t));
        if (JSON.stringify(services) !== JSON.stringify(SERVICE_LABELS)) {
          found.push(`/aws at 390: the opened side navigation lists ${JSON.stringify(services)}`);
        }
      }

      await page.goto('/');
      await expect(heading(page, 'Home')).toBeVisible();
      for (const [name, link] of [
        ['EmuForge Studio', f.wordmark],
        ['Home', f.home],
        ['AWS', f.aws],
      ] as const) {
        if (!(await shown(link))) found.push(`/ at 390: the frame's "${name}" is not visible`);
      }
      const services = (await providersSection(page).getByRole('link').filter({ visible: true }).allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => SERVICE_LABELS.includes(t));
      if (JSON.stringify(services) !== JSON.stringify(SERVICE_LABELS)) {
        found.push(`/ at 390: Home's "Providers" section lists ${JSON.stringify(services)}`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    '(changed) Open `/`, `/aws`, `/aws/kinesis`, `/aws/does-not-exist` and `/does-not-exist` with the emulator running, with it stopped and with the engine stopped → no horizontal scrolling and no command line wrapped — 1280 wide and 390 wide, light and dark',
    async () => {
      const states = [
        {
          name: 'emulator stopped',
          enter: async () => undefined,
          home: { emulator: { status: 'Not started' } },
          lines: startCommandLines(emulator.port),
        },
        {
          name: 'emulator running',
          enter: () => emulator.startAgain(),
          home: bothConnected(emulator.port),
          lines: [] as string[],
        },
        {
          name: 'engine stopped',
          enter: () => stack.engine.stop(),
          home: { engine: { status: 'Unreachable' } },
          lines: engineCommandLines(stack.engine.port, stack.studio.port),
        },
      ];
      const issues: string[] = [];
      for (const state of states) {
        await state.enter();
        for (const width of [1280, 390]) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
            await page.emulateMedia({ colorScheme });
            for (const path of ['/', '/aws', NO_SCREEN_SERVICE.path, '/aws/does-not-exist', '/does-not-exist']) {
              await page.goto(path);
              if (path === '/') {
                await expect
                  .poll(() => connectionView(page), {
                    timeout: CHANGE_BOUND_MS,
                    message: `${state.name}: Home shows it`,
                  })
                  .toMatchObject(state.home);
              } else {
                await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
              }
              const found = await layoutIssues(page, path === '/' ? state.lines : []);
              const where = `${state.name}, ${path}, ${String(width)} wide, ${colorScheme}`;
              if (found.pageScrolls) issues.push(`${where}: the page scrolls sideways`);
              for (const s of found.scrolling) issues.push(`${where}: scrolls sideways: ${s}`);
              for (const l of found.wrapped) issues.push(`${where}: command line wrapped: ${l}`);
              for (const l of found.missing) issues.push(`${where}: command line not shown: ${l}`);
            }
          }
        }
      }
      expect(issues).toEqual([]);
    },
  );

  lines.end();
});
