import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
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
  const row = screen.getByRole('row', { name: /POST \/events/ });
  for (const text of ['POST /events', 'AWS_IAM', 'Lambda function', target]) {
    expect(row).toHaveTextContent(text);
  }
  expect(within(row).getByRole('button', { name: 'Copy target' })).toBeInTheDocument();

  rerender(view(catalog([])));
  expect(screen.getByText('No routes')).toBeInTheDocument();
});

it.each([{ integrations: [] }, { integrations: [{ IntegrationId: 'other' }] }])(
  'shows and copies the target integration ID while its integration has yet to be read (%j)',
  async ({ integrations }) => {
    const user = userEvent.setup();
    const { rerender } = render(view(catalog(), integrations));
    const copyId = screen.getByRole('button', { name: 'Copy integration ID' });
    await user.click(copyId);
    expect(screen.getByText('i-1')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('i-1');

    rerender(view(catalog(), [integration]));
    expect(screen.queryByRole('button', { name: 'Copy integration ID' })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /POST \/events/ })).toHaveTextContent('Lambda function');
    await user.click(screen.getByRole('button', { name: 'Copy target' }));
    expect(await navigator.clipboard.readText()).toBe(target);
  },
);

it('links to Create route for HTTP and omits the control for WebSocket', () => {
  const { rerender } = render(view(catalog()));
  expect(screen.getByRole('link', { name: 'Create route' })).toHaveAttribute(
    'href',
    '/aws/apigateway/apis/v2/api-1/routes/create',
  );
  rerender(view(catalog(), [], false));
  expect(screen.queryByRole('link', { name: 'Create route' })).not.toBeInTheDocument();
});

it('loads a further page and keeps existing rows with the operation failure and retry', async () => {
  const user = userEvent.setup();
  const routes = { ...catalog(), more: true };
  const { rerender } = render(view(routes));
  await user.click(screen.getByRole('button', { name: 'Load more routes' }));
  expect(routes.loadMore).toHaveBeenCalledOnce();

  rerender(view({ ...routes, failure: { kind: 'not-implemented', operation: 'GetRoutes' } }));
  expect(screen.getByText('Not implemented by the emulator')).toBeInTheDocument();
  expect(screen.getByText(/501 Not Implemented for GetRoutes/)).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /POST \/events/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(routes.retry).toHaveBeenCalledOnce();
});

vi.mock('../v2-api', { spy: true });
vi.mock('../v2-route-change-api', { spy: true });

const getRoutes = vi.mocked(readV2Routes);
const getIntegrations = vi.mocked(readV2Integrations);
const remove = vi.mocked(deleteV2Route);

function RoutesWithReads({ isHttp }: { isHttp: boolean }) {
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
        connection={connection}
      />
      <V2Integrations integrations={integrations} routes={routes} connection={connection} />
    </PageFlashContext>
  );
}

async function renderRoutes(isHttp: boolean, hasMore = false) {
  const root = { current: null };
  const user = userEvent.setup();
  const next = hasMore ? { next: 'older-page' } : {};
  getRoutes.mockReset().mockResolvedValueOnce({ items: [route], ...next });
  getIntegrations.mockReset().mockResolvedValueOnce({ items: [integration], ...next });
  vi.mocked(isIntegrationShared).mockResolvedValue(false);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AreaRootContext value={root}>
        <div ref={root}>
          <MemoryRouter>
            <RoutesWithReads isHttp={isHttp} />
          </MemoryRouter>
        </div>
      </AreaRootContext>
    </QueryClientProvider>,
  );
  await screen.findByRole('rowheader', { name: 'POST /events' });
  await screen.findByRole('rowheader', { name: 'i-1' });
  return user;
}

async function confirmDeletion(user: ReturnType<typeof userEvent.setup>) {
  const selection = createWrapper(document.body).findTable()?.findRowSelectionArea(1)?.find('input');
  if (!selection) throw new Error('Missing route selector');
  await user.click(selection.getElement());
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Delete route POST /events?' }));
  await user.type(dialog.getByRole('textbox', { name: /To confirm/ }), 'delete');
  const button = dialog.getByRole('button', { name: 'Delete' });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

function expectDeleted() {
  expect(screen.getByRole('list', { name: 'Notifications' })).toHaveTextContent('Route POST /events deleted.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('rowheader', { name: 'POST /events' })).not.toBeInTheDocument();
}

it.each([true, false])('shows successful deletion and refreshes both lists (HTTP: %s)', async (isHttp) => {
  const user = await renderRoutes(isHttp);
  getRoutes.mockResolvedValueOnce({ items: [] });
  getIntegrations.mockResolvedValueOnce({ items: [] });
  remove.mockResolvedValueOnce(undefined);
  await confirmDeletion(user);
  await waitFor(() => {
    expectDeleted();
    expect(screen.getByText('No integrations')).toBeVisible();
  });
  expect(getRoutes).toHaveBeenCalledTimes(2);
  expect(getIntegrations).toHaveBeenCalledTimes(2);
});

it('announces the route deletion and the integration refusal while keeping that integration', async () => {
  const user = await renderRoutes(true);
  const warning: IntegrationDeletionWarning = {
    integrationId: 'i-1',
    failure: { operation: 'DeleteIntegration', kind: 'other', code: 'ConflictException', message: 'Still referenced.' },
  };
  getRoutes.mockResolvedValueOnce({ items: [] });
  getIntegrations.mockResolvedValueOnce({ items: [integration] });
  remove.mockResolvedValueOnce(warning);
  await confirmDeletion(user);
  await waitFor(expectDeleted);
  expect(screen.getByRole('list', { name: 'Notifications' })).toHaveTextContent(
    'Route POST /events deleted, but its integration i-1 was not: Still referenced.',
  );
  expect(screen.getByRole('rowheader', { name: 'i-1' })).toBeVisible();
});

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
    await user.click(screen.getByRole('button', { name: 'Load more routes' }));
    await user.click(screen.getByRole('button', { name: 'Load more integrations' }));
    await waitFor(() => {
      expect(getRoutes).toHaveBeenCalledTimes(2);
      expect(getIntegrations).toHaveBeenCalledTimes(2);
    });

    await confirmDeletion(user);
    await waitFor(() => {
      expectDeleted();
      expect(screen.getByText('No integrations')).toBeVisible();
    });

    const replies = {
      routes: () => olderRoutes.resolve({ items: [route] }),
      integrations: () => olderIntegrations.resolve({ items: [integration] }),
    };
    await act(async () => replies[last === 'routes' ? 'integrations' : 'routes']());
    await act(async () => replies[last]());
    expectDeleted();
    expect(screen.getByText('No integrations')).toBeVisible();
    for (const reader of [getRoutes, getIntegrations]) {
      expect(reader.mock.calls[1]?.[3].aborted).toBe(true);
      expect(reader).toHaveBeenCalledTimes(3);
    }
  },
);
