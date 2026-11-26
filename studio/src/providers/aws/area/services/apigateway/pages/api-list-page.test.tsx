import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import { deleteApi } from '../api-delete-api';
import { readRestApis, readV2Apis, type ApiRow } from '../apis-api';
import { ApiListPage } from './api-list-page';

vi.mock('../apis-api', async (original) => ({
  ...(await original<typeof import('../apis-api')>()),
  readRestApis: vi.fn(),
  readV2Apis: vi.fn(),
}));

vi.mock('../api-delete-api', async (original) => ({
  ...(await original<typeof import('../api-delete-api')>()),
  deleteApi: vi.fn(),
}));

const engineOrigin = 'http://127.0.0.1:9681';
const result = {
  kind: 'connected',
  checkedAt: 1,
  emulator: { port: 9682, endpoint: 'https://127.0.0.1:9682' },
} as const;
const connection: AreaConnection = { engineOrigin, result };
const createdDate = new Date('2026-11-26T12:00:00Z');

const rest: ApiRow = {
  id: 'api-shared',
  name: 'Payroll',
  kind: 'REST',
  description: 'Payroll endpoints',
  createdDate,
  endpointTypes: ['PRIVATE'],
};
const http: ApiRow = {
  id: 'api-shared',
  name: 'Events',
  kind: 'HTTP',
  description: 'Ingest events',
  createdDate,
  endpointTypes: [],
};
const webSocket: ApiRow = {
  id: 'ws-1',
  name: 'Updates',
  kind: 'WebSocket',
  description: undefined,
  createdDate: undefined,
  endpointTypes: [],
};
const rest2: ApiRow = { ...rest, id: 'rest2', name: 'Accounts' };

let client: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  client = new QueryClient();
  vi.mocked(readRestApis).mockResolvedValue({ items: [rest] });
  vi.mocked(readV2Apis).mockResolvedValue({ items: [http] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});

function InArea() {
  const root = useRef<HTMLDivElement>(null);
  const flash = useAreaFlash('/aws/apigateway/apis', 0, true);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <PageFlashContext value={flash.pageFlash}>
          {flash.shown !== null && (
            <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />
          )}
          <ApiListPage connection={connection} params={{}} />
        </PageFlashContext>
      </AreaRootContext>
    </div>
  );
}

function open() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InArea />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('shows one sorted table with the model-specific links and metadata', async () => {
  vi.mocked(readV2Apis).mockResolvedValue({ items: [webSocket, http] });
  open();
  await screen.findByRole('link', { name: 'Updates' });
  const table = screen.getByRole('table', { name: 'APIs' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['Events', 'Payroll', 'Updates']);
  const [httpRow, restRow, webSocketRow] = rows;
  if (httpRow === undefined || restRow === undefined || webSocketRow === undefined) {
    throw new Error('Missing API rows');
  }
  const cells = (row: HTMLElement) =>
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
  expect(within(httpRow).getByRole('link')).toHaveAttribute('href', '/aws/apigateway/apis/v2/api-shared');
  expect(within(restRow).getByRole('link')).toHaveAttribute('href', '/aws/apigateway/apis/rest/api-shared');
  expect(within(webSocketRow).getByRole('link')).toHaveAttribute('href', '/aws/apigateway/apis/v2/ws-1');
  expect(cells(httpRow)).toEqual(
    expect.arrayContaining([http.id, 'HTTP', http.description, creationDateText(createdDate), '-']),
  );
  expect(cells(restRow)).toEqual(
    expect.arrayContaining([rest.id, 'REST', rest.description, creationDateText(createdDate), 'Private']),
  );
  expect(cells(webSocketRow)).toContain('WebSocket');
});

it('shows loading until the lists answer, then offers Create API when both are empty', async () => {
  vi.mocked(readRestApis).mockResolvedValue({ items: [] });
  vi.mocked(readV2Apis).mockResolvedValue({ items: [] });
  open();
  expect(screen.getByText('Loading APIs…')).toBeInTheDocument();
  expect(await screen.findByText('No APIs')).toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByRole('link', { name: 'Create API' })).toHaveAttribute(
    'href',
    '/aws/apigateway/apis/create',
  );
});

