// Each case starts with an instance created directly in the local emulator.
import type { Page } from '@playwright/test';
import { expect, test } from './support';
import { ACTION, heading } from './support/frame';
import {
  alertWith, button, chooseOption, closeActions, dialogOf, expectActionAvailable, expectActionUnavailable,
  expectCell, expectFlash, expectRows, field, findBy, INSTANCES_H1, INSTANCES_PATH, multiselectOf,
  open, PROTECTION_IS_ON, rowsOf, TABLE, tableOf, typeInMultiselect, valuePartsOf,
} from './services/ec2/ec2';
import { edit, instanceFixture, save, submit, ui, userDataField } from './services/ec2/instance-changes';

test('studio.ec2-change-instance-type', async ({ ctx, page }) => {
  const f = await instanceFixture(ctx, 'edittype');
  await f.seeded.stop(f.id);
  await f.open(page);
  const dialog = await edit(page, 'Change instance type');
  await chooseOption(field(dialog, 'Instance type'), 't3.small', 't3.small');
  await save(page);
  await expect.poll(() => valuePartsOf(page.getByRole('main'), 'Type')).toContain('t3.small');
  expect(await f.direct()).toMatchObject({ type: 't3.small', state: 'stopped' });
});

test('studio.ec2-replace-instance-groups', async ({ ctx, page }) => {
  const f = await instanceFixture(ctx, 'editgroups');
  const names = [f.prefix + '-one', f.prefix + '-two'];
  const ids = [];
  for (const name of names) ids.push(await f.seeded.group(name, name));
  await f.open(page);
  const dialog = await edit(page, 'Change security groups');
  const groups = field(dialog, 'Security groups');
  const choices = multiselectOf(groups);
  await expect(choices.tokens).toHaveCount(1);
  await page.locator(ui.findMultiselect().findToken(1).findDismiss().toSelector()).click(ACTION);
  for (const [index, id] of ids.entries()) {
    await typeInMultiselect(groups, names[index]!);
    await choices.option(id).click(ACTION);
    await expect(choices.tokens).toHaveCount(index + 1);
    await page.keyboard.press('Escape');
    await expect(choices.list).toHaveCount(0);
  }
  await save(page);
  await expectRows(tableOf(page.getByRole('main'), 'Security groups'), 'Group ID', ids, 'the two replacement groups');
  expect((await f.direct())?.groups.map(group => group.id).sort()).toEqual([...ids].sort());
});

test('studio.ec2-change-termination-protection', async ({ ctx, page }) => {
  const f = await instanceFixture(ctx, 'editprotection');
  await f.open(page);
  for (const enabled of [true, false]) {
    await edit(page, 'Change termination protection');
    const toggle = dialogOf(page).locator(ui.findToggle().findNativeInput().toSelector().replace(/^body /, ''));
    await expect(toggle).toHaveAccessibleName('Enable termination protection');
    await toggle.setChecked(enabled, ACTION);
    await save(page);
    await expect.poll(() => valuePartsOf(page.getByRole('main'), 'Termination protection')).toContain(enabled ? 'On' : 'Off');
    if (enabled) {
      await expectActionUnavailable(page, 'terminate', PROTECTION_IS_ON);
      const refusal = await f.call('TerminateInstances', { 'InstanceId.1': f.id });
      expect(refusal.code).toBe('OperationNotPermitted');
      expect((await f.direct())?.state).toBe('running');
    } else {
      await expectActionAvailable(page, 'terminate');
    }
    await closeActions(page);
    expect(await f.attribute('disableApiTermination')).toBe(String(enabled));
  }
});

