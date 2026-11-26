import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteV2Route } from '../v2-route-change-api';
import { DeleteRouteDialog } from './delete-route-dialog';

vi.mock('../v2-route-change-api', { spy: true });

const connection = { engineOrigin: 'http://127.0.0.1:9681', result: undefined };
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

async function open(target = route) {
  const root = { current: null };
  const user = userEvent.setup();
  const onDeleted = vi.fn();
  render(
    <AreaRootContext value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <DeleteRouteDialog
              apiId="api-1"
              route={target}
              connection={connection}
              onDeleted={onDeleted}
              onDismiss={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </div>
    </AreaRootContext>,
  );
  const dialog = within(await screen.findByRole('dialog', { name: 'Delete route GET /events?' }));
  const remove = dialog.getByRole('button', { name: 'Delete' });
  const confirmation = dialog.getByRole('textbox', { name: 'To confirm, type “delete” in the field.' });
  await user.type(confirmation, 'delete');
  return { dialog, remove, confirmation, user, onDeleted };
}

it('keeps Delete unavailable after typing the word while the integration check is pending', async () => {
  let answer!: (response: Response) => void;
  request.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      answer = resolve;
    }),
  );
  const { dialog, remove, user } = await open();
  expect(dialog.getByText(/Checking whether another route uses integration/).parentElement).toHaveTextContent(
    'Checking whether another route uses integration i-1…',
  );
  expect(remove).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(request).toHaveBeenCalledOnce();
  await act(async () => answer(Response.json({ items: [] })));
  await waitFor(() => expect(remove).toBeEnabled());
});

it.each([false, true])('checks the second page before deleting (shared: %s)', async (shared) => {
  request
    .mockReturnValueOnce(
      Response.json({ items: [{ routeId: route.RouteId, target: route.Target }], nextToken: 'next' }),
    )
    .mockReturnValueOnce(Response.json({ items: shared ? [{ routeId: 'r-2', target: route.Target }] : [] }));
  const { dialog, remove, user, onDeleted } = await open();
  await waitFor(() => expect(remove).toBeEnabled());

  const message = dialog.queryByText(/Its integration/);
  if (shared) {
    expect(message).not.toBeInTheDocument();
  } else {
    expect(message).toHaveTextContent('Its integration i-1 is used by no other route and is deleted with it.');
  }
  await user.click(remove);
  await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(undefined));
  expect(
    request.mock.calls.map(([sent]) => [
      sent.method,
      new URL(sent.url).pathname,
      new URL(sent.url).searchParams.get('nextToken'),
    ]),
  ).toEqual([
    ['GET', '/v2/apis/api-1/routes', null],
    ['GET', '/v2/apis/api-1/routes', 'next'],
    ['DELETE', '/v2/apis/api-1/routes/r-1', null],
    ...(shared ? [] : [['DELETE', '/v2/apis/api-1/integrations/i-1', null]]),
  ]);
});

it('shows the GetRoutes failure, then enables confirmation after a successful retry', async () => {
  request
    .mockReturnValueOnce(Response.json({ message: 'Routes temporarily unavailable.' }, { status: 400 }))
    .mockReturnValueOnce(Response.json({ items: [] }));
  const { dialog, remove, user, onDeleted } = await open();
  expect(await dialog.findByText(/GetRoutes.*Routes temporarily unavailable\./)).toBeVisible();
  expect(remove).toBeDisabled();
  await user.click(dialog.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(remove).toBeEnabled());
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
  const { dialog, remove, user, onDeleted, confirmation } = await open({ ...route, Target: '' });
  await user.click(remove);
  const alert = await dialog.findByRole('alert');
  expect(alert).toHaveTextContent(operation);
  expect(alert).toHaveTextContent(message);
  expect(confirmation).toHaveValue('delete');
  expect(onDeleted).not.toHaveBeenCalled();
  if (failure.kind === 'not-implemented') expect(remove).toBeDisabled();
  else expect(remove).toBeEnabled();
});
