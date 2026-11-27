// Event buses (S1) and an event bus's page (S3) as they read what the emulator holds, in the built app in front of a
// real engine and emulator (test-criteria.md, issue 75).
//
// `studio.events-buses-made-outside-are-listed`, `studio.events-bus-list-pages`,
// `studio.events-bus-page-shows-its-rules`, `studio.events-missing-bus-and-rule-are-not-found`.
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EventsSeeded`). What the
// emulator holds is read directly. Words, direct calls and readers: `services/events/events.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  BUS_NOT_FOUND,
  busDirect,
  busesDirect,
  busList,
  busPath,
  busScreen,
  CREATE_RULE,
  CREATE_RULE_PATH,
  dateText,
  EVENT_BUSES,
  EVENT_BUSES_PATH,
  EVENT_PATTERN,
  EventsSeeded,
  expectBusChosen,
  expectBuses,
  expectEmpty,
  expectRows,
  expectRules,
  filterBuses,
  filterRules,
  NO_BUSES_MATCH,
  NO_RULES,
  NO_RULES_MATCH,
  open,
  refusalDirect,
  RULE_NOT_FOUND,
  rulePath,
  rulesDirect,
  rowsOf,
  SEND_EVENTS,
  SEND_EVENTS_PATH,
  shownRule,
  stateShown,
  stateText,
  withBus,
} from './services/events/events';