it.each([
  ['REST APIs', readRestApis, readV2Apis, rest, rest2, 'position'],
  ['HTTP and WebSocket APIs', readV2Apis, readRestApis, http, webSocket, 'token'],
] as const)(
  'offers and appends a further page of %s only when that list has a token',
  async (kind, reader, other, first, further, token) => {
    vi.mocked(reader)
      .mockResolvedValueOnce({ items: [first], next: token })
      .mockResolvedValueOnce({ items: [further] });
    open();
    const button = await screen.findByRole('button', { name: `Load more ${kind}` });
    expect(screen.getAllByRole('button', { name: /Load more/ })).toHaveLength(1);
    await userEvent.click(button);
    expect(await screen.findByRole('link', { name: further.name })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: first.name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
    expect(reader).toHaveBeenLastCalledWith(engineOrigin, token, expect.any(AbortSignal));
    expect(other).toHaveBeenCalledOnce();
  },
);

it.each([
  ['GetApis', readV2Apis, readRestApis, rest, http],
  ['GetRestApis', readRestApis, readV2Apis, http, rest],
] as const)(
  'keeps the other list visible when %s fails and retries only that operation',
  async (operation, reader, other, visible, retried) => {
    vi.mocked(reader).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation, code: 'Refused', message: 'Full reason.' }),
    );
    const { container } = open();
    await screen.findByText(`${operation}: Refused: Full reason.`);
    const alert = createWrapper(container).findAlert();
    if (alert === null) throw new Error('Missing list failure alert');
    expect(alert.getElement()).toHaveTextContent(`${operation}: Refused: Full reason.`);
    expect(await screen.findByRole('link', { name: visible.name })).toBeInTheDocument();
    await userEvent.click(within(alert.getElement()).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: retried.name })).toBeInTheDocument();
    expect(reader).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledOnce();
  },
);

it.each([
  [
    { kind: 'not-implemented', operation: 'GetApis' },
    'Not implemented by the emulator',
    'The emulator answered 501 Not Implemented for GetApis',
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetApis', message: 'Connection timed out.' },
    'Not answering at https://127.0.0.1:9682',
    'GetApis got no answer from the emulator. Connection timed out.',
  ],
] as const)('keeps successful rows alongside the failed operation and its status', async (failure, first, detail) => {
  vi.mocked(readV2Apis).mockRejectedValueOnce(new RequestError(failure));
  const { container } = open();
  await screen.findByRole('link', { name: rest.name });
  await waitFor(() => {
    expect(container).toHaveTextContent(first);
    expect(container).toHaveTextContent(detail);
  });
});

it('shows the read states in place of the table when both lists fail', async () => {
  vi.mocked(readRestApis).mockRejectedValue(
    new RequestError({ kind: 'engine-did-not-answer', operation: 'GetRestApis' }),
  );
  vi.mocked(readV2Apis).mockRejectedValue(
    new RequestError({ kind: 'access-denied', operation: 'GetApis', message: 'No access.' }),
  );
  const { container } = open();
  expect(await screen.findByText('Access denied')).toBeInTheDocument();
  expect(container).toHaveTextContent('The EmuForge engine at http://127.0.0.1:9681 is not answering');
  expect(container).toHaveTextContent('GetRestApis got no answer.');
  expect(container).toHaveTextContent('GetApis was refused: No access.');
  expect(screen.getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
  expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('reads both lists anew when the page opens again and shows no earlier rows while waiting', async () => {
  const first = open();
  await screen.findByRole('link', { name: rest.name });
  await screen.findByRole('link', { name: http.name });
  first.unmount();
  vi.mocked(readRestApis).mockImplementationOnce(() => new Promise(() => undefined));
  vi.mocked(readV2Apis).mockImplementationOnce(() => new Promise(() => undefined));
  open();
  expect(screen.getByText('Loading APIs…')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: rest.name })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: http.name })).not.toBeInTheDocument();
  for (const reader of [readRestApis, readV2Apis]) {
    expect(reader).toHaveBeenNthCalledWith(2, engineOrigin, undefined, expect.any(AbortSignal));
  }
});

it('refreshes both lists from their first page after a further page was loaded', async () => {
  vi.mocked(readRestApis)
    .mockResolvedValueOnce({ items: [rest], next: 'rest-position' })
    .mockResolvedValueOnce({ items: [rest2] })
    .mockResolvedValueOnce({ items: [] });
  vi.mocked(readV2Apis)
    .mockResolvedValueOnce({ items: [http] })
    .mockResolvedValueOnce({ items: [webSocket] });
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Load more REST APIs' }));
  await screen.findByRole('link', { name: rest2.name });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('link', { name: webSocket.name });
  expect(screen.queryByRole('link', { name: rest2.name })).not.toBeInTheDocument();
  expect(readRestApis).toHaveBeenNthCalledWith(3, engineOrigin, undefined, expect.any(AbortSignal));
  expect(readV2Apis).toHaveBeenNthCalledWith(2, engineOrigin, undefined, expect.any(AbortSignal));
});