test('studio.ec2-change-instance-tags', async ({ ctx, page }) => {
  const f = await instanceFixture(ctx, 'edittags', { Project: 'retained' });
  // The ordinary cleanup discovers resources by Name. This check deliberately removes that tag.
  ctx.own({ dispose: async () => {
    const answer = await f.call('TerminateInstances', { 'InstanceId.1': f.id });
    expect(answer.status).toBe(200);
  } });
  expect((await f.call('DeleteTags', { 'ResourceId.1': f.id, 'Tag.1.Key': 'Name' })).status).toBe(200);
  await f.open(page, f.id);
  const tags = tableOf(page.getByRole('main'), 'Tags');

  for (const [action, name] of [
    ['Add tag', f.prefix + '-first'], ['Edit tag', f.prefix + '-second'], ['Delete tag', ''],
  ] as const) {
    const dialog = await edit(page, action === 'Add tag' ? action : action + ' Name', action);
    if (action === 'Delete tag') {
      await dialog.getByRole('textbox').fill('delete', ACTION);
      await save(page, action);
    } else {
      if (action === 'Add tag') await field(dialog, 'Key').getByRole('textbox').fill('Name', ACTION);
      await field(dialog, 'Value').getByRole('textbox').fill(name, ACTION);
      await save(page);
    }
    await expect(heading(page, name || f.id)).toBeVisible();
    const expected = name ? { Project: 'retained', Name: name } : { Project: 'retained' };
    const tagValues = async () => {
      const visible = await rowsOf(tags);
      const result: Record<string, string> = {};
      for (const [index, row] of visible.entries()) {
        const keyCell = page.locator(ui.findTable().findBodyCell(index + 1, 1).toSelector());
        const cell = keyCell.and(tags.locator('td, th'));
        const key = await cell.evaluate(element => {
          const copy = element.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('button').forEach(button => button.remove());
          return copy.textContent?.trim() ?? '';
        });
        result[key] = row.Value!;
      }
      return result;
    };
    await expect.poll(tagValues).toEqual(expected);
    expect((await f.direct())?.tags).toEqual(expected);

    await open(page, INSTANCES_PATH, INSTANCES_H1);
    const list = page.getByRole('main').locator(TABLE).first();
    if (name) await findBy(list, name);
    else await findInstancePage(page, f.id);
    await expectCell(list, 'Instance ID', f.id, 'Name', name || '-');
    await list.getByRole('link', { name: f.id, exact: true }).click(ACTION);
    await expect(heading(page, name || f.id)).toBeVisible();
  }
  expect((await f.direct())?.tags).toEqual({ Project: 'retained' });
});

async function findInstancePage(page: Page, id: string) {
  const table = page.getByRole('main').locator(TABLE).first();
  const next = page.locator(ui.findPagination().findNextPageButton().toSelector());
  for (;;) {
    await expect.poll(async () => (await rowsOf(table)).length).toBeGreaterThan(0);
    const rows = await rowsOf(table);
    if (rows.some(row => row['Instance ID'] === id)) return;
    await expect(next).toBeEnabled();
    await next.click(ACTION);
    await expect.poll(async () => (await rowsOf(table))[0]?.['Instance ID']).not.toBe(rows[0]?.['Instance ID']);
  }
}

test('studio.ec2-refuses-reserved-instance-tag', async ({ ctx, page }) => {
  const f = await instanceFixture(ctx, 'refusetag');
  await f.open(page);
  const dialog = await edit(page, 'Add tag');
  await field(dialog, 'Key').getByRole('textbox').fill('aws:probe', ACTION);
  await field(dialog, 'Value').getByRole('textbox').fill('rejected', ACTION);
  await submit(page);
  const reason = "Tag key 'aws:probe' is invalid: the 'aws:' prefix is reserved";
  await expect(alertWith(dialog, reason)).toContainText('InvalidParameterValue');
  await expectFlash(page, 'error', 'InvalidParameterValue', reason);
  expect((await f.direct())?.tags).toEqual({ Name: f.prefix });
});

test('studio.ec2-change-instance-user-data', async ({ ctx, page }) => {
  const f = await instanceFixture(ctx, 'editdata');
  await f.seeded.stop(f.id);
  const initial = '\uFEFF처음\r\n둘\\n\r셋\n';
  const modified = initial.replace('처음', '변경');
  const write = await f.call('ModifyInstanceAttribute', {
    InstanceId: f.id, 'UserData.Value': Buffer.from(initial).toString('base64'),
  });
  expect(write.status).toBe(200);
  await f.open(page);
  const assertStored = async (text: string) => {
    const encoded = await f.attribute('userData');
    expect(encoded).toBeDefined();
    expect(Buffer.from(encoded!, 'base64')).toEqual(Buffer.from(text, 'utf8'));
  };
  const input = await userDataField(page);
  const originalDraft = await input.inputValue();
  expect(Buffer.from(JSON.parse(originalDraft), 'utf8')).toEqual(Buffer.from(initial));
  await input.fill(originalDraft.replace('처음', '변경'), ACTION);
  await save(page);
  await assertStored(modified);
  const reopened = await userDataField(page);
  expect(JSON.parse(await reopened.inputValue())).toBe(modified);
  await reopened.fill('', ACTION);
  await save(page);
  expect(await f.attribute('userData')).toBeUndefined();
  const empty = await userDataField(page);
  await expect(empty).toHaveValue('');
  await button(dialogOf(page), 'Edit as JSON string').click(ACTION);
  const mixed = 'A\r\nB\rC';
  await empty.fill(JSON.stringify(mixed), ACTION);
  await save(page);
  await assertStored(mixed);
  expect(JSON.parse(await (await userDataField(page)).inputValue())).toBe(mixed);
});
