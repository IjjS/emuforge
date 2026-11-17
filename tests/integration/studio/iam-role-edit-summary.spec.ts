// "Edit" of a role's "Summary" in the built app served by `bun run serve`, in front of a real engine started for that
// Studio and the run's emulator (test-criteria.md, issue 82, Flow checks; requirement R5.5, R10.3): the dialog "Edit
// summary" with "Cancel", a new description and duration, a custom duration and the bound it is checked against, an
// emptied description, a role under `/aws-service-role/` whose duration the emulator refuses to change, and the role
// list read again afterwards.
//
// `studio.iam-role-edit-summary-changes-the-emulator`.
//
// Other checks make roles on the run's emulator at the same time, so the check names its roles with its own prefix
// `<p>` (lower-case letters and digits). Roles are made and read directly with `support/iam.ts` and taken apart when
// the check ends. The emulator's refusal the dialog must show is read from the emulator itself with the same
// request sent directly, which the emulator refuses and so changes nothing (requirement R2, `UpdateRole`).

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import { ACTION, heading } from './support/frame';
import { containing, getRoleDirect, iamAnswer, IamSeeded, roleNamesDirect, SERVICE_ROLE_PATH } from './services/iam/iam';
import { Lines } from './support/lines';

// ---------------------------------------------------------------------------------------------------------------
// The screen's words (requirement R5.3, R5.5, R10.3; English).
// ---------------------------------------------------------------------------------------------------------------

const ROLES_PATH = '/aws/iam/roles';
const LIST_H1 = 'Roles';
const FILTER = 'Search items';
const COL_NAME = 'Role name';

const EDIT = 'Edit';
const DIALOG = 'Edit summary';
const F_DESCRIPTION = 'Description';
const F_DURATION = 'Maximum session duration';
const F_SECONDS = 'Seconds';
const CUSTOM = 'Custom duration';
const SAVE = 'Save changes';
const CANCEL = 'Cancel';
const SUMMARY = 'Summary';
const BOUND_MESSAGE = 'Enter a whole number from 3600 to 43200.';

/** The Flashbar's success item for `name` (R5.5). */
function updatedText(name: string): string {
  return `Role “${name}” was updated in the local emulator.`;
}

/** The dialog's failure title for `name` (R10.3). */
function updateFailedText(name: string): string {
  return `Updating ${name} failed`;
}

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
const SELECT_TRIGGER = wrapper.findSelect().findTrigger().toSelector();
const FLASH_ITEMS = wrapper.findFlashbar().findItems().toSelector();
const CONTAINER = wrapper.findContainer().toSelector();
const LIST_TABLE = wrapper.findTable().toSelector();

function screen(page: Page) {
  const main = page.getByRole('main');
  const dialog = page.getByRole('dialog', { name: DIALOG });
  return {
    main,
    edit: main.getByRole('button', { name: EDIT, exact: true }),
    dialog,
    description: dialog.getByLabel(F_DESCRIPTION, { exact: true }),
    duration: page.locator(SELECT_TRIGGER).first(),
    seconds: dialog.getByLabel(F_SECONDS, { exact: true }),
    save: dialog.getByRole('button', { name: SAVE, exact: true }),
    cancel: dialog.getByRole('button', { name: CANCEL, exact: true }),
    flashItems: page.locator(FLASH_ITEMS),
    listH1: main.getByRole('heading', { level: 1, name: new RegExp(`^${LIST_H1}(\\s|$)`) }),
    listTable: page.locator(LIST_TABLE).first(),
    filter: main.getByRole('searchbox', { name: FILTER, exact: true }),
  };
}

async function openRole(page: Page, name: string): Promise<void> {
  await page.goto(rolePath(name));
  await expect(heading(page, name), `the role's page with the h1 "${name}"`).toBeVisible();
}

/** "Edit" opens the dialog "Edit summary". */
async function openDialog(page: Page): Promise<void> {
  const s = screen(page);
  await s.edit.click(ACTION);
  await expect(s.dialog, `the dialog "${DIALOG}"`).toBeVisible();
}

/** Chooses `option` of "Maximum session duration". */
async function chooseDuration(page: Page, option: string): Promise<void> {
  await screen(page).duration.click(ACTION);
  await page.getByRole('option', { name: option, exact: true }).click(ACTION);
  await expect(screen(page).duration, `"${F_DURATION}" shows ${option}`).toContainText(option);
}

