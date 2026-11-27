// Creating an alarm (S2): on a metric the emulator lists, on a metric that has no data yet, and what the form shows
// when the emulator or the name refuses, in the built app in front of a real engine and emulator (test-criteria.md,
// issue 70).
//
// `studio.cloudwatch-create-alarm-on-a-listed-metric` (an emulator of its own: a metric put with `PutMetricData`
// cannot be removed), `studio.cloudwatch-create-alarm-on-a-metric-with-no-data`, `studio.cloudwatch-create-refusals`.
//
// Each check names its alarms and topics with its own prefix `<p>` and deletes them when it ends
// (`CloudWatchSeeded`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/cloudwatch/cloudwatch.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alarmCreated,
  alarmDirect,
  alarmExists,
  alarmForm,
  alarmPath,
  alarmScreen,
  answered,
  CHOOSE_A_METRIC_NAME,
  CHOOSE_A_METRIC_NAME_FIRST,
  chooseInMultiselect,
  chooseOption,
  CloudWatchSeeded,
  codeAndMessage,
  countSent,
  CREATE_ALARM,
  CREATE_ALARM_PATH,
  enterMetric,
  errorOf,
  expectAlert,
  expectFlash,
  expectHeading,
  failed,
  flashItems,
  metricAlarmDirect,
  namesOf,
  offeredIn,
  open,
  refusalDirect,
  selectOf,
  type TypedMetric,
} from './services/cloudwatch/cloudwatch';

