// Rules (S4) and a rule's page (S6) as they read what the emulator holds, in the built app in front of a real engine
// and emulator (test-criteria.md, issue 75).
//
// `studio.events-rules-entry-lists-a-chosen-bus`, `studio.events-rule-page-shows-rule-and-targets`,
// `studio.events-rule-names-of-dots-open-by-their-address`.
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EventsSeeded`); a rule on
// `default` carries the prefix and the bus itself is not changed. What the emulator holds is read directly. Words,
// direct calls and readers: `services/events/events.ts`.

import { expect, startStack, test } from './support';
import { expectPairs, navigationLink } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADD_TARGET,
  answered,
  AT_MOST_FIVE_TARGETS,
  busPath,
  busScreen,
  chooseBus,
  dialogOf,
  EVENT_BUSES,
  EVENT_BUSES_PATH,
  EventsSeeded,
  expectBusChosen,
  expectFlash,
  expectRows,
  expectRules,
  expectTargetIds,
  expectUnavailable,
  filterRules,
  finish,
  open,
  pairsIn,
  REMOVE,
  rowsIn,
  ruleDirect,
  ruleFilter,
  rulePath,
  RULES,
  RULES_PATH,
  ruleScreen,
  shownRule,
  shownTargets,
  tableTitled,
  targetCell,
  targetRemoved,
  targetsDirect,
  withBus,
} from './services/events/events';

test('studio.events-rules-entry-lists-a-chosen-bus', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'er-pick');
  const seeded = new EventsSeeded(ctx, port, p);
  const pick = (await seeded.bus(`${p}-pick`)).Name;
  await seeded.rule(pick, 'only-here', { pattern: '{"source":["shop"]}' });
  await seeded.rule('default', `${p}-timer`, { schedule: 'rate(5 minutes)', disabled: true });
  await seeded.rule('default', `${p}-both`, {
    pattern: '{"source":["shop"]}',
    schedule: 'rate(1 hour)',
    disabled: true,
  });
  const rules = tableTitled(page, RULES);

  await lines.line(
    'Open Rules from the navigation → `default` is chosen; filter by `<p>-` → `<p>-timer` starts by "rate(5 minutes)" and `<p>-both` by "Event pattern, rate(1 hour)"',
    async () => {
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await navigationLink(page, RULES_PATH).click(ACTION);
      await expect(page, 'the address of Rules').toHaveURL(addressOf(RULES_PATH));
      await expect(heading(page, RULES), 'the h1 "Rules"').toBeVisible();
      await expectBusChosen(page, 'default');
      await filterRules(page, rules, `${p}-`);
      await expectRows(
        rules,
        (r) => ({ name: shownRule(r).name, trigger: shownRule(r).trigger }),
        [
          { name: `${p}-both`, trigger: 'Event pattern, rate(1 hour)' },
          { name: `${p}-timer`, trigger: 'rate(5 minutes)' },
        ],
        'the two rules of `default` under the prefix, each with what starts it',
      );
    },
  );

  await lines.line(
    "Choose `<p>-pick` → the name filter is empty again and the list is its one rule `only-here`, and the address holds the bus; reloading shows the same; the rule's name leads to its page",
    async () => {
      await open(page, RULES_PATH, RULES);
      await expectBusChosen(page, 'default');
      await filterRules(page, rules, `${p}-`);
      await expectRules(rules, [`${p}-both`, `${p}-timer`]);
      await chooseBus(page, pick);
      await expectBusChosen(page, pick);
      await expectRules(rules, ['only-here']);
      await expect(ruleFilter(rules), 'the name filter after the bus changed').toHaveValue('');
      await expect(page, 'the address holds the bus').toHaveURL(addressOf(withBus(RULES_PATH, pick)));

      await page.reload();
      await expect(heading(page, RULES), 'the h1 "Rules" after reloading').toBeVisible({ timeout: 15_000 });
      await expectBusChosen(page, pick);
      await expectRules(rules, ['only-here']);
      await expect(ruleFilter(rules), 'the name filter after reloading').toHaveValue('');

      await rowsIn(rules).getByRole('link', { name: 'only-here', exact: true }).click(ACTION);
      await expect(page, "the rule's page, at its address").toHaveURL(addressOf(rulePath(pick, 'only-here')), {
        timeout: 15_000,
      });
      await expect(heading(page, 'only-here'), 'the h1 "only-here"').toBeVisible();
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-rule-page-shows-rule-and-targets', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'er-read');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-read`)).Name;
  const queue = await seeded.queue(`${p}-q`);
  const topic = await seeded.topic(`${p}-t`);
  const group = await seeded.logGroup(`/aws/events/${p}-g`);
  // The function is not made: a target holds an ARN, and the emulator stores one whose function it does not hold.
  const fn = queue.arn.replace(':sqs:', ':lambda:').replace(/:[^:]+$/, `:function:${p}-fn`);
  const pattern = '{"source":["shop"]}';
  const template = '{"n": <n>}';
  await seeded.rule(bus, 'routes', { pattern, description: 'Reads' });
  await seeded.targets(bus, 'routes', [
    { Id: 'whole', Arn: queue.arn },
    { Id: 'fixed', Arn: queue.arn, Input: '{"k":1}' },
    { Id: 'part', Arn: topic, InputPath: '$.detail' },
    { Id: 'shaped', Arn: group, InputTransformer: { InputPathsMap: { n: '$.detail.n' }, InputTemplate: template } },
    {
      Id: 'fn',
      Arn: fn,
      DeadLetterConfig: { Arn: queue.arn },
      RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
    },
  ]);
  const s = ruleScreen(page);
  /** The row of the target `id` as the page shows it; fails the check when the page shows none. */
  const row = async (id: string) => {
    const found = (await shownTargets(page)).find((each) => each.ID === id);
    if (found === undefined) throw new Error(`the page shows no target ${id}`);
    return found;
  };

  await lines.line(
    'Open the rule from the bus\'s page → its ARN, its bus (a link to the bus\'s page), "Enabled", the description and the pattern as the emulator stores it',
    async () => {
      const direct = await ruleDirect(ctx, port, bus, 'routes');
      expect(direct.Arn, "the rule's ARN, directly").toBeTruthy();
      await open(page, busPath(bus), bus);
      await busScreen(page).ruleLink('routes').click(ACTION);
      await expect(page, "the rule's page, at its address").toHaveURL(addressOf(rulePath(bus, 'routes')), {
        timeout: 15_000,
      });
      await expect(heading(page, 'routes'), 'the h1 "routes"').toBeVisible();
      await expectPairs(page, {
        ARN: direct.Arn ?? '',
        'Event bus': bus,
        State: 'Enabled',
        Description: 'Reads',
        'Event pattern': direct.EventPattern ?? '',
      });
      expect(
        { state: direct.State, description: direct.Description, pattern: direct.EventPattern },
        'the rule, directly',
      ).toEqual({ state: 'ENABLED', description: 'Reads', pattern });
      await expect(s.link(bus), "the bus is a link to the bus's page").toHaveAttribute('href', busPath(bus));
    },
  );

  await lines.line(
    'Its targets → each ID with its ARN and what it receives: "Matched event", "Constant" with the constant, "Part of the event" with `$.detail`, "Transformed" with the transformer\'s paths and template; `fn` with its dead-letter queue and retry policy; "Add target" cannot be pressed and says a rule holds at most 5 targets',
    async () => {
      const direct = await targetsDirect(ctx, port, bus, 'routes');
      await open(page, rulePath(bus, 'routes'), 'routes');
      await expect
        .poll(async () => (await shownTargets(page)).map((each) => ({ id: each.ID, arn: each.ARN })), {
          message: 'each ID with its ARN, as the emulator reports them',
          timeout: 15_000,
        })
        .toEqual(direct.map((target) => ({ id: target.Id, arn: target.Arn })));
      expect(
        direct.map((target) => ({ id: target.Id, arn: target.Arn })),
        'the five targets with their ARNs, directly',
      ).toEqual([
        { id: 'fixed', arn: queue.arn },
        { id: 'fn', arn: fn },
        { id: 'part', arn: topic },
        { id: 'shaped', arn: group },
        { id: 'whole', arn: queue.arn },
      ]);

      // What each receives: the cell's whole text, the kind first and what it holds after it.
      expect((await row('whole')).Receives, 'what `whole` receives').toBe('Matched event');
      expect((await row('fixed')).Receives, 'what `fixed` receives, with its constant').toBe('Constant{"k":1}');
      expect((await row('part')).Receives, 'what `part` receives, with its path').toBe('Part of the event$.detail');
      const shaped = await targetCell(page, 'shaped', 'Receives');
      expect(await pairsIn(shaped), "the transformer's paths and template").toEqual({
        'Input paths': '{ "n": "$.detail.n" }',
        'Input template': template,
      });
      expect((await row('shaped')).Receives, 'what `shaped` receives, whole').toBe(
        `TransformedInput paths{ "n": "$.detail.n" }Input template${template}`,
      );
      for (const id of ['whole', 'fixed', 'part', 'shaped']) {
        expect((await row(id)).Details, `the details of \`${id}\``).toBe('-');
      }
      expect(await pairsIn(await targetCell(page, 'fn', 'Details')), 'the dead-letter queue and retry policy of `fn`').toEqual({
        'Dead-letter queue ARN': queue.arn,
        'Maximum event age (seconds)': '3600',
        'Maximum retry attempts': '2',
      });
      expect((await row('fn')).Receives, 'what `fn` receives').toBe('Matched event');

      await expectUnavailable(s.button(ADD_TARGET), AT_MOST_FIVE_TARGETS);
    },
  );

  await lines.line(
    'Remove `fn` and confirm → "Target fn removed from routes."; the emulator reports the four other targets',
    async () => {
      const dialog = dialogOf(page);
      await open(page, rulePath(bus, 'routes'), 'routes');
      await expectTargetIds(page, ['fixed', 'fn', 'part', 'shaped', 'whole']);
      await s.remove('fn').click(ACTION);
      await expect(dialog, 'the dialog').toBeVisible();
      await answered(page, 'RemoveTargets', () => dialog.getByRole('button', { name: REMOVE, exact: true }).click(ACTION));
      await expectFlash(page, 'success', targetRemoved('fn', 'routes'));
      await expect(dialog, 'the dialog after the removal').toHaveCount(0);
      await expectTargetIds(page, ['fixed', 'part', 'shaped', 'whole']);
      expect(
        (await targetsDirect(ctx, port, bus, 'routes')).map((target) => target.Id),
        'the targets, directly',
      ).toEqual(['fixed', 'part', 'shaped', 'whole']);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-rule-names-of-dots-open-by-their-address', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'er-dots');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-dots`)).Name;
  await seeded.rule(bus, '.', { pattern: '{"source":["shop"]}', description: 'one dot' });
  await seeded.rule(bus, '..', { pattern: '{"source":["shop"]}', description: 'two dots' });

  await lines.line(
    "From the bus's page follow each rule's name → that rule's page shows its name as title and its description; reloading the page at that address shows the same",
    async () => {
      for (const [name, description] of [
        ['.', 'one dot'],
        ['..', 'two dots'],
      ] as const) {
        expect((await ruleDirect(ctx, port, bus, name)).Description, `the description of \`${name}\`, directly`).toBe(
          description,
        );
        await open(page, busPath(bus), bus);
        await expectRules(busScreen(page).rules, ['.', '..']);
        await busScreen(page).ruleLink(name).click(ACTION);
        await expect(page, `the page of the rule \`${name}\`, at its address`).toHaveURL(addressOf(rulePath(bus, name)), {
          timeout: 15_000,
        });
        await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
        await expectPairs(page, { Description: description, 'Event bus': bus });

        await page.reload();
        await expect(heading(page, name), `the h1 "${name}" after reloading`).toBeVisible({ timeout: 15_000 });
        await expect(page, 'the address after reloading').toHaveURL(addressOf(rulePath(bus, name)));
        await expectPairs(page, { Description: description, 'Event bus': bus });
      }
    },
  );

  await finish(lines, seeded);
});
