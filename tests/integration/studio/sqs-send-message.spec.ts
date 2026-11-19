// A queue's page, S2, its tab "Send message": a test message with its attributes, a delay, a FIFO message, and the
// form's refusals, in the built app in front of a real engine and emulator (test-criteria.md, issue 481: task 3).
//
// `studio.sqs-send-message-reaches-the-emulator`, `studio.sqs-send-fifo-message`.
//
// Each check names its queues with its own prefix `<p>` and deletes them when it ends (`SqsSeeded`). What the emulator
// holds afterwards is read directly (`countsDirect`, `receiveDirect` with a visibility of 0). Words, direct calls and
// readers: `services/sqs/sqs.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  countsDirect,
  expectFlash,
  expectValue,
  isOperation,
  open,
  queuePath,
  queueScreen,
  receiveDirect,
  SEND,
  sentTo,
  SqsSeeded,
  TAB_SEND,
} from './services/sqs/sqs';

const BODY = 'Body';
const DELAY = 'Delay';
const GROUP_ID = 'Group ID';
const DEDUPLICATION_ID = 'Deduplication ID';
const ADD_ATTRIBUTE = 'Add attribute';
const ENTER_A_BODY = 'Enter a body.';
const ENTER_BASE64 = 'Enter the value as Base64 text.';

/** The parts of the tab "Send message" a check acts on. */
function sendForm(page: Page) {
  const panel = page.getByRole('tabpanel');
  return {
    panel,
    body: panel.getByRole('textbox', { name: BODY }),
    delay: panel.getByRole('spinbutton', { name: DELAY }).or(panel.getByRole('textbox', { name: DELAY })),
    groupId: panel.getByRole('textbox', { name: GROUP_ID }),
    deduplicationId: panel.getByRole('textbox', { name: new RegExp(`^${DEDUPLICATION_ID}`) }),
    add: panel.getByRole('button', { name: ADD_ATTRIBUTE, exact: true }),
    name: (n: number) => panel.getByRole('textbox', { name: `Name of attribute ${String(n)}`, exact: true }),
    // Cloudscape names the select's trigger by the field, the column, its own label and the option shown.
    type: (n: number) => panel.getByRole('button', { name: new RegExp(`\\bType of attribute ${String(n)}( |$)`) }),
    value: (n: number) => panel.getByRole('textbox', { name: `Value of attribute ${String(n)}`, exact: true }),
    send: panel.getByRole('button', { name: SEND, exact: true }),
  };
}

/** Adds attribute row `n` (1-based) of `name`, `type` and `value` to the form. */
async function addAttribute(page: Page, n: number, name: string, type: 'String' | 'Number' | 'Binary', value: string) {
  const f = sendForm(page);
  await f.add.click(ACTION);
  await f.name(n).fill(name, ACTION);
  if (type !== 'String') {
    await f.type(n).click(ACTION);
    await page.getByRole('option', { name: type, exact: true }).click(ACTION);
    await expect(f.type(n), `attribute ${String(n)}'s type shows ${type}`).toContainText(type);
  }
  await f.value(n).fill(value, ACTION);
}

/** Presses "Send", waits for the engine's answer to the page's `SendMessage`, fails unless 200; its `MessageId`. */
async function sendFromPage(page: Page): Promise<string> {
  const answer = page.waitForResponse((r) => isOperation(r.request().headers(), 'SendMessage'), { timeout: 30_000 });
  await sendForm(page).send.click(ACTION);
  const response = await answer;
  expect(response.status(), 'the engine answered the page\'s SendMessage').toBe(200);
  const id = ((await response.json()) as { MessageId?: string }).MessageId;
  if (id === undefined) throw new Error('the page\'s SendMessage was answered without a MessageId');
  return id;
}

/** Counts the `SendMessage` requests the page sends from now on. */
function countSends(page: Page): { readonly count: number } {
  const counter = { count: 0 };
  page.on('request', (request) => {
    if (isOperation(request.headers(), 'SendMessage')) counter.count += 1;
  });
  return counter;
}

