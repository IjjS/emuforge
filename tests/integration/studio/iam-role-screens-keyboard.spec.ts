// The IAM role screens' finish in the built app served by `bun run serve`, in front of a real engine started for that
// Studio and the run's emulator (test-criteria.md, issue 82, Flow — `studio.iam-role-screens-keyboard-and-layout`;
// requirement R6.1, R11): the order of the Tab stops on the list, the keyboard alone on a role's page, the wizard
// and the two dialogs, the page's width in every state, the longest role name, the narrow layout and the images.
//
// The check names its roles with its own prefix `<p>` (lower-case letters and digits) and shows the list under a
// filter that holds `<p>`. "Not connected" is the list read while the check's own engine is stopped; it comes last
// among the states, and the engine is started again after it.
//
// The Tab walk on the list: Cloudscape's layout adds stops of its own that R11 does not name — "Close navigation"
// before the side navigation's header, the toggle of the navigation's section after it, the help toggle after the
// crumbs or after the content, the filter's own "Clear" while it holds text — and its pagination decides itself which
// of its buttons are stops; each of those is allowed where Cloudscape places it and nowhere else. Every other stop
// must be the next one R11 names. On a role's page and on the wizard only the order of the controls R11 names is
// compared, by role and name, other stops Cloudscape adds (the wizard's step navigation, a tab panel, the current
// crumb) being allowed between them; Cloudscape's tabs are one Tab stop whose tabs the arrow keys reach, so the walk
// goes through them with the right arrow.
//
// Issue 467 rewrote one step (its test-criteria.md, "Flow checks, changed"; requirement R9, rule 3): the walk on a
// role's page reaches "Copy ARN" after "Edit", directly before the ARN's text, with a visible focus indicator on each
// control it names.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page, Request } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import {
  ABOUT_CONTROL,
  areaImages,
  currentCrumb,
  documentIcons,
  emulatorLine,
  engineNotAnswering,
  expectLine,
} from './support/aws-area';
import { focusedAx, focusRing } from './support/focus';
import { ACTION, heading, NAVIGATION_TOGGLE, SIDE_NAVIGATION } from './support/frame';
import { getRoleDirect, IamSeeded } from './services/iam/iam';
import { Lines } from './support/lines';
import { copyControl, directlyBeforeProblems, pairValueOf } from './support/screen-rules';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R3, R4, R5, R6, R7, R11; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const CREATE_PATH = '/aws/iam/roles/create';
const LIST_H1 = 'Roles';
const NAV_HEADER = 'Identity and Access Management (IAM)';
const NAV_GROUP = 'Access Management';
const NAV_ROLES = 'Roles';
const NAV_POLICIES = 'Policies';
const NOTICE_CLOSE = 'Close the local emulator notice';
const HELP_OPEN = 'Open help panel';
const REFRESH = 'Refresh roles';
const DELETE = 'Delete';
const CREATE = 'Create role';
const FILTER = 'Search items';
/** The clear button Cloudscape's text filter shows while it holds text (its default label). */
const FILTER_CLEAR = 'Clear';
const PREFERENCES = 'Preferences';
const ALL_ITEMS = 'All items';
const COL_NAME = 'Role name';
const NO_MATCHES = 'No matches';
const LIST_NOT_READ = 'The role list could not be read.';
const NOT_FOUND = 'Role not found';
const REFRESH_ROLE = 'Refresh role';
// Issue 535 (its test-criteria.md, "Rewritten lines of checks on `main`"): the page's tab bar is two tabs, below
// "Summary"; "Delete" stands in the header, and the tab "Permissions" holds the actions of "Permissions policies".
const TABS = ['Permissions', 'Trust relationships'];
/** The actions of "Permissions policies" that are available with no row chosen, in their order. */
const ADD_INLINE = 'Add inline policy';
const ATTACH = 'Attach policies';
const EDIT = 'Edit';
const EDIT_DIALOG = 'Edit summary';
const STEP_TITLES = ['Select trusted entity', 'Add permissions', 'Name, review, and create'] as const;
const ENTITY_TYPES = ['AWS service', 'AWS account', 'Custom trust policy'];
const F_SERVICE = 'Service or use case';
const F_NAME = 'Role name';
const F_DESCRIPTION = 'Description';
const ADD_TAG = 'Add new tag';
const CANCEL = 'Cancel';
const PREVIOUS = 'Previous';
const NEXT = 'Next';
const F_ARN = 'ARN';

