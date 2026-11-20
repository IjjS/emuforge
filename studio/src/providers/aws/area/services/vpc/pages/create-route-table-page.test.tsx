import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as network from '../../../lib/ec2-network-choices';
import * as api from '../api';
import * as changes from '../route-table-changes-api';

// S8 rendered inside the area's layout, with the calls of `lib/ec2-network-choices.ts`, `api.ts` (the VPC of `?vpc=`,
// and the reads of the pages the form leads to) and `route-table-changes-api.ts` answered by the case (their own
// tests prove the calls against a fake engine).

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listVpcChoices: vi.fn() };
});

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getVpc: vi.fn(), getRouteTable: vi.fn(), listRouteTables: vi.fn() };
});

vi.mock('../route-table-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-table-changes-api')>();
  return { ...real, createRouteTable: vi.fn() };
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
// What the emulator holds, as the readers answer it.

const CREATE_PATH = '/aws/vpc/route-tables/create';
const NAME_RULE = 'Up to 256 characters. Stored as the Name tag.';

const VPCS: network.VpcChoice[] = [
  { id: 'vpc-d', cidr: '172.31.0.0/16', isDefault: true },
  { id: 'vpc-x', name: 'app', cidr: '10.0.0.0/16', isDefault: false },
];

function vpc(id: string): api.Vpc {
  return { id, state: 'available', cidr: '10.0.0.0/16', cidrs: ['10.0.0.0/16'], isDefault: false, tags: [] };
}

function routeTable(id: string, name?: string): api.RouteTable {
  return {
    id,
    vpcId: 'vpc-x',
    main: false,
    routes: [{ destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' }],
    associations: [],
    subnetCount: 0,
    tags: name === undefined ? [] : [{ key: 'Name', value: name }],
  };
}

beforeEach(() => {
  vi.mocked(network.listVpcChoices).mockResolvedValue({ choices: VPCS });
  vi.mocked(changes.createRouteTable).mockResolvedValue('rtb-0new');
  vi.mocked(api.getRouteTable).mockResolvedValue({ found: true, value: routeTable('rtb-0new', 'web') });
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
  vi.mocked(api.getVpc).mockResolvedValue({ found: false });
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

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

function vpcSelect() {
  const found = createWrapper(field('VPC').getElement()).findSelect();
  if (found === null) {
    throw new Error('no VPC select');
  }
  return found;
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());
const constraintOf = (label: string) => text(field(label).findConstraint()?.getElement());

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create route table' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create route table' })).toBeInTheDocument();
  });
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

async function chooseVpc(id: string) {
  const select = vpcSelect();
  select.openDropdown();
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue(id)).not.toBeNull();
  });
  select.selectOptionByValue(id);
}

