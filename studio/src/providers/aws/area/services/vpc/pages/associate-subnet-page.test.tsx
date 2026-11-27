import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as network from '../../../lib/ec2-network-choices';
import * as api from '../api';
import { VPC_KEYS } from '../queries';
import * as changes from '../route-changes-api';

// S11 rendered inside the area's layout, with the calls of `lib/ec2-network-choices.ts` (the subnets of the table's
// VPC), `api.ts` (the table of the address and the reads of S9 it leads to) and `route-changes-api.ts` answered by the
// case (their own tests prove the calls against a fake engine).

vi.mock('../../../lib/ec2-network-choices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../lib/ec2-network-choices')>();
  return { ...real, listSubnetChoices: vi.fn() };
});

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getRouteTable: vi.fn(), listRouteTables: vi.fn() };
});

vi.mock('../route-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-changes-api')>();
  return { ...real, associateSubnet: vi.fn() };
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
const notStartedResult = (): CheckResult => ({
  kind: 'emulator-unreachable',
  checkedAt: Date.now(),
  emulator: EMULATOR,
  reason: 'not_started',
  message: '',
});

let connection: Connection;
/** The query client of the case's page, so a case can ask a read of its own as another part of the page would. */
let queryClient: QueryClient;
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

function open(path = PAGE_PATH) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio&apos;s Home</p> },
      { path: '/aws/*', element: <AreaWithStudioProps /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient = client;
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------------------------------------------
// What the emulator holds, as the readers answer it.

const PAGE_PATH = '/aws/vpc/route-tables/route-table/rtb-a/associate-subnet';
const TABLE_PATH = '/aws/vpc/route-tables/route-table/rtb-a';

function routeTable(
  associations: api.Association[] = [],
  tags: api.RouteTable['tags'] = [{ key: 'Name', value: 'app' }],
) {
  return {
    id: 'rtb-a',
    vpcId: 'vpc-a',
    main: false,
    routes: [{ destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' }],
    associations,
    subnetCount: associations.length,
    tags,
  } satisfies api.RouteTable;
}

const found = (table: api.RouteTable): api.Read<api.RouteTable> => ({ found: true, value: table });
const SUBNET_1: network.SubnetChoice = { id: 'subnet-1', name: 'web', cidr: '10.0.1.0/24', zone: 'us-east-1a' };
const SUBNET_2: network.SubnetChoice = { id: 'subnet-2', cidr: '10.0.2.0/24', zone: 'us-east-1b' };
const ASSOCIATED: api.Association = { id: 'rtbassoc-new', subnetId: 'subnet-1', main: false };

beforeEach(() => {
  vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable()));
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
  vi.mocked(network.listSubnetChoices).mockResolvedValue({ choices: [SUBNET_1, SUBNET_2] });
  vi.mocked(changes.associateSubnet).mockResolvedValue('rtbassoc-new');
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field() {
  const match = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === 'Subnet');
  if (match === undefined) {
    throw new Error('no field Subnet');
  }
  return match;
}

function select() {
  const match = createWrapper(field().getElement()).findSelect();
  if (match === null) {
    throw new Error('no subnet select');
  }
  return match;
}

const dropdownText = () => text(select().findDropdown().getElement());
const shown = () => select().findDropdown().findOptions();

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^(Associate subnet|Associating)$/ }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByText('Choose a subnet')).toBeInTheDocument();
  });
}

