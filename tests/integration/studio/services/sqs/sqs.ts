// The emulator side and the words of SQS's screens (test-criteria.md, issue 481), for the `sqs-*.spec.ts` checks.
//
// - Direct calls: `directSqs` of `support/aws-clients-general.ts` (JSON 1.0 straight to the emulator, SigV4-signed with
//   the key it wrote for this run, TLS verified against its `ca.pem`), as S3's checks use it. An answer's error is
//   read from its JSON `__type`; a check that names the emulator's code compares what the screen shows with the
//   code constants below, never with a direct answer's, so no header beyond `directSqs`'s is needed (breakdown.md,
//   "The plan's own files").
// - A queue is named by the `QueueUrl` the emulator returned (`CreateQueue`, `GetQueueUrl`); no URL is built here.
//   An ARN is the queue's own `QueueArn`.
// - `SqsSeeded`: the queues a check makes, every one named under the check's prefix `<p>`. When the check ends it
//   deletes every queue of the emulator whose name starts with `<p>`, those Studio's actions touched included.
// - The screens' words (requirement.md, "EmuForge's own text"; design.md) and readers of what a screen shows.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { directSqs, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { waitFor } from '../../support/wait';

/** The emulator's code for a queue it does not hold, as the screen shows it. */
export const NON_EXISTENT_QUEUE = 'AWS.SimpleQueueService.NonExistentQueue';
/** The emulator's code for a second purge within 60 seconds. */
export const PURGE_IN_PROGRESS = 'AWS.SimpleQueueService.PurgeQueueInProgress';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** A direct answer, parsed: its status, its JSON body (`{}` when empty), and for a refusal its `__type`'s name. */
export interface Answer {
  status: number;
  json: Record<string, unknown>;
  type: string | null;
}

function parsed(answer: DirectAnswer, what: string): Answer {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  let json: Record<string, unknown> = {};
  if (answer.body.trim() !== '') {
    try {
      json = JSON.parse(answer.body) as Record<string, unknown>;
    } catch {
      json = { raw: answer.body };
    }
  }
  const type = typeof json.__type === 'string' ? (json.__type.split('#').at(-1) ?? null) : null;
  return { status: answer.status, json, type };
}

/** Sends `operation` with `input` straight to the emulator and logs its status. */
export async function sqs(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = parsed(await directSqs(ctx, port, operation, input), `direct ${operation}`);
  ctx.log(`direct ${operation}: status ${String(answer.status)}${answer.type ? ` ${answer.type}` : ''}`);
  return answer;
}

/** Sends `operation` and fails the check unless the emulator answered 200. */
export async function sqsOk(ctx: Ctx, port: number, operation: string, input: object = {}): Promise<Answer> {
  const answer = await sqs(ctx, port, operation, input);
  if (answer.status !== 200) {
    throw new Error(`direct ${operation} answered ${String(answer.status)} ${JSON.stringify(answer.json)}`);
  }
  return answer;
}

/** The name of a queue: the text after its URL's last `/`, or its ARN's last `:`. */
export function nameOf(urlOrArn: string): string {
  return urlOrArn.slice(Math.max(urlOrArn.lastIndexOf('/'), urlOrArn.lastIndexOf(':')) + 1);
}

/** `GetQueueUrl` of `name`; `null` when the emulator holds no queue of that name. */
export async function queueUrlDirect(ctx: Ctx, port: number, name: string): Promise<string | null> {
  const answer = await sqs(ctx, port, 'GetQueueUrl', { QueueName: name });
  if (answer.status === 200) return answer.json.QueueUrl as string;
  if (answer.status === 400) return null;
  throw new Error(`direct GetQueueUrl ${name} answered ${String(answer.status)}`);
}

/** Every attribute of the queue at `url`, as the emulator gives them (strings). */
export async function attributesDirect(ctx: Ctx, port: number, url: string): Promise<Record<string, string>> {
  const answer = await sqsOk(ctx, port, 'GetQueueAttributes', { QueueUrl: url, AttributeNames: ['All'] });
  return (answer.json.Attributes ?? {}) as Record<string, string>;
}

/** The three message counts of the queue at `url`, directly. */
export async function countsDirect(
  ctx: Ctx,
  port: number,
  url: string,
): Promise<{ available: number; inFlight: number; delayed: number }> {
  const a = await attributesDirect(ctx, port, url);
  return {
    available: Number(a.ApproximateNumberOfMessages),
    inFlight: Number(a.ApproximateNumberOfMessagesNotVisible),
    delayed: Number(a.ApproximateNumberOfMessagesDelayed),
  };
}

