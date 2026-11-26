// Clients of any service made by the factory's general function (`studio/src/lib/aws/client-factory.ts`) from a page at
// the built Studio's origin, through the engine started for that origin (test-criteria.md, issue 386, the two Flow
// sections; requirement R6.6, R6.7). Checks of no service: the page opens `/aws/kinesis`, the "no screen yet" page, as
// the checks of `aws-clients.spec.ts` do; its only engine requests are the AWS area's emulator line's, which
// `EngineRequests` leaves out of its counts. The general function runs bundled for the browser against Studio's
// installed SDK (`support/aws-clients-general.ts`).

import { createHash, createHmac } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';

import { expect, NO_SCREEN_SERVICE, startStack, test, waitFor, type Ctx } from './support';
import { connectedAt, expectLine } from './support/aws-area';
import { awsRequests, describe, EngineRequests, type EngineRequest, type Outcome } from './support/aws-clients';
import {
  createdTopicArn,
  directApiGateway,
  directDynamoDb,
  directSns,
  directSqs,
  GeneralClients,
  PAGE_SIZE,
  PageHosts,
  shown,
  topicArns,
  type DirectAnswer,
  type RestApiEntry,
} from './support/aws-clients-general';

/** How long a table may take to read `ACTIVE`, and a deleted resource to leave a direct list. */
const STATE_BOUND_MS = 30_000;

