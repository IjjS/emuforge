import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';
import * as changes from '../gateway-changes-api';

// S13 rendered inside the area's layout, with the calls of `api.ts` (the list the form leads to) and
// `gateway-changes-api.ts` answered by the case (their own tests prove the calls against a fake engine).

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>();
  return { ...real, listInternetGateways: vi.fn() };
});

vi.mock('../gateway-changes-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gateway-changes-api')>();
  return { ...real, createInternetGateway: vi.fn() };
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

const CREATE_PATH = '/aws/vpc/internet-gateways/create';
const LIST_PATH = '/aws/vpc/internet-gateways';
const NAME_RULE = 'Up to 256 characters. Stored as the Name tag.';

function gateway(id: string, name?: string): api.InternetGateway {
  return { id, tags: name === undefined ? [] : [{ key: 'Name', value: name }] };
}

beforeEach(() => {
  vi.mocked(changes.createInternetGateway).mockResolvedValue('igw-0new');
  vi.mocked(api.listInternetGateways).mockResolvedValue({ items: [gateway('igw-0new', 'edge')] });
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

const NAME = 'Name - optional';
const errorOf = (label: string) => text(field(label).findError()?.getElement());
const constraintOf = (label: string) => text(field(label).findConstraint()?.getElement());

function addTag(key: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Key' }), { target: { value: key } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Value - optional' }), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Create internet gateway' }));
}

async function opened() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Create internet gateway' })).toBeInTheDocument();
  });
}

function alertText(): string {
  const form = document.querySelector('form');
  return form === null ? '' : text(createWrapper(form).findAlert()?.getElement());
}

function rows(): string[] {
  return (PAGE.findTable()?.findRows() ?? []).map((row) => text(row.getElement()));
}