async function choose(id: string) {
  select().openDropdown();
  await waitFor(() => {
    expect(select().findDropdown().findOptionByValue(id)).not.toBeNull();
  });
  select().selectOptionByValue(id);
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

function associationRows(): string[][] {
  const table = PAGE.findAllTables().find((each) =>
    text(each.findHeaderSlot()?.getElement()).startsWith('Subnet associations'),
  );
  return (table?.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map((cell) => text(cell)),
  );
}

describe('Associate subnet', () => {
  it('names the table and its VPC; "Subnet", "Choose a subnet"; opened → the subnets of the table\'s VPC with ID, name, block and zone', async () => {
    let answer: (page: network.ChoicePage<network.SubnetChoice>) => void = () => undefined;
    vi.mocked(network.listSubnetChoices).mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    open();
    await opened();
    expect(screen.getByRole('heading', { level: 1, name: 'Associate subnet' })).toBeInTheDocument();
    expect(text(document.body)).toContain('Associates a subnet of vpc-a with app.');
    expect(network.listSubnetChoices).not.toHaveBeenCalled();
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('Loading subnets');
    });
    expect(vi.mocked(network.listSubnetChoices).mock.calls[0]?.[0]).toBe(ENGINE);
    expect(vi.mocked(network.listSubnetChoices).mock.calls[0]?.[3]).toBe('vpc-a');
    act(() => {
      answer({ choices: [SUBNET_1, SUBNET_2] });
    });
    await waitFor(() => {
      expect(shown()).toHaveLength(2);
    });
    const dropdown = select().findDropdown();
    const web = dropdown.findOptionByValue('subnet-1');
    expect(text(web?.findLabel().getElement())).toBe('subnet-1');
    expect(text(web?.findDescription()?.getElement())).toBe('web');
    expect(web?.findTags().map((tag) => text(tag.getElement()))).toContain('us-east-1a · 10.0.1.0/24');
    const subnet = dropdown.findOptionByValue('subnet-2');
    expect(text(subnet?.findLabel().getElement())).toBe('subnet-2');
    expect(subnet?.findTags().map((tag) => text(tag.getElement()))).toContain('us-east-1b · 10.0.2.0/24');
  });

  it('none → "No subnets"; a typed text that matches none → "No subnets match"', async () => {
    vi.mocked(network.listSubnetChoices).mockResolvedValueOnce({ choices: [] });
    open();
    await opened();
    select().openDropdown();
    await waitFor(() => {
      expect(dropdownText()).toContain('No subnets');
    });
    cleanup();

    open();
    await opened();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toHaveLength(2);
    });
    select().findFilteringInput()?.setInputValue('zzz');
    await waitFor(() => {
      expect(dropdownText()).toContain('No subnets match');
    });
  });

  it('"Load more" while a token remains; a failed page → "The subnets could not be loaded" with "Retry"', async () => {
    vi.mocked(network.listSubnetChoices)
      .mockResolvedValueOnce({ choices: [SUBNET_1], nextToken: 't-2' })
      .mockRejectedValueOnce(
        new RequestError({ kind: 'other', operation: 'DescribeSubnets', code: 'Throttling', message: 'slow' }),
      )
      .mockResolvedValueOnce({ choices: [SUBNET_2] });
    open();
    await opened();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(dropdownText()).toContain('The subnets could not be loaded');
    });
    expect(shown()).toHaveLength(1);
    const retry = select().findErrorRecoveryButton();
    expect(text(retry?.getElement())).toBe('Retry');
    retry?.click();
    await waitFor(() => {
      expect(shown()).toHaveLength(2);
    });
    expect(vi.mocked(network.listSubnetChoices).mock.lastCall?.[1]).toBe('t-2');
  });

  it('a subnet chosen → the closed field shows its ID, its name, its block and its Availability Zone', async () => {
    vi.mocked(network.listSubnetChoices).mockResolvedValue({ choices: [SUBNET_1, SUBNET_2] });
    open();
    await opened();
    select().openDropdown();
    await waitFor(() => {
      expect(shown()).toHaveLength(2);
    });
    select().selectOptionByValue('subnet-1');
    const closed = text(select().findTrigger().getElement());
    for (const part of ['subnet-1', 'web', '10.0.1.0/24', 'us-east-1a']) {
      expect(closed).toContain(part);
    }
  });

  it('"Associate subnet" with none chosen → "Choose a subnet." and nothing sent', async () => {
    open();
    await opened();
    submit();
    expect(text(field().findError()?.getElement())).toBe('Choose a subnet.');
    expect(changes.associateSubnet).not.toHaveBeenCalled();
  });

  it('a subnet chosen → one association with the table\'s and the subnet\'s ID; S9 with "Associated {subnet id} with {id}"', async () => {
    const router = open();
    await opened();
    await choose('subnet-1');
    submit();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(await screen.findByText('Associated subnet-1 with rtb-a')).toBeInTheDocument();
    expect(changes.associateSubnet).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.associateSubnet).mock.calls[0]?.slice(0, 3)).toEqual([ENGINE, 'rtb-a', 'subnet-1']);
  });

  it('a refusal → the form stays with the code and message and the choice', async () => {
    const message = 'resource subnet-1 is already associated with route table rtb-b';
    vi.mocked(changes.associateSubnet).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'AssociateRouteTable',
        code: 'Resource.AlreadyAssociated',
        message,
      }),
    );
    const router = open();
    await opened();
    await choose('subnet-1');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Resource.AlreadyAssociated');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(PAGE_PATH);
    expect(text(select().findTrigger().getElement())).toContain('subnet-1');
  });

  it('a 501 → "not implemented by the emulator" with AssociateRouteTable', async () => {
    vi.mocked(changes.associateSubnet).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'AssociateRouteTable' }),
    );
    open();
    await opened();
    await choose('subnet-1');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('AssociateRouteTable');
  });

  it('while associating, the button reads "Associating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(changes.associateSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    await choose('subnet-1');
    submit();
    const associating = await screen.findByRole('button', { name: 'Associating' });
    fireEvent.click(associating);
    fireEvent.submit(associating.closest('form') as HTMLFormElement);
    expect(changes.associateSubnet).toHaveBeenCalledTimes(1);
    act(() => {
      finish('rtbassoc-new');
    });
    expect(await screen.findByText('Associated subnet-1 with rtb-a')).toBeInTheDocument();
  });

  it('a table the emulator does not hold → "Route table not found" with "View route tables", and no form', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue({ found: false });
    const router = open();
    expect(await screen.findByText('Route table not found')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View route tables' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
  });

  it('loading → "Loading route table", and no form', async () => {
    vi.mocked(api.getRouteTable).mockImplementation(() => new Promise(() => undefined));
    open();
    expect(await screen.findByText('Loading route table')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeRouteTables' },
      /Not implemented by the emulator.*DescribeRouteTables/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeRouteTables', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeRouteTables', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeRouteTables' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeRouteTables', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeRouteTables', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read of the table, ${kind} → its state with "Retry", and no form`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.getRouteTable).mockRejectedValue(new RequestError(failure));
      open();
      await waitFor(() => {
        expect(text(document.querySelector('main') ?? document.body)).toMatch(shown);
      });
      expect(document.querySelector('form')).toBeNull();
      vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable()));
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await opened();
    });
  }

  it('"Cancel" with nothing chosen → the table\'s page at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after a choice → the discard dialog', async () => {
    const router = open();
    await opened();
    await choose('subnet-1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(changes.associateSubnet).not.toHaveBeenCalled();
  });

  it('the page names its resources "route tables" to the frame', async () => {
    open();
    expect(await screen.findByText('These route tables are in your local emulator')).toBeInTheDocument();
  });

  it('after the association, a read of the table asked before it answering after the one asked for it → S9 with the result, settled on the newest', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(changes.associateSubnet).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const router = open();
    await opened();
    await choose('subnet-1');
    submit();
    await waitFor(() => {
      expect(changes.associateSubnet).toHaveBeenCalledTimes(1);
    });
    // From here every read of the table is held until the case answers it, in the order they were asked.
    const answers: ((read: api.Read<api.RouteTable>) => void)[] = [];
    vi.mocked(api.getRouteTable).mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    // A read of the table asked before the association answers.
    void queryClient.invalidateQueries({ queryKey: VPC_KEYS.routeTable('rtb-a') });
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    act(() => {
      finish('rtbassoc-new');
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(await screen.findByText('Associated subnet-1 with rtb-a')).toBeInTheDocument();
    await waitFor(() => {
      expect(answers.length).toBeGreaterThanOrEqual(2);
    });
    const newest = answers.length - 1;
    act(() => {
      answers[newest]?.(found(routeTable([ASSOCIATED])));
    });
    await waitFor(() => {
      expect(associationRows()).toEqual([['subnet-1', 'rtbassoc-new']]);
    });
    act(() => {
      for (let index = 0; index < newest; index += 1) {
        answers[index]?.(found(routeTable()));
      }
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(associationRows()).toEqual([['subnet-1', 'rtbassoc-new']]);
    expect(screen.getByText('Associated subnet-1 with rtb-a')).toBeInTheDocument();
  });
});
