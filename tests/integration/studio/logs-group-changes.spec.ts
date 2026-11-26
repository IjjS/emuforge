// Creating a log group (S2), changing its settings on its page (S3) and deleting it from the list (S1) and from its
// page, in the built app in front of a real engine and emulator (test-criteria.md, issue 71).
//
// `studio.logs-create-group-with-settings`, `studio.logs-create-group-existing-name-is-refused`,
// `studio.logs-group-settings-change`, `studio.logs-delete-group-from-the-list`,
// `studio.logs-delete-protected-group-is-refused`, `studio.logs-delete-group-from-its-page`.
//
// Each check names its log groups with its own prefix `<p>` and deletes every log group under it when it ends
// (`LogsSeeded`). What the emulator holds afterwards is read directly. Words, direct calls and readers:
// `services/logs/logs.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { appeared, checkPrefix, watchText } from './support/service-screens';
import {
  alerts,
  answered,
  chooseOption,
  confirmWith,
  CREATE_LOG_GROUP,
  CREATE_LOG_GROUP_PATH,
  createScreen,
  DELETE,
  dialogOf,
  EDIT_RETENTION,
  eventually,
  expectEmpty,
  expectFlash,
  expectGroups,
  expectRows,
  field,
  filterGroups,
  flashItems,
  GROUP_NOT_FOUND,
  groupCreated,
  groupDeleted,
  groupList,
  groupPath,
  groupScreen,
  groupsNamedDirect,
  LOG_GROUPS,
  LOG_GROUPS_PATH,
  LogsSeeded,
  MANAGE_TAGS,
  NEVER_EXPIRE,
  NO_GROUPS_MATCH,
  open,
  PROTECTION_IS_ON,
  protectionTurnedOn,
  refusalDirect,
  retentionSet,
  rowsOf,
  SAVE,
  selectOf,
  tagEditor,
  tagRow,
  tagsDirect,
  tagsSaved,
  TURN_ON_PROTECTION,
} from './services/logs/logs';

