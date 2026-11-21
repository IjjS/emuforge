// The finish of the Lambda function screens in the built app served by `bun run serve`, in front of a real engine
// and the run's emulator (test-criteria.md, issue 84, Flow — `studio.lambda-function-screens-keyboard-and-layout`;
// requirement R11): the order of the Tab stops of the list, the keyboard alone on a function's page, the create form
// and the delete dialog, the page's width in every state, the longest name and description, the narrow layout and
// the images of the area.
//
// Other checks make functions on the run's emulator at the same time, so every function here is named under the
// check's prefix `<p>` and the list is read under the filter `<p>-<line>`. "Not connected" is the engine stopped: the
// check stops only the engine it started, never the run's emulator.
//
// The Tab walk of the list: Cloudscape's layout adds stops of its own that R11 does not name — "Close navigation"
// before the side navigation's header, the controls of the filter's token and "Clear filters" after the filter, and
// its pagination decides itself which of its buttons are stops — and a disabled action with a reason is a stop where
// Cloudscape places it; each of those is allowed there and nowhere else. Every other stop must be the next one R11
// names. The walk ends at the first name link. A tab list is one Tab stop whose tabs are reached with the arrow keys
// (the WAI-ARIA tabs pattern, Cloudscape's `Tabs`), so on a function's page the next tab is reached with Arrow Right
// while focus is on a tab and with Tab otherwise; reaching a tab does not leave the page.
//
// Issue 467 rewrote one step (its test-criteria.md, "Flow checks, changed"; requirement R9, rule 3): the walk on a
// function's page reaches the copy controls of "Function ARN" and "Function URL" between "Refresh" and the tabs. The
// check grants its page the clipboard for that step.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page, Request } from '@playwright/test';

import { expect, startStack, test } from './support';
import {
  areaImages,
  connectedAt,
  currentCrumb,
  documentIcons,
  emulatorLine,
  engineNotAnswering,
  expectLine,
} from './support/aws-area';
import { focusedAx, focusRing, hasFocus } from './support/focus';
import { ACTION, addressOf, heading, NAVIGATION_TOGGLE, SIDE_NAVIGATION } from './support/frame';
import { functionUrlDirect, LambdaSeeded } from './services/lambda/lambda';
import {
  ABOUT,
  ACTIONS,
  applyFilter,
  CREATE,
  DELETE,
  DELETE_DIALOG,
  deleteDialog,
  expectNames,
  FILTER,
  functionPath,
  NO_MATCHES,
  NOTICE_CLOSE,
  openDeleteDialog,
  openList,
  PREFERENCES,
  PROPERTY_FILTER,
  REFRESH,
  screen,
  TABLE,
} from './services/lambda/lambda-list';
import {
  createForm,
  EVENT_FUNCTIONS,
  FUNCTION_ARN,
  FUNCTION_URL,
  LIST_NOT_READ,
  NOT_FOUND,
  openCreateForm,
  openFunction,
  OVERVIEW,
  PAGE_TABS,
  pairValue,
  USE_ANOTHER_ROLE,
  EXISTING_ROLE,
  CANCEL,
} from './services/lambda/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix, scrollsSideways } from './support/service-screens';
import { copiedText, copyControl, grantClipboard } from './support/screen-rules';

const PAGINATION = createWrapper().findTable().findPagination().toSelector();

/** A Tab stop as the browser reports it. */
interface Stop {
  role: string;
  name: string;
  /** Inside the AWS area (an element with a Cloudscape class around it). */
  inArea: boolean;
  inPagination: boolean;
  inFilter: boolean;
  /** The focus indicator it draws; `null` when none. */
  ring: string | null;
}

async function focusedStop(page: Page): Promise<Stop | null> {
  const ax = await focusedAx(page);
  if (ax === null) return null;
  const where = await page.evaluate(
    ([pagination, filter]) => {
      const active = document.activeElement;
      let inArea = false;
      for (let a: Element | null = active; a; a = a.parentElement) {
        if ([...a.classList].some((c) => c.startsWith('awsui'))) inArea = true;
      }
      return {
        inArea,
        inPagination: active?.closest(pagination) != null,
        inFilter: active?.closest(filter) != null,
      };
    },
    [PAGINATION, PROPERTY_FILTER],
  );
  return { role: ax.role, name: ax.name, ...where, ring: await focusRing(page) };
}

