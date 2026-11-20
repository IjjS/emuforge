import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import * as api from '../api';

// S3 rendered inside the area's layout, with the calls of `api.ts` answered by the case (`api.test.ts` proves the
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

function open(path: string) {
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
// An instance and readers.

const LAUNCHED = new Date('2026-11-20T01:02:03.000Z');
const pathOf = (id: string) => `/aws/ec2/instances/instance/${encodeURIComponent(id)}`;

function full(changes: Partial<api.Instance> = {}): api.Instance {
  return {
    id: 'i-0full',
    state: 'running',
    type: 't3.micro',
    imageId: 'ami-1234',
    launchTime: LAUNCHED,
    keyName: 'dev-key',
    zone: 'us-east-1a',
    subnetId: 'subnet-1',
    vpcId: 'vpc-1',
    privateIp: '172.31.0.5',
    publicIp: '54.0.0.1',
    privateDns: 'ip-172-31-0-5.ec2.internal',
    publicDns: 'ec2-54-0-0-1.compute-1.amazonaws.com',
    architecture: 'x86_64',
    platform: 'Linux/UNIX',
    groups: [{ id: 'sg-1', name: 'web-group' }],
    volumes: [
      { device: '/dev/xvda', volumeId: 'vol-1', deleteOnTermination: true },
      { device: '/dev/xvdb', volumeId: 'vol-2', deleteOnTermination: false },
    ],
    tags: [
      { key: 'Name', value: 'web-1' },
      { key: 'env', value: 'dev' },
    ],
    ...changes,
  };
}

function holding(instance: api.Instance | undefined, protection: boolean | Error = false) {
  vi.mocked(api.getInstance).mockResolvedValue(instance === undefined ? { found: false } : { found: true, instance });
  if (protection instanceof Error) {
    vi.mocked(api.getTerminationProtection).mockRejectedValue(protection);
  } else {
    vi.mocked(api.getTerminationProtection).mockResolvedValue(protection);
  }
}

/** `value` without the values `keys` name. */
function without(value: api.Instance, ...keys: (keyof api.Instance)[]): api.Instance {
  const copy = { ...value };
  for (const key of keys) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- a test's instance without an absent value
    delete copy[key];
  }
  return copy;
}

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The key-value sections as label → value. */
/** "Termination protection" while it reads On: the value, and below it the operation that changes it. */
const CHANGED = 'Changed with ModifyInstanceAttribute.';
const PROTECTED = `On${CHANGED}`;

function pairs(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const group of PAGE.findAllKeyValuePairs()) {
    for (const item of group.findItems()) {
      result[text(item.findLabel()?.getElement())] = text(item.findValue()?.getElement());
    }
  }
  return result;
}

/** A table of the page by its heading, as rows of cell texts, or its empty text. */
function tableOf(heading: string) {
  const found = PAGE.findAllTables().find((table) => text(table.findHeaderSlot()?.getElement()).startsWith(heading));
  expect(found, heading).toBeDefined();
  const table = found as NonNullable<typeof found>;
  return {
    rows: (table.findRows() ?? []).map((row) => [...row.getElement().querySelectorAll('td, th')].map(text)),
    empty: text(table.findEmptySlot()?.getElement()),
    element: table.getElement(),
  };
}

async function loaded() {
  await waitFor(() => {
    expect(screen.getByText('Instance details')).toBeInTheDocument();
  });
}

function copyButtons(): string[] {
  return screen
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '')
    .filter((label) => label.startsWith('Copy '));
}

function headerButton(name: string): HTMLElement {
  const header = PAGE.findContentLayout()?.findHeader()?.getElement() as HTMLElement;
  return within(header).getByRole('button', { name });
}

/** An item of the "Instance state" menu, the menu opened from its button. */
function stateItem(name: string): HTMLElement {
  const menu = screen.getByRole('button', { name: /^Instance state/ });
  if (menu.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(menu);
  }
  const found = screen.getAllByRole('menuitem').find((element) => element.textContent?.trim() === name);
  expect(found, name).toBeDefined();
  return found as HTMLElement;
}

