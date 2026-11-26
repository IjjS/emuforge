// A log group's streams (S3), a stream's events (S4), the streams entry (S6) and the stream changes, in the built
// app in front of a real engine and emulator (test-criteria.md, issue 71).
//
// `studio.logs-read-a-stream-older-and-newer`, `studio.logs-stream-names-open-by-their-address`,
// `studio.logs-missing-group-and-stream-are-not-found`, `studio.logs-streams-entry-lists-a-chosen-group`,
// `studio.logs-create-and-delete-stream`.
//
// Each check names its log groups with its own prefix `<p>` and deletes every log group under it when it ends
// (`LogsSeeded`). What the emulator holds is read directly. Words, direct calls and readers: `services/logs/logs.ts`.

import { expect, startStack, test } from './support';
import { navigationLink } from './support/aws-entries';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alerts,
  answered,
  CHOOSE_A_GROUP,
  chooseOption,
  confirmWith,
  CREATE_LOG_STREAM,
  dateText,
  DELETE,
  DELETE_LOG_STREAM,
  dialogOf,
  eventArea,
  eventually,
  expectEmpty,
  expectFlash,
  expectGroups,
  expectMessages,
  expectRows,
  expectStreams,
  field,
  filterGroups,
  filterStreams,
  GROUP_NOT_FOUND,
  groupList,
  groupPath,
  groupScreen,
  LISTED_BY_NAME,
  LOG_GROUPS,
  LOG_GROUPS_PATH,
  LOG_STREAMS,
  LOG_STREAMS_PATH,
  LogsSeeded,
  messagesDirect,
  NO_NEWER,
  NO_STREAMS,
  NO_STREAMS_MATCH,
  open,
  refusalDirect,
  rowsOf,
  searchDirect,
  shownMessages,
  rowsIn,
  stateText,
  STREAM_NOT_FOUND,
  streamCreated,
  streamDeleted,
  streamDirect,
  streamPath,
  streamScreen,
  streamsDirect,
  TABLE,
  withGroup,
} from './services/logs/logs';

/** `m-001` for 1. */
const numbered = (stem: string, n: number) => `${stem}-${String(n).padStart(3, '0')}`;
/** `m-<from>` to `m-<to>`, in order. */
const range = (stem: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => numbered(stem, from + i));