it('copies the selected ID verbatim and reports both clipboard outcomes', async () => {
  const user = userEvent.setup();
  const writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error('Blocked'));
  const { container } = open();
  await screen.findByRole('link', { name: rest.name });
  const copy = screen.getByRole('button', { name: 'Copy ID' });
  expect(copy).toBeDisabled();
  const table = createWrapper(container).findTable();
  const rowIndex = table
    ?.findRows()
    .findIndex((row) => within(row.getElement()).queryByRole('link', { name: rest.name }) !== null);
  if (table === null || rowIndex === undefined || rowIndex < 0) throw new Error('Missing API row');
  const radio = table.findRowSelectionArea(rowIndex + 1)?.find('input');
  if (radio === null || radio === undefined) throw new Error('Missing API selection');
  await user.click(radio.getElement());
  expect(copy).toBeEnabled();
  await user.click(copy);
  expect(writeText).toHaveBeenCalledWith(rest.id);
  expect(screen.getAllByText('ID copied').length).toBeGreaterThan(0);
  await user.click(copy);
  expect(screen.getAllByText('ID could not be copied').length).toBeGreaterThan(0);
});

async function selectApi(container: HTMLElement, api: ApiRow) {
  await screen.findByRole('link', { name: api.name });
  const table = createWrapper(container).findTable();
  const rowIndex = table
    ?.findRows()
    .findIndex((row) => within(row.getElement()).queryByRole('link', { name: api.name }) !== null);
  if (table === null || rowIndex === undefined || rowIndex < 0) throw new Error('Missing API row');
  const radio = table.findRowSelectionArea(rowIndex + 1)?.find('input');
  if (radio === null || radio === undefined) throw new Error('Missing API selection');
  await userEvent.click(radio.getElement());
}

async function confirmDelete(api: ApiRow) {
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: `Delete API ${api.name}?` });
  const input = createWrapper(dialog).findInput()?.findNativeInput().getElement();
  if (input === undefined) throw new Error('Missing name confirmation input');
  fireEvent.change(input, { target: { value: api.name } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
}

it('enables Delete when a row is selected, then closes the dialog, shows the result and reads both lists', async () => {
  vi.mocked(deleteApi).mockResolvedValueOnce(undefined);
  vi.mocked(readRestApis)
    .mockResolvedValueOnce({ items: [rest] })
    .mockResolvedValueOnce({ items: [] });
  const { container } = open();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await selectApi(container, rest);
  expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  await confirmDelete(rest);
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Notifications' })).getByRole('listitem')).toHaveTextContent(
      'API Payroll deleted.',
    );
  });
  expect(deleteApi).toHaveBeenCalledExactlyOnceWith(engineOrigin, rest, expect.any(AbortSignal));
  expect(readRestApis).toHaveBeenCalledTimes(2);
  expect(readV2Apis).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('link', { name: 'Payroll' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

it.each([
  ['REST APIs', readRestApis, rest, rest2, 'rest-position'],
  ['HTTP and WebSocket APIs', readV2Apis, http, webSocket, 'v2-token'],
] as const)(
  'drops an old %s page that arrives after the post-delete read',
  async (label, read, api, current, token) => {
    const oldPage = Promise.withResolvers<TokenPage<ApiRow>>();
    vi.mocked(read)
      .mockResolvedValueOnce({ items: [api], next: token })
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ items: [current] });
    vi.mocked(deleteApi).mockResolvedValueOnce(undefined);
    const { container } = open();
    await selectApi(container, api);
    await userEvent.click(screen.getByRole('button', { name: `Load more ${label}` }));
    expect(read).toHaveBeenNthCalledWith(2, engineOrigin, token, expect.any(AbortSignal));

    await confirmDelete(api);
    await screen.findByRole('link', { name: current.name });
    expect(read).toHaveBeenNthCalledWith(3, engineOrigin, undefined, expect.any(AbortSignal));
    expect(vi.mocked(read).mock.calls[1]?.[2].aborted).toBe(true);

    await act(async () => oldPage.resolve({ items: [api] }));

    expect(screen.getByRole('link', { name: current.name })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: api.name })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Notifications' })).getByRole('listitem')).toHaveTextContent(
      `API ${api.name} deleted.`,
    );
  },
);
