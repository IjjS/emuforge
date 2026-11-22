import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { expect, test, type Ctx } from './support';
import { getFunctionDirect } from './services/lambda/lambda';
import { submitDialog, success } from './services/lambda/lambda-releases';
import { action, addSource, chooseMapping, errorFlash, eventFixture, openSources, settledList } from './services/lambda/lambda-event-sources';

const directWait = { timeout: 30_000 };

test('studio.lambda-event-source-queue', async ({ ctx, page }) => {
  const f = await eventFixture(ctx, 'queue', 'esm-q');
  await openSources(page, f.fn.name);
  await addSource(page, f.arn);
  await settledList(page, f.fn.name, f.arn, 'Enabled');
  await expect.poll(() => f.mappings(f.fn.name), directWait).toEqual([
    expect.objectContaining({ FunctionArn: f.fn.arn, EventSourceArn: f.arn, State: 'Enabled' }),
  ]);
  const [{ UUID }] = await f.mappings(f.fn.name);
  await f.send();
  await settledList(page, f.fn.name, f.arn, 'Enabled', 'OK');
  await expect.poll(() => f.mappings(f.fn.name), directWait).toEqual([
    expect.objectContaining({ UUID, FunctionArn: f.fn.arn, EventSourceArn: f.arn, LastProcessingResult: 'OK' }),
  ]);
});

async function streamMapping(ctx: Ctx, page: Page, kind: 'dynamodb' | 'kinesis') {
  const f = await eventFixture(ctx, kind, 'esm-' + kind);
  await openSources(page, f.fn.name);
  await addSource(page, f.arn, true);
  await settledList(page, f.fn.name, f.arn, 'Enabled');
  await expect.poll(() => f.mappings(f.fn.name), directWait).toEqual([
    expect.objectContaining({ FunctionArn: f.fn.arn, EventSourceArn: f.arn, State: 'Enabled', StartingPosition: 'LATEST' }),
  ]);
}

test('studio.lambda-event-source-dynamodb', async ({ ctx, page }) => streamMapping(ctx, page, 'dynamodb'));
test('studio.lambda-event-source-kinesis', async ({ ctx, page }) => streamMapping(ctx, page, 'kinesis'));

test('studio.lambda-event-source-role-refused', async ({ ctx, page }) => {
  const f = await eventFixture(ctx, 'queue', 'esm-refused', false);
  await openSources(page, f.fn.name);
  await addSource(page, f.arn);
  await expect(errorFlash(page)).toContainText('InvalidParameterValueException');
  await expect(errorFlash(page)).toContainText('The function execution role does not have permissions to call ReceiveMessage on SQS');
  await expect(errorFlash(page)).toContainText('Check the function execution role’s permissions for this source.');
  expect(await f.mappings(f.fn.name)).toEqual([]);
});

test('studio.lambda-event-source-lifecycle', async ({ ctx, page }) => {
  const f = await eventFixture(ctx, 'queue', 'esm-life');
  const peer = await f.makeFunction('peer');
  const targetId = await f.connect(f.fn.name);
  const peerId = await f.connect(peer.name);
  const peerEnabled = () => expect.poll(() => f.mappings(peer.name), directWait).toEqual([
    expect.objectContaining({ UUID: peerId, FunctionArn: peer.arn, EventSourceArn: f.arn, State: 'Enabled' }),
  ]);
  await peerEnabled();
  await openSources(page, f.fn.name);
  await settledList(page, f.fn.name, f.arn, 'Enabled');
  await chooseMapping(page);
  for (const [label, state] of [['Disable', 'Disabled'], ['Enable', 'Enabled']]) {
    await action(page, label).click();
    await settledList(page, f.fn.name, f.arn, state);
    await expect.poll(() => f.mappings(f.fn.name), directWait).toEqual([
      expect.objectContaining({ UUID: targetId, FunctionArn: f.fn.arn, EventSourceArn: f.arn, State: state }),
    ]);
    await peerEnabled();
  }
  await action(page, 'Delete').click();
  await expect(page.locator(createWrapper().findModal().findContent().toSelector())).toContainText(f.arn);
  await submitDialog(page, 'Delete');
  await expect(success(page)).toContainText('Requested deletion');
  await settledList(page, f.fn.name, f.arn, 'absent');
  await expect.poll(() => f.mappings(f.fn.name), directWait).toEqual([]);
  await peerEnabled();
  expect(await f.queueArn()).toBe(f.arn);
  for (const name of [f.fn.name, peer.name]) expect((await getFunctionDirect(ctx, f.port, name)).found).toBe(true);
});
