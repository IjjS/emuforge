import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { SecretsPage } from './secrets-page';

interface ListInput {
  NextToken?: string;
  IncludePlannedDeletion?: boolean;
}

let nextPort = 8710;
let connection: AreaConnection;
const lists = vi.fn<(input: ListInput) => Response | Promise<Response>>();

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function page(Name: string, NextToken?: string, Description?: string) {
  return answer({ SecretList: [{ Name, Description, LastChangedDate: 1795392000 }], NextToken });
}

beforeEach(() => {
  connection = { engineOrigin: `http://127.0.0.1:${String(nextPort++)}`, result: undefined };
  lists.mockReset().mockImplementation(() => answer({ SecretList: [] }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    expect(request.headers.get('x-amz-target')).toMatch(/\.ListSecrets$/);
    return lists((await request.json()) as ListInput);
  });
});

afterEach(() => vi.unstubAllGlobals());

function open(result?: CheckResult) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (health: CheckResult | undefined) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SecretsPage connection={{ ...connection, result: health }} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(page(result));
  return { updateHealth: (health: CheckResult) => rerender(page(health)) };
}

const UI = createWrapper(document.body);

function table() {
  const wrapper = UI.findTable();
  if (wrapper === null) throw new Error('Missing Secrets table');
  return wrapper;
}

function empty() {
  return table().findEmptySlot();
}

function refreshButton() {
  return table().findHeaderSlot()?.findHeader()?.findActions()?.findButton()?.getElement();
}

function retryButton() {
  return empty()?.findButton()?.getElement();
}

function pageButton(direction: 'next' | 'previous') {
  const pagination = table().findPagination();
  return direction === 'next' ? pagination?.findNextPageButton() : pagination?.findPreviousPageButton();
}

function move(direction: 'next' | 'previous') {
  const button = pageButton(direction);
  if (button === undefined) throw new Error(`Missing ${direction} page button`);
  act(() => button.click());
}

function includePlannedDeletion() {
  const input = table().findFilterSlot()?.findCheckbox()?.findNativeInput().getElement();
  if (input === undefined) throw new Error('Missing planned deletion checkbox');
  fireEvent.click(input);
}

function secretLink(row = 1) {
  return table().findBodyCell(row, 1)?.findLink()?.getElement();
}

function expectSecret(name: string) {
  return waitFor(() => expect(secretLink()).toHaveAccessibleName(name));
}

const ENGINE_DOWN = { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: undefined } as const;

