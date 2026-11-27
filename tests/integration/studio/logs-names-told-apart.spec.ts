// Log streams whose names differ only by a repeated space, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 664).
//
// `studio.logs-streams-that-differ-by-spaces-are-told-apart`, `studio.logs-stream-choice-tells-names-apart`.
//
// Each check makes one log group under its own prefix `<p>` with the streams `<p> a b` and `<p> a  b` (two spaces),
// each holding one event that says which stream it is in, and deletes the group when it ends (`LogsSeeded`). The
// exact identity of the two-space name is `<p> a`, a backslash and `u0020` twice, `b` (`twoSpaceIdentity`). What the
// emulator holds is read directly. Words, direct calls and readers: `services/logs/logs.ts`.

import { expect, startStack, test } from './support';
import { crumbs } from './support/aws-area';
import { ACTION, addressOf, titleOf } from './support/frame';
import { Lines } from './support/lines';
import {
  checkPrefix,
  drawnText,
  headerHeading,
  modalDialog,
  offeredNow,
  rowReading,
  twoSpaceIdentity,
} from './support/service-screens';
import {
  answered,
  choiceOf,
  chooseOption,
  confirmWith,
  DELETE,
  DELETE_LOG_STREAM,
  dialogOf,
  eventually,
  expectMessages,
  expectRows,
  groupPath,
  groupScreen,
  LOG_EVENTS,
  LOG_EVENTS_PATH,
  LogsSeeded,
  open,
  rowsIn,
  search,
  searchScreen,
  selectOf,
  streamPath,
  streamsDirect,
} from './services/logs/logs';

const IN_ONE = 'written into the one-space stream';
const IN_TWO = 'written into the two-space stream';

test('studio.logs-streams-that-differ-by-spaces-are-told-apart', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ln-apart');
  const one = `${p} a b`;
  const two = `${p} a  b`;
  const identity = twoSpaceIdentity(p);
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/names`);
  const now = Date.now();
  await seeded.stream(group, one, [{ timestamp: now - 2_000, message: IN_ONE }]);
  await seeded.stream(group, two, [{ timestamp: now - 1_000, message: IN_TWO }]);
  const namesDirect = async () => (await streamsDirect(ctx, port, group)).map((s) => s.logStreamName).sort();
  /** Waits until the group's page lists two streams. */
  const listed = async () => {
    await open(page, groupPath(group), group);
    await expect(rowsIn(groupScreen(page).streamTable), 'the two streams listed').toHaveCount(2, { timeout: 15_000 });
  };
  // Column 1 is the selection control's, column 2 the stream's name.
  /** The row of the two-space stream: the one whose name reads with its two spaces, then the identity. */
  const rowOfTwo = async () => (await rowReading(groupScreen(page).streamTable, 2, `${two} (${identity})`)).row;

  await lines.line(
    "(regression) Open the group's page → a link and a selection control of each name, the two-space ones named by the identity; the two-space row reads the name with its two spaces, followed by the identity in brackets",
    async () => {
      await listed();
      // Each stream's row is found by the name it reads; its link and its selection control are that row's.
      const rowTwo = await rowOfTwo();
      await expect(rowTwo.getByRole('link', { name: identity, exact: true }), `the two-space row's link`).toHaveCount(1);
      await expect(rowTwo.getByRole('radio', { name: identity, exact: true }), `the two-space row's control`).toHaveCount(1);
      const rowOne = (await rowReading(groupScreen(page).streamTable, 2, one)).row;
      await expect(rowOne.getByRole('link', { name: one, exact: true }), `the one-space row's link`).toHaveCount(1);
      await expect(rowOne.getByRole('radio', { name: one, exact: true }), `the one-space row's control`).toHaveCount(1);
    },
  );

  await lines.line(
    "Follow the link named by the identity → the heading, the last crumb and the document's title are the identity, and the event shown is the two-space stream's",
    async () => {
      await listed();
      await (await rowOfTwo()).getByRole('link', { name: identity, exact: true }).click(ACTION);
      await expect(page, "the two-space stream's address").toHaveURL(addressOf(streamPath(group, two)));
      await expect(headerHeading(page), "the heading's accessible name").toHaveAccessibleName(identity, {
        timeout: 15_000,
      });
      await expectMessages(page, [IN_TWO], "the two-space stream's event, alone");
      expect((await crumbs(page)).at(-1), 'the last crumb').toBe(identity);
      expect(await page.title(), "the document's title").toBe(titleOf(identity));
    },
  );

  await lines.line(
    'Select the two-space stream, choose to delete it → the dialog is named "Delete log stream <identity>?"; type the name with its two spaces and confirm → the emulator holds the one-space stream and not the two-space one',
    async () => {
      const s = groupScreen(page);
      expect(await namesDirect(), 'the streams before the delete, directly').toEqual([one, two].sort());
      await listed();
      await (await rowOfTwo()).getByRole('radio', { name: identity, exact: true }).check(ACTION);
      await s.streams.getByRole('button', { name: DELETE_LOG_STREAM, exact: true }).click(ACTION);
      await expect(modalDialog(page), "the dialog's accessible name").toHaveAccessibleName(
        `${DELETE_LOG_STREAM} ${identity}?`,
      );
      await answered(page, 'DeleteLogStream', () => confirmWith(page, two, DELETE));
      await expect(dialogOf(page), 'the dialog after the delete').toHaveCount(0);
      expect(
        await eventually(5_000, namesDirect, (names) => !names.includes(two)),
        'the streams after the delete, directly',
      ).toEqual([one]);
    },
  );

  lines.end();
});

