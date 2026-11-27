// An alarm's tags, managed on its page (S3): a save, a save at the limit of 50 tags, and a save that meets a tag
// added outside, in the built app in front of a real engine and emulator (test-criteria.md, issue 70).
//
// `studio.cloudwatch-manage-tags`, `studio.cloudwatch-tags-added-outside-are-kept`.
//
// Each check names its alarms with its own prefix `<p>` and deletes every alarm under it when it ends
// (`CloudWatchSeeded`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/cloudwatch/cloudwatch.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADDED_OUTSIDE,
  alarmScreen,
  alertContents,
  answered,
  CloudWatchSeeded,
  cwOk,
  dialogOf,
  expectShown,
  expectFlash,
  finish,
  flashItems,
  MANAGE_TAGS,
  metricAlarmDirect,
  openAlarm,
  refusalDirect,
  REMOVALS_SAVED,
  shownTags,
  tagEditor,
  tagRow,
  tagsDirect,
  tagsSaved,
} from './services/cloudwatch/cloudwatch';

/** The tags `k00` to `k<count - 1>`, each with the value `v`. */
function numbered(count: number): { Key: string; Value: string }[] {
  return Array.from({ length: count }, (_, i) => ({ Key: `k${String(i).padStart(2, '0')}`, Value: 'v' }));
}

/** Opens the page of the alarm `name`, waits until it shows `count` tags, and opens "Manage tags" with as many rows. */
async function openTagsDialog(page: Page, name: string, count: number) {
  const dialog = dialogOf(page);
  const editor = tagEditor(dialog);
  await openAlarm(page, name);
  await expect
    .poll(async () => (await shownTags(page)).length, { message: `the ${String(count)} tags the page shows`, timeout: 15_000 })
    .toBe(count);
  await alarmScreen(page).button(MANAGE_TAGS).click(ACTION);
  await expect(editor.rows, 'the rows of the tag editor').toHaveCount(count);
  return { dialog, editor };
}

