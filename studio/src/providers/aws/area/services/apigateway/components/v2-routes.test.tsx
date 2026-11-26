import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, requestFailure, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import type { AppendedPages } from '../queries';
import { readV2Integrations, readV2Routes } from '../v2-api';
import { useV2Integrations, useV2Routes } from '../v2-queries';
import { deleteV2Route, isIntegrationShared, type IntegrationDeletionWarning } from '../v2-route-change-api';
import { V2Integrations } from './v2-integrations';
import { V2Routes } from './v2-routes';

const connection = { engineOrigin: 'http://127.0.0.1:9681', result: undefined };
const emulator = { port: 9682, endpoint: 'https://127.0.0.1:9682' };
const connected = { kind: 'connected', checkedAt: 1, emulator } as const;
const stopped = { kind: 'emulator-unreachable', checkedAt: 1, emulator, reason: 'not_started', message: '' } as const;
const ui = createWrapper(document.body);
const routesTable = () => ui.findAllTables()[0];
const integrationsTable = () => ui.findAllTables()[1];
const routeActions = () => {
  const header = routesTable()?.findHeaderSlot();
  const actions = header && createWrapper(header.getElement()).findHeader()?.findActions();
  if (!actions) throw new Error('Missing Routes actions');
  return createWrapper(actions.getElement()).findAllButtons();
};
const routeCell = (row: number, column: number) =>
  routesTable()
    ?.findBodyCell(row, column + 1)
    ?.getElement();
const targetCopy = () => {
  const cell = routeCell(1, 4);
  return cell && createWrapper(cell).findCopyToClipboard()?.findCopyButton().getElement();
};