/** "Save changes", then waits for the dialog to close and the Flashbar's success item for `name`. */
async function saveAndExpectUpdated(page: Page, name: string): Promise<void> {
  const s = screen(page);
  await s.save.click(ACTION);
  await expect(s.dialog, 'the dialog closes').toHaveCount(0);
  await expectFlash(page, [updatedText(name)], `the Flashbar says "${updatedText(name)}"`);
}

async function flashTexts(page: Page): Promise<string[]> {
  return (await screen(page).flashItems.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
}

async function expectFlash(page: Page, parts: string[], message: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((t) => parts.every((part) => t.includes(part))), { message })
    .toBe(true);
}

/** The value of the field `label` in "Summary" (the `dd` after its `dt`, or the text around the label without it). */
async function summaryValue(page: Page, label: string): Promise<string | null> {
  return screen(page).main.evaluate(
    (el, { title, label, container }) => {
      const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
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
    { title: SUMMARY, label, container: CONTAINER },
  );
}

async function expectSummary(page: Page, label: string, value: string): Promise<void> {
  await expect.poll(() => summaryValue(page, label), { message: `"${label}" in "${SUMMARY}"` }).toBe(value);
}

/** The role list's names as shown. */
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

// ---------------------------------------------------------------------------------------------------------------

test('studio.iam-role-edit-summary-changes-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = rolePrefix(ctx, 'resummary');
  const seeded = new IamSeeded(ctx, port);
  const plain = `${p}-plain`;
  const linked = `${p}-linked`;
  await seeded.role(plain);
  await seeded.role(linked, { path: `${SERVICE_ROLE_PATH}${p}/` });
  const s = screen(page);
  const typed = `Studio edited ${p}`;

  /** On the plain role's page, opened afresh when another page is shown. */
  async function onPlain(): Promise<void> {
    if ((await heading(page, plain).count()) === 0 || (await s.dialog.count()) > 0) await openRole(page, plain);
  }

  await lines.line(
    'On a plain role\'s page, "Edit" → the dialog with an empty "Description" and "1 hour"; "Cancel" → a direct `GetRole` reports no description and 3600',
    async () => {
      await openRole(page, plain);
      await openDialog(page);
      await expect(s.description, `"${F_DESCRIPTION}"`).toHaveValue('');
      await expect(s.duration, `"${F_DURATION}"`).toContainText('1 hour');
      await s.cancel.click(ACTION);
      await expect(s.dialog, 'the dialog closes').toHaveCount(0);
      const direct = await getRoleDirect(ctx, port, plain);
      expect(
        { description: direct.description ?? '', duration: direct.maxSessionDuration },
        `a direct GetRole of ${plain}`,
      ).toEqual({ description: '', duration: 3600 });
    },
  );

  await lines.line(
    '"Edit", type a description, choose "4 hours", "Save changes" → "Role “<name>” was updated in the local emulator."; "Summary" shows the description and "4 hours"; a direct `GetRole` reports that description and 14400',
    async () => {
      await onPlain();
      await openDialog(page);
      await s.description.fill(typed, ACTION);
      await chooseDuration(page, '4 hours');
      await saveAndExpectUpdated(page, plain);
      await expectSummary(page, F_DESCRIPTION, typed);
      await expectSummary(page, F_DURATION, '4 hours');
      const direct = await getRoleDirect(ctx, port, plain);
      expect(
        { description: direct.description, duration: direct.maxSessionDuration },
        `a direct GetRole of ${plain}`,
      ).toEqual({ description: typed, duration: 14400 });
    },
  );

  await lines.line(
    '"Edit", "Custom duration" with 5000, "Save changes" → "5000 seconds", and a direct `GetRole` reports 5000; "Custom duration" with 43201 → "Enter a whole number from 3600 to 43200." and a direct `GetRole` still reports 5000',
    async () => {
      await onPlain();
      await openDialog(page);
      await chooseDuration(page, CUSTOM);
      await s.seconds.fill('5000', ACTION);
      await saveAndExpectUpdated(page, plain);
      await expectSummary(page, F_DURATION, '5000 seconds');
      expect((await getRoleDirect(ctx, port, plain)).maxSessionDuration, `a direct GetRole of ${plain}`).toBe(5000);

      await openDialog(page);
      await expect(s.duration, `"${F_DURATION}" of a role with 5000 seconds`).toContainText(CUSTOM);
      await s.seconds.fill('43201', ACTION);
      await s.save.click(ACTION);
      await expect(s.dialog.getByText(BOUND_MESSAGE, { exact: true }), `"${BOUND_MESSAGE}"`).toBeVisible();
      await expect(s.dialog, 'the dialog stays').toBeVisible();
      expect((await getRoleDirect(ctx, port, plain)).maxSessionDuration, `a direct GetRole of ${plain}`).toBe(5000);
      await s.cancel.click(ACTION);
      await expect(s.dialog, 'the dialog closes').toHaveCount(0);
    },
  );

  await lines.line(
    '"Edit", empty the description, "Save changes" → "-" for "Description"; a direct `GetRole` reports no description or an empty one',
    async () => {
      await onPlain();
      if ((await getRoleDirect(ctx, port, plain)).description !== typed) {
        await seeded.update(plain, { description: typed });
        await openRole(page, plain);
      }
      await expectSummary(page, F_DESCRIPTION, typed);
      await openDialog(page);
      await expect(s.description, `"${F_DESCRIPTION}" holds the description`).toHaveValue(typed);
      await s.description.fill('', ACTION);
      await saveAndExpectUpdated(page, plain);
      await expectSummary(page, F_DESCRIPTION, '-');
      expect((await getRoleDirect(ctx, port, plain)).description ?? '', `a direct GetRole of ${plain}`).toBe('');
    },
  );

  await lines.line(
    'On the page of a role made directly with the path `/aws-service-role/<p>/`: "Edit", a new description, "Save changes" → saved, and a direct `GetRole` reports it; "Edit", "2 hours", "Save changes" → the dialog stays and shows "Updating <name> failed" with the emulator\'s code and message; a direct `GetRole` reports 3600',
    async () => {
      const described = `Studio described ${p}`;
      await openRole(page, linked);
      await openDialog(page);
      await s.description.fill(described, ACTION);
      await saveAndExpectUpdated(page, linked);
      await expectSummary(page, F_DESCRIPTION, described);
      expect((await getRoleDirect(ctx, port, linked)).description, `a direct GetRole of ${linked}`).toBe(described);

      await openDialog(page);
      await chooseDuration(page, '2 hours');
      await s.save.click(ACTION);
      // The refusal as the emulator words it: the same change sent directly, which it refuses (R2).
      const refusal = await iamAnswer(
        ctx,
        port,
        'UpdateRole',
        { RoleName: linked, MaxSessionDuration: '7200' },
        linked,
      );
      expect(refusal.ok, `a direct UpdateRole of ${linked} with 7200 is refused`).toBe(false);
      if (refusal.ok) return;
      await expect(s.dialog.getByText(updateFailedText(linked)), `"${updateFailedText(linked)}"`).toBeVisible();
      await expect(s.dialog, "the emulator's code").toContainText(refusal.code);
      await expect(s.dialog, "the emulator's message").toContainText(refusal.message);
      await expect(s.dialog, 'the dialog stays').toBeVisible();
      expect((await getRoleDirect(ctx, port, linked)).maxSessionDuration, `a direct GetRole of ${linked}`).toBe(3600);
      await s.cancel.click(ACTION);
    },
  );

  await lines.line(
    "Open the list and apply the filter `<p>` after an update → the role's row is there, read again (data of the same role on both screens)",
    async () => {
      await seeded.update(plain, { description: `${typed} again` });
      // Settled either way, so a line that fails before awaiting it leaves no rejection behind.
      const listed = page
        .waitForRequest(
          (r) => r.method() === 'POST' && new URLSearchParams(r.postData() ?? '').get('Action') === 'ListRoles',
          ACTION,
        )
        .then(
          () => true,
          () => false,
        );
      await page.goto(ROLES_PATH);
      await expect(s.listH1, `the role list's h1 "${LIST_H1}…"`).toBeVisible();
      expect(await listed, 'opening the list sent a ListRoles').toBe(true);
      await s.filter.fill(p, ACTION);
      await s.filter.press('Enter', ACTION);
      const direct = containing(await roleNamesDirect(ctx, port), p);
      expect([...direct].sort(), 'a direct ListRoles under <p>').toEqual([linked, plain].sort());
      await expect.poll(() => listNames(page), { message: 'the rows under the filter <p>' }).toEqual(direct);
    },
  );

  lines.end();
});
