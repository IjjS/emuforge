import type { Route } from '@aws-sdk/client-apigatewayv2';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import { areaPage } from '../../../area-page';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { registryFaults } from '../../../screens';
import type { TokenPage } from '../../../components/use-token-listing';
import { apisPath, v2ApiPath } from '../format';
import { SCREENS } from '../screens';
import { getV2Api, readV2Integrations, readV2Routes, readV2Stages, type V2ApiRead } from '../v2-api';
import { createV2Stage } from '../v2-stage-api';

vi.mock('../v2-api', async (original) => ({
  ...(await original<typeof import('../v2-api')>()),
  getV2Api: vi.fn(),
  readV2Routes: vi.fn(),
  readV2Integrations: vi.fn(),
  readV2Stages: vi.fn(),
}));

vi.mock('../v2-stage-api', { spy: true });

vi.mock('./api-list-page', () => ({
  ApiListPage: function CreateResultSource() {
    const flash = usePageFlash();
    return (
      <>
        <h1>APIs</h1>
        <button onClick={() => flash.handOver(path, [{ type: 'success', content: resultText }])}>
          Show the created API
        </button>
      </>
    );
  },
}));

const id = 'a1b2c3d4e5';
const path = v2ApiPath(id);
const resultText = 'API Events created.';
const engineOrigin = 'http://127.0.0.1:8323';
const emulator = { port: 9323, endpoint: 'https://127.0.0.1:9323' };
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator },
};
const stopped: AreaConnection = {
  engineOrigin,
  result: { kind: 'emulator-unreachable', checkedAt: 1, emulator, reason: 'not_started', message: '' },
};
const api = { ApiId: id, Name: 'Events', ProtocolType: 'HTTP', Description: 'Event ingestion API.' } as const;
const operation = 'GetApi';
const refused = { kind: 'other', operation, code: 'BadRequestException', message: 'Rejected API read.' } as const;
const emulatorFailure = { kind: 'emulator-did-not-answer', operation, message: 'Emulator request timed out.' } as const;
const parts = ['Details', 'Routes', 'Integrations', 'Stages'];

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
  vi.resetAllMocks();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.mocked(getV2Api).mockResolvedValue({ found: true, api });
  vi.mocked(readV2Routes).mockResolvedValue({ items: [] });
  vi.mocked(readV2Integrations).mockResolvedValue({ items: [] });
  vi.mocked(readV2Stages).mockResolvedValue({ items: [] });
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

function Area({ cameFromList, connection }: { cameFromList: boolean; connection: AreaConnection }) {
  const { pathname } = useLocation();
  return (
    <AreaLayout
      headerSelector="#studio-header"
      connection={connection}
      routeChanges={cameFromList && pathname === path ? 1 : 0}
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
    />
  );
}

function open(initialPath = path, health = connection) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Area cameFromList={initialPath === apisPath} connection={health} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const page = () => createWrapper(document.body);
const successFlash = () => page().findFlashbar()?.findItemsByType('success')[0]?.getElement();
const details = () =>
  page()
    .findAllContainers()
    .find((part) => part.findHeader()?.getElement().textContent?.startsWith('Details'));
const readFailure = () =>
  page()
    .findAllContainers()
    .find((part) => part.findHeader() === null && part.findContent().findButton());

it('registers the screen without registry faults and reads the ID from its route', async () => {
  expect(registryFaults([{ folder: 'apigateway', screens: SCREENS }], () => true)).toEqual([]);
  expect(areaPage(path)).toMatchObject({ kind: 'screen', params: { api_id: id } });
  open();
  expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
  expect(getV2Api).toHaveBeenCalledWith(engineOrigin, id, expect.any(AbortSignal));
});

it('shows all four read parts of the API', async () => {
  open();
  for (const name of parts) {
    expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument();
  }
});

it('shows that the API was not found and links back to the list', async () => {
  vi.mocked(getV2Api).mockResolvedValue({ found: false });
  const { container } = open();
  expect(await screen.findByRole('heading', { name: 'API not found', level: 1 })).toBeInTheDocument();
  expect(container).toHaveTextContent(`The emulator holds no HTTP or WebSocket API with the ID ${id}.`);
  expect(screen.getByRole('link', { name: 'View APIs' })).toHaveAttribute('href', apisPath);
});

it.each<[RequestFailure, string, string, AreaConnection, boolean]>([
  [
    { kind: 'not-implemented', operation },
    'Not implemented by the emulator',
    'The emulator answered 501 Not Implemented for GetApi, so Studio cannot show the API.',
    connection,
    false,
  ],
  [
    { kind: 'access-denied', operation, message: 'API access was denied by the engine.' },
    'Access denied',
    'GetApi was refused: API access was denied by the engine.',
    connection,
    false,
  ],
  [
    emulatorFailure,
    'Not started on port 9323',
    'GetApi got no answer from the emulator. Emulator request timed out.',
    stopped,
    true,
  ],
  [
    emulatorFailure,
    'Not answering at https://127.0.0.1:9323',
    'GetApi got no answer from the emulator. Emulator request timed out.',
    connection,
    true,
  ],
  [
    { kind: 'engine-did-not-answer', operation },
    'The EmuForge engine at http://127.0.0.1:8323 is not answering',
    'GetApi got no answer.',
    connection,
    true,
  ],
  [refused, 'The API could not be read', 'GetApi: BadRequestException: Rejected API read.', connection, false],
])('shows the GetApi failure and recovers the details (%#)', async (failure, title, reason, health, recovery) => {
  vi.mocked(getV2Api).mockRejectedValueOnce(new RequestError(failure));
  open(path, health);

  const notice = await waitFor(() => {
    const notice = readFailure();
    assert(notice);
    expect(notice.findContent().findStatusIndicator()?.getElement()).toHaveTextContent(title);
    return notice.getElement();
  });
  expect(notice).toHaveTextContent(reason);
  const connectionStatus = within(notice).queryByRole('link', { name: 'Connection status' });
  if (recovery) expect(connectionStatus).toHaveAttribute('href', '/');
  else expect(connectionStatus).not.toBeInTheDocument();

  await userEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Events', level: 1 })).toBeInTheDocument();
  expect(details()?.findContent().getElement()).toHaveTextContent(api.Description);
  expect(readFailure()).toBeUndefined();
});

