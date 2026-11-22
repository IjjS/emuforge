import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Page } from '@playwright/test';
import { expect, startStack, type Ctx } from '../../support';
import { directDynamoDb, directIam, directSqs, type DirectAnswer } from '../../support/aws-clients-general';
import { checkPrefix } from '../../support/service-screens';
import { kinesisDirect, lambdaDirect, LambdaSeeded } from './lambda';
import { functionPath } from './lambda-list';
import { submitDialog } from './lambda-releases';

type SourceKind = 'queue' | 'dynamodb' | 'kinesis';
interface Mapping {
  UUID: string;
  FunctionArn: string;
  EventSourceArn: string;
  State: string;
  StartingPosition?: string;
  LastProcessingResult?: string;
}

function body(response: DirectAnswer, operation: string) {
  if ('error' in response) throw Error(operation + ': ' + response.error);
  if (response.status < 200 || response.status >= 300) throw Error(operation + ': ' + response.body);
  return response.body;
}

const readActions = {
  queue: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
  dynamodb: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams'],
  kinesis: ['kinesis:DescribeStream', 'kinesis:DescribeStreamSummary', 'kinesis:GetRecords', 'kinesis:GetShardIterator',
    'kinesis:ListShards', 'kinesis:ListStreams', 'kinesis:SubscribeToShard'],
};

export async function eventFixture(ctx: Ctx, kind: SourceKind, tag: string, grant = true) {
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = checkPrefix(ctx, tag);
  const seed = new LambdaSeeded(ctx, port, prefix);
  const sourceName = prefix + '-source';
  const sqs = async (action: string, input: object) =>
    JSON.parse(body(await directSqs(ctx, port, action, input), action) || '{}');
  const ddb = async (action: string, input: object) =>
    JSON.parse(body(await directDynamoDb(ctx, port, action, input), action) || '{}');
  const kinesis = async (action: string, input: object) =>
    JSON.parse(body(await kinesisDirect(ctx, port, action, input), action) || '{}');
  let arn: string;
  let queueUrl: string;
  if (kind === 'queue') {
    queueUrl = (await sqs('CreateQueue', { QueueName: sourceName })).QueueUrl;
    ctx.own({ async dispose() { await sqs('DeleteQueue', { QueueUrl: queueUrl }); } });
    arn = (await sqs('GetQueueAttributes', { QueueUrl: queueUrl, AttributeNames: ['QueueArn'] })).Attributes.QueueArn;
  } else if (kind === 'dynamodb') {
    await ddb('CreateTable', {
      TableName: sourceName, KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], BillingMode: 'PAY_PER_REQUEST',
      StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_IMAGE' },
    });
    ctx.own({ async dispose() { await ddb('DeleteTable', { TableName: sourceName }); } });
    arn = (await ddb('DescribeTable', { TableName: sourceName })).Table.LatestStreamArn;
  } else {
    await kinesis('CreateStream', { StreamName: sourceName, ShardCount: 1 });
    ctx.own({ async dispose() { await kinesis('DeleteStream', { StreamName: sourceName }); } });
    arn = (await kinesis('DescribeStreamSummary', { StreamName: sourceName })).StreamDescriptionSummary.StreamARN;
  }
  expect(arn).toBeTruthy();
  const roleName = prefix + '-role';
  const role = await seed.role(roleName);
  if (grant) {
    const policy = { RoleName: roleName, PolicyName: 'source' };
    const document = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: readActions[kind], Resource: '*' }] };
    body(await directIam(ctx, port, 'PutRolePolicy', { ...policy, PolicyDocument: JSON.stringify(document) }), 'PutRolePolicy');
    ctx.own({ async dispose() { body(await directIam(ctx, port, 'DeleteRolePolicy', policy), 'DeleteRolePolicy'); } });
  }

  async function mappings(name: string): Promise<Mapping[]> {
    // A fixture owns at most one mapping for each of its uniquely named functions.
    const answer = await lambdaDirect(ctx, port, 'GET', ['2015-03-31', 'event-source-mappings', ''], { FunctionName: name });
    return JSON.parse(body(answer, 'ListEventSourceMappings')).EventSourceMappings;
  }
  async function makeFunction(suffix: string) {
    const name = prefix + '-' + suffix;
    const fn = await seed.function(name, { role, runtime: 'python3.12' });
    ctx.own({ async dispose() {
      for (const row of await mappings(name)) {
        if (row.State !== 'Deleting') {
          body(await lambdaDirect(ctx, port, 'DELETE', ['2015-03-31', 'event-source-mappings', row.UUID]), 'DeleteEventSourceMapping');
        }
      }
      await expect.poll(() => mappings(name), { timeout: 20_000 }).toEqual([]);
    } });
    return { name, arn: fn.FunctionArn };
  }
  return {
    arn, port, fn: await makeFunction('function'), makeFunction, mappings,
    async connect(name: string): Promise<string> {
      const row = await lambdaDirect(ctx, port, 'POST', ['2015-03-31', 'event-source-mappings', ''], {}, {
        FunctionName: name, EventSourceArn: arn,
      });
      return JSON.parse(body(row, 'CreateEventSourceMapping')).UUID;
    },
    send: () => sqs('SendMessage', { QueueUrl: queueUrl, MessageBody: 'process this record' }),
    queueArn: async () => (await sqs('GetQueueAttributes', { QueueUrl: queueUrl, AttributeNames: ['QueueArn'] })).Attributes.QueueArn,
  };
}

