import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';

const CREATED = '2026-11-20T01:02:03.000Z';

interface Summary {
  StackId: string;
  StackName: string;
  StackStatus: string;
  CreationTime: string;
  TemplateDescription?: string;
}

function summary(id: string, name: string, status = 'CREATE_COMPLETE'): Summary {
  return { StackId: id, StackName: name, StackStatus: status, CreationTime: CREATED };
}

const XMLNS = 'http://cloudformation.amazonaws.com/doc/2010-05-15/';

function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/xml' } });
}

function page(stacks: Partial<Summary>[], token?: string): Response {
  const entries = stacks.map(
    (stack) =>
      `<member>${Object.entries(stack)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `<${key}>${value}</${key}>`)
        .join('')}</member>`,
  );
  const next = token === undefined ? '' : `<NextToken>${token}</NextToken>`;
  return xml(
    `<ListStacksResponse xmlns="${XMLNS}"><ListStacksResult><StackSummaries>${entries.join('')}</StackSummaries>${next}</ListStacksResult><ResponseMetadata><RequestId>test</RequestId></ResponseMetadata></ListStacksResponse>`,
  );
}

function refused(status: number, code: string, reason: string): Response {
  return xml(
    `<ErrorResponse xmlns="${XMLNS}"><Error><Code>${code}</Code><Message>${reason}</Message></Error><RequestId>test</RequestId></ErrorResponse>`,
    status,
  );
}

let nextPort = 9810;

