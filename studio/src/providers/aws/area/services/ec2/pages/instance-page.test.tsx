import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, requestFailure, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { nameOf } from '../../../lib/ec2-client';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import * as api from '../api';
import { modifyInstanceAttribute } from '../instance-attribute-api';
import { changeInstanceContent, getInstanceUserData } from '../instance-content-api';
import { EC2_KEYS, useInstanceListing } from '../queries';
import { getVolume } from '../volume-api';

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

vi.mock('../instance-attribute-api', async (original) => ({
  ...(await original<typeof import('../instance-attribute-api')>()),
  modifyInstanceAttribute: vi.fn(),
}));

vi.mock('../instance-content-api', async (original) => ({
  ...(await original<typeof import('../instance-content-api')>()),
  changeInstanceContent: vi.fn(),
  getInstanceUserData: vi.fn(),
}));

vi.mock('../volume-api', async (original) => ({
  ...(await original<typeof import('../volume-api')>()),
  getVolume: vi.fn(),
}));

// ---------------------------------------------------------------------------------------------------------------
// The area as Studio's frame renders it.

class Connection {
  value: AreaConnection & { targetGeneration?: number } = { result: undefined, engineOrigin: undefined };
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = () => this.value;

  changeTarget() {
    this.value = { ...this.value, targetGeneration: (this.value.targetGeneration ?? 0) + 1 };
    for (const listener of this.listeners) listener();
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
      targetGeneration={current.targetGeneration}
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

function ListingObserver() {
  const listing = useInstanceListing(ENGINE, { state: '', name: '' });
  return (
    <output aria-label="Observed instance list">{listing.items?.map(({ tags }) => nameOf(tags)).join(', ')}</output>
  );
}

function open(
  path: string,
  observeList = false,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      {observeList && <ListingObserver />}
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
      const value = item.findValue()?.getElement().cloneNode(true) as HTMLElement | undefined;
      value?.querySelectorAll('[data-testid="instance-attribute-action"]').forEach((action) => action.remove());
      const label = text(item.findLabel()?.getElement());
      result[label] = text(value);
    }
  }
  return result;
}

