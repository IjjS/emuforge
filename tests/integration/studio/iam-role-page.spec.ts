// An IAM role's own page in the built app served by `bun run serve`, in front of a real engine started for that
// Studio and the run's emulator (test-criteria.md, issue 82, Flow checks; requirement R0, R5.1 to R5.4, R8, R10):
// what the emulator holds for a role, a plain role, read again on "Refresh role", a name in the other case, a name
// of every allowed sign, and a role the emulator does not hold.
//
// `studio.iam-role-page-shows-the-role`, `studio.iam-role-page-of-a-missing-role-says-not-found`.
//
// Other checks make roles on the run's emulator at the same time, so each check names its roles with its own prefix
// `<p>` (lower-case letters and digits). Roles and policies are made and read directly with `support/iam.ts` and
// taken apart when the check ends. Every value the page is compared with comes from a direct call made in the line.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import {
  attachedPoliciesDirect,
  getRoleAnswer,
  getRoleDirect,
  IamSeeded,
  inlinePolicyNamesDirect,
  READ_ONLY_ACCESS,
  type DirectRole,
} from './support/iam';
import { Lines } from './support/lines';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R0, R5, R8, R10; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const LIST_H1 = 'Roles';
const FILTER = 'Search items';
const COL_NAME = 'Role name';

/** The page's own control (R8, question 4) and its announcement. */
const REFRESH_ROLE = 'Refresh role';
const REFRESHED = 'Role refreshed';

/** The sections (R5.3) and the fields of "Summary". */
const SUMMARY = 'Summary';
const POLICIES = 'Permissions policies';
const BOUNDARY = 'Permissions boundary';
const F_CREATED = 'Creation date';
const F_ARN = 'ARN';
const F_LAST = 'Last activity';
const F_DURATION = 'Maximum session duration';
const F_DESCRIPTION = 'Description';
const F_PATH = 'Path';
const SUMMARY_FIELDS = [F_CREATED, F_ARN, F_LAST, F_DURATION, F_DESCRIPTION, F_PATH];

/** The columns of "Permissions policies", its types and its empty state (R5.3). */
const COL_POLICY = 'Policy name';
const COL_TYPE = 'Type';
const AWS_MANAGED = 'AWS managed';
const CUSTOMER_MANAGED = 'Customer managed';
const CUSTOMER_INLINE = 'Customer inline';
const NO_POLICIES = 'No policies';
const NOT_SET = 'Not set';

/** "Role not found" (R5.4). */
const NOT_FOUND = 'Role not found';
function notFoundSentence(name: string): string {
  return `The emulator holds no role named “${name}”. It may have been deleted, or the emulator restarted.`;
}

/** A role's page (R0): its name as one path segment, percent-encoded where a URL needs it. */
function rolePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Names and values as the screen writes them.
// ---------------------------------------------------------------------------------------------------------------

/** The check's own prefix `<p>`: `efit<run id><tag>`, lower-case letters and digits only. */
function rolePrefix(ctx: Ctx, tag: string): string {
  return `efit${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '')}${tag}`;
}

/** "Creation date" for a `CreateDate` of a direct answer (R5.3): `YYYY-MM-DD HH:MM:SS UTC`. */
function createdText(iso: string): string {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
}

/** "Maximum session duration" for `seconds` (R5.3). */
function durationText(seconds: number): string {
  if (seconds === 3600) return '1 hour';
  if (seconds % 3600 === 0) return `${String(seconds / 3600)} hours`;
  return `${String(seconds)} seconds`;
}

/** The type of an attached policy by its ARN's account (R5.3). */
function managedType(arn: string): string {
  return arn.startsWith('arn:aws:iam::aws:') ? AWS_MANAGED : CUSTOMER_MANAGED;
}

/** The rows "Permissions policies" should hold for `role`: attached ones in a direct order, then inline ones. */
async function expectedPolicyRows(ctx: Ctx, port: number, role: string): Promise<string[][]> {
  const attached = await attachedPoliciesDirect(ctx, port, role);
  const inline = await inlinePolicyNamesDirect(ctx, port, role);
  return [...attached.map((a) => [a.name, managedType(a.arn)]), ...inline.map((n) => [n, CUSTOMER_INLINE])];
}

// ---------------------------------------------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
const LIST_TABLE = wrapper.findTable().toSelector();

