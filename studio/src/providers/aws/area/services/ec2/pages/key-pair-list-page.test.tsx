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
import * as api from '../key-pair-api';

// S8 rendered inside the area's layout, with the calls of `key-pair-api.ts` answered by the case
// (`key-pair-api.test.ts` proves the calls against a fake engine).

vi.mock('../key-pair-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../key-pair-api')>();
  return {
    ...real,
    listKeyPairs: vi.fn(),
    createKeyPair: vi.fn(),
    importKeyPair: vi.fn(),
    deleteKeyPair: vi.fn(),
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

function open(path = '/aws/ec2/key-pairs') {
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
// Key pairs and readers.

const CREATED = new Date('2026-11-20T01:02:03.000Z');
const created = creationDateText(CREATED);

function keyPair(name: string, changes: Partial<api.KeyPair> = {}): api.KeyPair {
  return { name, id: `key-${name}`, type: 'rsa', fingerprint: `fp:${name}`, createdAt: CREATED, ...changes };
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

const names = () => rows().map((row) => row[0]);

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

function typeFilter(value: string) {
  const filter = table().findTextFilter();
  expect(filter).not.toBeNull();
  filter?.findInput().setInputValue(value);
}

async function confirmDelete() {
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'delete' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

// ---------------------------------------------------------------------------------------------------------------

describe('the key pairs list', () => {
  it('a row per key pair with name, type, fingerprint, key pair ID and creation time', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([
      keyPair('dev', { fingerprint: 'aa:bb:cc' }),
      keyPair('ed', { type: 'ed25519' }),
      { name: 'bare' },
    ]);
    open();
    await expectRows([
      ['dev', 'rsa', 'aa:bb:cc', 'key-dev', created],
      ['ed', 'ed25519', 'fp:ed', 'key-ed', created],
      ['bare', '-', '-', '-', '-'],
    ]);
    expect(screen.getByRole('heading', { level: 1, name: /Key pairs/ })).toBeInTheDocument();
  });

  it('none → "No key pairs" with "Create key pair", which leads to the create address', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([]);
    const router = open();
    const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(text(slot())).toContain('No key pairs');
    });
    expect(text(slot())).toContain('The emulator holds no key pair yet.');
    fireEvent.click(within(slot()).getByRole('link', { name: 'Create key pair' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs/create');
    });
  });

  it('a filter text that matches none → "No key pairs match" with "Clear filter", which shows them all again', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev'), keyPair('ops')]);
    open();
    await waitFor(() => {
      expect(names()).toEqual(['dev', 'ops']);
    });
    typeFilter('zzz');
    const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
    await waitFor(() => {
      expect(text(slot())).toContain('No key pairs match');
    });
    fireEvent.click(within(slot()).getByRole('button', { name: 'Clear filter' }));
    await waitFor(() => {
      expect(names()).toEqual(['dev', 'ops']);
    });
    expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(1);
  });

  it('26 key pairs → 25 on the first page and one on the second; the filter narrows by name across both', async () => {
    const all = Array.from({ length: 26 }, (_, n) =>
      keyPair(n === 25 ? 'web-last' : `key-${String(n).padStart(2, '0')}`),
    );
    all[3] = keyPair('web-first');
    vi.mocked(api.listKeyPairs).mockResolvedValue(all);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(25);
    });
    expect(names()[0]).toBe('key-00');
    const pagination = table().findPagination();
    expect(pagination?.findPageNumbers()).toHaveLength(2);
    pagination?.findNextPageButton().click();
    await waitFor(() => {
      expect(names()).toEqual(['web-last']);
    });
    typeFilter('web');
    await waitFor(() => {
      expect(names()).toEqual(['web-first', 'web-last']);
    });
    expect(table().findPagination()?.findPageNumbers()).toHaveLength(1);
    expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(1);
  });

  it('loading → "Loading key pairs"', async () => {
    vi.mocked(api.listKeyPairs).mockReturnValue(new Promise(() => undefined));
    open();
    await waitFor(() => {
      expect(text(table().getElement())).toContain('Loading key pairs');
    });
  });

  const failures: [string, RequestFailure, RegExp, boolean?][] = [
    [
      'not implemented',
      { kind: 'not-implemented', operation: 'DescribeKeyPairs' },
      /Not implemented by the emulator.*DescribeKeyPairs/,
    ],
    ['access denied', { kind: 'access-denied', operation: 'DescribeKeyPairs', message: 'no' }, /Access denied/],
    [
      'the emulator not answering',
      { kind: 'emulator-did-not-answer', operation: 'DescribeKeyPairs', message: 'timed out' },
      /The emulator did not answer/,
    ],
    [
      'the engine not answering',
      { kind: 'engine-did-not-answer', operation: 'DescribeKeyPairs' },
      /engine.*did not answer/,
    ],
    [
      'another code and message',
      { kind: 'other', operation: 'DescribeKeyPairs', code: 'InternalError', message: 'broke' },
      /InternalError.*broke/,
    ],
    ['not connected', { kind: 'other', operation: 'DescribeKeyPairs', code: 'X' }, /Not started on port/, true],
  ];
  for (const [kind, failure, shown, down] of failures) {
    it(`a failed read, ${kind} → its state with "Retry", which reads again`, async () => {
      if (down === true) {
        connection.value = { result: notStartedResult(), engineOrigin: ENGINE };
      }
      vi.mocked(api.listKeyPairs).mockRejectedValue(new RequestError(failure));
      open();
      const slot = () => table().findEmptySlot()?.getElement() as HTMLElement;
      await waitFor(() => {
        expect(text(slot())).toMatch(shown);
      });
      vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('back')]);
      fireEvent.click(within(slot()).getByRole('button', { name: 'Retry' }));
      await expectRows([['back', 'rsa', 'fp:back', 'key-back', created]]);
      expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(2);
    });
  }

  it('no row selected → "Delete" unavailable with "Select one key pair."', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev')]);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(isDisabled(action('Delete'))).toBe(true);
    expect(reasonOf(action('Delete'))).toContain('Select one key pair.');
  });

  it('a row selected and confirmed → deleted by its name, "Deleted key pair {name}" and the list read again', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev'), keyPair('ops')]);
    vi.mocked(api.deleteKeyPair).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    selectRow('dev');
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('ops')]);
    fireEvent.click(action('Delete'));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('dev is deleted from the local emulator.');
    await confirmDelete();
    await waitFor(() => {
      expect(screen.getByText('Deleted key pair dev')).toBeInTheDocument();
    });
    expect(vi.mocked(api.deleteKeyPair).mock.calls[0]?.slice(1, 2)).toEqual(['dev']);
    await waitFor(() => {
      expect(names()).toEqual(['ops']);
    });
    expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('distinguishes key pairs with repeated spaces and deletes by the stored name', async () => {
    const name = 'dev  key';
    const identity = 'dev\\u0020\\u0020key';
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev key'), keyPair(name)]);
    vi.mocked(api.deleteKeyPair).mockResolvedValue(undefined);
    open();

    await waitFor(() => expect(table().findRows()).toHaveLength(2));
    const [ordinaryRow, spacedRow] = table().findRows();
    if (!ordinaryRow || !spacedRow) throw new Error('Missing key pair rows');
    expect(within(ordinaryRow.getElement()).getByRole('radio')).toHaveAccessibleName('dev key');
    const selection = within(spacedRow.getElement()).getByRole('radio');
    expect(selection).toHaveAccessibleName(identity);
    const cell = table().findBodyCell(2, 2)?.getElement();
    expect(cell?.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${name} (${identity})`);

    fireEvent.click(selection);
    fireEvent.click(action('Delete'));
    const modal = await waitFor(() => {
      const shown = PAGE.findModal();
      if (!shown) throw new Error('Missing key pair delete dialog');
      return shown;
    });
    expect(modal.getElement()).toHaveAccessibleName('Delete key pair?');
    const sentence = modal.findContent().find('p')?.getElement();
    expect(sentence?.querySelector('[aria-hidden="true"]')?.textContent).toBe(`${name} (${identity})`);
    expect(sentence?.textContent).toContain(' is deleted from the local emulator.');
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev key')]);
    const input = modal.findContent().findInput();
    const confirm = modal.findFooter()?.findAllButtons()[1];
    if (!input || !confirm) throw new Error('Missing delete confirmation controls');
    input.setInputValue('delete');
    expect(confirm.getElement()).toHaveAccessibleName('Delete');
    confirm.click();
    await waitFor(() => {
      expect(api.deleteKeyPair).toHaveBeenCalledWith(ENGINE, name, expect.any(AbortSignal));
    });
    await waitFor(() => expect(PAGE.findModal()).toBeNull());
  });

  it('a failed delete → the failure in the flash, the dialog closed and the row stays', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev')]);
    vi.mocked(api.deleteKeyPair).mockRejectedValue(
      new RequestError({ kind: 'other', operation: 'DeleteKeyPair', code: 'InternalError', message: 'broke' }),
    );
    open();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    selectRow('dev');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(screen.getByText('Deleting key pair dev failed')).toBeInTheDocument();
    });
    expect(text(document.body)).toMatch(/InternalError.*broke/);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(names()).toEqual(['dev']);
    expect(vi.mocked(api.listKeyPairs)).toHaveBeenCalledTimes(1);
  });

  it('"Create key pair" leads to the create address; the notice names "key pairs"', async () => {
    vi.mocked(api.listKeyPairs).mockResolvedValue([keyPair('dev')]);
    const router = open();
    expect(await screen.findByText('These key pairs are in your local emulator')).toBeInTheDocument();
    fireEvent.click(within(table().getElement()).getByRole('link', { name: 'Create key pair' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aws/ec2/key-pairs/create');
    });
  });

  it('after a delete, the reads that follow answering the later one first → the screen settles on the newest', async () => {
    const reads: { resolve: (keyPairs: api.KeyPair[]) => void }[] = [];
    vi.mocked(api.listKeyPairs).mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push({ resolve });
        }),
    );
    vi.mocked(api.deleteKeyPair).mockResolvedValue(undefined);
    open();
    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    act(() => {
      reads[0]?.resolve([keyPair('a'), keyPair('b'), keyPair('c')]);
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    selectRow('a');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    selectRow('b');
    fireEvent.click(action('Delete'));
    await confirmDelete();
    await waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    act(() => {
      reads[2]?.resolve([keyPair('c')]);
    });
    await waitFor(() => {
      expect(names()).toEqual(['c']);
    });
    act(() => {
      reads[1]?.resolve([keyPair('b'), keyPair('c')]);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(names()).toEqual(['c']);
  });
});
