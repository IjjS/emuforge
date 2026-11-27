// Send events (S7) and the bus an address names (S4, S7), in the built app in front of a real engine and emulator
// (test-criteria.md, issue 75).
//
// `studio.events-sent-event-reaches-a-matching-rules-queue`,
// `studio.events-bus-from-the-address-must-be-in-the-emulator`.
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EventsSeeded`). The queue
// is read directly. Words, direct calls and readers: `services/events/events.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  ADDRESS_NAMES_NO_BUS,
  answered,
  busDirect,
  busesNamedDirect,
  busField,
  busNotInEmulator,
  busPath,
  busScreen,
  chooseBus,
  eventAccepted,
  EventsSeeded,
  expectBusChosen,
  expectRules,
  fieldError,
  flashItems,
  open,
  receiveDirect,
  RULES,
  RULES_PATH,
  selectOf,
  SEND_EVENTS,
  SEND_EVENTS_PATH,
  sendScreen,
  shownEventIds,
  stateShown,
  tableTitled,
  withBus,
} from './services/events/events';

/** The bound of a delivery and of the window in which no delivery may come (test-criteria.md: fixed, 10 seconds). */
const DELIVERY_BOUND_MS = 10_000;

/** Fills the event of Send events. */
async function fillEvent(page: Page, source: string, detailType: string, detail: string): Promise<void> {
  const s = sendScreen(page);
  await s.source.fill(source, ACTION);
  await s.detailType.fill(detailType, ACTION);
  await s.detail.fill(detail, ACTION);
}

/** Waits until the bus field says `text` against the bus and the screen shows no event ID. */
async function expectBusRefused(page: Page, text: string): Promise<void> {
  await expect(fieldError(busField(page)), 'what the bus field says').toHaveText(text, { timeout: 15_000 });
  await expect(flashItems(page, 'success'), 'no flash says an event was accepted').toHaveCount(0);
  // "Event ID" as the acceptance writes it; the page's own description writes "event ID".
  await expect(page.getByRole('main').getByText(/Event ID/), 'no event ID in the page').toHaveCount(0);
}