describe('Create route table', () => {
  it('opens with no VPC and an empty name with its constraint text', async () => {
    open();
    await opened();
    expect(text(vpcSelect().findTrigger().getElement())).toBe('Choose a VPC');
    expect(inputOf('Name - optional').value).toBe('');
    expect(constraintOf('Name - optional')).toBe(NAME_RULE);
    expect(api.getVpc).not.toHaveBeenCalled();
  });

  it('with ?vpc= of a VPC the emulator holds → that VPC is chosen', async () => {
    vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: vpc('vpc-x') });
    open(`${CREATE_PATH}?vpc=vpc-x`);
    await opened();
    await waitFor(() => {
      expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    });
    expect(vi.mocked(api.getVpc).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'vpc-x']);
    submit();
    await waitFor(() => {
      expect(changes.createRouteTable).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(changes.createRouteTable).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-x' });
  });

  it('"Create route table" with no VPC → "Choose a VPC." and nothing sent; a name of 257 characters → its message', async () => {
    open();
    await opened();
    submit();
    expect(errorOf('VPC')).toBe('Choose a VPC.');
    await chooseVpc('vpc-x');
    type('Name - optional', 'n'.repeat(257));
    submit();
    expect(errorOf('Name - optional')).toBe('A name can have up to 256 characters.');
    expect(changes.createRouteTable).not.toHaveBeenCalled();
  });

  it('a VPC and a name → one create with them; the new table\'s page with "Created route table {id}"', async () => {
    const router = open();
    await opened();
    await chooseVpc('vpc-x');
    type('Name - optional', 'web');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Created route table rtb-0new')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/aws/vpc/route-tables/route-table/rtb-0new');
    expect(changes.createRouteTable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.createRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      { vpcId: 'vpc-x', name: 'web' },
    ]);
  });

  it('no name → a create with no tag', async () => {
    open();
    await opened();
    await chooseVpc('vpc-d');
    submit();
    await waitFor(() => {
      expect(changes.createRouteTable).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(changes.createRouteTable).mock.calls[0]?.[1]).toEqual({ vpcId: 'vpc-d' });
  });

  it('a refusal → the form stays with the code and message', async () => {
    const message = "The vpc ID 'vpc-x' does not exist";
    vi.mocked(changes.createRouteTable).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateRouteTable', code: 'InvalidVpcID.NotFound', message }),
    );
    const router = open();
    await opened();
    await chooseVpc('vpc-x');
    type('Name - optional', 'web');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidVpcID.NotFound');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('Name - optional').value).toBe('web');
    expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
  });

  it('a 501 → "not implemented by the emulator" with CreateRouteTable', async () => {
    vi.mocked(changes.createRouteTable).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateRouteTable' }),
    );
    open();
    await opened();
    await chooseVpc('vpc-x');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateRouteTable');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(changes.createRouteTable).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    await chooseVpc('vpc-x');
    submit();
    const creating = await screen.findByRole('button', { name: 'Creating' });
    fireEvent.click(creating);
    fireEvent.submit(creating.closest('form') as HTMLFormElement);
    expect(changes.createRouteTable).toHaveBeenCalledTimes(1);
    act(() => {
      finish('rtb-0new');
    });
    await waitFor(() => {
      expect(screen.getByText('Created route table rtb-0new')).toBeInTheDocument();
    });
  });

  it('"Cancel" with nothing entered → the route tables list at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" with the VPC of ?vpc= alone → the route tables list at once', async () => {
    vi.mocked(api.getVpc).mockResolvedValue({ found: true, value: vpc('vpc-x') });
    const router = open(`${CREATE_PATH}?vpc=vpc-x`);
    await opened();
    await waitFor(() => {
      expect(text(vpcSelect().findTrigger().getElement())).toContain('vpc-x');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    type('Name - optional', 'web');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf('Name - optional').value).toBe('web');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
    expect(changes.createRouteTable).not.toHaveBeenCalled();
  });

  it('the page names its resources "route tables" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These route tables are in your local emulator')).toBeInTheDocument();
  });

  for (const order of ['the newest first', 'the oldest first'] as const) {
    it(`after the create, the new table's reads answering ${order} → its page with "Created route table {id}", settled on the newest`, async () => {
      const reads: ((read: api.Read<api.RouteTable>) => void)[] = [];
      vi.mocked(api.getRouteTable).mockImplementation(
        () =>
          new Promise((resolve) => {
            reads.push(resolve);
          }),
      );
      const router = open();
      await opened();
      await chooseVpc('vpc-x');
      submit();
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/aws/vpc/route-tables/route-table/rtb-0new');
      });
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => {
        expect(reads).toHaveLength(2);
      });
      const older = { found: true as const, value: routeTable('rtb-0new', 'older') };
      const newer = { found: true as const, value: routeTable('rtb-0new', 'newer') };
      act(() => {
        if (order === 'the newest first') {
          reads[1]?.(newer);
          reads[0]?.(older);
        } else {
          reads[0]?.(older);
          reads[1]?.(newer);
        }
      });
      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'newer' })).toBeInTheDocument();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByText('older')).toBeNull();
      expect(screen.getByText('Created route table rtb-0new')).toBeInTheDocument();
    });
  }
});