it('keeps all parts and delivers a pending stage creation after a failed Details refresh', async () => {
  const user = userEvent.setup();
  const refresh = deferred<V2ApiRead>();
  const create = deferred<undefined>();
  vi.mocked(createV2Stage).mockReturnValueOnce(create.promise);
  vi.mocked(getV2Api).mockResolvedValueOnce({ found: true, api }).mockReturnValueOnce(refresh.promise);
  open();

  const headings = await Promise.all(parts.map((name) => screen.findByRole('heading', { name, level: 2 })));
  const header = details()?.findHeader()?.getElement();
  assert(header);
  await user.click(within(header).getByRole('button', { name: 'Refresh' }));

  await user.click(screen.getByRole('button', { name: 'Create stage' }));
  const modal = page().findModal();
  assert(modal);
  const input = modal.findContent().findFormField()?.findControl()?.findInput()?.findNativeInput()?.getElement();
  const footer = modal.findFooter()?.getElement();
  assert(input && footer);
  await user.type(input, 'preview');
  await user.click(within(footer).getByRole('button', { name: 'Create stage' }));
  await waitFor(() =>
    expect(createV2Stage).toHaveBeenCalledWith(
      engineOrigin,
      id,
      { stageName: 'preview', autoDeploy: true },
      expect.any(AbortSignal),
    ),
  );

  await act(async () => refresh.reject(new RequestError(refused)));
  await waitFor(() =>
    expect(readFailure()?.getElement()).toHaveTextContent('GetApi: BadRequestException: Rejected API read.'),
  );
  expect(page().findModal()?.getElement()).toBe(modal.getElement());
  expect(input).toHaveValue('preview');
  for (const heading of headings) expect(heading).toBeInTheDocument();
  expect(vi.mocked(createV2Stage).mock.calls[0]?.[3].aborted).toBe(false);

  await act(async () => create.resolve(undefined));
  await waitFor(() => expect(successFlash()).toHaveTextContent('Stage preview created.'));
  await waitFor(() => expect(page().findModal()).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(readFailure()).toBeUndefined());
  expect(details()?.findContent().getElement()).toHaveTextContent(api.Description);
  expect(successFlash()).toHaveTextContent('Stage preview created.');
});

it('focuses the Integrations heading when the part named in show is drawn', async () => {
  open(`${path}?show=integrations`);
  expect(await screen.findByRole('heading', { name: 'Integrations', level: 2 })).toHaveFocus();
});

it.each(['routes', 'API'] as const)('keeps the handed-over result when %s answers first', async (first) => {
  const user = userEvent.setup();
  const apiRead = deferred<V2ApiRead>();
  const routesRead = deferred<TokenPage<Route>>();
  vi.mocked(getV2Api).mockReturnValue(apiRead.promise);
  vi.mocked(readV2Routes).mockReturnValue(routesRead.promise);
  open(apisPath);

  await user.click(screen.getByRole('button', { name: 'Show the created API' }));
  await waitFor(() => expect(successFlash()).toHaveTextContent(resultText));
  const finishApi = () => apiRead.resolve({ found: true, api });
  const finishRoutes = () => routesRead.resolve({ items: [] });

  const finishes = first === 'routes' ? [finishRoutes, finishApi] : [finishApi, finishRoutes];
  for (const finish of finishes) {
    await act(async () => finish());
    expect(successFlash()).toHaveTextContent(resultText);
  }

  const routes = () =>
    page()
      .findAllTables()
      .find((table) => table.findHeaderSlot()?.getElement().textContent?.startsWith('Routes'));
  await waitFor(() => expect(routes()?.findEmptySlot()?.getElement()).toHaveTextContent('No routes'));
  expect(successFlash()).toHaveTextContent(resultText);
});

it.each(['HTTP', 'WEBSOCKET'] as const)('links to the API-specific parts for %s', async (ProtocolType) => {
  vi.mocked(getV2Api).mockResolvedValue({ found: true, api: { ...api, ProtocolType } });
  open();
  const common = [
    ['Deployments', 'v2-deployments'],
    ['Authorizers', 'v2-authorizers'],
  ] as const;
  const webSocket = [
    ['Models', 'v2-models'],
    ['Route responses', 'route-responses'],
    ['Integration responses', 'integration-responses'],
  ] as const;
  const links = ProtocolType === 'WEBSOCKET' ? [...common, ...webSocket] : common;
  const content = within(await screen.findByRole('region', { name: 'Events' }));
  for (const [name, segment] of links) {
    const entryPath = `/aws/apigateway/${segment}`;
    expect(content.getByRole('link', { name })).toHaveAttribute('href', entryPath);
    expect(areaPage(entryPath)).toMatchObject({
      kind: 'entry',
      match: { resource: { path: entryPath } },
    });
  }
  if (ProtocolType === 'HTTP') {
    for (const [name] of webSocket) {
      expect(content.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  }
});
