import type { GetApiResponse, Stage } from '@aws-sdk/client-apigatewayv2';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import type { AppendedPages } from '../queries';
import { readV2Stages } from '../v2-api';
import { useV2Stages } from '../v2-queries';
import { createV2Stage, deleteV2Stage, deployV2Stage } from '../v2-stage-api';
import { V2Stages } from './v2-stages';

vi.mock('../v2-api', { spy: true });
vi.mock('../v2-stage-api', { spy: true });

const apiId = 'api-1';
const read = vi.mocked(readV2Stages);
const create = vi.mocked(createV2Stage);
const deploy = vi.mocked(deployV2Stage);
const remove = vi.mocked(deleteV2Stage);

const connection = { engineOrigin: 'http://127.0.0.1:9681', result: undefined };
const endpoint = 'https://127.0.0.1:9323/_aws/execute-api/api-1';
const date = new Date('2026-11-26T12:00:00Z');
const defaultStage: Stage = { StageName: '$default', AutoDeploy: true, DeploymentId: 'd-1', LastUpdatedDate: date };
const devStage: Stage = { StageName: 'dev', AutoDeploy: false };

beforeEach(() => {
  read.mockReset().mockResolvedValue({ items: [defaultStage, devStage] });
  create.mockReset().mockResolvedValue(undefined);
  deploy.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function catalog(items?: Stage[]): AppendedPages<Stage> {
  return {
    items,
    more: false,
    loading: false,
    failure: undefined,
    loadMore: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
  };
}

function view(stages: AppendedPages<Stage>, ProtocolType: GetApiResponse['ProtocolType'] = 'HTTP') {
  return (
    <MemoryRouter>
      <V2Stages api={{ ApiId: apiId, ApiEndpoint: endpoint, ProtocolType }} stages={stages} connection={connection} />
    </MemoryRouter>
  );
}

function renderView(ui: React.ReactElement) {
  const client = new QueryClient();
  return render(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

const page = createWrapper(document.body);

function table() {
  const wrapper = page.findTable();
  assert(wrapper);
  return wrapper;
}

function flash() {
  return page.findFlashbar()?.findItems()[0]?.getElement();
}

it('shows HTTP stage metadata, the two kinds of invoke address and the guidance when empty', async () => {
  const user = userEvent.setup();
  const { rerender } = renderView(view(catalog([defaultStage, devStage])));
  const first = table().findRows()[0]?.getElement();
  assert(first);
  for (const text of ['$default', 'On', 'd-1', creationDateText(date), endpoint]) {
    expect(first).toHaveTextContent(text);
  }
  const dev = table().findRows()[1]?.getElement();
  assert(dev);
  expect(dev).toHaveTextContent('Off');
  expect(dev).toHaveTextContent(`${endpoint}/dev`);
  expect(within(first).getByRole('button', { name: 'Copy deployment ID' })).toBeInTheDocument();
  await user.click(within(dev).getByRole('button', { name: 'Copy invoke address' }));
  expect(await navigator.clipboard.readText()).toBe(`${endpoint}/dev`);

  rerender(view(catalog([])));
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent('No stages');
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent('Create a stage to get an invoke URL.');
});

it('copies the WebSocket deployment ID and shows no invoke-address column or empty-state suggestion', async () => {
  const user = userEvent.setup();
  const { rerender } = renderView(view(catalog([defaultStage]), 'WEBSOCKET'));
  const first = table().findRows()[0]?.getElement();
  assert(first);
  for (const text of ['$default', 'On', 'd-1', creationDateText(date)]) {
    expect(first).toHaveTextContent(text);
  }
  expect(
    table()
      .findColumnHeaders()
      .map((column) => column.getElement().textContent?.trim()),
  ).not.toContain('Invoke address');
  await user.click(within(first).getByRole('button', { name: 'Copy deployment ID' }));
  expect(await navigator.clipboard.readText()).toBe('d-1');

  rerender(view(catalog([]), 'WEBSOCKET'));
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent('No stages');
  expect(table().findEmptySlot()?.getElement()).not.toHaveTextContent('Create a stage to get an invoke URL.');
});

const emulator = { port: 9682, endpoint: 'https://127.0.0.1:9682' };
const stopped = { kind: 'emulator-unreachable', checkedAt: 1, emulator, reason: 'not_started', message: '' } as const;
const connected = { kind: 'connected', checkedAt: 1, emulator } as const;
const operation = 'GetStages';

it.each<{
  failure: RequestFailure;
  first: string;
  detail: string;
  health?: AreaConnection['result'];
  recovery?: boolean;
}>([
  {
    failure: { kind: 'not-implemented', operation },
    first: 'Not implemented by the emulator',
    detail: 'The emulator answered 501 Not Implemented for GetStages, so Studio cannot show the stages.',
  },
  {
    failure: { kind: 'access-denied', operation, message: 'The policy denies this API.' },
    first: 'Access denied',
    detail: 'GetStages was refused: The policy denies this API.',
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation, message: 'Connection refused.' },
    health: stopped,
    first: 'Not started on port 9682',
    detail: 'GetStages got no answer from the emulator. Connection refused.',
    recovery: true,
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation, message: 'Timed out.' },
    health: connected,
    first: 'Not answering at https://127.0.0.1:9682',
    detail: 'GetStages got no answer from the emulator. Timed out.',
    recovery: true,
  },
  {
    failure: { kind: 'engine-did-not-answer', operation },
    first: 'The EmuForge engine at http://127.0.0.1:9681 is not answering',
    detail: 'GetStages got no answer.',
    recovery: true,
  },
  {
    failure: { kind: 'other', operation, code: 'Oops', message: 'Unrecognized API.' },
    first: 'The stages could not be read',
    detail: 'GetStages: Oops: Unrecognized API.',
  },
])('shows "$first" and restores stages after Retry', async ({ failure, first, detail, health, recovery }) => {
  const user = userEvent.setup();
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [devStage] });
  renderView(
    <MemoryRouter>
      <StagesWithFlash protocol="HTTP" health={health} />
    </MemoryRouter>,
  );
  await waitFor(() => {
    const empty = table().findEmptySlot()?.getElement();
    expect(empty).toHaveTextContent(first);
    expect(empty).toHaveTextContent(detail);
  });
  const empty = table().findEmptySlot()?.getElement();
  assert(empty);
  const status = within(empty).queryByRole('link', { name: 'Connection status' });
  if (recovery) expect(status).toHaveAttribute('href', '/');
  else expect(status).not.toBeInTheDocument();

  await user.click(within(empty).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(table().findRows()[0]?.getElement()).toHaveTextContent('dev'));
  expect(table().findRows()[0]?.getElement()).toHaveTextContent(`${endpoint}/dev`);
  expect(table().findEmptySlot()).toBeNull();
});