async function clickLoadMore(
  user: ReturnType<typeof userEvent.setup>,
  table: ReturnType<typeof routesTable>,
  label: string,
) {
  const footer = table?.findFooterSlot();
  const button = footer && createWrapper(footer.getElement()).findButton()?.getElement();
  if (!button) throw new Error('Missing load more button');
  expect(button).toHaveTextContent(label);
  await user.click(button);
}
const route: Route = {
  RouteId: 'r-1',
  RouteKey: 'POST /events',
  AuthorizationType: 'AWS_IAM',
  Target: 'integrations/i-1',
};
const target = 'arn:aws:lambda:us-east-1:000000000000:function:events';
const integration: Integration = { IntegrationId: 'i-1', IntegrationType: 'AWS_PROXY', IntegrationUri: target };

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function catalog(items: Route[] = [route]): AppendedPages<Route> {
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

function view(routes: AppendedPages<Route>, integrations: Integration[] = [], isHttp = true) {
  return (
    <MemoryRouter>
      <V2Routes id="api-1" isHttp={isHttp} routes={routes} integrations={integrations} connection={connection} />
    </MemoryRouter>
  );
}

it('shows the route key, authorization, integration kind and copyable target, and the empty state', () => {
  const { rerender } = render(view(catalog(), [integration]));
  for (const [column, text] of ['POST /events', 'AWS_IAM', 'Lambda function', target].entries()) {
    expect(routeCell(1, column + 1)).toHaveTextContent(text);
  }
  expect(targetCopy()).toHaveAccessibleName('Copy target');

  rerender(view(catalog([])));
  expect(routesTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No routes');
});

it.each([{ integrations: [] }, { integrations: [{ IntegrationId: 'other' }] }])(
  'shows and copies the target integration ID while its integration has yet to be read (%j)',
  async ({ integrations }) => {
    const user = userEvent.setup();
    const { rerender } = render(view(catalog(), integrations));
    const copyId = targetCopy();
    if (!copyId) throw new Error('Missing integration ID copy control');
    expect(copyId).toHaveAccessibleName('Copy integration ID');
    await user.click(copyId);
    expect(routeCell(1, 4)).toHaveTextContent('i-1');
    expect(await navigator.clipboard.readText()).toBe('i-1');

    rerender(view(catalog(), [integration]));
    expect(routeCell(1, 3)).toHaveTextContent('Lambda function');
    const copyTarget = targetCopy();
    if (!copyTarget) throw new Error('Missing target copy control');
    expect(copyTarget).toHaveAccessibleName('Copy target');
    await user.click(copyTarget);
    expect(await navigator.clipboard.readText()).toBe(target);
  },
);

it('links to Create route for HTTP and omits the control for WebSocket', () => {
  const { rerender } = render(view(catalog()));
  const create = routeActions()[2]?.getElement();
  expect(create).toHaveTextContent('Create route');
  expect(create).toHaveAttribute('href', '/aws/apigateway/apis/v2/api-1/routes/create');
  rerender(view(catalog(), [], false));
  expect(routeActions()).toHaveLength(2);
});

vi.mock('../v2-api', { spy: true });
vi.mock('../v2-route-change-api', { spy: true });

const getRoutes = vi.mocked(readV2Routes);
const getIntegrations = vi.mocked(readV2Integrations);
const remove = vi.mocked(deleteV2Route);

function RoutesWithReads({ isHttp, areaConnection }: { isHttp: boolean; areaConnection: AreaConnection }) {
  const id = 'api-1';
  const routes = useV2Routes(connection.engineOrigin, id);
  const integrations = useV2Integrations(connection.engineOrigin, id);
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/v2/api-1', 0, true);

  return (
    <PageFlashContext value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <V2Routes
        id={id}
        isHttp={isHttp}
        routes={routes}
        integrations={integrations.items ?? []}
        connection={areaConnection}
      />
      <V2Integrations integrations={integrations} routes={routes} connection={areaConnection} />
    </PageFlashContext>
  );
}

function renderReads(isHttp: boolean, result: AreaConnection['result'] = undefined) {
  const root = { current: null };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AreaRootContext value={root}>
        <div ref={root}>
          <MemoryRouter>
            <RoutesWithReads isHttp={isHttp} areaConnection={{ ...connection, result }} />
          </MemoryRouter>
        </div>
      </AreaRootContext>
    </QueryClientProvider>,
  );
}

const operation = 'GetRoutes';
const emulatorFailure = { operation, kind: 'emulator-did-not-answer', message: 'Timed out.' } as const;
it.each<[RequestFailure, AreaConnection['result'], string, string, boolean]>([
  [
    { operation, kind: 'not-implemented' },
    connected,
    'Not implemented by the emulator',
    '501 Not Implemented for GetRoutes',
    false,
  ],
  [
    { operation, kind: 'access-denied', message: 'Policy denies routes.' },
    connected,
    'Access denied',
    'GetRoutes was refused: Policy denies routes.',
    false,
  ],
  [emulatorFailure, stopped, 'Not started on port 9682', 'GetRoutes got no answer from the emulator. Timed out.', true],
  [
    emulatorFailure,
    connected,
    'Not answering at https://127.0.0.1:9682',
    'GetRoutes got no answer from the emulator. Timed out.',
    true,
  ],
  [
    { operation, kind: 'engine-did-not-answer' },
    connected,
    'The EmuForge engine at http://127.0.0.1:9681 is not answering',
    'GetRoutes got no answer.',
    true,
  ],
  [
    { operation, kind: 'other', code: 'InvalidId', message: 'Route list refused.' },
    stopped,
    'The routes could not be read',
    'GetRoutes: InvalidId: Route list refused.',
    false,
  ],
])('recovers the routes after Retry from %j (%j)', async (failure, result, heading, reason, recovery) => {
  getRoutes
    .mockReset()
    .mockRejectedValueOnce(new RequestError(failure))
    .mockResolvedValueOnce({ items: [route] });
  getIntegrations.mockReset().mockResolvedValueOnce({ items: [integration] });
  renderReads(true, result);

  await waitFor(() => expect(routesTable()?.findEmptySlot()?.getElement()).toHaveTextContent(heading));
  const empty = routesTable()?.findEmptySlot()?.getElement();
  if (!empty) throw new Error('Missing routes empty state');
  expect(empty).toHaveTextContent(reason);
  const state = createWrapper(empty);
  const status = state.findLink()?.getElement();
  if (recovery) {
    expect(status).toHaveTextContent('Connection status');
    expect(status).toHaveAttribute('href', '/');
  } else {
    expect(status).toBeUndefined();
  }
  const retry = state.findButton()?.getElement();
  if (!retry) throw new Error('Missing Retry button');
  expect(retry).toHaveTextContent('Retry');
  await userEvent.click(retry);
  await waitFor(() => expect(routeCell(1, 1)).toHaveTextContent('POST /events'));
});

async function renderRoutes(isHttp: boolean, hasMore = false) {
  const user = userEvent.setup();
  const next = hasMore ? { next: 'older-page' } : {};
  getRoutes.mockReset().mockResolvedValueOnce({ items: [route], ...next });
  getIntegrations.mockReset().mockResolvedValueOnce({ items: [integration], ...next });
  vi.mocked(isIntegrationShared).mockResolvedValue(false);
  renderReads(isHttp);
  await waitFor(() => {
    expect(routeCell(1, 1)).toHaveTextContent('POST /events');
    expect(integrationsTable()?.findBodyCell(1, 1)?.getElement()).toHaveTextContent('i-1');
  });
  return user;
}

it('keeps the first page after a further page fails and appends the recovered page on Retry', async () => {
  const user = await renderRoutes(true, true);
  getRoutes
    .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }))
    .mockResolvedValueOnce({ items: [{ RouteId: 'r-2', RouteKey: 'GET /recovered' }] });
  await clickLoadMore(user, routesTable(), 'Load more routes');

  await waitFor(() =>
    expect(routesTable()?.findFooterSlot()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  const footer = routesTable()?.findFooterSlot()?.getElement();
  if (!footer) throw new Error('Missing routes table footer');
  expect(footer).toHaveTextContent('501 Not Implemented for GetRoutes');
  expect(routeCell(1, 1)).toHaveTextContent('POST /events');
  const retry = createWrapper(footer).findButton()?.getElement();
  if (!retry) throw new Error('Missing Retry button');
  expect(retry).toHaveTextContent('Retry');
  await user.click(retry);
  await waitFor(() => expect(routeCell(2, 1)).toHaveTextContent('GET /recovered'));
  expect(routeCell(1, 1)).toHaveTextContent('POST /events');
});

