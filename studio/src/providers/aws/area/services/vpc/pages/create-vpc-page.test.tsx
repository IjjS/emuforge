import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as changes from '../vpc-changes-api';

// S2 rendered inside the area's layout, with the calls of `vpc-changes-api.ts` and, for the pages the form leads to,
// of `api.ts` answered by the case (`api.test.ts` and `vpc-changes-api.test.ts` prove the calls against a fake
// engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return {
    ...real,
    listVpcs: vi.fn(),
    getVpc: vi.fn(),
    getDnsSetting: vi.fn(),
    listSubnets: vi.fn(),
    listRouteTables: vi.fn(),
    listInternetGateways: vi.fn(),
  };
});

vi.mock('../vpc-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../vpc-changes-api')>();
  return { ...real, createVpc: vi.fn() };
});

// TanStack Query hands its notifications to React on a 0 ms timer; here it notifies in a microtask, as
// `src/test/home-test-kit.tsx` does, so `settled()` below comes after every notification by order alone.
notifyManager.setScheduler((callback) => queueMicrotask(callback));

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

const EMULATOR = { port: 9574, endpoint: 'https://127.0.0.1:9574' };
const connectedResult = (): CheckResult => ({ kind: 'connected', checkedAt: Date.now(), emulator: EMULATOR });

let connection: Connection;
const ENGINE = 'http://127.0.0.1:8574';

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

function open(path = CREATE_PATH) {
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
// The form as a user reads and fills it.

const CREATE_PATH = '/aws/vpc/vpcs/create';
const NAME_CONSTRAINT = 'Up to 256 characters. Stored as the Name tag.';
const BLOCK_CONSTRAINT = 'An IPv4 block in CIDR notation, from /16 to /28, such as 10.0.0.0/16.';

function vpc(id: string, name: string | undefined): api.Vpc {
  return {
    id,
    state: 'available',
    cidr: '10.0.0.0/16',
    cidrs: ['10.0.0.0/16'],
    isDefault: false,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
  };
}

beforeEach(() => {
  vi.mocked(changes.createVpc).mockResolvedValue('vpc-0new');
  vi.mocked(api.listVpcs).mockResolvedValue({ items: [] });
  vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: vpc('vpc-0new', 'app') });
  vi.mocked(api.getDnsSetting).mockResolvedValue(true);
  vi.mocked(api.listSubnets).mockResolvedValue({ items: [] });
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
  vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [] });
});

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const found = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (found === undefined) {
    throw new Error(`no field ${label}`);
  }
  return found;
}

function inputOf(label: string): HTMLInputElement {
  const input = field(label).getElement().querySelector('input');
  if (input === null) {
    throw new Error(`no input in ${label}`);
  }
  return input;
}

function type(label: string, value: string) {
  fireEvent.change(inputOf(label), { target: { value } });
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());
const constraintOf = (label: string) => text(field(label).findConstraint()?.getElement());

const NAME = 'Name - optional';
const BLOCK = 'IPv4 CIDR block';

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create VPC' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create VPC' })).toBeInTheDocument();
  });
}

/** The failure shown on the form, above its buttons (the notice is an alert of the frame). */
function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