/** The longest role name the emulator takes (R2). */
const LONGEST_NAME = 64;

function rolePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

/** The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only. */
function rolePrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const LIST_TABLE = wrapper.findTable().toSelector();
const TABLE_EMPTY = wrapper.findTable().findEmptySlot().toSelector();
const PAGINATION = wrapper.findPagination().toSelector();

function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    listH1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    table: page.locator(LIST_TABLE).first(),
    empty: page.locator(TABLE_EMPTY).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    button: (name: string) => main.getByRole('button', { name, exact: true }).first(),
    checkbox: (name: string) => main.getByRole('checkbox', { name, exact: true }),
    nameLink: (name: string) => page.locator(LIST_TABLE).first().getByRole('link', { name, exact: true }),
  };
}

async function shownNames(page: Page): Promise<string[]> {
  const table = screen(page).table;
  if ((await table.count()) === 0) return [];
  return table.evaluate((el, col) => {
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    for (const t of el.querySelectorAll('table')) {
      if (t.tBodies.length === 0 || t.closest('[aria-hidden="true"]')) continue;
      const head = t.tHead?.rows[0];
      if (!head) continue;
      const at = [...head.cells].map((c) => norm((c as HTMLElement).innerText)).indexOf(col);
      if (at < 0) continue;
      return [...t.tBodies[0].rows]
        .filter((r) => r.cells.length > 1)
        .map((r) => norm((r.cells[at] as HTMLElement | undefined)?.innerText ?? ''));
    }
    return [];
  }, COL_NAME);
}

/** Opens the list and applies the filter `text`; waits for exactly `names` when given. */
async function listUnder(page: Page, text: string, names?: string[]): Promise<void> {
  const s = screen(page);
  await page.goto(ROLES_PATH);
  await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
  await s.filter.fill(text, ACTION);
  await s.filter.press('Enter', ACTION);
  if (names !== undefined) {
    await expect.poll(() => shownNames(page), { message: `the rows under the filter ${text}` }).toEqual(names);
  }
}

/**
 * Opens the page of `name` and waits for it to be read. The tabs are shown while "Loading role" is still up, the four
 * after "Permissions" disabled until the role is read: a Tab walk started then meets only "Refresh role" and
 * "Permissions". The page is read once "Trust relationships" is enabled.
 */
async function openRole(page: Page, name: string): Promise<void> {
  await page.goto(rolePath(name));
  await expect(heading(page, name), `the role's page with the h1 "${name}"`).toBeVisible();
  await expect(screen(page).main.getByRole('tab', { name: TABS[1], exact: true }), 'the role is read').toBeEnabled();
}

async function openWizard(page: Page, step: 1 | 2 | 3): Promise<void> {
  await page.goto(step === 1 ? CREATE_PATH : `${CREATE_PATH}?step=${String(step)}`);
  await expect(heading(page, STEP_TITLES[step - 1]), `the wizard's step ${String(step)}`).toBeVisible();
}

/** Moves the start of the Tab order to the document's start: a non-focusable mark first in the body is focused. */
async function focusDocumentStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    const mark = document.createElement('span');
    mark.tabIndex = -1;
    mark.setAttribute('data-efit-start', '');
    document.body.prepend(mark);
    mark.focus();
  });
}

/** A Tab stop as the browser reports it. */
interface Stop {
  role: string;
  name: string;
  inArea: boolean;
  inPagination: boolean;
  ring: string | null;
}

async function focusedStop(page: Page): Promise<Stop | null> {
  const ax = await focusedAx(page);
  if (ax === null) return null;
  const where = await page.evaluate((pagination) => {
    const active = document.activeElement;
    let inArea = false;
    for (let a: Element | null = active; a; a = a.parentElement) {
      if ([...a.classList].some((c) => c.startsWith('awsui'))) inArea = true;
    }
    return { inArea, inPagination: active?.closest(pagination) != null };
  }, PAGINATION);
  return { role: ax.role, name: ax.name, ...where, ring: await focusRing(page) };
}

const shown = (stop: Stop) => `${stop.role} "${stop.name}"`;

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

