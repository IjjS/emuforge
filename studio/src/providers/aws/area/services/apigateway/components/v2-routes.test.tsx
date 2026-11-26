import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AppendedPages } from '../queries';
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
    expect(screen.getByText('Lambda function')).toBeInTheDocument();
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