describe('Create internet gateway', () => {
  it('opens with an empty name and its constraint text; a name of 257 characters → its message, nothing sent', async () => {
    open();
    await opened();
    expect(inputOf(NAME).value).toBe('');
    expect(constraintOf(NAME)).toBe(NAME_RULE);
    type(NAME, 'n'.repeat(257));
    submit();
    expect(errorOf(NAME)).toBe('A name can have up to 256 characters.');
    expect(changes.createInternetGateway).not.toHaveBeenCalled();
  });

  it('shows optional tags and rejects a Name row when the name field is filled', async () => {
    open();
    await opened();
    expect(screen.getByRole('heading', { name: 'Tags - optional' })).toBeInTheDocument();
    type(NAME, 'app');
    addTag('Name', 'duplicate');
    submit();
    expect(await screen.findByText('This key is already used.')).toBeInTheDocument();
    expect(changes.createInternetGateway).not.toHaveBeenCalled();
  });

  it('asks before discarding an added tag row', async () => {
    open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
  });

  it('a name → one create with the tag; the gateways list with "Created internet gateway {id}"', async () => {
    const router = open();
    await opened();
    type(NAME, 'edge');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Created internet gateway igw-0new')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(LIST_PATH);
    expect(changes.createInternetGateway).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.createInternetGateway).mock.calls[0]?.slice(0, 2)).toEqual([ENGINE, { name: 'edge' }]);
  });

  it('a name and a tag → one create with both; the gateways list with "Created internet gateway {id}"', async () => {
    const router = open();
    await opened();
    type(NAME, 'edge');
    addTag('team', 'core');
    submit();
    await waitFor(() => {
      expect(screen.getByText('Created internet gateway igw-0new')).toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(LIST_PATH);
    expect(changes.createInternetGateway).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changes.createInternetGateway).mock.calls[0]?.slice(0, 2)).toEqual([
      ENGINE,
      { name: 'edge', tags: [{ key: 'team', value: 'core' }] },
    ]);
  });

  it('no name → a create with no tag', async () => {
    open();
    await opened();
    submit();
    await waitFor(() => {
      expect(changes.createInternetGateway).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(changes.createInternetGateway).mock.calls[0]?.[1]).toEqual({});
  });

  it('a refusal → the form stays with the code and message', async () => {
    const message = 'Value for tag Name is too long';
    vi.mocked(changes.createInternetGateway).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'CreateInternetGateway', code: 'InvalidParameterValue', message }),
    );
    const router = open();
    await opened();
    type(NAME, 'edge');
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('InvalidParameterValue');
    });
    expect(alertText()).toContain(message);
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf(NAME).value).toBe('edge');
  });

  it('a 501 → "not implemented by the emulator" with CreateInternetGateway', async () => {
    vi.mocked(changes.createInternetGateway).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'CreateInternetGateway' }),
    );
    open();
    await opened();
    submit();
    await waitFor(() => {
      expect(alertText()).toContain('Not implemented by the emulator');
    });
    expect(alertText()).toContain('CreateInternetGateway');
  });

  it('while creating, the button reads "Creating" and a second press sends nothing', async () => {
    let finish: (id: string) => void = () => undefined;
    vi.mocked(changes.createInternetGateway).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    open();
    await opened();
    submit();
    const creating = await screen.findByRole('button', { name: 'Creating' });
    fireEvent.click(creating);
    fireEvent.submit(creating.closest('form') as HTMLFormElement);
    expect(changes.createInternetGateway).toHaveBeenCalledTimes(1);
    act(() => {
      finish('igw-0new');
    });
    await waitFor(() => {
      expect(screen.getByText('Created internet gateway igw-0new')).toBeInTheDocument();
    });
  });

  it('"Cancel" with nothing entered → the gateways list at once', async () => {
    const router = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
  });

  it('"Cancel" after an entry → the discard dialog; "Keep editing" keeps the form, "Discard" leaves', async () => {
    const router = open();
    await opened();
    type(NAME, 'edge');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard what you entered?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByText('Discard what you entered?')).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe(CREATE_PATH);
    expect(inputOf(NAME).value).toBe('edge');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(LIST_PATH);
    });
    expect(changes.createInternetGateway).not.toHaveBeenCalled();
  });

  it('opened with ?vpc= → after "Create internet gateway", and after "Cancel", the gateways list with that ?vpc=; without it, none', async () => {
    const address = (router: ReturnType<typeof open>) =>
      `${router.state.location.pathname}${router.state.location.search}`;
    const created = open(`${CREATE_PATH}?vpc=vpc-a`);
    await opened();
    submit();
    await waitFor(() => {
      expect(screen.getByText('Created internet gateway igw-0new')).toBeInTheDocument();
    });
    expect(address(created)).toBe(`${LIST_PATH}?vpc=vpc-a`);
    cleanup();

    const cancelled = open(`${CREATE_PATH}?vpc=vpc-a`);
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(address(cancelled)).toBe(`${LIST_PATH}?vpc=vpc-a`);
    });
    cleanup();

    const plain = open();
    await opened();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(address(plain)).toBe(LIST_PATH);
    });
  });

  it('the page names its resources "internet gateways" to the frame', async () => {
    open();
    await opened();
    expect(await screen.findByText('These internet gateways are in your local emulator')).toBeInTheDocument();
  });

  for (const order of ['the newest first', 'the oldest first'] as const) {
    it(`after the create, a list read asked before it and the one asked for it answering ${order} → the gateways list with "Created internet gateway {id}", settled on the newest`, async () => {
      const reads: ((page: api.Page<api.InternetGateway>) => void)[] = [];
      vi.mocked(api.listInternetGateways).mockImplementation(
        () =>
          new Promise((resolve) => {
            reads.push(resolve);
          }),
      );
      const router = open(LIST_PATH);
      await waitFor(() => {
        expect(reads).toHaveLength(1);
      });
      await act(async () => {
        await router.navigate(CREATE_PATH);
      });
      await opened();
      submit();
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(LIST_PATH);
      });
      await waitFor(() => {
        expect(reads).toHaveLength(2);
      });
      const older = { items: [gateway('igw-old', 'older')] };
      const newer = { items: [gateway('igw-0new', 'newer')] };
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
        expect(rows()).toHaveLength(1);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(rows()[0]).toContain('newer');
      expect(screen.queryByText('older')).toBeNull();
      expect(screen.getByText('Created internet gateway igw-0new')).toBeInTheDocument();
    });
  }
});