/** The stops of R11 on the role list, in order, for rows `names` (criteria line 1). */
function listOrder(names: string[]): Expected[] {
  const [first, ...rest] = names;
  return [
    { what: '"Close navigation" (Cloudscape\'s layout)', match: named('Close navigation', 'button'), optional: true },
    { what: `the side navigation's header "${NAV_HEADER}"`, match: named(NAV_HEADER, 'link') },
    {
      what: "the toggle of the navigation's section (Cloudscape's)",
      match: named(NAV_GROUP, 'button'),
      optional: true,
    },
    { what: `the side navigation's link "${NAV_ROLES}"`, match: named(NAV_ROLES, 'link') },
    // Issue 535: the side navigation's second entry.
    { what: `the side navigation's link "${NAV_POLICIES}"`, match: named(NAV_POLICIES, 'link') },
    { what: 'the crumb "EmuForge"', match: named('EmuForge', 'link') },
    { what: 'the crumb "AWS"', match: named('AWS', 'link') },
    { what: 'the crumb "IAM"', match: named('IAM', 'link') },
    { what: `the current crumb "${LIST_H1}"`, match: named(LIST_H1) },
    { what: `the help toggle "${HELP_OPEN}" (after the crumbs)`, match: named(HELP_OPEN, 'button'), optional: true },
    { what: `the (i) control "${ABOUT_CONTROL}"`, match: named(ABOUT_CONTROL, 'button') },
    { what: `the notice's close "${NOTICE_CLOSE}"`, match: named(NOTICE_CLOSE, 'button') },
    { what: `"${REFRESH}"`, match: named(REFRESH, 'button') },
    { what: `"${DELETE}" (disabled)`, match: named(DELETE, 'button'), optional: true },
    { what: `"${CREATE}"`, match: named(CREATE, 'button') },
    { what: `the filter "${FILTER}"`, match: named(FILTER) },
    {
      what: `the filter's "${FILTER_CLEAR}" (Cloudscape's, while the filter holds text)`,
      match: named(FILTER_CLEAR, 'button'),
      optional: true,
    },
    { what: 'the pagination', match: (stop) => stop.inPagination, many: true },
    { what: `"${PREFERENCES}"`, match: named(PREFERENCES, 'button') },
    { what: `the heading's check box "${ALL_ITEMS}"`, match: named(ALL_ITEMS, 'checkbox') },
    { what: `the first row's check box "${first}"`, match: named(first, 'checkbox') },
    { what: `the first name link "${first}"`, match: named(first, 'link') },
    {
      what: "the other rows' check boxes and name links",
      match: (stop) => rest.some((name) => named(name)(stop)),
      optional: true,
      many: true,
    },
    {
      what: `the help toggle "${HELP_OPEN}" (after the content, where Cloudscape's layout places it)`,
      match: named(HELP_OPEN, 'button'),
      optional: true,
    },
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

/**
 * From the document's start, with Tab (and, on a tab, the right arrow through the other tabs), the focused controls
 * inside the area, until one matches `last` or the focus leaves the area. A control is matched by its role as well as
 * its name: a crumb and a button may share a name ("Create role"), and Cloudscape's tab panel, a Tab stop of its own,
 * is named after its tab ("Permissions").
 */
async function keyboardWalk(page: Page, last: (stop: Stop) => boolean): Promise<Stop[]> {
  await focusDocumentStart(page);
  const reached: Stop[] = [];
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Tab');
    const stop = await focusedStop(page);
    if (stop === null) break;
    if (!stop.inArea) {
      if (reached.length > 0) break;
      continue;
    }
    reached.push(stop);
    if (last(stop)) break;
    if (stop.role === 'tab') {
      for (let k = 0; k < TABS.length - 1; k++) {
        await page.keyboard.press('ArrowRight');
        const tab = await focusedStop(page);
        if (tab === null || tab.role !== 'tab' || reached.some((r) => r.role === 'tab' && r.name === tab.name)) break;
        reached.push(tab);
      }
    }
  }
  return reached;
}

/** The names of the stops of `walk` that are `wanted`, in the order reached, each kept once. */
function among(walk: Stop[], wanted: (stop: Stop) => boolean): string[] {
  const out: string[] = [];
  for (const stop of walk) if (wanted(stop) && out[out.length - 1] !== stop.name) out.push(stop.name);
  return out;
}

/** Presses Tab (or Shift+Tab) until the focused control is named `name`; whether it got there. */
async function tabTo(page: Page, name: string, back = false): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    if ((await focusedAx(page))?.name === name) return true;
  }
  return false;
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/**
 * How the element of `locator` holds its text: the text, whether it lies inside the window and inside the element
 * around it (`within`, a cell or a crumb), and whether it or that element is clipped. `null` when it is not shown.
 */
