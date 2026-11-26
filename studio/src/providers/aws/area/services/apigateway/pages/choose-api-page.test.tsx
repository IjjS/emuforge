import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { readRestApis, readV2Apis, type ApiRow } from '../apis-api';
import { SCREENS } from '../screens/choose-api';

vi.mock('../apis-api', async (original) => ({
  ...(await original<typeof import('../apis-api')>()),
  readRestApis: vi.fn(),
  readV2Apis: vi.fn(),
}));

const engineOrigin = 'http://127.0.0.1:9681';
const connection = {
  engineOrigin,
  result: {
    kind: 'connected',
    checkedAt: 1,
    emulator: { port: 9682, endpoint: 'https://127.0.0.1:9682' },
  },
} as const;
const rest: ApiRow = {
  id: 'rest-1',
  name: 'Orders',
  kind: 'REST',
  description: undefined,
  createdDate: undefined,
  endpointTypes: [],
};
const http: ApiRow = { ...rest, id: 'http-1', name: 'Events', kind: 'HTTP' };
const webSocket: ApiRow = { ...rest, id: 'ws-1', name: 'Updates', kind: 'WebSocket' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readRestApis).mockResolvedValue({ items: [rest] });
  vi.mocked(readV2Apis).mockResolvedValue({ items: [http, webSocket] });
});

function Destination() {
  const { pathname, search } = useLocation();
  return <output>{pathname + search}</output>;
}

function open(suffix: string, result: AreaConnection['result'] = connection.result) {
  const path = `/aws/apigateway/${suffix}`;
  const registered = SCREENS.find((entry) => entry.paths.includes(path));
  if (registered === undefined) throw new Error(`No Choose an API screen at ${path}`);
  const { Page } = registered;
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={<Page connection={{ ...connection, result }} params={{}} />} />
          <Route path="*" element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return createWrapper(view.container);
}

async function openChoice(wrapper: ReturnType<typeof open>, user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Open' });
  const select = wrapper.findSelect();
  if (select === null) throw new Error('Missing API select');
  await user.click(select.findTrigger().getElement());
  return select.findDropdown();
}

it.each([
  ['resources', 'Resources', 'rest', 'resources', rest],
  ['stages', 'Stages', 'rest', 'stages', rest],
  ['routes', 'Routes', 'v2', 'routes', http],
  ['integrations', 'Integrations', 'v2', 'integrations', http],
  ['v2-stages', 'V2 stages', 'v2', 'stages', webSocket],
] as const)('offers the APIs for %s and opens its selected part', async (suffix, name, model, part, selected) => {
  const wrapper = open(suffix);
  const user = userEvent.setup();
  expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  expect(screen.getByText(`${name} belong to an API. Choose the API to open them.`)).toBeInTheDocument();

  const openButton = await screen.findByRole('button', { name: 'Open' });
  expect(openButton).toBeDisabled();
  const dropdown = await openChoice(wrapper, user);
  const option = await waitFor(() => {
    const found = dropdown.findOptionByValue(selected.id);
    if (found === null) throw new Error(`Missing API option ${selected.id}`);
    return found;
  });
  if (model === 'rest') {
    expect(dropdown.findOptionByValue(http.id)).toBeNull();
    expect(dropdown.findOptionByValue(webSocket.id)).toBeNull();
    expect(readV2Apis).not.toHaveBeenCalled();
    expect(readRestApis).toHaveBeenCalledTimes(1);
  } else {
    expect(dropdown.findOptionByValue(http.id)).not.toBeNull();
    expect(dropdown.findOptionByValue(webSocket.id)).not.toBeNull();
    expect(dropdown.findOptionByValue(rest.id)).toBeNull();
    expect(readRestApis).not.toHaveBeenCalled();
    expect(readV2Apis).toHaveBeenCalledTimes(1);
  }

  await user.click(option.getElement());
  expect(openButton).toBeEnabled();
  await user.click(openButton);
  expect(screen.getByRole('status')).toHaveTextContent(`/aws/apigateway/apis/${model}/${selected.id}?show=${part}`);
});

