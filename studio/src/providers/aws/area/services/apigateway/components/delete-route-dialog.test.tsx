import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { useV2Routes } from '../v2-queries';
import { deleteV2Route, isIntegrationShared } from '../v2-route-change-api';
import { DeleteRouteDialog } from './delete-route-dialog';
import { V2Routes } from './v2-routes';

vi.mock('../v2-route-change-api', { spy: true });

const connection = { engineOrigin: 'http://127.0.0.1:9681', result: undefined };
const emulator = { port: 9682, endpoint: 'https://127.0.0.1:9682' };
const connected = { kind: 'connected', checkedAt: 1, emulator } as const;
const stopped = { kind: 'emulator-unreachable', checkedAt: 1, emulator, reason: 'not_started', message: '' } as const;
const ui = createWrapper(document.body);
const route = { RouteId: 'r-1', RouteKey: 'GET /events', Target: 'integrations/i-1' };
const request = vi.fn<(request: Request) => Response | Promise<Response>>();
const operation = 'DeleteRoute';

beforeEach(() => {
  request.mockReset().mockImplementation(() => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const next = new Request(input, init);
    if (new URL(next.url).pathname === '/__emuforge/session') {
      return Promise.resolve(Response.json({ token: 'test-session' }));
    }
    return Promise.resolve(request(next));
  });
});
afterEach(() => vi.unstubAllGlobals());

function renderInArea(children: ReactNode) {
  const root = { current: null };
  render(
    <AreaRootContext value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      </div>
    </AreaRootContext>,
  );
}

async function confirmWord(user: ReturnType<typeof userEvent.setup>) {
  const modal = await waitFor(() => {
    const dialog = ui.findModal();
    if (!dialog?.isVisible()) throw new Error('Dialog is not visible');
    return dialog;
  });
  const footer = modal.findFooter();
  const confirm = footer && createWrapper(footer.getElement()).findAllButtons()[1]?.getElement();
  if (!confirm) throw new Error('Missing Delete confirmation button');
  expect(confirm).toHaveTextContent('Delete');
  expect(modal.findHeader().getElement()).toHaveTextContent('Delete route GET /events?');
  const content = modal.findContent().getElement();
  const field = createWrapper(modal.findContent().getElement()).findFormField();
  expect(field?.findLabel()?.getElement()).toHaveTextContent('To confirm, type “delete” in the field.');
  const input = field && createWrapper(field.getElement()).findInput();
  if (!input) throw new Error('Missing confirmation input');
  const confirmation = input.findNativeInput().getElement();
  await user.type(confirmation, 'delete');
  return { modal, content, remove: confirm, confirmation };
}

async function open(target = route, result: AreaConnection['result'] = undefined) {
  const user = userEvent.setup();
  const onDeleted = vi.fn();
  renderInArea(
    <DeleteRouteDialog
      apiId="api-1"
      route={target}
      connection={{ ...connection, result }}
      onDeleted={onDeleted}
      onDismiss={vi.fn()}
    />,
  );
  return { ...(await confirmWord(user)), user, onDeleted };
}

function RoutesWithFirstPage() {
  const routes = useV2Routes(connection.engineOrigin, 'api-1');
  return <V2Routes id="api-1" isHttp routes={routes} integrations={[]} connection={connection} />;
}

it('keeps Delete unavailable after typing the word while the integration check is pending', async () => {
  let answer!: (response: Response) => void;
  request.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      answer = resolve;
    }),
  );
  const { modal, remove, user } = await open();
  expect(createWrapper(modal.findContent().getElement()).findStatusIndicator()?.getElement()).toHaveTextContent(
    'Checking whether another route uses integration i-1…',
  );
  expect(remove).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(request).toHaveBeenCalledOnce();
  await act(async () => answer(Response.json({ items: [] })));
  await waitFor(() => expect(remove).toBeEnabled());
});

