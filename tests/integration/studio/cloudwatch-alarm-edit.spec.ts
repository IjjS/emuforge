// Editing an alarm (S4): what a save keeps, what it does when the alarm changed or went outside, and the alarms
// Studio cannot edit, in the built app in front of a real engine and emulator (test-criteria.md, issue 70).
//
// `studio.cloudwatch-edit-keeps-what-the-form-does-not-offer`, `studio.cloudwatch-edit-meets-a-change-made-outside`,
// `studio.cloudwatch-alarms-studio-cannot-edit`.
//
// Each check names its alarms with its own prefix `<p>` and deletes every alarm under it when it ends
// (`CloudWatchSeeded`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/cloudwatch/cloudwatch.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ALARM_NOT_FOUND,
  alarmDirect,
  alarmForm,
  alarmList,
  alarmPath,
  alarmSaved,
  alarmScreen,
  alarmWhen,
  alertHeaders,
  alerts,
  answered,
  BACK_TO_ALARM,
  CANNOT_EDIT,
  CHANGED_WHILE_EDITING,
  CloudWatchSeeded,
  cwOk,
  EDIT,
  EDIT_ALARM,
  editAlarmPath,
  expectShown,
  expectAlarms,
  expectFlash,
  expectHeading,
  finish,
  flashItems,
  metricAlarmDirect,
  namesOf,
  NOT_A_TOPIC,
  open,
  openAlarm,
  openAlarms,
  openEdit,
  selectOf,
  shownPairs,
  tagsDirect,
  tokenOf,
} from './services/cloudwatch/cloudwatch';

