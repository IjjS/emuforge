// Studio's AWS SDK clients (`studio/src/lib/aws/client-factory.ts`) from a page at the built Studio's origin, through
// the engine started for that origin (test-criteria.md, issue 13, Flow sections). The page opens `/s3`, the "no
// screen yet" page, which sends nothing to the engine, so every engine request the page makes is the factory's. The
// factory runs bundled for the browser against Studio's installed SDK (`support/aws-clients.ts`).

import type { BrowserContext, Page } from '@playwright/test';

import { expect, startStack, test, type Ctx } from './support';
import {
  awsRequests,
  bucketNames,
  describe,
  directS3,
  directSfn,
  EngineRequests,
  PageClients,
  sessionRequests,
  shown,
  type DirectAnswer,
  type EngineRequest,
  type Outcome,
  type StateMachineEntry,
} from './support/aws-clients';

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

/**
 * Opens `/s3` with the page's requests recorded, loads the factory's clients and asserts the precondition: the page
 * has made no engine request.
 */
async function openWithClients(
  ctx: Ctx,
  context: BrowserContext,
  page: Page,
  studioOrigin: string,
  engineOrigin: string,
  enginePort: number,
): Promise<{ clients: PageClients; requests: EngineRequests }> {
  const requests = EngineRequests.attach(ctx, context, page, engineOrigin);
  await page.goto('/s3');
  expect(new URL(page.url()).origin, 'the page origin').toBe(studioOrigin);
  expect(new URL(page.url()).pathname, 'the page path').toBe('/s3');
  const clients = await PageClients.load(ctx, page, enginePort, requests);
  const before = await requests.all();
  ctx.log(`engine requests before the first command: ${describe(before)}`);
  expect(before.length, `engine requests of the page before the first command: ${describe(before)}`).toBe(0);
  return { clients, requests };
}

test('studio.aws-clients-list-matches-direct', async ({ ctx, context, page }) => {
  const prefix = runPrefix(ctx);
  const bucket = `${prefix}-acl`;
  const machine = `${prefix}-acl`;
  const port = ctx.emulatorPort;

  // Deletion first: the bucket, and every state machine named `machine`, straight through the emulator.
  ctx.own({
    async dispose() {
      const listed = await directSfn(ctx, port, 'ListStateMachines', {});
      if (!('error' in listed) && listed.status === 200) {
        const { stateMachines = [] } = JSON.parse(listed.body) as {
          stateMachines?: { name: string; stateMachineArn: string }[];
        };
        for (const m of stateMachines.filter((s) => s.name === machine)) {
          const deleted = await directSfn(ctx, port, 'DeleteStateMachine', { stateMachineArn: m.stateMachineArn });
          ctx.log(`cleanup DeleteStateMachine ${machine} directly: ${shown(deleted)}`);
        }
      }
      ctx.log(`cleanup DELETE /${bucket} directly: ${shown(await directS3(ctx, port, 'DELETE', `/${bucket}`))}`);
    },
  });

  const stack = await startStack(ctx);

  answered(await directS3(ctx, port, 'PUT', `/${bucket}`), 200, `direct CreateBucket ${bucket}`);
  const created = answered(
    await directSfn(ctx, port, 'CreateStateMachine', {
      name: machine,
      definition: JSON.stringify({ StartAt: 'P', States: { P: { Type: 'Pass', End: true } } }),
      roleArn: `arn:aws:iam::000000000000:role/${prefix}-role`,
    }),
    200,
    `direct CreateStateMachine ${machine}`,
  );
  const machineArn = String((JSON.parse(created) as { stateMachineArn?: unknown }).stateMachineArn ?? '');
  expect(machineArn, 'direct CreateStateMachine: stateMachineArn').not.toBe('');

  const { clients, requests } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // ListBuckets through the page's S3 client, then directly.
  const viaPage = resolved(await clients.listBuckets(), 'page ListBuckets').filter((n) => n.startsWith(prefix));
  const direct = bucketNames(answered(await directS3(ctx, port, 'GET', '/'), 200, 'direct ListBuckets')).filter((n) =>
    n.startsWith(prefix),
  );
  expect([...viaPage].sort(), 'page ListBuckets: the run-prefixed bucket names, against direct ListBuckets').toEqual(
    [...direct].sort(),
  );
  expect(viaPage, `page ListBuckets: includes ${bucket}`).toContain(bucket);

  // ListStateMachines through the page's Step Functions client, then directly.
  const byName = (a: StateMachineEntry, b: StateMachineEntry) =>
    a.name.localeCompare(b.name) || a.arn.localeCompare(b.arn);
  const machinesViaPage = resolved(await clients.listStateMachines(), 'page ListStateMachines')
    .filter((m) => m.name.startsWith(prefix))
    .sort(byName);
  const listed = JSON.parse(
    answered(await directSfn(ctx, port, 'ListStateMachines', {}), 200, 'direct ListStateMachines'),
  ) as {
    stateMachines?: { name: string; stateMachineArn: string }[];
  };
  const machinesDirect = (listed.stateMachines ?? [])
    .map((m) => ({ name: m.name, arn: m.stateMachineArn }))
    .filter((m) => m.name.startsWith(prefix))
    .sort(byName);
  expect(
    machinesViaPage,
    'page ListStateMachines: run-prefixed names and ARNs, against direct ListStateMachines',
  ).toEqual(machinesDirect);
  expect(machinesViaPage, `page ListStateMachines: includes ${machine} with its ARN`).toContainEqual({
    name: machine,
    arn: machineArn,
  });

  // Throughout: one session request, and every other engine request signed by Studio and carrying the session.
  const all = await requests.all();
  ctx.log(`engine requests of the page: ${describe(all)}`);
  expect(sessionRequests(all).length, `session requests of the page: ${describe(all)}`).toBe(1);
  expect(await requests.tokenCount(), 'session tokens the engine handed the page').toBe(1);
  const sent = awsRequests(all);
  expect(sent.length, `AWS requests of the page: ${describe(all)}`).toBeGreaterThanOrEqual(2);
  for (const [i, r] of sent.entries()) {
    const what = `AWS request ${String(i + 1)} (${r.method} ${r.path})`;
    expect(r.hasSession, `${what}: carries X-EmuForge-Session`).toBe(true);
    expect(r.sessionToken, `${what}: X-EmuForge-Session is the token of the session answer`).toBe(0);
    expect(r.studioAuth, `${what}: Authorization starts AWS4-HMAC-SHA256 Credential=emuforge-studio/`).toBe(true);
  }
});