async function fitOf(locator: Locator, within: string | null) {
  if ((await locator.count()) === 0) return null;
  return locator.first().evaluate(
    (el, around) => {
      const r = el.getBoundingClientRect();
      const box = around === null ? null : el.closest(around);
      const b = box?.getBoundingClientRect() ?? null;
      const clipped = (x: Element) => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflowX !== 'visible';
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        inWindow: r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
        inside:
          b === null ||
          (r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5),
        clipped: clipped(el) || (box !== null && clipped(box)),
        ellipsis: getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1,
      };
    },
    within,
    ACTION,
  );
}

/** The deepest element inside `main` whose text is exactly `text`. */
function exactText(page: Page, text: string): Locator {
  return screen(page).main.getByText(text, { exact: true });
}

function isImageRequest(request: Request): boolean {
  const { pathname } = new URL(request.url());
  return request.resourceType() === 'image' || /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(pathname);
}

const WIDTHS = [1280, 390];

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-screens-keyboard-and-layout', async ({ ctx, page, context }) => {
  test.setTimeout(900_000);
  const stack = await startStack(ctx);
  const engine = stack.engine;
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rskeys');
  const seeded = new IamSeeded(ctx, port);
  const two = [`${p}-a`, `${p}-b`];
  for (const name of two) await seeded.role(name);
  const s = screen(page);

  await lines.line(
    "Fresh load of the role list with two roles under the filter, Tab from the document start, past Studio's frame → the stops inside the area come in the order of R11 (the side navigation's header and its link, the crumbs, the (i) control, the notice's close, the three actions with the disabled one as Cloudscape places it, the filter, pagination, preferences, the heading's check box, the first row's check box, the first name link), each with a visible focus indicator",
    async () => {
      await listUnder(page, p, two);
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
      }
      ctx.log(`Tab stops in the area: ${stops.map(shown).join(', ')}`);
      expect(orderProblems(stops, listOrder(two)), 'the order of the Tab stops').toEqual([]);
      expect(stops.filter((stop) => stop.ring === null).map(shown), 'stops without a visible focus indicator').toEqual(
        [],
      );
    },
  );

  // Issue 467 (requirement R9, rule 3) replaced 'on a role\'s page → "Refresh role", the five tabs and "Edit" are
  // reached in that order' with the walk below: "Copy ARN" follows "Edit", directly before the ARN's text, and each of
  // them draws a focus indicator. Issue 535 rewrote the walk's stops on a role's page: the header's "Refresh role" and
  // "Delete", "Edit" of "Summary" (with its "Copy ARN"), the two tabs, then the controls of "Permissions policies".
  const copyArn = copyControl(F_ARN);

  await lines.line(
    'With the keyboard only on a role\'s page → the header\'s "Refresh role" and "Delete", "Edit" of "Summary" and "Copy ARN", the two tabs, then the controls of "Permissions policies" are reached in that order, "Copy ARN" directly before the ARN\'s text, focus visible on each; on the wizard\'s step 1 → the entity types, "Service or use case", then "Cancel", "Next"; on step 3 → "Role name", "Description", the two "Edit" buttons, "Add new tag", then "Cancel", "Previous", "Create role"',
    async () => {
      const problems: string[] = [];

      // The page is read in parts: the ARN the walk ends at is in "Summary" once the role is read.
      const arn = (await getRoleDirect(ctx, port, two[0])).arn;
      await openRole(page, two[0]);
      await expect(pairValueOf(page, F_ARN), `"${F_ARN}" of ${two[0]}`).toContainText(arn);
      const onPage = await keyboardWalk(page, named(ATTACH, 'button'));
      ctx.log(`a role's page, reached: ${onPage.map(shown).join(', ')}`);
      // With no row chosen, the table's actions on a chosen policy are unavailable and are no Tab stops.
      const pageWanted = [REFRESH_ROLE, DELETE, EDIT, copyArn, ...TABS, ADD_INLINE, ATTACH];
      const wantedOnPage = (stop: Stop) =>
        named(REFRESH_ROLE, 'button')(stop) ||
        named(DELETE, 'button')(stop) ||
        named(EDIT, 'button')(stop) ||
        named(copyArn, 'button')(stop) ||
        named(ADD_INLINE, 'button')(stop) ||
        named(ATTACH, 'button')(stop) ||
        (stop.role === 'tab' && TABS.includes(stop.name));
      const pageSeen = among(onPage, wantedOnPage);
      if (JSON.stringify(pageSeen) !== JSON.stringify(pageWanted)) {
        problems.push(`a role's page: reached ${JSON.stringify(pageSeen)}, wanted ${JSON.stringify(pageWanted)}`);
      }
      for (const stop of onPage.filter(wantedOnPage)) {
        if (stop.ring === null) problems.push(`a role's page: ${shown(stop)} draws no focus indicator`);
      }
      const copyButton = s.main.getByRole('button', { name: copyArn, exact: true });
      for (const problem of await directlyBeforeProblems(copyButton, pairValueOf(page, F_ARN), arn)) {
        problems.push(`a role's page, "${copyArn}": ${problem}`);
      }

      await openWizard(page, 1);
      const step1 = await keyboardWalk(page, (stop) => stop.name === NEXT);
      ctx.log(`step 1, reached: ${step1.map(shown).join(', ')}`);
      const step1Seen = among(
        step1,
        ({ name: n }) => ENTITY_TYPES.includes(n) || [F_SERVICE, CANCEL, NEXT].includes(n),
      );
      const types = step1Seen.filter((n) => ENTITY_TYPES.includes(n));
      const rest1 = step1Seen.filter((n) => !ENTITY_TYPES.includes(n));
      const firstOther = step1Seen.findIndex((n) => !ENTITY_TYPES.includes(n));
      if (types.length === 0) problems.push('step 1: no entity type was reached');
      if (firstOther >= 0 && step1Seen.slice(firstOther).some((n) => ENTITY_TYPES.includes(n))) {
        problems.push(`step 1: an entity type after the fields: ${JSON.stringify(step1Seen)}`);
      }
      if (JSON.stringify(rest1) !== JSON.stringify([F_SERVICE, CANCEL, NEXT])) {
        problems.push(`step 1: reached ${JSON.stringify(step1Seen)}`);
      }

      await openWizard(page, 3);
      const step3 = await keyboardWalk(page, named(CREATE, 'button'));
      ctx.log(`step 3, reached: ${step3.map(shown).join(', ')}`);
      const step3Wanted = [F_NAME, F_DESCRIPTION, EDIT, EDIT, ADD_TAG, CANCEL, PREVIOUS, CREATE];
      const step3Seen = step3
        .filter(
          (stop) =>
            [F_NAME, F_DESCRIPTION, ADD_TAG, CANCEL, PREVIOUS].includes(stop.name) ||
            /^Edit\b/.test(stop.name) ||
            named(CREATE, 'button')(stop),
        )
        .map((stop) => (/^Edit\b/.test(stop.name) ? EDIT : stop.name));
      if (JSON.stringify(step3Seen) !== JSON.stringify(step3Wanted)) {
        problems.push(`step 3: reached ${JSON.stringify(step3Seen)}, wanted ${JSON.stringify(step3Wanted)}`);
      }
      expect(problems, 'the keyboard order on the page and the wizard').toEqual([]);
    },
  );

  await lines.line(
    'The delete dialog and the dialog "Edit summary", each opened with the keyboard and closed with Esc → focus is on "Delete" and on "Edit"',
    async () => {
      const problems: string[] = [];
      await listUnder(page, p, two);
      await s.checkbox(two[0]).focus(ACTION);
      await page.keyboard.press('Space');
      await expect(s.checkbox(two[0]), `${two[0]} selected with Space`).toBeChecked();
      if (!(await tabTo(page, DELETE, true))) problems.push(`Shift+Tab from the check box does not reach "${DELETE}"`);
      await page.keyboard.press('Enter');
      const deleteDialog = page.getByRole('dialog', { name: 'Delete 1 role?' });
      await expect(deleteDialog, 'the dialog "Delete 1 role?" opened with Enter').toBeVisible();
      await page.keyboard.press('Escape');
      await expect(deleteDialog, 'the dialog closes on Esc').toHaveCount(0);
      const afterDelete = await focusedAx(page);
      if (afterDelete?.name !== DELETE)
        problems.push(`after the delete dialog the focus is on ${JSON.stringify(afterDelete)}`);

      await openRole(page, two[0]);
      await focusDocumentStart(page);
      if (!(await tabTo(page, EDIT))) problems.push(`Tab does not reach "${EDIT}"`);
      await page.keyboard.press('Enter');
      const editDialog = page.getByRole('dialog', { name: EDIT_DIALOG });
      await expect(editDialog, `the dialog "${EDIT_DIALOG}" opened with Enter`).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(editDialog, 'the dialog closes on Esc').toHaveCount(0);
      const afterEdit = await focusedAx(page);
      if (afterEdit?.name !== EDIT)
        problems.push(`after "${EDIT_DIALOG}" the focus is on ${JSON.stringify(afterEdit)}`);
      expect(problems).toEqual([]);
    },
  );

  await lines.line(
    'The role list loaded, empty under a filter ("No matches") and not connected; a role\'s page; "Role not found"; the three steps of the wizard, step 1 also with "AWS account" and with "Custom trust policy"; both dialogs → the page does not scroll sideways — 1280 and 390 wide, light and dark',
    async () => {
      const found: string[] = [];
      const states: { name: string; open: () => Promise<void> }[] = [
        { name: 'the list loaded', open: () => listUnder(page, p, two) },
        {
          name: 'the list with no match',
          open: async () => {
            await listUnder(page, `${p}-zz`);
            await expect(s.empty.getByText(NO_MATCHES, { exact: true })).toBeVisible();
          },
        },
        { name: "a role's page", open: () => openRole(page, two[0]) },
        {
          name: '"Role not found"',
          open: async () => {
            await page.goto(rolePath(`${p}-none`));
            await expect(exactText(page, NOT_FOUND)).toBeVisible();
          },
        },
        { name: 'step 1', open: () => openWizard(page, 1) },
        {
          name: 'step 1 with "AWS account"',
          open: async () => {
            await openWizard(page, 1);
            await s.main.getByRole('radio', { name: 'AWS account', exact: true }).check(ACTION);
          },
        },
        {
          name: 'step 1 with "Custom trust policy"',
          open: async () => {
            await openWizard(page, 1);
            await s.main.getByRole('radio', { name: 'Custom trust policy', exact: true }).check(ACTION);
          },
        },
        { name: 'step 2', open: () => openWizard(page, 2) },
        { name: 'step 3', open: () => openWizard(page, 3) },
        {
          name: 'the delete dialog',
          open: async () => {
            await listUnder(page, p, two);
            await s.checkbox(two[0]).check(ACTION);
            await s.button(DELETE).click(ACTION);
            await expect(page.getByRole('dialog', { name: 'Delete 1 role?' })).toBeVisible();
          },
        },
        {
          name: 'the dialog "Edit summary"',
          open: async () => {
            await openRole(page, two[0]);
            await s.button(EDIT).click(ACTION);
            await expect(page.getByRole('dialog', { name: EDIT_DIALOG })).toBeVisible();
          },
        },
        {
          name: 'the list not connected',
          open: async () => {
            await page.goto(ROLES_PATH);
            await expectLine(page, engineNotAnswering(engine.url));
            await expect(s.table.getByText(LIST_NOT_READ, { exact: true })).toBeVisible({ timeout: 20_000 });
          },
        },
      ];
      for (const state of states) {
        if (state.name === 'the list not connected') await engine.stop();
        for (const width of WIDTHS) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await sizeTo(page, width);
            await page.emulateMedia({ colorScheme });
            try {
              await state.open();
              if (await scrollsSideways(page)) found.push(`${state.name}, ${String(width)} wide, ${colorScheme}`);
            } catch (e) {
              found.push(
                `${state.name}, ${String(width)} wide, ${colorScheme}: ${(e as Error).message.split('\n')[0]}`,
              );
            }
          }
        }
      }
      await engine.startAgain();
      await sizeTo(page, 1280);
      await page.emulateMedia({ colorScheme: 'light' });
      expect(found, 'states in which the page scrolls sideways or could not be shown').toEqual([]);
    },
  );

  const longest = `${p}-${'x'.repeat(LONGEST_NAME - p.length - 1)}`;
  await seeded.role(longest);
  /** The check's roles under the filter `<p>` from here on: the two and the longest name, in the list's order. */
  const all = [...two, longest];

  await lines.line(
    'With a role whose name is 64 characters without a space (starting with `<p>`) made directly, under the filter, "Wrap lines" on as at the start → the whole name is visible inside its cell and the page does not scroll sideways; on its page the `h1`, the crumb and the ARN hold their whole text without the page scrolling sideways — 1280 and 390 wide',
    async () => {
      expect(longest.length, 'the name is 64 characters long').toBe(LONGEST_NAME);
      const arn = (await getRoleDirect(ctx, port, longest)).arn;
      const found: string[] = [];
      const judge = (where: string, fit: Awaited<ReturnType<typeof fitOf>>, text: string) => {
        ctx.log(`${where}: ${JSON.stringify(fit)}`);
        if (fit === null) {
          found.push(`${where}: not shown`);
          return;
        }
        if (fit.text !== text) found.push(`${where}: reads "${fit.text}"`);
        if (!fit.inWindow) found.push(`${where}: outside the window`);
        if (!fit.inside) found.push(`${where}: outside the element around it`);
        if (fit.clipped || fit.ellipsis) found.push(`${where}: its text is cut`);
      };
      for (const width of WIDTHS) {
        await sizeTo(page, width);
        await listUnder(page, longest, [longest]);
        judge(`${String(width)}, the list's cell`, await fitOf(s.nameLink(longest), 'td, th'), longest);
        if (await scrollsSideways(page)) found.push(`${String(width)}: the list scrolls sideways`);
        await openRole(page, longest);
        judge(`${String(width)}, the h1`, await fitOf(heading(page, longest), null), longest);
        judge(`${String(width)}, the crumb`, await fitOf(currentCrumb(page), null), longest);
        await expect(exactText(page, F_ARN).first(), `"${F_ARN}"`).toBeVisible();
        judge(`${String(width)}, the ARN`, await fitOf(exactText(page, arn), null), arn);
        if (await scrollsSideways(page)) found.push(`${String(width)}: the role's page scrolls sideways`);
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Any of the three screens at 390 wide → the side navigation is closed, "Open navigation" opens it with the link "Roles", and the emulator line is visible without opening anything',
    async () => {
      const found: string[] = [];
      const screens: [string, () => Promise<void>][] = [
        ['the role list', () => listUnder(page, p, all)],
        ["a role's page", () => openRole(page, two[0])],
        ['the wizard', () => openWizard(page, 1)],
      ];
      await sizeTo(page, 390);
      for (const [name, open] of screens) {
        try {
          await open();
          await expect(emulatorLine(page), `${name}: the emulator line at 390 wide`).toBeVisible();
          await expect(
            page.locator(SIDE_NAVIGATION).filter({ visible: true }),
            `${name}: the side navigation at 390 wide`,
          ).toHaveCount(0);
          await page.locator(NAVIGATION_TOGGLE).filter({ visible: true }).first().click(ACTION);
          const nav = page.locator(SIDE_NAVIGATION).filter({ visible: true });
          await expect(
            nav.getByRole('link', { name: NAV_ROLES, exact: true }),
            `${name}: "${NAV_ROLES}"`,
          ).toBeVisible();
        } catch (e) {
          found.push(`${name}: ${(e as Error).message.split('\n')[0]}`);
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
      const screens: [string, () => Promise<void>][] = [
        ['the role list', () => listUnder(page, p, all)],
        ["a role's page", () => openRole(page, two[0])],
        ['the wizard', () => openWizard(page, 1)],
      ];
      for (const [name, open] of screens) {
        await open();
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        const images = await areaImages(page);
        ctx.log(`${name}: images ${JSON.stringify(images)}`);
        if (images === null) found.push(`${name}: no area on the page`);
        else for (const image of images) found.push(`${name}: ${image}`);
      }
      const icons = await documentIcons(page);
      ctx.log(`image requests ${JSON.stringify(requested)}`);
      for (const url of requested.filter((u) => !icons.includes(u))) found.push(`an image request ${url}`);
      expect(found, 'images inside the area and image requests').toEqual([]);
    },
  );

  lines.end();
});
