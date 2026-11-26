import type { Integration, Route } from '@aws-sdk/client-apigatewayv2';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import type { AppendedPages } from '../queries';
import { readV2Integrations } from '../v2-api';
import { useV2Integrations } from '../v2-queries';
import { V2Integrations } from './v2-integrations';
import { V2Routes } from './v2-routes';

vi.mock('../v2-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9681';
const emulator = { port: 9682, endpoint: 'https://127.0.0.1:9682' };
const connection: AreaConnection = { engineOrigin, result: { kind: 'connected', checkedAt: 1, emulator } };
const stopped: AreaConnection = {
  engineOrigin,
  result: { kind: 'emulator-unreachable', checkedAt: 1, emulator, reason: 'not_started', message: '' },
};
const operation = 'GetIntegrations';
const emulatorFailure = { kind: 'emulator-did-not-answer', operation, message: 'Emulator request timed out.' } as const;
const target = 'http://127.0.0.1:9323/target';
const items: Integration[] = [
  { IntegrationId: 'i-used', IntegrationType: 'HTTP_PROXY', IntegrationUri: target, PayloadFormatVersion: '1.0' },
  { IntegrationId: 'i-unused', IntegrationType: 'MOCK' },
];
const route: Route = { RouteId: 'r-1', RouteKey: 'GET /events', Target: 'integrations/i-used' };
const incomplete = 'Not all routes are read.';

beforeEach(() => {
  vi.mocked(readV2Integrations).mockReset();
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

function view(routes: AppendedPages<Route>) {
  return (
    <MemoryRouter>
      <V2Integrations routes={routes} integrations={catalog(items)} connection={connection} />
    </MemoryRouter>
  );
}

function integrationTable() {
  return createWrapper(document.body)
    .findAllTables()
    .find(
      (table) => table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Integrations',
    );
}

function cell(row: number, column: number) {
  return integrationTable()?.findBodyCell(row, column)?.getElement();
}

it('shows integration metadata, copy controls, route keys and an unused integration once all routes are read', async () => {
  const user = userEvent.setup();
  render(view(catalog([route])));
  expect(integrationTable()?.findRows()).toHaveLength(2);
  const idCell = cell(1, 1);
  const targetCell = cell(1, 3);
  assert(idCell && targetCell);
  expect(idCell).toHaveTextContent('i-used');
  expect(cell(1, 2)).toHaveTextContent('HTTP_PROXY');
  expect(targetCell).toHaveTextContent(target);
  expect(cell(1, 4)).toHaveTextContent('1.0');
  expect(cell(1, 5)).toHaveTextContent('GET /events');
  expect(cell(2, 1)).toHaveTextContent('i-unused');
  expect(cell(2, 5)).toHaveTextContent(/^\s*-\s*$/);

  await user.click(within(idCell).getByRole('button', { name: 'Copy integration ID' }));
  expect(await navigator.clipboard.readText()).toBe('i-used');
  await user.click(within(targetCell).getByRole('button', { name: 'Copy target' }));
  expect(await navigator.clipboard.readText()).toBe(target);
});

it.each<[RequestFailure, string, string, AreaConnection, boolean]>([
  [
    { kind: 'not-implemented', operation },
    'Not implemented by the emulator',
    'The emulator answered 501 Not Implemented for GetIntegrations, so Studio cannot show the integrations.',
    connection,
    false,
  ],
  [
    { kind: 'access-denied', operation, message: 'Integration access was denied by the engine.' },
    'Access denied',
    'GetIntegrations was refused: Integration access was denied by the engine.',
    connection,
    false,
  ],
  [
    emulatorFailure,
    'Not started on port 9682',
    'GetIntegrations got no answer from the emulator. Emulator request timed out.',
    stopped,
    true,
  ],
  [
    emulatorFailure,
    'Not answering at https://127.0.0.1:9682',
    'GetIntegrations got no answer from the emulator. Emulator request timed out.',
    connection,
    true,
  ],
  [
    { kind: 'engine-did-not-answer', operation },
    'The EmuForge engine at http://127.0.0.1:9681 is not answering',
    'GetIntegrations got no answer.',
    connection,
    true,
  ],
  [
    { kind: 'other', operation, code: 'BadRequestException', message: 'Rejected integration read.' },
    'The integrations could not be read',
    'GetIntegrations: BadRequestException: Rejected integration read.',
    connection,
    false,
  ],
])(
  'shows the GetIntegrations failure and recovers the integration rows (%#)',
  async (failure, title, reason, health, recovery) => {
    vi.mocked(readV2Integrations).mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items });
    const client = new QueryClient();
    function Integrations() {
      const integrations = useV2Integrations(health.engineOrigin, 'api-1');
      return <V2Integrations routes={catalog([route])} integrations={integrations} connection={health} />;
    }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Integrations />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const notice = await waitFor(() => {
      const empty = integrationTable()?.findEmptySlot();
      assert(empty);
      expect(empty.findStatusIndicator()?.getElement()).toHaveTextContent(title);
      return empty.getElement();
    });
    expect(notice).toHaveTextContent(reason);
    const connectionStatus = within(notice).queryByRole('link', { name: 'Connection status' });
    if (recovery) expect(connectionStatus).toHaveAttribute('href', '/');
    else expect(connectionStatus).not.toBeInTheDocument();

    await userEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(cell(1, 1)).toHaveTextContent('i-used');
      expect(cell(1, 5)).toHaveTextContent('GET /events');
      expect(cell(2, 1)).toHaveTextContent('i-unused');
    });
    expect(integrationTable()?.findEmptySlot()).toBeNull();
  },
);

it.each([
  { ...catalog<Route>(), loading: true },
  { ...catalog([route]), failure: { kind: 'other', operation: 'GetRoutes', code: 'Failed' } } as const,
  { ...catalog([route]), more: true },
])('marks route references incomplete while routes are pending, failed or partially read (%#)', (routes) => {
  render(view(routes));
  expect(cell(2, 5)).toHaveTextContent(incomplete);
  expect(cell(1, 5)).toHaveTextContent(incomplete);
  if (routes.items !== undefined) expect(cell(1, 5)).toHaveTextContent(/GET \/events.*Not all routes are read/);
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
  expect(cell(1, 5)).toHaveTextContent(incomplete);
  await user.click(screen.getByRole('button', { name: 'Load more routes' }));
  expect(cell(1, 5)).toHaveTextContent('GET /events');
  expect(cell(1, 5)).not.toHaveTextContent(incomplete);
});
