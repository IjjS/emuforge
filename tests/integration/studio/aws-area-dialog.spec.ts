// A dialog of the AWS area and Studio's bar, in the built app served by `bun run serve`, in front of a real engine
// and the run's emulator (test-criteria.md, issue 531; requirement R1 to R4): an open dialog is drawn above the bar,
// which covers nothing of it and cannot be used meanwhile, and without a dialog the frame is as it was.
//
// `studio.aws-area-dialog-is-above-studio-bar`: a check of no service. It tests the frame and the area's modal root,
// which every service's dialogs share; its two carriers are dialogs that need nothing in the emulator, both on S3's
// screens. It makes and changes nothing in the emulator, so it ends with no direct call and has no cleanup.
//
// Words: `support/area-dialog.ts`.

import type { ElementHandle, Locator, Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import {
  areaRootElement,
  backdropPoint,
  barControls,
  barElement,
  behindBar,
  closeControl,
  cloudscapeOutside,
  focusPlace,
  pointMeets,
  readDialog,
  scrollDialog,
  type BarControl,
  type PartReport,
} from './support/area-dialog';
import { hasFocus, settled } from './support/focus';
import { ACTION, addressOf, expectHome, frame, heading } from './support/frame';
import { pathOf } from './support/language-menu';
import { languageControl, languageMenu, menuOptions } from './support/languages';
import { Lines } from './support/lines';

/** One of the two dialogs, with the way to it. */
interface Carrier {
  /** The dialog's accessible name, its title. */
  title: string;
  path: string;
  h1: string;
  /** What is done on the page before the dialog can be opened. */
  prepare: (page: Page) => Promise<void>;
  /** The control that opens the dialog, and takes focus back when it closes. */
  opener: (page: Page) => Locator;
  /** The dialog's own button that dismisses it. */
  own: string;
}

const LIST = '/aws/s3/buckets';

/** A list's own dialog, given the area's modal root. */
const PREFERENCES: Carrier = {
  title: 'Preferences',
  path: LIST,
  h1: 'Buckets',
  prepare: async () => undefined,
  opener: (page) => page.getByRole('main').getByRole('button', { name: 'Preferences', exact: true }),
  own: 'Cancel',
};

/**
 * An `AreaModal`: the create form asked whether to discard what was entered. test-criteria.md writes the form's path
 * `/aws/s3/buckets/create`; the form is at `/aws/s3/bucket/create` (decisions.md, Plan decisions).
 */
const DISCARD: Carrier = {
  title: 'Discard what you entered?',
  path: '/aws/s3/bucket/create',
  h1: 'Create bucket',
  prepare: async (page) => {
    await page.getByRole('textbox', { name: 'Bucket name', exact: true }).fill('p531', ACTION);
  },
  opener: (page) => page.getByRole('main').getByRole('button', { name: 'Cancel', exact: true }),
  own: 'Keep editing',
};

const CARRIERS = [PREFERENCES, DISCARD];

/** The viewports at which a dialog may be shorter than the viewport. */
const FULL = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const WIDTHS = [390, 1280];
/** The low heights, tried in this order until the open dialog is taller than the viewport. */
const LOW_HEIGHTS = [400, 300, 200, 150];

interface Case {
  carrier: Carrier;
  width: number;
  /** A height, or `low`: the first of the low heights at which the dialog is taller than the viewport. */
  height: number | 'low';
}

const FULL_CASES: Case[] = CARRIERS.flatMap((carrier) => FULL.map((v) => ({ carrier, ...v })));
const LOW_CASES: Case[] = CARRIERS.flatMap((carrier) => WIDTHS.map((width) => ({ carrier, width, height: 'low' })));
const CASES = [...FULL_CASES, ...LOW_CASES];

/** A case with its dialog open. */
interface Opened {
  carrier: Carrier;
  /** For a message: the dialog and the viewport. */
  at: string;
  dialog: Locator;
  opener: Locator;
  bar: ElementHandle<HTMLElement>;
  /** The bar's controls, read before the dialog opened. */
  controls: BarControl[];
  /** Opens the dialog again after it closed. */
  reopen: () => Promise<void>;
}

async function openPage(page: Page, carrier: Carrier): Promise<void> {
  await page.goto(carrier.path);
  await expect(page).toHaveURL(addressOf(carrier.path));
  await expect(heading(page, carrier.h1), `the h1 "${carrier.h1}" of ${carrier.path}`).toBeVisible();
  await carrier.prepare(page);
}

function dialogOf(page: Page, carrier: Carrier): Locator {
  return page.getByRole('dialog', { name: carrier.title, exact: true });
}

async function pressOpener(page: Page, carrier: Carrier): Promise<void> {
  await carrier.opener(page).click(ACTION);
  await expect(dialogOf(page, carrier), `the dialog "${carrier.title}"`).toBeVisible();
  await settled(page);
}

/** Opens the case's page at its viewport and its dialog; at `low`, at the first low height the dialog is taller at. */
async function arrange(page: Page, c: Case): Promise<Opened> {
  const heights = c.height === 'low' ? LOW_HEIGHTS : [c.height];
  for (const height of heights) {
    await page.setViewportSize({ width: c.width, height });
    await openPage(page, c.carrier);
    const bar = await barElement(page);
    const controls = await barControls(page);
    await pressOpener(page, c.carrier);
    const dialog = dialogOf(page, c.carrier);
    if (c.height === 'low' && !(await readDialog(dialog, bar)).taller) continue;
    return {
      carrier: c.carrier,
      at: `"${c.carrier.title}" at ${String(c.width)}x${String(height)}`,
      dialog,
      opener: c.carrier.opener(page),
      bar,
      controls,
      reopen: () => pressOpener(page, c.carrier),
    };
  }
  throw new Error(
    `"${c.carrier.title}" at ${String(c.width)} wide is taller than the viewport at none of the heights ${LOW_HEIGHTS.join(', ')}`,
  );
}

/** Whether the dialog is gone within the bound of an action. */
async function gone(dialog: Locator): Promise<boolean> {
  return dialog
    .waitFor({ state: 'hidden', ...ACTION })
    .then(() => true)
    .catch(() => false);
}

/** Whether `locator` takes focus within the bound of an action. */
async function takesFocus(locator: Locator): Promise<boolean> {
  return expect
    .poll(() => hasFocus(locator).catch(() => false), ACTION)
    .toBe(true)
    .then(() => true)
    .catch(() => false);
}

/** What is wrong with a part of the dialog that is to be in view and uncovered. */
function partProblems(name: string, part: PartReport | null): string[] {
  if (part === null) return [`the dialog has no ${name}`];
  const found: string[] = [];
  if (!part.inViewport) found.push(`the ${name} is not inside the viewport (${JSON.stringify(part.rect)})`);
  if (part.centreMeets !== 'itself') found.push(`the point at the centre of the ${name} meets ${part.centreMeets}`);
  if (part.underBar > 0) found.push(`${String(part.underBar)} points of the ${name} are under Studio's bar`);
  return found;
}

test('studio.aws-area-dialog-is-above-studio-bar', async ({ ctx, page }) => {
  test.setTimeout(600_000);
  await startStack(ctx);
  const lines = new Lines(ctx);

  /** Runs `body` for each case with its dialog open and gathers what each found, named by the case. */
  const forEach = async (cases: Case[], body: (o: Opened) => Promise<string[]>): Promise<void> => {
    const found: string[] = [];
    for (const c of cases) {
      const o = await arrange(page, c);
      found.push(...(await body(o)).map((f) => `${o.at}: ${f}`));
    }
    expect(found).toEqual([]);
  };

  await lines.line(
    "Open the dialog, its own scrolling at its start → its title and its close control are inside the viewport, the point at the centre of each meets itself, and no point of either is inside Studio's bar's rectangle while meeting the bar (regression)",
    () =>
      forEach(CASES, async (o) => {
        await scrollDialog(o.dialog, 'start');
        await settled(page);
        const r = await readDialog(o.dialog, o.bar);
        ctx.log(`${o.at}: ${JSON.stringify(r)}`);
        return [...partProblems('title', r.title), ...partProblems('close control', r.close)];
      }),
  );

  await lines.line(
    'At the two low viewports, focus moved to the close control with the keyboard (Shift+Tab until it has focus) → the close control is inside the viewport and the point at its centre meets itself (regression)',
    () =>
      forEach(LOW_CASES, async (o) => {
        // Focus starts on the close control: it is moved on, and the dialog scrolled to its end, so the way back to
        // the close control is the keyboard's and the browser's own scrolling.
        for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
        await scrollDialog(o.dialog, 'end');
        await settled(page);
        const close = closeControl(o.dialog);
        let presses = 0;
        while (!(await hasFocus(close)) && presses < 60) {
          await page.keyboard.press('Shift+Tab');
          presses++;
        }
        if (!(await hasFocus(close))) return ['60 presses of Shift+Tab did not reach the close control'];
        await settled(page);
        const r = await readDialog(o.dialog, o.bar);
        ctx.log(`${o.at}: after ${String(presses)} presses of Shift+Tab ${JSON.stringify(r.close)}`);
        return partProblems('close control', r.close);
      }),
  );

  await lines.line(
    'A press at the centre of the close control → the dialog is gone and focus is on the control that opened it ("Preferences"; "Cancel") (regression)',
    () =>
      forEach(CASES, async (o) => {
        await scrollDialog(o.dialog, 'start');
        await settled(page);
        const box = await closeControl(o.dialog).boundingBox(ACTION);
        if (!box) return ['the close control is not drawn'];
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        if (!(await gone(o.dialog))) return ['the dialog is still open after the press'];
        return (await takesFocus(o.opener)) ? [] : ['focus is not on the control that opened the dialog'];
      }),
  );

  await lines.line(
    "The dialog open; for each of the bar's controls in turn, a press at the point of its centre, the dialog opened again before the next when it closed → after each press the path is what it was, the language menu is not open and focus is on no control of the bar; and the dialog is gone when that point was outside the dialog's box, still open when it was inside it (regression)",
    () =>
      forEach(CASES, async (o) => {
        const found: string[] = [];
        const path = pathOf(page);
        for (const control of o.controls) {
          if (!(await o.dialog.isVisible())) await o.reopen();
          await scrollDialog(o.dialog, 'start');
          await settled(page);
          const meets = await pointMeets(page, control.centre, o.bar);
          await page.mouse.click(control.centre.x, control.centre.y);
          await settled(page);
          const where = `a press at the centre of "${control.name}" (the point meets ${meets})`;
          if (pathOf(page) !== path) {
            // The page was left: the case cannot go on.
            found.push(`${where}: the path is ${pathOf(page)}, not ${path}`);
            break;
          }
          if (await languageMenu(page).isVisible()) found.push(`${where}: the language menu is open`);
          if ((await focusPlace(page, o.bar)) === 'bar') found.push(`${where}: focus is on a control of the bar`);
          // Outside the dialog's box the point is the dialog's backdrop. Inside the box it is the box, where a press
          // changes nothing, or, should the two lie at one place, the dialog's own close control, which closes it.
          if (meets === 'backdrop' || meets === 'close') {
            if (!(await gone(o.dialog))) found.push(`${where}: the dialog is still open`);
          } else if (meets === 'box') {
            if (!(await o.dialog.isVisible())) found.push(`${where}: the dialog is gone`);
          } else {
            found.push(`${where}: the point meets neither the dialog's box nor its backdrop`);
          }
        }
        return found;
      }),
  );

  await lines.line(
    'The dialog open, 40 presses of Tab then 40 of Shift+Tab → focus is never on a control of the bar or anywhere outside the dialog',
    () =>
      forEach(CASES, async (o) => {
        const seen = new Set<string>();
        for (const key of ['Tab', 'Shift+Tab']) {
          for (let i = 0; i < 40; i++) {
            await page.keyboard.press(key);
            seen.add(await focusPlace(page, o.bar));
          }
        }
        seen.delete('dialog');
        return seen.size === 0 ? [] : [`focus was also in: ${[...seen].join(', ')}`];
      }),
  );

  await lines.line(
    "The dialog open, a press on its backdrop at a point outside its box and below the bar → the dialog is gone (as a press at the bar's points outside its box)",
    () =>
      forEach(CASES, async (o) => {
        const point = await backdropPoint(page, o.dialog, o.bar);
        if (point === null) return ['no point of the backdrop below the bar was found'];
        await page.mouse.click(point.x, point.y);
        return (await gone(o.dialog)) ? [] : [`the dialog is still open after a press at ${JSON.stringify(point)}`];
      }),
  );

  await lines.line('The dialog open, Esc → the dialog is gone and focus is on the control that opened it', () =>
    forEach(CASES, async (o) => {
      await page.keyboard.press('Escape');
      if (!(await gone(o.dialog))) return ['the dialog is still open after Esc'];
      return (await takesFocus(o.opener)) ? [] : ['focus is not on the control that opened the dialog'];
    }),
  );

  await lines.line(
    'The dialog open, a press on its own button that dismisses it ("Cancel" of Preferences; "Keep editing" of Discard) → the dialog is gone and focus is on the control that opened it',
    () =>
      forEach(CASES, async (o) => {
        const own = o.carrier.own;
        await o.dialog.getByRole('button', { name: own, exact: true }).click(ACTION);
        if (!(await gone(o.dialog))) return [`the dialog is still open after "${own}"`];
        return (await takesFocus(o.opener)) ? [] : ['focus is not on the control that opened the dialog'];
      }),
  );

  // The second Given: the list, after a dialog was opened and closed on it.
  const afterDialog = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await openPage(page, PREFERENCES);
    const bar = await barElement(page);
    const controls = await barControls(page);
    const root = await areaRootElement(page);
    await pressOpener(page, PREFERENCES);
    return {
      bar,
      controls,
      root,
      dialog: dialogOf(page, PREFERENCES),
      at: `${String(width)}x${String(height)}`,
    };
  };
  const closeWithEsc = async (dialog: Locator) => {
    await page.keyboard.press('Escape');
    await expect(dialog, 'the dialog after Esc').toBeHidden();
    await settled(page);
  };

  await lines.line(
    'A press on the language control → its menu is open, and the point at the centre of the menu and of each of its first three options meets the menu, not the area; Esc closes it',
    async () => {
      const found: string[] = [];
      for (const v of FULL) {
        const s = await afterDialog(v.width, v.height);
        await closeWithEsc(s.dialog);
        await languageControl(page).click(ACTION);
        const menu = languageMenu(page);
        await expect(menu, `${s.at}: the language menu`).toBeVisible();
        await settled(page);
        const options = menuOptions(page);
        const parts = [
          { name: 'the menu', locator: menu },
          ...[0, 1, 2].map((i) => ({
            name: `option ${String(i + 1)}`,
            locator: options.nth(i),
          })),
        ];
        const menuElement = await menu.elementHandle(ACTION);
        for (const { name, locator } of parts) {
          const box = await locator.boundingBox(ACTION);
          if (!box) {
            found.push(`${s.at}: ${name} is not drawn`);
            continue;
          }
          const inMenu = await page.evaluate(
            ({ menu, x, y }) => menu !== null && menu.contains(document.elementFromPoint(x, y)),
            {
              menu: menuElement,
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            },
          );
          if (!inMenu) found.push(`${s.at}: the point at the centre of ${name} does not meet the menu`);
        }
        await page.keyboard.press('Escape');
        await expect(menu, `${s.at}: the language menu after Esc`).toBeHidden();
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "No dialog open, the page scrolled as far down as it goes (at 390x400 and 1280x400, where it scrolls) → at the point of the centre of each of the bar's controls an element of the area lies behind (the page's content, scrolled into the bar's band), and the point meets the bar's control",
    async () => {
      const found: string[] = [];
      for (const width of WIDTHS) {
        const s = await afterDialog(width, 400);
        await closeWithEsc(s.dialog);
        const scrolled = await page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          return window.scrollY;
        });
        await settled(page);
        if (scrolled <= 0) {
          found.push(`${s.at}: the page does not scroll`);
          continue;
        }
        for (const control of s.controls) {
          const b = await behindBar(page, control.centre, s.bar, s.root);
          if (!b.meetsBar) found.push(`${s.at}: the point at the centre of "${control.name}" does not meet the bar`);
          if (!b.areaBehind) found.push(`${s.at}: no element of the area lies behind "${control.name}"`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    "While a dialog is open and after it closed → no element rendered by Cloudscape (one that carries an `awsui*` class and is neither `html` nor `body`) is outside the area's root; and once the dialog is closed neither `html` nor `body` carries an `awsui*` class",
    async () => {
      for (const v of FULL) {
        const s = await afterDialog(v.width, v.height);
        expect((await cloudscapeOutside(page, s.root)).elements, `${s.at}: outside the area, the dialog open`).toEqual(
          [],
        );
        await closeWithEsc(s.dialog);
        await expect
          .poll(() => cloudscapeOutside(page, s.root), {
            message: `${s.at}: outside the area, the dialog closed`,
          })
          .toEqual({ elements: [], onDocument: [] });
      }
    },
  );

  await lines.line('A press on "Home" in the bar → the path is `/` and Home is shown', async () => {
    for (const v of FULL) {
      const s = await afterDialog(v.width, v.height);
      await closeWithEsc(s.dialog);
      await frame(page).home.click(ACTION);
      await expectHome(page);
      expect(pathOf(page), `${s.at}: the path`).toBe('/');
    }
  });

  lines.end();
});