test('studio.cloudwatch-edit-keeps-what-the-form-does-not-offer', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-edit');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const action = `arn:aws:lambda:us-east-1:000000000000:function:${p}-fn`;
  const name = await seeded.metricAlarm(`${p}-edit`, {
    Threshold: 5,
    EvaluationPeriods: 3,
    Unit: 'Seconds',
    AlarmDescription: 'before',
    AlarmActions: [action],
    Tags: [{ Key: 'team', Value: 'core' }],
  });
  /** What a save must keep or change, as the emulator reports it. */
  const kept = async () => {
    const direct = await metricAlarmDirect(ctx, port, name);
    return {
      threshold: direct.Threshold,
      unit: direct.Unit,
      description: direct.AlarmDescription,
      alarmActions: direct.AlarmActions,
      datapoints: direct.DatapointsToAlarm ?? null,
      missing: direct.TreatMissingData ?? null,
      tags: await tagsDirect(ctx, port, direct.AlarmArn),
    };
  };
  const before = {
    threshold: 5,
    unit: 'Seconds',
    description: 'before',
    alarmActions: [action],
    datapoints: null,
    missing: null,
    tags: [{ Key: 'team', Value: 'core' }],
  };

  await lines.line(
    'Open it, press "Edit" → the form shows the name as text, the alarm\'s values, "3 out of 3", "Missing", and the action listed with "Not a topic in the emulator"',
    async () => {
      expect(await kept(), 'the alarm before the edit, directly').toEqual(before);
      const direct = await metricAlarmDirect(ctx, port, name);
      expect(
        { period: direct.Period, actionsEnabled: direct.ActionsEnabled },
        'the period and the actions of the alarm, directly',
      ).toEqual({ period: 60, actionsEnabled: true });
      const form = alarmForm(page);
      await openAlarm(page, name);
      await alarmScreen(page).edit.click(ACTION);
      await expect(page, 'the edit form, at its address').toHaveURL(addressOf(editAlarmPath(name)));
      await expectHeading(page, EDIT_ALARM);
      await expect(form.threshold, "the alarm's threshold").toHaveValue('5', { timeout: 15_000 });

      await expect(form.form.getByText(name, { exact: true }), 'the name as text').toBeVisible();
      await expect(form.main.getByRole('textbox', { name: 'Name', exact: true }), 'no field takes a name').toHaveCount(0);
      await expect(form.description, "the alarm's description").toHaveValue('before');
      // The emulator lists no metric of the alarm's namespace, so the form names the metric in its text fields.
      await expect(form.noDataYet, '"Enter a metric that has no data yet" is on').toBeChecked();
      await expect(form.namespaceText, "the alarm's namespace").toHaveValue(seeded.namespace);
      await expect(form.metricNameText, "the alarm's metric").toHaveValue('Errors');
      await expect(form.periods, "the alarm's evaluation periods").toHaveValue('3');
      await expect(form.datapoints, 'the data points to alarm the alarm does not hold').toHaveValue('3');
      await expect(form.form.getByText(alarmWhen(3, 3), { exact: true }), `"${alarmWhen(3, 3)}"`).toBeVisible();
      await expectShown(selectOf(form.missingData), ['Missing'], 'the missing data treatment');
      await expectShown(selectOf(form.statistic), ['Sum'], "the alarm's statistic");
      await expectShown(selectOf(form.period), ['1 minute'], "the alarm's period of 60 seconds");
      await expect(form.enableActions, "the alarm's actions are on").toBeChecked();
      await expectShown(selectOf(form.comparison), ['Greater than'], "the alarm's comparison");
      const token = tokenOf(form.inAlarm, 1);
      await expectShown(token.description, [action], 'the action listed under "In alarm"');
      await expectShown(token.tags, [NOT_A_TOPIC], 'what the form says of an action that is no topic');
    },
  );

  await lines.line(
    'Change the threshold to 7 and save → the alarm\'s page opens with "Alarm `<p>-edit` saved." and shows 7; the emulator reports the threshold 7, the unit `Seconds`, the description `before`, that alarm action, no data points to alarm, no treatment of missing data, and the tag `team` = `core`',
    async () => {
      const form = alarmForm(page);
      await openEdit(page, name, '5');
      await form.threshold.fill('7', ACTION);
      await answered(page, 'PutMetricAlarm', () => form.save.click(ACTION));

      await expect(page, "the alarm's page, at its address").toHaveURL(addressOf(alarmPath(name)), { timeout: 20_000 });
      await expectHeading(page, name);
      await expectFlash(page, 'success', alarmSaved(name));
      await expectPairs(page, { Threshold: '7' });
      expect(await kept(), 'the alarm after the save, directly').toEqual({ ...before, threshold: 7 });
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-edit-meets-a-change-made-outside', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-meets');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const seed = { Threshold: 5, ActionsEnabled: true, TreatMissingData: 'ignore' };
  const keep = await seeded.metricAlarm(`${p}-keep`, seed);
  const clash = await seeded.metricAlarm(`${p}-clash`, seed);
  const gone = await seeded.metricAlarm(`${p}-gone`, seed);

  await lines.line(
    'Open the edit form of `<p>-keep`, turn its actions off outside, change the description to `after` and save → saved; the emulator reports the description `after` and its actions still off',
    async () => {
      const form = alarmForm(page);
      await openEdit(page, keep, '5');
      await cwOk(ctx, port, 'DisableAlarmActions', { AlarmNames: [keep] });
      await form.description.fill('after', ACTION);
      await answered(page, 'PutMetricAlarm', () => form.save.click(ACTION));

      await expect(page, "the alarm's page, at its address").toHaveURL(addressOf(alarmPath(keep)), { timeout: 20_000 });
      await expectFlash(page, 'success', alarmSaved(keep));
      const direct = await metricAlarmDirect(ctx, port, keep);
      expect(
        { description: direct.AlarmDescription, actionsEnabled: direct.ActionsEnabled },
        'the description and the actions, directly',
      ).toEqual({ description: 'after', actionsEnabled: false });
    },
  );

  await lines.line(
    'Open the edit form of `<p>-clash`, set its threshold to 8 outside, change the threshold to 7 in the form and save → the form stays and says "This alarm changed while you were editing it", naming the threshold with "now 8"; the emulator still reports 8. Save again → saved; the emulator reports 7',
    async () => {
      const form = alarmForm(page);
      const thresholdDirect = async () => (await metricAlarmDirect(ctx, port, clash)).Threshold;
      await seeded.metricAlarm(clash, seed);
      await openEdit(page, clash, '5');
      await seeded.metricAlarm(clash, { ...seed, Threshold: 8 });
      await form.threshold.fill('7', ACTION);
      await form.save.click(ACTION);

      await expectShown(alertHeaders(form.form), [CHANGED_WHILE_EDITING], `the form says "${CHANGED_WHILE_EDITING}"`);
      await expectShown(
        alerts(form.form).getByRole('listitem'),
        ['Threshold (now 8)'],
        'the fields the form names as changed',
      );
      await expect(page, 'the form stays').toHaveURL(addressOf(editAlarmPath(clash)));
      await expect(form.threshold, 'the threshold entered stays').toHaveValue('7');
      await expect(flashItems(page, 'success'), 'no result says the alarm was saved').toHaveCount(0);
      expect(await thresholdDirect(), 'the threshold after the refused save, directly').toBe(8);

      await answered(page, 'PutMetricAlarm', () => form.save.click(ACTION));
      await expect(page, "the alarm's page, at its address").toHaveURL(addressOf(alarmPath(clash)), {
        timeout: 20_000,
      });
      await expectFlash(page, 'success', alarmSaved(clash));
      expect(await thresholdDirect(), 'the threshold after the second save, directly').toBe(7);
    },
  );

  await lines.line(
    'Open the edit form of `<p>-gone`, delete it outside, change the threshold and save → the form says "Alarm not found"; the emulator holds no alarm of that name',
    async () => {
      const form = alarmForm(page);
      await openEdit(page, gone, '5');
      await seeded.deleteAlarm(gone);
      await form.threshold.fill('7', ACTION);
      await form.save.click(ACTION);

      await expectShown(alertHeaders(form.form), [ALARM_NOT_FOUND], `the form says "${ALARM_NOT_FOUND}"`);
      await expect(page, 'the form stays').toHaveURL(addressOf(editAlarmPath(gone)));
      await expect(flashItems(page, 'success'), 'no result says the alarm was saved').toHaveCount(0);
      expect(namesOf(await alarmDirect(ctx, port, gone)), 'the alarms of that name, directly').toEqual([]);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-alarms-studio-cannot-edit', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-noedit');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const math = await seeded.mathAlarm(`${p}-math`);
  const comp = await seeded.compositeAlarm(`${p}-comp`, `ALARM("${math}")`);
  /** Both alarms as the emulator reports them, but for what the emulator itself moves: the state and its times. */
  const held = async () => {
    const strip = ({
      StateValue: _state,
      StateReason: _reason,
      StateReasonData: _data,
      StateUpdatedTimestamp: _updated,
      StateTransitionedTimestamp: _transitioned,
      ...rest
    }: Record<string, unknown>) => rest;
    const [mathAlarm] = (await alarmDirect(ctx, port, math)).metric;
    const [compAlarm] = (await alarmDirect(ctx, port, comp)).composite;
    return { math: mathAlarm && strip(mathAlarm), comp: compAlarm && strip(compAlarm) };
  };

  await lines.line('Select each on Alarms → "Edit" cannot be pressed for it', async () => {
    const s = alarmList(page);
    await openAlarms(page, `${p}-`);
    await expectAlarms(page, [comp, math]);
    for (const name of [math, comp]) {
      await s.radio(name).check(ACTION);
      await expect(s.radio(name), `${name} is selected`).toBeChecked();
      await expect(s.edit, `"Edit" with ${name} selected`).toBeDisabled();
      await expect(s.editLink, `no "Edit" that leads to a form with ${name} selected`).toHaveCount(0);
    }
  });

  await lines.line(
    'Open the page of `<p>-math` → "Metric math alarm" and each entry with its id and its expression or metric; the page offers no "Edit"',
    async () => {
      const s = alarmScreen(page);
      await openAlarm(page, math);
      await expectPairs(page, { Type: 'Metric math alarm' });
      await expect
        .poll(async () => (await shownPairs(page)).filter((pair) => ['m1', 'e1'].includes(pair.label)), {
          message: 'each entry by its id: `m1` with its metric, `e1` with its expression',
          timeout: 15_000,
        })
        .toEqual([
          { label: 'm1', value: { Namespace: seeded.namespace, Metric: 'Errors', Dimensions: '-' } },
          { label: 'e1', value: 'm1*2' },
        ]);
      await expect(s.edit, 'no "Edit" that leads to a form').toHaveCount(0);
      await expect(s.button(EDIT), 'no "Edit" button').toHaveCount(0);
    },
  );

  await lines.line(
    'Open the edit form\'s address with each name → "Studio cannot edit this alarm yet" with the way back to the alarm\'s page; the emulator reports each alarm unchanged',
    async () => {
      const before = await held();
      expect(before.math !== undefined && before.comp !== undefined, 'both alarms, directly').toBe(true);
      const main = page.getByRole('main');
      for (const name of [math, comp]) {
        await open(page, editAlarmPath(name), EDIT_ALARM);
        await expect(main.getByRole('heading', { name: CANNOT_EDIT, exact: true }), `"${CANNOT_EDIT}"`).toBeVisible({
          timeout: 15_000,
        });
        await main.getByRole('link', { name: BACK_TO_ALARM, exact: true }).click(ACTION);
        await expect(page, `the way back leads to the page of ${name}`).toHaveURL(addressOf(alarmPath(name)));
        await expectHeading(page, name);
      }
      expect(await held(), 'both alarms after the visits, directly').toEqual(before);
    },
  );

  await finish(lines, seeded);
});