const table = createWrapper('[role="tabpanel"]').findTable();
const modal = createWrapper().findModal();
const dialog = createWrapper(modal.toSelector());
export const action = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Event source mapping actions' }).getByRole('button', { name, exact: true });

export async function openSources(page: Page, name: string) {
  await page.goto(functionPath(name) + '?tab=event-sources');
  await expect(action(page, 'Refresh')).toBeEnabled();
}

export async function addSource(page: Page, arn: string, stream = false) {
  await action(page, 'Add event source').click();
  await page.locator(dialog.findInput().findNativeInput().toSelector()).fill(arn);
  if (stream) {
    const field = page.locator(dialog.findFormField().toSelector()).nth(1);
    await expect(field).toContainText('Starting position');
    await expect(field).toContainText('LATEST');
  }
  await submitDialog(page, 'Add event source');
  await expect(page.locator(modal.toSelector())).toBeHidden();
}

export async function settledList(page: Page, name: string, arn: string, state: string, result?: string) {
  await expect(async () => {
    const refresh = action(page, 'Refresh');
    const loading = page.locator(table.findLoadingText().toSelector());
    await expect(loading).toBeHidden();
    await expect(refresh).toBeEnabled();
    const [request] = await Promise.all([
      page.waitForRequest(request => {
        const url = new URL(request.url());
        return request.method() === 'GET' && url.pathname.replace(/\/$/, '').endsWith('/event-source-mappings') &&
          url.searchParams.get('FunctionName') === name;
      }, { timeout: 4000 }),
      refresh.click({ timeout: 4000 }),
    ]);
    const response = await request.response();
    if (!response?.ok()) throw Error('Mapping Refresh did not return the list');
    expect(await response.finished()).toBeNull();
    const list: { EventSourceMappings: Mapping[] } = await response.json();
    const observed = list.EventSourceMappings.find(row => row.EventSourceArn === arn);
    if (state === 'absent') expect(observed).toBeUndefined();
    else {
      expect(observed?.State).toBe(state);
      if (result !== undefined) expect(observed?.LastProcessingResult).toBe(result);
    }
    await expect(refresh).toBeEnabled();
    await expect(loading).toBeHidden();
    if (state === 'absent') {
      await expect(page.locator(table.findEmptySlot().toSelector())).toHaveText('No event sources', { timeout: 1000 });
    } else {
      const cell = (column: number) => page.locator(table.findBodyCell(1, column).toSelector());
      await expect(cell(2)).toContainText(arn, { timeout: 1000 });
      await expect(cell(3)).toHaveText(state, { timeout: 1000 });
      if (result) await expect(cell(4)).toHaveText(result, { timeout: 1000 });
    }
  }).toPass({ timeout: 30_000 });
}

export async function chooseMapping(page: Page) {
  await page.locator(table.findRowSelectionArea(1).toSelector()).click();
}

export const errorFlash = (page: Page) => page.locator(createWrapper().findFlashbar().findItemsByType('error').toSelector());
