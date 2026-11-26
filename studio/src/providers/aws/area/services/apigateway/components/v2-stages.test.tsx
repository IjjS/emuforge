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

function row(name: string) {
  const element = screen.getByRole('rowheader', { name }).closest('tr');
  assert(element);
  return element;
}

it('shows HTTP stage metadata, the two kinds of invoke address and the guidance when empty', async () => {
  const user = userEvent.setup();
  const { rerender } = renderView(view(catalog([defaultStage, devStage])));
  const first = row('$default');
  for (const text of ['$default', 'On', 'd-1', creationDateText(date), endpoint]) {
    expect(first).toHaveTextContent(text);
  }
  const dev = row('dev');
  expect(dev).toHaveTextContent('Off');
  expect(dev).toHaveTextContent(`${endpoint}/dev`);
  expect(within(first).getByRole('button', { name: 'Copy deployment ID' })).toBeInTheDocument();
  await user.click(within(dev).getByRole('button', { name: 'Copy invoke address' }));
  expect(await navigator.clipboard.readText()).toBe(`${endpoint}/dev`);

  rerender(view(catalog([])));
  expect(screen.getByText('No stages')).toBeInTheDocument();
  expect(screen.getByText('Create a stage to get an invoke URL.')).toBeInTheDocument();
});

it('copies the WebSocket deployment ID and shows no invoke-address column or empty-state suggestion', async () => {
  const user = userEvent.setup();
  const { rerender } = renderView(view(catalog([defaultStage]), 'WEBSOCKET'));
  const first = row('$default');
  for (const text of ['$default', 'On', 'd-1', creationDateText(date)]) {
    expect(first).toHaveTextContent(text);
  }
  expect(screen.queryByRole('columnheader', { name: 'Invoke address' })).not.toBeInTheDocument();
  await user.click(within(first).getByRole('button', { name: 'Copy deployment ID' }));
  expect(await navigator.clipboard.readText()).toBe('d-1');

  rerender(view(catalog([]), 'WEBSOCKET'));
  expect(screen.getByText('No stages')).toBeInTheDocument();
  expect(screen.queryByText('Create a stage to get an invoke URL.')).not.toBeInTheDocument();
});

it('shows the operation and retry when GetStages fails', async () => {
  const user = userEvent.setup();
  const stages = {
    ...catalog(),
    failure: { kind: 'other', operation: 'GetStages', code: 'Oops', message: 'Unrecognized API.' },
  } as const;
  renderView(view(stages));
  expect(screen.getByText('The stages could not be read')).toBeInTheDocument();
  expect(screen.getByText('GetStages: Oops: Unrecognized API.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(stages.retry).toHaveBeenCalledOnce();
});

function StagesWithFlash({ protocol }: { protocol: GetApiResponse['ProtocolType'] }) {
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/aws/apigateway/apis/v2/api-1', 0, true);
  const stages = useV2Stages(connection.engineOrigin, apiId);
  return (
    <PageFlashContext.Provider value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <V2Stages
        api={{ ApiId: apiId, ApiEndpoint: endpoint, ProtocolType: protocol }}
        stages={stages}
        connection={connection}
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
  await screen.findByRole('rowheader', { name: 'dev' });
  return user;
}

type User = ReturnType<typeof userEvent.setup>;
type Action = 'create' | 'deploy' | 'delete';

async function selectStage(user: User, index: number) {
  const radio = createWrapper(document.body).findTable()?.findRowSelectionArea(index)?.find('input');
  assert(radio);
  await user.click(radio.getElement());
}

async function submit(user: User, action: Action) {
  if (action !== 'create') await selectStage(user, 2);
  const button = { create: 'Create stage', deploy: 'Deploy', delete: 'Delete' }[action];
  await user.click(screen.getByRole('button', { name: button }));
  if (action === 'deploy') return;
  const dialogName = action === 'create' ? 'Create stage' : 'Delete stage dev?';
  const dialog = within(await screen.findByRole('dialog', { name: dialogName }));
  const input = createWrapper(document.body).findModal()?.findContent().findInput()?.findNativeInput();
  assert(input);
  await user.type(input.getElement(), action === 'create' ? 'sandbox' : 'dev');
  await user.click(dialog.getByRole('button', { name: button }));
}

const changes = [
  {
    action: 'create',
    request: create,
    updated: [defaultStage, devStage, { StageName: 'sandbox', AutoDeploy: true }],
    message: 'Stage sandbox created.',
  },
  {
    action: 'deploy',
    request: deploy,
    updated: [defaultStage, { ...devStage, DeploymentId: 'd-2' }],
    message: 'API deployed to stage dev.',
  },
  {
    action: 'delete',
    request: remove,
    updated: [defaultStage],
    message: 'Stage dev deleted.',
  },
] as const;

function expectUpdatedStages(action: Action) {
  if (action === 'create') expect(screen.getByRole('rowheader', { name: 'sandbox' })).toBeVisible();
  if (action === 'deploy') expect(row('dev')).toHaveTextContent('d-2');
  if (action === 'delete') expect(screen.queryByRole('rowheader', { name: 'dev' })).not.toBeInTheDocument();
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
  expect(await screen.findByRole('list', { name: 'Notifications' })).toHaveTextContent('Stage dev deleted.');
  expect(remove).toHaveBeenCalledWith(connection.engineOrigin, apiId, 'dev', expect.any(AbortSignal));
  await waitFor(() => expectUpdatedStages('delete'));
});

it.each(changes)(
  'shows the $action result and refreshes the stage table',
  async ({ action, request, updated, message }) => {
    const user = await open();
    request.mockImplementationOnce(async () => {
      read.mockResolvedValueOnce({ items: [...updated] });
    });

    await submit(user, action);

    expect(await screen.findByRole('list', { name: 'Notifications' })).toHaveTextContent(message);
    await waitFor(() => expectUpdatedStages(action));
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

  const notification = await screen.findByRole('list', { name: 'Notifications' });
  expect(notification).toHaveTextContent('CreateDeployment');
  expect(notification).toHaveTextContent(reason);
  const button = screen.getByRole('button', { name: 'Deploy' });
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(read).toHaveBeenCalledOnce();
});

it.each(changes)(
  'keeps the later stages and result when an older read answers after $action',
  async ({ action, request, updated, message }) => {
    read.mockResolvedValueOnce({ items: [defaultStage, devStage], next: 'older-page' });
    const user = await open();
    let replyToOldRead!: (page: TokenPage<Stage>) => void;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        replyToOldRead = resolve;
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Load more stages' }));
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(connection.engineOrigin, apiId, 'older-page', expect.any(AbortSignal)),
    );
    const oldSignal = read.mock.calls[1]?.[3];
    request.mockImplementationOnce(async () => {
      read.mockResolvedValueOnce({ items: [...updated] });
    });

    await submit(user, action);

    const notification = await screen.findByRole('list', { name: 'Notifications' });
    await waitFor(() => expectUpdatedStages(action));
    expect(oldSignal?.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => replyToOldRead({ items: [defaultStage, devStage, { StageName: 'stale' }] }));
    expect(screen.queryByRole('rowheader', { name: 'stale' })).not.toBeInTheDocument();
    expectUpdatedStages(action);
    expect(notification).toHaveTextContent(message);
  },
);
