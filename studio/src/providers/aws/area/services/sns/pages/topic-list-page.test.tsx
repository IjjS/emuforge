import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';

// S1 rendered inside the area's layout, as Studio's frame renders the area, with the calls of `api.ts` answered by
// the case (`api.test.ts` proves the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listTopics: vi.fn(), deleteTopic: vi.fn() };
});

const ACCOUNT = 'arn:aws:sns:us-east-1:000000000000';
const arnOf = (name: string) => `${ACCOUNT}:${name}`;

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

class Connection {
  value: AreaConnection = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  set(result: CheckResult | undefined) {
    this.value = { ...this.value, result };
    act(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

const EMULATOR = { port: 9309, endpoint: 'https://127.0.0.1:9309' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8309';

function AreaWithStudioProps() {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState({ pathname, changes: 0 });
  const current = useSyncExternalStore(connection.subscribe, connection.get);
  let changes = seen.changes;
  if (seen.pathname !== pathname) {
    changes += 1;
    setSeen({ pathname, changes });
  }
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      routeChanges={changes}
      connection={current}
    />
  );
}

function matchMedia(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', matchMedia);
  connection = new Connection();
  connection.value = { result: connectedResult(), engineOrigin: ENGINE };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(path = '/aws/sns/topics') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** `listTopics` answers each page from `pages`, by token. */
function holdTopics(pages: Record<string, api.TopicPage>) {
  vi.mocked(api.listTopics).mockImplementation((_, token) => Promise.resolve(pages[token ?? ''] ?? { arns: [] }));
}

// ---------------------------------------------------------------------------------------------------------------
// Readers.

const PAGE = createWrapper(document.body);

function table() {
  const found = PAGE.findTable();
  expect(found).not.toBeNull();
  return found as NonNullable<typeof found>;
}

const text = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim();

function rows(): string[][] {
  return (table().findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map(text),
  );
}

function action(name: string): HTMLElement {
  return within(table().getElement()).getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function select(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

async function expectRows(expected: string[][]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

// ---------------------------------------------------------------------------------------------------------------

describe('the topics list', () => {
  it('a row per topic with name, type and ARN; the name links to the topic’s page; the notice names "topics"', async () => {
    holdTopics({ '': { arns: [arnOf('orders'), arnOf('jobs.fifo')] } });
    const router = open('/aws/sns');
    await expectRows([
      ['orders', 'Standard', arnOf('orders')],
      ['jobs.fifo', 'FIFO', arnOf('jobs.fifo')],
    ]);
    expect(screen.getByRole('heading', { level: 1, name: /Topics/ })).toBeInTheDocument();
    expect(
      screen.getByText('A topic’s page shows who is subscribed and whether a notification can reach them.'),
    ).toBeInTheDocument();
    expect(screen.getByText('These topics are in your local emulator')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'orders' });
    expect(link).toHaveAttribute('href', `/aws/sns/topics/topic/${encodeURIComponent(arnOf('orders'))}`);
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/aws/sns/topics/topic/${encodeURIComponent(arnOf('orders'))}`);
    });
  });

  it('no topics → "No topics" with "Create topic", which leads to the create address', async () => {
    holdTopics({});
    const router = open();
    await waitFor(() => {
      expect(screen.getByText('No topics')).toBeInTheDocument();
    });
    expect(screen.getByText('The emulator holds no topic yet.')).toBeInTheDocument();
    const create = within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('link', {
      name: 'Create topic',
    });
    fireEvent.click(create);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/sns/topics/create');
    });
  });

  it('the next page asks with the token', async () => {
    holdTopics({ '': { arns: [arnOf('a')], nextToken: '100' }, '100': { arns: [arnOf('b')] } });
    open();
    await expectRows([['a', 'Standard', arnOf('a')]]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['b', 'Standard', arnOf('b')]]);
    expect(vi.mocked(api.listTopics).mock.calls.at(-1)?.[1]).toBe('100');
  });

  it('while loading → "Loading topics"', async () => {
    vi.mocked(api.listTopics).mockImplementation(() => new Promise(() => undefined));
    open();
    await waitFor(() => {
      expect(screen.getByText('Loading topics')).toBeInTheDocument();
    });
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    ['not implemented', { kind: 'not-implemented', operation: 'ListTopics' }, /501 Not Implemented for ListTopics/],
    ['access denied', { kind: 'access-denied', operation: 'ListTopics', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'ListTopics', message: 'timed out' },
      /The emulator did not answer/,
    ],
    ['the engine not answering', { kind: 'engine-did-not-answer', operation: 'ListTopics' }, /did not answer/],
    [
      'another code and message',
      { kind: 'other', operation: 'ListTopics', code: 'InternalError', message: 'broke' },
      /InternalError/,
    ],
    ['not connected', { kind: 'other', operation: 'ListTopics', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listTopics).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listTopics).mock.calls.length;
      holdTopics({ '': { arns: [arnOf('back')] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([['back', 'Standard', arnOf('back')]]);
      expect(vi.mocked(api.listTopics).mock.calls.length).toBe(calls + 1);
    });
  }

  it('a failed read is read again once the connection comes back', async () => {
    vi.mocked(api.listTopics).mockRejectedValue(
      new RequestError({ kind: 'engine-did-not-answer', operation: 'ListTopics' }),
    );
    open();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    holdTopics({});
    connection.set(notStartedResult());
    connection.set(connectedResult());
    await waitFor(() => {
      expect(screen.getByText('No topics')).toBeInTheDocument();
    });
  });

  it('no row selected → "Copy ARN" and "Delete" unavailable; selected, "Copy ARN" → the clipboard and "ARN copied"', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    holdTopics({ '': { arns: [arnOf('orders')] } });
    open();
    await expectRows([['orders', 'Standard', arnOf('orders')]]);
    expect(isDisabled(action('Copy ARN'))).toBe(true);
    expect(isDisabled(action('Delete'))).toBe(true);
    select('orders');
    expect(isDisabled(action('Delete'))).toBe(false);
    fireEvent.click(action('Copy ARN'));
    await waitFor(() => {
      expect(within(table().getElement()).getByText('ARN copied')).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith(arnOf('orders'));
    expect(api.deleteTopic).not.toHaveBeenCalled();
  });

  it('"Delete", the word typed, "Delete" → deleted and "Deleted topic {name}"', async () => {
    let arns = [arnOf('orders'), arnOf('keep')];
    vi.mocked(api.listTopics).mockImplementation(() => Promise.resolve({ arns }));
    vi.mocked(api.deleteTopic).mockImplementation((_, arn) => {
      arns = arns.filter((item) => item !== arn);
      return Promise.resolve();
    });
    open();
    await expectRows([
      ['orders', 'Standard', arnOf('orders')],
      ['keep', 'Standard', arnOf('keep')],
    ]);
    select('orders');
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(isDisabled(confirm)).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(screen.getByText('Deleted topic orders')).toBeInTheDocument();
    });
    expect(vi.mocked(api.deleteTopic).mock.calls[0]?.[1]).toBe(arnOf('orders'));
    await expectRows([['keep', 'Standard', arnOf('keep')]]);
  });

  it('a failed delete → the failure in the Flashbar and the row stays', async () => {
    holdTopics({ '': { arns: [arnOf('orders')] } });
    vi.mocked(api.deleteTopic).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DeleteTopic', code: 'InternalError', message: 'it broke' }),
    );
    open();
    await expectRows([['orders', 'Standard', arnOf('orders')]]);
    select('orders');
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getByText('Delete topic orders failed')).toBeInTheDocument();
    });
    expect(screen.getByText('InternalError')).toBeInTheDocument();
    expect(rows()).toEqual([['orders', 'Standard', arnOf('orders')]]);
  });
});
