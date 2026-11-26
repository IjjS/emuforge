import type { Resource, RestApi } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import { registryFaults } from '../../../screens';
import { readRestApi, readRestResources, readRestStages } from '../rest-api';
import { updateRestApi } from '../rest-change-api';
import { SCREENS } from '../screens';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-change-api', { spy: true });

const id = 'a1b2c3d4e5';
const path = `/aws/apigateway/apis/rest/${id}`;
const from = '/aws/apigateway/apis/create';
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const stoppedConnection: AreaConnection = {
  engineOrigin,
  result: {
    kind: 'emulator-unreachable',
    reason: 'not_started',
    message: 'The emulator is stopped.',
    checkedAt: 1,
    emulator: { port: 9682, endpoint },
  },
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function RegisteredPage({ connection }: { connection: AreaConnection }) {
  const { pathname } = useLocation();
  const match = areaPage(pathname);
  if (match.kind !== 'screen') throw new Error(`No matching screen for ${pathname}`);
  return <match.screen.Page connection={connection} params={match.params} />;
}

function PageWithFlash({ connection }: { connection: AreaConnection }) {
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
    <PageFlashContext value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <RegisteredPage connection={connection} />
    </PageFlashContext>
  );
}

function open(address = path, pageConnection = connection) {
  const root = { current: null };
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AreaRootContext value={root}>
        <div ref={root}>
          <MemoryRouter initialEntries={[address]}>
            <PageWithFlash connection={pageConnection} />
          </MemoryRouter>
        </div>
      </AreaRootContext>
    </QueryClientProvider>,
  );
  return user;
}

function expectSuccessFlash(content: string) {
  const flash = createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.findContent();
  expect(flash?.getElement()).toBeVisible();
  expect(flash?.getElement()).toHaveTextContent(content);
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
  expect(await screen.findByRole('heading', { name: 'API not found', level: 1 })).toBeVisible();
  expect(screen.getByText(/The emulator holds no REST API/)).toHaveTextContent(
    `The emulator holds no REST API with the ID ${id}.`,
  );
  expect(screen.getByRole('link', { name: 'APIs' })).toHaveAttribute('href', '/aws/apigateway/apis');
  expect(screen.queryByRole('heading', { name: 'Details' })).not.toBeInTheDocument();
});

it.each<[RequestFailure, string, string, 'connection status'?, AreaConnection?]>([
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
    { kind: 'emulator-did-not-answer', operation: 'GetRestApi', message: 'The emulator is stopped.' },
    'Not started on port 9682',
    'GetRestApi got no answer from the emulator. The emulator is stopped.',
    'connection status',
    stoppedConnection,
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetRestApi', message: 'Timeout.' },
    `Not answering at ${endpoint}`,
    'GetRestApi got no answer from the emulator. Timeout.',
    'connection status',
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetRestApi' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetRestApi got no answer.',
    'connection status',
  ],
])('shows and retries the failed REST API read (%j)', async (failure, first, detail, recovery, pageConnection) => {
  apiReader.mockRejectedValueOnce(new RequestError(failure));
  const user = open(path, pageConnection);
  expect(await screen.findByText(detail, { exact: false })).toBeVisible();
  expect(createWrapper(document.body).findStatusIndicator()?.getElement()).toHaveTextContent(first);
  const connectionStatus = screen.queryByRole('link', { name: 'Connection status' });
  if (recovery) {
    expect(connectionStatus).toHaveAttribute('href', '/');
  } else {
    expect(connectionStatus).not.toBeInTheDocument();
  }
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
  expect(screen.queryByText(detail, { exact: false })).not.toBeInTheDocument();
});

