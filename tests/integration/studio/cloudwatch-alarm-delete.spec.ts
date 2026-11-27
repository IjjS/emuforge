// Deleting an alarm from the list (S1) and from its page (S3), and the delete the emulator refuses, in the built app
// in front of a real engine and emulator (test-criteria.md, issue 70).
//
// `studio.cloudwatch-delete-alarm-from-the-list`, `studio.cloudwatch-delete-alarm-from-its-page`,
// `studio.cloudwatch-delete-alarm-a-composite-names-is-refused`.
//
// Each check names its alarms with its own prefix `<p>` and deletes every alarm under it when it ends
// (`CloudWatchSeeded`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/cloudwatch/cloudwatch.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alarmDeleted,
  alarmList,
  ALARMS,
  ALARMS_PATH,
  alarmScreen,
  alarmsDirect,
  answered,
  CloudWatchSeeded,
  codeAndMessage,
  confirmWith,
  DELETE,
  deleteHeading,
  dialogHeader,
  dialogOf,
  eventually,
  expectAlarms,
  expectAlert,
  expectFlash,
  failed,
  finish,
  flashItems,
  namesOf,
  openAlarm,
  openAlarms,
  refusalDirect,
} from './services/cloudwatch/cloudwatch';

test('studio.cloudwatch-delete-alarm-from-the-list', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-del');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const del = await seeded.metricAlarm(`${p}-del`, { TreatMissingData: 'ignore' });
  const stay = await seeded.metricAlarm(`${p}-stay`, { TreatMissingData: 'ignore' });

  await lines.line(
    'Filter by `<p>-`, select `<p>-del`, press "Delete", type `delete` and confirm → "Alarm `<p>-del` deleted.", the row is gone and `<p>-stay` is listed; the emulator holds `<p>-stay` and not `<p>-del`',
    async () => {
      const s = alarmList(page);
      await openAlarms(page, `${p}-`);
      await expectAlarms(page, [del, stay]);
      await s.radio(del).check(ACTION);
      await s.del.click(ACTION);
      await expect(dialogHeader(page), 'the dialog names the alarm').toHaveText(deleteHeading(del));
      await answered(page, 'DeleteAlarms', () => confirmWith(page, 'delete', DELETE));
      await expectFlash(page, 'success', alarmDeleted(del));
      await expect(dialogOf(page), 'the dialog after the delete').toHaveCount(0);
      await expectAlarms(page, [stay]);
      expect(
        await eventually(5_000, async () => namesOf(await alarmsDirect(ctx, port, `${p}-`)), (held) => held.length === 1),
        'the alarms under the prefix, directly',
      ).toEqual([stay]);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-delete-alarm-from-its-page', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-leave');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const name = await seeded.metricAlarm(`${p}-leave`, { TreatMissingData: 'ignore' });

  await lines.line(
    'Press "Delete", type `delete` and confirm → Alarms opens with "Alarm `<p>-leave` deleted."; the emulator no longer holds it',
    async () => {
      const s = alarmScreen(page);
      await openAlarm(page, name);
      await expectPairs(page, { Type: 'Metric alarm' });
      await s.button(DELETE).click(ACTION);
      await answered(page, 'DeleteAlarms', () => confirmWith(page, 'delete', DELETE));
      await expect(page, 'Alarms opens').toHaveURL(addressOf(ALARMS_PATH), { timeout: 15_000 });
      await expect(heading(page, ALARMS), 'the h1 "Alarms"').toBeVisible();
      await expectFlash(page, 'success', alarmDeleted(name));
      expect(
        await eventually(5_000, async () => namesOf(await alarmsDirect(ctx, port, name)), (held) => held.length === 0),
        'the alarms of that name, directly',
      ).toEqual([]);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-delete-alarm-a-composite-names-is-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-held');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const child = await seeded.metricAlarm(`${p}-child`, { TreatMissingData: 'ignore' });
  const parent = await seeded.compositeAlarm(`${p}-parent`, `ALARM("${child}")`);

  await lines.line(
    "Delete `<p>-child` from Alarms → the dialog stays open and shows `DeleteAlarms` and the emulator's reason; the emulator still holds both alarms",
    async () => {
      const refusal = await refusalDirect(ctx, port, 'DeleteAlarms', { AlarmNames: [child] });
      const s = alarmList(page);
      const dialog = dialogOf(page);
      await openAlarms(page, `${p}-`);
      await expectAlarms(page, [child, parent]);
      await s.radio(child).check(ACTION);
      await s.del.click(ACTION);
      await answered(page, 'DeleteAlarms', () => confirmWith(page, 'delete', DELETE));

      await expectAlert(dialog, failed('DeleteAlarms'), codeAndMessage(refusal));
      await expect(dialog, 'the dialog stays open').toBeVisible();
      await expect(flashItems(page, 'success'), 'no result says the alarm was deleted').toHaveCount(0);
      expect(namesOf(await alarmsDirect(ctx, port, `${p}-`)), 'the alarms under the prefix, directly').toEqual([
        child,
        parent,
      ]);
    },
  );

  await finish(lines, seeded);
});
