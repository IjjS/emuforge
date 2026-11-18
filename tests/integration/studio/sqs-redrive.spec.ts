// A dead-letter queue's tab "Redrive" on S2: moving its messages back to their source queues or to another queue,
// the move tasks and their cancel, in the built app in front of a real engine and emulator (test-criteria.md, issue
// 481: task 5).
//
// `studio.sqs-redrive-dead-letters-back-to-their-source`, `studio.sqs-redrive-of-several-sources-asks-for-a-queue`,
// `studio.sqs-redrive-to-another-queue-and-cancel`.
//
// Each check names its queues with its own prefix `<p>` and deletes them when it ends (`SqsSeeded`). What the emulator
// holds afterwards is read directly (`countsDirect`, `moveTasksDirect`). Words, direct calls and readers:
// `services/sqs/sqs.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  answered,
  countsDirect,
  eventually,
  expectFlash,
  expectRows,
  moveBack,
  moveTasksDirect,
  moveTo,
  open,
  queuePath,
  queueScreen,
  readMessages,
  receiveDirect,
  redrivePolicy,
  SqsSeeded,
  TAB_MESSAGES,
  TAB_REDRIVE,
  TABLE,
} from './services/sqs/sqs';

const BACK = 'Back to their source queues';
const ANOTHER = 'Another queue';
const CHOOSE = 'Choose a queue';
const QUEUE_PREFIX = 'Queue name prefix';
const RATE = 'Messages per second - optional';
const START = 'Start';
const CANCEL = 'Cancel';
const SOURCE_QUEUES = 'Source queues';
const ALREADY_RUNNING = 'There is already a task running';
/** The disabled "Back to their source queues" item's description on a dead-letter queue of `n` sources. */
function severalSources(name: string, n: number): string {
  return `${name} is the dead-letter queue of ${String(n)} queues, so the emulator cannot tell each message's source queue. Choose the queue to move them to.`;
}

/** The parts of the tab "Redrive" a check acts on. */
function redriveTab(page: Page) {
  const panel = page.getByRole('tabpanel');
  return {
    panel,
    radio: (label: string) => panel.getByRole('radio', { name: label, exact: true }),
    choose: panel.getByRole('button', { name: new RegExp(CHOOSE) }),
    rate: panel.getByRole('textbox', { name: RATE }),
    start: panel.getByRole('button', { name: START, exact: true }),
    tasks: panel.locator(TABLE).first(),
    cancel: panel.getByRole('button', { name: CANCEL, exact: true }),
  };
}

/** Chooses `queue` in the "Another queue" select, filtering by its name. */
async function chooseQueue(page: Page, name: string): Promise<void> {
  await redriveTab(page).choose.click(ACTION);
  await page.getByRole('combobox', { name: QUEUE_PREFIX }).fill(name, ACTION);
  await page.getByRole('option', { name, exact: true }).click(ACTION);
}

/** Receives each message of `url` with a visibility of 0 until the dead-letter queue `dlqUrl` holds `count`. */
async function receivedIntoDlq(
  ctx: Parameters<typeof countsDirect>[0],
  port: number,
  urls: string[],
  dlqUrl: string,
  count: number,
): Promise<number> {
  return eventually(
    10_000,
    async () => {
      for (const url of urls) await receiveDirect(ctx, port, url, 0);
      return (await countsDirect(ctx, port, dlqUrl)).available;
    },
    (n) => n === count,
  );
}