function StagesWithFlash({
  protocol,
  health,
}: {
  protocol: GetApiResponse['ProtocolType'];
  health?: AreaConnection['result'];
}) {
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/aws/apigateway/apis/v2/api-1', 0, true);
  const stages = useV2Stages(connection.engineOrigin, apiId);
  return (
    <PageFlashContext.Provider value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <V2Stages
        api={{ ApiId: apiId, ApiEndpoint: endpoint, ProtocolType: protocol }}
        stages={stages}
        connection={{ ...connection, result: health }}
      />
    </PageFlashContext.Provider>
  );
}

async function open(protocol: GetApiResponse['ProtocolType'] = 'HTTP') {
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  renderView(
    <MemoryRouter>
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <StagesWithFlash protocol={protocol} />
        </div>
      </AreaRootContext.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(table().findRows()[1]?.getElement()).toHaveTextContent('dev'));
  return user;
}

type User = ReturnType<typeof userEvent.setup>;
type Action = 'create' | 'deploy' | 'delete';

async function selectStage(user: User, index: number) {
  const radio = table().findRowSelectionArea(index)?.find('input');
  assert(radio);
  await user.click(radio.getElement());
}

async function submit(user: User, action: Action) {
  if (action !== 'create') await selectStage(user, 2);
  const button = { create: 'Create stage', deploy: 'Deploy', delete: 'Delete' }[action];
  await user.click(screen.getByRole('button', { name: button }));
  if (action === 'deploy') return;
  const dialogName = action === 'create' ? 'Create stage' : 'Delete stage dev?';
  const modal = await waitFor(() => {
    const dialog = page.findModal();
    assert(dialog && dialog.isVisible());
    return dialog;
  });
  expect(modal.findHeader().getElement()).toHaveTextContent(dialogName);
  const input = modal.findContent().findFormField()?.findControl()?.findInput()?.findNativeInput();
  const confirm = modal.findFooter()?.findAllButtons()[1];
  assert(input && confirm);
  await user.type(input.getElement(), action === 'create' ? 'sandbox' : 'dev');
  await user.click(confirm.getElement());
}

const changes = [
  {
    action: 'create',
    updated: [defaultStage, devStage, { StageName: 'sandbox', AutoDeploy: true }],
    message: 'Stage sandbox created.',
  },
  {
    action: 'deploy',
    updated: [defaultStage, { ...devStage, DeploymentId: 'd-2' }],
    message: 'API deployed to stage dev.',
  },
  {
    action: 'delete',
    updated: [defaultStage],
    message: 'Stage dev deleted.',
  },
] as const;

function expectUpdatedStages(action: Action) {
  const rows = table().findRows();
  expect(rows).toHaveLength({ create: 3, deploy: 2, delete: 1 }[action]);
  expect(rows[0]?.getElement()).toHaveTextContent('$default');
  if (action === 'create') expect(rows[2]?.getElement()).toHaveTextContent('sandbox');
  if (action === 'deploy') expect(table().findBodyCell(2, 4)?.getElement()).toHaveTextContent('d-2');
}

