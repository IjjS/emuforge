import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AppendedPages } from '../queries';
import { V2Integrations } from './v2-integrations';
import { V2Routes } from './v2-routes';

const connection = { engineOrigin: 'http://127.0.0.1:9681', result: undefined };
const target = 'http://127.0.0.1:9323/target';
const items: Integration[] = [
  { IntegrationId: 'i-used', IntegrationType: 'HTTP_PROXY', IntegrationUri: target, PayloadFormatVersion: '1.0' },
  { IntegrationId: 'i-unused', IntegrationType: 'MOCK' },
];
const route: Route = { RouteId: 'r-1', RouteKey: 'GET /events', Target: 'integrations/i-used' };
const incomplete = 'Not all routes are read.';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function catalog<T>(items?: T[]): AppendedPages<T> {
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

function view(routes: AppendedPages<Route>, integrations = catalog(items)) {
  return (
    <MemoryRouter>
      <V2Integrations routes={routes} integrations={integrations} connection={connection} />
    </MemoryRouter>
  );
}

function integrationRow(id: string) {
  return within(within(screen.getByRole('table', { name: 'Integrations' })).getByRole('row', { name: new RegExp(id) }));
}

function routesCell(id: string) {
  return integrationRow(id).getAllByRole('cell').at(-1);
}

it('shows integration metadata, copy controls, route keys and an unused integration once all routes are read', async () => {
  const user = userEvent.setup();
  render(view(catalog([route])));
  const row = integrationRow('i-used');
  for (const text of ['i-used', 'HTTP_PROXY', '1.0', 'GET /events']) {
    expect(row.getByText(text)).toBeInTheDocument();
  }
  await user.click(row.getByRole('button', { name: 'Copy integration ID' }));
  expect(await navigator.clipboard.readText()).toBe('i-used');
  await user.click(row.getByRole('button', { name: 'Copy target' }));
  expect(await navigator.clipboard.readText()).toBe(target);
  expect(routesCell('i-unused')).toHaveTextContent(/^\s*-\s*$/);
});

it('shows the integration operation and retry if GetIntegrations fails', async () => {
  const user = userEvent.setup();
  const integrations = {
    ...catalog<Integration>(),
    failure: { kind: 'access-denied', operation: 'GetIntegrations', message: 'Refused.' },
  } as const;
  render(view(catalog([]), integrations));
  expect(screen.getByText('Access denied')).toBeInTheDocument();
  expect(screen.getByText('GetIntegrations was refused: Refused.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(integrations.retry).toHaveBeenCalledOnce();
});

it.each([
  { ...catalog<Route>(), loading: true },
  { ...catalog([route]), failure: { kind: 'other', operation: 'GetRoutes', code: 'Failed' } } as const,
  { ...catalog([route]), more: true },
])('marks route references incomplete while routes are pending, failed or partially read (%#)', (routes) => {
  render(view(routes));
  expect(routesCell('i-unused')).toHaveTextContent(incomplete);
  expect(routesCell('i-used')).toHaveTextContent(incomplete);
  if (routes.items !== undefined)
    expect(routesCell('i-used')).toHaveTextContent(/GET \/events.*Not all routes are read/);
});

it('updates the integration when Load more routes brings its only route', async () => {
  const user = userEvent.setup();
  function TwoParts() {
    const [complete, setComplete] = useState(false);
    const routes = {
      ...catalog(complete ? [route] : []),
      more: !complete,
      loadMore: () => setComplete(true),
    };
    return (
      <MemoryRouter>
        <V2Routes id="api-1" isHttp routes={routes} integrations={items} connection={connection} />
        <V2Integrations routes={routes} integrations={catalog(items)} connection={connection} />
      </MemoryRouter>
    );
  }

  render(<TwoParts />);
  expect(routesCell('i-used')).toHaveTextContent(incomplete);
  await user.click(screen.getByRole('button', { name: 'Load more routes' }));
  expect(routesCell('i-used')).toHaveTextContent('GET /events');
  expect(routesCell('i-used')).not.toHaveTextContent(incomplete);
});
