import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import { registryFaults } from '../../../screens';
import { createMethodPath, restApiPath } from '../format';
import { readFunctions } from '../lambda-api';
import { createMethod } from '../method-create-api';
import { readRestApi, readRestResource, readRestResources } from '../rest-api';
import { SCREENS } from '../screens';

vi.mock('../rest-api', { spy: true });
vi.mock('../lambda-api', { spy: true });
vi.mock('../method-create-api', { spy: true });

const apiId = 'a1b2c3d4e5';
const address = createMethodPath(apiId);
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connected: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const stopped: AreaConnection = {
  engineOrigin,
  result: { kind: 'emulator-unreachable', reason: 'not_started', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const firstResource = { id: 'root', path: '/' };
const linkedResource = { id: 'later-page', path: '/orders' };
const fn = { name: 'orders', arn: 'arn:aws:lambda:us-west-2:123456789012:function:orders' };
const api = vi.mocked(readRestApi);
const linked = vi.mocked(readRestResource);
const resources = vi.mocked(readRestResources);
const functions = vi.mocked(readFunctions);
const create = vi.mocked(createMethod);

beforeEach(() => {
  vi.resetAllMocks();
  api.mockResolvedValue({ id: apiId, name: 'Orders' });
  linked.mockResolvedValue(linkedResource);
  resources.mockResolvedValue({ items: [firstResource], next: 'next-page' });
  functions.mockResolvedValue({ items: [fn] });
  create.mockResolvedValue({ kind: 'created' });
});

function RegisteredPage({ connection }: { connection: AreaConnection }) {
  const { pathname, search } = useLocation();
  if (pathname === restApiPath(apiId)) return <p>Destination {pathname + search}</p>;
  const match = areaPage(pathname);
  if (match.kind !== 'screen') throw new Error(`No matching screen for ${pathname}`);
  return <match.screen.Page connection={connection} params={match.params} />;
}

function open(path = address, connection = connected) {
  const handOver = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageFlashContext.Provider value={{ handOver, show: vi.fn() }}>
          <AreaRootContext.Provider value={root}>
            <div ref={root}>
              <RegisteredPage connection={connection} />
            </div>
          </AreaRootContext.Provider>
        </PageFlashContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const wrapper = createWrapper(container);
  const field = (label: string) => {
    const match = wrapper.findAllFormFields().find((entry) => entry.findLabel()?.getElement().textContent === label);
    if (!match) throw new Error(`Missing field ${label}`);
    return match;
  };
  const select = (label: string) => {
    const match = field(label).findSelect();
    if (match === null) throw new Error(`Missing select ${label}`);
    return match;
  };
  const openSelect = async (label: string) => {
    const choice = select(label);
    await user.click(choice.findTrigger().getElement());
    return choice;
  };
  const choose = async (label: string, value: string) => {
    const choice = await openSelect(label);
    await waitFor(() => expect(choice.findDropdown().findOptionByValue(value)).not.toBeNull());
    choice.selectOptionByValue(value);
  };
  const chooseKind = async (value: string) => {
    const tile = field('Integration kind').findTiles()?.findInputByValue(value);
    if (!tile) throw new Error(`Missing integration option ${value}`);
    await user.click(tile.getElement());
  };
  const shown = () => screen.findByRole('heading', { name: 'Method settings' });
  const submit = () => user.click(screen.getByRole('button', { name: 'Create method' }));
  const cancel = () => user.click(screen.getByRole('button', { name: 'Cancel' }));
  return { handOver, user, field, select, openSelect, choose, chooseKind, shown, submit, cancel };
}

const methods = {
  ANY: 'Every HTTP method.',
  GET: 'Read.',
  POST: 'Create or submit.',
  PUT: 'Replace.',
  PATCH: 'Change a part.',
  DELETE: 'Remove.',
  HEAD: 'Like GET, without a body.',
  OPTIONS: 'Ask what is allowed.',
};

it('reads resources when opened and describes the resource and each known form option', async () => {
  const form = open();
  await form.shown();
  expect(resources).not.toHaveBeenCalled();
  const resource = await form.openSelect('Resource');
  await waitFor(() =>
    expect(resource.findDropdown().findOptionByValue('root')?.getElement()).toHaveTextContent('/ID root'),
  );
  expect(resources).toHaveBeenCalledExactlyOnceWith(engineOrigin, apiId, undefined, expect.any(AbortSignal));
  const known = [
    ['HTTP method', methods],
    [
      'Authorization',
      { NONE: 'Open. No authorization is checked.', AWS_IAM: 'The caller signs the request with AWS credentials.' },
    ],
    ['API key required', { no: 'Callers need no API key.', yes: 'Callers send an API key.' }],
  ] as const;
  for (const [label, options] of known) {
    const choice = await form.openSelect(label);
    for (const [value, description] of Object.entries(options)) {
      expect(choice.findDropdown().findOptionByValue(value)?.getElement()).toHaveTextContent(description);
    }
    await form.user.keyboard('{Escape}');
  }
  const integration = form.field('Integration kind').getElement();
  expect(integration).toHaveTextContent('A Lambda function the emulator holds is invoked.');
  expect(integration).toHaveTextContent('The request is passed to an HTTP address.');
  expect(integration).toHaveTextContent('A fixed answer, without a backend.');
  await form.chooseKind('http');
  expect(
    screen.getByText(
      "The emulator sends no request to this address. It answers only for an address it serves itself, such as another API's invoke URL.",
    ),
  ).toBeVisible();
});

it('uses the independent HTTP integration method and offers all eight described values', async () => {
  const form = open();
  await form.shown();
  await form.choose('Resource', 'root');
  await form.choose('HTTP method', 'PATCH');
  await form.chooseKind('http');
  const choice = await form.openSelect('Integration HTTP method');
  for (const [value, description] of Object.entries(methods)) {
    expect(choice.findDropdown().findOptionByValue(value)?.getElement()).toHaveTextContent(description);
  }
  choice.selectOptionByValue('POST');
  const url = `${endpoint}/_aws/execute-api/sibling/dev`;
  await form.user.type(screen.getByRole('textbox', { name: 'HTTP address' }), url);
  await form.submit();
  await waitFor(() =>
    expect(create).toHaveBeenCalledExactlyOnceWith(
      engineOrigin,
      apiId,
      expect.objectContaining({ method: 'PATCH', integration: { kind: 'http', method: 'POST', address: url } }),
      expect.any(AbortSignal),
    ),
  );
});

it('registers the create route and reads and sends a linked resource that is absent from the first page', async () => {
  expect(address).toBe('/aws/apigateway/apis/rest/a1b2c3d4e5/methods/create');
  expect(registryFaults([{ folder: 'apigateway', screens: SCREENS }], (folder) => folder === 'apigateway')).toEqual([]);
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  expect(linked).toHaveBeenCalledExactlyOnceWith(engineOrigin, apiId, 'later-page', expect.any(AbortSignal));
  expect(resources).not.toHaveBeenCalled();
  await form.chooseKind('mock');
  await form.submit();
  await waitFor(() =>
    expect(create).toHaveBeenCalledExactlyOnceWith(
      engineOrigin,
      apiId,
      expect.objectContaining({ resource: linkedResource }),
      expect.any(AbortSignal),
    ),
  );
});

it('leaves the resource choice empty without an alert when the linked ID is absent', async () => {
  linked.mockResolvedValueOnce(null);
  const form = open(`${address}?resource=missing`);
  await form.shown();
  await waitFor(() =>
    expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('Choose a resource'),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create method' })).toBeEnabled();
});

const linkedOperation = 'GetResource';
const readFailures: {
  failure: RequestFailure;
  connection?: AreaConnection;
  heading: string;
  detail: string;
  recovery?: boolean;
}[] = [
  {
    failure: { kind: 'not-implemented', operation: linkedOperation },
    heading: 'Not implemented by the emulator',
    detail: '501 Not Implemented for GetResource',
  },
  {
    failure: {
      kind: 'other',
      operation: linkedOperation,
      code: 'BadRequest',
      message: 'Resource request refused in full.',
    },
    connection: stopped,
    heading: 'The linked resource could not be read',
    detail: 'GetResource: BadRequest: Resource request refused in full.',
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation: linkedOperation, message: 'Request timed out.' },
    heading: 'Not answering at',
    detail: 'GetResource got no answer from the emulator. Request timed out.',
    recovery: true,
  },
  {
    failure: { kind: 'engine-did-not-answer', operation: linkedOperation },
    heading: 'The EmuForge engine at',
    detail: 'GetResource got no answer.',
    recovery: true,
  },
];

it.each(readFailures)(
  'shows $failure.kind above the linked resource choice, which still works until Retry',
  async ({ failure, connection, heading, detail, recovery }) => {
    linked.mockRejectedValueOnce(new RequestError(failure));
    const form = open(`${address}?resource=later-page`, connection);
    const headingElement = await screen.findByText(heading, { exact: !recovery });
    expect(await screen.findByText(detail, { exact: !recovery && failure.kind !== 'not-implemented' })).toBeVisible();
    const trigger = form.select('Resource').findTrigger().getElement();
    expect(headingElement.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger).toHaveTextContent('Choose a resource');
    if (recovery) expect(screen.getByRole('link', { name: 'Connection status' })).toBeVisible();
    const choice = await form.openSelect('Resource');
    await waitFor(() => expect(choice.findDropdown().findOptionByValue('root')).not.toBeNull());
    await form.user.keyboard('{Escape}');
    await form.user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(trigger).toHaveTextContent('/orders'));
    expect(linked).toHaveBeenCalledTimes(2);
  },
);

const getFailures = [
  [{ kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ kind: 'access-denied', message: 'Refused here.' }, 'Access denied'],
  [{ kind: 'other', code: 'BadRequest', message: 'Entire message.' }, 'BadRequest: Entire message.'],
  [{ kind: 'emulator-did-not-answer', message: 'Timed out' }, 'Not answering at'],
  [{ kind: 'engine-did-not-answer' }, 'The EmuForge engine at'],
] as const;

it.each(getFailures)('uses the GetRestApi read state for $0.kind', async (failure, text) => {
  api.mockRejectedValueOnce(new RequestError({ ...failure, operation: 'GetRestApi' }));
  open();
  expect(
    await screen.findByText(text, { exact: failure.kind === 'not-implemented' || failure.kind === 'access-denied' }),
  ).toBeVisible();
  expect(screen.getByText(/GetRestApi(?:\b|:)/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Create method' })).not.toBeInTheDocument();
});

it.each(['GetResources', 'ListFunctions'])('names a %s read failure at its own choice', async (operation) => {
  const error = new RequestError({ kind: 'other', operation, code: 'BadRequest', message: 'Choice refused.' });
  if (operation === 'GetResources') resources.mockRejectedValueOnce(error);
  else functions.mockRejectedValueOnce(error);
  const form = open();
  await form.shown();
  await form.openSelect(operation === 'GetResources' ? 'Resource' : 'Lambda function');
  expect(await screen.findByText(`${operation}: BadRequest: Choice refused.`)).toBeVisible();
});

it.each([false, true])('hands off the success and the optional permission warning (warning = %s)', async (warn) => {
  if (warn)
    create.mockResolvedValueOnce({
      kind: 'created',
      permissionWarning: { functionName: 'orders', reason: 'No permission' },
    });
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  await form.choose('Lambda function', fn.arn);
  await form.submit();
  await waitFor(() => expect(form.handOver).toHaveBeenCalledOnce());
  const [to, items] = form.handOver.mock.calls[0] ?? [];
  expect(to).toBe(restApiPath(apiId, 'resources'));
  const result = items as { type: string; content: React.ReactNode }[];
  const { container } = render(
    <>
      {result.map(({ type, content }) => (
        <p key={type}>{content}</p>
      ))}
    </>,
  );
  expect(container).toHaveTextContent('Method GET /orders created.');
  expect(result.map(({ type }) => type)).toEqual(warn ? ['success', 'warning'] : ['success']);
  if (warn)
    expect(container).toHaveTextContent(
      'Method GET /orders created, but the permission was not added to orders: No permission',
    );
});

it('keeps the form after PutMethod is refused and sends it again on the next submit', async () => {
  create.mockResolvedValueOnce({
    kind: 'unchanged',
    failure: {
      kind: 'other',
      operation: 'PutMethod',
      code: 'ConflictException',
      message: 'Method already exists for this resource',
    },
  });
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  await form.chooseKind('mock');
  await form.submit();
  expect(
    await screen.findByText('PutMethod: ConflictException: Method already exists for this resource'),
  ).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Response body' })).toHaveValue('{"message": "ok"}');
  await form.submit();
  await waitFor(() => expect(form.handOver).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[1]?.[2]).toEqual(create.mock.calls[0]?.[2]);
});

const integrationFailure = {
  kind: 'other',
  operation: 'PutIntegration',
  code: 'BadRequest',
  message: 'Integration refused',
} as const;
it.each([false, true])('explains failed integration and the take-back outcome (left = %s)', async (left) => {
  create.mockResolvedValueOnce(
    left
      ? {
          kind: 'left',
          failure: integrationFailure,
          removalFailure: { kind: 'other', operation: 'DeleteMethod', code: 'Denied', message: 'Delete refused' },
        }
      : { kind: 'removed', failure: integrationFailure },
  );
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  await form.chooseKind('mock');
  await form.submit();
  expect(await screen.findByText('PutIntegration: BadRequest: Integration refused')).toBeVisible();
  if (left) {
    const link = screen.getByRole('link', { name: 'View API resources' });
    expect(link).toHaveAttribute('href', restApiPath(apiId, 'resources'));
    expect(
      link.closest('[role="alert"]') ?? screen.getByText('DeleteMethod: Denied: Delete refused').parentElement,
    ).toHaveTextContent(
      'Method GET /orders was created without a working integration and could not be removed: DeleteMethod: Denied: Delete refused',
    );
  } else expect(screen.getByText('No method was created.')).toBeVisible();
  expect(form.handOver).not.toHaveBeenCalled();
});

it('shows a write 501 with its operation and keeps Create method visible and unavailable', async () => {
  create.mockResolvedValueOnce({ kind: 'unchanged', failure: { kind: 'not-implemented', operation: 'PutMethod' } });
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  await form.chooseKind('mock');
  await form.submit();
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText('PutMethod: 501 Not Implemented')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create method' })).toBeDisabled();
});

it('shows API not found with a link to APIs when the API does not exist', async () => {
  api.mockResolvedValueOnce(null);
  open();
  expect(await screen.findByRole('heading', { name: 'API not found' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'APIs' })).toHaveAttribute('href', '/aws/apigateway/apis');
});

it.each([false, true])('leaves on Cancel and only asks after an edit (changed = %s)', async (changed) => {
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  if (changed) await form.chooseKind('mock');
  await form.cancel();
  if (changed) {
    const dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    await form.user.click(within(dialog).getByRole('button', { name: 'Discard' }));
  } else expect(screen.queryByRole('dialog', { name: 'Discard what you entered?' })).not.toBeInTheDocument();
  expect(await screen.findByText(`Destination ${restApiPath(apiId)}`)).toBeVisible();
});
