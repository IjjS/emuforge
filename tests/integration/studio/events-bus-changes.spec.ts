// Creating an event bus (S2), changing its description and tags on its page (S3) and deleting it from the list (S1)
// and from its page, in the built app in front of a real engine and emulator (test-criteria.md, issue 75).
//
// `studio.events-create-bus-with-description-and-tags`, `studio.events-create-bus-existing-name-is-refused`,
// `studio.events-bus-description-and-tags-change`, `studio.events-delete-bus-from-the-list`,
// `studio.events-delete-bus-with-rules-is-refused`, `studio.events-delete-bus-from-its-page`.
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EventsSeeded`). What the
// emulator holds afterwards is read directly. Words, direct calls and readers: `services/events/events.ts`.

import { expect, startStack, test } from './support';
import { expectPairs } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { appeared, checkPrefix, watchText } from './support/service-screens';
import {
  answered,
  BUS_NOT_FOUND,
  busCreated,
  busDeleted,
  busDirect,
  busesNamedDirect,
  busList,
  busPath,
  busScreen,
  confirmWith,
  CREATE_EVENT_BUS,
  CREATE_EVENT_BUS_PATH,
  createBusScreen,
  DEFAULT_BUS_CANNOT_BE_DELETED,
  DELETE,
  descriptionSaved,
  dialogOf,
  EDIT_DESCRIPTION,
  EVENT_BUSES,
  EVENT_BUSES_PATH,
  EventsSeeded,
  eventually,
  expectAlert,
  expectBuses,
  expectEmpty,
  expectFlash,
  expectRows,
  expectUnavailable,
  filterBuses,
  finish,
  flashItems,
  MANAGE_TAGS,
  NO_BUSES_MATCH,
  open,
  refusalDirect,
  rowsOf,
  rulesDirect,
  SAVE,
  tagEditor,
  tagRow,
  tagsDirect,
  tagsSaved,
  writeRefused,
} from './services/events/events';

test('studio.events-create-bus-with-description-and-tags', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec-new');
  const seeded = new EventsSeeded(ctx, port, p);
  const name = `${p}-new.bus_1`;

  await lines.line(
    'On Create event bus enter that name, the description "Made in Studio" and the tag `team` = `core`, and create → the bus\'s page opens at its address with "Event bus `<p>-new.bus_1` created." and shows the ARN, the description and the tag; the emulator reports the bus with that description and the tag `team` = `core`',
    async () => {
      expect(await busesNamedDirect(ctx, port, name), 'no event bus of that name, directly').toEqual([]);
      const s = createBusScreen(page);
      await open(page, CREATE_EVENT_BUS_PATH, CREATE_EVENT_BUS);
      await s.name.fill(name, ACTION);
      await s.description.fill('Made in Studio', ACTION);
      await s.addTag.click(ACTION);
      await s.tagKey(1).fill('team', ACTION);
      await s.tagValue(1).fill('core', ACTION);
      await s.submit.click(ACTION);

      await expect(page, "the bus's page, at its address").toHaveURL(addressOf(busPath(name)), { timeout: 20_000 });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      await expectFlash(page, 'success', busCreated(name));
      const bus = await busDirect(ctx, port, name);
      await expectPairs(page, { ARN: bus.Arn, Description: 'Made in Studio' });
      await expectRows(
        busScreen(page).tags,
        (r) => ({ key: r.Key, value: r.Value }),
        [{ key: 'team', value: 'core' }],
        'the tags the page shows',
      );

      expect(
        (await busesNamedDirect(ctx, port, name)).map((each) => each.Description),
        'the event buses of that name with their description, directly',
      ).toEqual(['Made in Studio']);
      expect(await tagsDirect(ctx, port, bus.Arn), 'its tags, directly').toEqual({ team: 'core' });
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-create-bus-existing-name-is-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec-taken');
  const seeded = new EventsSeeded(ctx, port, p);
  const name = (await seeded.bus(`${p}-taken`, { description: 'First' })).Name;

  await lines.line(
    'Create a bus with that name and the description "Second" → the form stays with what was entered and shows `CreateEventBus` and the emulator\'s reason; the emulator still reports one bus of that name, described "First"',
    async () => {
      const reason = await refusalDirect(ctx, port, 'CreateEventBus', { Name: name, Description: 'Second' });
      const s = createBusScreen(page);
      await open(page, CREATE_EVENT_BUS_PATH, CREATE_EVENT_BUS);
      await s.name.fill(name, ACTION);
      await s.description.fill('Second', ACTION);
      await answered(page, 'CreateEventBus', () => s.submit.click(ACTION));

      await expectAlert(s.main, writeRefused('CreateEventBus', reason));
      await expect(flashItems(page, 'success'), 'no flash says the bus was created').toHaveCount(0);
      await expect(page, 'the form stays').toHaveURL(addressOf(CREATE_EVENT_BUS_PATH));
      await expect(s.name, 'the name entered').toHaveValue(name);
      await expect(s.description, 'the description entered').toHaveValue('Second');
      await expect(s.submit, 'the form can be sent again').toBeEnabled();

      expect(
        (await busesNamedDirect(ctx, port, name)).map((bus) => bus.Description),
        'the event buses of that name with their description, directly',
      ).toEqual(['First']);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-bus-description-and-tags-change', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec-set');
  const seeded = new EventsSeeded(ctx, port, p);
  const deadLetter = await seeded.queue(`${p}-dlq`);
  const bus = await seeded.bus(`${p}-set`, {
    description: 'Before',
    deadLetterArn: deadLetter.arn,
    tags: { a: '1', b: '2' },
  });
  const name = bus.Name;

  await lines.line(
    'Edit the description to "After" and save → "Description of `<p>-set` saved." and the page says "After"; the emulator reports the description "After" and the same dead-letter queue\'s ARN',
    async () => {
      expect(bus.DeadLetterConfig?.Arn, "the dead-letter queue's ARN before the change, directly").toBe(deadLetter.arn);
      const s = busScreen(page);
      const dialog = dialogOf(page);
      await open(page, busPath(name), name);
      await expectPairs(page, { Description: 'Before', 'Dead-letter queue ARN': deadLetter.arn });

      await s.button(EDIT_DESCRIPTION).click(ACTION);
      await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('After', ACTION);
      await answered(page, 'UpdateEventBus', () => dialog.getByRole('button', { name: SAVE, exact: true }).click(ACTION));
      await expectFlash(page, 'success', descriptionSaved(name));
      await expect(dialog, 'the dialog after the save').toHaveCount(0);
      await expectPairs(page, { Description: 'After', 'Dead-letter queue ARN': deadLetter.arn });

      const after = await busDirect(ctx, port, name);
      expect(
        { description: after.Description, deadLetter: after.DeadLetterConfig?.Arn },
        'the description and the dead-letter queue, directly',
      ).toEqual({ description: 'After', deadLetter: deadLetter.arn });
    },
  );

  await lines.line(
    'Manage tags: remove `a`, change `b` to `3`, add `c` with an empty value, save → "Tags of `<p>-set` saved."; the emulator reports exactly `b` = `3` and `c` = ``',
    async () => {
      const s = busScreen(page);
      const dialog = dialogOf(page);
      const editor = tagEditor(dialog);
      const byKey = (x: { key: string }, y: { key: string }) => (x.key < y.key ? -1 : 1);
      await open(page, busPath(name), name);
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
      await answered(page, 'TagResource', () => dialog.getByRole('button', { name: SAVE, exact: true }).click(ACTION));

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
      expect(await tagsDirect(ctx, port, bus.Arn), 'the tags, directly').toEqual({ b: '3', c: '' });
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-delete-bus-from-the-list', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec-gone');
  const seeded = new EventsSeeded(ctx, port, p);
  const name = (await seeded.bus(`${p}-gone`)).Name;

  await lines.line(
    'Select it on Event buses, press Delete, type its name and confirm → "Event bus `<p>-gone` deleted.", the row is gone; the emulator reports no bus of that name',
    async () => {
      const s = busList(page);
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, name);
      await expectBuses(page, [name]);
      await s.select(name);
      await s.del.click(ACTION);
      await answered(page, 'DeleteEventBus', () => confirmWith(page, name, DELETE));
      await expectFlash(page, 'success', busDeleted(name));
      await expectEmpty(s.table, NO_BUSES_MATCH);
      expect(
        await eventually(5_000, () => busesNamedDirect(ctx, port, name), (buses) => buses.length === 0),
        'the event buses of that name, directly',
      ).toEqual([]);
    },
  );

  await lines.line(
    'Select `default` → Delete cannot be pressed and says the default event bus cannot be deleted',
    async () => {
      const s = busList(page);
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, 'default');
      await expectBuses(page, ['default']);
      await s.select('default');
      await expectUnavailable(s.del, DEFAULT_BUS_CANNOT_BE_DELETED);
      await expect(dialogOf(page), 'no dialog is open').toHaveCount(0);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-delete-bus-with-rules-is-refused', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec-busy');
  const seeded = new EventsSeeded(ctx, port, p);
  const name = (await seeded.bus(`${p}-busy`)).Name;
  await seeded.rule(name, 'r1', { pattern: '{"source":["shop"]}' });

  await lines.line(
    "Select it, press Delete, type its name and confirm → the dialog stays open and shows `DeleteEventBus` and the emulator's reason; the emulator still reports the bus and its rule",
    async () => {
      const reason = await refusalDirect(ctx, port, 'DeleteEventBus', { Name: name });
      const s = busList(page);
      const dialog = dialogOf(page);
      await open(page, EVENT_BUSES_PATH, EVENT_BUSES);
      await filterBuses(page, name);
      await expectBuses(page, [name]);
      await s.select(name);
      await s.del.click(ACTION);
      await answered(page, 'DeleteEventBus', () => confirmWith(page, name, DELETE));
      await expectAlert(dialog, writeRefused('DeleteEventBus', reason));
      await expect(dialog, 'the dialog stays open').toBeVisible();
      await expect(flashItems(page, 'success'), 'no flash says the bus was deleted').toHaveCount(0);
      expect(
        (await busesNamedDirect(ctx, port, name)).map((bus) => bus.Name),
        'the event buses of that name, directly',
      ).toEqual([name]);
      expect((await rulesDirect(ctx, port, name)).map((rule) => rule.Name), 'its rules, directly').toEqual(['r1']);
    },
  );

  await finish(lines, seeded);
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-delete-bus-from-its-page', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec-leave');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = await seeded.bus(`${p}-leave`);
  const name = bus.Name;

  await lines.line(
    'Press Delete there, type its name and confirm → Event buses opens with "Event bus `<p>-leave` deleted." and "Event bus not found" is not shown on the way; the emulator reports no bus of that name',
    async () => {
      const s = busScreen(page);
      await open(page, busPath(name), name);
      await expectPairs(page, { ARN: bus.Arn });
      await watchText(page, BUS_NOT_FOUND);
      await s.button(DELETE).click(ACTION);
      await answered(page, 'DeleteEventBus', () => confirmWith(page, name, DELETE));
      await expect(page, 'Event buses opens').toHaveURL(addressOf(EVENT_BUSES_PATH), { timeout: 15_000 });
      await expect(heading(page, EVENT_BUSES), 'the h1 "Event buses"').toBeVisible();
      await expectFlash(page, 'success', busDeleted(name));
      expect(await appeared(page, BUS_NOT_FOUND), '"Event bus not found" was shown on the way').toBe(false);
      expect(
        await eventually(5_000, () => busesNamedDirect(ctx, port, name), (buses) => buses.length === 0),
        'the event buses of that name, directly',
      ).toEqual([]);
    },
  );

  await finish(lines, seeded);
});