describe('Secrets list', () => {
  it('shows the initial loading message while ListSecrets is pending', () => {
    lists.mockImplementation(() => new Promise(() => undefined));
    open();
    expect(table().findLoadingText()?.getElement()).toHaveTextContent('Loading secrets');
  });

  it('shows the empty title and body for an empty first page', async () => {
    open();
    await waitFor(() => expect(empty()?.getElement()).toHaveTextContent('No secrets'));
    expect(empty()?.getElement()).toHaveTextContent('Secrets stored in this emulator will appear here.');
  });

  it('shows the name, description and changed time in the same row', async () => {
    lists.mockImplementation(() => page('team/service', undefined, 'Service password'));
    open();
    await expectSecret('team/service');
    expect(secretLink()).toHaveAttribute('href', '/aws/secretsmanager/secrets/detail?name=team%2Fservice');
    expect(table().findBodyCell(1, 2)?.getElement()).toHaveTextContent('Service password');
    expect(table().findBodyCell(1, 3)?.getElement()).toHaveTextContent(creationDateText(new Date(1795392000000)));
  });

  it('shows both dates alongside the secret name in the compact row', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: media === '(width < 688px)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    lists.mockImplementation(({ IncludePlannedDeletion }) =>
      answer({
        SecretList: IncludePlannedDeletion
          ? [
              {
                Name: 'scheduled',
                Description: 'Scheduled secret',
                LastChangedDate: 1795392000,
                DeletedDate: 1795478400,
              },
            ]
          : [],
      }),
    );
    open();
    includePlannedDeletion();
    await expectSecret('scheduled');
    expect(table().findColumnHeaders()).toHaveLength(1);
    const items = table().findBodyCell(1, 1)?.findKeyValuePairs()?.findItems();
    expect(items?.map((item) => item.findLabel()?.getElement().textContent)).toEqual([
      'Last changed',
      'Scheduled deletion',
    ]);
    expect(items?.map((item) => item.findValue()?.getElement().textContent)).toEqual([
      creationDateText(new Date(1795392000000)),
      creationDateText(new Date(1795478400000)),
    ]);
  });

  it('traverses the next and previous pages by token', async () => {
    lists.mockImplementation(({ NextToken }) => (NextToken ? page('second') : page('first', 'next-page')));
    open();
    await expectSecret('first');
    move('next');
    await expectSecret('second');
    move('previous');
    await expectSecret('first');
    expect(lists.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, 'next-page', undefined]);
  });

  it('refreshes the current page and shows a description changed externally', async () => {
    let description = 'Original description';
    lists.mockImplementation(({ NextToken }) =>
      NextToken ? page('second', undefined, description) : page('first', 'next-page'),
    );
    open();
    await expectSecret('first');
    move('next');
    await waitFor(() => expect(table().findBodyCell(1, 2)?.getElement()).toHaveTextContent(description));
    description = 'Updated outside Studio';
    const button = refreshButton();
    if (button === undefined) throw new Error('Missing Refresh');
    fireEvent.click(button);
    await waitFor(() => expect(table().findBodyCell(1, 2)?.getElement()).toHaveTextContent(description));
    expect(lists.mock.lastCall?.[0].NextToken).toBe('next-page');
  });

  it('returns to the first page when planned deletion changes and drops the previous late reply', async () => {
    let resolvePreviousPage!: (response: Response) => void;
    const previousPage = new Promise<Response>((resolve) => {
      resolvePreviousPage = resolve;
    });
    lists.mockImplementation(({ NextToken, IncludePlannedDeletion }) => {
      if (IncludePlannedDeletion) {
        return answer({ SecretList: [{ Name: 'scheduled', DeletedDate: 1795392000 }] });
      }
      return NextToken ? previousPage : page('first', 'next-page');
    });
    open();
    await expectSecret('first');
    move('next');
    await waitFor(() => expect(lists.mock.lastCall?.[0].NextToken).toBe('next-page'));
    includePlannedDeletion();
    await expectSecret('scheduled');
    expect(table().findBodyCell(1, 4)?.getElement()).toHaveTextContent(creationDateText(new Date(1795392000000)));
    expect(lists.mock.lastCall?.[0]).toEqual(expect.objectContaining({ IncludePlannedDeletion: true }));
    expect(lists.mock.lastCall?.[0].NextToken).toBeUndefined();
    await act(async () => resolvePreviousPage(page('late', 'wrong-page')));
    expect(secretLink()).toHaveAccessibleName('scheduled');
    expect(table().findRows()).toHaveLength(1);
    expect(table().findPagination()).toBeNull();
  });

  it('shows engine recovery instructions when the engine is unreachable', async () => {
    lists.mockImplementation(() => {
      throw new TypeError('Failed to fetch');
    });
    open();
    await waitFor(() =>
      expect(empty()?.getElement()).toHaveTextContent('Check that the EmuForge engine is running, then retry.'),
    );
  });

  it('shows emulator recovery instructions when the engine cannot reach the emulator', async () => {
    lists.mockImplementation(() =>
      answer({ code: 'EmulatorUnavailable', Code: 'EmulatorUnavailable', message: 'Connection refused' }, 503),
    );
    open();
    await waitFor(() =>
      expect(empty()?.getElement()).toHaveTextContent(
        'Check that the local emulator is running on the configured port, then retry.',
      ),
    );
  });

  it('shows the reason for a refused list request', async () => {
    lists.mockImplementation(() =>
      answer({ __type: 'AccessDeniedException', message: 'Listing denied by the local policy' }, 403),
    );
    open();
    await waitFor(() => expect(empty()?.getElement()).toHaveTextContent('Access denied'));
    expect(empty()?.getElement()).toHaveTextContent('ListSecrets was refused: Listing denied by the local policy');
  });

  it('names ListSecrets and disables both recovery controls after a 501', async () => {
    lists.mockImplementation(() => answer({ __type: 'NotImplemented', message: 'Unavailable' }, 501));
    open();
    await waitFor(() => expect(empty()?.getElement()).toHaveTextContent('Not implemented by the emulator'));
    expect(empty()?.getElement()).toHaveTextContent('The emulator answered 501 Not Implemented for ListSecrets');
    for (const button of [refreshButton(), retryButton()]) {
      if (button === undefined) throw new Error('Missing recovery control');
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(lists).toHaveBeenCalledTimes(1);
  });

  it('retries an ordinary error and displays the returned row', async () => {
    lists.mockImplementationOnce(() =>
      answer({ __type: 'InvalidRequestException', message: 'Temporary failure' }, 400),
    );
    lists.mockImplementation(() => page('recovered'));
    open();
    await waitFor(() => expect(retryButton()).toBeEnabled());
    const retry = retryButton();
    if (retry === undefined) throw new Error('Missing Retry');
    fireEvent.click(retry);
    await expectSecret('recovered');
    expect(lists).toHaveBeenCalledTimes(2);
  });

  it.each(['Retry', 'Refresh'] as const)('recovers with %s before the next health poll', async (action) => {
    lists.mockImplementation(() => page('recovered'));
    open(ENGINE_DOWN);
    expect(empty()?.getElement()).toHaveTextContent('Check that the EmuForge engine is running, then retry.');
    expect(lists).not.toHaveBeenCalled();
    const button = action === 'Retry' ? retryButton() : refreshButton();
    if (button === undefined) throw new Error(`Missing ${action}`);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await expectSecret('recovered');
    expect(lists).toHaveBeenCalledTimes(1);
  });

  it('keeps ListSecrets unavailable when a manual recovery attempt returns 501', async () => {
    lists.mockImplementation(() => answer({ __type: 'NotImplemented', message: 'Unavailable' }, 501));
    const { updateHealth } = open(ENGINE_DOWN);
    const button = retryButton();
    if (button === undefined) throw new Error('Missing Retry');
    fireEvent.click(button);
    await waitFor(() =>
      expect(empty()?.getElement()).toHaveTextContent('The emulator answered 501 Not Implemented for ListSecrets'),
    );
    updateHealth({
      kind: 'connected',
      checkedAt: 2,
      emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
    });
    expect(refreshButton()).toBeDisabled();
    expect(retryButton()).toBeDisabled();
    expect(lists).toHaveBeenCalledTimes(1);
  });
});
