import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const root = createWrapper(document.body);

function metric(name: string) {
  const item = root
    .findKeyValuePairs()
    ?.findItems()
    .find((candidate) => candidate.findLabel()?.getElement().textContent === name);
  return item?.findValue()?.getElement();
}

async function expectMetric(name: string, text: string) {
  await waitFor(() => expect(metric(name)?.textContent).toBe(text));
}

function logState() {
  return root
    .findAllContainers()
    .find((container) => {
      const header = container.findHeader()?.getElement();
      return (
        header !== undefined &&
        createWrapper(header).findHeader()?.findHeadingText().getElement().textContent === 'Log events'
      );
    })
    ?.findContent()
    .getElement();
}

function logFooter() {
  return root.findTable()?.findFooterSlot()?.getElement();
}

function expectUnimplementedLogRead(region: HTMLElement | undefined) {
  if (region === undefined) {
    throw new Error('Log events feedback is not visible');
  }
  const indicator = createWrapper(region).findStatusIndicator()?.getElement();
  expect(indicator).toHaveTextContent(/^Not implemented by the emulator$/);
  expect(indicator).toBeVisible();
  expect(within(region).getByText(/501 Not Implemented for FilterLogEvents/)).toBeVisible();
}

function messages() {
  const table = root.findTable();
  return table?.findRows().map((_, index) => table.findBodyCell(index + 1, 2)?.getElement().textContent) ?? [];
}