it('loads a further page of APIs by the first page token', async () => {
  const further = { ...rest, id: 'rest-2', name: 'Shipping' };
  vi.mocked(readRestApis)
    .mockResolvedValueOnce({ items: [rest], next: 'second-page' })
    .mockResolvedValueOnce({ items: [further] });
  const user = userEvent.setup();
  const dropdown = await openChoice(open('resources'), user);
  await user.click(await within(dropdown.getElement()).findByRole('button', { name: 'Load more' }));

  await waitFor(() => {
    expect(dropdown.findOptionByValue(further.id)).not.toBeNull();
    expect(dropdown.findOptionByValue(rest.id)).not.toBeNull();
  });
  expect(readRestApis).toHaveBeenCalledTimes(2);
  expect(readRestApis).toHaveBeenLastCalledWith(engineOrigin, 'second-page', expect.any(AbortSignal));
});

it.each([
  ['resources', readRestApis, 'No REST APIs'],
  ['routes', readV2Apis, 'No HTTP or WebSocket APIs'],
] as const)('offers Create API when %s has no API of its model', async (suffix, read, empty) => {
  vi.mocked(read).mockResolvedValue({ items: [] });
  open(suffix);

  expect(await screen.findByText(empty)).toBeInTheDocument();
  expect(screen.getByText('The emulator holds none.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create API' })).toHaveAttribute('href', '/aws/apigateway/apis/create');
});

interface FailureCase {
  suffix: string;
  read: typeof readRestApis | typeof readV2Apis;
  failure: RequestFailure;
  first: string;
  detail: string;
  result?: AreaConnection['result'];
  recovery?: true;
}

const failureCases: FailureCase[] = [
  {
    suffix: 'resources',
    read: readRestApis,
    failure: { kind: 'not-implemented', operation: 'GetRestApis' },
    first: 'Not implemented by the emulator',
    detail: 'The emulator answered 501 Not Implemented for GetRestApis, so Studio cannot show the REST APIs.',
  },
  {
    suffix: 'routes',
    read: readV2Apis,
    failure: { kind: 'access-denied', operation: 'GetApis', message: 'The API list was refused.' },
    first: 'Access denied',
    detail: 'GetApis was refused: The API list was refused.',
  },
  {
    suffix: 'integrations',
    read: readV2Apis,
    failure: { kind: 'other', operation: 'GetApis', code: 'InternalError', message: 'Unexpected list error.' },
    first: 'The HTTP or WebSocket APIs could not be read',
    detail: 'GetApis: InternalError: Unexpected list error.',
  },
  {
    suffix: 'stages',
    read: readRestApis,
    failure: { kind: 'emulator-did-not-answer', operation: 'GetRestApis', message: 'The request timed out.' },
    first: 'Not answering at https://127.0.0.1:9682',
    detail: 'GetRestApis got no answer from the emulator. The request timed out.',
    recovery: true,
  },
  {
    suffix: 'resources',
    read: readRestApis,
    failure: { kind: 'emulator-did-not-answer', operation: 'GetRestApis', message: '' },
    first: 'Not started on port 9682',
    detail: 'GetRestApis got no answer from the emulator.',
    result: { ...connection.result, kind: 'emulator-unreachable', reason: 'not_started', message: '' },
    recovery: true,
  },
  {
    suffix: 'v2-stages',
    read: readV2Apis,
    failure: { kind: 'engine-did-not-answer', operation: 'GetApis' },
    first: 'The EmuForge engine at http://127.0.0.1:9681 is not answering',
    detail: 'GetApis got no answer.',
    recovery: true,
  },
];

it.each(failureCases)('names the $failure.kind failure of $failure.operation and retries', async (testCase) => {
  const { suffix, read, failure, first, detail, result, recovery } = testCase;
  vi.mocked(read).mockRejectedValueOnce(new RequestError(failure));
  const wrapper = open(suffix, result);

  expect(await screen.findByText(detail)).toBeInTheDocument();
  expect(wrapper.getElement()).toHaveTextContent(first);
  const recoveryLink = screen.queryByRole('link', { name: 'Connection status' });
  if (recovery === true) {
    expect(recoveryLink).toHaveAttribute('href', '/');
  } else {
    expect(recoveryLink).not.toBeInTheDocument();
  }
  expect(screen.queryByText('The emulator holds none.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Open' })).toBeDisabled();
  expect(read).toHaveBeenCalledTimes(2);
});
