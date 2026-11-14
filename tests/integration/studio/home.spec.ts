// The Home checks of issue 3 (test-criteria.md, Flow): the "Connection" container of the built app served by
// `bun run serve`, in front of a real engine started for that Studio and a real emulator, while the check stops,
// kills and starts them; and the finish of the shell (keyboard, colour scheme, layout at 1280 and 390 wide).
//
// `studio.home-shows-connected`, `studio.home-shows-emulator-not-started-after-stop`,
// `studio.home-reconnects-after-emulator-kill-and-start`, `studio.home-shows-engine-unreachable-and-recovers`,
// `studio.home-shows-engine-unreachable-for-another-studio-origin`, `studio.shell-finish`.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';

import { directHealth, EnvError, expect, freePortExcept, startStack, test } from './support';
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
import { HEALTH_PATH, latestEmulatorMessage, Traffic } from './support/traffic';

/** Requirement 3.4: a check every 5 seconds, so a change shows within two of them. */
const CHANGE_BOUND_MS = 10_000;

const sideNavigation = createWrapper().findSideNavigation().toSelector();
const identityLink = createWrapper().findTopNavigation().findIdentityLink().toSelector();
const copyButtons = createWrapper().findCopyToClipboard().findCopyButton().toSelector();
const alertToggles = `${createWrapper().findAlert().toSelector()} [aria-expanded]`;
const navigationToggle = createWrapper().findAppLayout().findNavigationToggle().toSelector();

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
  // the Engine row "Connected", the alert names the emulator port; the emulator's directory is empty.
  await emulator.stop();
  await expect
    .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS })
    .toMatchObject({
      engine: { status: 'Connected' },
      emulator: { status: 'Not started' },
      alert: expect.stringMatching(new RegExp(`port ${String(emulator.port)}(?!\\d)`)),
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
  // alert holds the engine's message (the `emulator.message` of the engine's latest answer to the page).
  await emulator.kill();
  await expect
    .poll(
      async () => {
        await traffic.settle();
        const view = await connectionView(page);
        const message = latestEmulatorMessage(traffic);
        return {
          emulator: view.emulator?.status ?? null,
          alertHoldsEngineMessage: message !== null && view.alert.includes(message.replace(/\s+/g, ' ').trim()),
        };
      },
      { timeout: CHANGE_BOUND_MS },
    )
    .toEqual({ emulator: 'Unreachable', alertHoldsEngineMessage: true });

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
  // row "Unknown", the alert's command carries the engine's port, Studio's port and the emulator port reported before.
  await stack.engine.stop();
  await expect
    .poll(
      async () => {
        const view = await connectionView(page);
        return {
          engine: view.engine?.status ?? null,
          emulator: view.emulator?.status ?? null,
          enginePort: flagWithPort('--port', stack.engine.port).test(view.alert),
          studioPort: flagWithPort('--studio-port', stack.studio.port).test(view.alert),
          emulatorPort: flagWithPort('--emulator-port', stack.emulatorPort).test(view.alert),
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
  // `/` → within 10 seconds the Engine row shows "Unreachable" and the alert's command carries
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
          studioPort: flagWithPort('--studio-port', stack.studio.port).test(view.alert),
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

/** Most Tab presses a keyboard walk may take: the shell has about 30 stops, a Home alert a dozen more. */
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

test('studio.shell-finish', async ({ ctx, page, context }) => {
  // Four states, three pages, two widths and two colour schemes, each page waited for.
  test.setTimeout(360_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const traffic = Traffic.attach(ctx, context, page);
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });

  // With the keyboard only, on `/` with the emulator stopped → focus reaches the top navigation identity, every side
  // navigation link, the header "Refresh", the build-once toggle and every copy button, and Enter on "Refresh" sends
  // a new check.
  await emulator.stop();
  await page.goto('/');
  await expect
    .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS })
    .toMatchObject({ emulator: { status: 'Not started' } });
  await recordFocus(page);
  const targets: FocusTarget[] = [
    { name: 'top navigation identity', locator: page.locator(identityLink), each: true },
    { name: 'side navigation link', locator: page.locator(sideNavigation).getByRole('link'), each: true },
    { name: 'header "Refresh"', locator: refresh, each: true },
    { name: 'build-once toggle', locator: page.locator(alertToggles), each: false },
    { name: 'copy button', locator: page.locator(copyButtons).filter({ visible: true }), each: true },
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

  // With the keyboard only, on `/s3` and on `/does-not-exist` → focus reaches "Go to Home", and Enter on it opens Home.
  for (const path of ['/s3', '/does-not-exist']) {
    await page.goto(path);
    const goHome = page.getByRole('link', { name: 'Go to Home', exact: true });
    await expect(goHome).toBeVisible();
    expect(await tabTo(page, goHome), `Tab reaches "Go to Home" on ${path}`).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
  }

  // Open `/` with the browser's colour scheme dark → the page is in Cloudscape's dark mode; with it light → it is
  // not — 1280 wide.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/(^|\s)awsui-dark-mode(\s|$)/);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)awsui-dark-mode(\s|$)/);

  // Open `/` at 390 wide → the side navigation is collapsed behind its toggle, and opening it lists the 19
  // services — 390 wide.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator(sideNavigation)).toBeHidden();
  await page.locator(navigationToggle).click();
  await expect(page.locator(sideNavigation)).toBeVisible();
  const listed = await page.locator(sideNavigation).getByRole('link').allInnerTexts();
  expect(listed.map((t) => t.trim()).filter((t) => SERVICE_LABELS.includes(t))).toEqual(SERVICE_LABELS);

  // Open `/`, `/s3` and `/does-not-exist` with the emulator running, with it stopped and with the engine stopped →
  // no horizontal scrolling and no command line wrapped — 1280 wide and 390 wide, light and dark.
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
        for (const path of ['/', '/s3', '/does-not-exist']) {
          await page.goto(path);
          if (path === '/') {
            await expect
              .poll(() => connectionView(page), { timeout: CHANGE_BOUND_MS, message: `${state.name}: Home shows it` })
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
});
