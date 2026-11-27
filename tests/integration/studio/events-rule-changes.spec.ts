// Creating a rule with its targets (S5) and changing a rule on its page (S6): the switch, adding and removing a
// target, deleting the rule, in the built app in front of a real engine and emulator (test-criteria.md, issue 75).
//
// `studio.events-create-rule-with-targets`, `studio.events-create-rule-existing-name-is-refused`,
// `studio.events-create-rule-refused-pattern-leaves-no-rule`, `studio.events-create-schedule-rule-on-default`,
// `studio.events-rule-switch-off-and-on`, `studio.events-add-and-remove-target`,
// `studio.events-delete-rule-with-targets`.
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EventsSeeded`); a rule on
// `default` carries the prefix and the bus itself is not changed. What the emulator holds afterwards is read
// directly. Words, direct calls and readers: `services/events/events.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { appeared, checkPrefix, watchText } from './support/service-screens';
import {
  ADD_TARGET,
  addTargetDialog,
  answered,
  answeredBySqs,
  busPath,
  busScreen,
  chooseBus,
  chooseListed,
  chooseOption,
  confirmWith,
  CREATE_RULE,
  CREATE_RULE_PATH,
  createRuleScreen,
  DELETE_RULE,
  dialogContent,
  dialogOf,
  DISABLE,
  ENABLE,
  EventsSeeded,
  eventually,
  expectAlert,
  expectBusChosen,
  expectFlash,
  expectTargetIds,
  fieldError,
  flashItems,
  open,
  refusalDirect,
  REMOVE,
  RULE_NOT_FOUND,
  ruleAndTargetsRemoved,
  ruleCreated,
  ruleDeleted,
  ruleDirect,
  ruleNameTaken,
  rulePath,
  RULES,
  RULES_PATH,
  ruleScreen,
  selectOf,
  rulesDirect,
  rulesNamedDirect,
  ruleSwitched,
  TARGET_ID_HELD,
  targetAdded,
  targetRemoved,
  targetsDirect,
  textOf,
  topicReported,
  withBus,
  writeRefused,
} from './services/events/events';