const shown = (stop: Stop | null) => (stop === null ? 'nothing' : `${stop.role} "${stop.name}"`);

/** One stop R11 names, or one Cloudscape adds (`optional`); `many` takes every next stop that matches. */
interface Expected {
  what: string;
  match: (stop: Stop) => boolean;
  optional?: boolean;
  many?: boolean;
}

const named =
  (name: string, role?: string) =>
  (stop: Stop): boolean =>
    stop.name === name && (role === undefined || stop.role === role);

/** The list's stops of R11 in order, for a list whose first row is `first`. */
function listOrder(first: string): Expected[] {
  return [
    { what: '"Close navigation" (Cloudscape\'s layout)', match: named('Close navigation', 'button'), optional: true },
    { what: 'the side navigation\'s header "Lambda"', match: named('Lambda', 'link') },
    { what: `the side navigation's link "${EVENT_FUNCTIONS}"`, match: named(EVENT_FUNCTIONS, 'link') },
    { what: 'the crumb "EmuForge"', match: named('EmuForge', 'link') },
    { what: 'the crumb "AWS"', match: named('AWS', 'link') },
    { what: 'the crumb "Lambda"', match: named('Lambda', 'link') },
    { what: `the current crumb "${EVENT_FUNCTIONS}"`, match: named(EVENT_FUNCTIONS) },
    { what: `the (i) control "${ABOUT}"`, match: named(ABOUT, 'button') },
    { what: `the notice's close "${NOTICE_CLOSE}"`, match: named(NOTICE_CLOSE, 'button') },
    { what: `"${REFRESH}"`, match: named(REFRESH, 'button') },
    { what: `"${ACTIONS}" (disabled, where Cloudscape places it)`, match: named(ACTIONS, 'button'), optional: true },
    { what: `"${CREATE}"`, match: (s) => s.name === CREATE && (s.role === 'button' || s.role === 'link') },
    { what: `the filter "${FILTER}"`, match: named(FILTER) },
    {
      what: "the filter's token and its controls (Cloudscape's)",
      match: (s) => s.inFilter,
      optional: true,
      many: true,
    },
    { what: 'the pagination', match: (s) => s.inPagination, optional: true, many: true },
    { what: `"${PREFERENCES}"`, match: named(PREFERENCES, 'button') },
    { what: "the heading's check box", match: (s) => s.role === 'checkbox' && s.name !== first },
    { what: `the first row's check box "${first}"`, match: named(first, 'checkbox') },
    { what: `the first name link "${first}"`, match: named(first, 'link') },
  ];
}

/** Where the walk `stops` leaves the order `expected`; empty when every stop is the next one expected. */
function orderProblems(stops: Stop[], expected: Expected[]): string[] {
  let at = 0;
  for (const want of expected) {
    const stop = stops[at] as Stop | undefined;
    if (stop !== undefined && want.match(stop)) {
      at++;
      while (want.many && stops[at] !== undefined && want.match(stops[at])) at++;
      continue;
    }
    if (want.optional) continue;
    return [`expected ${want.what}, the Tab reached ${stop === undefined ? 'nothing more' : shown(stop)}`];
  }
  return stops.slice(at).map((stop) => `${shown(stop)} after the last expected stop`);
}

/** Moves the start of the sequential focus navigation to the document's start: the next Tab is the first stop. */
async function focusDocumentStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const root = document.body;
    root.setAttribute('tabindex', '-1');
    root.focus();
    root.removeAttribute('tabindex');
  });
}

/**
 * The text of `locator` against its own box: whole (its text is `text`), not clipped, and inside `bound`: the
 * viewport's width, or (`'scroll region'`) the table's own sideways scroll region, the nearest ancestor inside the
 * table's root that scrolls sideways, whose box ends inside the viewport and whose scrollable width holds the element
 * (decisions.md, PM 2026-11-18 04:40, item 9). Without such a region the viewport's width bounds it.
 */