test('studio.logs-read-a-stream-older-and-newer', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ls-read');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/read`);
  const now = Date.now();
  await seeded.stream(group, 'old', [{ timestamp: now - 3_600_000, message: 'an hour ago' }]);
  await seeded.stream(
    group,
    'live',
    range('m', 1, 150).map((message, i) => ({ timestamp: now - 149 + i, message })),
  );

  await lines.line(
    'Open the group from Log groups → its streams list `live` before `old`, each with its last event time',
    async () => {
      const live = await streamDirect(ctx, port, group, 'live');
      const old = await streamDirect(ctx, port, group, 'old');
      expect(typeof live.lastEventTimestamp, "the last event time of `live`, directly").toBe('number');
      expect(typeof old.lastEventTimestamp, "the last event time of `old`, directly").toBe('number');

      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await filterGroups(page, p);
      await expectGroups(page, [group]);
      await groupList(page).link(group).click(ACTION);
      await expect(page, "the group's page").toHaveURL(addressOf(groupPath(group)));
      await expect(heading(page, group), `the h1 "${group}"`).toBeVisible();
      await expectRows(
        groupScreen(page).streamTable,
        (r) => ({ name: r['Log stream name'], last: r['Last event time'] }),
        [
          { name: 'live', last: dateText(live.lastEventTimestamp) },
          { name: 'old', last: dateText(old.lastEventTimestamp) },
        ],
        'the streams, the one written last first, each with its last event time',
      );

      // That order is also the order of the names. An event put outside into `old` makes it the stream written
      // last: the list, read again, turns round.
      const before = live.lastEventTimestamp ?? 0;
      await seeded.events(group, 'old', [{ timestamp: Math.max(Date.now(), before + 1), message: 'just now' }]);
      const later = await eventually(
        5_000,
        () => streamDirect(ctx, port, group, 'old'),
        (stream) => (stream.lastEventTimestamp ?? 0) > before,
      );
      expect(later.lastEventTimestamp, 'the last event time of `old` after the put, directly').toBeGreaterThan(before);
      await open(page, groupPath(group), group);
      await expectRows(
        groupScreen(page).streamTable,
        (r) => ({ name: r['Log stream name'], last: r['Last event time'] }),
        [
          { name: 'old', last: dateText(later.lastEventTimestamp) },
          { name: 'live', last: dateText(live.lastEventTimestamp) },
        ],
        '`old` first once it is the one written last, each with its last event time',
      );
    },
  );

  await lines.line(
    'Open `live` → the events `m-051` to `m-150` in that order; "Load older events" → `m-001` to `m-150`, each once and in order',
    async () => {
      const s = streamScreen(page);
      await open(page, groupPath(group), group);
      await groupScreen(page).streamLink('live').click(ACTION);
      await expect(page, "the stream's page").toHaveURL(addressOf(streamPath(group, 'live')));
      await expect(heading(page, 'live'), 'the h1 "live"').toBeVisible();
      await expectMessages(page, range('m', 51, 150), 'the newest hundred events, oldest first');
      await answered(page, 'GetLogEvents', () => s.older.click(ACTION));
      await expectMessages(page, range('m', 1, 150), 'every event once and in order after "Load older events"');
    },
  );

  await lines.line(
    'An event `m-151` is put outside; "Load newer events" → it is the last event shown, `m-150` not repeated; the same control again → "No newer events."',
    async () => {
      // The page of the line before stays open, with the older events loaded: the read of newer events goes on from
      // where the first read ended, whatever was read backwards since.
      const s = streamScreen(page);
      await expect(page, "the stream's page, still open").toHaveURL(addressOf(streamPath(group, 'live')));
      await expectMessages(page, range('m', 1, 150), 'every event once and in order before the put');
      await seeded.events(group, 'live', [{ timestamp: Math.max(Date.now(), now + 1), message: numbered('m', 151) }]);
      await answered(page, 'GetLogEvents', () => s.newer.click(ACTION));
      await expectMessages(page, range('m', 1, 151), '`m-001` to `m-151`, each once and in order: `m-151` last, `m-150` once');
      await expect(s.newerStatus, 'nothing said yet beside "Load newer events"').toHaveCount(0);
      await answered(page, 'GetLogEvents', () => s.newer.click(ACTION));
      await expect(s.newerStatus, 'what the control says after a read that returned nothing').toHaveText(NO_NEWER);
      expect(await shownMessages(page), 'the events after the second read').toEqual(range('m', 1, 151));
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-stream-names-open-by-their-address', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ls-names');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/names`);
  const names = ['.', '..', 'a/b#c?d%e f'];
  const now = Date.now();
  for (const [i, name] of names.entries()) {
    await seeded.stream(group, name, [{ timestamp: now - 1_000 + i, message: name }]);
  }

  await lines.line(
    "From the group's page follow each stream's name → that stream's page shows its name as title and its one event; reloading the page at that address shows the same",
    async () => {
      for (const name of names) {
        expect(await messagesDirect(ctx, port, group, name), `the events of the stream "${name}", directly`).toEqual([
          name,
        ]);
        await open(page, groupPath(group), group);
        await groupScreen(page).streamLink(name).click(ACTION);
        await expect(page, `the address of the stream "${name}"`).toHaveURL(addressOf(streamPath(group, name)));
        await expect(heading(page, name), `the title "${name}"`).toBeVisible();
        await expectMessages(page, [name], `the one event of the stream "${name}"`);

        await page.reload();
        await expect(page, `the address of the stream "${name}" after the reload`).toHaveURL(
          addressOf(streamPath(group, name)),
        );
        await expect(heading(page, name), `the title "${name}" after the reload`).toBeVisible();
        await expectMessages(page, [name], `the one event of the stream "${name}" after the reload`);
      }
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-missing-group-and-stream-are-not-found', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ls-missing');
  const seeded = new LogsSeeded(ctx, port, p);
  const here = await seeded.group(`${p}/here`);
  const nowhere = `${p}/nowhere`;

  await lines.line(
    'Open the address of the group `<p>/nowhere` → "Log group not found"; open `<p>/here` → "No log streams"',
    async () => {
      await page.goto(groupPath(nowhere));
      await expect(stateText(page, GROUP_NOT_FOUND), `"${GROUP_NOT_FOUND}" in the place of the group`).toBeVisible({
        timeout: 15_000,
      });
      await open(page, groupPath(here), here);
      await expectEmpty(groupScreen(page).streamTable, NO_STREAMS);
    },
  );

  await lines.line(
    'Open the address of the stream `none` of `<p>/here` → "Log stream not found"; of the stream `none` of `<p>/nowhere` → "Log group not found"',
    async () => {
      await page.goto(streamPath(here, 'none'));
      await expect(
        eventArea(page).getByText(STREAM_NOT_FOUND, { exact: true }),
        `"${STREAM_NOT_FOUND}" in the place of the events`,
      ).toBeVisible({
        timeout: 15_000,
      });
      await page.goto(streamPath(nowhere, 'none'));
      await expect(
        eventArea(page).getByText(GROUP_NOT_FOUND, { exact: true }),
        `"${GROUP_NOT_FOUND}" in the place of the events`,
      ).toBeVisible({
        timeout: 15_000,
      });
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-streams-entry-lists-a-chosen-group', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ls-pick');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/pick`);
  const now = Date.now();
  await seeded.stream(group, 'b-early', [{ timestamp: now - 3_600_000, message: 'early' }]);
  await seeded.stream(group, 'a-late', [{ timestamp: now, message: 'late' }]);
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();

  await lines.line(
    'Open Log streams from the navigation → "Choose a log group."; choose `<p>/pick` → `a-late` before `b-early` and the address holds the group; the screen offers neither "Create log stream" nor "Delete log stream"; the name `a-late` leads to that stream\'s page',
    async () => {
      await open(page, LOG_GROUPS_PATH, LOG_GROUPS);
      await navigationLink(page, LOG_STREAMS_PATH).click(ACTION);
      await expect(page, 'the address of Log streams').toHaveURL(addressOf(LOG_STREAMS_PATH));
      await expect(heading(page, LOG_STREAMS), 'the h1 "Log streams"').toBeVisible();
      await expect(main.getByText(CHOOSE_A_GROUP, { exact: true }), `"${CHOOSE_A_GROUP}"`).toBeVisible();

      await chooseOption(field(main, 'Log group'), group, group);
      await expectStreams(table, ['a-late', 'b-early']);
      await expect
        .poll(() => new URL(page.url()).searchParams.get('group'), { message: 'the group the address holds' })
        .toBe(group);
      expect(new URL(page.url()).pathname, 'the path of the address').toBe(LOG_STREAMS_PATH);
      await expect(page.getByRole('button', { name: CREATE_LOG_STREAM, exact: true }), '"Create log stream"').toHaveCount(0);
      await expect(page.getByRole('button', { name: DELETE_LOG_STREAM, exact: true }), '"Delete log stream"').toHaveCount(0);

      // That order is also the order of the names. An event put outside into `b-early` makes it the stream written
      // last: the list, read again, turns round, and stays so for the next line.
      await seeded.events(group, 'b-early', [{ timestamp: Math.max(Date.now(), now + 1), message: 'just now' }]);
      const later = await eventually(
        5_000,
        () => streamDirect(ctx, port, group, 'b-early'),
        (stream) => (stream.lastEventTimestamp ?? 0) > now,
      );
      expect(later.lastEventTimestamp, 'the last event time of `b-early` after the put, directly').toBeGreaterThan(now);
      await open(page, withGroup(LOG_STREAMS_PATH, group), LOG_STREAMS);
      await expectStreams(table, ['b-early', 'a-late']);

      await rowsIn(table).getByRole('link', { name: 'a-late', exact: true }).click(ACTION);
      await expect(page, "the stream's page").toHaveURL(addressOf(streamPath(group, 'a-late')));
      await expect(heading(page, 'a-late'), 'the h1 "a-late"').toBeVisible();
    },
  );

  await lines.line(
    'Filter the streams by the prefix `b` → only `b-early`, and the screen says streams are listed by name; filter by the prefix `z` → "No log streams match"',
    async () => {
      await open(page, withGroup(LOG_STREAMS_PATH, group), LOG_STREAMS);
      await expectStreams(table, ['b-early', 'a-late']);
      await filterStreams(page, table, 'b');
      await expectStreams(table, ['b-early']);
      await expect(main.getByText(LISTED_BY_NAME, { exact: true }), 'the screen says how a prefix lists').toBeVisible();
      await filterStreams(page, table, 'z');
      await expectEmpty(table, NO_STREAMS_MATCH);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.logs-create-and-delete-stream', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ls-change');
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/streams`);
  await seeded.stream(group, 'kept', [{ timestamp: Date.now(), message: 'findme' }]);
  const dialog = dialogOf(page);
  const namesDirect = async () => (await streamsDirect(ctx, port, group)).map((s) => s.logStreamName).sort();
  const namesShown = async () => (await rowsOf(groupScreen(page).streamTable)).map((r) => r['Log stream name'] ?? '').sort();
  const openCreate = async () => {
    await groupScreen(page).streams.getByRole('button', { name: CREATE_LOG_STREAM, exact: true }).click(ACTION);
    await expect(dialog, 'the dialog').toBeVisible();
  };

  await lines.line(
    'Create the log stream `made here` on the group\'s page → "Log stream made here created." and it is listed; the emulator reports the stream',
    async () => {
      await open(page, groupPath(group), group);
      await expectStreams(groupScreen(page).streamTable, ['kept']);
      await openCreate();
      await dialog.getByRole('textbox').fill('made here', ACTION);
      await answered(page, 'CreateLogStream', () =>
        dialog.getByRole('button', { name: CREATE_LOG_STREAM, exact: true }).click(ACTION),
      );
      await expectFlash(page, 'success', streamCreated('made here'));
      await expect(dialog, 'the dialog after the create').toHaveCount(0);
      await expect.poll(namesShown, { message: 'the streams listed', timeout: 15_000 }).toEqual(['kept', 'made here']);
      expect(await namesDirect(), 'the streams, directly').toEqual(['kept', 'made here']);
    },
  );

  await lines.line(
    'Create a log stream named `kept` → the dialog stays with the name and shows `CreateLogStream` and the emulator\'s reason; the emulator still reports one stream `kept`',
    async () => {
      const reason = await refusalDirect(ctx, port, 'CreateLogStream', { logGroupName: group, logStreamName: 'kept' });
      await open(page, groupPath(group), group);
      await expect.poll(namesShown, { message: 'the streams listed', timeout: 15_000 }).toContain('kept');
      await openCreate();
      await dialog.getByRole('textbox').fill('kept', ACTION);
      await answered(page, 'CreateLogStream', () =>
        dialog.getByRole('button', { name: CREATE_LOG_STREAM, exact: true }).click(ACTION),
      );
      await expect(alerts(dialog), 'the operation the dialog names').toContainText('CreateLogStream');
      await expect(alerts(dialog), "the emulator's reason").toContainText(reason);
      await expect(dialog.getByRole('textbox'), 'the name stays').toHaveValue('kept');
      expect(
        (await namesDirect()).filter((name) => name === 'kept'),
        'the streams named `kept`, directly',
      ).toEqual(['kept']);
    },
  );

  await lines.line(
    'Select `kept`, press "Delete log stream", type its name and confirm → "Log stream kept deleted." and it is not listed; the emulator reports no such stream, and a search of the group for `findme` returns nothing',
    async () => {
      const s = groupScreen(page);
      expect(await searchDirect(ctx, port, group, 'findme'), 'a search for `findme` before the delete, directly').toEqual([
        'findme',
      ]);
      await open(page, groupPath(group), group);
      await expect.poll(namesShown, { message: 'the streams listed', timeout: 15_000 }).toContain('kept');
      await s.streamRadio('kept').check(ACTION);
      await s.streams.getByRole('button', { name: DELETE_LOG_STREAM, exact: true }).click(ACTION);
      await answered(page, 'DeleteLogStream', () => confirmWith(page, 'kept', DELETE));
      await expectFlash(page, 'success', streamDeleted('kept'));
      await expect(dialog, 'the dialog after the delete').toHaveCount(0);
      // The list settled after the delete: `made here`, of the first line, is its only row.
      await expectStreams(s.streamTable, ['made here']);
      expect(
        await eventually(5_000, namesDirect, (names) => !names.includes('kept')),
        'the streams, directly',
      ).not.toContain('kept');
      expect(await searchDirect(ctx, port, group, 'findme'), 'a search for `findme`, directly').toEqual([]);
    },
  );

  lines.end();
});
