import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SecretsPage connection={connection} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Secrets list', () => {
  it('shows the initial loading message while ListSecrets is pending', () => {
    lists.mockImplementation(() => new Promise(() => undefined));
    open();
    expect(screen.getByText('Loading secrets')).toBeVisible();
  });

  it('shows the empty title and body for an empty first page', async () => {
    open();
    expect(await screen.findByText('No secrets')).toBeVisible();
    expect(screen.getByText('Secrets stored in this emulator will appear here.')).toBeVisible();
  });

  it('shows the name, description and changed time in the same row', async () => {
    lists.mockImplementation(() => page('team/service', undefined, 'Service password'));
    open();
    const row = await screen.findByRole('row', { name: /team\/service/ });
    expect(within(row).getByRole('link', { name: 'team/service' })).toHaveAttribute(
      'href',
      '/aws/secretsmanager/secrets/detail?name=team%2Fservice',
    );
    expect(within(row).getByText('Service password')).toBeVisible();
    expect(row).toHaveTextContent(creationDateText(new Date(1795392000000)));
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include secrets scheduled for deletion' }));
    const row = await screen.findByRole('row', { name: /scheduled/i });
    expect(screen.getAllByRole('columnheader')).toHaveLength(1);
    expect(within(row).getByRole('link', { name: 'scheduled' })).toBeVisible();
    expect(within(row).getByText('Last changed')).toBeVisible();
    expect(within(row).getByText('Scheduled deletion')).toBeVisible();
    expect(row).toHaveTextContent(creationDateText(new Date(1795392000000)));
    expect(row).toHaveTextContent(creationDateText(new Date(1795478400000)));
  });

  it('traverses the next and previous pages by token', async () => {
    lists.mockImplementation(({ NextToken }) => (NextToken ? page('second') : page('first', 'next-page')));
    open();
    expect(await screen.findByRole('link', { name: 'first' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('link', { name: 'second' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByRole('link', { name: 'first' })).toBeVisible();
    expect(lists.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, 'next-page', undefined]);
  });

  it('refreshes the current page and shows a description changed externally', async () => {
    let description = 'Original description';
    lists.mockImplementation(({ NextToken }) =>
      NextToken ? page('second', undefined, description) : page('first', 'next-page'),
    );
    open();
    await screen.findByRole('link', { name: 'first' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(description);
    description = 'Updated outside Studio';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(description)).toBeVisible();
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
    await screen.findByRole('link', { name: 'first' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lists.mock.lastCall?.[0].NextToken).toBe('next-page'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include secrets scheduled for deletion' }));
    const row = await screen.findByRole('row', { name: /scheduled/ });
    expect(row).toHaveTextContent(creationDateText(new Date(1795392000000)));
    expect(lists.mock.lastCall?.[0]).toEqual(expect.objectContaining({ IncludePlannedDeletion: true }));
    expect(lists.mock.lastCall?.[0].NextToken).toBeUndefined();
    await act(async () => resolvePreviousPage(page('late', 'wrong-page')));
    expect(screen.queryByRole('link', { name: 'late' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
  });

  it('shows engine recovery instructions when the engine is unreachable', async () => {
    lists.mockImplementation(() => {
      throw new TypeError('Failed to fetch');
    });
    open();
    expect(
      await screen.findByText('Check that the EmuForge engine is running, then retry.', { exact: false }),
    ).toBeVisible();
  });

  it('shows emulator recovery instructions when the engine cannot reach the emulator', async () => {
    lists.mockImplementation(() =>
      answer({ code: 'EmulatorUnavailable', Code: 'EmulatorUnavailable', message: 'Connection refused' }, 503),
    );
    open();
    expect(
      await screen.findByText('Check that the local emulator is running on the configured port, then retry.', {
        exact: false,
      }),
    ).toBeVisible();
  });

  it('shows the reason for a refused list request', async () => {
    lists.mockImplementation(() =>
      answer({ __type: 'AccessDeniedException', message: 'Listing denied by the local policy' }, 403),
    );
    open();
    expect(await screen.findByText('Access denied')).toBeVisible();
    expect(screen.getByText('ListSecrets was refused: Listing denied by the local policy')).toBeVisible();
  });

  it('names ListSecrets and disables both recovery controls after a 501', async () => {
    lists.mockImplementation(() => answer({ __type: 'NotImplemented', message: 'Unavailable' }, 501));
    open();
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/The emulator answered 501 Not Implemented for ListSecrets/)).toBeVisible();
    for (const name of ['Refresh', 'Retry']) {
      const button = screen.getByRole('button', { name });
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
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(await screen.findByRole('link', { name: 'recovered' })).toBeVisible();
    expect(lists).toHaveBeenCalledTimes(2);
  });
});