it.each([false, true])('checks the second page before deleting (shared: %s)', async (shared) => {
  const first = {
    items: [{ routeId: route.RouteId, routeKey: route.RouteKey, target: route.Target }],
    nextToken: 'next',
  };
  const others = shared ? [{ routeId: 'r-2', routeKey: 'GET /elsewhere', target: route.Target }] : [];
  request
    .mockReturnValueOnce(Response.json(first))
    .mockReturnValueOnce(Response.json(first))
    .mockReturnValueOnce(Response.json({ items: others }))
    .mockReturnValueOnce(new Response(null, { status: 204 }));
  if (!shared) request.mockReturnValueOnce(new Response(null, { status: 204 }));
  request.mockReturnValueOnce(Response.json({ items: others }));

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const user = userEvent.setup();
  renderInArea(<RoutesWithFirstPage />);
  await waitFor(() => {
    const footer = ui.findTable()?.findFooterSlot();
    const loadMore = footer && createWrapper(footer.getElement()).findButton()?.getElement();
    expect(loadMore).toHaveTextContent('Load more routes');
  });
  expect(request).toHaveBeenCalledOnce();
  const selection = ui.findTable()?.findRowSelectionArea(1)?.find('input');
  if (!selection) throw new Error('Missing route selector');
  await user.click(selection.getElement());
  const actions = ui.findHeader()?.findActions();
  const button = actions && createWrapper(actions.getElement()).findAllButtons()[1]?.getElement();
  if (!button) throw new Error('Missing Delete button');
  expect(button).toHaveTextContent('Delete');
  await user.click(button);
  const { content, remove } = await confirmWord(user);
  await waitFor(() => expect(remove).toBeEnabled());

  const message = 'Its integration i-1 is used by no other route and is deleted with it.';
  if (shared) expect(content).not.toHaveTextContent(message);
  else expect(content).toHaveTextContent(message);
  await user.click(remove);
  await waitFor(() => {
    if (shared) expect(ui.findTable()?.findBodyCell(1, 2)?.getElement()).toHaveTextContent('GET /elsewhere');
    else expect(ui.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No routes');
  });
  expect(ui.findTable()?.getElement()).not.toHaveTextContent(route.RouteKey);
  expect(
    request.mock.calls.map(([sent]) => [
      sent.method,
      new URL(sent.url).pathname,
      new URL(sent.url).searchParams.get('nextToken'),
    ]),
  ).toEqual([
    ['GET', '/v2/apis/api-1/routes', null],
    ['GET', '/v2/apis/api-1/routes', null],
    ['GET', '/v2/apis/api-1/routes', 'next'],
    ['DELETE', '/v2/apis/api-1/routes/r-1', null],
    ...(shared ? [] : [['DELETE', '/v2/apis/api-1/integrations/i-1', null]]),
    ['GET', '/v2/apis/api-1/routes', null],
  ]);
});

const read = 'GetRoutes';
const emulatorFailure = { operation: read, kind: 'emulator-did-not-answer', message: 'Timed out.' } as const;
it.each<[RequestFailure, AreaConnection['result'], string, string, boolean]>([
  [
    { operation: read, kind: 'not-implemented' },
    connected,
    'Not implemented by the emulator',
    '501 Not Implemented for GetRoutes',
    false,
  ],
  [
    { operation: read, kind: 'access-denied', message: 'Policy denies routes.' },
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
    { operation: read, kind: 'engine-did-not-answer' },
    connected,
    'The EmuForge engine at http://127.0.0.1:9681 is not answering',
    'GetRoutes got no answer.',
    true,
  ],
  [
    { operation: read, kind: 'other', code: 'InvalidId', message: 'Route check refused.' },
    stopped,
    'The routes could not be read',
    'GetRoutes: InvalidId: Route check refused.',
    false,
  ],
])('recovers the integration check after Retry from %j (%j)', async (failure, result, heading, reason, recovery) => {
  vi.mocked(isIntegrationShared).mockRejectedValueOnce(new RequestError(failure));
  request.mockReturnValueOnce(Response.json({ items: [] }));
  const { content, remove, user, onDeleted } = await open(route, result);
  await waitFor(() => expect(content).toHaveTextContent(heading));
  expect(content).toHaveTextContent(reason);
  const dialog = createWrapper(content);
  const status = dialog.findLink()?.getElement();
  if (recovery) {
    expect(status).toHaveTextContent('Connection status');
    expect(status).toHaveAttribute('href', '/');
  } else {
    expect(status).toBeUndefined();
  }
  expect(remove).toBeDisabled();
  const retry = dialog.findButton()?.getElement();
  if (!retry) throw new Error('Missing Retry button');
  expect(retry).toHaveTextContent('Retry');
  await user.click(retry);
  await waitFor(() => {
    expect(remove).toBeEnabled();
    expect(content).toHaveTextContent('Its integration i-1 is used by no other route and is deleted with it.');
    expect(content).not.toHaveTextContent(reason);
  });
  await user.click(remove);
  await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
});

it.each<[RequestFailure, string]>([
  [{ operation, kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ operation, kind: 'access-denied', message: 'Policy denies this action.' }, 'Policy denies this action.'],
  [{ operation, kind: 'other', code: 'BadRequestException', message: 'Route refused.' }, 'Route refused.'],
  [{ operation, kind: 'emulator-did-not-answer', message: 'Timed out.' }, 'Timed out.'],
  [{ operation, kind: 'engine-did-not-answer' }, 'did not answer'],
])('keeps the confirmation and shows the DeleteRoute failure (%j)', async (failure, message) => {
  vi.mocked(deleteV2Route).mockRejectedValueOnce(new RequestError(failure));
  const { modal, remove, user, onDeleted, confirmation } = await open({ ...route, Target: '' });
  await user.click(remove);
  await waitFor(() => {
    const alert = createWrapper(modal.findContent().getElement()).findAlert()?.getElement();
    expect(alert).toHaveTextContent(operation);
    expect(alert).toHaveTextContent(message);
  });
  expect(confirmation).toHaveValue('delete');
  expect(onDeleted).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(remove).toBeDisabled();
  else expect(remove).toBeEnabled();
});