test('studio.events-create-rule-with-targets', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-make');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-make`)).Name;
  const queue = await seeded.queue(`${p}-q`);
  const fifo = await seeded.queue(`${p}-f.fifo`);
  const topic = await seeded.topic(`${p}-t`);
  const group = await seeded.logGroup(`/aws/events/${p}-g`);
  const pattern = '{"source":["shop"]}';

  await lines.line(
    'On Create rule, opened from the bus\'s page, enter the name `to-all`, the pattern `{"source":["shop"]}`, and four targets, each chosen from the emulator\'s list of its kind: `q` the queue, `f` the FIFO queue with the message group ID `g-1`, `t` the topic with the constant `{"k":1}`, `g` the log group with the path `$.detail`; create → the rule\'s page opens with "Rule to-all created." and lists the four',
    async () => {
      const s = createRuleScreen(page);
      await open(page, busPath(bus), bus);
      await busScreen(page).link(CREATE_RULE).click(ACTION);
      await expect(page, 'the address of Create rule with the bus').toHaveURL(addressOf(withBus(CREATE_RULE_PATH, bus)), {
        timeout: 15_000,
      });
      await expect(heading(page, CREATE_RULE), 'the h1 "Create rule"').toBeVisible();
      await expectBusChosen(page, bus);
      await s.name.fill('to-all', ACTION);
      await s.pattern.fill(pattern, ACTION);

      // Target 1: the queue, receiving the matched event.
      await s.addTarget.click(ACTION);
      await textOf(s.targetField('Target ID', 1)).fill('q', ACTION);
      await chooseOption(s.targetField('Target kind', 1), 'sqs');
      await answeredBySqs(page, 'GetQueueAttributes', () => chooseListed(s.targetField('Queue', 1), queue.url));

      // Target 2: the FIFO queue, with its message group ID.
      await s.addTarget.click(ACTION);
      await textOf(s.targetField('Target ID', 2)).fill('f', ACTION);
      await chooseOption(s.targetField('Target kind', 2), 'sqs');
      await answeredBySqs(page, 'GetQueueAttributes', () => chooseListed(s.targetField('Queue', 2), fifo.url));
      await textOf(s.targetField('Message group ID', 1)).fill('g-1', ACTION);

      // Target 3: the topic, receiving a constant.
      await s.addTarget.click(ACTION);
      await textOf(s.targetField('Target ID', 3)).fill('t', ACTION);
      await chooseOption(s.targetField('Target kind', 3), 'sns');
      await chooseListed(s.targetField('Topic', 1), topic);
      await chooseOption(s.targetField('What the target receives', 3), 'constant');
      await textOf(s.targetField('JSON text', 1)).fill('{"k":1}', ACTION);

      // Target 4: the log group, receiving a part of the event.
      await s.addTarget.click(ACTION);
      await textOf(s.targetField('Target ID', 4)).fill('g', ACTION);
      await chooseOption(s.targetField('Target kind', 4), 'logs');
      await chooseListed(s.targetField('Log group', 1), group);
      await chooseOption(s.targetField('What the target receives', 4), 'path');
      await textOf(s.targetField('JSON path', 1)).fill('$.detail', ACTION);

      await s.submit.click(ACTION);
      await expect(page, "the rule's page, at its address").toHaveURL(addressOf(rulePath(bus, 'to-all')), {
        timeout: 30_000,
      });
      await expect(heading(page, 'to-all'), 'the h1 "to-all"').toBeVisible();
      await expectFlash(page, 'success', ruleCreated('to-all'));
      await expectTargetIds(page, ['f', 'g', 'q', 't']);
    },
  );

  await lines.line(
    'The emulator reports the rule on `<p>-make`, enabled, with that pattern, and its targets with the ARNs the emulator gives for the queue, the FIFO queue, the topic and the log group (the form without `:*`), `f` with the message group ID `g-1`, `t` with the constant, `g` with the path',
    async () => {
      const rule = await ruleDirect(ctx, port, bus, 'to-all');
      expect(
        { bus: rule.EventBusName, state: rule.State, pattern: rule.EventPattern },
        'the rule, directly',
      ).toEqual({ bus, state: 'ENABLED', pattern });
      expect(group, 'the log group ARN the emulator gives, without `:*`').not.toMatch(/:\*$/);
      expect(
        (await targetsDirect(ctx, port, bus, 'to-all')).map((target) => ({
          id: target.Id,
          arn: target.Arn,
          group: target.SqsParameters?.MessageGroupId ?? null,
          input: target.Input ?? null,
          path: target.InputPath ?? null,
        })),
        'the targets, directly',
      ).toEqual([
        { id: 'f', arn: fifo.arn, group: 'g-1', input: null, path: null },
        { id: 'g', arn: group, group: null, input: null, path: '$.detail' },
        { id: 'q', arn: queue.arn, group: null, input: null, path: null },
        { id: 't', arn: topic, group: null, input: '{"k":1}', path: null },
      ]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-create-rule-existing-name-is-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-kept');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-kept`)).Name;
  const queue = await seeded.queue(`${p}-q`);
  await seeded.rule(bus, 'mine', { pattern: '{"source":["a"]}', description: 'Kept' });
  await seeded.targets(bus, 'mine', [{ Id: 'one', Arn: queue.arn }]);

  await lines.line(
    'Create a rule named `mine` on that bus with the pattern `{"source":["b"]}` → the name\'s field says a rule of that name already exists on the bus, and the form stays with what was entered; the emulator still reports the rule with the pattern of `a`, its description and its target',
    async () => {
      const s = createRuleScreen(page);
      await open(page, withBus(CREATE_RULE_PATH, bus), CREATE_RULE);
      await expectBusChosen(page, bus);
      await s.name.fill('mine', ACTION);
      await s.pattern.fill('{"source":["b"]}', ACTION);
      await answered(page, 'DescribeRule', () => s.submit.click(ACTION));

      await expect(fieldError(s.nameField), "what the name's field says").toHaveText(ruleNameTaken('mine', bus), {
        timeout: 15_000,
      });
      await expect(page, 'the form stays').toHaveURL(addressOf(withBus(CREATE_RULE_PATH, bus)));
      await expect(s.name, 'the name entered').toHaveValue('mine');
      await expect(s.pattern, 'the pattern entered').toHaveValue('{"source":["b"]}');
      await expect(flashItems(page, 'success'), 'no flash says the rule was created').toHaveCount(0);

      const rule = await ruleDirect(ctx, port, bus, 'mine');
      expect(
        { pattern: rule.EventPattern, description: rule.Description },
        'the rule, directly',
      ).toEqual({ pattern: '{"source":["a"]}', description: 'Kept' });
      expect(
        (await targetsDirect(ctx, port, bus, 'mine')).map((target) => ({ id: target.Id, arn: target.Arn })),
        'its target, directly',
      ).toEqual([{ id: 'one', arn: queue.arn }]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-create-rule-refused-pattern-leaves-no-rule', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-strict');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-strict`)).Name;
  const pattern = '{"source":"shop"}';

  await lines.line(
    'Create a rule named `bad` on that bus with the pattern `{"source":"shop"}` (a JSON object the form lets through and the emulator refuses) → the form stays with what was entered and shows `PutRule` and the emulator\'s reason; the emulator reports no rule on the bus',
    async () => {
      const reason = await refusalDirect(ctx, port, 'PutRule', {
        Name: 'bad',
        EventBusName: bus,
        State: 'ENABLED',
        EventPattern: pattern,
      });
      expect(await rulesDirect(ctx, port, bus), 'no rule on the bus before the form is sent, directly').toEqual([]);
      const s = createRuleScreen(page);
      await open(page, withBus(CREATE_RULE_PATH, bus), CREATE_RULE);
      await expectBusChosen(page, bus);
      await s.name.fill('bad', ACTION);
      await s.pattern.fill(pattern, ACTION);
      await answered(page, 'PutRule', () => s.submit.click(ACTION));

      await expectAlert(s.main, writeRefused('PutRule', reason));
      await expect(page, 'the form stays').toHaveURL(addressOf(withBus(CREATE_RULE_PATH, bus)));
      await expect(s.name, 'the name entered').toHaveValue('bad');
      await expect(s.pattern, 'the pattern entered').toHaveValue(pattern);
      await expect(s.submit, 'the form can be sent again').toBeEnabled();
      await expect(flashItems(page, 'success'), 'no flash says the rule was created').toHaveCount(0);
      expect(await rulesDirect(ctx, port, bus), 'the rules of the bus, directly').toEqual([]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-create-schedule-rule-on-default', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-sched');
  const seeded = new EventsSeeded(ctx, port, p);
  const other = (await seeded.bus(`${p}-other`)).Name;
  const name = `${p}-every5`;
  const s = createRuleScreen(page);

  await lines.line('On Create rule with `<p>-other` chosen → "Schedule" cannot be chosen', async () => {
    await open(page, withBus(CREATE_RULE_PATH, other), CREATE_RULE);
    await expectBusChosen(page, other);
    await expect(s.trigger('schedule'), 'the choice of a schedule is named "Schedule"').toHaveAccessibleName('Schedule');
    await expect(s.trigger('schedule'), '"Schedule" with a bus other than `default`').toBeDisabled();
    await expect(s.trigger('pattern'), 'the choice of an event pattern stays chosen').toBeChecked();
  });

  await lines.line(
    'Choose `default`, the name `<p>-every5`, "Schedule", a fixed rate of 5 minutes, "Disabled", and create → the rule\'s page shows "rate(5 minutes)" and "Disabled"; the emulator reports the rule on `default` with that expression, disabled',
    async () => {
      await open(page, withBus(CREATE_RULE_PATH, other), CREATE_RULE);
      await expectBusChosen(page, other);
      await chooseBus(page, 'default');
      await expectBusChosen(page, 'default');
      await s.name.fill(name, ACTION);
      await expect(s.trigger('schedule'), 'the choice of a schedule is named "Schedule"').toHaveAccessibleName('Schedule');
      await expect(s.trigger('schedule'), '"Schedule" with `default` chosen').toBeEnabled();
      await s.trigger('schedule').check(ACTION);
      await s.rate.fill('5', ACTION);
      await s.unit('minute').check(ACTION);
      await expect(s.state('DISABLED'), 'the choice of a disabled rule is named "Disabled"').toHaveAccessibleName('Disabled');
      await s.state('DISABLED').check(ACTION);
      await s.submit.click(ACTION);

      await expect(page, "the rule's page, at its address").toHaveURL(addressOf(rulePath('default', name)), {
        timeout: 20_000,
      });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      await expectPairs(page, { 'Schedule expression': 'rate(5 minutes)', State: 'Disabled' });

      const rule = await ruleDirect(ctx, port, 'default', name);
      expect(
        { bus: rule.EventBusName, schedule: rule.ScheduleExpression, state: rule.State },
        'the rule, directly',
      ).toEqual({ bus: 'default', schedule: 'rate(5 minutes)', state: 'DISABLED' });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-rule-switch-off-and-on', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-sw');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-sw`)).Name;
  await seeded.rule(bus, 'flip', { pattern: '{"source":["shop"]}' });
  const s = ruleScreen(page);
  const stateDirect = async () => (await ruleDirect(ctx, port, bus, 'flip')).State;

  await lines.line(
    'Press "Disable" → "Rule flip disabled." and the page says "Disabled"; the emulator reports it disabled',
    async () => {
      await open(page, rulePath(bus, 'flip'), 'flip');
      await expectPairs(page, { State: 'Enabled' });
      await expect(s.button(DISABLE), '"Disable" can be pressed').toBeEnabled({ timeout: 15_000 });
      await answered(page, 'DisableRule', () => s.button(DISABLE).click(ACTION));
      await expectFlash(page, 'success', ruleSwitched('flip', 'disabled'));
      await expectPairs(page, { State: 'Disabled' });
      expect(await stateDirect(), 'the state, directly').toBe('DISABLED');
    },
  );

  await lines.line('Press "Enable" → "Rule flip enabled."; the emulator reports it enabled', async () => {
    // The line starts from a disabled rule whatever the line before did.
    await eventsDisable();
    await open(page, rulePath(bus, 'flip'), 'flip');
    await expectPairs(page, { State: 'Disabled' });
    await expect(s.button(ENABLE), '"Enable" can be pressed').toBeEnabled({ timeout: 15_000 });
    await answered(page, 'EnableRule', () => s.button(ENABLE).click(ACTION));
    await expectFlash(page, 'success', ruleSwitched('flip', 'enabled'));
    await expectPairs(page, { State: 'Enabled' });
    expect(await stateDirect(), 'the state, directly').toBe('ENABLED');
  });

  /** Puts the rule in the state "disabled" outside, when it is not there already. */
  async function eventsDisable(): Promise<void> {
    if ((await stateDirect()) !== 'DISABLED') await seeded.rule(bus, 'flip', { pattern: '{"source":["shop"]}', disabled: true });
  }

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-add-and-remove-target', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-tg');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-tg`)).Name;
  const queue = await seeded.queue(`${p}-q`);
  const topic = await seeded.topic(`${p}-topic`);
  await seeded.rule(bus, 'grow', { pattern: '{"source":["shop"]}' });
  await seeded.targets(bus, 'grow', [{ Id: 'first', Arn: queue.arn }]);
  const s = ruleScreen(page);
  /** The targets, directly: each ID with its ARN and what it receives (`null` three times: the matched event). */
  const targets = async () =>
    (await targetsDirect(ctx, port, bus, 'grow')).map((target) => ({
      id: target.Id,
      arn: target.Arn,
      input: target.Input ?? null,
      path: target.InputPath ?? null,
      transformer: target.InputTransformer ?? null,
    }));
  const matched = { input: null, path: null, transformer: null };
  /** Opens "Add target" and enters a target `id` that is the topic, receiving the matched event. */
  const enterTopicTarget = async (id: string) => {
    const d = addTargetDialog(page);
    await expect(s.button(ADD_TARGET), '"Add target" can be pressed').toBeEnabled({ timeout: 15_000 });
    await s.button(ADD_TARGET).click(ACTION);
    await expect(d.dialog, 'the dialog').toBeVisible();
    await d.id.fill(id, ACTION);
    await chooseOption(d.kind, 'sns');
    await chooseListed(d.resource('Topic'), topic);
    await expect(selectOf(d.receives), 'the target receives the matched event').toHaveText('Matched event');
    return d;
  };

  await lines.line(
    'On the rule\'s page add a target `second`, the topic, receiving the matched event → "Target second added to grow."; the emulator reports `first` and `second`, `second` with the topic\'s ARN',
    async () => {
      await open(page, rulePath(bus, 'grow'), 'grow');
      await expectTargetIds(page, ['first']);
      const d = await enterTopicTarget('second');
      await answered(page, 'PutTargets', () => d.submit.click(ACTION));
      await expectFlash(page, 'success', targetAdded('second', 'grow'));
      await expect(d.dialog, 'the dialog after the target was added').toHaveCount(0);
      await expectTargetIds(page, ['first', 'second']);
      expect(await targets(), 'the targets with what each receives, directly').toEqual([
        { id: 'first', arn: queue.arn, ...matched },
        { id: 'second', arn: topic, ...matched },
      ]);
    },
  );

  await lines.line(
    "Add a target with the ID `first` → the dialog says the rule already holds that ID and stays; the emulator still reports `first` with the queue's ARN",
    async () => {
      await open(page, rulePath(bus, 'grow'), 'grow');
      await expect.poll(async () => (await targets()).map((t) => t.id), { message: '`first` is there, directly' }).toContain('first');
      const d = await enterTopicTarget('first');
      await answered(page, 'ListTargetsByRule', () => d.submit.click(ACTION));
      await expect(fieldError(d.idField), "what the ID's field says").toHaveText(TARGET_ID_HELD, { timeout: 15_000 });
      await expect(d.dialog, 'the dialog stays').toBeVisible();
      await expect(d.id, 'the ID entered').toHaveValue('first');
      expect((await targets()).filter((t) => t.id === 'first'), '`first`, directly').toEqual([
        { id: 'first', arn: queue.arn, ...matched },
      ]);
    },
  );

  await lines.line(
    'Remove `second` and confirm → "Target second removed from grow."; the emulator reports `first` alone and still reports the topic',
    async () => {
      // The line starts from a rule that holds `second` whatever the lines before did.
      await seeded.targets(bus, 'grow', [{ Id: 'second', Arn: topic }]);
      const dialog = dialogOf(page);
      await open(page, rulePath(bus, 'grow'), 'grow');
      await expectTargetIds(page, ['first', 'second']);
      await s.remove('second').click(ACTION);
      await expect(dialog, 'the dialog').toBeVisible();
      await answered(page, 'RemoveTargets', () => dialog.getByRole('button', { name: REMOVE, exact: true }).click(ACTION));
      await expectFlash(page, 'success', targetRemoved('second', 'grow'));
      await expect(dialog, 'the dialog after the removal').toHaveCount(0);
      await expectTargetIds(page, ['first']);
      expect(await targets(), 'the targets, directly').toEqual([{ id: 'first', arn: queue.arn, ...matched }]);
      expect(await topicReported(ctx, port, topic), 'the emulator still reports the topic').toBe(true);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-delete-rule-with-targets', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ek-del');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-del`)).Name;
  const queue = await seeded.queue(`${p}-q`);
  await seeded.rule(bus, 'away', { pattern: '{"source":["shop"]}' });
  await seeded.targets(bus, 'away', [
    { Id: 'one', Arn: queue.arn },
    { Id: 'two', Arn: queue.arn, Input: '{"k":1}' },
  ]);

  await lines.line(
    'On the rule\'s page press "Delete rule" → the dialog says the rule and its 2 targets are removed; type the rule\'s name and confirm → Rules opens with `<p>-del` chosen and "Rule away deleted.", and "Rule not found" is not shown on the way; the emulator reports no rule of that name on the bus',
    async () => {
      const s = ruleScreen(page);
      const dialog = dialogOf(page);
      await open(page, rulePath(bus, 'away'), 'away');
      await expectTargetIds(page, ['one', 'two']);
      await watchText(page, RULE_NOT_FOUND);
      await expect(s.button(DELETE_RULE), '"Delete rule" can be pressed').toBeEnabled({ timeout: 15_000 });
      await s.button(DELETE_RULE).click(ACTION);
      await expect(dialog, 'the dialog').toBeVisible();
      await expect(
        dialogContent(dialog).getByText(ruleAndTargetsRemoved(2), { exact: true }),
        'what the dialog says is removed',
      ).toBeVisible();
      await answered(page, 'DeleteRule', () => confirmWith(page, 'away', DELETE_RULE));

      await expect(page, 'Rules opens with the bus').toHaveURL(addressOf(withBus(RULES_PATH, bus)), { timeout: 15_000 });
      await expect(heading(page, RULES), 'the h1 "Rules"').toBeVisible();
      await expectBusChosen(page, bus);
      await expectFlash(page, 'success', ruleDeleted('away'));
      expect(await appeared(page, RULE_NOT_FOUND), '"Rule not found" was shown on the way').toBe(false);
      expect(
        await eventually(5_000, () => rulesNamedDirect(ctx, port, bus, 'away'), (rules) => rules.length === 0),
        'the rules of that name on the bus, directly',
      ).toEqual([]);
    },
  );

  lines.end();
});
