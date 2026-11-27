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

const page = createWrapper(document.body);
const apiHeading = () => page.findHeader()?.findHeadingText().getElement().closest('h1');
const detailsHeader = () => page.findContainer()?.findHeader()?.findHeader();
const resourcesSection = () => page.find('section[aria-label="Resources"]');
const stagesHeader = () => page.findTable()?.findHeaderSlot()?.findHeader();

function expectSuccessFlash(content: string) {
  const flash = page.findFlashbar()?.findItemsByType('success')[0]?.findContent();
  expect(flash?.getElement()).toBeVisible();
  expect(flash?.getElement()).toHaveTextContent(content);
}

it('registers the REST API address without registry faults and uses its ID for the read', async () => {
  expect(registryFaults(folders, (folder) => folder === 'apigateway')).toEqual([]);
  open();
  await waitFor(() => expect(apiHeading()).toHaveTextContent('Orders'));
  expect(apiReader).toHaveBeenCalledWith(engineOrigin, id, expect.any(AbortSignal));
});

it('shows loading until the API answers, then shows its three parts', async () => {
  const pending = deferred<RestApi>();
  apiReader.mockReturnValueOnce(pending.promise);
  open();
  const loading = page.findStatusIndicator()?.getElement();
  expect(loading).toBeVisible();
  expect(loading).toHaveTextContent('Loading API…');
  await act(async () => pending.resolve(api));
  await waitFor(() => {
    expect(detailsHeader()?.findHeadingText().getElement().closest('h2')).toHaveTextContent('Details');
    expect(resourcesSection()?.findHeader()?.findHeadingText().getElement().closest('h2')).toHaveTextContent(
      'Resources',
    );
    expect(stagesHeader()?.findHeadingText().getElement().closest('h2')).toHaveTextContent('Stages');
  });
  expect(loading).not.toBeInTheDocument();
});

it('shows the REST API name with its spaces and names the heading by its exact identity', async () => {
  apiReader.mockResolvedValue({ ...api, name: 'a  b' });
  open();

  const identity = 'a\\u0020\\u0020b';
  const heading = await screen.findByRole('heading', { level: 1, name: identity });
  expect(within(heading).getByText('a  b', { normalizer: (text) => text })).toBeVisible();
  expect(within(heading).getByText(`(${identity})`)).toBeVisible();
});

it('shows the missing ID and a link back to APIs when the emulator has no REST API of that ID', async () => {
  apiReader.mockResolvedValueOnce(null);
  open();
  await waitFor(() => expect(apiHeading()).toHaveTextContent('API not found'));
  expect(screen.getByText(/The emulator holds no REST API/)).toHaveTextContent(
    `The emulator holds no REST API with the ID ${id}.`,
  );
  const recovery = page.findLink()?.getElement();
  expect(recovery).toHaveTextContent('View APIs');
  expect(recovery).toHaveAttribute('href', '/aws/apigateway/apis');
  expect(detailsHeader()).toBeUndefined();
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
  expect(page.findStatusIndicator()?.getElement()).toHaveTextContent(first);
  const connectionStatus = page.findLink()?.getElement();
  if (recovery) {
    expect(connectionStatus).toHaveTextContent('Connection status');
    expect(connectionStatus).toHaveAttribute('href', '/');
  } else {
    expect(page.findLink()).toBeNull();
  }
  const retry = page.findButton()?.getElement();
  assert(retry);
  expect(retry).toHaveTextContent('Retry');
  await user.click(retry);
  await waitFor(() => expect(apiHeading()).toHaveTextContent('Orders'));
  expect(screen.queryByText(detail, { exact: false })).not.toBeInTheDocument();
});

it('keeps a pending edit mounted and shows its result when Details refresh fails', async () => {
  const pendingRefresh = deferred<RestApi>();
  const pendingEdit = deferred<Awaited<ReturnType<typeof updateRestApi>>>();
  const updated = { ...api, name: 'Updated orders' };
  apiReader.mockResolvedValueOnce(api).mockReturnValueOnce(pendingRefresh.promise).mockResolvedValueOnce(updated);
  vi.mocked(updateRestApi).mockReturnValueOnce(pendingEdit.promise);

  const user = open();
  const [refresh, edit] = await waitFor(() => {
    const header = detailsHeader();
    expect(header?.findHeadingText().getElement()).toHaveTextContent('Details');
    const [refresh, edit] = header?.findActions()?.findAllButtons() ?? [];
    assert(refresh && edit);
    expect(refresh.getElement()).toHaveTextContent('Refresh');
    expect(edit.getElement()).toHaveTextContent('Edit');
    return [refresh, edit] as const;
  });
  await user.click(refresh.getElement());
  await waitFor(() => expect(apiReader).toHaveBeenCalledTimes(2));

  await user.click(edit.getElement());
  const modal = await waitFor(() => {
    const dialog = page.findModal();
    assert.isOk(dialog, 'Expected the Edit API dialog');
    expect(dialog.findHeader().getElement()).toHaveTextContent('Edit API');
    return dialog;
  });
  const nameField = modal.findContent().findFormField();
  expect(nameField?.findLabel()?.getElement()).toHaveTextContent('Name');
  const nameInput = nameField?.findControl()?.findInput()?.findNativeInput().getElement();
  assert.isOk(nameInput, 'Expected the Name input');
  expect(nameInput).toHaveValue(api.name);
  await user.clear(nameInput);
  await user.type(nameInput, updated.name);
  const save = modal.findFooter()?.findAllButtons().at(-1)?.getElement();
  assert.isOk(save, 'Expected the Save button');
  expect(save).toHaveTextContent('Save');
  await user.click(save);
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
  expect(page.findButton()?.getElement()).toHaveTextContent('Retry');
  expect(page.findModal()?.findContent().getElement()).toBe(modal.findContent().getElement());
  expect(nameInput).toHaveValue(updated.name);
  expect(vi.mocked(updateRestApi).mock.calls[0]?.[4].aborted).toBe(false);

  await act(async () => pendingEdit.resolve({ ...updated, $metadata: {} }));
  await waitFor(() => expect(page.findModal()).toBeNull());
  expectSuccessFlash(`API ${updated.name} updated.`);
  await waitFor(() => expect(apiHeading()).toHaveTextContent(updated.name));
});

it('focuses the Stages heading when it appears for ?show=stages', async () => {
  open(`${path}?show=stages`);
  await waitFor(() => {
    const heading = stagesHeader()?.findHeadingText().getElement().closest('h2');
    expect(heading).toHaveTextContent('Stages');
    expect(heading).toHaveFocus();
  });
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
    await act(async () => pendingApi.resolve(api));
  } else {
    await act(async () => pendingApi.resolve(api));
    await act(async () => pendingResources.resolve(resources));
  }
  await waitFor(() => {
    const heading = resourcesSection()?.findContainer()?.findHeader()?.findHeader()?.findHeadingText().getElement();
    expect(heading).toHaveTextContent('/orders');
    expect(heading).toBeVisible();
  });
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
  await waitFor(() => expect(page.findLink(`[href="${entryPath}"]`)?.getElement()).toHaveTextContent(title));
  expect(areaPage(entryPath)).toMatchObject({ kind: 'entry', label: title });
});
