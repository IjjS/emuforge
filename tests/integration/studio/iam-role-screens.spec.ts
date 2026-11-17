// The three IAM role screens together in the built app served by `bun run serve`, in front of a real engine started
// for that Studio and the run's emulator (test-criteria.md, issue 82, Flow checks; requirement R6.1, R8, R11): where
// each control leads, and that the screens talk only to the engine, hold no emulator key, store no role data and
// show every value from the emulator as text.
//
// `studio.iam-role-screens-actions-lead-to-their-routes`, `studio.iam-role-screens-talk-only-to-the-engine`.
//
// Other checks make roles on the run's emulator at the same time, so each check names its roles with its own prefix
// `<p>` (lower-case letters and digits) and shows them under a filter that holds `<p>`. Roles are made and read
// directly with `support/iam.ts`; what Studio did not delete is taken apart when the check ends. The page's
// requests are recorded from the outside (`support/traffic.ts`); nothing changes them.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { BrowserContext, Page } from '@playwright/test';

import { emulatorDir, EnvError, expect, readEmulatorFiles, startStack, test, type Ctx } from './support';
import { crumbLink } from './support/aws-area';
import { ACTION, addressOf, heading, SIDE_NAVIGATION } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { getRoleDirect, IamSeeded, roleIsGone, serviceTrust } from './services/iam/iam';
import { Lines } from './support/lines';
import { expectNoScreenPart } from './support/no-screen-part';
import { Traffic } from './support/traffic';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R0, R4 to R8; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const CREATE_PATH = '/aws/iam/roles/create';
const SERVICE_LABEL = 'AWS Identity and Access Management';
const LIST_H1 = 'Roles';
const WIZARD_H1 = 'Select trusted entity';
const FILTER = 'Search items';
const COL_NAME = 'Role name';
const COL_TRUSTED = 'Trusted entities';
const CREATE = 'Create role';
const DELETE = 'Delete';
const NEXT = 'Next';
const F_SERVICE = 'Service or use case';
const F_NAME = 'Role name';
const F_DESCRIPTION = 'Description';
const ADD_TAG = 'Add new tag';
const POLICIES = 'Permissions policies';
const EDIT = 'Edit';
const EDIT_DIALOG = 'Edit summary';
const SAVE = 'Save changes';
const CONFIRM_FIELD = 'To confirm, type delete';
const SUMMARY = 'Summary';

/** The four tabs that lead to their own routes (R8), with the end of each route. */
const TAB_ROUTES: [string, string][] = [
  ['Trust relationships', 'trust-relationships'],
  ['Tags', 'tags'],
  ['Last Accessed', 'last-accessed'],
  ['Revoke sessions', 'revoke-sessions'],
];

function rolePath(name: string): string {
  return `/aws/iam/roles/details/${encodeURIComponent(name)}`;
}

function createdText(name: string): string {
  return `Role “${name}” was created in the local emulator.`;
}