/** Every resource name of this run starts with this. */
function runPrefix(ctx: Ctx): string {
  return `efit-${ctx.runId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

function resolved<T>(outcome: Outcome<T>, what: string): T {
  expect(
    outcome.resolved ? '' : `${outcome.name} status ${String(outcome.status)}: ${outcome.message}`,
    `${what}: the command rejected`,
  ).toBe('');
  return (outcome as Extract<Outcome<T>, { resolved: true }>).value;
}

function answered(answer: DirectAnswer, status: number, what: string): string {
  expect('error' in answer ? answer.error : '', `${what}: the request failed`).toBe('');
  const { status: got, body } = answer as { status: number; body: string };
  expect(got, `${what}: status, body ${body}`).toBe(status);
  return body;
}

/** The table's status as a direct `DescribeTable` reads it; `null` when the call does not answer 200. */
async function tableStatus(ctx: Ctx, port: number, table: string): Promise<string | null> {
  const answer = await directDynamoDb(ctx, port, 'DescribeTable', { TableName: table });
  if ('error' in answer || answer.status !== 200) return null;
  return String((JSON.parse(answer.body) as { Table?: { TableStatus?: unknown } }).Table?.TableStatus ?? '');
}

/** Waits within `STATE_BOUND_MS` until a direct `DescribeTable` of `table` reads `ACTIVE`; returns whether it did. */
async function untilActive(ctx: Ctx, port: number, table: string): Promise<boolean> {
  const active = await waitFor(STATE_BOUND_MS, async () =>
    (await tableStatus(ctx, port, table)) === 'ACTIVE' ? true : undefined,
  );
  return active === true;
}

async function directTopics(ctx: Ctx, port: number): Promise<string[]> {
  return topicArns(answered(await directSns(ctx, port, 'ListTopics', {}), 200, 'direct ListTopics'));
}

async function directTables(ctx: Ctx, port: number): Promise<string[]> {
  const body = answered(await directDynamoDb(ctx, port, 'ListTables', { Limit: 100 }), 200, 'direct ListTables');
  return (JSON.parse(body) as { TableNames?: string[] }).TableNames ?? [];
}

async function directRestApis(ctx: Ctx, port: number): Promise<RestApiEntry[]> {
  const body = answered(
    await directApiGateway(ctx, port, 'GET', '/restapis', { limit: String(PAGE_SIZE) }),
    200,
    'direct GetRestApis',
  );
  // On the wire the list is `item` (the SDK reads it into `items`).
  const { item = [] } = JSON.parse(body) as { item?: { id: string; name: string }[] };
  return item.map((a) => ({ id: a.id, name: a.name }));
}

async function directQueueUrls(ctx: Ctx, port: number, prefix: string): Promise<string[]> {
  const body = answered(
    await directSqs(ctx, port, 'ListQueues', { QueueNamePrefix: prefix }),
    200,
    'direct ListQueues',
  );
  return (JSON.parse(body) as { QueueUrls?: string[] }).QueueUrls ?? [];
}

/**
 * Opens `/aws/kinesis` with the page's requests recorded (the engine's, and the origin of every request), makes the
 * general function's clients and asserts the precondition: the page has made no engine request of the clients yet.
 */
async function openWithClients(
  ctx: Ctx,
  context: BrowserContext,
  page: Page,
  studioOrigin: string,
  engineOrigin: string,
  enginePort: number,
): Promise<{ clients: GeneralClients; requests: EngineRequests; hosts: PageHosts }> {
  const hosts = PageHosts.attach(context);
  const requests = await EngineRequests.attach(ctx, context, page, engineOrigin);
  await page.goto(NO_SCREEN_SERVICE.path);
  expect(new URL(page.url()).origin, 'the page origin').toBe(studioOrigin);
  expect(new URL(page.url()).pathname, 'the page path').toBe(NO_SCREEN_SERVICE.path);
  const clients = await GeneralClients.load(ctx, page, enginePort, requests);
  const before = await requests.all();
  ctx.log(`engine requests before the first command: ${describe(before)}`);
  expect(before.length, `engine requests of the page before the first command: ${describe(before)}`).toBe(0);
  return { clients, requests, hosts };
}

/**
 * Asserts that every request of the page since `hostsFrom` went to the engine, that every AWS request of the clients
 * since `requestsFrom` carries the engine's session token and the Studio credential, and that one of them is each of
 * `expected`; returns those requests.
 */
async function throughTheEngine(
  ctx: Ctx,
  what: string,
  engineOrigin: string,
  hosts: PageHosts,
  hostsFrom: number,
  requests: EngineRequests,
  requestsFrom: number,
  expected: { name: string; matches: (r: EngineRequest) => boolean }[],
): Promise<void> {
  const since = await requests.since(requestsFrom);
  ctx.log(`${what}: engine requests of the clients: ${describe(since)}`);
  const sent = awsRequests(since);
  for (const { name, matches } of expected) {
    expect(sent.filter(matches).length, `${what}: requests of ${name} at the engine: ${describe(since)}`).toBe(1);
  }
  expect(sent.length, `${what}: AWS requests at the engine: ${describe(since)}`).toBe(expected.length);
  for (const [i, r] of sent.entries()) {
    const request = `${what}: AWS request ${String(i + 1)} (${r.method} ${r.path}${r.target ? ` ${r.target}` : ''})`;
    expect(r.hasSession, `${request}: carries X-EmuForge-Session`).toBe(true);
    expect(
      r.sessionToken,
      `${request}: X-EmuForge-Session is a token the engine handed the clients`,
    ).toBeGreaterThanOrEqual(0);
    expect(r.studioAuth, `${request}: Authorization starts AWS4-HMAC-SHA256 Credential=emuforge-studio/`).toBe(true);
  }
  const origins = hosts.since(hostsFrom);
  ctx.log(`${what}: origins the page sent requests to: ${origins.join(', ') || 'none'}`);
  expect(origins, `${what}: the origins of every request the page sent`).toEqual([engineOrigin]);
}

test('studio.aws-clients-of-any-service-go-through-the-engine', async ({ ctx, context, page }) => {
  const prefix = runPrefix(ctx);
  const topic = `${prefix}-gen`;
  const table = `${prefix}-gen`;
  const api = `${prefix}-gen`;
  const port = ctx.emulatorPort;

  // Deletion first, straight through the emulator: every topic, table once it reads `ACTIVE`, and REST API this
  // check names, whether or not the check got to make it.
  ctx.own({
    async dispose() {
      const topics = await directSns(ctx, port, 'ListTopics', {});
      if (!('error' in topics) && topics.status === 200) {
        for (const arn of topicArns(topics.body).filter((a) => a.endsWith(`:${topic}`))) {
          ctx.log(
            `cleanup DeleteTopic ${topic} directly: ${shown(await directSns(ctx, port, 'DeleteTopic', { TopicArn: arn }))}`,
          );
        }
      } else ctx.log(`cleanup ListTopics directly: ${shown(topics)}`);
      if ((await tableStatus(ctx, port, table)) !== null) {
        ctx.log(`cleanup: table ${table} reads ACTIVE: ${String(await untilActive(ctx, port, table))}`);
        ctx.log(
          `cleanup DeleteTable ${table} directly: ${shown(await directDynamoDb(ctx, port, 'DeleteTable', { TableName: table }))}`,
        );
      }
      const apis = await directApiGateway(ctx, port, 'GET', '/restapis', { limit: String(PAGE_SIZE) });
      if (!('error' in apis) && apis.status === 200) {
        const { item = [] } = JSON.parse(apis.body) as { item?: { id: string; name: string }[] };
        for (const a of item.filter((i) => i.name === api)) {
          ctx.log(
            `cleanup DeleteRestApi ${api} directly: ${shown(await directApiGateway(ctx, port, 'DELETE', `/restapis/${a.id}`))}`,
          );
        }
      } else ctx.log(`cleanup GetRestApis directly: ${shown(apis)}`);
    },
  });

  const stack = await startStack(ctx);

  // Given: a topic, a table that reads `ACTIVE` and a REST API, made by direct calls.
  const topicArn = createdTopicArn(
    answered(await directSns(ctx, port, 'CreateTopic', { Name: topic }), 200, `direct CreateTopic ${topic}`),
  );
  expect(topicArn, 'direct CreateTopic: TopicArn').not.toBe('');
  answered(
    await directDynamoDb(ctx, port, 'CreateTable', {
      TableName: table,
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }),
    200,
    `direct CreateTable ${table}`,
  );
  expect(await untilActive(ctx, port, table), `direct DescribeTable ${table}: reads ACTIVE`).toBe(true);
  const created = JSON.parse(
    answered(
      await directApiGateway(ctx, port, 'POST', '/restapis', {}, { name: api }),
      201,
      `direct CreateRestApi ${api}`,
    ),
  ) as { id?: unknown };
  const apiId = String(created.id ?? '');
  expect(apiId, 'direct CreateRestApi: id').not.toBe('');

  const { clients, requests, hosts } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // Each client lists its service's resources, as a direct call lists them.
  const hostsFrom = hosts.mark();
  const requestsFrom = (await requests.all()).length;
  const topicsViaPage = resolved(await clients.listTopics(), 'page ListTopics').filter((a) => a.includes(prefix));
  const tablesViaPage = resolved(await clients.listTables(), 'page ListTables').filter((n) => n.startsWith(prefix));
  const apisViaPage = resolved(await clients.getRestApis(), 'page GetRestApis').filter((a) =>
    a.name.startsWith(prefix),
  );
  await throughTheEngine(ctx, 'the three lists', stack.engine.url, hosts, hostsFrom, requests, requestsFrom, [
    { name: 'SNS ListTopics', matches: (r) => r.method === 'POST' && r.path === '/' && r.target === null },
    { name: 'DynamoDB ListTables', matches: (r) => r.method === 'POST' && r.target === 'DynamoDB_20120810.ListTables' },
    { name: 'API Gateway GetRestApis', matches: (r) => r.method === 'GET' && r.path === '/restapis' },
  ]);

  const byIdName = (a: RestApiEntry, b: RestApiEntry) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  expect(topicsViaPage, `page ListTopics: holds ${topic}`).toContain(topicArn);
  expect([...topicsViaPage].sort(), 'page ListTopics: the run-prefixed topics, against direct ListTopics').toEqual(
    (await directTopics(ctx, port)).filter((a) => a.includes(prefix)).sort(),
  );
  expect(tablesViaPage, `page ListTables: holds ${table}`).toContain(table);
  expect([...tablesViaPage].sort(), 'page ListTables: the run-prefixed tables, against direct ListTables').toEqual(
    (await directTables(ctx, port)).filter((n) => n.startsWith(prefix)).sort(),
  );
  expect(apisViaPage, `page GetRestApis: holds ${api}`).toContainEqual({ id: apiId, name: api });
  expect(
    [...apisViaPage].sort(byIdName),
    'page GetRestApis: the run-prefixed APIs, against direct GetRestApis',
  ).toEqual((await directRestApis(ctx, port)).filter((a) => a.name.startsWith(prefix)).sort(byIdName));

  // Delete the three by direct calls, the table once it reads `ACTIVE`.
  answered(await directSns(ctx, port, 'DeleteTopic', { TopicArn: topicArn }), 200, `direct DeleteTopic ${topic}`);
  expect(await untilActive(ctx, port, table), `direct DescribeTable ${table} before its deletion: reads ACTIVE`).toBe(
    true,
  );
  answered(await directDynamoDb(ctx, port, 'DeleteTable', { TableName: table }), 200, `direct DeleteTable ${table}`);
  answered(await directApiGateway(ctx, port, 'DELETE', `/restapis/${apiId}`), 202, `direct DeleteRestApi ${api}`);

  // Neither a direct call's list nor the client's holds them afterwards.
  const goneDirectly = await waitFor(STATE_BOUND_MS, async () => {
    const left = [
      ...(await directTopics(ctx, port)).filter((a) => a === topicArn),
      ...(await directTables(ctx, port)).filter((n) => n === table),
      ...(await directRestApis(ctx, port)).filter((a) => a.id === apiId).map((a) => a.name),
    ];
    return left.length === 0 ? true : undefined;
  });
  expect(goneDirectly, 'direct ListTopics, ListTables and GetRestApis: none holds what was deleted').toBe(true);
  expect(
    resolved(await clients.listTopics(), 'page ListTopics after the deletion'),
    `page ListTopics: no ${topic}`,
  ).not.toContain(topicArn);
  expect(
    resolved(await clients.listTables(), 'page ListTables after the deletion'),
    `page ListTables: no ${table}`,
  ).not.toContain(table);
  expect(
    resolved(await clients.getRestApis(), 'page GetRestApis after the deletion').map((a) => a.id),
    `page GetRestApis: no ${api}`,
  ).not.toContain(apiId);
});

type CapturedPost = { method: string; url: string; postData?: string; headers: Record<string, string> };

/** Verify the on-wire SQS signature with the public Studio fixture credential. Only return a verdict. */
function validStudioSignature(post: CapturedPost, headers: Record<string, string>): boolean {
  const match =
    /^AWS4-HMAC-SHA256 Credential=emuforge-studio\/(\d{8})\/us-east-1\/sqs\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
      headers.authorization ?? '',
    );
  if (!match || post.postData === undefined) return false;
  const [, date, signed, signature] = match;
  const names = signed.split(';');
  const timestamp = headers['x-amz-date'];
  if (!timestamp?.startsWith(date) || !names.includes('x-emuforge-session') || names.some((name) => !headers[name]))
    return false;
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const payload = hash(post.postData);
  if (headers['x-amz-content-sha256'] !== payload) return false;
  const url = new URL(post.url);
  const encode = (s: string) =>
    encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const query = [...url.searchParams]
    .map(([k, v]) => [encode(k), encode(v)].join('='))
    .sort()
    .join('&');
  const canonicalHeaders = names.map((name) => name + ':' + headers[name].trim().replace(/\s+/g, ' ') + '\n').join('');
  const canonical = [post.method, url.pathname, query, canonicalHeaders, signed, payload].join('\n');
  const scope = [date, 'us-east-1', 'sqs', 'aws4_request'];
  let key = Buffer.from('AWS4emuforge-studio-not-a-secret');
  for (const part of scope) key = createHmac('sha256', key).update(part).digest();
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope.join('/'), hash(canonical)].join('\n');
  return createHmac('sha256', key).update(toSign).digest('hex') === signature;
}

/** The schemes of a URL that names no host: the browser serves a `data:` or a `blob:` URL itself (issue 649). */
const HOSTLESS_SCHEMES = ['data:', 'blob:'];

/** How much of a host-less URL the observer keeps: enough to tell this check's own reads, never a whole font. */
const HOSTLESS_URL_KEPT = 256;

/**
 * Waits within `STATE_BOUND_MS` until the page has settled: the emulator line shows its connected state and the
 * fonts the page uses are read, so what is left of the page's loading is not observed as requests of the call.
 */
async function settled(page: Page, emulatorPort: number): Promise<void> {
  await expectLine(page, connectedAt(emulatorPort), STATE_BOUND_MS);
  // `document.fonts.ready` resolves once the fonts the laid-out page asked for are read; the layout is brought up to
  // date first, so the line just shown has asked for its fonts. The bound ends the wait, never a time.
  const ready = await page.evaluate(async (boundMs) => {
    document.body.getBoundingClientRect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), boundMs);
    });
    const read = await Promise.race([document.fonts.ready.then(() => true as const), bound]);
    clearTimeout(timer);
    return read;
  }, STATE_BOUND_MS);
  expect(ready, 'document.fonts.ready resolved: the fonts the settled page uses are read').toBe(true);
}

/**
 * Include preflights and join the headers Chromium observed on the wire to their POST. A request whose URL names no
 * host (`HOSTLESS_SCHEMES`) has no destination: it is kept apart, by its URL, and is not among the origins.
 */
async function observeQueueCall(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  const origins = new Set<string>();
  const hostless: string[] = [];
  const posts = new Map<string, CapturedPost>();
  const wireHeaders = new Map<string, Record<string, string>>();
  const lower = (headers: Record<string, string>) =>
    Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  session.on('Network.requestWillBeSent', ({ requestId, request }) => {
    const url = new URL(request.url);
    if (HOSTLESS_SCHEMES.includes(url.protocol)) {
      hostless.push(request.url.slice(0, HOSTLESS_URL_KEPT));
      return;
    }
    origins.add(url.origin);
    if (request.method === 'POST') posts.set(requestId, { ...request, headers: lower(request.headers) });
  });
  session.on('Network.requestWillBeSentExtraInfo', ({ requestId, headers }) => {
    wireHeaders.set(requestId, lower(headers));
  });
  await session.send('Network.enable');
  return {
    origins,
    /** Whether the observer has received a request of exactly each of `urls`, waited for within `STATE_BOUND_MS`. */
    async received(urls: string[]): Promise<boolean> {
      const all = await waitFor(STATE_BOUND_MS, () => (urls.every((u) => hostless.includes(u)) ? true : undefined));
      return all === true;
    },
    /** The schemes of the host-less requests observed, each once. */
    hostlessSchemes: () => [...new Set(hostless.map((u) => new URL(u).protocol))],
    async signedPostAt(engineOrigin: string) {
      return await waitFor(STATE_BOUND_MS, () => {
        for (const [id, post] of posts) {
          if (new URL(post.url).origin !== engineOrigin || !wireHeaders.has(id)) continue;
          const headers = { ...post.headers, ...wireHeaders.get(id) };
          if (headers['x-amz-target'] === 'AmazonSQS.GetQueueAttributes') {
            const body = JSON.parse(post.postData ?? 'null') as { QueueUrl?: unknown } | null;
            return { queueUrl: body?.QueueUrl, validSignature: validStudioSignature(post, headers) };
          }
        }
        return undefined;
      });
    },
    close: () => session.detach(),
  };
}

test('studio.aws-sqs-client-keeps-a-queue-url-on-the-engine', async ({ ctx, context, page }) => {
  const prefix = runPrefix(ctx);
  const queue = `${prefix}-gen`;
  const port = ctx.emulatorPort;

  // Deletion first: every queue this check names, straight through the emulator.
  ctx.own({
    async dispose() {
      const listed = await directSqs(ctx, port, 'ListQueues', { QueueNamePrefix: queue });
      if ('error' in listed || listed.status !== 200) {
        ctx.log(`cleanup ListQueues directly: ${shown(listed)}`);
        return;
      }
      const { QueueUrls = [] } = JSON.parse(listed.body) as { QueueUrls?: string[] };
      for (const url of QueueUrls.filter((u) => u.endsWith(`/${queue}`))) {
        ctx.log(
          `cleanup DeleteQueue ${queue} directly: ${shown(await directSqs(ctx, port, 'DeleteQueue', { QueueUrl: url }))}`,
        );
      }
    },
  });

  const stack = await startStack(ctx);

  // Given: a queue made by a direct call, using the URL returned by this run’s emulator.
  const { QueueUrl: queueUrl } = JSON.parse(
    answered(await directSqs(ctx, port, 'CreateQueue', { QueueName: queue }), 200, `direct CreateQueue ${queue}`),
  ) as { QueueUrl?: unknown };
  if (typeof queueUrl !== 'string') throw new Error('direct CreateQueue: expected a QueueUrl string');
  ctx.log(`direct CreateQueue ${queue}: QueueUrl ${queueUrl}`);
  expect(new URL(queueUrl).hostname, 'direct CreateQueue: absolute QueueUrl').not.toBe('');
  const directArn = String(
    (
      JSON.parse(
        answered(
          await directSqs(ctx, port, 'GetQueueAttributes', { QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }),
          200,
          `direct GetQueueAttributes ${queue}`,
        ),
      ) as { Attributes?: { QueueArn?: unknown } }
    ).Attributes?.QueueArn ?? '',
  );
  expect(directArn, 'direct GetQueueAttributes: QueueArn').not.toBe('');

  const { clients, requests, hosts } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // The page has settled before anything of the call is observed.
  await settled(page, stack.emulatorPort);

  // The SQS client asks for the queue's attributes by that URL.
  const hostsFrom = hosts.mark();
  const requestsFrom = (await requests.all()).length;
  const observed = await observeQueueCall(context, page);
  const arn = resolved(await clients.queueArn(queueUrl), `page GetQueueAttributes ${queue}`);
  await throughTheEngine(ctx, 'GetQueueAttributes', stack.engine.url, hosts, hostsFrom, requests, requestsFrom, [
    {
      name: 'SQS GetQueueAttributes',
      matches: (r) => r.method === 'POST' && r.target === 'AmazonSQS.GetQueueAttributes',
    },
  ]);

  // Inside the same observation, once the call has answered: the page reads a `data:` and a `blob:` URL of this
  // check's own. The observer receives both, and neither is a destination.
  const text = `${prefix}-649`;
  const reads = await page.evaluate(async (body) => {
    const dataUrl = `data:text/plain,${body}`;
    const blobUrl = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const data = await (await fetch(dataUrl)).text();
    const blob = await (await fetch(blobUrl)).text();
    URL.revokeObjectURL(blobUrl);
    return { dataUrl, blobUrl, data, blob };
  }, text);
  expect([reads.data, reads.blob], 'the page read its data: and its blob: URL').toEqual([text, text]);
  expect([new URL(reads.dataUrl).protocol, new URL(reads.blobUrl).protocol], 'the schemes of the two reads').toEqual(
    HOSTLESS_SCHEMES,
  );
  const receivedBoth = await observed.received([reads.dataUrl, reads.blobUrl]);
  ctx.log(`host-less requests observed: ${observed.hostlessSchemes().join(', ') || 'none'}`);
  expect(receivedBoth, 'the observer received the data: read and the blob: read').toBe(true);

  const post = await observed.signedPostAt(stack.engine.url);
  expect(post?.queueUrl, 'GetQueueAttributes POST: QueueUrl from direct CreateQueue').toBe(queueUrl);
  expect(post?.validSignature, 'GetQueueAttributes POST: valid Studio signature').toBe(true);
  expect([...observed.origins], 'all observed request origins including preflights').toEqual([stack.engine.url]);
  await observed.close();
  expect(arn, 'page GetQueueAttributes: QueueArn, against direct GetQueueAttributes').toBe(directArn);

  // Delete the queue by a direct call: a direct ListQueues no longer holds it.
  answered(await directSqs(ctx, port, 'DeleteQueue', { QueueUrl: queueUrl }), 200, `direct DeleteQueue ${queue}`);
  const gone = await waitFor(STATE_BOUND_MS, async () =>
    (await directQueueUrls(ctx, port, queue)).includes(queueUrl) ? undefined : true,
  );
  expect(gone, `direct ListQueues: no ${queue}`).toBe(true);
});
