import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import { MonitorTab } from './monitor-tab';

interface Call {
  operation: string;
  body: {
    MetricName?: string;
    Namespace?: string;
    Dimensions?: { Name: string; Value: string }[];
    StartTime?: unknown;
    EndTime?: unknown;
    Period?: number;
    Statistics?: string[];
    logGroupName?: string;
    limit?: number;
    nextToken?: string;
  };
}

const timestamp = 1_796_000_000_123;
const calls: Call[] = [];
let nextPort = 9490;
let endpoint: string;
let answer: (call: Call) => Response | Promise<Response>;

function json(body: unknown, status = 200, code?: string) {
  const headers = new Headers({ 'content-type': 'application/x-amz-json-1.0' });
  if (code !== undefined) {
    headers.set('x-amzn-errortype', code);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function page(messages: string[], nextToken?: string) {
  return json({
    events: messages.map((message) => ({ eventId: message, timestamp, message })),
    nextToken,
  });
}

function datapoints(...sums: number[]) {
  return json({
    Datapoints: sums.map((Sum, index) => ({ Timestamp: Math.floor(timestamp / 1000) - index * 60, Sum })),
  });
}

beforeEach(() => {
  calls.length = 0;
  endpoint = engineEndpoint(++nextPort);
  answer = ({ operation, body }) =>
    operation === 'FilterLogEvents' ? page(['handler output']) : datapoints(body.MetricName === 'Invocations' ? 2 : 1);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return json({ token: 'monitor-test-session' });
    }
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1);
    if (operation !== 'FilterLogEvents' && operation !== 'GetMetricStatistics') {
      throw new Error(`Unexpected operation: ${operation}`);
    }
    const body = (await request.json()) as Call['body'];
    const call = { operation, body };
    calls.push(call);
    return answer(call);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(logGroup?: string) {
  const client = new QueryClient();
  const view = (name: string) => (
    <QueryClientProvider client={client}>
      <MonitorTab endpoint={endpoint} name={name} logGroup={logGroup} />
    </QueryClientProvider>
  );
  const result = render(view('orders'));
  return { switchTo: (name: string) => result.rerender(view(name)) };
}

function metric(name: string) {
  const pair = screen.getByText(name).closest('dt')?.nextElementSibling;
  if (pair === null || pair === undefined) {
    throw new Error(`No field for ${name}`);
  }
  return within(pair);
}

function messages() {
  return within(screen.getByRole('table', { name: 'Log events' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
}

function loadMore() {
  fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
}

// AWS JSON encodes timestamp shapes as Unix seconds.
const milliTime = (time: unknown) => (typeof time === 'number' ? time * 1000 : Date.parse(String(time)));

describe('Lambda monitoring', () => {
  it('totals independent minute sums in a common last-hour window', async () => {
    answer = ({ operation, body }) =>
      operation === 'FilterLogEvents'
        ? page(['handler output'])
        : body.MetricName === 'Invocations'
          ? datapoints(2, 3, 1)
          : datapoints(1, 0, 2);
    open();

    await metric('Invocations').findByText('6');
    await metric('Errors').findByText('3');
    expect(screen.getByRole('heading', { name: 'Last hour' })).toBeVisible();
    const metrics = calls.filter(({ operation }) => operation === 'GetMetricStatistics').map(({ body }) => body);
    expect(metrics.map(({ MetricName }) => MetricName).sort()).toEqual(['Errors', 'Invocations']);
    for (const body of metrics) {
      expect(body).toMatchObject({
        Namespace: 'AWS/Lambda',
        Dimensions: [{ Name: 'FunctionName', Value: 'orders' }],
        Period: 60,
        Statistics: ['Sum'],
        StartTime: metrics[0]?.StartTime,
        EndTime: metrics[0]?.EndTime,
      });
      expect(milliTime(body.EndTime) - milliTime(body.StartTime)).toBe(3_600_000);
    }
  });

  it('distinguishes a returned zero from no metric data', async () => {
    answer = ({ operation, body }) =>
      operation === 'FilterLogEvents' ? page([]) : body.MetricName === 'Invocations' ? datapoints(0) : datapoints();
    open();

    await metric('Invocations').findByText('0');
    await metric('Errors').findByText('No data');
  });

  it('shows an empty log group with no continuation', async () => {
    answer = ({ operation }) => (operation === 'FilterLogEvents' ? page([]) : datapoints());
    open();

    expect(await screen.findByText('No log events')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument();
    expect(calls.find(({ operation }) => operation === 'FilterLogEvents')?.body).toEqual({
      logGroupName: '/aws/lambda/orders',
      limit: 25,
    });
  });

  it('explains a missing group independently of the counts', async () => {
    answer = ({ operation }) =>
      operation === 'FilterLogEvents'
        ? json({ message: 'The specified log group does not exist' }, 400, 'ResourceNotFoundException')
        : datapoints(3);
    open();

    expect(await screen.findByText('No log group')).toBeVisible();
    expect(
      screen.getByText('Invoke the function and check that its execution role can write to CloudWatch Logs.'),
    ).toBeVisible();
    await metric('Invocations').findByText('3');
  });

  it('explains a custom log group without requesting logs', async () => {
    open('/shared/app');

    expect(screen.getByText('This function uses a custom log group.')).toBeVisible();
    await metric('Invocations').findByText('2');
    await metric('Errors').findByText('1');
    expect(calls.map(({ operation }) => operation)).toEqual(['GetMetricStatistics', 'GetMetricStatistics']);
  });

  it('keeps equal-time events in order and continues through an empty page', async () => {
    answer = ({ operation, body }) => {
      if (operation === 'GetMetricStatistics') return datapoints();
      if (body.nextToken === undefined) return page(['first\nline', '<script>second</script>'], 'empty');
      if (body.nextToken === 'empty') return page([], 'last');
      return page(['final']);
    };
    open();

    await screen.findByText('<script>second</script>');
    const original = ['first\nline', '<script>second</script>'];
    expect(messages()).toEqual(original);
    const shownTimes = within(screen.getByRole('table', { name: 'Log events' })).getAllByRole('time');
    expect(shownTimes.map((time) => time.getAttribute('datetime'))).toEqual(
      original.map(() => new Date(timestamp).toISOString()),
    );
    loadMore();
    await waitFor(() => {
      expect(calls.some(({ body }) => body.nextToken === 'empty')).toBe(true);
      expect(screen.getByRole('button', { name: 'Load more events' })).toBeEnabled();
    });
    expect(messages()).toEqual(original);
    loadMore();

    await screen.findByText('final');
    expect(messages()).toEqual([...original, 'final']);
    expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument();
    expect(calls.filter(({ operation }) => operation === 'FilterLogEvents').map(({ body }) => body.nextToken)).toEqual([
      undefined,
      'empty',
      'last',
    ]);
  });

  it('preserves earlier events on denial and appends the retried page once', async () => {
    let denied = false;
    answer = ({ operation, body }) => {
      if (operation === 'GetMetricStatistics') return datapoints();
      if (body.nextToken === undefined) return page(['first event'], 'later');
      if (denied) return page(['second event']);
      denied = true;
      return json({ message: 'Permission to read logs is missing' }, 403, 'AccessDeniedException');
    };
    open();
    await screen.findByText('first event');
    loadMore();

    expect(await screen.findByText('FilterLogEvents was refused: Permission to read logs is missing')).toBeVisible();
    expect(messages()).toEqual(['first event']);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading events' }));
    await screen.findByText('second event');
    expect(messages()).toEqual(['first event', 'second event']);
  });

  it('shows the unavailable continuation and preserves earlier events after a 501', async () => {
    answer = ({ operation, body }) => {
      if (operation === 'GetMetricStatistics') return datapoints();
      if (body.nextToken === undefined) return page(['first event'], 'later');
      return json({ message: 'Unsupported' }, 501);
    };
    open();
    await screen.findByText('first event');
    loadMore();

    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for FilterLogEvents/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Load more events' })).toBeDisabled();
    expect(messages()).toEqual(['first event']);
  });

  it('identifies an unimplemented log read while showing both counts', async () => {
    answer = ({ operation }) => (operation === 'FilterLogEvents' ? json({}, 501) : datapoints(5));
    open();

    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for FilterLogEvents/)).toBeVisible();
    await metric('Invocations').findByText('5');
    await metric('Errors').findByText('5');
  });

  it('identifies the denied metric without obscuring the other count or events', async () => {
    answer = ({ operation, body }) => {
      if (operation === 'FilterLogEvents') return page(['invoked']);
      return body.MetricName === 'Invocations'
        ? json({ message: 'Metric read denied by policy' }, 403, 'AccessDenied')
        : datapoints(1);
    };
    open();

    expect(
      await metric('Invocations').findByText('GetMetricStatistics was refused: Metric read denied by policy'),
    ).toBeVisible();
    await metric('Errors').findByText('1');
    expect(await screen.findByText('invoked')).toBeVisible();
  });

  it('keeps only the selected function’s results when the earlier reads finish last', async () => {
    const delayed: (() => void)[] = [];
    answer = ({ operation, body }) => {
      const isOrders = body.logGroupName === '/aws/lambda/orders' || body.Dimensions?.[0]?.Value === 'orders';
      const result =
        operation === 'FilterLogEvents'
          ? page([isOrders ? 'old orders' : 'new refunds'])
          : datapoints(isOrders ? 42 : 8);
      return isOrders ? new Promise((resolve) => delayed.push(() => resolve(result))) : result;
    };
    const { switchTo } = open();
    await waitFor(() => expect(delayed).toHaveLength(3));

    switchTo('refunds');
    await screen.findByText('new refunds');
    await metric('Invocations').findByText('8');
    await metric('Errors').findByText('8');
    await act(async () => {
      delayed.forEach((finish) => finish());
    });
    expect(messages()).toEqual(['new refunds']);
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });
});
