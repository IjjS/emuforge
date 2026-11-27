// The Alarms list (S1), an alarm's address, a missing alarm and the service's entries, in the built app in front of
// a real engine and emulator (test-criteria.md, issue 70).
//
// `studio.cloudwatch-alarms-made-outside-are-listed`, `studio.cloudwatch-alarm-list-pages`,
// `studio.cloudwatch-alarm-names-open-by-their-address`, `studio.cloudwatch-missing-alarm-is-not-found`,
// `studio.cloudwatch-entries-lead-to-a-screen-or-no-screen-yet`.
//
// Each check names its alarms with its own prefix `<p>` and deletes every alarm under it when it ends
// (`CloudWatchSeeded`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/cloudwatch/cloudwatch.ts`.

import { expect, startStack, test } from './support';
import { expectOneCurrent, navigationLink, navigationTree } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { nothingChanged } from './support/no-screen-part';
import { clipboardText, copiedText, copyControl, grantClipboard, setClipboard } from './support/screen-rules';
import { checkPrefix } from './support/service-screens';
import {
  actionsText,
  ALARM_PATH,
  alarmDeleted,
  alarmList,
  alarmPath,
  ALARMS,
  ALARMS_PATH,
  alarmScreen,
  alarmsDirect,
  answered,
  chooseState,
  CloudWatchSeeded,
  copyOf,
  CLOUDWATCH_PATH,
  confirmWith,
  CREATE_ALARM,
  CREATE_ALARM_PATH,
  DELETE,
  drawnText,
  EDIT_ALARM,
  editAlarmPath,
  ENTRIES,
  eventually,
  expectAlarms,
  expectEmpty,
  expectFlash,
  expectNameHeading,
  expectRows,
  expectShown,
  finish,
  filterAlarms,
  LOG_QUERY,
  metricAlarmDirect,
  namesOf,
  shownPairValues,
  NAVIGATION_HEADER,
  NO_ALARMS_MATCH,
  open,
  openAlarm,
  openAlarms,
  openEdit,
  rowsIn,
  rowsOf,
  waitState,
} from './services/cloudwatch/cloudwatch';

