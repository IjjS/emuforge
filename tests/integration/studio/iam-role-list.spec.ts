// The IAM role list in the built app served by `bun run serve`, in front of a real engine started for that Studio
// and a real emulator (test-criteria.md, issue 82, Flow checks; requirement R4, R8 to R10): what the emulator holds,
// an emulator without roles, read again on every opening and refresh, pages that follow the emulator's marker, the
// filter that matches a part of a name, and the loading state while the list's request is held back.
//
// `studio.iam-role-list-shows-what-the-emulator-holds`, `studio.iam-role-list-empty-emulator-says-no-roles`,
// `studio.iam-role-list-rereads-on-open-and-refresh`, `studio.iam-role-list-pages-follow-the-emulator`,
// `studio.iam-role-list-filter-matches-part-of-a-name`, `studio.iam-role-list-shows-loading-until-the-answer`.
//
// Other checks make roles on the run's emulator at the same time, so each check names its roles with its own prefix
// `<p>` (lower-case letters and digits) and compares the screen with a direct `ListRoles` under the filter `<p>`; the
// checks that need the whole list (empty, paging) start their own emulator. Roles are made and read directly with
// `support/iam.ts`, and taken apart when the check ends. The loading check holds the page's `ListRoles` request in the
// browser (`ListRolesHold`); nothing answers it but the engine.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, CDPSession, Locator, Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { crumbLink } from './support/aws-area';
import { ACTION, addressOf, expectHome, heading, providersSection } from './support/frame';
import {
  accountTrust,
  callerUserDirect,
  containing,
  directSts,
  getRoleDirect,
  IamSeeded,
  LAMBDA_TRUST,
  listRolesDirect,
  readAnswer,
  roleNamesDirect,
  serviceTrust,
  SERVICE_ROLE_PATH,
  shownRead,
} from './support/iam';
import { Lines } from './support/lines';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R0, R3, R4, R8 to R10; English).
// ---------------------------------------------------------------------------------------------------------------

/** The service's route and the role list's own route (R0), and the wizard's (R0, R8). */
const IAM_PATH = '/aws/iam';
const ROLES_PATH = '/aws/iam/roles';
const CREATE_PATH = '/aws/iam/roles/create';

/** Home's link to the service. */
const SERVICE_LABEL = 'AWS Identity and Access Management';

/** The `h1` without its counter (R3 row 3), and the wizard's first step title, its `h1` (R6.2). */
const H1 = 'Roles';
const WIZARD_H1 = 'Select trusted entity';

/** The actions (R3 row 4, R8) and the filter (R4.7). */
const REFRESH = 'Refresh roles';
const CREATE = 'Create role';
const FILTER = 'Search items';
const PREFERENCES = 'Preferences';
const CONFIRM = 'Confirm';
const NEXT_PAGE = 'Next page';
const PREVIOUS_PAGE = 'Previous page';

/** The columns (R4.2). */
const COL_NAME = 'Role name';
const COL_TRUSTED = 'Trusted entities';
const COL_LAST = 'Last activity';

/** The states' words (R10) and the refresh's announcement (R8). */
const LOADING = 'Loading roles';
const NO_ROLES = 'No roles';
const EMPTY_SENTENCE =
  'This emulator holds no roles. It starts empty each time it restarts. Create one here, or with any tool pointed at the emulator.';
const NO_MATCHES = 'No matches';
const CLEAR_FILTER = 'Clear filter';
const REFRESHED = 'Role list refreshed';

/** The sentence of the "No matches" state for the filter `text` (R10). */
function noMatchSentence(text: string): string {
  return `No role name contains “${text}”.`;
}

