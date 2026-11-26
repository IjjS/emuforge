// Searching a log group's events (S5), a class the emulator does not read, and putting events on a stream's page
// (S4), in the built app in front of a real engine and emulator (test-criteria.md, issue 71).
//
// `studio.logs-search-events-by-pattern-stream-and-time`, `studio.logs-other-class-refuses-reading-and-takes-puts`,
// `studio.logs-put-events-are-shown-first`.
//
// Each check names its log groups with its own prefix `<p>` and deletes every log group under it when it ends
// (`LogsSeeded`). What the emulator holds is read directly, and "the emulator's reason" is the message of a direct
// call it refuses the same way. Words, direct calls and readers: `services/logs/logs.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  answered,
  chooseOption,
  containers,
  eventsPut,
  eventually,
  expectFlash,
  expectMessages,
  expectResults,
  expectRows,
  groupPath,
  groupScreen,
  localDateAndTime,
  LOG_EVENTS,
  LOG_EVENTS_PATH,
  LogsSeeded,
  messagesDirect,
  NO_EVENTS,
  NO_NEWER,
  open,
  refusalDirect,
  rowsOf,
  search,
  searchScreen,
  selectOf,
  shownMessages,
  STANDARD_ONLY,
  stateText,
  streamDirect,
  streamPath,
  streamScreen,
  typeMasked,
  withGroup,
} from './services/logs/logs';

/** `page-001` for 1. */
const numbered = (stem: string, n: number) => `${stem}-${String(n).padStart(3, '0')}`;
const range = (stem: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => numbered(stem, from + i));