function timestamps() {
  const table = root.findTable();
  return (
    table?.findRows().map((_, index) =>
      table
        .findBodyCell(index + 1, 1)
        ?.getElement()
        .querySelector('time'),
    ) ?? []
  );
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

    await expectMetric('Invocations', '6');
    await expectMetric('Errors', '3');
    const heading = root
      .findAllHeaders()
      .find((header) => header.findHeadingText().getElement().textContent === 'Last hour');
    expect(heading?.findHeadingText().getElement()).toBeVisible();
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

    await expectMetric('Invocations', '0');
    await expectMetric('Errors', 'No data');
  });

  it('shows an empty log group with no continuation', async () => {
    answer = ({ operation }) => (operation === 'FilterLogEvents' ? page([]) : datapoints());
    open();

    await waitFor(() => {
      const empty = root.findTable()?.findEmptySlot()?.getElement();
      expect(empty).toHaveTextContent('No log events');
      expect(empty).toBeVisible();
    });
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

    await waitFor(() => {
      const state = logState();
      expect(state).toBeVisible();
      expect(state).toHaveTextContent('No log group');
      expect(state).toHaveTextContent(
        'Invoke the function and check that its execution role can write to CloudWatch Logs.',
      );
    });
    await expectMetric('Invocations', '3');
  });

  it('explains a custom log group without requesting logs', async () => {
    open('/shared/app');

    expect(logState()).toBeVisible();
    expect(logState()).toHaveTextContent('This function uses a custom log group.');
    await expectMetric('Invocations', '2');
    await expectMetric('Errors', '1');
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

    const original = ['first\nline', '<script>second</script>'];
    await waitFor(() => expect(messages()).toEqual(original));
    expect(timestamps().map((time) => time?.getAttribute('datetime'))).toEqual(
      original.map(() => new Date(timestamp).toISOString()),
    );
    loadMore();
    await waitFor(() => {
      expect(calls.some(({ body }) => body.nextToken === 'empty')).toBe(true);
      expect(screen.getByRole('button', { name: 'Load more events' })).not.toHaveAttribute('aria-disabled', 'true');
    });
    expect(messages()).toEqual(original);
    loadMore();

    await waitFor(() => expect(messages()).toEqual([...original, 'final']));
    expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument();
    expect(calls.filter(({ operation }) => operation === 'FilterLogEvents').map(({ body }) => body.nextToken)).toEqual([
      undefined,
      'empty',
      'last',
    ]);
  });

  it('preserves a long multiline message and shows distinct milliseconds with exact semantic timestamps', async () => {
    const longMessage = 'Traceback:\n' + 'arn:aws:lambda:us-east-1:000000000000:'.repeat(12) + '\nInvalid order';
    answer = ({ operation }) =>
      operation === 'FilterLogEvents'
        ? json({
            events: [
              { eventId: 'first', timestamp, message: longMessage },
              { eventId: 'second', timestamp: timestamp + 1, message: 'Second event' },
            ],
          })
        : datapoints();
    open();

    await waitFor(() => expect(messages()).toEqual([longMessage, 'Second event']));
    const [first, second] = timestamps();
    expect(first).toHaveTextContent(/\.123 \(UTC/);
    expect(first).toHaveAttribute('datetime', new Date(timestamp).toISOString());
    expect(second).toHaveTextContent(/\.124 \(UTC/);
    expect(second).toHaveAttribute('datetime', new Date(timestamp + 1).toISOString());
  });

  it('keeps focus and announces completion when the terminal page has no events', async () => {
    answer = ({ operation, body }) =>
      operation === 'FilterLogEvents'
        ? body.nextToken === undefined
          ? page(['first event'], 'terminal')
          : page([])
        : datapoints();
    open();
    const button = await screen.findByRole('button', { name: 'Load more events' });
    const completion = logFooter()?.querySelector('[role="status"]');
    button.focus();
    await userEvent.setup().keyboard('{Enter}');

    await waitFor(() => expect(completion).toHaveTextContent(/^No more log events$/));
    expect(completion).toHaveAttribute('role', 'status');
    expect(completion).toHaveAttribute('aria-live', 'polite');
    expect(completion).toHaveFocus();
    expect(logFooter()?.querySelector('[role="status"]')).toBe(completion);
    expect(screen.queryByRole('button', { name: 'Load more events' })).not.toBeInTheDocument();
    expect(messages()).toEqual(['first event']);
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
    await waitFor(() => expect(messages()).toEqual(['first event']));
    loadMore();

    await waitFor(() => {
      const footer = logFooter();
      if (footer === undefined) {
        throw new Error('Log events continuation is not visible');
      }
      expect(within(footer).getByText('FilterLogEvents was refused: Permission to read logs is missing')).toBeVisible();
    });
    expect(messages()).toEqual(['first event']);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading events' }));
    await waitFor(() => expect(messages()).toEqual(['first event', 'second event']));
  });

  it('shows the unavailable continuation and preserves earlier events after a 501', async () => {
    answer = ({ operation, body }) => {
      if (operation === 'GetMetricStatistics') return datapoints();
      if (body.nextToken === undefined) return page(['first event'], 'later');
      return json({ message: 'Unsupported' }, 501);
    };
    open();
    await waitFor(() => expect(messages()).toEqual(['first event']));
    loadMore();

    await waitFor(() => expectUnimplementedLogRead(logFooter()));
    expect(screen.getByRole('button', { name: 'Load more events' })).toBeDisabled();
    expect(messages()).toEqual(['first event']);
  });

  it('identifies an unimplemented log read while showing both counts', async () => {
    answer = ({ operation }) => (operation === 'FilterLogEvents' ? json({}, 501) : datapoints(5));
    open();

    await waitFor(() => expectUnimplementedLogRead(logState()));
    await expectMetric('Invocations', '5');
    await expectMetric('Errors', '5');
  });

  it('identifies the denied metric without obscuring the other count or events', async () => {
    answer = ({ operation, body }) => {
      if (operation === 'FilterLogEvents') return page(['invoked']);
      return body.MetricName === 'Invocations'
        ? json({ message: 'Metric read denied by policy' }, 403, 'AccessDenied')
        : datapoints(1);
    };
    open();

    await waitFor(() => {
      const invocations = metric('Invocations');
      expect(invocations).toHaveTextContent('GetMetricStatistics was refused: Metric read denied by policy');
      expect(invocations).toBeVisible();
    });
    await expectMetric('Errors', '1');
    await waitFor(() => expect(messages()).toEqual(['invoked']));
  });

  it('keeps only the selected function’s results when the earlier reads finish last', async () => {
    const delayed: Promise<Response>[] = [];
    let releaseOrders: () => void = () => undefined;
    const ordersGate = new Promise<void>((resolve) => {
      releaseOrders = resolve;
    });
    answer = ({ operation, body }) => {
      const isOrders = body.logGroupName === '/aws/lambda/orders' || body.Dimensions?.[0]?.Value === 'orders';
      const result =
        operation === 'FilterLogEvents'
          ? page([isOrders ? 'old orders' : 'new refunds'])
          : datapoints(isOrders ? 42 : 8);
      if (!isOrders) {
        return result;
      }
      const response = ordersGate.then(() => result);
      delayed.push(response);
      return response;
    };
    const { switchTo } = open();
    await waitFor(() => expect(delayed).toHaveLength(3));

    switchTo('refunds');
    await waitFor(() => expect(messages()).toEqual(['new refunds']));
    await expectMetric('Invocations', '8');
    await expectMetric('Errors', '8');
    await act(async () => {
      releaseOrders();
      await Promise.all(delayed);
    });
    expect(metric('Invocations')?.textContent).toBe('8');
    expect(metric('Errors')?.textContent).toBe('8');
    expect(messages()).toEqual(['new refunds']);
  });
});