test('studio.cloudwatch-alarms-made-outside-are-listed', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-listed');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const inAlarm = await seeded.metricAlarm(`${p}-a-alarm`, { TreatMissingData: 'breaching' });
  const ok = await seeded.metricAlarm(`${p}-b-ok`, { TreatMissingData: 'notBreaching' });
  await waitState(ctx, port, inAlarm, 'ALARM');
  await waitState(ctx, port, ok, 'OK');
  const rule = `ALARM("${inAlarm}")`;
  const both = await seeded.compositeAlarm(`${p}-c-both`, rule);
  const log = await seeded.logAlarm(`${p}-d-log`, `${p}/group`);

  await lines.line(
    'Open Alarms and filter by `<p>-` → four rows in the order of the names; `<p>-a-alarm` shows "Metric alarm", "In alarm" and its condition in one line with `Errors`, the comparison, 1 and "1 out of 1" of 1 minute; `<p>-b-ok` shows "OK"; `<p>-c-both` shows "Composite alarm" and its rule; `<p>-d-log` shows "Log alarm" and its query; each row says whether its actions are on, as the emulator reports',
    async () => {
      const direct = await alarmsDirect(ctx, port, `${p}-`);
      const actions = new Map(
        [...direct.metric, ...direct.composite, ...direct.log].map((a) => [a.AlarmName, actionsText(a.ActionsEnabled)]),
      );
      expect([...actions.keys()].sort(), 'the four alarms, directly').toEqual([inAlarm, ok, both, log]);
      await openAlarms(page, `${p}-`);
      await expectRows(
        alarmList(page).table,
        (r) => ({ name: r.Name, type: r.Type, condition: r.Condition, actions: r.Actions }),
        [
          {
            name: inAlarm,
            type: 'Metric alarm',
            condition: 'Errors greater than 1 (1 out of 1 periods, 1 minute each)',
            actions: actions.get(inAlarm),
          },
          {
            name: ok,
            type: 'Metric alarm',
            condition: 'Errors greater than 1 (1 out of 1 periods, 1 minute each)',
            actions: actions.get(ok),
          },
          { name: both, type: 'Composite alarm', condition: rule, actions: actions.get(both) },
          { name: log, type: 'Log alarm', condition: LOG_QUERY, actions: actions.get(log) },
        ],
        'the four alarms with their type, condition and actions',
      );
      const states = (await rowsOf(alarmList(page).table)).slice(0, 2).map((r) => r.State);
      expect(states, 'the states of the two metric alarms').toEqual(['In alarm', 'OK']);
    },
  );

  await lines.line(
    'Choose the state In alarm with the same filter → `<p>-a-alarm` is listed and `<p>-b-ok` is not; choose OK → `<p>-b-ok` is listed and `<p>-a-alarm` is not',
    async () => {
      const shown = async () => (await rowsOf(alarmList(page).table)).map((r) => r.Name);
      const expectListed = (listed: string, not: string) =>
        expect
          .poll(async () => ({ listed: (await shown()).includes(listed), not: (await shown()).includes(not) }), {
            message: `${listed} is listed and ${not} is not`,
            timeout: 15_000,
          })
          .toEqual({ listed: true, not: false });
      await openAlarms(page, `${p}-`);
      await expectAlarms(page, [inAlarm, ok, both, log]);
      await chooseState(page, 'ALARM');
      await expectListed(inAlarm, ok);
      await chooseState(page, 'OK');
      await expectListed(ok, inAlarm);
    },
  );

  await lines.line('Filter by `<P>-A` (the prefix in upper case) with any state → "No alarms match"', async () => {
    await open(page, ALARMS_PATH, ALARMS);
    await filterAlarms(page, `${p.toUpperCase()}-A`);
    await expectEmpty(alarmList(page).table, NO_ALARMS_MATCH);
  });

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-alarm-list-pages', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-pages');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const names = Array.from({ length: 26 }, (_, i) => `${p}-${String(i).padStart(2, '0')}`);
  for (const name of names) await seeded.metricAlarm(name, { TreatMissingData: 'ignore' });

  await lines.line(
    'Filter by `<p>-` → the first page shows 25 alarms in name order; the next page shows `<p>-25` alone; going back shows the first 25 again',
    async () => {
      const s = alarmList(page);
      await openAlarms(page, `${p}-`);
      await expectAlarms(page, names.slice(0, 25));
      await s.next.click(ACTION);
      await expectAlarms(page, names.slice(25));
      await s.previous.click(ACTION);
      await expectAlarms(page, names.slice(0, 25));
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-alarm-names-open-by-their-address', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-names');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  await grantClipboard(context, stack.studio.origin);
  const names = [`${p} a/./../b?c#d%e&f`, `${p}  x\ny`, `${p}-😀`];
  for (const name of names) await seeded.metricAlarm(name, { TreatMissingData: 'ignore' });
  /** The names under the prefix in the order the emulator lists them. */
  const listed = async () => (await alarmsDirect(ctx, port, p)).metric.map((alarm) => alarm.AlarmName);
  /** The names the list shows, each as its link holds it, with how its white space is drawn. */
  const shownNames = async () => {
    const s = alarmList(page);
    const count = await rowsIn(s.table).count();
    return Promise.all(Array.from({ length: count }, (_, row) => drawnText(s.nameLink(row))));
  };
  /** Waits until the page's "ARN" reads the ARN the emulator reports for `name`, character for character. */
  const expectArn = async (name: string) => {
    const arn = (await metricAlarmDirect(ctx, port, name)).AlarmArn;
    await expect
      .poll(() => shownPairValues(page, 'ARN'), {
        message: `the one "ARN" of the page draws the ARN of ${JSON.stringify(name)} as the emulator reports it`,
        timeout: 15_000,
      })
      .toEqual([arn]);
  };
  /** Waits until the list shows the three names, character for character, in the emulator's order. */
  const expectListed = async (): Promise<string[]> => {
    const order = await listed();
    expect([...order].sort(), 'the three alarms, directly').toEqual([...names].sort());
    await expect
      .poll(async () => (await shownNames()).map((shown) => shown.text), {
        message: 'the three names in the list, character for character',
        timeout: 15_000,
      })
      .toEqual(order);
    return order;
  };

  await lines.line(
    "Filter Alarms by `<p>` → each row's name is the alarm's name character for character, its two spaces and its line feed drawn (the name's element keeps white space); follow each name → the alarm's page opens with that name in its heading, character for character and drawn the same way, and its ARN as the emulator reports it",
    async () => {
      await openAlarms(page, p);
      const order = await expectListed();
      expect(
        (await shownNames()).map((shown) => shown.whiteSpace),
        'the white space of each name in the list is kept',
      ).toEqual(order.map(() => 'pre-wrap'));

      for (const name of names) {
        await openAlarms(page, p);
        const at = (await expectListed()).indexOf(name);
        await alarmList(page).nameLink(at).click(ACTION);
        await expect(page, `the address of ${JSON.stringify(name)}`).toHaveURL(addressOf(alarmPath(name)));
        await expectNameHeading(page, name);
        await expectArn(name);
      }
    },
  );

  await lines.line(
    'On each page press "Copy Name" → "Name copied", and the clipboard holds the alarm\'s name, whole and unchanged: the two spaces and the line feed of the second, the non-BMP character of the third',
    async () => {
      for (const name of names) {
        await openAlarm(page, name);
        await setClipboard(page, 'not the name');
        const copy = copyOf(page.getByRole('main'), copyControl('Name'));
        await copy.button.click(ACTION);
        await expectShown(copy.status, [copiedText('Name')], `what "Copy Name" says for ${JSON.stringify(name)}`);
        await expect.poll(() => clipboardText(page), { message: 'the clipboard holds the name', ...ACTION }).toBe(name);
      }
    },
  );

  await lines.line('Reload each page at its address → the same alarm, the same name', async () => {
    for (const name of names) {
      await openAlarm(page, name);
      await expectArn(name);
      await page.reload();
      await expect(page, `the address of ${JSON.stringify(name)} after the reload`).toHaveURL(addressOf(alarmPath(name)));
      await expectNameHeading(page, name);
      await expectArn(name);
    }
  });

  await lines.line(
    'Delete the first from its page → the emulator no longer holds it and still holds the other two',
    async () => {
      const first = `${p} a/./../b?c#d%e&f`;
      const others = names.filter((name) => name !== first);
      expect(others.length, 'the two alarms that stay').toBe(2);
      await openAlarm(page, first);
      await alarmScreen(page).button(DELETE).click(ACTION);
      await answered(page, 'DeleteAlarms', () => confirmWith(page, 'delete', DELETE));
      await expect(page, 'Alarms opens').toHaveURL(addressOf(ALARMS_PATH), { timeout: 15_000 });
      await expectFlash(page, 'success', alarmDeleted(first));
      expect(
        await eventually(5_000, async () => namesOf(await alarmsDirect(ctx, port, p)), (held) => held.length === 2),
        'the alarms under the prefix, directly',
      ).toEqual([...others].sort());
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-missing-alarm-is-not-found', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-none');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const name = `${p}-none`;

  await lines.line(
    'Open the alarm page\'s address with that name → "Alarm not found", told apart from a failure, with the way back to Alarms',
    async () => {
      expect(namesOf(await alarmsDirect(ctx, port, name)), 'no alarm of that name, directly').toEqual([]);
      const s = alarmScreen(page);
      await page.goto(alarmPath(name));
      await expect(s.notFound, '"Alarm not found"').toBeVisible({ timeout: 15_000 });
      await expect(s.main.getByRole('button', { name: 'Retry', exact: true }), 'no "Retry" is offered').toHaveCount(0);
      await s.backToAlarms.click(ACTION);
      await expect(page, 'the way back leads to Alarms').toHaveURL(addressOf(ALARMS_PATH));
      await expect(heading(page, ALARMS), 'the h1 "Alarms"').toBeVisible();
    },
  );

  await lines.line(
    'Open the edit form\'s address with that name, and the alarm page\'s address with no name → "Alarm not found" on each',
    async () => {
      const s = alarmScreen(page);
      for (const path of [editAlarmPath(name), ALARM_PATH]) {
        await page.goto(path);
        await expect(s.notFound, `"Alarm not found" at ${path}`).toBeVisible({ timeout: 15_000 });
        await expect(s.backToAlarms, `the way back to Alarms at ${path}`).toBeVisible();
      }
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.cloudwatch-entries-lead-to-a-screen-or-no-screen-yet', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'cw-entries');
  const seeded = new CloudWatchSeeded(ctx, port, p);
  const alarm = await seeded.metricAlarm(`${p}-nav`, { TreatMissingData: 'ignore' });
  const wanted = ENTRIES.map((entry) => `${entry.label} → ${entry.path}`).sort();
  /** The navigation's header and its links below it, as pairs of label and path. */
  const navigation = async () => {
    const tree = await navigationTree(page);
    return { header: tree.header, links: tree.links.map((link) => `${link.text} → ${link.href}`).sort() };
  };
  const expectNavigation = (what: string) =>
    expect.poll(navigation, { message: what, ...ACTION }).toEqual({ header: NAVIGATION_HEADER, links: wanted });

  await lines.line(
    "Each entry of that table is in the navigation under its label and leads to its path, and the navigation holds no other link below the service's header",
    async () => {
      await open(page, ALARMS_PATH, ALARMS);
      await expectNavigation("the navigation's links are the table's entries and no other");
      const tree = await navigationTree(page);
      expect(
        tree.links.filter((link) => !link.shown).map((link) => link.text),
        'the entries whose label is not drawn',
      ).toEqual([]);
    },
  );

  await lines.line(
    '"Alarms" leads to its screen, named by its title; `/aws/cloudwatch` shows the same screen',
    async () => {
      /** The Alarms screen itself, with the alarm the check made, not the area's page for an entry without one. */
      const expectAlarmsScreen = async (where: string) => {
        await expect(heading(page, ALARMS), `the screen titled "Alarms" ${where}`).toBeVisible();
        await expect(nothingChanged(page), `the sentence of a page without a screen ${where}`).toHaveCount(0);
        await filterAlarms(page, p);
        await expectAlarms(page, [alarm]);
      };
      await open(page, CREATE_ALARM_PATH, CREATE_ALARM);
      await navigationLink(page, ALARMS_PATH).click(ACTION);
      await expect(page, 'the address of "Alarms"').toHaveURL(addressOf(ALARMS_PATH));
      await expectAlarmsScreen('from its entry');
      await expectOneCurrent(page, ALARMS);

      await page.goto(CLOUDWATCH_PATH);
      await expectAlarmsScreen(`at ${CLOUDWATCH_PATH}`);
    },
  );

  await lines.line(
    'Every other entry leads to the area\'s page for an entry without a screen: it is titled by the entry\'s label, keeps the service\'s navigation with that entry current, and is not the area\'s "Page not found"',
    async () => {
      await open(page, ALARMS_PATH, ALARMS);
      for (const entry of ENTRIES.filter((each) => !each.screen)) {
        await navigationLink(page, entry.path).click(ACTION);
        await expect(page, `the address of "${entry.label}"`).toHaveURL(addressOf(entry.path));
        await expect(heading(page, entry.label), `the page titled "${entry.label}"`).toBeVisible();
        await expect(
          nothingChanged(page),
          `the sentence of the area's page for an entry without a screen at ${entry.path}`,
        ).toBeVisible();
        await expectOneCurrent(page, entry.label);
        await expectNavigation(`the service's navigation on the page of "${entry.label}"`);
        await expect(heading(page, 'Page not found'), `"Page not found" at ${entry.path}`).toHaveCount(0);
      }
    },
  );

  await lines.line(
    'Create alarm, an alarm\'s page and its edit form each keep the service\'s navigation with "Alarms" current',
    async () => {
      await open(page, CREATE_ALARM_PATH, CREATE_ALARM);
      await expectNavigation("the service's navigation on Create alarm");
      await expectOneCurrent(page, ALARMS);

      await openAlarm(page, alarm);
      await expectNavigation("the service's navigation on the alarm's page");
      await expectOneCurrent(page, ALARMS);

      await openEdit(page, alarm, '1');
      await expect(heading(page, EDIT_ALARM), 'the h1 "Edit alarm"').toBeVisible();
      await expectNavigation("the service's navigation on the edit form");
      await expectOneCurrent(page, ALARMS);
    },
  );

  await finish(lines, seeded);
});
