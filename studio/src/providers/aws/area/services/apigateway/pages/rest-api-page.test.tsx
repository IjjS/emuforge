import type { Resource, RestApi } from '@aws-sdk/client-api-gateway';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import { registryFaults } from '../../../screens';
import { areaPage } from '../../../area-page';
import { readRestApi, readRestResources, readRestStages } from '../rest-api';
import { SCREENS } from '../screens';

vi.mock('../rest-api', { spy: true });

const id = 'a1b2c3d4e5';
const path = `/aws/apigateway/apis/rest/${id}`;
const from = '/aws/apigateway/apis/create';
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const api = { id, name: 'Orders' };
const resources = { items: [{ id: 'resource-1', path: '/orders' }] };
const apiReader = vi.mocked(readRestApi);
const resourceReader = vi.mocked(readRestResources);
const stageReader = vi.mocked(readRestStages);
const folders = [{ folder: 'apigateway', screens: SCREENS }];

beforeEach(() => {
  vi.resetAllMocks();
  apiReader.mockResolvedValue(api);
  resourceReader.mockResolvedValue(resources);
  stageReader.mockResolvedValue([]);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function RegisteredPage() {
  const { pathname } = useLocation();
  const match = areaPage(pathname);
  if (match.kind !== 'screen') throw new Error(`No matching screen for ${pathname}`);
  return <match.screen.Page connection={connection} params={match.params} />;
}

function Handover() {
  const { pathname } = useLocation();
  const atSource = pathname === from;
  const { shown, pageFlash, dismiss, announce } = useAreaFlash(pathname, atSource ? 0 : 1, true);
  if (atSource) {
    return (
      <button onClick={() => pageFlash.handOver(path, [{ type: 'success', content: 'API Orders created.' }])}>
        Hand over
      </button>
    );
  }
  return (
    <>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <RegisteredPage />
    </>
  );
}

function open(address = path) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[address]}>{address === from ? <Handover /> : <RegisteredPage />}</MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}

it('registers the REST API address without registry faults and uses its ID for the read', async () => {
  expect(registryFaults(folders, (folder) => folder === 'apigateway')).toEqual([]);
  open();
  await screen.findByRole('heading', { name: 'Orders', level: 1 });
  expect(apiReader).toHaveBeenCalledWith(engineOrigin, id, expect.any(AbortSignal));
});

it('shows loading until the API answers, then shows its three parts', async () => {
  const pending = deferred<RestApi>();
  apiReader.mockReturnValueOnce(pending.promise);
  open();
  expect(screen.getByText('Loading API…')).toBeVisible();
  await act(async () => pending.resolve(api));
  for (const name of ['Details', 'Resources', 'Stages']) {
    expect(await screen.findByRole('heading', { name, level: 2 })).toBeVisible();
  }
  expect(screen.queryByText('Loading API…')).not.toBeInTheDocument();
});

it('shows the missing ID and a link back to APIs when the emulator has no REST API of that ID', async () => {
  apiReader.mockResolvedValueOnce(null);
  open();
  expect(await screen.findByRole('heading', { name: 'API not found' })).toBeVisible();
  expect(screen.getByText(/The emulator holds no REST API/)).toHaveTextContent(
    `The emulator holds no REST API with the ID ${id}.`,
  );
  expect(screen.getByRole('link', { name: 'APIs' })).toHaveAttribute('href', '/aws/apigateway/apis');
  expect(screen.queryByRole('heading', { name: 'Details' })).not.toBeInTheDocument();
});

it.each<[RequestFailure, string, string]>([
  [
    { kind: 'not-implemented', operation: 'GetRestApi' },
    'Not implemented by the emulator',
    '501 Not Implemented for GetRestApi',
  ],
  [
    { kind: 'access-denied', operation: 'GetRestApi', message: 'API refused.' },
    'Access denied',
    'GetRestApi was refused: API refused.',
  ],
  [
    { kind: 'other', operation: 'GetRestApi', code: 'BadRequestException', message: 'Invalid ID.' },
    'The REST API could not be read',
    'GetRestApi: BadRequestException: Invalid ID.',
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetRestApi', message: 'Timeout.' },
    `Not answering at ${endpoint}`,
    'GetRestApi got no answer from the emulator. Timeout.',
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetRestApi' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetRestApi got no answer.',
  ],
])('shows and retries the failed REST API read (%j)', async (failure, first, detail) => {
  apiReader.mockRejectedValueOnce(new RequestError(failure));
  const user = open();
  await screen.findByText(detail, { exact: false });
  expect(
    screen.getByText(
      (_, element) =>
        element?.textContent === first && ![...element.children].some((child) => child.textContent === first),
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
});

it('focuses the Stages heading when it appears for ?show=stages', async () => {
  open(`${path}?show=stages`);
  expect(await screen.findByRole('heading', { name: 'Stages' })).toHaveFocus();
});

it.each(['resources', 'api'] as const)('keeps the handed-over result when %s answers first', async (first) => {
  const pendingApi = deferred<RestApi>();
  const pendingResources = deferred<TokenPage<Resource>>();
  apiReader.mockReturnValueOnce(pendingApi.promise);
  resourceReader.mockReturnValueOnce(pendingResources.promise);
  const user = open(from);
  await user.click(screen.getByRole('button', { name: 'Hand over' }));
  const flash = await screen.findByText('API Orders created.');
  await waitFor(() => {
    expect(apiReader).toHaveBeenCalledOnce();
    expect(resourceReader).toHaveBeenCalledOnce();
  });
  if (first === 'resources') {
    await act(async () => pendingResources.resolve(resources));
    expect(screen.getByText('Loading API…')).toBeVisible();
    expect(flash).toBeVisible();
    await act(async () => pendingApi.resolve(api));
  } else {
    await act(async () => pendingApi.resolve(api));
    expect(await screen.findByText('Loading resources…')).toBeVisible();
    expect(flash).toBeVisible();
    await act(async () => pendingResources.resolve(resources));
  }
  expect(await screen.findByRole('heading', { name: '/orders' })).toBeVisible();
  expect(flash).toBeVisible();
});

it.each([
  ['Deployments', 'deployments'],
  ['Authorizers', 'authorizers'],
  ['Models', 'models'],
  ['Request validators', 'request-validators'],
  ['Gateway responses', 'gateway-responses'],
  ['Documentation parts', 'documentation-parts'],
  ['Documentation versions', 'documentation-versions'],
])('links %s to the part below the API’s address', async (title, route) => {
  open();
  expect(await screen.findByRole('link', { name: title })).toHaveAttribute('href', `${path}/${route}`);
});
