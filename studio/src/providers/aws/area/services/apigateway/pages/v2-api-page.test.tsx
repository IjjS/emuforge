import type { Route } from '@aws-sdk/client-apigatewayv2';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import { areaPage } from '../../../area-page';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { registryFaults } from '../../../screens';
import type { TokenPage } from '../../../components/use-token-listing';
import { apisPath, v2ApiPath } from '../format';
import { SCREENS } from '../screens';
import { getV2Api, readV2Integrations, readV2Routes, readV2Stages, type V2ApiRead } from '../v2-api';

vi.mock('../v2-api', async (original) => ({
  ...(await original<typeof import('../v2-api')>()),
  getV2Api: vi.fn(),
  readV2Routes: vi.fn(),
  readV2Integrations: vi.fn(),
  readV2Stages: vi.fn(),
}));

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
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9323, endpoint: 'https://127.0.0.1:9323' } },
};
const api = { ApiId: id, Name: 'Events', ProtocolType: 'HTTP' } as const;

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

function Area({ cameFromList }: { cameFromList: boolean }) {
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

function open(initialPath = path) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Area cameFromList={initialPath === apisPath} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('registers the screen without registry faults and reads the ID from its route', async () => {
  expect(registryFaults([{ folder: 'apigateway', screens: SCREENS }], () => true)).toEqual([]);
  expect(areaPage(path)).toMatchObject({ kind: 'screen', params: { api_id: id } });
  open();
  expect(await screen.findByRole('heading', { name: 'Events' })).toBeInTheDocument();
  expect(getV2Api).toHaveBeenCalledWith(engineOrigin, id, expect.any(AbortSignal));
});

it('shows all four read parts of the API', async () => {
  open();
  for (const name of ['Details', 'Routes', 'Integrations', 'Stages']) {
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

it('shows the GetApi operation and retries the read when it fails', async () => {
  const user = userEvent.setup();
  vi.mocked(getV2Api).mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: 'GetApi',
      code: 'BadRequestException',
      message: 'Rejected API read.',
    }),
  );
  open();

  expect(await screen.findByText('GetApi: BadRequestException: Rejected API read.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Details' })).toBeInTheDocument();
  expect(getV2Api).toHaveBeenCalledTimes(2);
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
  const notifications = await screen.findByRole('list', { name: 'Notifications' });
  expect(within(notifications).getByText(resultText)).toBeInTheDocument();
  const finishApi = () => apiRead.resolve({ found: true, api });
  const finishRoutes = () => routesRead.resolve({ items: [] });

  if (first === 'routes') {
    await act(async () => finishRoutes());
    expect(screen.getByText('Loading API…')).toBeInTheDocument();
    expect(notifications).toHaveTextContent(resultText);
    await act(async () => finishApi());
  } else {
    await act(async () => finishApi());
    expect(await screen.findByText('Loading routes…')).toBeInTheDocument();
    expect(notifications).toHaveTextContent(resultText);
    await act(async () => finishRoutes());
  }

  await waitFor(() => expect(screen.getByText('No routes')).toBeInTheDocument());
  expect(notifications).toHaveTextContent(resultText);
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
    for (const [, segment] of webSocket) {
      expect(document.querySelector(`a[href="/aws/apigateway/${segment}"]`)).toBeNull();
    }
  }
});