test('studio.events-buses-made-outside-are-listed', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'eb-listed');
  const seeded = new EventsSeeded(ctx, port, p);
  await seeded.bus(`${p}-orders`, { description: 'Order events' });
  await seeded.bus(`${p}-Audit`);
  const s = busList(page);
  /** A row of the list as the four values the line names. */
  const shown = (r: Record<string, string>) => ({
    name: r.Name,
    description: r.Description,
    created: r['Creation time'],
    changed: r['Last change'],
  });

  await lines.line(
    'Open Event buses and filter by `<p>-` → the two rows show their name, the description or "-", a creation time and a last change, as the emulator reports them',
    async () => {
      const direct = await busesDirect(ctx, port, `${p}-`);
      expect(direct.map((bus) => bus.Name).sort(), 'the two buses, directly').toEqual([`${p}-Audit`, `${p}-orders`]);
      expect(
        direct.filter((bus) => bus.CreationTime === undefined || bus.LastModifiedTime === undefined).map((bus) => bus.Name),
        'the buses the emulator reports without a creation time or a last change',
      ).toEqual([]);
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, `${p}-`);
      await expectRows(
        s.table,
        shown,
        direct.map((bus) => ({
          name: bus.Name,
          description: bus.Description === undefined || bus.Description === '' ? '-' : bus.Description,
          created: dateText(bus.CreationTime),
          changed: dateText(bus.LastModifiedTime),
        })),
        'the two rows as the emulator reports them',
      );
      expect(
        (await busesDirect(ctx, port, `${p}-orders`)).map((bus) => bus.Description),
        'the description of `<p>-orders`, directly',
      ).toEqual(['Order events']);
    },
  );

  await lines.line(
    'Filter by `<p>-audit` (lower case) → "No event buses match"; filter by `<p>-Audit` → that one row',
    async () => {
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, `${p}-audit`);
      await expectEmpty(s.table, NO_BUSES_MATCH);
      await filterBuses(page, `${p}-Audit`);
      await expectBuses(page, [`${p}-Audit`]);
    },
  );

  await lines.line('Filter by `default` → the row `default`, its creation time "-"', async () => {
    await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
    await filterBuses(page, 'default');
    await expect
      .poll(async () => (await rowsOf(s.table)).map(shown), {
        message: 'the row `default` with its creation time "-"',
        timeout: 15_000,
      })
      .toContainEqual(expect.objectContaining({ name: 'default', created: '-' }));
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-bus-list-pages', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'eb-pages');
  const seeded = new EventsSeeded(ctx, port, p);
  const names = Array.from({ length: 26 }, (_, i) => `${p}-${String(i).padStart(2, '0')}`);
  for (const name of names) await seeded.bus(name);

  await lines.line(
    'Filter by `<p>-` → the first page shows 25 buses in name order; the next page shows `<p>-25`; going back shows the first 25 again',
    async () => {
      const s = busList(page);
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, `${p}-`);
      await expectBuses(page, names.slice(0, 25));
      await s.next.click(ACTION);
      await expectBuses(page, [names[25]]);
      await s.previous.click(ACTION);
      await expectBuses(page, names.slice(0, 25));
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-bus-page-shows-its-rules', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'eb-shop');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-shop`)).Name;
  await seeded.rule(bus, 'a-orders', { pattern: '{"source":["shop"]}', description: 'Orders' });
  await seeded.rule(bus, 'b-paused', { pattern: '{"source":["shop"]}', disabled: true });
  const s = busScreen(page);

  await lines.line(
    'Open the bus from Event buses → its page shows its ARN and, under its rules, `a-orders` "Enabled" "Event pattern" "Orders" and `b-paused` "Disabled" "Event pattern", as the emulator reports them',
    async () => {
      const direct = await rulesDirect(ctx, port, bus);
      expect(
        direct.map((rule) => ({ name: rule.Name, state: rule.State, description: rule.Description ?? null })),
        'the two rules, directly',
      ).toEqual([
        { name: 'a-orders', state: 'ENABLED', description: 'Orders' },
        { name: 'b-paused', state: 'DISABLED', description: null },
      ]);
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, bus);
      await expectBuses(page, [bus]);
      await busList(page).link(bus).click(ACTION);
      await expect(page, "the bus's page, at its address").toHaveURL(addressOf(busPath(bus)), { timeout: 15_000 });
      await expect(heading(page, bus), `the h1 "${bus}"`).toBeVisible();
      await expectPairs(page, { ARN: (await busDirect(ctx, port, bus)).Arn });
      await expectRows(
        s.rules,
        shownRule,
        direct.map((rule) => ({
          name: rule.Name,
          state: stateText(rule.State),
          trigger: rule.EventPattern === undefined ? '-' : EVENT_PATTERN,
          description: rule.Description ?? '-',
        })),
        'the rules as the emulator reports them',
      );
      await expectRows(
        s.rules,
        shownRule,
        [
          { name: 'a-orders', state: 'Enabled', trigger: 'Event pattern', description: 'Orders' },
          { name: 'b-paused', state: 'Disabled', trigger: 'Event pattern', description: '-' },
        ],
        'the rules in the words of the line',
      );
    },
  );

  await lines.line('Filter the rules by `b` → only `b-paused`; by `B` → "No rules match"', async () => {
    await open(page, busPath(bus), bus);
    await expectRules(s.rules, ['a-orders', 'b-paused']);
    await filterRules(page, s.rules, 'b');
    await expectRules(s.rules, ['b-paused']);
    await filterRules(page, s.rules, 'B');
    await expectEmpty(s.rules, NO_RULES_MATCH);
  });

  await lines.line('"Create rule" and "Send events" there each lead to their form with `<p>-shop` chosen', async () => {
    for (const [name, path] of [
      [CREATE_RULE, CREATE_RULE_PATH],
      [SEND_EVENTS, SEND_EVENTS_PATH],
    ] as const) {
      await open(page, busPath(bus), bus);
      await s.link(name).click(ACTION);
      await expect(page, `the address of "${name}" with the bus`).toHaveURL(addressOf(withBus(path, bus)), {
        timeout: 15_000,
      });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      await expectBusChosen(page, bus);
    }
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-missing-bus-and-rule-are-not-found', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'eb-missing');
  const seeded = new EventsSeeded(ctx, port, p);
  const here = (await seeded.bus(`${p}-here`)).Name;
  const nowhere = `${p}-nowhere`;

  await lines.line(
    'Open the address of the bus `<p>-nowhere` → "Event bus not found"; open `<p>-here` → "No rules"',
    async () => {
      expect(await busesDirect(ctx, port, nowhere), 'no bus `<p>-nowhere`, directly').toEqual([]);
      await open(page, busPath(nowhere), nowhere);
      await expect(stateShown(page, BUS_NOT_FOUND), `"${BUS_NOT_FOUND}"`).toBeVisible({ timeout: 15_000 });
      await open(page, busPath(here), here);
      await expectEmpty(busScreen(page).rules, NO_RULES);
      await expect(stateShown(page, BUS_NOT_FOUND), `"${BUS_NOT_FOUND}" on the page of a bus that is there`).toHaveCount(0);
    },
  );

  await lines.line(
    'Open the address of the rule `none` of `<p>-here` → "Rule not found" with the emulator\'s message naming the rule; of the rule `none` of `<p>-nowhere` → "Rule not found" with the emulator\'s message naming the bus',
    async () => {
      for (const [bus, named] of [
        [here, 'none'],
        [nowhere, nowhere],
      ] as const) {
        const reason = await refusalDirect(ctx, port, 'DescribeRule', { Name: 'none', EventBusName: bus });
        expect(reason, `the emulator's message for the rule none of ${bus} names ${named}`).toContain(named);
        await open(page, rulePath(bus, 'none'), 'none');
        await expect(stateShown(page, RULE_NOT_FOUND), `"${RULE_NOT_FOUND}" for ${bus}`).toBeVisible({ timeout: 15_000 });
        await expect(stateShown(page, reason), `the emulator's message "${reason}"`).toBeVisible();
      }
    },
  );

  lines.end();
});