function setupEngine() {
  const engine = {
    endpoint: '',
    calls: [] as URLSearchParams[],
    answer: vi.fn<(params: URLSearchParams) => Response | Promise<Response>>(),
  };

  beforeEach(() => {
    nextPort += 1;
    engine.endpoint = engineEndpoint(nextPort);
    engine.calls.length = 0;
    engine.answer.mockReset();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname === '/__emuforge/session') {
        return Response.json({ token: 'emuforge-test-token-81' });
      }
      const params = new URLSearchParams(await request.text());
      engine.calls.push(params);
      return engine.answer(params);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return engine;
}

const engine = setupEngine();
const wrapper = createWrapper(document.body);
const emulator = { endpoint: 'https://127.0.0.1:9302', port: 9302 };
const connected: CheckResult = { kind: 'connected', emulator, checkedAt: 1 };
const stopped: CheckResult = {
  kind: 'emulator-unreachable',
  emulator,
  checkedAt: 2,
  reason: 'not_started',
  message: '',
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

function heldResponse() {
  let release!: (value: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: release };
}

function open(path = '/aws/cloudformation', result: CheckResult | null = connected) {
  const router = createMemoryRouter([{ path: '/aws/*', element: <OutletArea /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current = result;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const getResult = () => current;
  function OutletArea() {
    const connection = useSyncExternalStore(subscribe, getResult);
    return (
      <AwsArea
        headerSelector="#top-bar"
        onPageTitle={() => undefined}
        onContentTarget={() => undefined}
        routeChanges={0}
        connection={{ result: connection ?? undefined, engineOrigin: engine.endpoint }}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    setConnection: (value: CheckResult) => {
      act(() => {
        current = value;
        listeners.forEach((listener) => {
          listener();
        });
      });
    },
  };
}

const refresh = () => screen.getByRole('button', { name: 'Refresh' });
const retry = () => screen.getByRole('button', { name: 'Retry' });
const next = () => screen.getByRole('button', { name: 'Next page' });
const previous = () => screen.getByRole('button', { name: 'Previous page' });
const filter = () => screen.getByRole('searchbox', { name: 'Filter by stack name' });
const tokens = () => engine.calls.map((params) => params.get('NextToken'));

function stackTable() {
  const table = wrapper.findTable();
  if (table === null) throw new Error('Expected the stacks table');
  return table;
}

function emptySlot() {
  const empty = stackTable().findEmptySlot();
  if (empty === null) throw new Error('Expected the stacks table empty slot');
  return within(empty.getElement());
}

function stackCell(row: number, column: number) {
  const cell = stackTable().findBodyCell(row, column);
  if (cell === null) throw new Error(`Expected a stacks table cell in row ${String(row)}, column ${String(column)}`);
  return cell.getElement();
}

function stackNames() {
  return stackTable()
    .findRows()
    .map((_, index) => stackCell(index + 1, 1).textContent?.trim());
}

function columnHeaders() {
  return stackTable()
    .findColumnHeaders()
    .map((header) => header.getElement().textContent?.trim());
}

function changeFilter(value: string) {
  fireEvent.change(filter(), { target: { value } });
}

async function expectStack(name: string) {
  await waitFor(() => {
    expect(stackNames()).toContain(name);
  });
}

function expectNoStack(name: string) {
  expect(stackNames()).not.toContain(name);
}

function expectNoPagination() {
  expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Page 1' })).not.toBeInTheDocument();
}

it.each(['/aws/cloudformation', '/aws/cloudformation/stacks'])(
  'shows the Stacks frame and notice at %s',
  async (path) => {
    engine.answer.mockReturnValueOnce(page([]));
    open(path);

    expect(screen.getByRole('heading', { level: 1, name: 'Stacks' })).toBeInTheDocument();
    const crumbs = wrapper
      .findBreadcrumbGroup()
      ?.findBreadcrumbLinks()
      .map((crumb) => crumb.getElement().textContent);
    expect(crumbs).toEqual(['EmuForge', 'AWS', 'CloudFormation', 'Stacks']);
    const active = wrapper.findSideNavigation()?.findActiveLink()?.getElement();
    expect(active).toHaveTextContent('Stacks');
    expect(active).toHaveAttribute('href', '/aws/cloudformation/stacks');

    expect(screen.getByText('These stacks are in your local emulator')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close the local emulator notice' }));
    expect(screen.queryByText('These stacks are in your local emulator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'About the local emulator' }));
    expect(screen.getByText('These stacks are in your local emulator')).toBeInTheDocument();
    await screen.findByText('No stacks');
  },
);

it('shows loading and distinct same-name rows, then refreshes to a genuinely empty page with a filter active', async () => {
  const first = heldResponse();
  engine.answer.mockReturnValueOnce(first.promise).mockReturnValueOnce(page([]));
  open();
  expect(stackTable().findLoadingText()?.getElement()).toHaveTextContent('Loading stacks');
  first.resolve(
    page([
      { ...summary('id-1', 'App'), TemplateDescription: 'Local deployment' },
      summary('id-2', 'App', 'DELETE_COMPLETE'),
    ]),
  );
  await expectStack('App');

  expect(stackNames()).toEqual(['App', 'App']);
  expect(columnHeaders()).toEqual(['Stack name', 'Status', 'Created', 'Description']);
  expect(stackCell(1, 1).textContent).toBe('App');
  expect(stackCell(2, 1).textContent).toBe('App');
  expect(within(stackCell(1, 1)).queryByRole('link')).not.toBeInTheDocument();
  expect(within(stackCell(2, 1)).queryByRole('link')).not.toBeInTheDocument();
  expect(stackCell(1, 2)).toHaveTextContent('CREATE_COMPLETE');
  expect(stackCell(2, 2)).toHaveTextContent('DELETE_COMPLETE');
  expect(stackCell(1, 3)).toHaveTextContent(creationDateText(new Date(CREATED)));
  expect(stackCell(1, 4)).toHaveTextContent('Local deployment');
  expect(stackCell(2, 4).textContent?.trim()).toBe('-');
  expectNoPagination();

  changeFilter('app');
  expect(stackNames()).toEqual(['App', 'App']);
  fireEvent.click(refresh());
  expect(await screen.findByText('No stacks')).toBeInTheDocument();
  expect(screen.getByText('Stacks created in this emulator will appear here.')).toBeInTheDocument();
  expect(screen.queryByText('No matching stacks')).not.toBeInTheDocument();
  expect(filter()).toHaveValue('app');
  expect(stackTable().findRows()).toHaveLength(0);
  expectNoPagination();
  expect(tokens()).toEqual([null, null]);
});

it('keeps a single status beside each name in a narrow table and retains the scroll cue and detail fields', async () => {
  const wideName = 'W'.repeat(24);
  const longStatus = 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS';
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(350);
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(640);
  engine.answer.mockReturnValueOnce(
    page([
      summary('id-1', 'Local stack'),
      { ...summary('id-2', wideName, longStatus), TemplateDescription: 'Recovery test' },
    ]),
  );
  open();
  await waitFor(() => {
    expect(stackTable().findRows()).toHaveLength(2);
  });
  const short = within(stackCell(1, 1));
  expect(short.getByText('Local stack')).toBeVisible();
  expect(short.getAllByText('CREATE_COMPLETE')).toHaveLength(1);
  const wide = within(stackCell(2, 1));
  expect(wide.getByText(wideName)).toBeVisible();
  expect(wide.getAllByText(longStatus)).toHaveLength(1);
  expect(columnHeaders()).toEqual(['Stack name and status', 'Created', 'Description']);
  expect(stackCell(2, 2)).toHaveTextContent(creationDateText(new Date(CREATED)));
  expect(stackCell(2, 3)).toHaveTextContent('Recovery test');
  expect(screen.getByText('Scroll sideways to see more columns.')).toBeVisible();
});

it('rejects a partial page and shows the complete page on retry', async () => {
  engine.answer
    .mockReturnValueOnce(page([summary('id-1', 'Complete stack'), { StackName: 'Incomplete stack' }]))
    .mockReturnValueOnce(page([summary('id-1', 'Complete stack'), summary('id-2', 'Fixed stack')]));
  open();

  await waitFor(() => {
    expect(emptySlot().getByText('Could not load stacks')).toBeInTheDocument();
  });
  expect(screen.getByText('The emulator returned an incomplete stack summary.')).toBeInTheDocument();
  expectNoStack('Complete stack');
  expect(screen.queryByText('No stacks')).not.toBeInTheDocument();
  fireEvent.click(retry());
  await expectStack('Complete stack');
  await expectStack('Fixed stack');
  expect(tokens()).toEqual([null, null]);
});

it('filters by case-insensitive substring on the current page without adding reads', async () => {
  engine.answer.mockReturnValueOnce(page([summary('id-1', 'DevWebApp'), summary('id-2', 'DevWorkers')], 'more'));
  open();
  await expectStack('DevWebApp');
  await expectStack('DevWorkers');

  changeFilter('wEb');
  expect(stackNames()).toEqual(['DevWebApp']);
  expect(filter()).toHaveAccessibleDescription(/1 match on this page/);
  expectNoStack('DevWorkers');
  filter().focus();
  vi.useFakeTimers();
  try {
    changeFilter('missing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(screen.getByText(/^0 matches on this page\.?$/, { selector: '[aria-live="polite"]' })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
  expect(filter()).toHaveFocus();
  expect(screen.getByText('No matching stacks')).toBeInTheDocument();
  expect(screen.getByText('Filters this page only.')).toBeInTheDocument();
  expect(next()).not.toHaveAttribute('aria-disabled', 'true');
  expect(tokens()).toEqual([null]);
  fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(filter()).toHaveValue('');
  expect(stackNames()).toEqual(['DevWebApp', 'DevWorkers']);
  expect(tokens()).toEqual([null]);
});

it('reads a continuation on demand and rereads the previous page from its original token', async () => {
  engine.answer
    .mockReturnValueOnce(page([summary('id-1', 'First')], 'more'))
    .mockReturnValueOnce(page([]))
    .mockReturnValueOnce(page([summary('id-2', 'Updated first')]));
  open();
  await expectStack('First');
  expect(tokens()).toEqual([null]);
  expect(previous()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(next());
  await screen.findByText('No stacks on this page');
  expect(screen.queryByText('Stacks created in this emulator will appear here.')).not.toBeInTheDocument();
  expect(next()).toHaveAttribute('aria-disabled', 'true');
  expect(previous()).not.toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(previous());
  await expectStack('Updated first');
  expect(tokens()).toEqual([null, 'more', null]);
  expectNoPagination();
});

it('resets the page and preserves the name filter on refresh and ignores a late response', async () => {
  const late = heldResponse();
  engine.answer
    .mockReturnValueOnce(page([summary('id-1', 'First')], 'old-token'))
    .mockReturnValueOnce(late.promise)
    .mockReturnValueOnce(page([summary('id-2', 'Refreshed first')], 'new-token'))
    .mockReturnValueOnce(page([summary('id-3', 'Refreshed second')]));
  open();
  await expectStack('First');
  fireEvent.click(next());
  await waitFor(() => {
    expect(tokens()).toEqual([null, 'old-token']);
  });
  changeFilter('reFreshed');
  fireEvent.click(refresh());
  await expectStack('Refreshed first');

  await act(async () => {
    late.resolve(page([summary('id-4', 'Refreshed late')], 'discard'));
  });
  expectNoStack('Refreshed late');
  expect(filter()).toHaveValue('reFreshed');
  fireEvent.click(next());
  await expectStack('Refreshed second');
  expect(tokens()).toEqual([null, 'old-token', null, 'new-token']);
});

it('discards visible rows and the token on disconnect and starts at the first page on recovery', async () => {
  engine.answer
    .mockReturnValueOnce(page([summary('id-1', 'Old first')], 'old-token'))
    .mockReturnValueOnce(page([summary('id-2', 'Current follow-up')], 'another-old-token'))
    .mockReturnValueOnce(page([]));
  const connection = open();
  await expectStack('Old first');
  fireEvent.click(next());
  await expectStack('Current follow-up');
  connection.setConnection(stopped);
  await screen.findByText(/Check that the local emulator is running on the configured port, then retry/);
  expectNoStack('Current follow-up');
  connection.setConnection({ ...connected, checkedAt: 3 });

  expect(await screen.findByText('No stacks')).toBeInTheDocument();
  expectNoStack('Current follow-up');
  expect(tokens()).toEqual([null, 'old-token', null]);
  expectNoPagination();
});

it.each([true, false])(
  'uses one fresh connected check to restart a failed continuation (restart succeeds: %s)',
  async (succeeds) => {
    const recoveryHelp = /Check that the local emulator is running on the configured port, then retry/;
    engine.answer
      .mockReturnValueOnce(page([summary('id-1', 'Old first page')], 'old-token'))
      .mockImplementation(() => refused(503, 'EmulatorUnavailable', 'The emulator stopped replying.'));
    const connection = open();
    await expectStack('Old first page');
    fireEvent.click(next());
    await screen.findByText(recoveryHelp);
    const outageCalls = tokens();
    expect(outageCalls.length).toBeGreaterThan(1);
    expect(outageCalls.slice(1)).toEqual(Array.from({ length: outageCalls.length - 1 }, () => 'old-token'));

    connection.setConnection({ ...connected });
    expect(screen.getByText(recoveryHelp)).toBeVisible();
    expect(tokens()).toEqual(outageCalls);
    if (succeeds) {
      engine.answer.mockReturnValueOnce(page([summary('id-2', 'New first page')]));
    }
    connection.setConnection({ ...connected, checkedAt: 2 });
    if (succeeds) {
      await expectStack('New first page');
      expect(tokens()).toEqual([...outageCalls, null]);
      expectNoPagination();
    } else {
      await screen.findByText(recoveryHelp);
      const recoveryCalls = tokens().slice(outageCalls.length);
      expect(recoveryCalls.length).toBeGreaterThan(0);
      expect(recoveryCalls.every((token) => token === null)).toBe(true);
    }

    const afterRecovery = tokens();
    connection.setConnection({ ...connected, checkedAt: 3 });
    if (succeeds) {
      expect(stackNames()).toEqual(['New first page']);
    } else {
      expect(screen.getByText(recoveryHelp)).toBeVisible();
      expect(retry()).toBeEnabled();
    }
    expect(tokens()).toEqual(afterRecovery);
  },
);

it.each([
  { status: 501, code: 'NotImplemented', title: 'Not implemented by the emulator' },
  { status: 403, code: 'AccessDenied', title: 'Access denied' },
])('shows the current disconnect over a stale $code response', async ({ status, code, title }) => {
  engine.answer
    .mockReturnValueOnce(refused(status, code, 'This session cannot list stacks.'))
    .mockReturnValueOnce(page([summary('id-1', 'Available after recovery')]));
  const connection = open();
  await waitFor(() => {
    expect(emptySlot().getByText(title)).toBeInTheDocument();
  });

  connection.setConnection(stopped);
  expect(
    emptySlot().getByText(/Check that the local emulator is running on the configured port, then retry/),
  ).toBeVisible();
  expect(emptySlot().queryByText(title)).not.toBeInTheDocument();
  expect(retry()).toBeEnabled();
  expect(refresh()).toBeEnabled();
  expect(tokens()).toEqual([null]);

  connection.setConnection({ ...connected, checkedAt: 3 });
  await expectStack('Available after recovery');
  expect(tokens()).toEqual([null, null]);
});

it.each([
  { action: 'Refresh', token: null },
  { action: 'Next page', token: 'more' },
])('clears old rows after a $action failure and retries the failed page', async ({ action, token }) => {
  engine.answer
    .mockReturnValueOnce(page([summary('id-1', 'Old row')], 'more'))
    .mockReturnValueOnce(refused(400, 'ValidationError', 'The stack list could not be prepared.'))
    .mockReturnValueOnce(page([summary('id-2', 'Recovered row')]));
  open();
  await expectStack('Old row');
  fireEvent.click(screen.getByRole('button', { name: action }));

  await waitFor(() => {
    expect(emptySlot().getByText('Could not load stacks')).toBeInTheDocument();
  });
  expect(screen.getByText('ValidationError')).toBeInTheDocument();
  expectNoStack('Old row');
  expect(screen.queryByText('No stacks')).not.toBeInTheDocument();
  fireEvent.click(retry());
  await expectStack('Recovered row');
  expect(tokens()).toEqual([null, token, token]);
});

it('explains a 501 on a continuation and leaves read actions disabled', async () => {
  engine.answer
    .mockReturnValueOnce(page([summary('id-1', 'First')], 'more'))
    .mockReturnValueOnce(refused(501, 'NotImplemented', 'Unsupported'));
  open();
  await expectStack('First');
  fireEvent.click(next());

  await waitFor(() => {
    expect(emptySlot().getByText('Not implemented by the emulator')).toBeInTheDocument();
  });
  expect(screen.getByText(/ListStacks/)).toBeInTheDocument();
  expect(refresh()).toBeDisabled();
  expect(retry()).toBeDisabled();
  expect(previous()).toHaveAttribute('aria-disabled', 'true');
  expect(next()).toHaveAttribute('aria-disabled', 'true');
  for (const button of [refresh(), retry(), previous(), next()]) fireEvent.click(button);
  expect(tokens()).toEqual([null, 'more']);
});

it('shows the access-denied reason and retries', async () => {
  engine.answer
    .mockReturnValueOnce(refused(403, 'AccessDenied', 'This session cannot list stacks.'))
    .mockReturnValueOnce(page([summary('id-1', 'Allowed stack')]));
  open();
  expect(await screen.findByText(/This session cannot list stacks/)).toBeInTheDocument();
  fireEvent.click(retry());
  await expectStack('Allowed stack');
  expect(tokens()).toEqual([null, null]);
});

it.each([
  { connection: 'connected', result: connected, target: 'engine' },
  { connection: 'connected', result: connected, target: 'emulator' },
  { connection: 'checking', result: null, target: 'engine' },
  { connection: 'checking', result: null, target: 'emulator' },
])('gives $target recovery steps immediately when the last status is $connection', async ({ result, target }) => {
  if (target === 'engine') {
    engine.answer.mockRejectedValue(new TypeError('Failed to fetch'));
  } else {
    engine.answer.mockImplementation(() => refused(503, 'EmulatorUnavailable', 'The emulator stopped replying.'));
  }
  open('/aws/cloudformation/stacks', result);

  if (target === 'engine') {
    expect(await screen.findByText('Check that the EmuForge engine is running, then retry.')).toBeInTheDocument();
  } else {
    expect(
      await screen.findByText(/Check that the local emulator is running on the configured port, then retry/),
    ).toHaveTextContent('The emulator stopped replying.');
  }
  const failedAttempts = engine.calls.length;
  expect(failedAttempts).toBeGreaterThan(0);
  engine.answer.mockReturnValueOnce(page([summary('id-1', 'Recovered stack')]));
  fireEvent.click(retry());
  await expectStack('Recovered stack');
  expect(tokens()).toEqual(Array.from({ length: failedAttempts + 1 }, () => null));
});