function updatedText(name: string): string {
  return `Role “${name}” was updated in the local emulator.`;
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
const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();
const CONTAINER = wrapper.findContainer().toSelector();
const TAG_EDITOR = wrapper.findTagEditor();
const TAG_KEY = `${TAG_EDITOR.findRow(1).findField(1).findControl().toSelector()} input`;
const TAG_VALUE = `${TAG_EDITOR.findRow(1).findField(2).findControl().toSelector()} input`;

function screen(page: Page) {
  const main = page.getByRole('main');
  return {
    main,
    listH1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    listTable: page.locator(LIST_TABLE).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
    button: (name: string) => main.getByRole('button', { name, exact: true }).first(),
    tab: (name: string) => main.getByRole('tab', { name, exact: true }),
    sideRoles: page.locator(SIDE_NAVIGATION).getByRole('link', { name: LIST_H1, exact: true }),
    flashItems: page.locator(FLASH_ITEMS),
  };
}

/** Opens the list afresh, applies the filter `text` and waits until the rows are exactly `names`. */
async function listUnder(page: Page, text: string, names: string[]): Promise<void> {
  const s = screen(page);
  await page.goto(ROLES_PATH);
  await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
  await s.filter.fill(text, ACTION);
  await s.filter.press('Enter', ACTION);
  await expect
    .poll(async () => (await listRows(page)).map((r) => r.name), { message: `the rows under the filter ${text}` })
    .toEqual(names);
}

/** The role list's rows as shown: name and trusted entities. */
async function listRows(page: Page): Promise<{ name: string; trusted: string }[]> {
  const table = screen(page).listTable;
  if ((await table.count()) === 0) return [];
  return table.evaluate(
    (el, cols) => {
      const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
      for (const t of el.querySelectorAll('table')) {
        if (t.tBodies.length === 0 || t.closest('[aria-hidden="true"]')) continue;
        const head = t.tHead?.rows[0];
        if (!head) continue;
        const names = [...head.cells].map((c) => norm((c as HTMLElement).innerText));
        const at = cols.map((c) => names.indexOf(c));
        if (at.some((i) => i < 0)) continue;
        return [...t.tBodies[0].rows]
          .filter((r) => r.cells.length > 1)
          .map((r) => ({
            name: norm((r.cells[at[0]] as HTMLElement | undefined)?.innerText ?? ''),
            trusted: norm((r.cells[at[1]] as HTMLElement | undefined)?.innerText ?? ''),
          }));
      }
      return [];
    },
    [COL_NAME, COL_TRUSTED],
  );
}

/** The value of "Description" in "Summary" (the `dd` after its `dt`, or the text around the label without it). */
async function summaryDescription(page: Page): Promise<string | null> {
  return screen(page).main.evaluate(
    (el, { title, label, container }) => {
      const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
      const h = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].find(
        (x) => norm((x as HTMLElement).innerText) === title,
      );
      if (!h) return null;
      const box = h.closest(container) ?? el;
      const matches = [...box.querySelectorAll('*')].filter(
        (x) => !x.closest('h1, h2, h3, h4, h5, h6') && norm((x as HTMLElement).innerText ?? '') === label,
      );
      const deepest = matches.find((x) => !matches.some((y) => y !== x && x.contains(y)));
      if (!deepest) return null;
      const dt = deepest.closest('dt');
      if (dt && dt.nextElementSibling?.tagName === 'DD') return norm((dt.nextElementSibling as HTMLElement).innerText);
      let up: Element = deepest;
      while (up.parentElement && norm((up as HTMLElement).innerText) === label) up = up.parentElement;
      const text = norm((up as HTMLElement).innerText);
      return text.startsWith(label) ? text.slice(label.length).trim() : text;
    },
    { title: SUMMARY, label: F_DESCRIPTION, container: CONTAINER },
  );
}

async function expectFlash(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () => (await screen(page).flashItems.allInnerTexts()).some((t) => t.replace(/\s+/g, ' ').includes(text)),
      { message: `the Flashbar says "${text}"`, timeout: 20_000 },
    )
    .toBe(true);
}