function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    listH1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    listTable: page.locator(LIST_TABLE).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    refreshRole: main.getByRole('button', { name: REFRESH_ROLE, exact: true }),
    policies: main.getByRole('table', { name: POLICIES, exact: true }),
    tabs: main.getByRole('tab'),
  };
}

/** Opens the page of `name` by a deep link and waits for its `h1` `shownName`. */
async function openRole(page: Page, name: string, shownName = name): Promise<void> {
  await page.goto(rolePath(name));
  await expect(heading(page, shownName), `the role's page with the h1 "${shownName}"`).toBeVisible();
}

/**
 * The text of the section titled `title` inside `root`: the Cloudscape container around its heading, or else the
 * nearest element around the heading that holds more than the heading's own header. `null` when no heading has it.
 */
async function sectionText(root: Locator, title: string): Promise<string | null> {
  return root.evaluate(
    (el, { title, container }) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const headings = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')];
      const h = headings.find((x) => {
        const t = norm((x as HTMLElement).innerText);
        return t === title || t.startsWith(`${title} (`);
      });
      if (!h) return null;
      let box: Element | null = h.closest(container);
      if (box === null) {
        const own = norm(((h.closest('header') ?? h) as HTMLElement).innerText);
        box = h;
        while (box.parentElement && norm((box as HTMLElement).innerText).length <= own.length) box = box.parentElement;
      }
      return norm((box as HTMLElement).innerText);
    },
    { title, container: wrapper.findContainer().toSelector() },
  );
}

/**
 * The values of the key-value pairs `labels` in the section "Summary": for each label, the `dd` after its `dt`, or
 * else the text of the nearest element around the label that holds more than the label, without the label. A label
 * that is not shown has no entry.
 */
async function summaryValues(page: Page): Promise<Record<string, string>> {
  return screen(page).main.evaluate(
    (el, { title, labels, container }) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
      const h = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find(
        (x) => norm((x as HTMLElement).innerText) === title,
      );
      if (!h) return {};
      const box = h.closest(container) ?? el;
      const values: Record<string, string> = {};
      for (const label of labels) {
        const matches = [...box.querySelectorAll('*')].filter(
          (x) => !x.closest('h1, h2, h3, h4, h5, h6') && norm((x as HTMLElement).innerText ?? '') === label,
        );
        const deepest = matches.find((x) => !matches.some((y) => y !== x && x.contains(y)));
        if (!deepest) continue;
        const dt = deepest.closest('dt');
        if (dt && dt.nextElementSibling?.tagName === 'DD') {
          values[label] = norm((dt.nextElementSibling as HTMLElement).innerText);
          continue;
        }
        let up: Element = deepest;
        while (up.parentElement && norm((up as HTMLElement).innerText) === label) up = up.parentElement;
        const text = norm((up as HTMLElement).innerText);
        values[label] = text.startsWith(label) ? text.slice(label.length).trim() : text;
      }
      return values;
    },
    { title: SUMMARY, labels: SUMMARY_FIELDS, container: wrapper.findContainer().toSelector() },
  );
}

/** The data rows of `table` read by the column headings `headings`; a row of one cell (a state) is not one. */
async function rowsOf(table: Locator, headings: string[]): Promise<string[][] | null> {
  if ((await table.count()) === 0) return null;
  return table.first().evaluate((t, wanted) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const el = t as HTMLTableElement;
    const head = el.tHead?.rows[0];
    if (!head || el.tBodies.length === 0) return null;
    const names = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
    const at = wanted.map((w) => names.indexOf(w));
    if (at.some((i) => i < 0)) return null;
    const rows: string[][] = [];
    for (const row of el.tBodies[0].rows) {
      if (row.cells.length <= 1) continue;
      rows.push(at.map((i) => norm((row.cells[i] as HTMLElement | undefined)?.innerText ?? '')));
    }
    return rows;
  }, headings);
}

/** The rows of "Permissions policies" as shown: name and type. */
async function shownPolicyRows(page: Page): Promise<string[][] | null> {
  return rowsOf(screen(page).policies, [COL_POLICY, COL_TYPE]);
}