async function confirmDeletion(user: ReturnType<typeof userEvent.setup>) {
  const selection = routesTable()?.findRowSelectionArea(1)?.find('input');
  if (!selection) throw new Error('Missing route selector');
  await user.click(selection.getElement());
  const button = routeActions()[1]?.getElement();
  if (!button) throw new Error('Missing Delete button');
  expect(button).toHaveTextContent('Delete');
  await user.click(button);
  const modal = await waitFor(() => {
    const dialog = ui.findModal();
    if (!dialog?.isVisible()) throw new Error('Dialog is not visible');
    return dialog;
  });
  const footer = modal.findFooter();
  const confirm = footer && createWrapper(footer.getElement()).findAllButtons()[1]?.getElement();
  if (!confirm) throw new Error('Missing Delete confirmation button');
  expect(confirm).toHaveTextContent('Delete');
  expect(modal.findHeader().getElement()).toHaveTextContent('Delete route POST /events?');
  const field = createWrapper(modal.findContent().getElement()).findFormField();
  const input = field && createWrapper(field.getElement()).findInput();
  if (!input) throw new Error('Missing confirmation input');
  const confirmation = input.findNativeInput().getElement();
  await user.type(confirmation, 'delete');
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
}

function expectDeletionShown() {
  expect(ui.findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent(
    'Route POST /events deleted.',
  );
  expect(ui.findModal()).toBeNull();
}

function expectDeleted() {
  expectDeletionShown();
  expect(routesTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No routes');
}

it.each([true, false])('shows successful deletion and refreshes both lists (HTTP: %s)', async (isHttp) => {
  const user = await renderRoutes(isHttp);
  const readAfterDeletion = async () => {
    expectDeletionShown();
    return { items: [] };
  };
  getRoutes.mockImplementationOnce(readAfterDeletion);
  getIntegrations.mockImplementationOnce(readAfterDeletion);
  remove.mockResolvedValueOnce(undefined);
  await confirmDeletion(user);
  await waitFor(() => {
    expectDeleted();
    expect(integrationsTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No integrations');
  });
  expect(getRoutes).toHaveBeenCalledTimes(2);
  expect(getIntegrations).toHaveBeenCalledTimes(2);
});

it.each([
  {
    answer: {
      $metadata: { httpStatusCode: 409 },
      $fault: 'client',
      name: 'ConflictException',
      message: 'Still referenced.',
    },
    reason: 'DeleteIntegration failed. ConflictException: Still referenced.',
  },
  {
    answer: { $metadata: { httpStatusCode: 501 }, $fault: 'server', message: 'Integration cleanup is unavailable.' },
    reason:
      'Not implemented by the emulator. The emulator answered 501 Not Implemented for DeleteIntegration. Integration cleanup is unavailable.',
  },
])(
  'announces the route deletion and the integration refusal while keeping that integration (%j)',
  async ({ answer, reason }) => {
    const user = await renderRoutes(true);
    const warning: IntegrationDeletionWarning = {
      integrationId: 'i-1',
      failure: requestFailure('DeleteIntegration', answer),
    };
    const warningItem = () => ui.findFlashbar()?.findItemsByType('warning')[0]?.getElement();
    const warningText = `Route POST /events deleted, but its integration i-1 was not: ${reason}`;
    const readWithWarning = vi.fn(() => {
      expectDeletionShown();
      expect(warningItem()).toHaveTextContent(warningText);
    });
    getRoutes.mockImplementationOnce(async () => {
      readWithWarning();
      return { items: [] };
    });
    getIntegrations.mockImplementationOnce(async () => {
      readWithWarning();
      return { items: [integration] };
    });
    remove.mockResolvedValueOnce(warning);
    await confirmDeletion(user);
    await waitFor(() => {
      expectDeleted();
      expect(readWithWarning).toHaveReturnedTimes(2);
      expect(warningItem()).toHaveTextContent(warningText);
      expect(integrationsTable()?.findBodyCell(1, 1)?.getElement()).toHaveTextContent('i-1');
    });
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(['routes', 'integrations'] as const)(
  'keeps both deletions and the result when the older %s response arrives last',
  async (last) => {
    const user = await renderRoutes(true, true);
    const olderRoutes = deferred<TokenPage<Route>>();
    const olderIntegrations = deferred<TokenPage<Integration>>();
    getRoutes.mockReturnValueOnce(olderRoutes.promise).mockResolvedValueOnce({ items: [] });
    getIntegrations.mockReturnValueOnce(olderIntegrations.promise).mockResolvedValueOnce({ items: [] });
    remove.mockResolvedValueOnce(undefined);
    await clickLoadMore(user, routesTable(), 'Load more routes');
    await clickLoadMore(user, integrationsTable(), 'Load more integrations');
    await waitFor(() => {
      expect(getRoutes).toHaveBeenCalledTimes(2);
      expect(getIntegrations).toHaveBeenCalledTimes(2);
    });

    await confirmDeletion(user);
    await waitFor(() => {
      expectDeleted();
      expect(integrationsTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No integrations');
    });

    const replies = {
      routes: () => olderRoutes.resolve({ items: [route] }),
      integrations: () => olderIntegrations.resolve({ items: [integration] }),
    };
    await act(async () => replies[last === 'routes' ? 'integrations' : 'routes']());
    await act(async () => replies[last]());
    expectDeleted();
    expect(integrationsTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No integrations');
    for (const reader of [getRoutes, getIntegrations]) {
      expect(reader.mock.calls[1]?.[3].aborted).toBe(true);
      expect(reader).toHaveBeenCalledTimes(3);
    }
  },
);