test('studio.logs-create-group-with-settings', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-new');
  new LogsSeeded(ctx, port, p);
  const name = `${p}/new#1`;

  await lines.line(
    'On Create log group enter that name, choose Infrequent Access, retention 7 days, deletion protection on and the tag `team` = `core`, and create → the group\'s page opens at its address with "Log group `<p>/new#1` created." and shows those values; the emulator reports the group with class `INFREQUENT_ACCESS`, retention 7, deletion protection on and the tag `team` = `core`',
    async () => {
      expect(await groupsNamedDirect(ctx, port, name), 'no log group of that name, directly').toEqual([]);
      const s = createScreen(page);
      await open(page, CREATE_LOG_GROUP_PATH, CREATE_LOG_GROUP);
      await s.name.fill(name, ACTION);
      await chooseOption(s.logClass, 'INFREQUENT_ACCESS');
      await chooseOption(s.retention, '7');
      await s.protection.check(ACTION);
      await s.addTag.click(ACTION);
      await s.tagKey(1).fill('team', ACTION);
      await s.tagValue(1).fill('core', ACTION);
      await s.submit.click(ACTION);

      await expect(page, "the group's page, at its address").toHaveURL(addressOf(groupPath(name)), { timeout: 20_000 });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      await expectFlash(page, 'success', groupCreated(name));
      await expectPairs(page, { Class: 'Infrequent Access', Retention: '7 days', 'Deletion protection': 'On' });
      await expectRows(
        groupScreen(page).tags,
        (r) => ({ key: r.Key, value: r.Value }),
        [{ key: 'team', value: 'core' }],
        'the tags the page shows',
      );

      const [group, ...others] = await groupsNamedDirect(ctx, port, name);
      expect(others, 'one log group of that name, directly').toEqual([]);
      expect(
        {
          logClass: group?.logGroupClass,
          retention: group?.retentionInDays,
          protection: group?.deletionProtectionEnabled,
        },
        'the log group, directly',
      ).toEqual({ logClass: 'INFREQUENT_ACCESS', retention: 7, protection: true });
      expect(await tagsDirect(ctx, port, name), 'its tags, directly').toEqual({ team: 'core' });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-create-group-existing-name-is-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-taken');
  const seeded = new LogsSeeded(ctx, port, p);
  const name = await seeded.group(`${p}/taken`, { retention: 30 });

  await lines.line(
    "Create a log group with that name and retention 7 days → the form stays with what was entered and shows `CreateLogGroup` and the emulator's reason; the emulator still reports one group of that name with retention 30",
    async () => {
      const reason = await refusalDirect(ctx, port, 'CreateLogGroup', { logGroupName: name });
      const s = createScreen(page);
      await open(page, CREATE_LOG_GROUP_PATH, CREATE_LOG_GROUP);
      await s.name.fill(name, ACTION);
      await chooseOption(s.retention, '7');
      await answered(page, 'CreateLogGroup', () => s.submit.click(ACTION));

      await expectFlash(page, 'error', 'CreateLogGroup', reason);
      await expect(flashItems(page, 'success'), 'no flash says the group was created').toHaveCount(0);
      await expect(page, 'the form stays').toHaveURL(addressOf(CREATE_LOG_GROUP_PATH));
      await expect(s.name, 'the name entered').toHaveValue(name);
      await expect(selectOf(s.retention), 'the retention chosen').toContainText('7 days');
      await expect(s.submit, 'the form can be sent again').toBeEnabled();

      expect(
        (await groupsNamedDirect(ctx, port, name)).map((g) => g.retentionInDays),
        'the log groups of that name with their retention, directly',
      ).toEqual([30]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-group-settings-change', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-set');
  const seeded = new LogsSeeded(ctx, port, p);
  const name = await seeded.group(`${p}/set#1`, { tags: { a: '1', b: '2' } });
  const retentionDirect = async () => (await groupsNamedDirect(ctx, port, name))[0]?.retentionInDays ?? null;

  await lines.line(
    'Edit retention to 30 days → "Retention of `<p>/set#1` set to 30 days." and the details say 30 days; the emulator reports retention 30. Edit it to Never expire → the emulator reports no retention',
    async () => {
      const s = groupScreen(page);
      const dialog = dialogOf(page);
      await open(page, groupPath(name), name);
      await expectPairs(page, { Retention: NEVER_EXPIRE });

      await s.button(EDIT_RETENTION).click(ACTION);
      await chooseOption(field(dialog, 'Retention'), '30');
      await answered(page, 'PutRetentionPolicy', () => dialog.getByRole('button', { name: SAVE, exact: true }).click(ACTION));
      await expectFlash(page, 'success', retentionSet(name, '30 days'));
      await expect(dialog, 'the dialog after the save').toHaveCount(0);
      await expectPairs(page, { Retention: '30 days' });
      expect(await retentionDirect(), 'the retention, directly').toBe(30);

      await s.button(EDIT_RETENTION).click(ACTION);
      await chooseOption(field(dialog, 'Retention'), '');
      await answered(page, 'DeleteRetentionPolicy', () =>
        dialog.getByRole('button', { name: SAVE, exact: true }).click(ACTION),
      );
      await expectFlash(page, 'success', retentionSet(name, NEVER_EXPIRE));
      await expectPairs(page, { Retention: NEVER_EXPIRE });
      expect(await retentionDirect(), 'the retention, directly').toBeNull();
    },
  );

  await lines.line(
    'Turn on deletion protection → its result, the details say "On"; the emulator reports it on',
    async () => {
      const s = groupScreen(page);
      await open(page, groupPath(name), name);
      await expectPairs(page, { 'Deletion protection': 'Off' });
      await answered(page, 'PutLogGroupDeletionProtection', () => s.button(TURN_ON_PROTECTION).click(ACTION));
      await expectFlash(page, 'success', protectionTurnedOn(name));
      await expectPairs(page, { 'Deletion protection': 'On' });
      expect(
        (await groupsNamedDirect(ctx, port, name)).map((g) => g.deletionProtectionEnabled),
        'the deletion protection, directly',
      ).toEqual([true]);
    },
  );

  await lines.line(
    'Manage tags: remove `a`, change `b` to `3`, add `c` with an empty value, save → "Tags of `<p>/set#1` saved."; the emulator reports exactly `b` = `3` and `c` = ``',
    async () => {
      const s = groupScreen(page);
      const dialog = dialogOf(page);
      const editor = tagEditor(dialog);
      const byKey = (x: { key: string }, y: { key: string }) => (x.key < y.key ? -1 : 1);
      await open(page, groupPath(name), name);
      await expect
        .poll(async () => (await rowsOf(s.tags)).length, {
          message: 'the two tags the page shows before the change',
          timeout: 15_000,
        })
        .toBe(2);

      await s.button(MANAGE_TAGS).click(ACTION);
      await expect(editor.rows, 'the rows of the tag editor').toHaveCount(2);
      await editor.remove(await tagRow(dialog, 'a')).click(ACTION);
      await expect(editor.rows, 'the rows after removing `a`').toHaveCount(1);
      await editor.value(await tagRow(dialog, 'b')).fill('3', ACTION);
      await editor.add.click(ACTION);
      await expect(editor.rows, 'the rows after "Add tag"').toHaveCount(2);
      await editor.key(2).fill('c', ACTION);
      await answered(page, 'TagLogGroup', () => dialog.getByRole('button', { name: SAVE, exact: true }).click(ACTION));

      await expectFlash(page, 'success', tagsSaved(name));
      await expect(dialog, 'the dialog after the save').toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await rowsOf(s.tags))
              .map((r) => ({ key: r.Key ?? '', value: r.Value ?? '' }))
              .sort(byKey),
          { message: 'the tags the page shows after the save', timeout: 15_000 },
        )
        .toEqual([
          { key: 'b', value: '3' },
          { key: 'c', value: '' },
        ]);
      expect(await tagsDirect(ctx, port, name), 'the tags, directly').toEqual({ b: '3', c: '' });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-delete-group-from-the-list', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-gone');
  const seeded = new LogsSeeded(ctx, port, p);
  const name = await seeded.group(`${p}/gone`);
  await seeded.stream(name, 's', [{ timestamp: Date.now(), message: 'held' }]);

  await lines.line(
    'Select it on Log groups, press Delete, type its name and confirm → "Log group `<p>/gone` deleted.", the row is gone; the emulator reports no group of that name',
    async () => {
      const s = groupList(page);
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await filterGroups(page, p);
      await expectGroups(page, [name]);
      await s.radio(name).check(ACTION);
      await s.del.click(ACTION);
      await answered(page, 'DeleteLogGroup', () => confirmWith(page, name, DELETE));
      await expectFlash(page, 'success', groupDeleted(name));
      await expectEmpty(s.table, NO_GROUPS_MATCH);
      expect(
        await eventually(5_000, () => groupsNamedDirect(ctx, port, name), (groups) => groups.length === 0),
        'the log groups of that name, directly',
      ).toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-delete-protected-group-is-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-safe');
  const seeded = new LogsSeeded(ctx, port, p);
  const name = await seeded.group(`${p}/safe`, { protection: true });

  await lines.line(
    'Select it and press Delete → the dialog says deletion protection is on and that it must be turned off first, and its action cannot be pressed; the emulator still reports the group',
    async () => {
      const s = groupList(page);
      const dialog = dialogOf(page);
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await filterGroups(page, p);
      await expectGroups(page, [name]);
      await s.radio(name).check(ACTION);
      await s.del.click(ACTION);
      await expect(dialog, 'the dialog').toBeVisible();
      await expect(alerts(dialog), 'what the dialog says of the protection').toHaveText(PROTECTION_IS_ON);
      const action = dialog.getByRole('button', { name: DELETE, exact: true });
      await expect(action, 'the action before the name is typed').toBeDisabled();
      await dialog.getByRole('textbox').fill(name, ACTION);
      await expect(dialog.getByRole('textbox'), 'the name typed').toHaveValue(name);
      await expect(action, 'the action with the name typed').toBeDisabled();
      expect(
        (await groupsNamedDirect(ctx, port, name)).map((g) => g.logGroupName),
        'the log groups of that name, directly',
      ).toEqual([name]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-delete-group-from-its-page', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lg-leave');
  const seeded = new LogsSeeded(ctx, port, p);
  const name = await seeded.group(`${p}/leave`);

  await lines.line(
    'Press Delete there, type its name and confirm → Log groups opens with "Log group `<p>/leave` deleted." and "Log group not found" is not shown on the way; the emulator reports no group of that name',
    async () => {
      const s = groupScreen(page);
      await open(page, groupPath(name), name);
      await expectPairs(page, { 'Deletion protection': 'Off' });
      await watchText(page, GROUP_NOT_FOUND);
      await s.button(DELETE).click(ACTION);
      await answered(page, 'DeleteLogGroup', () => confirmWith(page, name, DELETE));
      await expect(page, 'Log groups opens').toHaveURL(addressOf(LOG_GROUPS_PATH), { timeout: 15_000 });
      await expect(heading(page, LOG_GROUPS), 'the h1 "Log groups"').toBeVisible();
      await expectFlash(page, 'success', groupDeleted(name));
      expect(await appeared(page, GROUP_NOT_FOUND), '"Log group not found" was shown on the way').toBe(false);
      expect(
        await eventually(5_000, () => groupsNamedDirect(ctx, port, name), (groups) => groups.length === 0),
        'the log groups of that name, directly',
      ).toEqual([]);
    },
  );

  lines.end();
});