/** Every message the emulator holds in the queue, whatever its state. */
async function heldDirect(ctx: Parameters<typeof countsDirect>[0], port: number, url: string): Promise<number> {
  const c = await countsDirect(ctx, port, url);
  return c.available + c.inFlight + c.delayed;
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-send-message-reaches-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'send');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-q`);
  const s = queueScreen(page);
  const f = sendForm(page);
  const body = '{"orderId":42}\nsecond line';

  await lines.line(
    'Send a body with the attributes `kind` String `order`, `n` Number `7` and `b` Binary `aGk=` → "Message sent to {name}" with a message ID; a direct read returns that ID, the body exactly, and the three attributes with `b` as the bytes of `hi`; the form keeps its values',
    async () => {
      await open(page, queuePath(queue.name), queue.name);
      await s.tab(TAB_SEND).click(ACTION);
      await f.body.fill(body, ACTION);
      await addAttribute(page, 1, 'kind', 'String', 'order');
      await addAttribute(page, 2, 'n', 'Number', '7');
      await addAttribute(page, 3, 'b', 'Binary', 'aGk=');
      const id = await sendFromPage(page);
      await expectFlash(page, 'success', sentTo(queue.name), id);
      const direct = await receiveDirect(ctx, port, queue.url, 0);
      expect(direct.map((m) => [m.id, m.body]), 'a direct read').toEqual([[id, body]]);
      const attributes = direct[0]!.messageAttributes;
      expect(
        Object.entries(attributes)
          .map(([name, a]) => [name, a.DataType, a.StringValue ?? a.BinaryValue])
          .sort(),
        'the message attributes, directly',
      ).toEqual([
        ['b', 'Binary', 'aGk='],
        ['kind', 'String', 'order'],
        ['n', 'Number', '7'],
      ]);
      expect(Buffer.from(attributes.b!.BinaryValue!, 'base64').toString('utf8'), '`b` as bytes').toBe('hi');
      await expect(f.body, 'the body kept').toHaveValue(body);
      await expect(f.name(3), 'the attributes kept').toHaveValue('b');
      await expect(f.value(3), 'the attributes kept').toHaveValue('aGk=');
    },
  );

  await lines.line('Send it with a delay of 30 seconds → the page\'s Delayed is 1, as the emulator reports', async () => {
    await f.delay.fill('30', ACTION);
    const id = await sendFromPage(page);
    await expectFlash(page, 'success', sentTo(queue.name), id);
    await expectValue(page, 'Delayed', '1');
    expect((await countsDirect(ctx, port, queue.url)).delayed, 'delayed, directly').toBe(1);
  });

  await lines.line(
    'A Binary value that is not Base64, or a body left empty → the form says why and the emulator reports no new message',
    async () => {
      const before = await heldDirect(ctx, port, queue.url);
      const sends = countSends(page);
      await f.value(3).fill('not base64!', ACTION);
      await f.send.click(ACTION);
      await expect(f.panel.getByText(ENTER_BASE64, { exact: true }), 'the Binary value refused').toBeVisible();
      await f.value(3).fill('aGk=', ACTION);
      await f.body.fill('', ACTION);
      await f.send.click(ACTION);
      await expect(f.panel.getByText(ENTER_A_BODY, { exact: true }), 'the empty body refused').toBeVisible();
      expect(sends.count, 'SendMessage requests the page sent').toBe(0);
      expect(await heldDirect(ctx, port, queue.url), 'the messages the emulator holds, directly').toBe(before);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.sqs-send-fifo-message', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'send-fifo');
  const seeded = new SqsSeeded(ctx, port, p);
  const queue = await seeded.queue(`${p}-q.fifo`, { FifoQueue: 'true', ContentBasedDeduplication: 'false' });
  const s = queueScreen(page);
  const f = sendForm(page);

  await lines.line(
    'The form asks for Group ID and Deduplication ID and offers no Delay; send with group `g` and deduplication id `d` twice → both report "Message sent", and the emulator holds one message, of group `g`',
    async () => {
      await open(page, queuePath(queue.name), queue.name);
      await s.tab(TAB_SEND).click(ACTION);
      await expect(f.groupId, 'Group ID asked').toBeVisible();
      await expect(f.deduplicationId, 'Deduplication ID asked').toBeVisible();
      await expect(f.panel.getByText(DEDUPLICATION_ID, { exact: true }), 'Deduplication ID is not optional').toBeVisible();
      await expect(f.panel.getByText(DELAY, { exact: true }), 'no Delay').toHaveCount(0);
      await f.body.fill('once', ACTION);
      await f.groupId.fill('g', ACTION);
      await f.deduplicationId.fill('d', ACTION);
      for (const time of ['first', 'second']) {
        const id = await sendFromPage(page);
        await expectFlash(page, 'success', sentTo(queue.name), id).catch((e: unknown) => {
          throw new Error(`the ${time} send: ${(e as Error).message}`);
        });
      }
      const direct = await receiveDirect(ctx, port, queue.url, 0);
      expect(
        direct.map((m) => [m.body, m.attributes.MessageGroupId]),
        'what the emulator holds, directly',
      ).toEqual([['once', 'g']]);
      expect(await heldDirect(ctx, port, queue.url), 'the messages the emulator holds, directly').toBe(1);
    },
  );

  lines.end();
});
