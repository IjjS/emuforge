import type { Page } from '@playwright/test';
import { expect, startStack, test, type Ctx } from './support';
import { directLogs } from './support/aws-clients-general';
import { connectedAt, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { markPage, stillSamePage } from './support/home';
import { SEOUL } from './support/service-screens';
import { getFunctionDirect, invokeDirect } from './services/lambda/lambda';
import { functionPath } from './services/lambda/lambda-list';
import { functionPage, openFunction } from './services/lambda/lambda-page';
import { chooseTab, toCode } from './services/lambda/lambda-tasks';
import {
  compareEvents,
  compareTotals,
  directPage,
  missingLog,
  monitoredFunction,
} from './services/lambda/lambda-monitor';

test.use({ timezoneId: SEOUL.timeZone });

test('studio.lambda-monitor-reads-invocations', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const name = await monitoredFunction(ctx, port, 'monitor-pages', true);
  const failed = await invokeDirect(ctx, port, name, { marker: 'second', lines: 1, fail: true });
  expect(failed.status).toBe(200);
  expect(JSON.parse(failed.payload).errorMessage).toBe('second invocation failed');
  await openFunction(page, name);
  await chooseTab(page, name, 'Monitor', 'Log events');
  await compareTotals(ctx, port, page, name, { Invocations: 2, Errors: 1 });

  let direct = await directPage(ctx, port, name);
  expect(direct.nextToken).toBeTruthy();
  const events = [...direct.events];
  const tokens = new Set<string>();
  await compareEvents(page, events);
  while (direct.nextToken) {
    expect(tokens.has(direct.nextToken), 'each page advances').toBe(false);
    tokens.add(direct.nextToken);
    await page.getByRole('button', { name: 'Load more events' }).click();
    direct = await directPage(ctx, port, name, direct.nextToken);
    events.push(...direct.events);
    await compareEvents(page, events);
  }
  expect(events.some((e) => e.message.includes('first 0'))).toBe(true);
  expect(events.some((e) => e.message.includes('second 0'))).toBe(true);
  expect(events.some((e) => e.message.startsWith('REPORT'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Load more events' })).toHaveCount(0);
});

test('studio.lambda-monitor-explains-missing-logs', async ({ ctx, page }) => {
  const { emulatorPort: port } = await startStack(ctx);
  const name = await monitoredFunction(ctx, port, 'monitor-no-log', false);
  const response = await directLogs(ctx, port, 'FilterLogEvents', { logGroupName: '/aws/lambda/' + name });
  if ('error' in response) throw Error(response.error);
  expect(response.status).toBe(400);
  expect(response.body).toContain('ResourceNotFoundException');
  await page.goto(functionPath(name) + '?tab=monitor');
  await expect(missingLog(page)).toContainText('No log group');
  await expect(missingLog(page)).toContainText(
    'Invoke the function and check that its execution role can write to CloudWatch Logs.',
  );
  await compareTotals(ctx, port, page, name, { Invocations: 1 });
});

async function reconnect(ctx: Ctx, page: Page, tab: 'Code' | 'Monitor') {
  test.setTimeout(240_000);
  const { emulator } = await startStack(ctx, { ownEmulator: true });
  if (!emulator) throw Error('Missing private emulator');
  const port = emulator.port;
  const name = await monitoredFunction(ctx, port, 'monitor-restart', true);
  await page.goto(functionPath(name) + '?tab=monitor');
  await compareTotals(ctx, port, page, name, { Invocations: 1 });
  const { events } = await directPage(ctx, port, name);
  expect(
    events.some((event) => event.message.trimEnd() === 'first 0'),
    'the previously logged invocation',
  ).toBe(true);
  await compareEvents(page, events);
  if (tab === 'Code') await toCode(page, name);
  await markPage(page);
  await emulator.stop();
  await expectLine(page, notStartedOn(port));
  const monitoringRequests: string[] = [];
  if (tab === 'Code') {
    page.on('request', (request) => {
      const operation = request.headers()['x-amz-target'] ?? '';
      if (/\.(FilterLogEvents|GetMetricStatistics)$/.test(operation)) monitoringRequests.push(operation);
    });
  }
  await emulator.startAgain();
  await expectLine(page, connectedAt(port));
  if (tab === 'Code') {
    // Read the document address synchronously at fetch dispatch. A request from Code
    // can finish after the tab changes, but cannot contribute a Monitor response.
    const observation = await page.evaluateHandle(
      ({ functionRoute, detailPath }) => {
        const result = { status: 0, refusal: '' };
        const original = window.fetch;
        window.fetch = function (input, init) {
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
          const fromMonitor =
            location.pathname === functionRoute && new URLSearchParams(location.search).get('tab') === 'monitor';
          const response = original.call(window, input, init);
          if (fromMonitor && method === 'GET' && url.pathname === detailPath) {
            window.fetch = original;
            void response
              .then(async (answer) => {
                const body = await answer.clone().text();
                result.refusal = (answer.headers.get('x-amzn-errortype') ?? '') + ' ' + body;
                result.status = answer.status;
              })
              .catch(() => {
                result.status = -1;
              });
          }
          return response;
        };
        return result;
      },
      { functionRoute: functionPath(name), detailPath: '/2015-03-31/functions/' + name },
    );
    await functionPage(page, name).tab('Monitor').click();
    await expect
      .poll(() => observation.evaluate((result) => result.status), { timeout: 2 * LINE_CHANGE_BOUND_MS })
      .toBe(404);
    expect(await observation.evaluate((result) => result.refusal)).toContain('ResourceNotFoundException');
    await observation.dispose();
  }
  await expect(functionPage(page, name).notFound).toBeVisible({ timeout: 2 * LINE_CHANGE_BOUND_MS });
  await expect(page.getByRole('heading', { name: 'Log events' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Last hour' })).toHaveCount(0);
  if (tab === 'Code') expect(monitoringRequests).toEqual([]);
  expect((await getFunctionDirect(ctx, port, name)).found).toBe(false);
  expect(await stillSamePage(page)).toBe(true);
}

test('studio.lambda-monitor-reconnects', async ({ ctx, page }) => reconnect(ctx, page, 'Monitor'));
test('studio.lambda-monitor-entered-after-reconnect', async ({ ctx, page }) => reconnect(ctx, page, 'Code'));
