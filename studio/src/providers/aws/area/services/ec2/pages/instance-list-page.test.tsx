import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import * as api from '../api';

// S1 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
// calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    listInstances: vi.fn(),
    getInstance: vi.fn(),
    getTerminationProtection: vi.fn(),
    actOnInstance: vi.fn(),
  };
});

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

function open(path = '/aws/ec2') {
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

// ---------------------------------------------------------------------------------------------------------------
// Instances and readers.

const LAUNCHED = new Date('2026-11-20T01:02:03.000Z');

function instance(id: string, state: string, changes: Partial<api.Instance> = {}): api.Instance {
  return {
    id,
    state,
    type: 't3.micro',
    zone: 'us-east-1a',
    privateIp: '172.31.0.5',
    publicIp: '54.0.0.1',
    launchTime: LAUNCHED,
    groups: [],
    volumes: [],
    tags: [],
    ...changes,
  };
}

/** `listInstances` answering each request from `pages`, by its filters and its token (`''` for none). */
function answer(pages: Record<string, api.InstancePage>) {
  vi.mocked(api.listInstances).mockImplementation((_endpoint, filters, token) => {
    const key = `${filters.state ?? ''}|${filters.name ?? ''}|${token ?? ''}`;
    return Promise.resolve(pages[key] ?? { instances: [] });
  });
}

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

async function expectRows(expected: string[][]) {
  await waitFor(() => {
    expect(rows()).toEqual(expected);
  });
}

function action(name: string): HTMLElement {
  return within(table().getElement()).getByRole('button', { name });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function reasonOf(element: Element): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

function selectRow(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

const launched = creationDateText(LAUNCHED);

const lastCall = () => vi.mocked(api.listInstances).mock.calls.at(-1);

// ---------------------------------------------------------------------------------------------------------------

describe('the instances list', () => {
  it('a row per instance with its values; "-" for an absent name or address; the ID links to its page; terminated like the others', async () => {
    answer({
      '||': {
        instances: [
          instance('i-1', 'running', { tags: [{ key: 'Name', value: 'web' }] }),
          instance('i-2', 'stopped', { publicIp: undefined } as Partial<api.Instance>),
          { id: 'i-3', state: 'terminated', type: 't3.nano', zone: 'us-east-1b', launchTime: LAUNCHED, groups: [], volumes: [], tags: [] },
        ],
      },
    });
    const router = open('/aws/ec2');
    await expectRows([
      ['web', 'i-1', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched],
      ['-', 'i-2', 'stopped', 't3.micro', 'us-east-1a', '-', '172.31.0.5', launched],
      ['-', 'i-3', 'terminated', 't3.nano', 'us-east-1b', '-', '-', launched],
    ]);
    expect(
      (table().findColumnHeaders() ?? []).map((header) => text(header.getElement())).slice(1),
    ).toEqual(['Name', 'Instance ID', 'State', 'Type', 'Availability Zone', 'Public IPv4', 'Private IPv4', 'Launched']);
    const link = screen.getByRole('link', { name: 'i-1' });
    expect(link).toHaveAttribute('href', '/aws/ec2/instances/instance/i-1');
    vi.mocked(api.getInstance).mockResolvedValue({ found: false });
    vi.mocked(api.getTerminationProtection).mockResolvedValue(false);
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/instances/instance/i-1');
    });
  });

  it('none, no filter → "No instances" with "Launch instance", which leads to the launch address', async () => {
    answer({});
    const router = open('/aws/ec2/instances');
    await waitFor(() => {
      expect(screen.getByText('No instances')).toBeInTheDocument();
    });
    expect(screen.getByText('The emulator holds no instance yet.')).toBeInTheDocument();
    const slot = table().findEmptySlot()?.getElement() as HTMLElement;
    fireEvent.click(within(slot).getByRole('link', { name: 'Launch instance' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/instances/launch');
    });
  });

  it('none with a filter → "No instances match" with "Clear filters", which empties both', async () => {
    answer({ '||': { instances: [instance('i-1', 'running')] } });
    open();
    await expectRows([['-', 'i-1', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched]]);
    PAGE.findSelect()?.openDropdown();
    PAGE.findSelect()?.selectOptionByValue('stopped');
    PAGE.findTextFilter()?.findInput().setInputValue('zzz');
    await waitFor(() => {
      expect(lastCall()?.[1]).toEqual({ state: 'stopped', name: 'zzz' });
    });
    await waitFor(() => {
      expect(screen.getByText('No instances match')).toBeInTheDocument();
    });
    expect(screen.queryByText('No instances')).toBeNull();
    fireEvent.click(within(table().findEmptySlot()?.getElement() as HTMLElement).getByRole('button', { name: 'Clear filters' }));
    await expectRows([['-', 'i-1', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched]]);
    expect(lastCall()?.[1]).toEqual({});
    expect(PAGE.findTextFilter()?.findInput().getInputValue()).toBe('');
    expect(text(PAGE.findSelect()?.findTrigger().getElement() as HTMLElement)).toContain('Any state');
  });

  it("the table's description says the name filter matches the Name tag and is case-sensitive", async () => {
    answer({});
    open();
    expect(await screen.findByText('The name filter matches the Name tag and is case-sensitive.')).toBeInTheDocument();
  });

  it('loading → "Loading instances"', async () => {
    vi.mocked(api.listInstances).mockImplementation(() => new Promise(() => undefined));
    open();
    await waitFor(() => {
      expect(screen.getByText('Loading instances')).toBeInTheDocument();
    });
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeInstances' },
      /Not implemented by the emulator.*DescribeInstances/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeInstances', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeInstances', message: 'timed out' },
      /The emulator did not answer/,
    ],
    ['the engine not answering', { kind: 'engine-did-not-answer', operation: 'DescribeInstances' }, /engine.*did not answer/],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeInstances', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeInstances', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listInstances).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(slot().textContent).toMatch(shown);
      });
      const calls = vi.mocked(api.listInstances).mock.calls.length;
      answer({ '||': { instances: [instance('i-back', 'running')] } });
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([['-', 'i-back', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched]]);
      expect(vi.mocked(api.listInstances).mock.calls.length).toBe(calls + 1);
    });
  }

  it('"State" and "Name" → asked with them from the first page; the next page asks with the token', async () => {
    answer({
      '||': { instances: [instance('i-1', 'running')], nextToken: 'tok-a' },
      'running|web|': { instances: [instance('i-2', 'running')], nextToken: 'tok-b' },
      'running|web|tok-b': { instances: [instance('i-3', 'running')] },
    });
    open();
    await expectRows([['-', 'i-1', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched]]);
    PAGE.findSelect()?.openDropdown();
    PAGE.findSelect()?.selectOptionByValue('running');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ state: 'running' }, undefined]);
    });
    PAGE.findTextFilter()?.findInput().setInputValue('web');
    await waitFor(() => {
      expect(lastCall()?.slice(1, 3)).toEqual([{ state: 'running', name: 'web' }, undefined]);
    });
    await expectRows([['-', 'i-2', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched]]);
    fireEvent.click(table().findPagination()?.findNextPageButton().getElement() as HTMLElement);
    await expectRows([['-', 'i-3', 'running', 't3.micro', 'us-east-1a', '54.0.0.1', '172.31.0.5', launched]]);
    expect(lastCall()?.slice(1, 3)).toEqual([{ state: 'running', name: 'web' }, 'tok-b']);
  });

  it('the state choices are "Any state" and the six states as the API names them', async () => {
    answer({});
    open();
    await screen.findByText('No instances');
    PAGE.findSelect()?.openDropdown();
    const options = (PAGE.findSelect()?.findDropdown().findOptions() ?? []).map((option) => text(option.getElement()));
    expect(options).toEqual(['Any state', 'pending', 'running', 'stopping', 'stopped', 'shutting-down', 'terminated']);
  });

  it('a row selected → the actions are that instance\'s; "Refresh" reads the page again and keeps the selection', async () => {
    answer({ '||': { instances: [instance('i-1', 'stopped', { tags: [{ key: 'Name', value: 'web' }] }), instance('i-2', 'running')] } });
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(reasonOf(action('Start'))).toBe('Select one instance.');
    selectRow('web');
    expect(isDisabled(action('Start'))).toBe(false);
    expect(reasonOf(action('Stop'))).toBe('Only a running instance can be stopped.');
    selectRow('i-2');
    expect(isDisabled(action('Stop'))).toBe(false);
    expect(reasonOf(action('Start'))).toBe('Only a stopped instance can be started.');

    const calls = vi.mocked(api.listInstances).mock.calls.length;
    fireEvent.click(action('Refresh'));
    await waitFor(() => {
      expect(vi.mocked(api.listInstances).mock.calls.length).toBe(calls + 1);
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(screen.getByRole('radio', { name: 'i-2' })).toBeChecked();
    expect(isDisabled(action('Stop'))).toBe(false);
  });

  it('an action on the selected row → sent with its id and its result in the flash', async () => {
    answer({ '||': { instances: [instance('i-2', 'running')] } });
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    selectRow('i-2');
    fireEvent.click(action('Stop'));
    await waitFor(() => {
      expect(screen.getByText('Stopping i-2')).toBeInTheDocument();
    });
    expect(vi.mocked(api.actOnInstance).mock.calls[0]?.slice(1, 3)).toEqual(['stop', 'i-2']);
  });

  it('"Launch instance" leads to the launch address; the notice names "instances"', async () => {
    answer({ '||': { instances: [instance('i-1', 'running')] } });
    const router = open();
    expect(await screen.findByText('These instances are in your local emulator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Instances/ })).toBeInTheDocument();
    fireEvent.click(within(table().getElement()).getByRole('link', { name: 'Launch instance' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/instances/launch');
    });
  });

  it('after an action, the reads that follow answering the later one first → the screen settles on the newest', async () => {
    const reads: { resolve: (page: api.InstancePage) => void }[] = [];
    vi.mocked(api.listInstances).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve({ instances: [instance('i-1', 'running')] });
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    selectRow('i-1');
    fireEvent.click(action('Reboot'));
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    await waitFor(() => {
      expect(isDisabled(action('Reboot'))).toBe(false);
    });
    fireEvent.click(action('Reboot'));
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve({ instances: [instance('i-1', 'running', { privateIp: '10.0.0.2' })] });
    });
    await waitFor(() => {
      expect(rows()[0]?.[6]).toBe('10.0.0.2');
    });
    act(() => {
      reads[1]?.resolve({ instances: [instance('i-1', 'stopped', { privateIp: '10.0.0.1' })] });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(rows()[0]?.slice(2, 3)).toEqual(['running']);
    expect(rows()[0]?.[6]).toBe('10.0.0.2');
  });
});
