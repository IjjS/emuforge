// An alarm's page (S3): what it shows of each type of alarm, its history, setting the state by hand and turning the
// actions off and on, in the built app in front of a real engine and emulator (test-criteria.md, issue 70).
//
// `studio.cloudwatch-alarm-page-shows-each-type`, `studio.cloudwatch-alarm-history-pages`,
// `studio.cloudwatch-set-state-runs-the-action`, `studio.cloudwatch-actions-off-and-on`.
//
// Each check names its alarms and topics with its own prefix `<p>` and deletes them when it ends
// (`CloudWatchSeeded`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/cloudwatch/cloudwatch.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  actionsText,
  actionsTurned,
  alarmDirect,
  alarmList,
  alarmPath,
  alarmScreen,
  answered,
  chooseOption,
  CloudWatchSeeded,
  codeAndMessage,
  cwOk,
  DEFAULT_REASON,
  dialogOf,
  expectAlarms,
  expectAlert,
  expectFlash,
  expectHeading,
  failed,
  finish,
  field,
  flashItems,
  historyDirect,
  historyRows,
  historyTypeText,
  LOG_ALARM_STATE,
  LOG_QUERY,
  metricAlarmDirect,
  namesOf,
  NO_ACTIONS,
  NO_REASON,
  openAlarm,
  openAlarms,
  refreshedUntil,
  refusalCodeDirect,
  SET_STATE,
  shownTags,
  stateSet,
  stateText,
  tagsDirect,
  TURN_ACTIONS_OFF,
  TURN_ACTIONS_ON,
  VIEW_HISTORY,
  waitState,
} from './services/cloudwatch/cloudwatch';