test('studio.events-sent-event-reaches-a-matching-rules-queue', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'es-send');
  const seeded = new EventsSeeded(ctx, port, p);
  const bus = (await seeded.bus(`${p}-send`)).Name;
  const queue = await seeded.queue(`${p}-in`, { letsEventsIn: true });
  await seeded.rule(bus, 'match', { pattern: '{"source":["shop"]}' });
  await seeded.targets(bus, 'match', [{ Id: 'in', Arn: queue.arn }]);
  const s = sendScreen(page);
  let firstId: string | undefined;

  await lines.line(
    'On Send events, opened from the bus\'s page, enter the source `shop`, the detail type `order placed` and the detail `{"n":1}`, and send → the screen says the emulator accepted the event for `<p>-send` and shows an event ID; the form still holds what was entered',
    async () => {
      await open(page, busPath(bus), bus);
      await busScreen(page).link(SEND_EVENTS).click(ACTION);
      await expect(page, 'the address of Send events with the bus').toHaveURL(addressOf(withBus(SEND_EVENTS_PATH, bus)), {
        timeout: 15_000,
      });
      await expect(heading(page, SEND_EVENTS), 'the h1 "Send events"').toBeVisible();
      await expectBusChosen(page, bus);
      await fillEvent(page, 'shop', 'order placed', '{"n":1}');
      await answered(page, 'PutEvents', () => s.send.click(ACTION));

      await expect
        .poll(() => shownEventIds(page, bus), { message: `one event ID after "${eventAccepted(bus)}"`, timeout: 15_000 })
        .toHaveLength(1);
      [firstId] = await shownEventIds(page, bus);
      await expect(s.source, 'the source entered').toHaveValue('shop');
      await expect(s.detailType, 'the detail type entered').toHaveValue('order placed');
      await expect(s.detail, 'the detail entered').toHaveValue('{"n":1}');
      await expectBusChosen(page, bus);
    },
  );

  await lines.line(
    'The queue, read outside, receives one message within 10 seconds: the event with that ID, source, detail type and detail',
    async () => {
      if (firstId === undefined) throw new Error('the line before showed no event ID to look for');
      const bodies: string[] = [];
      const deadline = Date.now() + DELIVERY_BOUND_MS;
      while (bodies.length === 0 && Date.now() < deadline) bodies.push(...(await receiveDirect(ctx, port, queue.url)));
      expect(bodies.length, 'the messages the queue received within 10 seconds').toBe(1);
      const event = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(
        { id: event.id, source: event.source, detailType: event['detail-type'], detail: event.detail },
        'the event the queue received',
      ).toEqual({ id: firstId, source: 'shop', detailType: 'order placed', detail: { n: 1 } });
    },
  );

  await lines.line(
    'Change the source to `other` and send → another event ID is shown; the queue is then read outside, one bounded read after another, for 10 seconds counted from the moment the second event ID is visible on the screen (not from the send); every read of that window must answer, and the check fails the moment a read fails or returns a message holding the second event ID; it passes only when the window ended with at least one read answered and none of them holding that ID',
    async () => {
      if (firstId === undefined) throw new Error('the first line showed no event ID to tell the second from');
      const first = firstId;
      await open(page, withBus(SEND_EVENTS_PATH, bus), SEND_EVENTS);
      await expectBusChosen(page, bus);
      await fillEvent(page, 'other', 'order placed', '{"n":1}');
      await answered(page, 'PutEvents', () => s.send.click(ACTION));
      await expect
        .poll(async () => (await shownEventIds(page, bus)).filter((id) => id !== first), {
          message: 'another event ID is shown',
          timeout: 15_000,
        })
        .toHaveLength(1);
      // The window starts here: the second event ID is visible on the screen.
      const started = Date.now();
      const [secondId] = (await shownEventIds(page, bus)).filter((id) => id !== first);

      let reads = 0;
      while (Date.now() - started < DELIVERY_BOUND_MS) {
        // A read that fails throws, and the line fails with it.
        const bodies = await receiveDirect(ctx, port, queue.url);
        reads += 1;
        expect(
          bodies.filter((body) => body.includes(secondId)),
          `the messages of read ${String(reads)} that hold the second event ID`,
        ).toEqual([]);
      }
      expect(reads, 'the reads answered within the window').toBeGreaterThan(0);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.events-bus-from-the-address-must-be-in-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'es-addr');
  const seeded = new EventsSeeded(ctx, port, p);
  const real = await seeded.bus(`${p}-real`);
  await seeded.rule(real.Name, 'r1', { pattern: '{"source":["shop"]}' });
  const ghost = `${p}-ghost`;
  const rules = tableTitled(page, RULES);
  /** Waits until Rules says `text` against the address's bus, in the bus field and in the place of the rules. */
  const expectNoBus = async (text: string) => {
    await expect(fieldError(busField(page)), 'what the bus field says').toHaveText(text, { timeout: 15_000 });
    await expect(stateShown(page, text), 'the same text in the place of the rules').toBeVisible();
    await expect(rules, 'no rule is listed').toHaveCount(0);
  };

  await lines.line(
    'Open Rules with `?bus=<p>-ghost` → the bus field shows `<p>-ghost` with "Event bus `<p>-ghost` is not in your local emulator. Choose an event bus.", no rule is listed and `default` is not chosen; choose `<p>-real` → its rule `r1`',
    async () => {
      expect(await busesNamedDirect(ctx, port, ghost), 'no bus `<p>-ghost`, directly').toEqual([]);
      await open(page, withBus(RULES_PATH, ghost), RULES);
      await expectNoBus(busNotInEmulator(ghost));
      await expect(selectOf(busField(page)), 'the bus field shows the bus of the address, not `default`').toHaveText(ghost);
      await chooseBus(page, real.Name);
      await expectBusChosen(page, real.Name);
      await expectRules(rules, ['r1']);
    },
  );

  await lines.line(
    'Open Rules with the ARN of `<p>-real` as `?bus=` → the same error with that text and no rule; with an empty `?bus=` → "The address names no event bus. Choose an event bus."',
    async () => {
      expect((await busDirect(ctx, port, real.Name)).Arn, 'the ARN of `<p>-real`, directly').toBe(real.Arn);
      await open(page, withBus(RULES_PATH, real.Arn), RULES);
      await expectNoBus(busNotInEmulator(real.Arn));
      await open(page, withBus(RULES_PATH, ''), RULES);
      await expectNoBus(ADDRESS_NAMES_NO_BUS);
    },
  );

  await lines.line(
    'Open Send events with `?bus=<p>-ghost`, fill the event and send → the error at the bus field and no event ID is shown',
    async () => {
      await open(page, withBus(SEND_EVENTS_PATH, ghost), SEND_EVENTS);
      await expect(fieldError(busField(page)), 'what the bus field says before the send').toHaveText(busNotInEmulator(ghost), {
        timeout: 15_000,
      });
      await fillEvent(page, 'shop', 'order placed', '{"n":1}');
      await sendScreen(page).send.click(ACTION);
      await expectBusRefused(page, busNotInEmulator(ghost));
      expect(await busesNamedDirect(ctx, port, ghost), 'still no bus `<p>-ghost`, directly').toEqual([]);
    },
  );

  await lines.line(
    'Open Send events with `?bus=<p>-real`, fill the event, delete the bus outside (its rule first) and send → the bus field says the bus is not in the local emulator and no event ID is shown',
    async () => {
      await open(page, withBus(SEND_EVENTS_PATH, real.Name), SEND_EVENTS);
      await expectBusChosen(page, real.Name);
      await fillEvent(page, 'shop', 'order placed', '{"n":1}');
      await seeded.removeBus(real.Name);
      expect(await busesNamedDirect(ctx, port, real.Name), 'the bus is gone, directly').toEqual([]);
      await answered(page, 'DescribeEventBus', () => sendScreen(page).send.click(ACTION));
      await expectBusRefused(page, busNotInEmulator(real.Name));
    },
  );

  lines.end();
});
