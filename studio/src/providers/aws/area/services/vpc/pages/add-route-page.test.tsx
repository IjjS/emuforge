import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import { VPC_KEYS } from '../queries';
import * as changes from '../route-changes-api';

// S10 rendered inside the area's layout, with the calls of `api.ts` (the table of the address, the gateway attached to
// its VPC, and the reads of S9 it leads to) and `route-changes-api.ts` answered by the case (their own tests prove the
// calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, getRouteTable: vi.fn(), listInternetGateways: vi.fn(), listRouteTables: vi.fn() };
});

vi.mock('../route-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../route-changes-api')>();
  return { ...real, createRoute: vi.fn() };
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

const PAGE_PATH = '/aws/vpc/route-tables/route-table/rtb-a/add-route';
const TABLE_PATH = '/aws/vpc/route-tables/route-table/rtb-a';
const INVALID = 'Enter an IPv4 block in CIDR notation, such as 0.0.0.0/0.';

function routeTable(routes: api.Route[] = [], tags: api.RouteTable['tags'] = [{ key: 'Name', value: 'app' }]) {
  return {
    id: 'rtb-a',
    vpcId: 'vpc-a',
    main: false,
    routes: [{ destination: { kind: 'ipv4', value: '10.0.0.0/16' }, target: 'local', state: 'active' }, ...routes],
    associations: [],
    subnetCount: 0,
    tags,
  } satisfies api.RouteTable;
}

const found = (table: api.RouteTable): api.Read<api.RouteTable> => ({ found: true, value: table });
const GATEWAY: api.InternetGateway = { id: 'igw-1', vpcId: 'vpc-a', tags: [{ key: 'Name', value: 'edge' }] };
const ADDED: api.Route = { destination: { kind: 'ipv4', value: '0.0.0.0/0' }, target: 'igw-1', state: 'active' };

beforeEach(() => {
  vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable()));
  vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [GATEWAY] });
  vi.mocked(api.listRouteTables).mockResolvedValue({ items: [] });
  vi.mocked(changes.createRoute).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// The form as a user reads and fills it.

const PAGE = createWrapper(document.body);
const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

function field(label: string) {
  const match = PAGE.findAllFormFields().find((each) => text(each.findLabel()?.getElement()) === label);
  if (match === undefined) {
    throw new Error(`no field ${label}`);
  }
  return match;
}

function destinationInput(): HTMLInputElement {
  const input = field('Destination').getElement().querySelector('input');
  if (input === null) {
    throw new Error('no destination input');
  }
  return input;
}

function type(value: string) {
  fireEvent.change(destinationInput(), { target: { value } });
}

const errorOf = (label: string) => text(field(label).findError()?.getElement());

function addButton(): HTMLElement {
  return screen.getByRole('button', { name: /^(Add route|Adding)$/ });
}

function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true';
}

function submit() {
  fireEvent.click(addButton());
}

async function opened() {
  await screen.findByText('Destination');
}