test('studio.cloudwatch-alarm-page-shows-each-type', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-types');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-topic`);
  const metric = await seeded.metricAlarm(`${p}-m`, {
    MetricName: 'Latency',
    Dimensions: [{ Name: 'Service', Value: 'api' }],
    Statistic: undefined,
    ExtendedStatistic: 'p99',
    Period: 300,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
    Threshold: 0.25,
    EvaluationPeriods: 3,
    DatapointsToAlarm: 2,
    TreatMissingData: 'ignore',
    Unit: 'Seconds',
    AlarmDescription: 'first line',
    AlarmActions: [topic],
    Tags: [{ Key: 'team', Value: 'core' }],
  });
  const rule = `ALARM("${metric}")`;
  const composite = await seeded.compositeAlarm(`${p}-c`, rule);
  const group = `${p}/group`;
  const log = await seeded.logAlarm(`${p}-l`, group);

  await lines.line(
    'Open `<p>-m` from Alarms → its page shows its ARN, "Metric alarm", the description, the state with its reason, actions "On"; the condition with the namespace, `Latency`, `Service` = `api`, `p99`, 5 minutes, the comparison and 0.25, "2 out of 3", the missing data treatment and the unit; the topic\'s ARN under the alarm actions and "No actions" under the other two; a history item of type "Configuration"; the tag `team` = `core`; each as the emulator reports it',
    async () => {
      await openAlarms(page, `${p}-`);
      await expectAlarms(page, [composite, log, metric].sort());
      await alarmList(page).link(metric).click(ACTION);
      await expect(page, "the alarm's page, at its address").toHaveURL(addressOf(alarmPath(metric)));
      await expectHeading(page, metric);

      const direct = await metricAlarmDirect(ctx, port, metric);
      expect(
        {
          namespace: direct.Namespace,
          metric: direct.MetricName,
          dimensions: direct.Dimensions,
          statistic: direct.ExtendedStatistic,
          period: direct.Period,
          comparison: direct.ComparisonOperator,
          threshold: direct.Threshold,
          datapoints: direct.DatapointsToAlarm,
          periods: direct.EvaluationPeriods,
          missing: direct.TreatMissingData,
          unit: direct.Unit,
          description: direct.AlarmDescription,
          alarmActions: direct.AlarmActions,
          okActions: direct.OKActions ?? [],
          insufficientDataActions: direct.InsufficientDataActions ?? [],
        },
        'the alarm, directly',
      ).toEqual({
        namespace: seeded.namespace,
        metric: 'Latency',
        dimensions: [{ Name: 'Service', Value: 'api' }],
        statistic: 'p99',
        period: 300,
        comparison: 'GreaterThanOrEqualToThreshold',
        threshold: 0.25,
        datapoints: 2,
        periods: 3,
        missing: 'ignore',
        unit: 'Seconds',
        description: 'first line',
        alarmActions: [topic],
        okActions: [],
        insufficientDataActions: [],
      });
      await expectPairs(page, {
        ARN: direct.AlarmArn,
        Type: 'Metric alarm',
        Description: 'first line',
        State: stateText(direct.StateValue),
        'State reason': (direct.StateReason ?? '-').replace(/\s+/g, ' ').trim(),
        Actions: actionsText(direct.ActionsEnabled),
        Namespace: seeded.namespace,
        Metric: 'Latency',
        Dimensions: 'Service = api',
        Statistic: 'p99',
        Period: '5 minutes',
        Comparison: 'Greater than or equal to',
        Threshold: '0.25',
        'Data points to alarm': '2 out of 3',
        'Treatment of missing data': 'ignore',
        Unit: 'Seconds',
        'In alarm': topic,
        OK: NO_ACTIONS,
        'Insufficient data': NO_ACTIONS,
      });
      expect(actionsText(direct.ActionsEnabled), 'the actions of the alarm, directly').toBe('On');

      const history = (await historyDirect(ctx, port, metric)).map((item) => ({
        type: historyTypeText(item.HistoryItemType),
        summary: (item.HistorySummary ?? '-').replace(/\s+/g, ' ').trim(),
      }));
      expect(
        history.filter((item) => item.type === 'Configuration').length,
        'the history items of type "Configuration", directly',
      ).toBeGreaterThan(0);
      await expect
        .poll(() => historyRows(page), { message: 'the history as the emulator reports it', timeout: 15_000 })
        .toEqual(history);

      const tags = await tagsDirect(ctx, port, direct.AlarmArn);
      expect(tags, 'the tags, directly').toEqual([{ Key: 'team', Value: 'core' }]);
      await expect.poll(() => shownTags(page), { message: 'the tags the page shows', timeout: 15_000 }).toEqual(tags);
    },
  );

  await lines.line(
    'Open `<p>-c` by its address → "Composite alarm" and its rule, whole, as the emulator reports it',
    async () => {
      const [direct] = (await alarmDirect(ctx, port, composite)).composite;
      expect(direct?.AlarmRule, 'the rule, directly').toBe(rule);
      await openAlarm(page, composite);
      await expectPairs(page, { Type: 'Composite alarm', 'Alarm rule': rule });
    },
  );

  await lines.line(
    'Open `<p>-l` by its address → "Log alarm", its query and its log group; "Set state" is on the page and cannot be pressed, with "The emulator does not set the state of a log alarm."',
    async () => {
      const s = alarmScreen(page);
      await openAlarm(page, log);
      await expectPairs(page, { Type: 'Log alarm', Query: LOG_QUERY, 'Log groups': group });
      await expect(s.button(SET_STATE), '"Set state" on the page of a log alarm').toBeVisible();
      await expect(s.button(SET_STATE), '"Set state" cannot be pressed').toBeDisabled();
      // The reason is shown to a pointer over the control and to the keyboard on it.
      await s.button(SET_STATE).hover();
      await expect(
        page.getByText(LOG_ALARM_STATE, { exact: true }).filter({ visible: true }).first(),
        `"${LOG_ALARM_STATE}"`,
      ).toBeVisible();
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-alarm-history-pages', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-history');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const name = await seeded.metricAlarm(`${p}-h`, { TreatMissingData: 'ignore' });
  for (let i = 0; i < 26; i++) await seeded.setState(name, i % 2 === 0 ? 'ALARM' : 'OK', `set outside ${String(i)}`);

  await lines.line(
    'Open its page → the history\'s first page holds 25 items, the newest first, the first of type "State"; its next page holds the older items and ends with the item of type "Configuration" that says the alarm was created',
    async () => {
      const s = alarmScreen(page);
      const direct = (await historyDirect(ctx, port, name)).map((item) => ({
        type: historyTypeText(item.HistoryItemType),
        summary: (item.HistorySummary ?? '-').replace(/\s+/g, ' ').trim(),
      }));
      expect(direct.length, 'more history items than one page of 25, directly').toBeGreaterThan(25);
      const oldest = direct.at(-1);
      expect(oldest?.type, 'the oldest item, directly, is the configuration item').toBe('Configuration');
      expect(oldest?.summary, 'the oldest item, directly, says the alarm was created').toMatch(/created/i);

      await openAlarm(page, name);
      await expect
        .poll(() => historyRows(page), { message: 'the first page: the 25 newest items', timeout: 15_000 })
        .toEqual(direct.slice(0, 25));
      expect((await historyRows(page))[0]?.type, 'the type of the newest item').toBe('State');

      await s.historyNext.click(ACTION);
      await expect
        .poll(() => historyRows(page), { message: 'the next page: the older items', timeout: 15_000 })
        .toEqual(direct.slice(25));
      expect((await historyRows(page)).at(-1), 'the last item of the next page').toEqual(oldest);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-set-state-runs-the-action', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-try');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const topic = await seeded.topic(`${p}-topic`);
  const name = await seeded.metricAlarm(`${p}-try`, { TreatMissingData: 'ignore', AlarmActions: [topic] });
  await waitState(ctx, port, name, 'INSUFFICIENT_DATA');

  await lines.line(
    'On its page press "Set state", choose In alarm, keep the reason and confirm → "State of `<p>-try` set to In alarm.", the page shows "In alarm" and the reason "Set by hand in EmuForge Studio", and the history, refreshed until it has it, shows an item of type "State" and an item of type "Action" whose summary is "Successfully executed action " and the topic\'s ARN; the emulator reports the state `ALARM` with that reason',
    async () => {
      const s = alarmScreen(page);
      const dialog = dialogOf(page);
      await openAlarm(page, name);
      await expectPairs(page, { State: 'Insufficient data' });
      await s.button(SET_STATE).click(ACTION);
      await chooseOption(field(dialog, 'New state'), 'ALARM');
      await expect(dialog.getByRole('textbox', { name: 'Reason', exact: true }), 'the reason kept').toHaveValue(
        DEFAULT_REASON,
      );
      await answered(page, 'SetAlarmState', () =>
        dialog.getByRole('button', { name: SET_STATE, exact: true }).click(ACTION),
      );

      await expectFlash(page, 'success', stateSet(name, 'In alarm'), VIEW_HISTORY);
      await expect(dialog, 'the dialog after the state is set').toHaveCount(0);
      await expectPairs(page, { State: 'In alarm', 'State reason': DEFAULT_REASON });

      const executed = `Successfully executed action ${topic}`;
      await refreshedUntil(
        page,
        s.historyRefresh,
        'DescribeAlarmHistory',
        async () => {
          const rows = await historyRows(page);
          return {
            state: rows.some((row) => row.type === 'State'),
            action: rows.some((row) => row.type === 'Action' && row.summary === executed),
          };
        },
        { state: true, action: true },
        `the history, refreshed until it has them, holds a "State" item and the "Action" item "${executed}"`,
      );

      const direct = await metricAlarmDirect(ctx, port, name);
      expect({ state: direct.StateValue, reason: direct.StateReason }, 'the state and its reason, directly').toEqual({
        state: 'ALARM',
        reason: DEFAULT_REASON,
      });
    },
  );

  await lines.line(
    'Open "Set state" again, delete the alarm outside, choose OK and confirm → the dialog stays open and shows `SetAlarmState` and the emulator\'s code; the emulator holds no alarm of that name',
    async () => {
      const s = alarmScreen(page);
      const dialog = dialogOf(page);
      await openAlarm(page, name);
      await expectPairs(page, { State: 'In alarm' });
      await s.button(SET_STATE).click(ACTION);
      await expect(dialog, 'the dialog').toBeVisible();
      await seeded.deleteAlarm(name);
      const refused = await refusalCodeDirect(ctx, port, 'SetAlarmState', {
        AlarmName: name,
        StateValue: 'OK',
        StateReason: DEFAULT_REASON,
      });
      await chooseOption(field(dialog, 'New state'), 'OK');
      await answered(page, 'SetAlarmState', () =>
        dialog.getByRole('button', { name: SET_STATE, exact: true }).click(ACTION),
      );

      await expectAlert(dialog, failed('SetAlarmState'), codeAndMessage({ code: refused, message: NO_REASON }));
      await expect(dialog, 'the dialog stays open').toBeVisible();
      await expect(flashItems(page, 'success'), 'no result says the state was set').toHaveCount(0);
      expect(namesOf(await alarmDirect(ctx, port, name)), 'the alarms of that name, directly').toEqual([]);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-actions-off-and-on', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-switch');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const name = await seeded.metricAlarm(`${p}-sw`, { TreatMissingData: 'ignore', ActionsEnabled: true });
  const actionsDirect = async () => (await metricAlarmDirect(ctx, port, name)).ActionsEnabled;

  await lines.line(
    'On its page press "Turn actions off" → "Actions of `<p>-sw` turned off." and the page shows actions "Off"; the emulator reports its actions off',
    async () => {
      const s = alarmScreen(page);
      expect(await actionsDirect(), 'the actions before the change, directly').toBe(true);
      await openAlarm(page, name);
      await expectPairs(page, { Actions: 'On' });
      await answered(page, 'DisableAlarmActions', () => s.button(TURN_ACTIONS_OFF).click(ACTION));
      await expectFlash(page, 'success', actionsTurned(name, 'off'));
      await expectPairs(page, { Actions: 'Off' });
      expect(await actionsDirect(), 'the actions, directly').toBe(false);
    },
  );

  await lines.line(
    'Press "Turn actions on" → "Actions of `<p>-sw` turned on." and "On"; the emulator reports them on',
    async () => {
      const s = alarmScreen(page);
      await cwOk(ctx, port, 'DisableAlarmActions', { AlarmNames: [name] });
      await openAlarm(page, name);
      await expectPairs(page, { Actions: 'Off' });
      await answered(page, 'EnableAlarmActions', () => s.button(TURN_ACTIONS_ON).click(ACTION));
      await expectFlash(page, 'success', actionsTurned(name, 'on'));
      await expectPairs(page, { Actions: 'On' });
      expect(await actionsDirect(), 'the actions, directly').toBe(true);
    },
  );

  await lines.line(
    'Delete the alarm outside, then press "Turn actions off" → the page shows "Alarm not found" and no result says the actions were turned off',
    async () => {
      const s = alarmScreen(page);
      await cwOk(ctx, port, 'EnableAlarmActions', { AlarmNames: [name] });
      await openAlarm(page, name);
      await expectPairs(page, { Actions: 'On' });
      await seeded.deleteAlarm(name);
      await answered(page, 'DisableAlarmActions', () => s.button(TURN_ACTIONS_OFF).click(ACTION));
      await expect(s.notFound, '"Alarm not found" in the place of the alarm').toBeVisible({ timeout: 15_000 });
      await expect(flashItems(page, 'success'), 'no result says the actions were turned off').toHaveCount(0);
      expect(namesOf(await alarmDirect(ctx, port, name)), 'the alarms of that name, directly').toEqual([]);
    },
  );

  await finish(lines, seeded);
});