/** A task row as shown: its status, destination and "moved of to move". */
function task(row: Record<string, string>): [string | undefined, string | undefined, string | undefined] {
  return [row.Status, row.Destination, row.Moved];
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-redrive-dead-letters-back-to-their-source', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'redrive-back');
  const seeded = new SqsSeeded(ctx, port, p);
  const { source, dlq } = await seeded.redrivePair(`${p}-src`, `${p}-dlq`, 1);
  await seeded.messages(source, 1, 'poison');
  const moved = await receivedIntoDlq(ctx, port, [source.url], dlq.url, 1);
  expect(moved, 'the message is in the dead-letter queue, directly').toBe(1);
  const s = queueScreen(page);
  const r = redriveTab(page);

  await lines.line(
    'The source\'s page has no "Redrive" tab; the dead-letter queue\'s page has one, and on "Messages" its read shows the message "From" the source',
    async () => {
      await open(page, queuePath(source.name), source.name);
      await expect(s.tab(TAB_MESSAGES), 'the source\'s tab "Messages"').toBeVisible();
      await expect(s.tab(TAB_REDRIVE), 'no "Redrive" on the source').toHaveCount(0);
      await open(page, queuePath(dlq.name), dlq.name);
      await expect(s.tab(TAB_REDRIVE), '"Redrive" on the dead-letter queue').toBeVisible();
      await readMessages(page);
      await expectRows(s.table, (row) => [row.Body, row.From], [['poison-01', source.name]], 'the read');
    },
  );

  await lines.line(
    '"Redrive" with "Back to their source queues" shows "Move the messages of {name} back to its source queues"; "Start" → the task is listed COMPLETED with 1 of 1 moved, and the emulator reports the message in the source and none in the dead-letter queue',
    async () => {
      await s.tab(TAB_REDRIVE).click(ACTION);
      await r.radio(BACK).check(ACTION);
      await expect(r.panel.getByText(moveBack(dlq.name), { exact: true })).toBeVisible();
      await answered(page, 'StartMessageMoveTask', () => r.start.click(ACTION));
      await expectFlash(page, 'success', 'Started');
      await expectRows(r.tasks, task, [['COMPLETED', SOURCE_QUEUES, '1 of 1']], 'the move tasks', 20_000);
      const direct = await eventually(
        10_000,
        async () => [(await countsDirect(ctx, port, source.url)).available, (await countsDirect(ctx, port, dlq.url)).available],
        ([inSource, inDlq]) => inSource === 1 && inDlq === 0,
      );
      expect(direct, 'available in the source and in the dead-letter queue, directly').toEqual([1, 0]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-redrive-of-several-sources-asks-for-a-queue', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'redrive-several');
  const seeded = new SqsSeeded(ctx, port, p);
  const { source: first, dlq } = await seeded.redrivePair(`${p}-a`, `${p}-dlq`, 1);
  const second = await seeded.queue(`${p}-b`, { RedrivePolicy: redrivePolicy(dlq.arn, 1) });
  await seeded.messages(first, 1, 'from-a');
  await seeded.messages(second, 1, 'from-b');
  expect(await receivedIntoDlq(ctx, port, [first.url, second.url], dlq.url, 2), 'both in the dead-letter queue, directly').toBe(2);
  const s = queueScreen(page);
  const r = redriveTab(page);

  await lines.line(
    'Open the dead-letter queue\'s "Redrive" → "Back to their source queues" is disabled with "{name} is the dead-letter queue of 2 queues, …", and "Another queue" is chosen',
    async () => {
      await open(page, queuePath(dlq.name), dlq.name);
      await s.tab(TAB_REDRIVE).click(ACTION);
      await expect(r.radio(BACK), '"Back to their source queues" disabled').toBeDisabled();
      await expect(r.panel.getByText(severalSources(dlq.name, 2), { exact: true })).toBeVisible();
      await expect(r.radio(ANOTHER), '"Another queue" chosen').toBeChecked();
    },
  );

  await lines.line(
    'Choose the first source, "Start" → the task is listed COMPLETED with 2 of 2 moved, and the emulator reports both messages in the first source and none in the dead-letter queue',
    async () => {
      await chooseQueue(page, first.name);
      await expect(r.start, '"Start" once the queue\'s ARN is read').toBeEnabled({ timeout: 15_000 });
      await answered(page, 'StartMessageMoveTask', () => r.start.click(ACTION));
      await expectFlash(page, 'success', 'Started');
      await expectRows(r.tasks, task, [['COMPLETED', first.name, '2 of 2']], 'the move tasks', 20_000);
      const direct = await eventually(
        10_000,
        async () => [(await countsDirect(ctx, port, first.url)).available, (await countsDirect(ctx, port, dlq.url)).available],
        ([inFirst, inDlq]) => inFirst === 2 && inDlq === 0,
      );
      expect(direct, 'available in the first source and in the dead-letter queue, directly').toEqual([2, 0]);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-redrive-to-another-queue-and-cancel', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'redrive-other');
  const seeded = new SqsSeeded(ctx, port, p);
  const { dlq } = await seeded.redrivePair(`${p}-src`, `${p}-dlq`, 1);
  await seeded.messages(dlq, 8, 'dead');
  const third = await seeded.queue(`${p}-third`);
  const s = queueScreen(page);
  const r = redriveTab(page);

  await lines.line(
    '"Another queue" with the third queue, 1 message per second, "Start" → the task is listed RUNNING with the third queue as destination; "Start" again → an error with the emulator\'s message that a task is running',
    async () => {
      await open(page, queuePath(dlq.name), dlq.name);
      await s.tab(TAB_REDRIVE).click(ACTION);
      await r.radio(ANOTHER).check(ACTION);
      await chooseQueue(page, third.name);
      await expect(r.panel.getByText(moveTo(dlq.name, third.name), { exact: true })).toBeVisible();
      await r.rate.fill('1', ACTION);
      await expect(r.start, '"Start" once the queue\'s ARN is read').toBeEnabled({ timeout: 15_000 });
      await answered(page, 'StartMessageMoveTask', () => r.start.click(ACTION));
      await expectFlash(page, 'success', 'Started');
      await expectRows(r.tasks, (row) => [row.Status, row.Destination], [['RUNNING', third.name]], 'the move tasks');
      await answered(page, 'StartMessageMoveTask', () => r.start.click(ACTION));
      await expectFlash(page, 'error', ALREADY_RUNNING);
    },
  );

  await lines.line(
    '"Cancel" on the running task → it is listed CANCELLED; the emulator reports in the third queue as many messages as the task moved and the rest in the dead-letter queue',
    async () => {
      await answered(page, 'CancelMessageMoveTask', () => r.cancel.click(ACTION));
      await expectRows(r.tasks, (row) => [row.Status, row.Destination], [['CANCELLED', third.name]], 'the move tasks', 20_000);
      const [last] = await moveTasksDirect(ctx, port, dlq.arn);
      expect(last?.status, 'the task, directly').toBe('CANCELLED');
      const moved = last!.moved;
      expect(moved, 'the task moved fewer than all 8').toBeLessThan(8);
      await expectRows(r.tasks, (row) => row.Moved, [`${String(moved)} of 8`], 'the moved count shown, as the emulator reports');
      const counts = [(await countsDirect(ctx, port, third.url)).available, (await countsDirect(ctx, port, dlq.url)).available];
      expect(counts, 'available in the third queue and in the dead-letter queue, directly').toEqual([moved, 8 - moved]);
    },
  );

  lines.end();
});
