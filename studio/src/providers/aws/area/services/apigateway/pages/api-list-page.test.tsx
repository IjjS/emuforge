import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function InArea({ connection }: { connection: AreaConnection }) {
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

function open(areaConnection = connection) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InArea connection={areaConnection} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function apiNames(container: HTMLElement) {
  const table = createWrapper(container).findTable();
  return table?.findRows().map((_, index) => table.findBodyCell(index + 1, 2)?.getElement().textContent) ?? [];
}

function expectApiNames(container: HTMLElement, names: string[]) {
  expect(apiNames(container)).toEqual(names);
}

function headerAction(container: HTMLElement, index: number, label: string) {
  const button = createWrapper(container).findHeader()?.findActions()?.findAllButtons()[index]?.getElement();
  if (button === undefined) throw new Error(`Missing header action ${label}`);
  expect(button).toHaveTextContent(label);
  return button;
}

async function loadMoreButton(container: HTMLElement, kind: string) {
  return waitFor(() => {
    const buttons = createWrapper(container).findTable()?.findFooterSlot()?.findAllButtons() ?? [];
    expect(buttons).toHaveLength(1);
    const button = buttons[0]?.getElement();
    if (button === undefined) throw new Error(`Missing load more button for ${kind}`);
    expect(button).toHaveTextContent(`Load more ${kind}`);
    return button;
  });
}

it('keeps room for ten-character IDs and their cell padding inside the API table', async () => {
  const { container } = open();
  await waitFor(() => expectApiNames(container, [http.name, rest.name]));
  const table = createWrapper(container).findTable();
  expect(table?.findBodyCell(2, 3)?.getElement()).toHaveTextContent(rest.id);
  const idHeader = table?.findColumnHeaders()[2];
  expect(idHeader?.getElement()).toHaveTextContent('ID');
  expect(idHeader?.getElement().style.minWidth).toBe('calc(15ch + 24px)');
});

it('shows one sorted table with the model-specific links and metadata', async () => {
  vi.mocked(readV2Apis).mockResolvedValue({ items: [webSocket, http] });
  const { container } = open();
  const wrapper = createWrapper(container);
  await waitFor(() => expectApiNames(container, [http.name, rest.name, webSocket.name]));
  const table = wrapper.findTable();
  expect(wrapper.findAll('table')).toHaveLength(1);
  const date = creationDateText(createdDate);
  const expectedRows = [
    { api: http, path: '/aws/apigateway/apis/v2/api-shared', metadata: [http.id, 'HTTP', http.description, date, '-'] },
    {
      api: rest,
      path: '/aws/apigateway/apis/rest/api-shared',
      metadata: [rest.id, 'REST', rest.description, date, 'Private'],
    },
    { api: webSocket, path: '/aws/apigateway/apis/v2/ws-1', metadata: [webSocket.id, 'WebSocket', '-', '-', '-'] },
  ];
  expectedRows.forEach(({ api, path, metadata }, index) => {
    const link = table
      ?.findBodyCell(index + 1, 2)
      ?.findLink()
      ?.getElement();
    expect(link).toHaveTextContent(api.name);
    expect(link).toHaveAttribute('href', path);
    expect(metadata.map((_, column) => table?.findBodyCell(index + 1, column + 3)?.getElement().textContent)).toEqual(
      metadata,
    );
  });
});

it('shows loading until the lists answer, then offers Create API when both are empty', async () => {
  vi.mocked(readRestApis).mockResolvedValue({ items: [] });
  vi.mocked(readV2Apis).mockResolvedValue({ items: [] });
  const { container } = open();
  const wrapper = createWrapper(container);
  expect(wrapper.findTable()?.findLoadingText()?.getElement()).toHaveTextContent('Loading APIs…');
  const empty = await waitFor(() => {
    const slot = wrapper.findTable()?.findEmptySlot()?.getElement();
    if (slot === undefined) throw new Error('Missing empty table state');
    expect(slot).toHaveTextContent('No APIs');
    return slot;
  });
  const create = createWrapper(empty).findButton()?.getElement();
  expect(create).toHaveTextContent('Create API');
  expect(create).toHaveAttribute('href', '/aws/apigateway/apis/create');
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
    const { container } = open();
    await userEvent.click(await loadMoreButton(container, kind));
    const otherApi = reader === readRestApis ? http : rest;
    const expectedNames = [first.name, further.name, otherApi.name].sort((a, b) => a.localeCompare(b));
    await waitFor(() => expectApiNames(container, expectedNames));
    expect(createWrapper(container).findTable()?.findFooterSlot()?.findButton()).toBeFalsy();
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
    const alert = await waitFor(() => {
      const found = createWrapper(container).findAlert();
      if (found === null) throw new Error('Missing list failure alert');
      expect(found.getElement()).toHaveTextContent(`${operation}: Refused: Full reason.`);
      expectApiNames(container, [visible.name]);
      return found;
    });
    const retry = alert.findActionSlot()?.findButton()?.getElement();
    if (retry === undefined) throw new Error('Missing list retry button');
    expect(retry).toHaveTextContent('Retry');
    await userEvent.click(retry);
    await waitFor(() => expectApiNames(container, [visible.name, retried.name].sort()));
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
  await waitFor(() => {
    expectApiNames(container, [rest.name]);
    const alert = createWrapper(container).findAlert()?.getElement();
    expect(alert).toHaveTextContent(first);
    expect(alert).toHaveTextContent(detail);
  });
});

const unavailable = { ...result, kind: 'emulator-unreachable', reason: 'timeout', message: '' } as const;
const stopped = { ...unavailable, reason: 'not_started' } as const;

it.each([
  [
    { kind: 'not-implemented' },
    result,
    'Not implemented by the emulator',
    'The emulator answered 501 Not Implemented for {operation}',
    false,
  ],
  [
    { kind: 'access-denied', message: 'No access.' },
    result,
    'Access denied',
    '{operation} was refused: No access.',
    false,
  ],
  [
    { kind: 'emulator-did-not-answer', message: 'No listener.' },
    stopped,
    'Not started on port 9682',
    '{operation} got no answer from the emulator. No listener.',
    true,
  ],
  [
    { kind: 'emulator-did-not-answer', message: 'Connection timed out.' },
    unavailable,
    'Not answering at https://127.0.0.1:9682',
    '{operation} got no answer from the emulator. Connection timed out.',
    true,
  ],
  [
    { kind: 'engine-did-not-answer' },
    result,
    'The EmuForge engine at http://127.0.0.1:9681 is not answering',
    '{operation} got no answer.',
    true,
  ],
  [
    { kind: 'other', code: 'Refused', message: 'Full reason.' },
    result,
    'could not be read',
    '{operation}: Refused: Full reason.',
    false,
  ],
] as const)('recovers both failed lists from %j with health %j', async (failure, health, heading, detail, recovery) => {
  vi.mocked(readRestApis).mockRejectedValueOnce(new RequestError({ ...failure, operation: 'GetRestApis' }));
  vi.mocked(readV2Apis).mockRejectedValueOnce(new RequestError({ ...failure, operation: 'GetApis' }));

  const { container } = open({ engineOrigin, result: health });
  const wrapper = createWrapper(container);
  const restDetail = detail.replace('{operation}', 'GetRestApis');
  const v2Detail = detail.replace('{operation}', 'GetApis');
  await waitFor(() => {
    expect(wrapper.findTable()).toBeNull();
    expect(container).toHaveTextContent(heading);
    expect(container).toHaveTextContent(restDetail);
    expect(container).toHaveTextContent(v2Detail);
  });
  const links = wrapper.findAllLinks().map((link) => link.getElement());
  expect(links).toHaveLength(recovery ? 2 : 0);
  for (const link of links) {
    expect(link).toHaveTextContent('Connection status');
    expect(link).toHaveAttribute('href', '/');
  }

  const actions = wrapper.findHeader()?.findActions()?.getElement();
  const retryButtons = wrapper
    .findAllButtons()
    .map((button) => button.getElement())
    .filter((button) => !actions?.contains(button));
  expect(retryButtons).toHaveLength(2);
  for (const retry of retryButtons) expect(retry).toHaveTextContent('Retry');
  const [retryRest] = retryButtons;
  if (retryRest === undefined) throw new Error('Missing REST list retry button');
  await userEvent.click(retryRest);
  await waitFor(() => expectApiNames(container, [rest.name]));
  const remaining = wrapper.findAlert();
  if (remaining === null) throw new Error('Missing remaining list failure alert');
  expect(remaining.getElement()).toHaveTextContent(heading);
  expect(remaining.getElement()).toHaveTextContent(v2Detail);
  const retryV2 = remaining.findActionSlot()?.findButton()?.getElement();
  if (retryV2 === undefined) throw new Error('Missing v2 list retry button');
  expect(retryV2).toHaveTextContent('Retry');
  await userEvent.click(retryV2);
  await waitFor(() => expectApiNames(container, [http.name, rest.name]));
  expect(wrapper.findAlert()).toBeNull();
});

it('reads both lists anew when the page opens again and shows no earlier rows while waiting', async () => {
  const first = open();
  await waitFor(() => expectApiNames(first.container, [http.name, rest.name]));
  first.unmount();
  vi.mocked(readRestApis).mockImplementationOnce(() => new Promise(() => undefined));
  vi.mocked(readV2Apis).mockImplementationOnce(() => new Promise(() => undefined));
  const { container } = open();
  expect(createWrapper(container).findTable()?.findLoadingText()?.getElement()).toHaveTextContent('Loading APIs…');
  expectApiNames(container, []);
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
  const { container } = open();
  await userEvent.click(await loadMoreButton(container, 'REST APIs'));
  await waitFor(() => expectApiNames(container, [rest2.name, http.name, rest.name]));
  await userEvent.click(headerAction(container, 0, 'Refresh'));
  await waitFor(() => expectApiNames(container, [webSocket.name]));
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
  await waitFor(() => expectApiNames(container, [http.name, rest.name]));
  const copy = headerAction(container, 1, 'Copy ID');
  expect(copy).toBeDisabled();
  await selectApi(container, 2, user);
  expect(copy).toBeEnabled();
  await user.click(copy);
  expect(writeText).toHaveBeenCalledWith(rest.id);
  const wrapper = createWrapper(container);
  expect(wrapper.findStatusIndicator()?.getElement()).toHaveTextContent('ID copied');
  await user.click(copy);
  expect(wrapper.findStatusIndicator()?.getElement()).toHaveTextContent('ID could not be copied');
});

async function selectApi(container: HTMLElement, rowIndex: number, user = userEvent.setup()) {
  const radio = createWrapper(container).findTable()?.findRowSelectionArea(rowIndex)?.find('input');
  if (radio == null) throw new Error('Missing API selection');
  await user.click(radio.getElement());
}

async function confirmDelete(container: HTMLElement, api: ApiRow) {
  await userEvent.click(headerAction(container, 2, 'Delete'));
  const modal = await waitFor(() => {
    const found = createWrapper(container).findModal();
    if (found === null) throw new Error('Missing delete modal');
    expect(found.findHeader().getElement()).toHaveTextContent(`Delete API ${api.name}?`);
    return found;
  });
  const input = modal.findContent().findFormField()?.findControl()?.findInput()?.findNativeInput().getElement();
  if (input === undefined) throw new Error('Missing name confirmation input');
  fireEvent.change(input, { target: { value: api.name } });
  const confirm = modal.findFooter()?.findAllButtons()[1]?.getElement();
  if (confirm === undefined) throw new Error('Missing delete confirmation button');
  expect(confirm).toHaveTextContent('Delete');
  await userEvent.click(confirm);
}

function expectDeleted(container: HTMLElement, api: ApiRow) {
  const wrapper = createWrapper(container);
  expect(wrapper.findModal()).toBeNull();
  expect(wrapper.findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent(
    `API ${api.name} deleted.`,
  );
}

it('enables Delete when a row is selected, then closes the dialog, shows the result and reads both lists', async () => {
  vi.mocked(deleteApi).mockResolvedValueOnce(undefined);
  const { container } = open();
  await waitFor(() => expectApiNames(container, [http.name, rest.name]));
  const feedbackAtRead: { modalOpen: boolean; message: string | null | undefined }[] = [];
  function recordFeedback(items: ApiRow[]) {
    const wrapper = createWrapper(container);
    feedbackAtRead.push({
      modalOpen: wrapper.findModal() !== null,
      message: wrapper.findFlashbar()?.findItemsByType('success')[0]?.getElement().textContent,
    });
    return Promise.resolve({ items });
  }
  vi.mocked(readRestApis).mockImplementationOnce(() => recordFeedback([]));
  vi.mocked(readV2Apis).mockImplementationOnce(() => recordFeedback([http]));
  expect(headerAction(container, 2, 'Delete')).toBeDisabled();
  await selectApi(container, 2);
  expect(headerAction(container, 2, 'Delete')).toBeEnabled();
  await confirmDelete(container, rest);
  await waitFor(() => {
    expectDeleted(container, rest);
    expectApiNames(container, [http.name]);
  });
  expect(feedbackAtRead).toEqual([
    { modalOpen: false, message: `API ${rest.name} deleted.` },
    { modalOpen: false, message: `API ${rest.name} deleted.` },
  ]);
  expect(deleteApi).toHaveBeenCalledExactlyOnceWith(engineOrigin, rest, expect.any(AbortSignal));
  expect(readRestApis).toHaveBeenCalledTimes(2);
  expect(readV2Apis).toHaveBeenCalledTimes(2);
  expect(headerAction(container, 2, 'Delete')).toBeDisabled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.each([
  ['REST APIs', readRestApis, readV2Apis, rest, rest2, http, 'rest-position'],
  ['HTTP and WebSocket APIs', readV2Apis, readRestApis, http, webSocket, rest, 'v2-token'],
] as const)('%s post-delete reads', (label, read, readOther, api, survivor, other, token) => {
  it.each(['old page first', 'refreshed page first'] as const)(
    'keeps the delete result and drops the old page when the %s answers',
    async (order) => {
      const oldPage = deferred<TokenPage<ApiRow>>();
      const refreshed = deferred<TokenPage<ApiRow>>();
      const otherRefreshed = deferred<TokenPage<ApiRow>>();
      const updatedOther = { ...other, name: `Updated ${other.name}` };
      const initialNames = [api.name, survivor.name, other.name].sort();
      const survivingNames = [survivor.name, other.name].sort();
      vi.mocked(read)
        .mockResolvedValueOnce({ items: [api, survivor], next: token })
        .mockReturnValueOnce(oldPage.promise)
        .mockReturnValueOnce(refreshed.promise);
      vi.mocked(readOther)
        .mockResolvedValueOnce({ items: [other] })
        .mockReturnValueOnce(otherRefreshed.promise);
      vi.mocked(deleteApi).mockResolvedValueOnce(undefined);
      const { container } = open();
      await waitFor(() => expectApiNames(container, initialNames));
      await selectApi(container, initialNames.indexOf(api.name) + 1);
      await userEvent.click(await loadMoreButton(container, label));
      expect(read).toHaveBeenNthCalledWith(2, engineOrigin, token, expect.any(AbortSignal));

      await confirmDelete(container, api);
      await waitFor(() => {
        expectDeleted(container, api);
        expect(read).toHaveBeenNthCalledWith(3, engineOrigin, undefined, expect.any(AbortSignal));
        expect(readOther).toHaveBeenNthCalledWith(2, engineOrigin, undefined, expect.any(AbortSignal));
        expect(apiNames(container)).toEqual(expect.arrayContaining(survivingNames));
      });
      expect(vi.mocked(read).mock.calls[1]?.[2].aborted).toBe(true);
      const resolveOld = () => act(async () => oldPage.resolve({ items: [api] }));
      const resolveRefreshed = () => act(async () => refreshed.resolve({ items: [survivor] }));

      if (order === 'old page first') {
        await resolveOld();
        await resolveRefreshed();
      } else {
        await resolveRefreshed();
        await waitFor(() => {
          expectDeleted(container, api);
          expectApiNames(container, survivingNames);
        });
        await resolveOld();
      }

      await act(async () => otherRefreshed.resolve({ items: [updatedOther] }));
      await waitFor(() => {
        expectDeleted(container, api);
        expectApiNames(container, [survivor.name, updatedOther.name].sort());
      });
    },
  );
});