/** The names of every queue whose name starts with `prefix`, directly, every page. */
export async function queueNamesDirect(ctx: Ctx, port: number, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const answer = await sqsOk(ctx, port, 'ListQueues', {
      QueueNamePrefix: prefix,
      MaxResults: 1000,
      ...(token === undefined ? {} : { NextToken: token }),
    });
    for (const url of (answer.json.QueueUrls ?? []) as string[]) names.push(nameOf(url));
    token = answer.json.NextToken as string | undefined;
  } while (token !== undefined);
  return names;
}

/** A message as a direct read returns it. */
export interface DirectMessage {
  id: string;
  body: string;
  receiptHandle: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, { DataType: string; StringValue?: string; BinaryValue?: string }>;
}

/**
 * `ReceiveMessage` of up to 10 messages with every attribute, with `visibility` seconds (the emulator's 0 leaves them
 * available). A receive raises each message's receive count, as a read of the screen does.
 */
export async function receiveDirect(
  ctx: Ctx,
  port: number,
  url: string,
  visibility: number,
  max = 10,
): Promise<DirectMessage[]> {
  const answer = await sqsOk(ctx, port, 'ReceiveMessage', {
    QueueUrl: url,
    MaxNumberOfMessages: max,
    VisibilityTimeout: visibility,
    MessageAttributeNames: ['All'],
    MessageSystemAttributeNames: ['All'],
  });
  return ((answer.json.Messages ?? []) as Record<string, unknown>[]).map((m) => ({
    id: m.MessageId as string,
    body: m.Body as string,
    receiptHandle: m.ReceiptHandle as string,
    attributes: (m.Attributes ?? {}) as Record<string, string>,
    messageAttributes: (m.MessageAttributes ?? {}) as DirectMessage['messageAttributes'],
  }));
}

/** `SendMessage` of `body` to `url`, with `extra` fields of the operation; returns its message id. */
export async function sendDirect(ctx: Ctx, port: number, url: string, body: string, extra: object = {}): Promise<string> {
  const answer = await sqsOk(ctx, port, 'SendMessage', { QueueUrl: url, MessageBody: body, ...extra });
  return answer.json.MessageId as string;
}

/** The move tasks of the dead-letter queue `arn`, newest first, as the emulator lists them. */
export async function moveTasksDirect(
  ctx: Ctx,
  port: number,
  arn: string,
): Promise<{ status: string; moved: number; toMove: number; destination: string | null }[]> {
  const answer = await sqsOk(ctx, port, 'ListMessageMoveTasks', { SourceArn: arn, MaxResults: 10 });
  return ((answer.json.Results ?? []) as Record<string, unknown>[]).map((t) => ({
    status: t.Status as string,
    moved: Number(t.ApproximateNumberOfMessagesMoved ?? 0),
    toMove: Number(t.ApproximateNumberOfMessagesToMove ?? 0),
    destination: (t.DestinationArn as string | undefined) ?? null,
  }));
}

/** A redrive policy naming the dead-letter queue `arn` after `maxReceiveCount` receives. */
export function redrivePolicy(arn: string, maxReceiveCount: number): string {
  return JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: String(maxReceiveCount) });
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** A queue a check made: its name, the URL the emulator returned and its own ARN. */
export interface MadeQueue {
  name: string;
  url: string;
  arn: string;
}

/** The queues a check makes under its prefix; every queue of that prefix is deleted when the check ends. */
export class SqsSeeded {
  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  /** `CreateQueue name` with `attributes`; its URL as returned and its `QueueArn`. */
  async queue(name: string, attributes: Record<string, string> = {}): Promise<MadeQueue> {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
    const made = await sqsOk(this.ctx, this.port, 'CreateQueue', { QueueName: name, Attributes: attributes });
    const url = made.json.QueueUrl as string;
    const arn = (await attributesDirect(this.ctx, this.port, url)).QueueArn;
    if (arn === undefined) throw new Error(`the emulator gave ${name} no QueueArn`);
    return { name, url, arn };
  }

  /** A dead-letter queue `dlq` and a source `source` whose redrive policy names it after `maxReceiveCount`. */
  async redrivePair(
    source: string,
    dlq: string,
    maxReceiveCount: number,
  ): Promise<{ source: MadeQueue; dlq: MadeQueue }> {
    const dead = await this.queue(dlq);
    const from = await this.queue(source, { RedrivePolicy: redrivePolicy(dead.arn, maxReceiveCount) });
    return { source: from, dlq: dead };
  }