async function withGateway() {
  await opened();
  await waitFor(() => {
    expect(text(field('Target').getElement())).toContain('igw-1');
  });
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

function rowsOfRoutes(): string[][] {
  const table = PAGE.findAllTables().find((each) => text(each.findHeaderSlot()?.getElement()).startsWith('Routes'));
  return (table?.findRows() ?? []).map((row) =>
    [...row.getElement().querySelectorAll('td, th')]
      .filter((cell) => !/selection-control/.test(cell.className) && cell.querySelector('input') === null)
      .map((cell) => text(cell)),
  );
}

describe('Add route', () => {
  it('names the table in its description, opens with an empty destination and its constraint; "Target" shows the gateway', async () => {
    open();
    await withGateway();
    expect(screen.getByRole('heading', { level: 1, name: 'Add route' })).toBeInTheDocument();
    expect(text(document.body)).toContain('Adds a route to app.');
    expect(destinationInput().value).toBe('');
    expect(text(field('Destination').findConstraint()?.getElement())).toBe(
      'An IPv4 block in CIDR notation, such as 0.0.0.0/0.',
    );
    expect(text(field('Target').findDescription()?.getElement())).toBe(
      "The internet gateway attached to this table's VPC.",
    );
    expect(text(field('Target').getElement())).toContain('igw-1');
    expect(text(field('Target').getElement())).toContain('edge');
    expect(vi.mocked(api.getRouteTable).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, 'rtb-a']);
    expect(vi.mocked(api.listInternetGateways).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, { vpcId: 'vpc-a' }]);
  });

  it('a table without a name is named by its ID in the description', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue(found(routeTable([], [])));
    open();
    await withGateway();
    expect(text(document.body)).toContain('Adds a route to rtb-a.');
  });

  it('no gateway attached → the sentence with "View internet gateways", which leads to the list; "Add route" cannot be sent', async () => {
    vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [] });
    const router = open();
    await opened();
    await waitFor(() => {
      expect(text(field('Target').getElement())).toContain(
        'No internet gateway is attached to vpc-a. Attach one to add a route to it.',
      );
    });
    expect(isDisabled(addButton())).toBe(true);
    type('0.0.0.0/0');
    submit();
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(changes.createRoute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'View internet gateways' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/internet-gateways');
    });
  });

  it('no destination → "Enter a destination."; abc or 10.0.0.0 → the CIDR message; nothing sent', async () => {
    open();
    await withGateway();
    submit();
    expect(errorOf('Destination')).toBe('Enter a destination.');
    for (const value of ['abc', '10.0.0.0']) {
      type(value);
      submit();
      expect(errorOf('Destination')).toBe(INVALID);
    }
    expect(changes.createRoute).not.toHaveBeenCalled();
  });

  it('a destination → one add with it as typed and the gateway\'s ID; S9 with "Saved the route to {gateway id} in {id}"', async () => {
    const router = open();
    await withGateway();
    type('8.8.8.8/16');
    submit();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(await screen.findByText('Saved the route to igw-1 in rtb-a')).toBeInTheDocument();
    expect(text(document.body)).not.toContain('8.8.8.8/16');
    expect(changes.createRoute).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.createRoute).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      { routeTableId: 'rtb-a', destination: '8.8.8.8/16', gatewayId: 'igw-1' },
    ]);
  });

  it('a refusal → the form stays with the code and message and the entry', async () => {
    const message = 'The route identified by 0.0.0.0/0 already exists.';
    vi.mocked(changes.createRoute).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateRoute', code: 'RouteAlreadyExists', message }),
    );
    const router = open();
    await withGateway();
    type('0.0.0.0/0');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('RouteAlreadyExists');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(PAGE_PATH);
    expect(destinationInput().value).toBe('0.0.0.0/0');
  });

  it('a 501 → "not implemented by the emulator" with CreateRoute', async () => {
    vi.mocked(changes.createRoute).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateRoute' }),
    );
    open();
    await withGateway();
    type('0.0.0.0/0');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateRoute');
  });

  it('while adding, the button reads "Adding" and a second press sends nothing', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.createRoute).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    open();
    await withGateway();
    type('0.0.0.0/0');
    submit();
    const adding = await screen.findByRole('button', { name: 'Adding' });
    fireEvent.click(adding);
    fireEvent.submit(adding.closest('form') as HTMLFormElement);
    expect(changes.createRoute).toHaveBeenCalledTimes(1);
    act(() => {
      finish();
    });
    expect(await screen.findByText('Saved the route to igw-1 in rtb-a')).toBeInTheDocument();
  });

  it('a table the emulator does not hold → "Route table not found" with "View route tables", and no form', async () => {
    vi.mocked(api.getRouteTable).mockResolvedValue({ found: false });
    const router = open();
    expect(await screen.findByText('Route table not found')).toBeInTheDocument();
    expect(screen.getByText('The emulator holds no route table with this ID.')).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View route tables' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/vpc/route-tables');
    });
  });

  it('a failed read of the gateway → its failure with "Retry" in "Target", and the form cannot be sent', async () => {
    vi.mocked(api.listInternetGateways).mockRejectedValue(
      new RequestError({
        kind: 'other',
        operation: 'DescribeInternetGateways',
        code: 'InternalError',
        message: 'broke',
      }),
    );
    open();
    await opened();
    await waitFor(() => {
      expect(text(field('Target').getElement())).toMatch(/InternalError.*broke/);
    });
    expect(isDisabled(addButton())).toBe(true);
    type('0.0.0.0/0');
    submit();
    expect(changes.createRoute).not.toHaveBeenCalled();
    vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [GATEWAY] });
    fireEvent.click(createWrapper(field('Target').getElement()).findButton()?.getElement() as HTMLElement);
    await withGateway();
    expect(isDisabled(addButton())).toBe(false);
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

  it('"Cancel" with nothing entered → the table\'s page at once', async () => {
    const router = open();
    await withGateway();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after an entry → the discard dialog, then the table\'s page', async () => {
    const router = open();
    await withGateway();
    type('0.0.0.0/0');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(destinationInput().value).toBe('0.0.0.0/0');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(changes.createRoute).not.toHaveBeenCalled();
  });

  it('the page names its resources "route tables" to the frame', async () => {
    open();
    expect(await screen.findByText('These route tables are in your local emulator')).toBeInTheDocument();
  });

  it('after the add, a read of the table asked before it answering after the one asked for it → S9 with the result, settled on the newest', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(changes.createRoute).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => {
            resolve(undefined);
          };
        }),
    );
    const router = open();
    await withGateway();
    type('0.0.0.0/0');
    submit();
    await waitFor(() => {
      expect(changes.createRoute).toHaveBeenCalledTimes(1);
    });
    // From here every read of the table is held until the case answers it, in the order they were asked.
    const answers: ((read: api.Read<api.RouteTable>) => void)[] = [];
    vi.mocked(api.getRouteTable).mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    // A read of the table asked before the add answers.
    void queryClient.invalidateQueries({ queryKey: VPC_KEYS.routeTable('rtb-a') });
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(TABLE_PATH);
    });
    expect(await screen.findByText('Saved the route to igw-1 in rtb-a')).toBeInTheDocument();
    await waitFor(() => {
      expect(answers.length).toBeGreaterThanOrEqual(2);
    });
    const newest = answers.length - 1;
    act(() => {
      answers[newest]?.(found(routeTable([ADDED])));
    });
    await waitFor(() => {
      expect(rowsOfRoutes()).toEqual([
        ['10.0.0.0/16', 'local', 'active'],
        ['0.0.0.0/0', 'igw-1', 'active'],
      ]);
    });
    act(() => {
      for (let index = 0; index < newest; index += 1) {
        answers[index]?.(found(routeTable()));
      }
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rowsOfRoutes()).toHaveLength(2);
    expect(screen.getByText('Saved the route to igw-1 in rtb-a')).toBeInTheDocument();
  });
});