it('keeps a pending edit mounted and shows its result when Details refresh fails', async () => {
  const pendingRefresh = deferred<RestApi>();
  const pendingEdit = deferred<Awaited<ReturnType<typeof updateRestApi>>>();
  const updated = { ...api, name: 'Updated orders' };
  apiReader.mockResolvedValueOnce(api).mockReturnValueOnce(pendingRefresh.promise).mockResolvedValueOnce(updated);
  vi.mocked(updateRestApi).mockReturnValueOnce(pendingEdit.promise);

  const user = open();
  await screen.findByRole('heading', { name: 'Details' });
  const wrapper = createWrapper(document.body);
  const detailsHeader = wrapper.findContainer()?.findHeader()?.getElement();
  assert.isOk(detailsHeader, 'Expected the Details header');
  expect(detailsHeader).toHaveTextContent('Details');
  await user.click(within(detailsHeader).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(apiReader).toHaveBeenCalledTimes(2));

  await user.click(within(detailsHeader).getByRole('button', { name: 'Edit' }));
  const modal = await waitFor(() => {
    const edit = wrapper.findModal();
    assert.isOk(edit, 'Expected the Edit API dialog');
    expect(edit.findHeader().getElement()).toHaveTextContent('Edit API');
    return edit;
  });
  const nameField = modal.findContent().findFormField();
  expect(nameField?.findLabel()?.getElement()).toHaveTextContent('Name');
  const nameInput = nameField?.findControl()?.findInput()?.findNativeInput().getElement();
  assert.isOk(nameInput, 'Expected the Name input');
  expect(nameInput).toHaveValue(api.name);
  await user.clear(nameInput);
  await user.type(nameInput, updated.name);
  const footer = modal.findFooter()?.getElement();
  assert.isOk(footer, 'Expected the Edit API footer');
  await user.click(within(footer).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(updateRestApi).toHaveBeenCalledOnce());

  const message = 'GetRestApi: BadRequestException: Details refresh refused.';
  await act(async () => {
    pendingRefresh.reject(
      new RequestError({
        kind: 'other',
        operation: 'GetRestApi',
        code: 'BadRequestException',
        message: 'Details refresh refused.',
      }),
    );
  });
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry', hidden: true })).toBeInTheDocument();
  expect(wrapper.findModal()?.findContent().getElement()).toBe(modal.findContent().getElement());
  expect(nameInput).toHaveValue(updated.name);
  expect(vi.mocked(updateRestApi).mock.calls[0]?.[4].aborted).toBe(false);

  await act(async () => pendingEdit.resolve({ ...updated, $metadata: {} }));
  await waitFor(() => expect(wrapper.findModal()).toBeNull());
  expectSuccessFlash(`API ${updated.name} updated.`);
  expect(await screen.findByRole('heading', { name: updated.name, level: 1 })).toBeVisible();
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
  await waitFor(() => expectSuccessFlash('API Orders created.'));
  await waitFor(() => {
    expect(apiReader).toHaveBeenCalledOnce();
    expect(resourceReader).toHaveBeenCalledOnce();
  });
  if (first === 'resources') {
    await act(async () => pendingResources.resolve(resources));
    expectSuccessFlash('API Orders created.');
    await act(async () => pendingApi.resolve(api));
  } else {
    await act(async () => pendingApi.resolve(api));
    expectSuccessFlash('API Orders created.');
    await act(async () => pendingResources.resolve(resources));
  }
  expect(await screen.findByRole('heading', { name: '/orders' })).toBeVisible();
  expectSuccessFlash('API Orders created.');
});

it.each([
  ['Deployments', 'deployments'],
  ['Authorizers', 'authorizers'],
  ['Models', 'models'],
  ['Request validators', 'request-validators'],
  ['Gateway responses', 'gateway-responses'],
  ['Documentation parts', 'documentation-parts'],
  ['Documentation versions', 'documentation-versions'],
])('links %s to its area entry', async (title, route) => {
  open();
  const entryPath = `/aws/apigateway/${route}`;
  expect(await screen.findByRole('link', { name: title })).toHaveAttribute('href', entryPath);
  expect(areaPage(entryPath)).toMatchObject({ kind: 'entry', label: title });
});