  /** Sends `count` messages `<body>-01`… to `queue`, in order. */
  async messages(queue: MadeQueue, count: number, body = 'm'): Promise<void> {
    for (let i = 1; i <= count; i++) {
      await sendDirect(this.ctx, this.port, queue.url, `${body}-${String(i).padStart(2, '0')}`);
    }
  }

  /** Deletes every queue of the emulator under the check's prefix. */
  async dispose(): Promise<void> {
    let names: string[] = [];
    try {
      names = await queueNamesDirect(this.ctx, this.port, this.prefix);
    } catch (e) {
      this.ctx.log(`cleanup: the queues under ${this.prefix} could not be listed: ${(e as Error).message}`);
      return;
    }
    for (const name of names) {
      const url = await queueUrlDirect(this.ctx, this.port, name).catch(() => null);
      if (url !== null) await sqs(this.ctx, this.port, 'DeleteQueue', { QueueUrl: url }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens' words.
// ---------------------------------------------------------------------------------------------------------------

export const SQS_PATH = '/aws/sqs';
export const QUEUES_PATH = '/aws/sqs/queues';
/** S2's path for `name`, its name one segment below `queue/`. */
export function queuePath(name: string): string {
  return `${QUEUES_PATH}/queue/${encodeURIComponent(name)}`;
}

export const LIST_H1 = 'Queues';
export const NAVIGATION_HEADER = 'SQS';
export const SEARCH = 'Search by name prefix';
export const REFRESH = 'Refresh';
export const NO_QUEUES = 'No queues';
export const NO_QUEUES_TEXT =
  'This emulator holds no queues. Queues your app or any tool pointed at the emulator creates appear here. It starts empty each time it restarts.';
export const NO_MATCHES = 'No matches';
export const CLEAR_FILTER = 'Clear filter';
export const NEXT_PAGE = 'Next page';
/** "No queue name starts with “{text}”." */
export function noMatchText(text: string): string {
  return `No queue name starts with “${text}”.`;
}

export const TAB_MESSAGES = 'Messages';
export const TAB_SEND = 'Send message';
export const TAB_REDRIVE = 'Redrive';
export const READ = 'Read messages';
export const PURGE = 'Purge';
export const DELETE = 'Delete';
export const SEND = 'Send';
export const FORMAT_JSON = 'Format JSON';
export const NOT_FOUND = 'No queue named';

export const WARNING_FIRST = 'Reading counts as receiving: each message read here has its receive count raised by one.';
export const WARNING_STAYS = 'Messages read here stay in the queue.';
/** The redrive warning's sentence for a dead-letter queue `dlq` after `n` receives. */
export function warningMoves(n: number, dlq: string): string {
  return `Once a message has been received ${String(n)} times in this queue, the next read moves it to ${dlq} instead of showing it. A message moved back keeps the receive count shown here, and is moved again after ${String(n)} more reads.`;
}
export const EMPTY_READ =
  'No message is available to read. Messages in flight or delayed are not returned until they are visible again.';
/** On a queue with a redrive policy, a read that returned fewer than were available (pm decision 2026-11-19). */
export function movedByRead(n: number, dlq: string): string {
  return `Messages received ${String(n)} times in this queue were moved to ${dlq} by this read instead of being shown.`;
}
export const FIFO_FEWER =
  'Messages of a group your app has received and not yet deleted are not returned until they are visible again.';
/** "Showing the first {n} of {available} available messages. …" */
export function firstOf(shown: number, available: number): string {
  return `Showing the first ${String(shown)} of ${String(available)} available messages. A read returns the same first messages each time, at most 10.`;
}
export function sentTo(name: string): string {
  return `Message sent to ${name}`;
}
export function deletedFrom(n: number, name: string): string {
  return `Deleted ${String(n)} messages from ${name}`;
}
export function purged(name: string): string {
  return `Purged ${name}`;
}
/** The redrive form's description, word for word (requirement, "EmuForge's own text"). */
export function moveBack(name: string): string {
  return `Move the messages of ${name} back to its source queues`;
}
export function moveTo(name: string, destination: string): string {
  return `Move the messages of ${name} to ${destination}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A Cloudscape table, as a selector that also matches inside a scoped locator (no leading `body`). */
export const TABLE = wrapper.findTable().toSelector().replace(/^body /, '');
export const FLASH = wrapper.findFlashbar().toSelector();

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1), `the h1 "${h1}" at ${path}`).toBeVisible();
}

/**
 * The data rows of the table `table` as shown, each a record of its column headings' texts to its cells' texts (the
 * selection column has no heading and is left out). A row whose only cell spans the table (loading, empty, a failure)
 * is not a data row.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  return table.evaluate((root) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const element = root.querySelector('table');
    if (element === null) return [];
    const headers = [...element.querySelectorAll('thead tr:first-child > th')].map((th) => norm(th.textContent));
    const rows: Record<string, string>[] = [];
    for (const tr of element.querySelectorAll('tbody > tr')) {
      const cells = [...tr.querySelectorAll(':scope > td, :scope > th')];
      if (cells.length !== headers.length) continue;
      const row: Record<string, string> = {};
      cells.forEach((cell, i) => {
        const header = headers[i] ?? '';
        if (header !== '') row[header] = norm(cell.textContent);
      });
      rows.push(row);
    }
    return rows;
  });
}

/** Waits until the rows of `table`, mapped by `pick`, equal `want`. */
export async function expectRows<T>(
  table: Locator,
  pick: (row: Record<string, string>) => T,
  want: T[],
  what: string,
  timeout = 15_000,
): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(table)).map(pick), { message: what, timeout })
    .toEqual(want);
}

/** The text of the value of `label` in the key-value pairs inside `scope` (S2's details, a message's detail). */
export async function valueOf(scope: Locator, label: string): Promise<string | null> {
  return scope.evaluate((root, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    for (const dt of root.querySelectorAll('dt')) {
      if (norm(dt.textContent) !== wanted) continue;
      const dd = dt.nextElementSibling;
      return dd === null ? null : norm(dd.textContent);
    }
    return null;
  }, label);
}

/** Waits until the details' value of `label` reads `want`. */
export async function expectValue(page: Page, label: string, want: string, what?: string): Promise<void> {
  await expect
    .poll(() => valueOf(page.getByRole('main'), label), { message: what ?? `"${label}" reads "${want}"`, timeout: 15_000 })
    .toBe(want);
}

/** The flash items of type `type`, as one locator. */
export function flashItems(page: Page, type: 'success' | 'error' | 'info' | 'warning'): Locator {
  return page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
}

/** Waits for one flash item of `type` holding every text of `texts`. */
export async function expectFlash(page: Page, type: 'success' | 'error', ...texts: string[]): Promise<void> {
  let item = flashItems(page, type);
  for (const text of texts) item = item.filter({ hasText: text });
  await expect(item, `a ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`).toHaveCount(1, {
    timeout: 15_000,
  });
}

/** The parts of S2 a check acts on. */
export function queueScreen(page: Page) {
  const main = page.getByRole('main');
  const messages = page.getByRole('tabpanel');
  return {
    main,
    tab: (name: string) => page.getByRole('tab', { name, exact: true }),
    panel: messages,
    table: messages.locator(TABLE).first(),
    read: page.getByRole('button', { name: READ, exact: true }),
    del: messages.getByRole('button', { name: DELETE, exact: true }),
    purge: page.getByRole('button', { name: PURGE, exact: true }),
    refresh: page.getByRole('button', { name: REFRESH, exact: true }).first(),
    select: (id: string) => page.getByRole('checkbox', { name: `Select message ${id}`, exact: true }),
    messageLink: (id: string) => messages.getByRole('button', { name: id, exact: true }),
    dialog: page.getByRole('dialog'),
  };
}

/** Confirms the open dialog by typing `word` and choosing `action`. */
export async function confirmWith(page: Page, word: string, action: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog, 'the confirmation dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(word, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/** Whether a request the page sent to the engine is the SQS operation `operation`. */
export function isOperation(headers: Record<string, string>, operation: string): boolean {
  return headers['x-amz-target'] === `AmazonSQS.${operation}`;
}

/** Runs `act` and waits for the page's answer to its `operation`, then for the button `after` to be enabled. */
export async function answered(page: Page, operation: string, act: () => Promise<void>, after?: Locator): Promise<void> {
  const answer = page.waitForResponse((r) => isOperation(r.request().headers(), operation), { timeout: 30_000 });
  await act();
  await answer;
  if (after !== undefined) await expect(after, `enabled again after ${operation}`).toBeEnabled({ timeout: 15_000 });
}

/** Presses "Read messages" and waits for its `ReceiveMessage` to be answered and the button enabled again. */
export async function readMessages(page: Page): Promise<void> {
  const read = queueScreen(page).read;
  await answered(page, 'ReceiveMessage', () => read.click(ACTION), read);
}

/** Waits until a condition read directly holds, within `boundMs`; returns its last value. */
export async function eventually<T>(boundMs: number, read: () => Promise<T>, holds: (v: T) => boolean): Promise<T> {
  let last = await read();
  const found = await waitFor(boundMs, async () => {
    last = await read();
    return holds(last) ? last : undefined;
  });
  return found ?? last;
}