async function wholeIn(
  locator: Locator,
  text: string,
  bound: 'viewport' | 'scroll region' = 'viewport',
): Promise<string[]> {
  if ((await locator.count()) === 0) return [`no element for "${text.slice(0, 20)}…"`];
  return locator.first().evaluate(
    (el, { wanted, within }) => {
      const found: string[] = [];
      const norm = (s: string) => s.replace(/\s+/g, '').trim();
      if (norm((el as HTMLElement).innerText) !== norm(wanted)) {
        found.push(`reads "${(el as HTMLElement).innerText.slice(0, 80)}"`);
      }
      const box = el.getBoundingClientRect();
      for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (at.scrollWidth > at.clientWidth + 1 && /hidden|clip|auto|scroll/.test(style.overflowX)) {
          found.push(`clipped by ${at.tagName.toLowerCase()} (${String(at.scrollWidth)} > ${String(at.clientWidth)})`);
          break;
        }
        if (at.tagName === 'TD' || at.tagName === 'TH') break;
      }
      const viewport = document.documentElement.clientWidth;
      let region: Element | null = null;
      const table = within === null ? null : el.closest(within);
      if (table !== null) {
        for (let at = el.parentElement; at && at !== table.parentElement; at = at.parentElement) {
          if (/auto|scroll/.test(getComputedStyle(at).overflowX)) {
            region = at;
            break;
          }
        }
      }
      if (region === null) {
        if (box.right > viewport + 0.5) found.push(`ends at ${box.right.toFixed(1)}, past the viewport`);
        return found;
      }
      const r = region.getBoundingClientRect();
      if (r.right > viewport + 0.5) found.push(`its scroll region ends at ${r.right.toFixed(1)}, past the viewport`);
      // The element's place in the region's scrollable content, whatever the region is scrolled to.
      const left = box.left - r.left - region.clientLeft + region.scrollLeft;
      const right = box.right - r.left - region.clientLeft + region.scrollLeft;
      if (left < -0.5 || right > region.scrollWidth + 0.5) {
        found.push(
          `lies at ${left.toFixed(1)}..${right.toFixed(1)}, outside its scroll region's ${String(region.scrollWidth)}`,
        );
      }
      return found;
    },
    { wanted: text, within: bound === 'scroll region' ? TABLE : null },
    ACTION,
  );
}

/**
 * The cell of the row `name` under the column `column`. The row's cells are counted as the heading counts them,
 * `td` and `th` alike, since the name cell is the row header (a `th`).
 */
function cellOf(page: Page, name: string, column: number): Locator {
  return page
    .locator(TABLE)
    .locator('tbody tr')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .locator('td, th')
    .nth(column);
}

/** An image request: an image by its type or by the file name's extension. */
function isImageRequest(request: Request): boolean {
  const { pathname } = new URL(request.url());
  return request.resourceType() === 'image' || /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(pathname);
}

const WIDTHS = [1280, 390];

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