/** Lets every answer already given settle (order, not time; see the VPC list's test). */
async function settled() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Create VPC', () => {
  it('opens with an empty name and an empty block, each with its constraint text', async () => {
    open();
    await opened();
    expect(
      within(document.querySelector('form') as HTMLElement).getByRole('heading', { level: 2, name: 'VPC' }),
    ).toBeInTheDocument();
    expect(inputOf(NAME).value).toBe('');
    expect(inputOf(BLOCK).value).toBe('');
    expect(constraintOf(NAME)).toBe(NAME_CONSTRAINT);
    expect(constraintOf(BLOCK)).toBe(BLOCK_CONSTRAINT);
    expect(errorOf(NAME)).toBe('');
    expect(errorOf(BLOCK)).toBe('');
  });

  const faults: [string, () => void, string, string][] = [
    ['no block', () => undefined, BLOCK, 'Enter a CIDR block.'],
    [
      'no IPv4 block',
      () => {
        type(BLOCK, '10.0.0/16');
      },
      BLOCK,
      'Enter an IPv4 block in CIDR notation, such as 10.0.0.0/16.',
    ],
    [
      'a size of /15',
      () => {
        type(BLOCK, '10.0.0.0/15');
      },
      BLOCK,
      "The block's size must be from /16 to /28.",
    ],
    [
      'a size of /29',
      () => {
        type(BLOCK, '10.0.0.0/29');
      },
      BLOCK,
      "The block's size must be from /16 to /28.",
    ],
    [
      'a name of 257 characters',
      () => {
        type(NAME, 'n'.repeat(257));
        type(BLOCK, '10.0.0.0/16');
      },
      NAME,
      'A name can have up to 256 characters.',
    ],
  ];
  for (const [kind, enter, label, message] of faults) {
    it(`"Create VPC" with ${kind} → its message at the field, the constraint text beside it, nothing sent`, async () => {
      open();
      await opened();
      enter();
      submit();
      expect(errorOf(label)).toBe(message);
      expect(constraintOf(label)).toBe(label === NAME ? NAME_CONSTRAINT : BLOCK_CONSTRAINT);
      await settled();
      expect(changes.createVpc).not.toHaveBeenCalled();
    });
  }

  it('a name and a block → one create with them; the new VPC\'s page with "Created VPC {id}"', async () => {
    const router = open();
    await opened();
    type(NAME, 'app');
    type(BLOCK, '10.0.0.0/16');
    submit();
    expect(await screen.findByText('Created VPC vpc-0new')).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs/vpc/vpc-0new');
    });
    expect(changes.createVpc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.createVpc).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      { cidr: '10.0.0.0/16', name: 'app' },
    ]);
  });

  it('a block alone → a create with no tag', async () => {
    open();
    await opened();
    type(BLOCK, '10.1.0.0/16');
    submit();
    expect(await screen.findByText('Created VPC vpc-0new')).toBeInTheDocument();
    expect(vi.mocked(changes.createVpc).mock.calls[0]?.[1]).toEqual({ cidr: '10.1.0.0/16' });
  });

  it('a refusal → the form stays with the code and message and every entry', async () => {
    const message = 'The CIDR block 10.0.0.0/16 is invalid.';
    vi.mocked(changes.createVpc).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateVpc', code: 'InvalidVpc.Range', message }),
    );
    const router = open();
    await opened();
    type(NAME, 'app');
    type(BLOCK, '10.0.0.0/16');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidVpc.Range');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf(NAME).value).toBe('app');
    expect(inputOf(BLOCK).value).toBe('10.0.0.0/16');
    expect(api.listVpcs).not.toHaveBeenCalled();
  });

  it('a 501 → "not implemented by the emulator" with CreateVpc', async () => {
    vi.mocked(changes.createVpc).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateVpc' }),
    );
    open();
    await opened();
    type(BLOCK, '10.0.0.0/16');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateVpc');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(changes.createVpc).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    type(BLOCK, '10.0.0.0/16');
    submit();
    const creating = await screen.findByRole('button', { name: 'Creating' });
    fireEvent.click(creating);
    fireEvent.submit(creating.closest('form') as HTMLFormElement);
    expect(changes.createVpc).toHaveBeenCalledTimes(1);
    act(() => {
      finish('vpc-0new');
    });
    expect(await screen.findByText('Created VPC vpc-0new')).toBeInTheDocument();
  });

  it('"Cancel" with nothing entered → the VPCs list at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    type(BLOCK, '10.0.0.0/16');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf(BLOCK).value).toBe('10.0.0.0/16');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/vpcs');
    });
    expect(changes.createVpc).not.toHaveBeenCalled();
  });

  it('the page names its resources "VPCs" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These VPCs are in your local emulator')).toBeInTheDocument();
  });

  for (const order of ['the new VPC first', 'the lists first'] as const) {
    it(`after the create, the reads it starts answering ${order}, an earlier read last → the new VPC's page with "Created VPC {id}", settled on the newest`, async () => {
      const vpcReads: ((read: api.Read<api.Vpc>) => void)[] = [];
      const subnetReads: ((page: api.Page<api.Subnet>) => void)[] = [];
      vi.mocked(api.getVpc).mockImplementation(
        () =>
          new Promise((resolve) => {
            vpcReads.push(resolve);
          }),
      );
      vi.mocked(api.listSubnets).mockImplementation(
        () =>
          new Promise((resolve) => {
            subnetReads.push(resolve);
          }),
      );
      const router = open();
      await opened();
      type(NAME, 'app');
      type(BLOCK, '10.0.0.0/16');
      submit();
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/vpc/vpcs/vpc/vpc-0new');
      });
      await waitFor(() => {
        expect(vpcReads.length).toBeGreaterThan(0);
        expect(subnetReads.length).toBeGreaterThan(0);
      });
      // "Refresh" asks both again before the first answers arrive, so the first are the earlier reads.
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => {
        expect(vpcReads.length).toBeGreaterThan(1);
        expect(subnetReads.length).toBeGreaterThan(1);
      });
      const newestVpc = () => vpcReads.at(-1)?.({ found: true, value: vpc('vpc-0new', 'app') });
      const newestSubnets = () => subnetReads.at(-1)?.({ items: [] });
      act(() => {
        if (order === 'the new VPC first') {
          newestVpc();
          newestSubnets();
        } else {
          newestSubnets();
          newestVpc();
        }
      });
      expect(await screen.findByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
      expect(await screen.findByText('No subnets')).toBeInTheDocument();
      act(() => {
        vpcReads[0]?.({ found: false });
        subnetReads[0]?.({ items: [{ ...subnet(), id: 'subnet-old' }] });
      });
      await settled();
      expect(screen.getByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
      expect(screen.queryByText('VPC not found')).toBeNull();
      expect(screen.queryByText('subnet-old')).toBeNull();
      expect(screen.getByText('Created VPC vpc-0new')).toBeInTheDocument();
    });
  }
});

function subnet(): api.Subnet {
  return { id: 'subnet-1', state: 'available', isDefault: false, publicAddresses: false, tags: [] };
}