/** A page size of "Preferences" (R4.8, R9.5). */
function pageSizeOption(size: 10 | 20 | 50): string {
  return `${String(size)} roles`;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and values as the screen writes them.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only. Each check passes its own
 * `tag`, none of which is a prefix of another, so a filter on one check's prefix (a part of a name, R4.7) never lists
 * another check's role on the run's shared emulator.
 */
function rolePrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Last activity" for a `RoleLastUsed.LastUsedDate` of a direct `GetRole` (R4.2): "-" while it holds none. */
function lastActivityText(iso: string | null, now = Date.now()): string {
  if (iso === null) return '-';
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (days < 1) return 'Today';
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const TABLE = wrapper.findTable().toSelector();
const TABLE_EMPTY = wrapper.findTable().findEmptySlot().toSelector();
/** The visible match count of the table's text filter; Cloudscape also writes it in a hidden live region. */
const RESULTS_COUNT = wrapper.findTable().findTextFilter().findResultsCount().toSelector();

/** The screen's parts a check acts on or reads, all inside the page's `main`. */
function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    h1: main.getByRole('heading', { level: 1, name: new RegExp(`^${H1}(\\s|$)`) }),
    table: main.locator(TABLE).first(),
    empty: main.locator(TABLE_EMPTY).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    resultsCount: main.locator(RESULTS_COUNT),
    action: (name: string) => main.getByRole('button', { name, exact: true }).first(),
    nextPage: main.getByRole('button', { name: NEXT_PAGE, exact: true }),
    previousPage: main.getByRole('button', { name: PREVIOUS_PAGE, exact: true }),
    preferences: main.getByRole('button', { name: PREFERENCES, exact: true }),
  };
}

/** Opens `at` and waits for the role list's `h1`. */
async function openList(page: Page, at: string = ROLES_PATH): Promise<void> {
  await page.goto(at);
  await expect(screen(page).h1, `the role list's h1 "${H1}…" at ${at}`).toBeVisible();
}

/** Applies the filter `text`: types it into "Search items", replacing what it held, and presses Enter (criteria). */
async function applyFilter(page: Page, text: string): Promise<void> {
  const filter = screen(page).filter;
  await filter.fill(text, ACTION);
  await filter.press('Enter', ACTION);
}

/** One row as shown: the cells under "Role name", "Trusted entities" and "Last activity". */
interface ShownRole {
  name: string;
  trusted: string;
  last: string;
}

/**
 * The rows of the table inside `root`, each read by the column headings `headings`; a row whose only cell spans the
 * table (loading, empty and failure states) is not a data row. `null` when there is no such table.
 */
async function tableRows(root: Locator, headings: string[]): Promise<string[][] | null> {
  if ((await root.count()) === 0) return null;
  return root.first().evaluate((el, wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    // The table that holds a body and every heading; a sticky copy of the header is hidden from assistive technology.
    for (const table of el.querySelectorAll('table')) {
      if (table.tBodies.length === 0 || table.closest('[aria-hidden="true"]')) continue;
      const head = table.tHead?.rows[0];
      if (!head) continue;
      const names = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
      const at = wanted.map((w) => names.indexOf(w));
      if (at.some((i) => i < 0)) continue;
      const rows: string[][] = [];
      for (const row of table.tBodies[0].rows) {
        if (row.cells.length <= 1) continue;
        rows.push(at.map((i) => norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '')));
      }
      return rows;
    }
    return null;
  }, headings);
}

/** The role list's data rows as shown; `[]` when there is no table. */
async function shownRoles(page: Page): Promise<ShownRole[]> {
  const rows = await tableRows(screen(page).table, [COL_NAME, COL_TRUSTED, COL_LAST]);
  return (rows ?? []).map(([name, trusted, last]) => ({ name, trusted, last }));
}

async function shownNames(page: Page): Promise<string[]> {
  return (await shownRoles(page)).map((r) => r.name);
}

/** Waits until the table's rows are exactly `names`, in that order. */
async function expectNames(page: Page, names: string[], message: string, timeout = 10_000): Promise<void> {
  await expect.poll(() => shownNames(page), { timeout, message }).toEqual(names);
}

/** The `h1` as shown, white space collapsed ("Roles (3)"); `null` when it is not there. */
async function h1Text(page: Page): Promise<string | null> {
  const h1 = screen(page).h1;
  if ((await h1.count()) === 0) return null;
  return (await h1.first().innerText(ACTION)).replace(/\s+/g, ' ').trim();
}

/** Opens "Preferences", chooses the page size `size` and confirms; waits until the dialog is gone. */
async function setPageSize(page: Page, size: 10 | 20 | 50): Promise<void> {
  await screen(page).preferences.click(ACTION);
  const dialog = page.getByRole('dialog', { name: PREFERENCES });
  await expect(dialog, `the dialog "${PREFERENCES}"`).toBeVisible();
  await dialog.getByRole('radio', { name: pageSizeOption(size), exact: true }).check(ACTION);
  await dialog.getByRole('button', { name: CONFIRM, exact: true }).click(ACTION);
  await expect(dialog, `the dialog "${PREFERENCES}" closes`).toHaveCount(0);
}