test('studio.cloudwatch-manage-tags', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-tags');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const name = await seeded.metricAlarm(`${p}-tags`, {
    TreatMissingData: 'ignore',
    Tags: [
      { Key: 'a', Value: '1' },
      { Key: 'b', Value: '2' },
    ],
  });
  const full = await seeded.metricAlarm(`${p}-full`, { TreatMissingData: 'ignore', Tags: numbered(50) });

  await lines.line(
    'Manage tags: remove `a`, change `b` to `3`, add `c` with an empty value, save → "Tags of `<p>-tags` saved." and the page shows `b` = `3` and `c`; the emulator reports exactly `b` = `3` and `c` = ``',
    async () => {
      const arn = (await metricAlarmDirect(ctx, port, name)).AlarmArn;
      const { dialog, editor } = await openTagsDialog(page, name, 2);
      await editor.remove(await tagRow(dialog, 'a')).click(ACTION);
      await expect(editor.rows, 'the rows after removing `a`').toHaveCount(1);
      await editor.value(await tagRow(dialog, 'b')).fill('3', ACTION);
      await editor.add.click(ACTION);
      await expect(editor.rows, 'the rows after "Add tag"').toHaveCount(2);
      await editor.key(2).fill('c', ACTION);
      await answered(page, 'TagResource', () => editor.save.click(ACTION));

      const want = [
        { Key: 'b', Value: '3' },
        { Key: 'c', Value: '' },
      ];
      await expectFlash(page, 'success', tagsSaved(name));
      await expect(dialog, 'the dialog after the save').toHaveCount(0);
      await expect.poll(() => shownTags(page), { message: 'the tags the page shows', timeout: 15_000 }).toEqual(want);
      expect(await tagsDirect(ctx, port, arn), 'the tags, directly').toEqual(want);
    },
  );

  await lines.line(
    'Manage tags: remove `k00`, add `n` = `1`, save → saved; the emulator reports 50 tags, `n` = `1` among them and `k00` not',
    async () => {
      const arn = (await metricAlarmDirect(ctx, port, full)).AlarmArn;
      expect(await tagsDirect(ctx, port, arn), 'the 50 tags before the change, directly').toEqual(numbered(50));
      const { dialog, editor } = await openTagsDialog(page, full, 50);
      await editor.remove(await tagRow(dialog, 'k00')).click(ACTION);
      await expect(editor.rows, 'the rows after removing `k00`').toHaveCount(49);
      await editor.add.click(ACTION);
      await expect(editor.rows, 'the rows after "Add tag"').toHaveCount(50);
      await editor.key(50).fill('n', ACTION);
      await editor.value(50).fill('1', ACTION);
      await answered(page, 'TagResource', () => editor.save.click(ACTION));

      await expectFlash(page, 'success', tagsSaved(full));
      await expect(dialog, 'the dialog after the save').toHaveCount(0);
      expect(await tagsDirect(ctx, port, arn), 'the tags, directly').toEqual([
        ...numbered(50).slice(1),
        { Key: 'n', Value: '1' },
      ]);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-tags-added-outside-are-kept', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-race');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const name = await seeded.metricAlarm(`${p}-race`, { TreatMissingData: 'ignore', Tags: numbered(49) });
  const arn = (await metricAlarmDirect(ctx, port, name)).AlarmArn;
  const keys = async () => (await tagsDirect(ctx, port, arn)).map((tag) => tag.Key);
  // The dialog of the first line stays open for the second: the second saves what the first left in it.
  const { dialog, editor } = await openTagsDialog(page, name, 49);

  await lines.line(
    'Add the tag `x1` outside (the alarm then has 50), remove `k00`, add `n1` and `n2`, and save → the dialog stays open and says "The removals were saved. The added and changed tags were not:" with `TagResource` and the emulator\'s reason, and lists `x1` as "Added outside this dialog"; the emulator reports 49 tags, `x1` among them, and neither `k00` nor `n1` nor `n2`',
    async () => {
      await cwOk(ctx, port, 'TagResource', { ResourceARN: arn, Tags: [{ Key: 'x1', Value: 'outside' }] });
      expect((await keys()).length, 'the tags of the alarm after the one added outside, directly').toBe(50);
      // One key more than 50: what the emulator answers to the screen's two keys once its removal is saved.
      const refusal = await refusalDirect(ctx, port, 'TagResource', {
        ResourceARN: arn,
        Tags: [{ Key: 'one-too-many', Value: '' }],
      });

      await editor.remove(await tagRow(dialog, 'k00')).click(ACTION);
      await expect(editor.rows, 'the rows after removing `k00`').toHaveCount(48);
      await editor.add.click(ACTION);
      await editor.key(49).fill('n1', ACTION);
      await editor.value(49).fill('1', ACTION);
      await editor.add.click(ACTION);
      await editor.key(50).fill('n2', ACTION);
      await editor.value(50).fill('2', ACTION);
      await answered(page, 'TagResource', () => editor.save.click(ACTION));

      await expectShown(
        alertContents(dialog),
        [`${REMOVALS_SAVED} TagResource: ${refusal.message} (${refusal.code})`],
        'what the one alert of the dialog says of the save that stopped half-way',
      );
      await expect(dialog, 'the dialog stays open').toBeVisible();
      await expect(dialog.getByRole('heading', { name: ADDED_OUTSIDE, exact: true }), `"${ADDED_OUTSIDE}"`).toBeVisible();
      await expectShown(dialog.getByRole('term'), ['x1'], 'the keys listed as added outside');
      await expectShown(dialog.getByRole('definition'), ['outside'], 'the values listed as added outside');
      await expect(flashItems(page, 'success'), 'no result says the tags were saved').toHaveCount(0);

      const held = await keys();
      expect(
        {
          count: held.length,
          x1: held.includes('x1'),
          k00: held.includes('k00'),
          n1: held.includes('n1'),
          n2: held.includes('n2'),
        },
        'the tags, directly',
      ).toEqual({ count: 49, x1: true, k00: false, n1: false, n2: false });
    },
  );

  await lines.line(
    'Remove the row `n2` and save → "Tags of `<p>-race` saved."; the emulator reports 50 tags: `n1` and `x1` among them, `k00` and `n2` not',
    async () => {
      await expect(dialog, 'the dialog the first line left open').toBeVisible();
      await editor.remove(await tagRow(dialog, 'n2')).click(ACTION);
      await answered(page, 'TagResource', () => editor.save.click(ACTION));

      await expectFlash(page, 'success', tagsSaved(name));
      await expect(dialog, 'the dialog after the save').toHaveCount(0);
      const held = await keys();
      expect(
        {
          count: held.length,
          n1: held.includes('n1'),
          x1: held.includes('x1'),
          k00: held.includes('k00'),
          n2: held.includes('n2'),
        },
        'the tags, directly',
      ).toEqual({ count: 50, n1: true, x1: true, k00: false, n2: false });
    },
  );

  await finish(lines, seeded);
});