it('offers the HTTP actions and explains why an auto-deploy stage cannot be deployed manually', async () => {
  const user = await open();
  const deployButton = screen.getByRole('button', { name: 'Deploy' });
  const deleteButton = screen.getByRole('button', { name: 'Delete' });
  expect(screen.getByRole('button', { name: 'Create stage' })).toBeEnabled();
  expect(deployButton).toBeDisabled();
  expect(deleteButton).toBeDisabled();

  await selectStage(user, 1);
  expect(deployButton).toBeDisabled();
  expect(deployButton).toHaveAccessibleDescription('This stage deploys automatically.');
  expect(screen.getByText('This stage deploys automatically.')).toBeVisible();
  await user.click(deployButton);
  expect(deploy).not.toHaveBeenCalled();
  expect(deleteButton).toBeEnabled();

  await selectStage(user, 2);
  expect(deployButton).toBeEnabled();
  expect(screen.queryByText('This stage deploys automatically.')).not.toBeInTheDocument();
});

it('offers stage deletion on WebSocket APIs without create or deploy actions', async () => {
  const user = await open('WEBSOCKET');
  expect(screen.queryByRole('button', { name: 'Create stage' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
  remove.mockImplementationOnce(async () => {
    read.mockResolvedValueOnce({ items: [defaultStage] });
  });
  await submit(user, 'delete');
  await waitFor(() => expect(flash()).toHaveTextContent('Stage dev deleted.'));
  expect(remove).toHaveBeenCalledWith(connection.engineOrigin, apiId, 'dev', expect.any(AbortSignal));
  await waitFor(() => expectUpdatedStages('delete'));
});

it.each(changes)(
  'shows the $action result and closes any dialog before refreshing the stage table',
  async ({ action, updated, message }) => {
    const user = await open();
    const refreshStarted = vi.fn();
    read.mockImplementationOnce(async () => {
      refreshStarted(flash()?.textContent, page.findModal()?.isVisible() ?? false);
      return { items: [...updated] };
    });

    await submit(user, action);

    await waitFor(() => expectUpdatedStages(action));
    expect(refreshStarted).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(message), false);
    expect(flash()).toHaveTextContent(message);
    expect(read).toHaveBeenCalledTimes(2);
    if (action === 'deploy')
      expect(deploy).toHaveBeenCalledWith(connection.engineOrigin, apiId, 'dev', expect.any(AbortSignal));
  },
);

it.each<[RequestFailure, string, boolean]>([
  [{ kind: 'not-implemented', operation: 'CreateDeployment' }, 'Not implemented by the emulator', true],
  [
    { kind: 'other', operation: 'CreateDeployment', code: 'BadRequestException', message: 'The API has no routes.' },
    'The API has no routes.',
    false,
  ],
])('shows the deployment refusal and disables Deploy for a 501 (%j)', async (failure, reason, unavailable) => {
  deploy.mockRejectedValueOnce(new RequestError(failure));
  const user = await open();

  await submit(user, 'deploy');

  await waitFor(() => {
    expect(flash()).toHaveTextContent('CreateDeployment');
    expect(flash()).toHaveTextContent(reason);
  });
  const button = screen.getByRole('button', { name: 'Deploy' });
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(read).toHaveBeenCalledOnce();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const arrivalOrders = ['older first', 'later first'] as const;

it.each(changes.flatMap((change) => arrivalOrders.map((first) => ({ ...change, first }))))(
  'keeps the later stages and $action result when reads answer $first',
  async ({ action, first, updated, message }) => {
    read.mockResolvedValueOnce({ items: [defaultStage, devStage], next: 'older-page' });
    const user = await open();
    const older = deferred<TokenPage<Stage>>();
    const later = deferred<TokenPage<Stage>>();
    read.mockReturnValueOnce(older.promise).mockReturnValueOnce(later.promise);
    await user.click(screen.getByRole('button', { name: 'Load more stages' }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(connection.engineOrigin, apiId, 'older-page', expect.any(AbortSignal)),
    );
    const oldSignal = read.mock.calls[1]?.[3];

    await submit(user, action);

    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(flash()).toHaveTextContent(message);
    expect(oldSignal?.aborted).toBe(true);
    const answers = {
      'older first': () => older.resolve({ items: [{ StageName: 'stale' }] }),
      'later first': () => later.resolve({ items: [...updated] }),
    };
    const second = first === 'older first' ? 'later first' : 'older first';
    await act(async () => answers[first]());
    if (first === 'later first') await waitFor(() => expectUpdatedStages(action));
    expect(flash()).toHaveTextContent(message);
    await act(async () => answers[second]());
    await waitFor(() => expectUpdatedStages(action));
    expect(flash()).toHaveTextContent(message);
  },
);