test('studio.logs-stream-choice-tells-names-apart', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ln-choice');
  const one = `${p} a b`;
  const two = `${p} a  b`;
  const identity = twoSpaceIdentity(p);
  const seeded = new LogsSeeded(ctx, port, p);
  const group = await seeded.group(`${p}/choice`);
  const t = Math.floor((Date.now() - 5 * 60_000) / 1000) * 1000;
  await seeded.stream(group, one, [{ timestamp: t, message: IN_ONE }]);
  await seeded.stream(group, two, [{ timestamp: t + 1_000, message: IN_TWO }]);
  /** Opens Log events, chooses the check's group and opens "Log stream" with both options offered. */
  const opened = async () => {
    const s = searchScreen(page);
    await open(page, LOG_EVENTS_PATH, LOG_EVENTS);
    await chooseOption(s.group, group, p);
    const choice = choiceOf(s.stream);
    await choice.trigger.click(ACTION);
    await expect(choice.option(one), 'the option of the one-space value').toBeVisible({ timeout: 20_000 });
    await expect(choice.option(two), 'the option of the two-space value').toBeVisible({ timeout: 20_000 });
    return choice;
  };

  await lines.line(
    '(regression) On Log events, choose the group and open "Log stream" → the options of both values are offered, the two-space one labelled by its identity, the one-space one by its name',
    async () => {
      const choice = await opened();
      expect(await drawnText(choice.option(two)), 'the label of the option of the two-space value').toBe(identity);
      expect(await drawnText(choice.option(one)), 'the label of the option of the one-space value').toBe(one);
    },
  );

  await lines.line(
    "Type the two-space name into the field's filter → the option of the one-space value is no longer offered, and the option of the two-space value is, showing only its identity; choose it → the closed field shows the identity; press Search → the events listed hold the two-space stream's message and not the one-space stream's",
    async () => {
      const choice = await opened();
      await choice.filter.fill(two, ACTION);
      // The list as it stands once it has read for the filter: of the two values, the two-space one alone.
      const filtered = { reading: false, offered: [two] };
      await expect
        .poll(() => offeredNow(page, [one, two]), { message: 'the list after the filter', timeout: 20_000 })
        .toEqual(filtered);
      expect(await drawnText(choice.option(two)), 'what the option left shows').toBe(identity);
      expect(await offeredNow(page, [one, two]), 'the same list, after it was read').toEqual(filtered);
      await choice.option(two).click(ACTION);
      await expect(choice.list, 'the list after the choice').toHaveCount(0);
      expect(await drawnText(selectOf(searchScreen(page).stream)), 'what the closed field shows').toBe(identity);
      await search(page);
      await expectRows(
        searchScreen(page).results,
        (r) => r.Message,
        [IN_TWO],
        "the two-space stream's event, alone",
        20_000,
      );
    },
  );

  lines.end();
});