test('studio.cloudwatch-create-alarm-on-a-listed-metric', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-new');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const namespace = `${p}/ns`;
  const other = `${p}/other`;
  await seeded.metricData(namespace, 'Latency', [{ Name: 'Service', Value: 'api' }]);
  await seeded.metricData(other, 'Depth', []);
  const topic = await seeded.topic(`${p}-topic`);
  const name = `${p}-new`;
  const dimensionSet = JSON.stringify([['Service', 'api']]);

  await lines.line(
    'On Create alarm choose the namespace `<p>/other` and the metric `Depth`, then choose the namespace `<p>/ns` → the metric name and the dimensions are empty again, and pressing "Create alarm" asks for them and sends nothing; the metric names then offered are those of `<p>/ns`, `Latency` among them and `Depth` not',
    async () => {
      const form = alarmForm(page);
      const sent = countSent(page, 'PutMetricAlarm');
      await open(page, CREATE_ALARM_PATH, CREATE_ALARM);
      await chooseOption(form.namespace, other);
      await chooseOption(form.metricName, 'Depth');
      await expect(selectOf(form.metricName), 'the metric chosen').toHaveText('Depth');
      await chooseOption(form.namespace, namespace);

      await expect(selectOf(form.metricName), 'the metric name is empty again').toHaveText(CHOOSE_A_METRIC_NAME);
      await expect(selectOf(form.dimensions), 'the dimensions are empty again').toHaveText(CHOOSE_A_METRIC_NAME_FIRST);
      await form.create.click(ACTION);
      await expect(errorOf(form.metricName), 'the form asks for the metric name').toBeVisible();
      await expect(errorOf(form.dimensions), 'the form asks for the dimensions').toBeVisible();
      await expect(page, 'the form stays').toHaveURL(addressOf(CREATE_ALARM_PATH));
      expect(sent(), 'the `PutMetricAlarm` requests the page sent').toBe(0);

      expect(
        await offeredIn(form.metricName, 'Latency', ['Latency', 'Depth']),
        'the metric names offered for `<p>/ns`',
      ).toEqual({ Latency: true, Depth: false });
    },
  );

  await lines.line(
    'Enter the name `<p>-new` and a description, choose the metric `Latency` and the dimension set `Service` = `api`, Maximum, 1 minute, greater than 5, 2 out of 3, missing data Ignore, and the topic as the alarm action, and create → the alarm\'s page opens at its address with "Alarm `<p>-new` created." and shows those values; the emulator reports the alarm with that namespace, metric and dimension, `Maximum`, period 60, `GreaterThanThreshold`, threshold 5, evaluation periods 3, data points to alarm 2, `ignore`, actions on and the topic\'s ARN as its one alarm action',
    async () => {
      expect(namesOf(await alarmDirect(ctx, port, name)), 'no alarm of that name, directly').toEqual([]);
      const form = alarmForm(page);
      await open(page, CREATE_ALARM_PATH, CREATE_ALARM);
      await form.name.fill(name, ACTION);
      await form.description.fill('made in Studio', ACTION);
      await chooseOption(form.namespace, namespace);
      await chooseOption(form.metricName, 'Latency');
      await chooseOption(form.dimensions, dimensionSet);
      await chooseOption(form.statistic, 'Maximum');
      await chooseOption(form.period, '60');
      await chooseOption(form.comparison, 'GreaterThanThreshold');
      await form.threshold.fill('5', ACTION);
      await form.periods.fill('3', ACTION);
      await form.datapoints.fill('2', ACTION);
      await chooseOption(form.missingData, 'ignore');
      await form.enableActions.check(ACTION);
      await chooseInMultiselect(form.inAlarm, topic);
      await answered(page, 'PutMetricAlarm', () => form.create.click(ACTION));

      await expect(page, "the alarm's page, at its address").toHaveURL(addressOf(alarmPath(name)), { timeout: 20_000 });
      await expectHeading(page, name);
      await expectFlash(page, 'success', alarmCreated(name));
      await expectPairs(page, {
        Description: 'made in Studio',
        Type: 'Metric alarm',
        Actions: 'On',
        Namespace: namespace,
        Metric: 'Latency',
        Dimensions: 'Service = api',
        Statistic: 'Maximum',
        Period: '1 minute',
        Comparison: 'Greater than',
        Threshold: '5',
        'Data points to alarm': '2 out of 3',
        'Treatment of missing data': 'ignore',
        'In alarm': topic,
      });

      const direct = await metricAlarmDirect(ctx, port, name);
      expect(
        {
          namespace: direct.Namespace,
          metric: direct.MetricName,
          dimensions: direct.Dimensions,
          statistic: direct.Statistic,
          period: direct.Period,
          comparison: direct.ComparisonOperator,
          threshold: direct.Threshold,
          periods: direct.EvaluationPeriods,
          datapoints: direct.DatapointsToAlarm,
          missing: direct.TreatMissingData,
          actionsEnabled: direct.ActionsEnabled,
          alarmActions: direct.AlarmActions,
        },
        'the alarm, directly',
      ).toEqual({
        namespace,
        metric: 'Latency',
        dimensions: [{ Name: 'Service', Value: 'api' }],
        statistic: 'Maximum',
        period: 60,
        comparison: 'GreaterThanThreshold',
        threshold: 5,
        periods: 3,
        datapoints: 2,
        missing: 'ignore',
        actionsEnabled: true,
        alarmActions: [topic],
      });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-create-alarm-on-a-metric-with-no-data', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-later');
  new CloudWatchSeeded(ctx, port, p);
  const namespace = `${p}/later`;

  /**
   * Creates the alarm `name` on the metric `Orders` of `<p>/later` with `Shop` = `one`, Sum, less than 1 and the
   * missing data treatment of value `missing`, then waits, refreshing its page, until it shows the state `shown`
   * and the emulator reports `state`.
   */
  const createAndWait = async (name: string, missing: string, shown: string, state: string) => {
    expect(namesOf(await alarmDirect(ctx, port, name)), 'no alarm of that name, directly').toEqual([]);
    const form = alarmForm(page);
    await open(page, CREATE_ALARM_PATH, CREATE_ALARM);
    await form.name.fill(name, ACTION);
    await enterMetric(page, { namespace, metric: 'Orders', dimension: { name: 'Shop', value: 'one' } });
    await chooseOption(form.statistic, 'Sum');
    await chooseOption(form.period, '60');
    await chooseOption(form.comparison, 'LessThanThreshold');
    await form.threshold.fill('1', ACTION);
    await chooseOption(form.missingData, missing);
    await answered(page, 'PutMetricAlarm', () => form.create.click(ACTION));

    await expect(page, "the alarm's page, at its address").toHaveURL(addressOf(alarmPath(name)), { timeout: 20_000 });
    await expectHeading(page, name);
    await expectFlash(page, 'success', alarmCreated(name));
    await expectPairs(page, { Namespace: namespace, Metric: 'Orders', Dimensions: 'Shop = one' });
    await expect(async () => {
      await alarmScreen(page).refresh.click(ACTION);
      await expectPairs(page, { State: shown });
    }, `the page, refreshed until it does, shows "${shown}"`).toPass({ timeout: 60_000 });

    const direct = await metricAlarmDirect(ctx, port, name);
    expect(
      {
        namespace: direct.Namespace,
        metric: direct.MetricName,
        dimensions: direct.Dimensions,
        state: direct.StateValue,
      },
      'the alarm, directly',
    ).toEqual({ namespace, metric: 'Orders', dimensions: [{ Name: 'Shop', Value: 'one' }], state });
  };

  await lines.line(
    'On Create alarm turn on "Enter a metric that has no data yet", enter the namespace `<p>/later`, the metric `Orders` and the dimension `Shop` = `one`, Sum, less than 1, missing data Breaching, and create `<p>-early` → its page opens with its result and, refreshed until it does, shows "In alarm"; the emulator reports the alarm with that namespace, metric and dimension, in `ALARM`',
    () => createAndWait(`${p}-early`, 'breaching', 'In alarm', 'ALARM'),
  );

  await lines.line(
    'Create `<p>-quiet` the same way with missing data Not breaching → its page, refreshed until it does, shows "OK"; the emulator reports it in `OK`',
    () => createAndWait(`${p}-quiet`, 'notBreaching', 'OK', 'OK'),
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-create-refusals', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-refused');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const taken = await seeded.metricAlarm(`${p}-taken`, { Threshold: 5, TreatMissingData: 'ignore' });
  const ruleName = await seeded.compositeAlarm(`${p}-rule`, `ALARM("${taken}")`);
  const metric: TypedMetric = { namespace: seeded.namespace, metric: 'Errors' };

  /** Opens Create alarm and enters an alarm named `name` on the check's metric with the threshold `threshold`. */
  const enter = async (target: Page, name: string, threshold: string) => {
    const form = alarmForm(target);
    await open(target, CREATE_ALARM_PATH, CREATE_ALARM);
    await form.name.fill(name, ACTION);
    await enterMetric(target, metric);
    await form.threshold.fill(threshold, ACTION);
    return form;
  };
  /** The form stays at its address with the name and the threshold entered, and no result says an alarm was made. */
  const expectFormStays = async (name: string, threshold: string) => {
    const form = alarmForm(page);
    await expect(page, 'the form stays').toHaveURL(addressOf(CREATE_ALARM_PATH));
    await expect(form.name, 'the name entered').toHaveValue(name);
    await expect(form.namespaceText, 'the namespace entered').toHaveValue(metric.namespace);
    await expect(form.metricNameText, 'the metric name entered').toHaveValue(metric.metric);
    await expect(form.threshold, 'the threshold entered').toHaveValue(threshold);
    await expect(flashItems(page, 'success'), 'no result says an alarm was created').toHaveCount(0);
  };

  await lines.line(
    'Create an alarm named `<p>-taken` with the threshold 9 → the form stays with what was entered and says "An alarm named `<p>-taken` already exists."; the emulator still reports that alarm with the threshold 5',
    async () => {
      const form = await enter(page, taken, '9');
      await form.create.click(ACTION);
      await expect(errorOf(form.nameField), 'what the form says under "Name"').toHaveText(alarmExists(taken), {
        timeout: 15_000,
      });
      await expectFormStays(taken, '9');
      expect((await metricAlarmDirect(ctx, port, taken)).Threshold, 'the threshold of that alarm, directly').toBe(5);
    },
  );

  await lines.line(
    'Create an alarm named `<p>-rule` → the same sentence with that name; the emulator still reports a composite alarm of that name and no metric alarm',
    async () => {
      const form = await enter(page, ruleName, '9');
      await form.create.click(ACTION);
      await expect(errorOf(form.nameField), 'what the form says under "Name"').toHaveText(alarmExists(ruleName), {
        timeout: 15_000,
      });
      await expectFormStays(ruleName, '9');
      const direct = await alarmDirect(ctx, port, ruleName);
      expect(
        { composite: direct.composite.map((a) => a.AlarmName), metric: direct.metric.map((a) => a.AlarmName) },
        'the alarms of that name, directly',
      ).toEqual({ composite: [ruleName], metric: [] });
    },
  );

  await lines.line(
    'Create an alarm named `<p>-stat` with the statistic Other and `p101` → the form stays with what was entered and shows `PutMetricAlarm` and the emulator\'s reason; the emulator holds no alarm of that name',
    async () => {
      const name = `${p}-stat`;
      const refusal = await refusalDirect(ctx, port, 'PutMetricAlarm', {
        AlarmName: name,
        Namespace: metric.namespace,
        MetricName: metric.metric,
        ExtendedStatistic: 'p101',
        Period: 60,
        EvaluationPeriods: 1,
        Threshold: 9,
        ComparisonOperator: 'GreaterThanThreshold',
      });
      const form = await enter(page, name, '9');
      await chooseOption(form.statistic, 'Other');
      await form.extendedStatistic.fill('p101', ACTION);
      await answered(page, 'PutMetricAlarm', () => form.create.click(ACTION));

      await expectAlert(form.main, failed('PutMetricAlarm'), codeAndMessage(refusal));
      await expectFormStays(name, '9');
      await expect(form.extendedStatistic, 'the statistic entered').toHaveValue('p101');
      expect(namesOf(await alarmDirect(ctx, port, name)), 'the alarms of that name, directly').toEqual([]);
    },
  );

  lines.end();
});