/** Chooses `name` from the "Instance state" menu. */
function choose(name: string) {
  fireEvent.click(stateItem(name));
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

/** The reason a disabled item gives, as Cloudscape renders it for assistive technology. */
function reasonOf(element: Element): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

/** The menu's "Terminate": "available", or the reason it is not. */
function terminate(): string {
  const element = stateItem('Terminate');
  return isDisabled(element) ? reasonOf(element) : 'available';
}

// ---------------------------------------------------------------------------------------------------------------

describe("an instance's page", () => {
  it('termination protection "On" → the menu\'s "Terminate" unavailable with "Termination protection is on."', async () => {
    holding(full(), true);
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe(PROTECTED);
    });
    expect(terminate()).toBe('Termination protection is on.');
  });

  it('termination protection "On" → below the value "Changed with ModifyInstanceAttribute.", the pair beside "State"', async () => {
    holding(full(), true);
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe(PROTECTED);
    });
    const value = PAGE.findAllKeyValuePairs()
      .flatMap((group) => group.findItems())
      .find((item) => text(item.findLabel()?.getElement()) === 'Termination protection')
      ?.findValue()
      ?.getElement() as HTMLElement;
    const lines = [...value.querySelectorAll('*')]
      .filter((node) => node.children.length === 0)
      .map((node) => node.textContent);
    expect(lines).toEqual(['On', CHANGED]);
    const labels = Object.keys(pairs());
    expect(labels.indexOf('Termination protection')).toBe(labels.indexOf('State') + 1);
  });

  it('termination protection "Off", being read or failed → no "Changed with ModifyInstanceAttribute."', async () => {
    holding(full(), false);
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe('Off');
    });
    expect(screen.queryByText(CHANGED)).toBeNull();
    cleanup();

    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: full() });
    vi.mocked(api.getTerminationProtection).mockImplementation(() => new Promise(() => undefined));
    open(pathOf('i-0full'));
    await loaded();
    expect(pairs()['Termination protection']).toBe('Loading');
    expect(screen.queryByText(CHANGED)).toBeNull();
    cleanup();

    holding(full(), new RequestError({ kind: 'other', operation: 'DescribeInstanceAttribute', code: 'InternalError' }));
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toContain('InternalError');
    });
    expect(screen.queryByText(CHANGED)).toBeNull();
  });

  it('"Off", being read or failed → the menu\'s "Terminate" available by the state', async () => {
    holding(full(), false);
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe('Off');
    });
    expect(terminate()).toBe('available');
    cleanup();

    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: full() });
    vi.mocked(api.getTerminationProtection).mockImplementation(() => new Promise(() => undefined));
    open(pathOf('i-0full'));
    await loaded();
    expect(pairs()['Termination protection']).toBe('Loading');
    expect(terminate()).toBe('available');
    cleanup();

    holding(full(), new RequestError({ kind: 'other', operation: 'DescribeInstanceAttribute', code: 'InternalError' }));
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toContain('InternalError');
    });
    expect(terminate()).toBe('available');
  });

  it('a running instance with every value → its name, the five sections, copy controls, a group link, Yes and No', async () => {
    holding(full(), true);
    const router = open(pathOf('i-0full'));
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'web-1' })).toBeInTheDocument();
    expect(vi.mocked(api.getInstance).mock.calls[0]?.[1]).toBe('i-0full');
    expect(vi.mocked(api.getTerminationProtection).mock.calls[0]?.[1]).toBe('i-0full');
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe(PROTECTED);
    });
    expect(pairs()).toEqual({
      'Instance ID': 'i-0full',
      State: 'running',
      Type: 't3.micro',
      'Image ID': 'ami-1234',
      Launched: creationDateText(LAUNCHED),
      'Key pair': 'dev-key',
      Architecture: 'x86_64',
      Platform: 'Linux/UNIX',
      'Termination protection': PROTECTED,
      'Availability Zone': 'us-east-1a',
      'Subnet ID': 'subnet-1',
      'VPC ID': 'vpc-1',
      'Private IPv4': '172.31.0.5',
      'Public IPv4': '54.0.0.1',
      'Private DNS name': 'ip-172-31-0-5.ec2.internal',
      'Public DNS name': 'ec2-54-0-0-1.compute-1.amazonaws.com',
    });
    for (const heading of ['Instance details', 'Network']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(copyButtons().sort()).toEqual(
      [
        'Copy Instance ID',
        'Copy Image ID',
        'Copy Private IPv4',
        'Copy Public IPv4',
        'Copy Private DNS name',
        'Copy Public DNS name',
        'Copy Volume ID',
        'Copy Volume ID',
      ].sort(),
    );
    const groups = tableOf('Security groups');
    expect(groups.rows).toEqual([['web-group', 'sg-1']]);
    expect(tableOf('Volumes').rows).toEqual([
      ['/dev/xvda', 'vol-1', 'Yes'],
      ['/dev/xvdb', 'vol-2', 'No'],
    ]);
    expect(tableOf('Tags').rows).toEqual([
      ['Name', 'web-1'],
      ['env', 'dev'],
    ]);
    expect(screen.getByRole('link', { name: 'dev-key' })).toHaveAttribute('href', '/aws/ec2/key-pairs');
    const link = within(groups.element).getByRole('link', { name: 'web-group' });
    expect(link).toHaveAttribute('href', '/aws/ec2/security-groups/group/sg-1');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/group/sg-1');
    });
  });

  it('links a reported block device to its volume from the instance view', async () => {
    holding(full());
    const router = open(pathOf('i-0full'));
    const link = await screen.findByRole('link', { name: 'vol-1' });
    expect(screen.getByRole('heading', { level: 1, name: 'web-1' })).toBeInTheDocument();
    expect(await screen.findByText('These instances are in your local emulator')).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/aws/ec2/volumes/volume/vol-1');
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/aws/ec2/volumes/volume/vol-1'));
  });

  it('no name → the heading is its ID; stopped → the state with its reason and "Public IPv4" "-" with no copy control', async () => {
    holding(
      without(
        full({
          state: 'stopped',
          stateReason: 'Client.UserInitiatedShutdown: User initiated shutdown',
          tags: [{ key: 'env', value: 'dev' }],
        }),
        'publicIp',
        'publicDns',
      ),
    );
    open(pathOf('i-0full'));
    await loaded();
    expect(screen.getByRole('heading', { level: 1, name: 'i-0full' })).toBeInTheDocument();
    expect(pairs()['State']).toMatch(/^stopped\s*Client\.UserInitiatedShutdown: User initiated shutdown$/);
    expect(pairs()['Public IPv4']).toBe('-');
    expect(copyButtons()).not.toContain('Copy Public IPv4');
    expect(copyButtons()).not.toContain('Copy Public DNS name');
  });

  it('terminated → "-" for what it no longer has, "No security groups"', async () => {
    holding({
      id: 'i-0full',
      state: 'terminated',
      type: 't3.micro',
      imageId: 'ami-1234',
      launchTime: LAUNCHED,
      zone: 'us-east-1a',
      groups: [],
      volumes: [],
      tags: [],
    });
    open(pathOf('i-0full'));
    await loaded();
    const values = pairs();
    for (const label of [
      'Key pair',
      'Subnet ID',
      'VPC ID',
      'Private IPv4',
      'Public IPv4',
      'Private DNS name',
      'Public DNS name',
    ]) {
      expect(values[label], label).toBe('-');
    }
    expect(values['State']).toBe('terminated');
    expect(tableOf('Security groups').empty).toBe('No security groups');
  });

  it('no block device → "No volumes"; no tag → "No tags"', async () => {
    holding(full({ volumes: [], tags: [] }));
    open(pathOf('i-0full'));
    await loaded();
    expect(tableOf('Volumes').empty).toBe('No volumes');
    expect(tableOf('Tags').empty).toBe('No tags');
  });

  it('termination protection "Off"; loading in that value alone while it is read', async () => {
    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: full() });
    let settle: (value: boolean) => void = () => undefined;
    vi.mocked(api.getTerminationProtection).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    open(pathOf('i-0full'));
    await loaded();
    expect(pairs()['Termination protection']).toBe('Loading');
    expect(pairs()['Instance ID']).toBe('i-0full');
    act(() => {
      settle(false);
    });
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe('Off');
    });
  });

  it('its read failed → the failure in that value alone, the rest shown', async () => {
    holding(
      full(),
      new RequestError({
        kind: 'other',
        operation: 'DescribeInstanceAttribute',
        code: 'InternalError',
        message: 'broke',
      }),
    );
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => {
      expect(pairs()['Termination protection']).toContain('InternalError');
    });
    expect(pairs()['Instance ID']).toBe('i-0full');
    expect(tableOf('Tags').rows).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('an empty answer → "Instance not found" with "View instances", and no section or action', async () => {
    holding(undefined);
    vi.mocked(api.listInstances).mockResolvedValue({ instances: [] });
    const router = open(pathOf('i-gone'));
    await waitFor(() => {
      expect(screen.getByText('Instance not found')).toBeInTheDocument();
    });
    expect(screen.getByText('The emulator holds no instance with this ID.')).toBeInTheDocument();
    expect(screen.queryByText('Instance details')).toBeNull();
    expect(screen.queryByText('Network')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Instance state' })).toBeNull();
    for (const name of ['Start', 'Stop', 'Reboot', 'Terminate']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    for (const heading of ['Security groups', 'Volumes', 'Tags']) {
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
    }
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View instances' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/instances');
    });
  });

  it('loading → "Loading instance"', async () => {
    vi.mocked(api.getInstance).mockImplementation(() => new Promise(() => undefined));
    vi.mocked(api.getTerminationProtection).mockImplementation(() => new Promise(() => undefined));
    open(pathOf('i-0full'));
    await waitFor(() => {
      expect(screen.getByText('Loading instance')).toBeInTheDocument();
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
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeInstances' },
      /engine.*did not answer/,
    ],
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
      vi.mocked(api.getInstance).mockRejectedValue(new RequestError(failure));
      vi.mocked(api.getTerminationProtection).mockResolvedValue(false);
      open(pathOf('i-0full'));
      await waitFor(() => {
        expect(text(PAGE.findContentLayout()?.getElement())).toMatch(shown);
      });
      const calls = vi.mocked(api.getInstance).mock.calls.length;
      vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: full() });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await loaded();
      expect(vi.mocked(api.getInstance).mock.calls.length).toBe(calls + 1);
    });
  }

  it("the header's actions are the instance's; after Terminate is confirmed the page stays; Refresh reads both again", async () => {
    holding(full({ state: 'stopped' }));
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    const router = open(pathOf('i-0full'));
    await loaded();
    expect(isDisabled(stateItem('Start'))).toBe(false);
    expect(isDisabled(stateItem('Stop'))).toBe(true);
    expect(isDisabled(stateItem('Reboot'))).toBe(true);
    choose('Terminate');
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('web-1 is terminated in the local emulator.');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'terminate' } });
    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: full({ state: 'terminated' }) });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminate' }));
    await waitFor(() => {
      expect(screen.getByText('Terminating i-0full')).toBeInTheDocument();
    });
    expect(vi.mocked(api.actOnInstance).mock.calls[0]?.slice(1, 3)).toEqual(['terminate', 'i-0full']);
    await waitFor(() => {
      expect(pairs()['State']).toBe('terminated');
    });
    expect(router.state.location.pathname).toBe(pathOf('i-0full'));

    const reads = vi.mocked(api.getInstance).mock.calls.length;
    const protections = vi.mocked(api.getTerminationProtection).mock.calls.length;
    fireEvent.click(headerButton('Refresh'));
    await waitFor(() => {
      expect(vi.mocked(api.getInstance).mock.calls.length).toBe(reads + 1);
    });
    await waitFor(() => {
      expect(vi.mocked(api.getTerminationProtection).mock.calls.length).toBe(protections + 1);
    });
    await loaded();
  });

  it("a tag's value that holds markup is shown as text", async () => {
    holding(full({ tags: [{ key: 'note', value: '<b>bold</b><img src=x onerror=alert(1)>' }] }));
    open(pathOf('i-0full'));
    await loaded();
    expect(tableOf('Tags').rows).toEqual([['note', '<b>bold</b><img src=x onerror=alert(1)>']]);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('after an action, the reads that follow answering the later one first → the newest read, for the instance and its protection', async () => {
    const reads: ((value: api.InstanceRead) => void)[] = [];
    const protections: ((value: boolean) => void)[] = [];
    vi.mocked(api.getInstance).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
    );
    vi.mocked(api.getTerminationProtection).mockImplementation(
      () =>
        new Promise((resolve) => {
          protections.push(resolve);
        }),
    );
    vi.mocked(api.actOnInstance).mockResolvedValue(undefined);
    open(pathOf('i-0full'));
    await waitFor(() => {
      expect(reads).toHaveLength(1);
      expect(protections).toHaveLength(1);
    });
    act(() => {
      reads[0]?.({ found: true, instance: full() });
      protections[0]?.(false);
    });
    await loaded();
    choose('Reboot');
    await waitFor(() => {
      expect(reads).toHaveLength(2);
      expect(protections).toHaveLength(2);
    });
    await waitFor(() => {
      expect(isDisabled(stateItem('Reboot'))).toBe(false);
    });
    choose('Reboot');
    await waitFor(() => {
      expect(reads).toHaveLength(3);
      expect(protections).toHaveLength(3);
    });
    act(() => {
      reads[2]?.({ found: true, instance: full({ privateIp: '10.0.0.2' }) });
      protections[2]?.(true);
    });
    await waitFor(() => {
      expect(pairs()['Private IPv4']).toBe('10.0.0.2');
      expect(pairs()['Termination protection']).toBe(PROTECTED);
    });
    act(() => {
      reads[1]?.({ found: true, instance: full({ state: 'stopped', privateIp: '10.0.0.1' }) });
      protections[1]?.(false);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(pairs()['State']).toBe('running');
    expect(pairs()['Private IPv4']).toBe('10.0.0.2');
    expect(pairs()['Termination protection']).toBe(PROTECTED);
  });
});