/**
 * From now on, in the current document, records every text a live region (`aria-live` other than `off`, or the
 * roles `status` and `alert`) comes to hold (`announced`).
 */
async function watchAnnouncements(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __emuforgeItSaid?: string[] };
    w.__emuforgeItSaid = [];
    const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]';
    new MutationObserver((list) => {
      for (const mu of list) {
        const target = mu.target instanceof Element ? mu.target : mu.target.parentElement;
        const region = target?.closest(LIVE);
        const text = (region?.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (region && text !== '') w.__emuforgeItSaid!.push(text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/** The texts live regions held since `watchAnnouncements`. */
async function announced(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __emuforgeItSaid?: string[] }).__emuforgeItSaid ?? []);
}

// ---------------------------------------------------------------------------------------------------------------
// The page's IAM requests to the engine.
// ---------------------------------------------------------------------------------------------------------------

/** The IAM action and parameters of a request to the engine at `engineOrigin` (`POST /`, a Query body), or null. */
function iamRequestOf(
  url: string,
  method: string,
  body: string | null,
  engineOrigin: string,
): { action: string; params: Record<string, string> } | null {
  const u = new URL(url);
  if (u.origin !== engineOrigin || method !== 'POST' || u.pathname !== '/' || body === null) return null;
  const params = Object.fromEntries(new URLSearchParams(body));
  return typeof params.Action === 'string' && params.Version === '2010-05-08'
    ? { action: params.Action, params }
    : null;
}

/** One IAM request of the page, with its answer's status once it came. */
interface IamRequest {
  action: string;
  params: Record<string, string>;
  status: number | null;
}

/** The page's IAM requests to the engine, from Playwright's request events of the context; it only listens. */
class IamRecord {
  readonly requests: IamRequest[] = [];

  static attach(ctx: Ctx, context: BrowserContext, engineOrigin: string): IamRecord {
    const record = new IamRecord();
    const byRequest = new Map<object, IamRequest>();
    context.on('request', (request) => {
      const seen = iamRequestOf(request.url(), request.method(), request.postData(), engineOrigin);
      if (seen === null) return;
      const entry: IamRequest = { ...seen, status: null };
      byRequest.set(request, entry);
      record.requests.push(entry);
    });
    context.on('requestfinished', (request) => {
      const entry = byRequest.get(request);
      if (!entry) return;
      void request.response().then((response) => {
        entry.status = response?.status() ?? 0;
        ctx.log(`${entry.action} ${entry.params.RoleName ?? ''} answered ${String(entry.status)}`);
      });
    });
    return record;
  }

  /** How many `action` requests (with the role `role`, when given) have been answered so far. */
  answered(action: string, role?: string): number {
    return this.requests.filter(
      (r) => r.action === action && r.status !== null && (role === undefined || r.params.RoleName === role),
    ).length;
  }
}

/** The `ListRoles` request of a paused CDP `Fetch` request, read from its body. */
function pausedBody(request: { postData?: string; postDataEntries?: { bytes?: string }[] }): string | null {
  if (request.postData !== undefined) return request.postData;
  if (request.postDataEntries === undefined) return null;
  return request.postDataEntries.map((e) => Buffer.from(e.bytes ?? '', 'base64').toString('utf8')).join('');
}

/**
 * Holds the page's `ListRoles` requests to the engine in the browser while `holding`, through a CDP `Fetch` session
 * on `page`. It answers nothing: a held request is continued unchanged when `release` is called, every other paused
 * request (session, health, `GetRole`, CORS preflights) at once.
 */
class ListRolesHold {
  private holding = true;
  private readonly held: string[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(ctx: Ctx, context: BrowserContext, page: Page, engineOrigin: string): Promise<ListRolesHold> {
    const cdp = await context.newCDPSession(page);
    const hold = new ListRolesHold(ctx, cdp);
    cdp.on('Fetch.requestPaused', (e) => {
      const seen = iamRequestOf(e.request.url, e.request.method, pausedBody(e.request), engineOrigin);
      if (hold.holding && seen?.action === 'ListRoles') {
        hold.held.push(e.requestId);
        ctx.log(`holding ListRoles ${JSON.stringify(seen.params)}`);
        return;
      }
      void cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => undefined);
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${engineOrigin}/*`, requestStage: 'Request' }] });
    return hold;
  }

  /** How many `ListRoles` requests are held now. */
  count(): number {
    return this.held.length;
  }

  /** Lets every held request go, unchanged, and holds no more. */
  async release(): Promise<void> {
    this.holding = false;
    for (const requestId of this.held.splice(0)) {
      await this.cdp.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
    }
    this.ctx.log('let the held ListRoles requests go');
  }

  async stop(): Promise<void> {
    await this.release();
    await this.cdp.send('Fetch.disable').catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-list-shows-what-the-emulator-holds', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rlshows');
  const seeded = new IamSeeded(ctx, port);
  const account = (await callerUserDirect(ctx, port)).account;
  const [a, b, c] = [`${p}-a`, `${p}-b`, `${p}-c`];
  await seeded.role(a, { trust: LAMBDA_TRUST });
  const roleB = await seeded.role(b, { trust: accountTrust(account) });
  await seeded.role(c, { path: `${SERVICE_ROLE_PATH}${p}/`, trust: serviceTrust(`${p}.amazonaws.com`) });
  const trusted: Record<string, string> = {
    [a]: 'AWS Service: lambda',
    [b]: `AWS: arn:aws:iam::${account}:root`,
    [c]: `AWS Service: ${p} (Service-linked role)`,
  };
  const record = IamRecord.attach(ctx, context, stack.engine.url);
  const s = screen(page);

  /** The rows under the filter `<p>`, names and trusted entities, against a direct `ListRoles`. */
  async function expectThreeRows(): Promise<void> {
    const direct = containing(await roleNamesDirect(ctx, port), p);
    expect([...direct].sort(), 'a direct ListRoles holds the three roles').toEqual([a, b, c]);
    await expect
      .poll(async () => (await shownRoles(page)).map((r) => ({ name: r.name, trusted: r.trusted })), {
        message: 'the rows under the filter <p>: name and trusted entities',
      })
      .toEqual(direct.map((name) => ({ name, trusted: trusted[name] })));
  }

  await lines.line(
    'Make directly `<p>-a` (trusted by `lambda.amazonaws.com`), `<p>-b` (trusted by the account `000000000000`\'s root) and `<p>-c` (path `/aws-service-role/<p>/`, trusted by a service principal `<p>.amazonaws.com`), open `/aws/iam/roles` and apply the filter `<p>` → three rows in the order a direct `ListRoles` returns them, with "AWS Service: lambda", "AWS: arn:aws:iam::000000000000:root" and "AWS Service: <p> (Service-linked role)"; "3 matches"',
    async () => {
      ctx.log(`the caller's account: ${account}`);
      await openList(page);
      await applyFilter(page, p);
      await expectThreeRows();
      await expect(s.resultsCount).toHaveText('3 matches');
      await expect(s.resultsCount).toBeVisible();
    },
  );

  await lines.line(
    'Assume `<p>-b` directly and make one call with the role\'s credentials, then "Refresh roles" → the row\'s "Last activity" is what a direct `GetRole` reports for the role in R4.2\'s form ("-" while the emulator reports no date)',
    async () => {
      if ((await s.filter.count()) === 0 || (await s.filter.inputValue(ACTION)) !== p) {
        await openList(page);
        await applyFilter(page, p);
      }
      const credentials = await seeded.assume(roleB.arn);
      const call = readAnswer(await directSts(ctx, port, 'GetCallerIdentity', {}, credentials));
      ctx.log(`direct GetCallerIdentity with the credentials of ${b}: ${shownRead(call)}`);
      const before = record.answered('GetRole', b);
      await s.action(REFRESH).click(ACTION);
      await expect
        .poll(() => record.answered('GetRole', b), { message: `the refresh sent a GetRole of ${b} that was answered` })
        .toBeGreaterThan(before);
      const direct = await getRoleDirect(ctx, port, b);
      ctx.log(`direct GetRole ${b}: RoleLastUsed.LastUsedDate ${String(direct.lastUsedDate)}`);
      await expect
        .poll(async () => (await shownRoles(page)).find((r) => r.name === b)?.last ?? null, {
          message: `"${COL_LAST}" of ${b}`,
        })
        .toBe(lastActivityText(direct.lastUsedDate));
    },
  );

  await lines.line('Open `/aws/iam` → the same screen, the address unchanged', async () => {
    await openList(page, IAM_PATH);
    await expect(page).toHaveURL(addressOf(IAM_PATH));
    await applyFilter(page, p);
    await expectThreeRows();
    await expect(page).toHaveURL(addressOf(IAM_PATH));
  });

  await lines.line('From Home, the link "AWS Identity and Access Management" → the role list', async () => {
    await page.goto('/');
    await expectHome(page);
    await providersSection(page).getByRole('link', { name: SERVICE_LABEL, exact: true }).click(ACTION);
    await expect(s.h1, `the role list's h1 "${H1}…"`).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${addressOf(IAM_PATH).source.slice(0, -1)}(/roles)?$`));
    await applyFilter(page, p);
    await expectThreeRows();
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-list-empty-emulator-says-no-roles', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rlempty');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);

  await lines.line(
    'Open the list on an emulator that holds no role → `h1` "Roles (0)", "No roles", the sentence of R10 and "Create role"; a direct `ListRoles` returns none',
    async () => {
      await openList(page);
      await expect(s.empty.getByText(NO_ROLES, { exact: true }), `"${NO_ROLES}"`).toBeVisible();
      await expect(s.empty.getByText(EMPTY_SENTENCE, { exact: true }), 'the sentence of R10').toBeVisible();
      await expect(s.empty.getByRole('button', { name: CREATE, exact: true }), `"${CREATE}"`).toBeVisible();
      await expect.poll(() => h1Text(page), { message: 'the h1' }).toBe(`${H1} (0)`);
      expect(await roleNamesDirect(ctx, port), 'a direct ListRoles').toEqual([]);
    },
  );

  await lines.line('"Create role" of the empty state → the wizard', async () => {
    await s.empty.getByRole('button', { name: CREATE, exact: true }).click(ACTION);
    await expect(page).toHaveURL(addressOf(CREATE_PATH));
    await expect(heading(page, WIZARD_H1), `the wizard's h1 "${WIZARD_H1}"`).toBeVisible();
  });

  await lines.line('Make one role directly, "Refresh roles" → `h1` "Roles (1)" and its row', async () => {
    const only = `${p}-only`;
    // Back on the list as it was read before the role exists, so the row can come only from "Refresh roles".
    if (addressOf(CREATE_PATH).test(page.url())) await page.goBack();
    if ((await s.h1.count()) === 0) await openList(page);
    await expect(s.empty.getByText(NO_ROLES, { exact: true }), `"${NO_ROLES}" before the role is made`).toBeVisible();
    await seeded.role(only);
    await s.action(REFRESH).click(ACTION);
    await expectNames(page, [only], 'the rows after "Refresh roles"');
    await expect.poll(() => h1Text(page), { message: 'the h1' }).toBe(`${H1} (1)`);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-list-rereads-on-open-and-refresh', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rlreread');
  const seeded = new IamSeeded(ctx, port);
  const [first, second, third] = [`${p}-1`, `${p}-2`, `${p}-3`];
  await seeded.role(first);
  const s = screen(page);

  await lines.line(
    'With the filter `<p>` applied and one role shown, make a second directly, "Refresh roles" → the filter text stays and both rows are shown; "Role list refreshed" is announced',
    async () => {
      await openList(page);
      await applyFilter(page, p);
      await expectNames(page, [first], 'the rows under the filter <p>');
      await seeded.role(second);
      await watchAnnouncements(page);
      await s.action(REFRESH).click(ACTION);
      const direct = containing(await roleNamesDirect(ctx, port), p);
      expect(direct, 'a direct ListRoles under <p>').toEqual([first, second]);
      await expectNames(page, direct, 'the rows after "Refresh roles"');
      await expect(s.filter, 'the filter text after "Refresh roles"').toHaveValue(p);
      await expect
        .poll(async () => (await announced(page)).some((t) => t.includes(REFRESHED)), {
          message: `"${REFRESHED}" is announced`,
        })
        .toBe(true);
    },
  );

  await lines.line(
    'Make a third directly, go to Home and back to the list, apply the filter `<p>` → three rows',
    async () => {
      if (!seeded.has(second)) await seeded.role(second);
      await seeded.role(third);
      if ((await s.h1.count()) === 0) await openList(page);
      await crumbLink(page, 'EmuForge').click(ACTION);
      await expectHome(page);
      await page.goBack();
      await expect(s.h1).toBeVisible();
      await applyFilter(page, p);
      const direct = containing(await roleNamesDirect(ctx, port), p);
      expect(direct, 'a direct ListRoles under <p>').toEqual([first, second, third]);
      await expectNames(page, direct, 'the rows under the filter <p> after coming back');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-list-pages-follow-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rlpages');
  const seeded = new IamSeeded(ctx, port);
  const made = Array.from({ length: 12 }, (_, i) => `${p}-${String(i + 1).padStart(2, '0')}`);
  for (const name of made) await seeded.role(name);
  const direct = await roleNamesDirect(ctx, port);
  expect([...direct].sort(), 'a direct ListRoles lists the twelve roles').toEqual([...made].sort());
  const s = screen(page);

  await lines.line(
    'With 12 roles made directly and page size "10 roles" → page 1 holds the first 10 names of a direct `ListRoles`, `h1` "Roles (10+)"; "Next page" → the other 2, `h1` "Roles (12)", and "Next page" is disabled',
    async () => {
      await openList(page);
      await setPageSize(page, 10);
      await expectNames(page, direct.slice(0, 10), 'page 1 with the page size 10');
      await expect.poll(() => h1Text(page), { message: 'the h1 on page 1' }).toBe(`${H1} (10+)`);
      await s.nextPage.click(ACTION);
      await expectNames(page, direct.slice(10), 'page 2');
      await expect.poll(() => h1Text(page), { message: 'the h1 on page 2' }).toBe(`${H1} (12)`);
      await expect(s.nextPage, '"Next page" on the last page').toBeDisabled();
    },
  );

  await lines.line(
    'Delete directly one of the first 10, then "Previous page" → page 1 is read again: it holds the first 10 names of a direct `ListRoles` made at that moment, and the deleted name is not among them',
    async () => {
      const gone = direct[3];
      await seeded.remove(gone);
      const now = await roleNamesDirect(ctx, port);
      expect(now, `a direct ListRoles after deleting ${gone}`).not.toContain(gone);
      await s.previousPage.click(ACTION);
      await expectNames(page, now.slice(0, 10), 'page 1 read again');
      expect(await shownNames(page), 'page 1').not.toContain(gone);
    },
  );

  await lines.line('Page size "20 roles" → one page with every role the emulator holds', async () => {
    await setPageSize(page, 20);
    await expectNames(page, await roleNamesDirect(ctx, port), 'the rows with the page size 20');
  });

  await lines.line(
    'With page size "10 roles" and a filter text that 11 of 23 names contain → 10 rows and "10+ matches"; "Next page" → the eleventh and "11 matches"',
    async () => {
      const text = `${p}-hit`;
      const held = (await roleNamesDirect(ctx, port)).length;
      for (let i = 1; i <= 11; i++) await seeded.role(`${text}-${String(i).padStart(2, '0')}`);
      for (let i = 1; i <= 12 - held; i++) await seeded.role(`${p}-other-${String(i).padStart(2, '0')}`);
      const all = await roleNamesDirect(ctx, port);
      const hits = containing(all, text);
      expect({ all: all.length, hits: hits.length }, 'a direct ListRoles: 23 names, 11 of them hold the text').toEqual({
        all: 23,
        hits: 11,
      });
      await openList(page);
      await setPageSize(page, 10);
      await applyFilter(page, text);
      await expectNames(page, hits.slice(0, 10), 'page 1 under the filter');
      await expect(s.resultsCount).toHaveText('10+ matches');
      await s.nextPage.click(ACTION);
      await expectNames(page, hits.slice(10), 'page 2 under the filter');
      await expect(s.resultsCount).toHaveText('11 matches');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-list-filter-matches-part-of-a-name', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rlfilter');
  const seeded = new IamSeeded(ctx, port);
  const names = [`${p}-abc`, `${p}-xabcx`, `${p}-ABC2`, `${p}-abd`, `x${p}-abc`];
  for (const name of names) await seeded.role(name);
  const s = screen(page);

  /** The roles of a direct `ListRoles` whose names contain `${p}-abc`, upper and lower case alike, in its order. */
  async function abcDirect(): Promise<string[]> {
    const direct = containing(
      (await listRolesDirect(ctx, port)).map((r) => r.name),
      `${p}-abc`,
    );
    expect([...direct].sort(), 'a direct ListRoles: the names that contain <p>-abc').toEqual(
      [`${p}-abc`, `${p}-ABC2`, `x${p}-abc`].sort(),
    );
    return direct;
  }

  await lines.line(
    'With `<p>-abc`, `<p>-xabcx`, `<p>-ABC2`, `<p>-abd` and `x<p>-abc` made directly, apply the filter `<p>-abc` → exactly `<p>-abc`, `<p>-ABC2` and `x<p>-abc`, in the order of a direct `ListRoles`; "3 matches"',
    async () => {
      await openList(page);
      await applyFilter(page, `${p}-abc`);
      await expectNames(page, await abcDirect(), 'the rows under the filter <p>-abc');
      await expect(s.resultsCount).toHaveText('3 matches');
      await expect(s.resultsCount).toBeVisible();
    },
  );

  await lines.line(
    'Apply `ABC` with the text `<p>` before it in upper case → the same three (upper and lower case alike)',
    async () => {
      if ((await s.filter.count()) === 0) await openList(page);
      await applyFilter(page, `${p.toUpperCase()}-ABC`);
      await expectNames(page, await abcDirect(), 'the rows under the filter <P>-ABC');
      await expect(s.resultsCount).toHaveText('3 matches');
    },
  );

  await lines.line(
    'Apply `<p>-zz` → "No matches" and "No role name contains “<p>-zz”."; "Clear filter" → an empty field, and the list without a filter',
    async () => {
      if ((await s.filter.count()) === 0) await openList(page);
      await applyFilter(page, `${p}-zz`);
      await expect(s.empty.getByText(NO_MATCHES, { exact: true }), `"${NO_MATCHES}"`).toBeVisible();
      await expect(s.empty.getByText(noMatchSentence(`${p}-zz`), { exact: true })).toBeVisible();
      await s.empty.getByRole('button', { name: CLEAR_FILTER, exact: true }).click(ACTION);
      await expect(s.filter, 'the filter after "Clear filter"').toHaveValue('');
      await expect.poll(async () => (await shownNames(page)).length, { message: 'rows are shown' }).toBeGreaterThan(0);
      await expect(s.resultsCount, 'no match count without a filter').toHaveCount(0);
    },
  );

  await lines.line('Type `<p>-abd` and wait without pressing Enter → the one row `<p>-abd`', async () => {
    if ((await s.filter.count()) === 0) await openList(page);
    await s.filter.fill(`${p}-abd`, ACTION);
    await expectNames(page, [`${p}-abd`], 'the rows once the typed text is applied without Enter');
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-list-shows-loading-until-the-answer', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rlloading');
  const seeded = new IamSeeded(ctx, stack.emulatorPort);
  await seeded.role(`${p}-a`);
  const s = screen(page);
  const hold = await ListRolesHold.attach(ctx, context, page, stack.engine.url);

  await lines.line(
    'Open the role list with the `ListRoles` request held back (delayed, not answered by the check) → "Loading roles", no counter after the heading, and the filter disabled',
    async () => {
      await openList(page);
      await expect.poll(() => hold.count(), { message: 'a ListRoles request is held' }).toBeGreaterThan(0);
      await expect(s.table.getByText(LOADING, { exact: true }), `"${LOADING}"`).toBeVisible();
      expect(await h1Text(page), 'the h1, without a counter').toBe(H1);
      await expect(s.filter, 'the filter while loading').toBeDisabled();
    },
  );

  await lines.line('Let the request go → the rows or "No roles", a counter, and the filter enabled', async () => {
    await hold.release();
    await expect
      .poll(
        async () =>
          (await shownNames(page)).length > 0 || (await s.empty.getByText(NO_ROLES, { exact: true }).count()) > 0,
        { message: `rows or "${NO_ROLES}" are shown` },
      )
      .toBe(true);
    await expect.poll(() => h1Text(page), { message: 'the h1 with a counter' }).toMatch(/^Roles \(\d+\+?\)$/);
    await expect(s.filter, 'the filter once loaded').toBeEnabled();
  });

  await hold.stop();
  lines.end();
});