/** A table of the page by its heading, as rows of cell texts, or its empty text. */
function tableOf(heading: string) {
  const found = PAGE.findAllTables().find((table) =>
    text(table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement()).startsWith(heading),
  );
  expect(found, heading).toBeDefined();
  const table = found as NonNullable<typeof found>;
  return {
    rows: table
      .findRows()
      .map((_, row) =>
        table.findColumnHeaders().map((_, column) => text(table.findBodyCell(row + 1, column + 1)?.getElement())),
      ),
    wrapper: table,
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
      .filter((node) => node.closest('[data-testid="instance-attribute-action"]') === null)
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
      'User data': 'Edit user dataStop the instance to edit user data.',
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
      ['NameEdit tagDelete tag', 'web-1'],
      ['envEdit tagDelete tag', 'dev'],
    ]);
    expect(screen.getByRole('link', { name: 'dev-key' })).toHaveAttribute('href', '/aws/ec2/key-pairs');
    const link = within(groups.element).getByRole('link', { name: 'web-group' });
    expect(link).toHaveAttribute('href', '/aws/ec2/security-groups/group/sg-1');
    fireEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/security-groups/group/sg-1');
    });
  });

  it('draws repeated spaces in the key pair and group links and gives each its exact identity', async () => {
    const keyName = 'dev  key';
    const groupName = 'dev  group';
    const keyIdentity = 'dev\\u0020\\u0020key';
    const groupIdentity = 'dev\\u0020\\u0020group';
    holding(full({ keyName, groups: [{ id: 'sg-1', name: groupName }] }));
    open(pathOf('i-0full'));

    const key = await screen.findByRole('link', { name: keyIdentity });
    expect(key.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${keyName} (${keyIdentity})`);
    const group = within(tableOf('Security groups').element).getByRole('link', { name: groupIdentity });
    expect(group.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${groupName} (${groupIdentity})`);
    expect(group).toHaveAttribute('href', '/aws/ec2/security-groups/group/sg-1');
  });

  it('draws repeated spaces in the instance heading and names it by the Name tag identity', async () => {
    const name = 'dev  instance';
    const identity = 'dev\\u0020\\u0020instance';
    holding(full({ tags: [{ key: 'Name', value: name }] }));
    open(pathOf('i-0full'));

    const heading = await screen.findByRole('heading', { level: 1, name: identity });
    expect(heading.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${name} (${identity})`);
  });

  it('links a reported block device to its volume from the instance view', async () => {
    holding(full());
    vi.mocked(getVolume).mockResolvedValue({
      found: true,
      volume: { id: 'vol-1', size: 16, state: 'available', attachments: [] },
    });
    const router = open(pathOf('i-0full'));
    const volumes = await waitFor(() => {
      const table = PAGE.findContentLayout()?.findContent().findAllTables()[1];
      if (table === undefined) throw new Error('Missing instance volumes table');
      return table;
    });
    expect(volumes.findHeaderSlot()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent('Volumes');
    const link = volumes.findBodyCell(1, 2)?.findLink();
    if (link == null) throw new Error('Missing linked volume ID');
    expect(link.getElement()).toHaveAccessibleName('vol-1');
    expect(link.getElement()).toHaveAttribute('href', '/aws/ec2/volumes/volume/vol-1');
    const heading = PAGE.findContentLayout()?.findHeader()?.findHeader()?.findHeadingText().getElement();
    expect(heading?.closest('h1')).toBeVisible();
    expect(heading).toHaveTextContent('web-1');
    await waitFor(() => {
      const notice = PAGE.find('[aria-label="Local emulator notice"]')?.findAlert();
      expect(notice?.findHeader()?.getElement()).toHaveTextContent('These instances are in your local emulator');
    });

    fireEvent.click(link.getElement());
    await waitFor(() => {
      const detail = PAGE.findContentLayout()?.findContent().findContainer();
      expect(detail?.findHeader()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent('Volume details');
    });
    expect(router.state.location.pathname).toBe('/aws/ec2/volumes/volume/vol-1');
    expect(getVolume).toHaveBeenCalledWith(ENGINE, 'vol-1', expect.any(AbortSignal));
    expect(pairs()).toMatchObject({ 'Volume ID': 'vol-1', Size: '16 GiB', State: 'available' });
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
    const dialog = await modalWithTitle('Terminate instance?');
    expect(dialog.findContent().getElement()).toHaveTextContent('web-1 is terminated in the local emulator.');
    const input = dialog.findContent().findInput()?.findNativeInput().getElement();
    if (input === undefined) throw new Error('Missing termination confirmation input');
    fireEvent.change(input, { target: { value: 'terminate' } });
    vi.mocked(api.getInstance).mockResolvedValue({ found: true, instance: full({ state: 'terminated' }) });
    primaryModalAction(dialog, 'Terminate').click();
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
    expect(tableOf('Tags').rows).toEqual([['noteEdit tagDelete tag', '<b>bold</b><img src=x onerror=alert(1)>']]);
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

describe('instance setting actions', () => {
  async function changeProtection() {
    const action = await screen.findByRole('button', { name: 'Change termination protection' });
    await waitFor(() => expect(isDisabled(action)).toBe(false));
    fireEvent.click(action);
    const modal = await waitFor(() => {
      const wrapper = PAGE.findModal();
      if (wrapper === null) throw new Error('Missing termination protection modal');
      expect(wrapper.findHeader().getElement()).toHaveTextContent('Change termination protection');
      return wrapper;
    });
    modal.findContent().findToggle()?.findNativeInput().click();
    const save = modal.findFooter()?.findAllButtons()[1];
    expect(save?.getElement()).toHaveAccessibleName('Save changes');
    save?.click();
  }

  function holdAttributeWrite() {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    vi.mocked(modifyInstanceAttribute).mockImplementationOnce(
      () =>
        new Promise<void>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    return { resolve: () => resolve(), reject: (error: Error) => reject(error) };
  }

  it('explains the stopped requirement and makes groups and protection editable on a running instance', async () => {
    holding(full());
    open(pathOf('i-0full'));
    await loaded();
    const type = screen.getByRole('button', { name: 'Change instance type' });
    expect(isDisabled(type)).toBe(true);
    expect(reasonOf(type)).toBe('Stop the instance to change its type.');
    expect(isDisabled(screen.getByRole('button', { name: 'Change security groups' }))).toBe(false);
    await waitFor(() => {
      expect(isDisabled(screen.getByRole('button', { name: 'Change termination protection' }))).toBe(false);
    });
  });

  it.each(['detail', 'protection'] as const)('keeps the result when the %s refresh finishes first', async (first) => {
    const nextProtection = first === 'detail';
    const client = new QueryClient();
    holding(full(), !nextProtection);
    vi.mocked(modifyInstanceAttribute).mockResolvedValue(undefined);
    open(pathOf('i-0full'), false, client);
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe(nextProtection ? 'Off' : PROTECTED);
    });
    let finishDetail: (read: api.InstanceRead) => void = () => undefined;
    let finishProtection: (enabled: boolean) => void = () => undefined;
    vi.mocked(api.getInstance).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDetail = resolve;
        }),
    );
    vi.mocked(api.getTerminationProtection).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishProtection = resolve;
        }),
    );
    await changeProtection();
    const flash = await waitFor(() => {
      const item = PAGE.findFlashbar()?.findItemsByType('success')[0];
      expect(item?.findContent()?.getElement()).toHaveTextContent('Termination protection updated.');
      return item?.getElement();
    });
    expect(vi.mocked(modifyInstanceAttribute)).toHaveBeenCalledWith(
      ENGINE,
      'i-0full',
      { kind: 'protection', enabled: nextProtection },
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(api.getInstance).toHaveBeenCalledTimes(2);
      expect(api.getTerminationProtection).toHaveBeenCalledTimes(2);
    });

    const detail = () => finishDetail({ found: true, instance: full({ privateIp: '10.0.0.2' }) });
    const protection = () => finishProtection(nextProtection);
    await act(first === 'detail' ? detail : protection);
    await waitFor(() => expect(client.isFetching()).toBe(1));
    await act(first === 'detail' ? protection : detail);
    await waitFor(() => {
      expect(pairs()['Termination protection']).toBe(nextProtection ? PROTECTED : 'Off');
      expect(terminate()).toBe(nextProtection ? 'Termination protection is on.' : 'available');
      expect(pairs()['Private IPv4']).toBe('10.0.0.2');
    });
    expect(PAGE.findFlashbar()?.findItemsByType('success')[0]?.getElement()).toBe(flash);
    expect(flash).toBeVisible();
  });

  it.each(['success', 'error'] as const)('publishes a pending write’s %s after detail disappears', async (outcome) => {
    const client = new QueryClient();
    holding(full());
    const write = holdAttributeWrite();
    open(pathOf('i-0full'), false, client);
    await changeProtection();
    const signal = vi.mocked(modifyInstanceAttribute).mock.lastCall?.[3];
    expect(signal?.aborted).toBe(false);

    holding(undefined);
    await act(() => client.invalidateQueries({ queryKey: EC2_KEYS.instance('i-0full') }));
    await waitFor(() => {
      expect(PAGE.findContentLayout()?.findContent().getElement()).toHaveTextContent('Instance not found');
      expect(PAGE.findModal()).toBeNull();
    });
    expect(signal?.aborted).toBe(false);

    const reason = 'The local policy denied the protection change.';
    await act(() => {
      if (outcome === 'success') write.resolve();
      else {
        write.reject(
          new RequestError(
            requestFailure('ModifyInstanceAttribute', {
              Code: 'AccessDeniedException',
              message: reason,
              $fault: 'client',
              $metadata: { httpStatusCode: 403 },
            }),
          ),
        );
      }
    });
    await waitFor(() => {
      const item = PAGE.findFlashbar()?.findItemsByType(outcome)[0];
      expect(item?.findContent()?.getElement()).toHaveTextContent(
        outcome === 'success' ? 'Termination protection updated.' : `AccessDeniedException: ${reason}`,
      );
      if (outcome === 'error') {
        expect(item?.getElement()).toHaveAttribute('role', 'alert');
      }
    });
  });

  it('cancels a pending attribute write when visiting another instance', async () => {
    holding(full());
    const write = holdAttributeWrite();
    const router = open(pathOf('i-0full'));
    await changeProtection();
    const signal = vi.mocked(modifyInstanceAttribute).mock.lastCall?.[3];
    expect(signal?.aborted).toBe(false);

    holding(full({ id: 'i-next', tags: [] }));
    await act(() => router.navigate(pathOf('i-next')));
    expect(signal?.aborted).toBe(true);
    await act(write.resolve);
    expect(PAGE.findContentLayout()?.findHeader()?.findHeader()?.findHeadingText().getElement()).toHaveTextContent(
      'i-next',
    );
    expect(PAGE.findFlashbar()).toBeNull();
  });

  it('shows a failed protection read without offering an editable Off value', async () => {
    holding(
      full(),
      new RequestError({
        kind: 'other',
        operation: 'DescribeInstanceAttribute',
        code: 'InternalError',
        message: 'Protection read failed',
      }),
    );
    open(pathOf('i-0full'));
    await loaded();
    await waitFor(() => expect(pairs()['Termination protection']).toContain('InternalError: Protection read failed'));
    expect(pairs()['Termination protection']).not.toContain('Off');
    const edit = screen.getByRole('button', { name: 'Change termination protection' });
    expect(isDisabled(edit)).toBe(true);
    fireEvent.click(edit);
    expect(PAGE.findModal()).toBeNull();
    expect(modifyInstanceAttribute).not.toHaveBeenCalled();
  });
});

function tagButton(action: 'edit' | 'delete') {
  const button = tableOf('Tags').wrapper.findBodyCell(1, 1)?.findAllButtons()[action === 'edit' ? 0 : 1];
  if (button === undefined) throw new Error(`Missing ${action} action for the Name tag`);
  expect(button.getElement()).toHaveAccessibleName(action === 'edit' ? 'Edit tag Name' : 'Delete tag Name');
  return button.getElement();
}

function detailHeading() {
  return PAGE.findContentLayout()?.findHeader()?.findHeader()?.findHeadingText().getElement();
}

function flashItem(type: 'success' | 'error') {
  return PAGE.findFlashbar()?.findItemsByType(type)[0];
}

function modalWithTitle(title: string) {
  return waitFor(() => {
    const modal = PAGE.findModal();
    if (modal === null) throw new Error(`Missing ${title} dialog`);
    expect(modal.findHeader().getElement()).toHaveTextContent(title);
    return modal;
  });
}

function primaryModalAction(modal: NonNullable<ReturnType<typeof PAGE.findModal>>, name: string) {
  const button = modal.findFooter()?.findAllButtons()[1];
  if (button === undefined) throw new Error(`Missing ${name} footer button`);
  expect(button.getElement()).toHaveAccessibleName(name);
  return button;
}

async function editContent(editor: 'tags' | 'user-data', value: string) {
  const userData = editor === 'user-data';
  fireEvent.click(userData ? screen.getByRole('button', { name: 'Edit user data' }) : tagButton('edit'));
  const modal = await modalWithTitle(userData ? 'Edit user data' : 'Edit tag');
  const field = await waitFor(() => {
    const content = modal.findContent();
    const input = userData ? content.findTextarea()?.findNativeTextarea() : content.findInput()?.findNativeInput();
    if (input === undefined) throw new Error('Missing editor field');
    return input.getElement();
  });
  fireEvent.change(field, { target: { value } });
  primaryModalAction(modal, 'Save changes').click();
}

function held<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('instance tags and user data', () => {
  it('explains the stopped requirement while keeping tags editable', async () => {
    holding(full());
    open(pathOf('i-0full'));
    await loaded();
    const userData = screen.getByRole('button', { name: 'Edit user data' });
    expect(isDisabled(userData)).toBe(true);
    expect(reasonOf(userData)).toBe('Stop the instance to edit user data.');
    expect(document.getElementById(userData.getAttribute('aria-describedby') ?? '')).toBeVisible();
    expect(isDisabled(screen.getByRole('button', { name: 'Add tag' }))).toBe(false);
    expect(isDisabled(tagButton('edit'))).toBe(false);
    expect(isDisabled(tagButton('delete'))).toBe(false);
  });

  it('keeps the user-data draft and explains why Save is disabled after a running state refresh', async () => {
    const id = 'i-0full';
    const client = new QueryClient();
    holding(full({ state: 'stopped' }));
    vi.mocked(getInstanceUserData).mockResolvedValue({ kind: 'text', text: 'original' });
    open(pathOf(id), false, client);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit user data' }));
    const modal = await modalWithTitle('Edit user data');
    const textarea = await waitFor(() => {
      const field = modal.findContent().findTextarea()?.findNativeTextarea();
      if (field === undefined) throw new Error('Missing user data field');
      return field.getElement();
    });
    const draft = 'changed\nuser data';
    fireEvent.change(textarea, { target: { value: draft } });
    const save = primaryModalAction(modal, 'Save changes').getElement();
    expect(save).toBeEnabled();

    const queryKey = EC2_KEYS.instance(id, ENGINE);
    holding(full({ state: 'running' }));
    await act(() => client.invalidateQueries({ queryKey }));
    await waitFor(() => {
      expect(PAGE.findModal()?.findContent().findAlert()?.getElement()).toHaveTextContent(
        'Stop the instance to edit user data.',
      );
      expect(save).toBeDisabled();
    });
    expect(textarea).toHaveValue(draft);
    fireEvent.click(save);
    expect(changeInstanceContent).not.toHaveBeenCalled();

    holding(full({ state: 'stopped' }));
    await act(() => client.invalidateQueries({ queryKey }));
    await waitFor(() => expect(save).toBeEnabled());
    expect(PAGE.findModal()?.findContent().findAlert()).toBeNull();
    expect(PAGE.findModal()?.findContent().findTextarea()?.findNativeTextarea().getElement()).toHaveValue(draft);
  });

  it.each(['detail', 'list'] as const)(
    'updates the Name and keeps the flash when the %s refresh finishes first',
    async (first) => {
      const initial = full();
      const client = new QueryClient();
      const updated = full({
        tags: [
          { key: 'Name', value: 'new-name' },
          { key: 'env', value: 'dev' },
        ],
      });
      holding(initial);
      vi.mocked(api.listInstances).mockResolvedValue({ instances: [initial] });
      vi.mocked(changeInstanceContent).mockResolvedValue(undefined);
      const router = open(pathOf(initial.id), true, client);
      await loaded();
      const list = screen.getByLabelText('Observed instance list');
      await waitFor(() => expect(list).toHaveTextContent('web-1'));

      let detail: (read: api.InstanceRead) => void = () => undefined;
      let listing: (read: { instances: api.Instance[] }) => void = () => undefined;
      vi.mocked(api.getInstance).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            detail = resolve;
          }),
      );
      vi.mocked(api.listInstances).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            listing = resolve;
          }),
      );
      await editContent('tags', 'new-name');
      const flash = await waitFor(() => {
        const item = flashItem('success');
        if (item === undefined) throw new Error('Missing tag update notification');
        return item.getElement();
      });
      await waitFor(() => {
        expect(api.getInstance).toHaveBeenCalledTimes(2);
        expect(api.listInstances).toHaveBeenCalledTimes(2);
      });
      const detailRead = () => detail({ found: true, instance: updated });
      const listRead = () => listing({ instances: [updated] });
      await act(first === 'detail' ? detailRead : listRead);
      await waitFor(() => expect(client.isFetching()).toBe(1));
      await act(first === 'detail' ? listRead : detailRead);

      await waitFor(() => {
        expect(list).toHaveTextContent('new-name');
        expect(detailHeading()).toHaveTextContent('new-name');
        expect(tableOf('Tags').wrapper.findBodyCell(1, 2)?.getElement()).toHaveTextContent('new-name');
      });
      expect(flashItem('success')?.getElement()).toBe(flash);
      expect(flashItem('success')?.findContent()?.getElement()).toHaveTextContent('Tag updated.');
      expect(flash).toBeVisible();

      vi.mocked(api.listInstances).mockResolvedValue({ instances: [updated] });
      await act(() => router.navigate('/aws/ec2/instances'));
      await waitFor(() => expect(PAGE.findTable()?.findRows()[0]?.getElement()).toHaveTextContent('new-name'));
    },
  );

  it.each([true, false])('preserves the refusal after an in-flight detail read finishes (found=%s)', async (found) => {
    const initial = full();
    const client = new QueryClient();
    holding(initial);
    vi.mocked(changeInstanceContent).mockRejectedValueOnce(
      new RequestError(
        requestFailure('CreateTags', {
          Code: 'AccessDeniedException',
          message: 'Editing the Name tag was refused by the service.',
          $fault: 'client',
          $metadata: { httpStatusCode: 403 },
        }),
      ),
    );
    let finish: (read: api.InstanceRead) => void = () => undefined;
    const reread = new Promise<api.InstanceRead>((resolve) => {
      finish = resolve;
    });
    vi.mocked(api.getInstance).mockResolvedValueOnce({ found: true, instance: initial }).mockReturnValueOnce(reread);
    open(pathOf(initial.id), false, client);
    await loaded();
    act(() => {
      void client.invalidateQueries({ queryKey: EC2_KEYS.instance(initial.id) });
    });
    await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2));
    await editContent('tags', 'denied');
    const message = 'AccessDeniedException: Editing the Name tag was refused by the service.';
    const flash = () => flashItem('error')?.findContent()?.getElement();
    await waitFor(() => expect(flash()).toHaveTextContent(message));
    const dialog = PAGE.findModal();
    expect(dialog?.findContent().findAlert()?.getElement()).toHaveTextContent(message);
    await act(async () => {
      finish(found ? { found: true, instance: full({ privateIp: '10.0.0.2' }) } : { found: false });
      await reread;
    });
    if (found) {
      await waitFor(() => expect(pairs()['Private IPv4']).toBe('10.0.0.2'));
      expect(tableOf('Tags').rows[0]).toEqual(['NameEdit tagDelete tag', 'web-1']);
      expect(dialog?.findContent().findInput()?.findNativeInput().getElement()).toHaveValue('denied');
    } else {
      await waitFor(() =>
        expect(PAGE.findContentLayout()?.findContent().getElement()).toHaveTextContent('Instance not found'),
      );
      expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull();
      expect(PAGE.findModal()).toBeNull();
    }
    expect(flash()).toHaveTextContent(message);
    expect(flashItem('success')).toBeUndefined();
  });

  it('keeps the success result after the refreshed detail disappears before the list read finishes', async () => {
    const initial = full();
    holding(initial);
    vi.mocked(api.listInstances).mockResolvedValue({ instances: [initial] });
    vi.mocked(changeInstanceContent).mockResolvedValue(undefined);
    open(pathOf(initial.id), true);
    await loaded();
    const list = screen.getByLabelText('Observed instance list');
    await waitFor(() => expect(list).toHaveTextContent('web-1'));

    let finishList: (read: { instances: api.Instance[] }) => void = () => undefined;
    vi.mocked(api.listInstances).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishList = resolve;
        }),
    );
    vi.mocked(api.getInstance).mockResolvedValueOnce({ found: false });
    await editContent('tags', 'new-name');
    await waitFor(() =>
      expect(PAGE.findContentLayout()?.findContent().getElement()).toHaveTextContent('Instance not found'),
    );
    expect(flashItem('success')?.findContent()?.getElement()).toHaveTextContent('Tag updated.');
    expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit user data' })).toBeNull();
    await act(() => finishList({ instances: [] }));
    await waitFor(() => expect(list).toBeEmptyDOMElement());
    expect(flashItem('success')?.findContent()?.getElement()).toHaveTextContent('Tag updated.');
    expect(PAGE.findModal()).toBeNull();
  });

  it.each([
    ['tags', 'success'],
    ['tags', 'error'],
    ['user-data', 'success'],
    ['user-data', 'error'],
  ] as const)('delivers a pending %s write’s %s after detail removes the dialog', async (editor, outcome) => {
    const id = 'i-0full';
    const client = new QueryClient();
    const write = held<undefined>();
    const detail = held<api.InstanceRead>();
    holding(full({ state: 'stopped' }));
    vi.mocked(getInstanceUserData).mockResolvedValue({ kind: 'text', text: 'initial' });
    vi.mocked(changeInstanceContent).mockReturnValueOnce(write.promise);
    open(pathOf(id), false, client);
    await loaded();
    vi.mocked(api.getInstance).mockReturnValueOnce(detail.promise);
    act(() => {
      void client.invalidateQueries({ queryKey: EC2_KEYS.instance(id) });
    });
    await waitFor(() => expect(api.getInstance).toHaveBeenCalledTimes(2));
    await editContent(editor, 'replacement');
    const signal = vi.mocked(changeInstanceContent).mock.lastCall?.[3];
    expect(signal?.aborted).toBe(false);

    holding(undefined);
    await act(() => detail.resolve({ found: false }));
    await waitFor(() => {
      expect(PAGE.findContentLayout()?.findContent().getElement()).toHaveTextContent('Instance not found');
      expect(PAGE.findModal()).toBeNull();
    });
    expect(signal?.aborted).toBe(false);

    const reason = 'The service denied the submitted change.';
    const operation = editor === 'tags' ? 'CreateTags' : 'ModifyInstanceAttribute';
    await act(() => {
      if (outcome === 'success') write.resolve(undefined);
      else
        write.reject(
          new RequestError(
            requestFailure(operation, {
              Code: 'AccessDeniedException',
              message: reason,
              $fault: 'client',
              $metadata: { httpStatusCode: 403 },
            }),
          ),
        );
    });
    const message =
      outcome === 'error'
        ? `AccessDeniedException: ${reason}`
        : editor === 'tags'
          ? 'Tag updated.'
          : 'User data updated.';
    await waitFor(() => expect(flashItem(outcome)?.findContent()?.getElement()).toHaveTextContent(message));
    if (outcome === 'error') expect(flashItem(outcome)?.getElement()).toHaveAttribute('role', 'alert');
  });

  it.each(['route', 'target'] as const)('cancels a pending content write on %s departure', async (departure) => {
    const write = held<undefined>();
    holding(full({ state: 'stopped' }));
    vi.mocked(getInstanceUserData).mockResolvedValue({ kind: 'text', text: 'initial' });
    vi.mocked(changeInstanceContent).mockReturnValueOnce(write.promise);
    const router = open(pathOf('i-0full'));
    await loaded();
    await editContent(departure === 'route' ? 'tags' : 'user-data', 'replacement');
    const signal = vi.mocked(changeInstanceContent).mock.lastCall?.[3];
    expect(signal?.aborted).toBe(false);
    if (departure === 'route') {
      holding(full({ id: 'i-next', tags: [] }));
      await act(() => router.navigate(pathOf('i-next')));
      await waitFor(() => expect(detailHeading()).toHaveTextContent('i-next'));
    } else {
      await act(() => connection.changeTarget());
    }
    expect(signal?.aborted).toBe(true);
    await act(() => write.resolve(undefined));
    expect(flashItem('success')).toBeUndefined();
    expect(flashItem('error')).toBeUndefined();
  });
});