test('studio.aws-clients-renew-session-after-engine-restart', async ({ ctx, context, page }) => {
  const prefix = runPrefix(ctx);
  const bucket = `${prefix}-acr`;
  const port = ctx.emulatorPort;

  ctx.own({
    async dispose() {
      ctx.log(`cleanup DELETE /${bucket} directly: ${shown(await directS3(ctx, port, 'DELETE', `/${bucket}`))}`);
    },
  });

  const stack = await startStack(ctx);
  answered(await directS3(ctx, port, 'PUT', `/${bucket}`), 200, `direct CreateBucket ${bucket}`);

  const { clients, requests } = await openWithClients(
    ctx,
    context,
    page,
    stack.studio.origin,
    stack.engine.url,
    stack.engine.port,
  );

  // Given: each client has sent once.
  expect(
    resolved(await clients.listBuckets(), 'first page ListBuckets'),
    `first page ListBuckets: includes ${bucket}`,
  ).toContain(bucket);
  resolved(await clients.listStateMachines(), 'first page ListStateMachines');

  /** Restarts the engine on the same port, the page left open; returns where its later requests start. */
  async function restart(n: number): Promise<{ from: number; newToken: number }> {
    const from = (await requests.all()).length;
    const newToken = await requests.tokenCount();
    await stack.engine.stop();
    await stack.engine.startAgain();
    ctx.log(`engine restart ${String(n)} on port ${String(stack.engine.port)}`);
    return { from, newToken };
  }

  /** Asserts one session request and exactly two `matching` AWS requests since `from`, the second with the new token. */
  async function renewedOnce(
    what: string,
    from: number,
    newToken: number,
    matching: (r: EngineRequest) => boolean,
  ): Promise<void> {
    const since = await requests.since(from);
    ctx.log(`${what}: engine requests since the restart: ${describe(since)}`);
    expect(sessionRequests(since).length, `${what}: session requests since the restart: ${describe(since)}`).toBe(1);
    expect(await requests.tokenCount(), `${what}: session tokens handed out since the restart`).toBe(newToken + 1);
    const sent = awsRequests(since).filter(matching);
    expect(sent.length, `${what}: its requests since the restart: ${describe(since)}`).toBe(2);
    expect(sent[1].sessionToken, `${what}: the second request carries the token of the new session answer`).toBe(
      newToken,
    );
  }

  // Restart 1: HeadBucket, a HEAD answer without a body.
  let at = await restart(1);
  expect(resolved(await clients.headBucket(bucket), `page HeadBucket ${bucket}`), 'page HeadBucket: status').toBe(200);
  await renewedOnce(
    `HeadBucket ${bucket}`,
    at.from,
    at.newToken,
    (r) => r.method === 'HEAD' && r.path === `/${bucket}`,
  );

  // Restart 2: ListBuckets.
  at = await restart(2);
  expect(
    resolved(await clients.listBuckets(), 'page ListBuckets after restart 2'),
    `ListBuckets: includes ${bucket}`,
  ).toContain(bucket);
  await renewedOnce(
    'ListBuckets',
    at.from,
    at.newToken,
    (r) => r.method === 'GET' && r.path === '/' && r.target === null,
  );

  // Restart 3: ListStateMachines through the Step Functions client.
  at = await restart(3);
  resolved(await clients.listStateMachines(), 'page ListStateMachines after restart 3');
  await renewedOnce(
    'ListStateMachines',
    at.from,
    at.newToken,
    (r) => r.method === 'POST' && r.target === 'AWSStepFunctions.ListStateMachines',
  );

  // The renewals changed nothing in the emulator.
  answered(await directS3(ctx, port, 'HEAD', `/${bucket}`), 200, `direct HeadBucket ${bucket} afterwards`);
});
