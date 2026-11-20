import type { Page } from '@playwright/test';
import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import { expect, type Ctx } from '../../support';
import { directLogs, shown } from '../../support/aws-clients-general';
import { checkPrefix, creationDateText, SEOUL } from '../../support/service-screens';
import { BASIC_EXECUTION_POLICY, invokeDirect, LambdaSeeded, metricSums } from './lambda';
import { PYTHON, PYTHON_HANDLER, pythonZip } from './lambda-tasks';

const wrapper = createWrapper('[role="tabpanel"]');
const logs = wrapper.findTable();
const pairs = wrapper.findKeyValuePairs().findItems();
const code = pythonZip(
  [
    'def lambda_handler(event, context):',
    '    for i in range(event["lines"]):',
    '        print(f"{event[\'marker\']} {i}")',
    '    if event.get("fail"):',
    '        raise ValueError("second invocation failed")',
    '    return "ok"',
  ].join('\n'),
);

export async function monitoredFunction(ctx: Ctx, port: number, suffix: string, logging: boolean) {
  const prefix = checkPrefix(ctx, suffix);
  const name = prefix + '-function';
  const seeded = new LambdaSeeded(ctx, port, prefix);
  const roleName = prefix + '-role';
  const role = await seeded.role(roleName);
  if (logging) {
    await seeded.attach(roleName, BASIC_EXECUTION_POLICY);
    ctx.own({
      async dispose() {
        const answer = await directLogs(ctx, port, 'DeleteLogGroup', { logGroupName: '/aws/lambda/' + name });
        if ('error' in answer || (answer.status !== 200 && !answer.body.includes('ResourceNotFoundException'))) {
          throw Error('DeleteLogGroup: ' + shown(answer));
        }
      },
    });
  }
  await seeded.function(name, { role, runtime: PYTHON.id, code: { zip: code, handler: PYTHON_HANDLER } });
  const first = await invokeDirect(ctx, port, name, { marker: 'first', lines: 28 });
  expect(first.status).toBe(200);
  expect(JSON.parse(first.payload)).toBe('ok');
  return name;
}

export async function directPage(ctx: Ctx, port: number, name: string, nextToken?: string) {
  const response = await directLogs(ctx, port, 'FilterLogEvents', {
    logGroupName: '/aws/lambda/' + name,
    limit: 25,
    nextToken,
  });
  if ('error' in response || response.status !== 200) throw Error('FilterLogEvents: ' + shown(response));
  return JSON.parse(response.body) as { events: { timestamp: number; message: string }[]; nextToken?: string };
}

export async function compareTotals(
  ctx: Ctx,
  port: number,
  page: Page,
  name: string,
  expected: Record<string, number>,
) {
  const header = page
    .locator(wrapper.findContainer().findHeader().toSelector())
    .filter({ has: page.getByRole('heading', { name: 'Last hour' }) });
  const windowEnd = header.locator('time');
  await expect(windowEnd).toBeVisible();
  const end = new Date((await windowEnd.getAttribute('datetime')) ?? '');
  for (const [index, metric] of ['Invocations', 'Errors'].entries()) {
    if (!(metric in expected)) continue;
    const sums = await metricSums(ctx, port, name, metric, end);
    expect(sums.length).toBeGreaterThan(0);
    const total = sums.reduce((a, b) => a + b, 0);
    expect(total).toBe(expected[metric]);
    const item = pairs.get(index + 1);
    await expect(page.locator(item.findLabel().toSelector())).toHaveText(metric);
    await expect(page.locator(item.findValue().toSelector())).toHaveText(String(total));
  }
}

export async function compareEvents(page: Page, events: { timestamp: number; message: string }[]) {
  await expect(page.locator(logs.findRows().toSelector())).toHaveCount(events.length);
  for (const [index, event] of events.entries()) {
    const date = new Date(event.timestamp);
    const iso = date.toISOString();
    const formatted = creationDateText(iso, SEOUL).replace(' (UTC', '.' + iso.slice(20, 23) + ' (UTC');
    const time = page.locator(logs.findBodyCell(index + 1, 1).toSelector()).locator('time');
    await expect(time).toHaveText(formatted);
    await expect(time).toHaveAttribute('datetime', iso);
    const message = page.locator(logs.findBodyCell(index + 1, 2).toSelector());
    expect(await message.textContent()).toBe(event.message);
  }
}

export const missingLog = (page: Page) =>
  page
    .locator(wrapper.findContainer().toSelector())
    .filter({ has: page.getByRole('heading', { name: 'Log events' }) });