/** What the browser keeps for Studio's origin: local and session storage, IndexedDB and cookies, as text. */
async function storedValues(page: Page, context: BrowserContext): Promise<Record<string, string>> {
  const kept = await page.evaluate(async () => {
    const dump = (st: Storage) => JSON.stringify(Object.entries(st));
    const databases: string[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of db.objectStoreNames) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, 'readonly').objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        databases.push(`${info.name}/${store}: ${JSON.stringify(rows)}`);
      }
      db.close();
    }
    return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage), indexedDB: databases.join('\n') };
  });
  return { ...kept, cookies: JSON.stringify(await context.cookies()) };
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-screens-actions-lead-to-their-routes', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rsroutes');
  const seeded = new IamSeeded(ctx, port);
  const one = `${p}-one`;
  await seeded.role(one);
  const s = screen(page);

  await lines.line(
    "A role's name in the list → `/aws/iam/roles/details/<name>` and the role's page, without a document reload",
    async () => {
      await listUnder(page, p, [one]);
      await markPage(page);
      await s.listTable.getByRole('link', { name: one, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(rolePath(one)));
      await expect(heading(page, one), `the role's page with the h1 "${one}"`).toBeVisible();
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line('"Create role" → `/aws/iam/roles/create`', async () => {
    await listUnder(page, p, [one]);
    await markPage(page);
    await s.button(CREATE).click(ACTION);
    await expect(page).toHaveURL(addressOf(CREATE_PATH));
    await expect(heading(page, WIZARD_H1), `the wizard's h1 "${WIZARD_H1}"`).toBeVisible();
    expect(await stillSamePage(page), 'no document was loaded').toBe(true);
  });

  await lines.line(
    'On a role\'s page, each of "Trust relationships", "Tags", "Last Accessed", "Revoke sessions" → its path of R8 and the "no screen yet" page; back → the role\'s page',
    async () => {
      const failures: string[] = [];
      for (const [tab, end] of TAB_ROUTES) {
        try {
          await page.goto(rolePath(one));
          await expect(heading(page, one), `the role's page with the h1 "${one}"`).toBeVisible();
          await markPage(page);
          await s.tab(tab).click(ACTION);
          // Issue 57 (test-criteria.md, "Existing checks rewritten"): the page for that part of the service.
          await expectNoScreenPart(page, SERVICE_LABEL, `${rolePath(one)}/${end}`);
          expect(await stillSamePage(page), `"${tab}": no document was loaded`).toBe(true);
          await page.goBack();
          await expect(page).toHaveURL(addressOf(rolePath(one)));
          await expect(heading(page, one), `back from "${tab}": the role's page`).toBeVisible();
        } catch (e) {
          failures.push(`"${tab}": ${(e as Error).message.split('\n')[0]}`);
        }
      }
      expect(failures, 'the tabs that did not lead to their route and back').toEqual([]);
    },
  );

  await lines.line(
    'The crumb "Roles" on a role\'s page and on the wizard → the list; the side navigation\'s "Roles" on both → the list',
    async () => {
      const failures: string[] = [];
      const starts: [string, string, string][] = [
        ["a role's page", rolePath(one), one],
        ['the wizard', CREATE_PATH, WIZARD_H1],
      ];
      for (const [where, at, h1] of starts) {
        for (const [control, locate] of [
          ['the crumb "Roles"', () => crumbLink(page, LIST_H1)],
          ['the side navigation\'s "Roles"', () => s.sideRoles],
        ] as const) {
          try {
            await page.goto(at);
            await expect(heading(page, h1), `${where}: the h1 "${h1}"`).toBeVisible();
            await locate().click(ACTION);
            await expect(page).toHaveURL(addressOf(ROLES_PATH));
            await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
          } catch (e) {
            failures.push(`${control} on ${where}: ${(e as Error).message.split('\n')[0]}`);
          }
        }
      }
      expect(failures, 'the controls that did not lead to the list').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-screens-talk-only-to-the-engine', async ({ ctx, page, context }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const files = readEmulatorFiles(emulatorDir(ctx.home, port));
  if (!files) throw new EnvError(`the emulator files under ${emulatorDir(ctx.home, port)} are incomplete`);
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'rssafety');
  const seeded = new IamSeeded(ctx, port);
  const s = screen(page);

  await lines.line(
    "Open the role list, a role's page and the wizard, create a role with a policy and a tag, edit its summary and delete it → every request of the page went to Studio's origin or the engine on `127.0.0.1`; none carried an emulator key; no stored value of Studio's origin holds a role name, a description, a trust policy or the tag",
    async () => {
      const traffic = Traffic.attach(ctx, context, page, { bodies: true });
      const made = `${p}-made`;
      seeded.adopt(made);
      const firstDescription = `First ${p} words`;
      const secondDescription = `Second ${p} words`;
      const tag = { key: `${p}key`, value: `${p}value` };
      const principal = `${p}.amazonaws.com`;

      // The list, the wizard with a policy and a tag, the role's page with "Edit", and the delete dialog.
      await page.goto(ROLES_PATH);
      await expect(s.listH1).toBeVisible();
      await s.button(CREATE).click(ACTION);
      await expect(heading(page, WIZARD_H1)).toBeVisible();
      await s.main.getByLabel(F_SERVICE, { exact: true }).fill(principal, ACTION);
      await s.main.getByLabel(F_SERVICE, { exact: true }).press('Tab', ACTION);
      await s.button(NEXT).click(ACTION);
      await s.filter.fill('ReadOnlyAccess', ACTION);
      await s.filter.press('Enter', ACTION);
      const policies = s.main.getByRole('table', { name: POLICIES, exact: true });
      const row = policies
        .getByRole('row')
        .filter({ has: page.getByRole('cell', { name: 'ReadOnlyAccess', exact: true }) });
      await expect(row, 'the row of ReadOnlyAccess').toHaveCount(1, { timeout: 20_000 });
      await row.getByRole('checkbox').check(ACTION);
      await s.button(NEXT).click(ACTION);
      await s.main.getByLabel(F_NAME, { exact: true }).fill(made, ACTION);
      await s.main.getByLabel(F_DESCRIPTION, { exact: true }).fill(firstDescription, ACTION);
      await s.button(ADD_TAG).click(ACTION);
      await page.locator(TAG_KEY).fill(tag.key, ACTION);
      await page.locator(TAG_VALUE).fill(tag.value, ACTION);
      await s.button(CREATE).click(ACTION);
      await expectFlash(page, createdText(made));
      expect((await getRoleDirect(ctx, port, made)).tags, `a direct GetRole of ${made}: its tag`).toEqual([tag]);

      await listUnder(page, p, [made]);
      await s.listTable.getByRole('link', { name: made, exact: true }).click(ACTION);
      await expect(heading(page, made)).toBeVisible();
      await s.button(EDIT).click(ACTION);
      const edit = page.getByRole('dialog', { name: EDIT_DIALOG });
      await edit.getByLabel(F_DESCRIPTION, { exact: true }).fill(secondDescription, ACTION);
      await edit.getByRole('button', { name: SAVE, exact: true }).click(ACTION);
      await expectFlash(page, updatedText(made));

      await listUnder(page, p, [made]);
      await s.main.getByRole('checkbox', { name: made, exact: true }).check(ACTION);
      await s.button(DELETE).click(ACTION);
      const dialog = page.getByRole('dialog', { name: 'Delete 1 role?' });
      await dialog.getByLabel(CONFIRM_FIELD).fill('delete', ACTION);
      await dialog.getByRole('button', { name: DELETE, exact: true }).click(ACTION);
      await expectFlash(page, '1 role was deleted from the local emulator.');
      expect(await roleIsGone(ctx, port, made), `a direct GetRole of ${made}`).toBe(true);
      seeded.forget(made);
      await traffic.settle();

      // → every request went to Studio's origin or the engine, and the engine is on 127.0.0.1.
      expect(new URL(stack.engine.url).hostname, "the engine's host").toBe('127.0.0.1');
      const allowed = [stack.studio.origin, stack.engine.url];
      const elsewhere = traffic.requests
        .map((r) => new URL(r.url))
        .filter((u) => u.protocol !== 'data:' && u.protocol !== 'blob:' && !allowed.includes(u.origin))
        .map((u) => u.origin + u.pathname);
      expect(elsewhere, `requests to anything but ${allowed.join(' and ')}`).toEqual([]);
      const iamActions = traffic.requests
        .filter((r) => r.url.startsWith(stack.engine.url) && r.postData !== null)
        .map((r) => new URLSearchParams(r.postData ?? '').get('Action'))
        .filter((a): a is string => a !== null);
      ctx.log(`IAM actions sent to the engine: ${[...new Set(iamActions)].join(', ')}`);
      for (const action of ['ListRoles', 'CreateRole', 'AttachRolePolicy', 'UpdateRole', 'DeleteRole']) {
        expect(iamActions, `the page sent ${action} to the engine`).toContain(action);
      }

      // → no request (address, header or body) and no answer the browser received carries an emulator key.
      const secrets: [string, string][] = [
        ['access key id', files.accessKeyId],
        ['secret access key', files.secretAccessKey],
      ];
      const leaks: string[] = [];
      for (const r of traffic.requests) {
        const where = `${r.method} ${new URL(r.url).pathname}`;
        const text = [r.url, ...Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`), r.postData ?? ''].join('\n');
        for (const [name, value] of secrets) if (text.includes(value)) leaks.push(`${name} in the request ${where}`);
      }
      for (const { url, body } of traffic.bodies) {
        for (const [name, value] of secrets) {
          if (body.toString('latin1').includes(value)) leaks.push(`${name} in the answer of ${new URL(url).pathname}`);
        }
      }
      expect(leaks, 'emulator keys the page sent or received').toEqual([]);

      // → nothing the browser keeps for Studio's origin holds the role's data.
      const stored = await storedValues(page, context);
      const values: [string, string][] = [
        ['the role name', made],
        ['the first description', firstDescription],
        ['the second description', secondDescription],
        ['the trust policy', principal],
        ['the trust policy', 'sts:AssumeRole'],
        ['the tag key', tag.key],
        ['the tag value', tag.value],
      ];
      const kept: string[] = [];
      for (const [where, text] of Object.entries(stored)) {
        for (const [what, value] of values) if (text.includes(value)) kept.push(`${what} in ${where}`);
      }
      expect(kept, "role data in the browser's storage of Studio's origin").toEqual([]);
    },
  );

  await lines.line(
    'A role made directly with the description `<img src=x onerror=alert(1)>` and a trust policy whose principal is that text, shown in the list and on its page → both are shown as text; the page holds no image made from them and no dialog opened',
    async () => {
      const markup = '<img src=x onerror=alert(1)>';
      const xss = `${p}-markup`;
      await seeded.role(xss, { description: markup, trust: serviceTrust(markup) });
      const dialogs: string[] = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        void d.dismiss();
      });
      const injected = () => page.evaluate(() => document.querySelectorAll('img[src="x"], [onerror]').length);

      await listUnder(page, p, [xss]);
      await expect
        .poll(async () => (await listRows(page))[0]?.trusted ?? null, { message: `"${COL_TRUSTED}" of ${xss}` })
        .toBe(`AWS Service: ${markup}`);
      expect(await injected(), 'elements made from the text on the list').toBe(0);

      await s.listTable.getByRole('link', { name: xss, exact: true }).click(ACTION);
      await expect(heading(page, xss)).toBeVisible();
      await expect.poll(() => summaryDescription(page), { message: '"Description" in "Summary"' }).toBe(markup);
      expect(await injected(), "elements made from the text on the role's page").toBe(0);
      expect(dialogs, 'dialogs the page opened').toEqual([]);
    },
  );

  lines.end();
});
