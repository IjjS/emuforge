import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function apiSelect(wrapper: ReturnType<typeof open>) {
  const field = wrapper.findFormField();
  if (field === null) throw new Error('Missing API form field');
  expect(field.findLabel()?.getElement()).toHaveTextContent('API');
  const select = createWrapper(field.getElement()).findSelect();
  if (select === null) throw new Error('Missing API select');
  return select;
}

async function openChoice(select: ReturnType<typeof apiSelect>, user: ReturnType<typeof userEvent.setup>) {
  await user.click(select.findTrigger().getElement());
  return select.findDropdown();
}

async function findApiOption(dropdown: Awaited<ReturnType<typeof openChoice>>, api: ApiRow) {
  return waitFor(() => {
    const option = dropdown.findOptionByValue(api.id);
    if (option === null) throw new Error(`Missing API option ${api.id}`);
    expect(option.getElement()).toHaveTextContent(api.name);
    return option;
  });
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
  const header = wrapper.findHeader();
  expect(header?.findHeadingText().getElement()).toHaveTextContent(name);
  expect(header?.findDescription()?.getElement()).toHaveTextContent(
    `${name} belong to an API. Choose the API to open them.`,
  );

  const openButton = screen.getByRole('button', { name: 'Open' });
  expect(openButton).toBeDisabled();
  const dropdown = await openChoice(apiSelect(wrapper), user);
  const option = await findApiOption(dropdown, selected);
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

it.each([
  ['resources', readRestApis, rest],
  ['routes', readV2Apis, http],
] as const)('reads current API options when the %s choice reopens', async (suffix, read, original) => {
  const replacement = { ...original, id: `${original.id}-new`, name: 'New API' };
  const user = userEvent.setup();
  const select = apiSelect(open(suffix));
  const trigger = select.findTrigger().getElement();
  expect(read).not.toHaveBeenCalled();
  const dropdown = await openChoice(select, user);
  await findApiOption(dropdown, original);
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');

  vi.mocked(read).mockResolvedValue({ items: [replacement] });
  await user.click(trigger);
  const reopened = select.findDropdown();
  await findApiOption(reopened, replacement);

  expect(reopened.findOptionByValue(original.id)).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(engineOrigin, undefined, expect.any(AbortSignal));
});

it('loads a further page of APIs by the first page token', async () => {
  const further = { ...rest, id: 'rest-2', name: 'Shipping' };
  vi.mocked(readRestApis)
    .mockResolvedValueOnce({ items: [rest], next: 'second-page' })
    .mockResolvedValueOnce({ items: [further] });
  const user = userEvent.setup();
  const dropdown = await openChoice(apiSelect(open('resources')), user);
  await user.click(await within(dropdown.getElement()).findByRole('button', { name: 'Load more' }));

  await findApiOption(dropdown, further);
  await findApiOption(dropdown, rest);
  expect(readRestApis).toHaveBeenCalledTimes(2);
  expect(readRestApis).toHaveBeenLastCalledWith(engineOrigin, 'second-page', expect.any(AbortSignal));
});

it.each([
  ['resources', readRestApis, 'No REST APIs'],
  ['routes', readV2Apis, 'No HTTP or WebSocket APIs'],
] as const)('offers Create API when %s has no API of its model', async (suffix, read, empty) => {
  vi.mocked(read).mockResolvedValue({ items: [] });
  const user = userEvent.setup();
  await openChoice(apiSelect(open(suffix)), user);

  expect(await screen.findByText('The emulator holds none.')).toBeInTheDocument();
  expect(screen.getByText(empty, { ignore: '[role="dialog"] *' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create API' })).toHaveAttribute('href', '/aws/apigateway/apis/create');
});

interface FailureCase {
  failure: RequestFailure;
  first: string;
  detail: string;
  result?: AreaConnection['result'];
  recovery?: true;
}

describe.each([
  ['resources', readRestApis, 'GetRestApis', 'REST APIs', [rest]],
  ['routes', readV2Apis, 'GetApis', 'HTTP or WebSocket APIs', [http, webSocket]],
] as const)('%s list failures', (suffix, read, operation, things, apis) => {
  const failureCases: FailureCase[] = [
    {
      failure: { kind: 'not-implemented', operation },
      first: 'Not implemented by the emulator',
      detail: `The emulator answered 501 Not Implemented for ${operation}, so Studio cannot show the ${things}.`,
    },
    {
      failure: { kind: 'access-denied', operation, message: 'The API list was refused.' },
      first: 'Access denied',
      detail: `${operation} was refused: The API list was refused.`,
    },
    {
      failure: { kind: 'other', operation, code: 'InternalError', message: 'Unexpected list error.' },
      first: `The ${things} could not be read`,
      detail: `${operation}: InternalError: Unexpected list error.`,
    },
    {
      failure: { kind: 'emulator-did-not-answer', operation, message: 'The request timed out.' },
      first: 'Not answering at https://127.0.0.1:9682',
      detail: `${operation} got no answer from the emulator. The request timed out.`,
      recovery: true,
    },
    {
      failure: { kind: 'emulator-did-not-answer', operation, message: '' },
      first: 'Not started on port 9682',
      detail: `${operation} got no answer from the emulator.`,
      result: { ...connection.result, kind: 'emulator-unreachable', reason: 'not_started', message: '' },
      recovery: true,
    },
    {
      failure: { kind: 'engine-did-not-answer', operation },
      first: 'The EmuForge engine at http://127.0.0.1:9681 is not answering',
      detail: `${operation} got no answer.`,
      recovery: true,
    },
  ];

  it.each(failureCases)('restores API options after "$first"', async ({ failure, first, detail, result, recovery }) => {
    vi.mocked(read)
      .mockRejectedValueOnce(new RequestError(failure))
      .mockResolvedValueOnce({ items: [...apis] });
    const wrapper = open(suffix, result);
    const user = userEvent.setup();
    const select = apiSelect(wrapper);
    const dropdown = await openChoice(select, user);
    const dropdownRetry = await waitFor(() => {
      expect(select.findStatusIndicator()?.getElement()).toHaveTextContent(`The ${things} could not be loaded:`);
      const button = select.findErrorRecoveryButton()?.getElement();
      if (button === undefined) throw new Error('Missing dropdown Retry');
      expect(button).toHaveTextContent('Retry');
      return button;
    });
    const content = wrapper.findContainer()?.findContent().getElement();
    if (content === undefined) throw new Error('Missing API choice container');
    const choice = within(content);
    const retry = choice.getAllByRole('button', { name: 'Retry' }).find((button) => button !== dropdownRetry);

    expect(retry).toBeInTheDocument();
    const status = createWrapper(content)
      .findAllStatusIndicators()
      .find((indicator) => !dropdown.getElement().contains(indicator.getElement()));
    expect(status?.getElement()).toHaveTextContent(first);
    expect(content).toHaveTextContent(detail);
    const recoveryLink = choice.queryByRole('link', { name: 'Connection status' });
    if (recovery === true) {
      expect(recoveryLink).toHaveAttribute('href', '/');
    } else {
      expect(recoveryLink).not.toBeInTheDocument();
    }
    expect(content).not.toHaveTextContent('The emulator holds none.');

    await user.click(dropdownRetry);
    await Promise.all(apis.map((api) => findApiOption(dropdown, api)));
    expect(read).toHaveBeenCalledTimes(2);
    expect(select.findErrorRecoveryButton()).toBeNull();
    expect(content).not.toHaveTextContent(detail);
  });
});