/** The role list's names as shown (the table that holds a "Role name" column). */
async function listNames(page: Page): Promise<string[]> {
  return screen(page).listTable.evaluate((el, col) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    for (const table of el.querySelectorAll('table')) {
      if (table.tBodies.length === 0 || table.closest('[aria-hidden="true"]')) continue;
      const head = table.tHead?.rows[0];
      if (!head) continue;
      const at = [...head.cells].map((c) => norm((c as HTMLElement).innerText)).indexOf(col);
      if (at < 0) continue;
      return [...table.tBodies[0].rows]
        .filter((r) => r.cells.length > 1)
        .map((r) => norm((r.cells[at] as HTMLElement | undefined)?.innerText ?? ''));
    }
    return [];
  }, COL_NAME);
}

/** Records every text a live region comes to hold from now on, in the current document (`announced`). */
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

async function announced(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __emuforgeItSaid?: string[] }).__emuforgeItSaid ?? []);
}

/** "Summary" shows what a direct `GetRole` of the role reports, with `description` and `duration` as written. */
async function expectSummary(page: Page, role: DirectRole, message: string): Promise<void> {
  await expect
    .poll(() => summaryValues(page), { message })
    .toEqual({
      [F_CREATED]: createdText(role.createDate),
      [F_ARN]: role.arn,
      [F_LAST]: '-',
      [F_DURATION]: durationText(role.maxSessionDuration ?? 3600),
      [F_DESCRIPTION]: role.description === null || role.description === '' ? '-' : role.description,
      [F_PATH]: role.path,
    });
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-page-shows-the-role', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rpshows');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);

  const full = `${p}-full`;
  const managed = await seeded.policy(`${p}-managed`);
  const boundary = await seeded.policy(`${p}-boundary`);
  await seeded.role(full, {
    path: `/${p}/`,
    description: `The role of ${p}`,
    maxSessionDuration: 7200,
    tags: [{ key: 'team', value: 'studio' }],
    boundary,
  });
  await seeded.attach(full, READ_ONLY_ACCESS);
  await seeded.attach(full, managed);
  await seeded.inline(full, `${p}-inline`);
  const plain = `${p}-plain`;
  await seeded.role(plain);

  await lines.line(
    'Make directly a role with the path `/<p>/`, a description, a maximum session duration of 7200, `ReadOnlyAccess` and a customer managed policy attached, an inline policy, a tag and a permissions boundary; open its page by a deep link → `h1` is the name; "Summary" shows the creation date and ARN a direct `GetRole` reports, "-" for "Last activity", "2 hours", the description and the path; "Permissions policies" has three rows in the order of a direct `ListAttachedRolePolicies` then `ListRolePolicies`, with "AWS managed", "Customer managed" and "Customer inline"; "Permissions boundary" shows the boundary\'s ARN',
    async () => {
      const direct = await getRoleDirect(ctx, port, full);
      expect(
        { path: direct.path, duration: direct.maxSessionDuration, boundary: direct.permissionsBoundaryArn },
        'a direct GetRole of the role made',
      ).toEqual({ path: `/${p}/`, duration: 7200, boundary });
      await openRole(page, full);
      await expectSummary(page, direct, `"${SUMMARY}" of ${full}`);
      const rows = await expectedPolicyRows(ctx, port, full);
      expect(
        [...rows.map((r) => r[1])].sort(),
        'a direct ListAttachedRolePolicies then ListRolePolicies: one policy of each type',
      ).toEqual([AWS_MANAGED, CUSTOMER_INLINE, CUSTOMER_MANAGED].sort());
      await expect.poll(() => shownPolicyRows(page), { message: `the rows of "${POLICIES}"` }).toEqual(rows);
      await expect.poll(() => sectionText(s.main, BOUNDARY), { message: `"${BOUNDARY}"` }).toContain(boundary);
    },
  );

  await lines.line(
    'Open the page of a plain role → "-" for "Description", "1 hour", "No policies", "Not set"',
    async () => {
      const direct = await getRoleDirect(ctx, port, plain);
      await openRole(page, plain);
      await expectSummary(page, direct, `"${SUMMARY}" of ${plain}`);
      const values = await summaryValues(page);
      expect({ d: values[F_DESCRIPTION], m: values[F_DURATION] }, 'description and duration').toEqual({
        d: '-',
        m: '1 hour',
      });
      await expect(s.policies.getByText(NO_POLICIES, { exact: true }), `"${NO_POLICIES}"`).toBeVisible();
      await expect.poll(() => shownPolicyRows(page), { message: `no row in "${POLICIES}"` }).toEqual([]);
      await expect
        .poll(async () => (await sectionText(s.main, BOUNDARY)) ?? '', { message: `"${BOUNDARY}"` })
        .toContain(NOT_SET);
    },
  );

  await lines.line('Attach a policy directly, "Refresh role" → its row; "Role refreshed" is announced', async () => {
    if ((await heading(page, plain).count()) === 0) await openRole(page, plain);
    await expect(s.policies.getByText(NO_POLICIES, { exact: true }), 'no policy before the attach').toBeVisible();
    await seeded.attach(plain, READ_ONLY_ACCESS);
    await watchAnnouncements(page);
    await s.refreshRole.click(ACTION);
    const rows = await expectedPolicyRows(ctx, port, plain);
    expect(rows, `a direct ListAttachedRolePolicies of ${plain}`).toEqual([['ReadOnlyAccess', AWS_MANAGED]]);
    await expect.poll(() => shownPolicyRows(page), { message: 'the rows after "Refresh role"' }).toEqual(rows);
    await expect
      .poll(async () => (await announced(page)).some((t) => t.includes(REFRESHED)), {
        message: `"${REFRESHED}" is announced`,
      })
      .toBe(true);
  });

  await lines.line(
    "Open the page with the name's letters in the other case → `h1` is the name as the emulator holds it",
    async () => {
      const direct = await getRoleDirect(ctx, port, full.toUpperCase());
      expect(direct.name, 'a direct GetRole of the name in upper case').toBe(full);
      await page.goto(rolePath(full.toUpperCase()));
      await expect(heading(page, full), `the h1 "${full}"`).toBeVisible();
      await expect(heading(page, full.toUpperCase()), 'no h1 in upper case').toHaveCount(0);
    },
  );

  await lines.line(
    'Open the page of a role named `<p>+a=b,c.d@e_f` from its row in the list → its page, `h1` the name',
    async () => {
      const signs = `${p}+a=b,c.d@e_f`;
      if (!seeded.has(signs)) await seeded.role(signs);
      await page.goto(ROLES_PATH);
      await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
      await s.filter.fill(signs, ACTION);
      await s.filter.press('Enter', ACTION);
      await expect.poll(() => listNames(page), { message: `the row ${signs}` }).toEqual([signs]);
      await s.listTable.getByRole('link', { name: signs, exact: true }).click(ACTION);
      await expect(heading(page, signs), `the h1 "${signs}"`).toBeVisible();
      const segment = new URL(page.url()).pathname.replace(/^\/aws\/iam\/roles\/details\//, '');
      expect(decodeURIComponent(segment), 'the path segment of the page, decoded').toBe(signs);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-page-of-a-missing-role-says-not-found', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rpnone');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);

  /** "Role not found" with the sentence for `name`, no tabs and no sections. */
  async function expectNotFound(name: string): Promise<void> {
    await expect(s.main.getByText(NOT_FOUND, { exact: true }), `"${NOT_FOUND}"`).toBeVisible();
    await expect(s.main.getByText(notFoundSentence(name), { exact: true }), 'the sentence of R5.4').toBeVisible();
    await expect(s.tabs, 'no tabs').toHaveCount(0);
    await expect(s.policies, `no "${POLICIES}"`).toHaveCount(0);
  }

  await lines.line(
    'Open `/aws/iam/roles/details/<p>-none` → `h1` `<p>-none`, "Role not found", the sentence of R5.4, no tabs; the link "Roles" → the list',
    async () => {
      const none = `${p}-none`;
      const answer = await getRoleAnswer(ctx, port, none);
      expect(answer.ok ? 'found' : answer.code, `a direct GetRole of ${none}`).toBe('NoSuchEntity');
      await page.goto(rolePath(none));
      await expect(heading(page, none), `the h1 "${none}"`).toBeVisible();
      await expectNotFound(none);
      await s.main.getByRole('link', { name: LIST_H1, exact: true }).last().click(ACTION);
      await expect(page).toHaveURL(addressOf(ROLES_PATH));
      await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
    },
  );

  await lines.line('Open a role\'s page, delete the role directly, "Refresh role" → "Role not found"', async () => {
    const gone = `${p}-gone`;
    await seeded.role(gone);
    await openRole(page, gone);
    await expect
      .poll(async () => (await summaryValues(page))[F_ARN] ?? null, { message: 'the role is shown' })
      .not.toBeNull();
    await seeded.remove(gone);
    await s.refreshRole.click(ACTION);
    await expectNotFound(gone);
  });

  lines.end();
});