test('studio.lambda-function-screens-keyboard-and-layout', async ({ ctx, page, context }) => {
  test.setTimeout(600_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const engine = stack.engine;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfs-keys');
  const seeded = new LambdaSeeded(ctx, port, p);
  const under = `${p}-two-`;
  const two = [`${under}a`, `${under}b`];
  for (const name of two) await seeded.function(name, { description: `Made by ${p}` });
  const s = screen(page);

  /** The list under the filter `under`, its rows `two`. */
  async function listOfTwo(): Promise<void> {
    await openList(page);
    await applyFilter(page, under);
    await expectNames(page, two, `the rows under the filter ${under}`);
  }

  await lines.line(
    "Fresh load of the function list with two functions under the filter, Tab from the document start, past Studio's frame → the stops inside the area come in the order of R11 (the side navigation's header and its link, the crumbs, the (i) control, the notice's close, the three actions with the disabled one as Cloudscape places it, the filter, pagination, preferences, the heading's check box, the first row's check box, the first name link), each with a visible focus indicator",
    async () => {
      await listOfTwo();
      await focusDocumentStart(page);
      const stops: Stop[] = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const stop = await focusedStop(page);
        if (stop === null) break;
        if (!stop.inArea) {
          if (stops.length > 0) break;
          continue;
        }
        stops.push(stop);
        if (named(two[0], 'link')(stop)) break;
      }
      ctx.log(`Tab stops in the area: ${stops.map(shown).join(', ')}`);
      expect(orderProblems(stops, listOrder(two[0])), 'the order of the Tab stops').toEqual([]);
      expect(stops.filter((stop) => stop.ring === null).map(shown), 'stops without a visible focus indicator').toEqual(
        [],
      );
    },
  );

  // Issue 467 (requirement R9, rule 3) replaced 'on a function\'s page → "Refresh" and the six tabs are reached in that
  // order' with the walk below, on the page of a function with a URL: the two copy controls come between "Refresh"
  // and the tabs, and Enter on "Copy Function ARN" copies it.
  const withUrl = `${p}-url`;
  await seeded.function(withUrl, { url: true });
  await grantClipboard(context, stack.studio.origin);

  await lines.line(
    // Issue 516 (test-criteria.md, "Rewritten lines of checks on `main`"; the pm's decision of 2026-11-19). This
    // check is of the tier `full`: the plan of issue 516 rewrote these lines and did not run them.
    'With the keyboard only on the page of a function with a URL → "Refresh", "Delete", "Copy Function ARN", "Copy Function URL", the tab list (one stop; the arrow keys move between "Test", "Code", "Monitor", "Configuration", "Versions and aliases") and then the selected tab\'s controls are reached in that order, focus visible on each; Enter on "Copy Function ARN" shows "Function ARN copied" and focus stays on the control; on the create form with "Use another role" → the fields in visible order, the code choice between the execution role and the buttons, then "Cancel", "Create Event Function"',
    async () => {
      const found: string[] = [];
      const name = withUrl;
      const url = await functionUrlDirect(ctx, port, name);
      expect(url, `a direct GetFunctionUrlConfig ${name} gives a URL`).not.toBeNull();
      await openFunction(page, name);
      // The page is read in parts: the URL arrives after the tabs show, and the next step Tabs through its control.
      await expect
        .poll(() => pairValue(page, OVERVIEW, FUNCTION_URL), { message: `"${FUNCTION_URL}" shows the URL` })
        .toContain(url ?? '');
      await focusDocumentStart(page);
      let stop: Stop | null = null;
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        stop = await focusedStop(page);
        if (stop === null || named(REFRESH, 'button')(stop)) break;
      }
      if (stop === null || !named(REFRESH, 'button')(stop)) found.push(`the Tab never reached "${REFRESH}"`);
      else {
        if (stop.ring === null) found.push(`"${REFRESH}" draws no focus indicator`);
        const reached: string[] = [];
        for (const control of ['Delete', copyControl(FUNCTION_ARN), copyControl(FUNCTION_URL)]) {
          await page.keyboard.press('Tab');
          stop = await focusedStop(page);
          reached.push(shown(stop));
          if (stop === null || !named(control, 'button')(stop)) {
            found.push(`expected "${control}" next, reached ${shown(stop)}`);
            break;
          }
          if (stop.ring === null) found.push(`"${control}" draws no focus indicator`);
        }
        if (found.length === 0) {
          for (const tab of PAGE_TABS) {
            await page.keyboard.press(stop?.role === 'tab' ? 'ArrowRight' : 'Tab');
            stop = await focusedStop(page);
            reached.push(shown(stop));
            if (stop === null || stop.name !== tab || (stop.role !== 'tab' && stop.role !== 'link')) {
              found.push(`expected the tab "${tab}" next, reached ${shown(stop)}`);
              break;
            }
            if (stop.ring === null) found.push(`the tab "${tab}" draws no focus indicator`);
          }
        }
        // Return to Configuration and enter its panel after traversing the full tab list.
        if (found.length === 0) {
          await page.keyboard.press('ArrowLeft');
          await page.keyboard.press('Enter');
          let onEdit = false;
          for (let i = 0; i < 2 && !onEdit; i++) {
            await page.keyboard.press('Tab');
            stop = await focusedStop(page);
            reached.push(shown(stop));
            onEdit = stop !== null && named('Edit general configuration', 'button')(stop);
          }
          if (!onEdit) found.push(`expected "Edit general configuration" after the tabs, reached ${shown(stop)}`);
          else if (stop?.ring === null) found.push('"Edit general configuration" draws no focus indicator');
        }
        ctx.log(`after "${REFRESH}": ${reached.join(', ')}`);
        // A tab is the function's own address with a query (issue 516): the path is the function's still.
        if (new URL(page.url()).pathname !== new URL(`http://127.0.0.1${functionPath(name)}`).pathname)
          found.push(`reaching the tabs left the page for ${page.url()}`);
      }

      // Enter on "Copy Function ARN", reached with Tab from the document's start.
      const copyArn = page.getByRole('main').getByRole('button', { name: copyControl(FUNCTION_ARN), exact: true });
      await focusDocumentStart(page);
      let onCopy = false;
      for (let i = 0; i < 60 && !onCopy; i++) {
        await page.keyboard.press('Tab');
        const at = await focusedStop(page);
        if (at === null) break;
        onCopy = named(copyControl(FUNCTION_ARN), 'button')(at);
      }
      if (!onCopy) found.push(`the Tab never reached "${copyControl(FUNCTION_ARN)}"`);
      else {
        await page.keyboard.press('Enter');
        const copied = page.getByText(copiedText(FUNCTION_ARN), { exact: true });
        await expect(copied.first())
          .toBeVisible({ timeout: 5_000 })
          .catch(() =>
            found.push(`Enter on "${copyControl(FUNCTION_ARN)}" did not show "${copiedText(FUNCTION_ARN)}"`),
          );
        if (!(await hasFocus(copyArn))) found.push(`focus left "${copyControl(FUNCTION_ARN)}" after Enter`);
      }

      await openCreateForm(page, '?role=existing');
      const f = createForm(page);
      await expect(f.existingRole, `"${EXISTING_ROLE}" with "${USE_ANOTHER_ROLE}" chosen`).toBeVisible();
      await f.name.focus(ACTION);
      const formOrder: { what: string; match: (s: Stop) => boolean }[] = [
        { what: '"Runtime"', match: (x) => x.role === 'button' && /^Runtime(\s|$)/.test(x.name) },
        { what: 'the choice "Architecture" (its chosen "x86_64")', match: named('x86_64', 'radio') },
        {
          what: `the choice "Execution role" (its chosen "${USE_ANOTHER_ROLE}")`,
          match: named(USE_ANOTHER_ROLE, 'radio'),
        },
        { what: `"${EXISTING_ROLE}"`, match: (x) => x.role === 'button' && /^Existing role(\s|$)/.test(x.name) },
        { what: 'the choice "Code" (its chosen "Starter code")', match: named('Starter code', 'radio') },
        { what: `"${CANCEL}"`, match: named(CANCEL, 'button') },
        { what: `"${CREATE}"`, match: named(CREATE, 'button') },
      ];
      const formStops: string[] = [];
      for (const want of formOrder) {
        await page.keyboard.press('Tab');
        const at = await focusedStop(page);
        formStops.push(shown(at));
        if (at === null || !want.match(at)) {
          found.push(`on the form, expected ${want.what} next, reached ${shown(at)}`);
          break;
        }
        if (at.ring === null) found.push(`on the form, ${want.what} draws no focus indicator`);
      }
      ctx.log(`the form's stops after "Function name": ${formStops.join(', ')}`);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'The delete dialog opened with the keyboard: focus is inside it, Tab stays inside it, and Esc returns focus to "Actions"',
    async () => {
      await listOfTwo();
      const d = deleteDialog(page);
      await s.checkbox(two[0]).focus(ACTION);
      await page.keyboard.press('Space');
      await expect(s.checkbox(two[0]), `the row ${two[0]} selected`).toBeChecked();
      await s.action(ACTIONS).focus(ACTION);
      await page.keyboard.press('Enter');
      await expect(s.menuItem(DELETE), `the menu entry "${DELETE}"`).toBeVisible();
      await page.keyboard.press('Enter');
      if (!(await d.dialog.isVisible())) {
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      }
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}"`).toBeVisible();
      const inside = () => d.dialog.evaluate((el) => el.contains(document.activeElement), undefined, ACTION);
      await expect.poll(inside, { message: 'focus is inside the dialog once it opens' }).toBe(true);
      const outside: string[] = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        if (!(await inside())) outside.push(`Tab ${String(i + 1)}: ${shown(await focusedStop(page))}`);
      }
      expect(outside, 'Tab stops outside the dialog').toEqual([]);
      await page.keyboard.press('Escape');
      await expect(d.dialog, `the dialog "${DELETE_DIALOG}" closes`).toHaveCount(0);
      await expect.poll(() => hasFocus(s.action(ACTIONS)), { message: `focus is on "${ACTIONS}"` }).toBe(true);
    },
  );

  await lines.line(
    'The function list loaded, empty under a filter ("No matches") and not connected; a function\'s page; "Function not found"; the create form as opened and with "Use another role"; the delete dialog → the page does not scroll sideways — 1280 and 390 wide, light and dark',
    async () => {
      const found: string[] = [];
      const states: {
        name: string;
        open: () => Promise<void>;
        before?: () => Promise<void>;
        after?: () => Promise<void>;
      }[] = [
        { name: 'the list loaded', open: listOfTwo },
        {
          name: 'the list with "No matches"',
          open: async () => {
            await openList(page);
            await applyFilter(page, `${p}-zz`);
            await expect(s.empty.getByText(NO_MATCHES, { exact: true }), `"${NO_MATCHES}"`).toBeVisible();
          },
        },
        {
          name: 'the list not connected',
          before: async () => {
            await engine.stop();
          },
          open: async () => {
            await openList(page);
            await expectLine(page, engineNotAnswering(engine.url));
            await expect(s.table.getByText(LIST_NOT_READ, { exact: true }), `"${LIST_NOT_READ}"`).toBeVisible();
          },
          after: async () => {
            await engine.startAgain();
          },
        },
        { name: "a function's page", open: () => openFunction(page, two[0]) },
        {
          name: '"Function not found"',
          open: async () => {
            await openFunction(page, `${p}-missing`);
            await expect(page.getByRole('main').getByText(NOT_FOUND, { exact: true }), `"${NOT_FOUND}"`).toBeVisible();
          },
        },
        { name: 'the create form as opened', open: () => openCreateForm(page) },
        {
          name: `the create form with "${USE_ANOTHER_ROLE}"`,
          open: async () => {
            await openCreateForm(page);
            await createForm(page).radio(USE_ANOTHER_ROLE).check(ACTION);
            await expect(createForm(page).existingRole).toBeVisible();
          },
        },
        {
          name: 'the delete dialog',
          open: async () => {
            await listOfTwo();
            await openDeleteDialog(page, [two[0]]);
          },
        },
      ];
      for (const state of states) {
        if (state.before) await state.before();
        try {
          for (const width of WIDTHS) {
            for (const colorScheme of ['light', 'dark'] as const) {
              await sizeTo(page, width);
              await page.emulateMedia({ colorScheme });
              try {
                await state.open();
                if (await scrollsSideways(page)) found.push(`${state.name}, ${String(width)} wide, ${colorScheme}`);
              } catch (e) {
                found.push(
                  `${state.name}, ${String(width)} wide, ${colorScheme}: not shown (${(e as Error).message.split('\n')[0]})`,
                );
              }
            }
          }
        } finally {
          if (state.after) await state.after();
        }
      }
      await sizeTo(page, 1280);
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found, 'states in which the page scrolls sideways, or that were not shown').toEqual([]);
    },
  );

  // A name of 64 characters without a hyphen after the prefix, and a description of 256 without a space.
  const longest = `${p}${'x'.repeat(64 - p.length)}`;
  const longDescription = 'd'.repeat(256);
  await seeded.function(longest, { description: longDescription });

  await lines.line(
    'With a function whose name is 64 characters without a hyphen (starting with `<p>`) and whose description is 256 characters without a space made directly, under the filter, "Wrap lines" on as at the start → the whole name and description are visible inside their cells (at 390 the description\'s cell inside the table\'s own scroll region) and the page does not scroll sideways; on its page the `h1` and the crumb hold the whole name without the page scrolling sideways — 1280 and 390 wide',
    async () => {
      expect(longest.length, 'the name is 64 characters long').toBe(64);
      const found: string[] = [];
      for (const width of WIDTHS) {
        await sizeTo(page, width);
        await openList(page);
        await expectLine(page, connectedAt(port), 20_000);
        await applyFilter(page, longest);
        await expectNames(page, [longest], 'the row under the filter of the long name', 20_000);
        const headings = (await page.locator(TABLE).locator('thead th').allInnerTexts()).map((t) =>
          t.replace(/\s+/g, ' ').trim(),
        );
        const nameAt = headings.indexOf('Function name');
        const descriptionAt = headings.indexOf('Description');
        for (const problem of await wholeIn(s.nameLink(longest), longest))
          found.push(`${String(width)}: the name ${problem}`);
        if (nameAt >= 0) {
          for (const problem of await wholeIn(cellOf(page, longest, nameAt), longest)) {
            found.push(`${String(width)}: the name's cell ${problem}`);
          }
        }
        if (descriptionAt < 0) found.push(`${String(width)}: no column "Description"`);
        else {
          // At 390 the table scrolls within itself (decisions.md, PM 2026-11-18 04:40, item 9); at 1280 the viewport.
          const bound = width === 390 ? 'scroll region' : 'viewport';
          for (const problem of await wholeIn(cellOf(page, longest, descriptionAt), longDescription, bound)) {
            found.push(`${String(width)}: the description's cell ${problem}`);
          }
        }
        if (await scrollsSideways(page)) found.push(`${String(width)}: the list scrolls sideways`);

        await openFunction(page, longest);
        for (const problem of await wholeIn(heading(page, longest), longest))
          found.push(`${String(width)}: the h1 ${problem}`);
        for (const problem of await wholeIn(currentCrumb(page), longest))
          found.push(`${String(width)}: the crumb ${problem}`);
        if (await scrollsSideways(page)) found.push(`${String(width)}: the page scrolls sideways`);
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  /** The three screens, each opened and shown. */
  const screens: { name: string; open: () => Promise<void> }[] = [
    { name: 'the function list', open: listOfTwo },
    { name: "a function's page", open: () => openFunction(page, two[0]) },
    { name: 'the create form', open: () => openCreateForm(page) },
  ];

  await lines.line(
    'Any of the three screens at 390 wide → the side navigation is closed, "Open navigation" opens it with the link "Event Functions", and the emulator line is visible without opening anything',
    async () => {
      const found: string[] = [];
      await sizeTo(page, 390);
      for (const screenOf of screens) {
        await screenOf.open();
        if (!(await emulatorLine(page).isVisible())) found.push(`${screenOf.name}: the emulator line is not visible`);
        if ((await page.locator(SIDE_NAVIGATION).filter({ visible: true }).count()) > 0) {
          found.push(`${screenOf.name}: the side navigation is open`);
        }
        const toggle = page.locator(NAVIGATION_TOGGLE).filter({ visible: true }).first();
        if ((await toggle.count()) === 0) {
          found.push(`${screenOf.name}: no "Open navigation"`);
          continue;
        }
        await toggle.click(ACTION);
        const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
        if (
          !(await nav
            .getByRole('link', { name: EVENT_FUNCTIONS, exact: true })
            .isVisible()
            .catch(() => false))
        ) {
          found.push(`${screenOf.name}: the opened navigation has no link "${EVENT_FUNCTIONS}"`);
        }
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'The three screens → no image inside the area comes from another origin, and none is an AWS logo, service icon or resource icon',
    async () => {
      const requested: string[] = [];
      context.on('request', (request) => {
        if (isImageRequest(request)) requested.push(request.url());
      });
      const found: string[] = [];
      for (const screenOf of screens) {
        await screenOf.open();
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        const images = await areaImages(page);
        ctx.log(`${screenOf.name}: images ${JSON.stringify(images)}`);
        if (images === null) found.push(`${screenOf.name}: no area on the page`);
        else for (const image of images) found.push(`${screenOf.name}: ${image}`);
      }
      const icons = await documentIcons(page);
      ctx.log(`image requests ${JSON.stringify(requested)}`);
      for (const url of requested.filter((u) => !icons.includes(u))) found.push(`image request ${url}`);
      expect(found, 'images inside the area').toEqual([]);
    },
  );

  lines.end();
});