test('studio.logs-search-events-by-pattern-stream-and-time', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'le-find');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/find`);
  // A whole second, some minutes ago.
  const t = Math.floor((Date.now() - 5 * 60_000) / 1000) * 1000;
  await seeded.stream(group, 'web', [
    { timestamp: t, message: 'error one' },
    { timestamp: t + 1_000, message: 'ok two' },
    { timestamp: t + 2_000, message: 'error three' },
  ]);
  await seeded.stream(group, 'job', [{ timestamp: t + 1_000, message: 'error job' }]);
  const searchAddress = withGroup(LOG_EVENTS_PATH, group);

  await lines.line(
    'On the group\'s page press "Search log events" → Log events with `<p>/find` chosen; search with the pattern `error` → `error one`, `error job`, `error three` in time order, each with its stream',
    async () => {
      const s = searchScreen(page);
      await open(page, groupPath(group), group);
      await groupScreen(page).searchEvents.click(ACTION);
      await expect(page, 'the address of Log events with the group').toHaveURL(addressOf(searchAddress));
      await expect(heading(page, LOG_EVENTS), 'the h1 "Log events"').toBeVisible();
      await expect(selectOf(s.group), 'the group chosen').toContainText(group);
      await s.pattern.fill('error', ACTION);
      await search(page);
      await expectResults(
        page,
        [
          { stream: 'web', message: 'error one' },
          { stream: 'job', message: 'error job' },
          { stream: 'web', message: 'error three' },
        ],
        'the events that hold `error`, in time order, each with its stream',
      );
    },
  );

  await lines.line(
    "Choose the stream `web` and search → `error one` and `error three` only; the stream of a row leads to that stream's page",
    async () => {
      const s = searchScreen(page);
      await open(page, searchAddress, LOG_EVENTS);
      await s.pattern.fill('error', ACTION);
      await chooseOption(s.stream, 'web');
      await search(page);
      await expectResults(
        page,
        [
          { stream: 'web', message: 'error one' },
          { stream: 'web', message: 'error three' },
        ],
        'the events of `web` that hold `error`',
      );
      await s.streamLink('web').first().click(ACTION);
      await expect(page, "the stream's page").toHaveURL(addressOf(streamPath(group, 'web')));
      await expect(heading(page, 'web'), 'the h1 "web"').toBeVisible();
    },
  );

  await lines.line(
    'Clear the pattern and the stream, set the start to the time of `error one` and the end to the time of `ok two`, search → `error one`, `ok two` and `error job`, and not `error three`',
    async () => {
      const s = searchScreen(page);
      await open(page, searchAddress, LOG_EVENTS);
      await s.pattern.fill('error', ACTION);
      await chooseOption(s.stream, 'web');
      await s.pattern.fill('', ACTION);
      await chooseOption(s.stream, '');
      const start = localDateAndTime(t);
      const end = localDateAndTime(t + 1_000);
      await typeMasked(s.startDate, start.date);
      await typeMasked(s.startTime, start.time);
      await typeMasked(s.endDate, end.date);
      await typeMasked(s.endTime, end.time);
      await search(page);
      // `ok two` and `error job` share one time, so the order of those two is not the line's.
      await expect
        .poll(
          async () => {
            const [first, ...rest] = (await rowsOf(s.results)).map((r) => r.Message ?? '');
            return [first, ...rest.sort()];
          },
          { message: 'the events from the start to the end time, both included', timeout: 20_000 },
        )
        .toEqual(['error one', 'error job', 'ok two']);
    },
  );

  await lines.line(
    'With 120 further events `page-001` to `page-120` put outside into `web`, search with the pattern `page` → the first 100 in order; change the pattern in the form to `error` without searching and go to the next page → `page-101` to `page-120`',
    async () => {
      const s = searchScreen(page);
      await seeded.events(
        group,
        'web',
        range('page', 1, 120).map((message, i) => ({ timestamp: t + 10_000 + i, message })),
      );
      await open(page, searchAddress, LOG_EVENTS);
      await s.pattern.fill('page', ACTION);
      await search(page);
      await expectRows(s.results, (r) => r.Message, range('page', 1, 100), 'the first hundred, in order', 20_000);
      await s.pattern.fill('error', ACTION);
      await expect(s.pattern, 'the pattern in the form, not searched').toHaveValue('error');
      await answered(page, 'FilterLogEvents', () => s.next.click(ACTION));
      await expectRows(s.results, (r) => r.Message, range('page', 101, 120), 'the next page of the same search', 20_000);
    },
  );

  await lines.line(
    "Search with the pattern `{ $.a = }` → the emulator's reason for refusing it is shown in the place of the results, and the pattern and the group stay in the form",
    async () => {
      const s = searchScreen(page);
      const pattern = '{ $.a = }';
      const reason = await refusalDirect(ctx, port, 'FilterLogEvents', { logGroupName: group, filterPattern: pattern });
      await open(page, searchAddress, LOG_EVENTS);
      await s.pattern.fill(pattern, ACTION);
      await search(page);
      await expect(s.empty, "the emulator's reason, in the place of the results").toContainText(reason, {
        timeout: 15_000,
      });
      expect(await rowsOf(s.results), 'the rows beside the refusal').toEqual([]);
      await expect(s.pattern, 'the pattern stays').toHaveValue(pattern);
      await expect(selectOf(s.group), 'the group stays').toContainText(group);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-other-class-refuses-reading-and-takes-puts', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'le-cold');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/cold`, { logClass: 'INFREQUENT_ACCESS' });
  await seeded.stream(group, 's', [{ timestamp: Date.now(), message: 'stored' }]);

  await lines.line(
    'Open the stream → in the place of the events the screen says the emulator reads log events only in the Standard class, with the emulator\'s reason, and not "No log events"',
    async () => {
      const reason = await refusalDirect(ctx, port, 'GetLogEvents', { logGroupName: group, logStreamName: 's' });
      await open(page, streamPath(group, 's'), 's');
      await expect(stateText(page, STANDARD_ONLY), 'what the screen says of the class').toBeVisible({ timeout: 15_000 });
      await expect(containers(page), "the emulator's reason").toContainText(reason);
      await expect(stateText(page, NO_EVENTS), `"${NO_EVENTS}"`).toHaveCount(0);
    },
  );

  await lines.line(
    'Put one event from that page → "1 log event put to s."; the emulator\'s report of the stream shows a later last ingestion time than before',
    async () => {
      const s = streamScreen(page);
      const before = (await streamDirect(ctx, port, group, 's')).lastIngestionTime;
      expect(typeof before, 'the last ingestion time before, directly').toBe('number');
      await open(page, streamPath(group, 's'), 's');
      await expect(stateText(page, STANDARD_ONLY), 'what the screen says of the class').toBeVisible({ timeout: 15_000 });
      await s.put.click(ACTION);
      await expect(s.dialog, 'the dialog').toBeVisible();
      await s.message(1).fill('one more', ACTION);
      await answered(page, 'PutLogEvents', () => s.putInDialog.click(ACTION));
      await expectFlash(page, 'success', eventsPut(1, 's'));
      const after = await eventually(
        5_000,
        async () => (await streamDirect(ctx, port, group, 's')).lastIngestionTime ?? 0,
        (time) => time > (before ?? 0),
      );
      expect(after, 'the last ingestion time after the put, directly').toBeGreaterThan(before ?? 0);
    },
  );

  await lines.line("Search the group on Log events → the same refusal, with the emulator's reason", async () => {
    const s = searchScreen(page);
    const reason = await refusalDirect(ctx, port, 'FilterLogEvents', { logGroupName: group });
    await open(page, withGroup(LOG_EVENTS_PATH, group), LOG_EVENTS);
    await expect(selectOf(s.group), 'the group chosen').toContainText(group);
    await search(page);
    await expect(s.empty, 'what the screen says of the class, in the place of the results').toContainText(STANDARD_ONLY, {
      timeout: 15_000,
    });
    await expect(s.empty, "the emulator's reason").toContainText(reason);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-put-events-are-shown-first', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'le-put');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/put`);
  const now = Date.now();
  await seeded.stream(group, 's', [
    { timestamp: now - 5 * 60_000, message: 'before-1' },
    { timestamp: now - 4 * 60_000, message: 'before-2' },
    { timestamp: now + 3_600_000, message: 'ahead' },
  ]);
  const twoLines = 'second, line one\nsecond, line two';

  await lines.line(
    'Put the two messages `first` and a message of two lines → "2 log events put to s."; the events shown begin with those two, the second with its line break kept, then `ahead`; the emulator reports both in the stream',
    async () => {
      const s = streamScreen(page);
      await open(page, streamPath(group, 's'), 's');
      await expectMessages(page, ['before-1', 'before-2', 'ahead'], 'the events before the put');
      await s.put.click(ACTION);
      await expect(s.dialog, 'the dialog').toBeVisible();
      await s.message(1).fill('first', ACTION);
      await s.addMessage.click(ACTION);
      await s.message(2).fill(twoLines, ACTION);
      await answered(page, 'PutLogEvents', () => s.putInDialog.click(ACTION));
      await expectFlash(page, 'success', eventsPut(2, 's'));
      await expect(s.dialog, 'the dialog after the put').toHaveCount(0);
      await expectMessages(page, ['first', twoLines, 'ahead'], 'the two events put, then `ahead`');
      const direct = await messagesDirect(ctx, port, group, 's');
      expect(direct, 'the events of the stream, directly').toContain('first');
      expect(direct, 'the events of the stream, directly').toContain(twoLines);
    },
  );

  await lines.line(
    '"Load older events" → `before-1` and `before-2` are above them; "Load newer events" → "No newer events."; every one of the five events is shown once',
    async () => {
      // Goes on from the page as the put of the line before left it: the read from the time of the put.
      const s = streamScreen(page);
      const five = ['before-1', 'before-2', 'first', twoLines, 'ahead'];
      await expectMessages(page, ['first', twoLines, 'ahead'], 'the events as the put left them');
      await answered(page, 'GetLogEvents', () => s.older.click(ACTION));
      await expectMessages(page, five, 'the two earlier events above the two put');
      await answered(page, 'GetLogEvents', () => s.newer.click(ACTION));
      await expect(s.newerStatus, 'what the control says after a read that returned nothing').toHaveText(NO_NEWER);
      expect(await shownMessages(page), 'every one of the five events, once').toEqual(five);
    },
  );

  lines.end();
});
