import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import { registryFaults } from '../../../screens';
import { createRoutePath, v2ApiPath } from '../format';
import { createRoute } from '../route-create-api';
import { SCREENS } from '../screens';
import { getV2Api, readV2Integrations } from '../v2-api';

vi.mock('../v2-api', { spy: true });
vi.mock('../route-create-api', { spy: true });

const apiId = 'a1b2c3d4e5';
const routePath = createRoutePath(apiId);
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const arn = 'arn:aws:lambda:us-west-2:123456789012:function:orders';
const existing = { IntegrationId: 'int-existing', IntegrationType: 'AWS_PROXY', IntegrationUri: arn } as const;
const api = vi.mocked(getV2Api);
const integrations = vi.mocked(readV2Integrations);
const create = vi.mocked(createRoute);

beforeEach(() => {
  vi.resetAllMocks();
  api.mockResolvedValue({ found: true, api: { ProtocolType: 'HTTP', ApiId: apiId } });
  integrations.mockResolvedValue({ items: [existing] });
  create.mockResolvedValue({ kind: 'created' });
});

function RegisteredPage() {
  const { pathname, search } = useLocation();
  if (pathname === v2ApiPath(apiId)) return <p>Destination {pathname + search}</p>;
  const match = areaPage(pathname);
  if (match.kind !== 'screen') throw new Error(`No matching screen for ${pathname}`);
  return <match.screen.Page connection={connection} params={match.params} />;
}

function open() {
  const handOver = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  const { container } = render(
    <MemoryRouter initialEntries={[routePath]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageFlashContext.Provider value={{ handOver, show: vi.fn() }}>
          <AreaRootContext.Provider value={root}>
            <div ref={root}>
              <RegisteredPage />
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
  const openSelect = async (label: string) => {
    const control = createWrapper(field(label).getElement()).findSelect();
    if (!control) throw new Error(`Missing select ${label}`);
    await user.click(control.findTrigger().getElement());
    return control;
  };
  const choose = async (label: string, value: string) => {
    const choice = await openSelect(label);
    await waitFor(() => expect(choice.findDropdown().findOptionByValue(value)).not.toBeNull());
    choice.selectOptionByValue(value);
  };
  const chooseKind = async (value: string) => {
    const tile = createWrapper(field('Integration kind').getElement()).findTiles()?.findInputByValue(value);
    if (!tile) throw new Error(`Missing integration option ${value}`);
    await user.click(tile.getElement());
  };
  const shown = () => screen.findByRole('heading', { name: 'Route settings' });
  const submit = () => user.click(screen.getByRole('button', { name: 'Create route' }));
  const cancel = () => user.click(screen.getByRole('button', { name: 'Cancel' }));
  const findAlert = () =>
    waitFor(() => {
      const alert = wrapper.findAlert()?.getElement();
      if (!alert) throw new Error('Missing form alert');
      return alert;
    });
  return { handOver, user, field, openSelect, choose, chooseKind, shown, submit, cancel, findAlert };
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

it('shows the API name directly below the Create route heading', async () => {
  const apiName = 'orders-public-http-api';
  api.mockResolvedValue({ found: true, api: { ProtocolType: 'HTTP', ApiId: apiId, Name: apiName } });
  const form = open();
  await form.shown();

  const heading = screen.getByRole('heading', { level: 1, name: 'Create route' });
  const header = createWrapper()
    .findAllHeaders()
    .find((entry) => entry.getElement().contains(heading));
  const description = header?.findDescription()?.getElement();
  expect(description).toBeVisible();
  expect(description).toHaveTextContent(`Target API ${apiName}`);
});

it('describes every route and integration choice and reads existing integrations only when opened', async () => {
  const form = open();
  await form.shown();
  expect(integrations).not.toHaveBeenCalled();
  const described = [
    ['Route', { default: 'Catches every request no other route matches.', method: 'One HTTP method and one path.' }],
    ['HTTP method', methods],
    [
      'Authorization',
      { NONE: 'Open. No authorization is checked.', AWS_IAM: 'The caller signs the request with AWS credentials.' },
    ],
    [
      'Integration',
      { existing: 'One this API has already.', new: 'A new Lambda function or HTTP endpoint integration.' },
    ],
  ] as const;
  for (const [label, options] of described) {
    const choice = await form.openSelect(label);
    for (const [value, description] of Object.entries(options)) {
      expect(choice.findDropdown().findOptionByValue(value)?.getElement()).toHaveTextContent(description);
    }
    await form.user.keyboard('{Escape}');
  }
  expect(
    screen.getByText("Creating a route with an existing integration does not change the Lambda function's permission."),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Lambda function/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Allow API Gateway to invoke this function' })).not.toBeInTheDocument();

  const choice = await form.openSelect('Existing integration');
  await waitFor(() =>
    expect(choice.findDropdown().findOptionByValue('int-existing')?.getElement()).toHaveTextContent(
      `int-existingAWS_PROXY · ${arn}`,
    ),
  );
  expect(integrations).toHaveBeenCalledExactlyOnceWith(engineOrigin, apiId, undefined, expect.any(AbortSignal));
});

it('shows the Lambda controls and payload options and sends the independent HTTP integration method', async () => {
  const form = open();
  await form.shown();
  await form.choose('HTTP method', 'PATCH');
  await form.user.type(screen.getByRole('textbox', { name: 'Path' }), '/orders');
  expect(screen.getByText('PATCH /orders')).toBeVisible();
  await form.choose('Integration', 'new');
  expect(form.field('Integration kind').getElement()).toHaveTextContent(
    'A Lambda function the emulator holds is invoked.',
  );
  expect(form.field('Integration kind').getElement()).toHaveTextContent(
    'The emulator returns a redirect to an HTTP address.',
  );
  expect(screen.getByRole('button', { name: /^Lambda function/ })).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Allow API Gateway to invoke this function' })).toBeChecked();

  const formats = await form.openSelect('Payload format');
  expect(formats.findDropdown().findOptionByValue('2.0')?.getElement()).toHaveTextContent(
    'rawPath, routeKey, requestContext.',
  );
  expect(formats.findDropdown().findOptionByValue('1.0')?.getElement()).toHaveTextContent(
    'httpMethod, path, multi-value headers.',
  );
  await form.user.keyboard('{Escape}');

  await form.chooseKind('http');
  expect(
    screen.getByText(
      'The emulator calls no backend for an HTTP API. It answers this route with 307 and this address as Location.',
    ),
  ).toBeVisible();
  const method = await form.openSelect('Integration HTTP method');
  for (const [value, description] of Object.entries(methods)) {
    expect(method.findDropdown().findOptionByValue(value)?.getElement()).toHaveTextContent(description);
  }
  method.selectOptionByValue('POST');
  const address = `${endpoint}/orders`;
  await form.user.type(screen.getByRole('textbox', { name: 'HTTP address' }), address);
  await form.submit();
  await waitFor(() =>
    expect(create).toHaveBeenCalledExactlyOnceWith(
      engineOrigin,
      apiId,
      { key: 'PATCH /orders', authorization: 'NONE', integration: { kind: 'http', method: 'POST', address } },
      expect.any(AbortSignal),
    ),
  );
});

const routeRefusal = {
  kind: 'other',
  operation: 'CreateRoute',
  code: 'ConflictException',
  message: 'Route already exists.',
} as const;
const removalFailure = {
  kind: 'other',
  operation: 'DeleteIntegration',
  code: 'BadRequestException',
  message: 'Removal refused.',
} as const;

async function fillNewHttp(form: ReturnType<typeof open>) {
  await form.shown();
  await form.choose('Route', 'default');
  await form.choose('Integration', 'new');
  await form.chooseKind('http');
  await form.user.type(screen.getByRole('textbox', { name: 'HTTP address' }), `${endpoint}/orders`);
}

it('displays the integration left behind and reads it again as a selectable existing integration', async () => {
  create.mockResolvedValueOnce({ kind: 'left', failure: routeRefusal, integrationId: 'int-new', removalFailure });
  const form = open();
  await form.shown();
  await form.choose('Existing integration', 'int-existing');
  await fillNewHttp(form);
  await form.submit();
  const error = await form.findAlert();
  expect(error).toHaveTextContent('CreateRoute: ConflictException: Route already exists.');
  expect(error).toHaveTextContent(
    'Integration int-new was created without a route and could not be removed: DeleteIntegration: BadRequestException: Removal refused.',
  );
  expect(form.handOver).not.toHaveBeenCalled();
  integrations.mockResolvedValue({
    items: [
      existing,
      { IntegrationId: 'int-new', IntegrationType: 'HTTP_PROXY', IntegrationUri: `${endpoint}/orders` },
    ],
  });
  await form.choose('Integration', 'existing');
  expect(integrations).toHaveBeenCalledTimes(1);
  await form.choose('Existing integration', 'int-new');
  expect(integrations).toHaveBeenCalledTimes(2);
  await form.submit();
  await waitFor(() =>
    expect(create).toHaveBeenNthCalledWith(
      2,
      engineOrigin,
      apiId,
      { key: '$default', authorization: 'NONE', integration: { kind: 'existing', id: 'int-new' } },
      expect.any(AbortSignal),
    ),
  );
});

it('states that no route was created when taking back the integration succeeds', async () => {
  create.mockResolvedValueOnce({ kind: 'removed', failure: routeRefusal });
  const form = open();
  await fillNewHttp(form);
  await form.submit();
  const error = await form.findAlert();
  expect(error).toHaveTextContent('CreateRoute: ConflictException: Route already exists. No route was created.');
  expect(screen.getByRole('textbox', { name: 'HTTP address' })).toHaveValue(`${endpoint}/orders`);
  expect(form.handOver).not.toHaveBeenCalled();
});

const refusals = [
  [{ kind: 'not-implemented' }, 'Not implemented by the emulator'],
  [{ kind: 'access-denied', message: 'Refused here.' }, 'Access denied'],
  [{ kind: 'other', code: 'BadRequest', message: 'Entire message.' }, 'BadRequest: Entire message.'],
  [{ kind: 'emulator-did-not-answer', message: 'Timed out' }, 'Not answering at'],
  [{ kind: 'engine-did-not-answer' }, 'The EmuForge engine at'],
] as const;

describeReads('GetApi', api);
describeReads('GetIntegrations', integrations);

function describeReads(operation: 'GetApi' | 'GetIntegrations', read: typeof api | typeof integrations) {
  it.each(refusals)(`shows the ${operation} read failure (%j) at the right place with Retry`, async (failure, text) => {
    read.mockRejectedValueOnce(new RequestError({ ...failure, operation }));
    const form = open();
    if (operation === 'GetIntegrations') {
      await form.shown();
      await form.openSelect('Existing integration');
    }
    const thing = operation === 'GetApi' ? 'API' : 'integrations';
    const status = failure.kind === 'other' ? `The ${thing} could not be read` : text;
    expect(await screen.findByText((content) => content.startsWith(status))).toBeVisible();
    const detail = screen.getByText(
      (content) =>
        content.startsWith(operation) ||
        content.startsWith(`The emulator answered 501 Not Implemented for ${operation}`),
    );
    expect(detail).toBeVisible();
    if (failure.kind === 'other' || failure.kind === 'access-denied' || failure.kind === 'emulator-did-not-answer') {
      expect(detail).toHaveTextContent(failure.message);
    }
    if (failure.kind === 'emulator-did-not-answer' || failure.kind === 'engine-did-not-answer') {
      expect(screen.getByRole('link', { name: 'Connection status' })).toBeVisible();
    }
    const retry = screen.getAllByRole('button', { name: 'Retry' }).find((element) => element.tagName === 'BUTTON');
    if (!retry) throw new Error('Missing Retry below the read failure');
    await form.user.click(retry);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await form.shown();
    expect(create).not.toHaveBeenCalled();
  });
}

it('links a WebSocket address to the API and offers no create form', async () => {
  api.mockResolvedValueOnce({ found: true, api: { ProtocolType: 'WEBSOCKET' } });
  open();
  expect(await screen.findByRole('heading', { name: 'Routes are created here for HTTP APIs only' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'View API' })).toHaveAttribute('href', v2ApiPath(apiId));
  expect(screen.getByText(/is a WebSocket API/).parentElement).toHaveTextContent(`${apiId} is a WebSocket API.`);
  expect(screen.queryByRole('button', { name: 'Create route' })).not.toBeInTheDocument();
});

it('shows API not found for a missing API', async () => {
  api.mockResolvedValueOnce({ found: false });
  open();
  expect(await screen.findByRole('heading', { name: 'API not found' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'View APIs' })).toHaveAttribute('href', '/aws/apigateway/apis');
});

it.each([false, true])(
  'returns to the API with the creation result and optional permission warning (%s)',
  async (warn) => {
    if (warn)
      create.mockResolvedValueOnce({
        kind: 'created',
        permissionWarning: { functionName: 'orders', reason: 'AddPermission: Refused' },
      });
    const form = open();
    await form.shown();
    await form.choose('Route', 'default');
    await form.choose('Existing integration', 'int-existing');
    await form.submit();
    await waitFor(() => expect(form.handOver).toHaveBeenCalledOnce());
    const [target, result] = form.handOver.mock.calls[0] as [string, { type: string; content: ReactNode }[]];
    expect(target).toBe(v2ApiPath(apiId, 'routes'));
    const { container } = render(
      <>
        {result.map(({ type, content }) => (
          <p key={type}>{content}</p>
        ))}
      </>,
    );
    expect(result.map(({ type }) => type)).toEqual(warn ? ['success', 'warning'] : ['success']);
    expect(container).toHaveTextContent('Route $default created.');
    if (warn)
      expect(container).toHaveTextContent(
        'Route $default created, but the permission was not added to orders: AddPermission: Refused',
      );
  },
);

for (const operation of ['CreateIntegration', 'CreateRoute']) {
  it.each(refusals)(`shows the ${operation} change failure (%j) while retaining the form`, async (failure) => {
    create.mockResolvedValueOnce({ kind: 'unchanged', failure: { ...failure, operation } });
    const form = open();
    await fillNewHttp(form);
    await form.submit();
    const alert = await form.findAlert();
    expect(alert).toHaveTextContent(operation);
    expect(screen.getByRole('textbox', { name: 'HTTP address' })).toHaveValue(`${endpoint}/orders`);
    expect(form.handOver).not.toHaveBeenCalled();
    const submit = screen.getByRole('button', { name: 'Create route' });
    if (failure.kind === 'not-implemented') {
      expect(submit).toBeDisabled();
      expect(alert).toHaveTextContent('Not implemented by the emulator');
    } else expect(submit).toBeEnabled();
  });
}

it('leaves for the API on unchanged Cancel', async () => {
  const form = open();
  await form.shown();
  await form.cancel();
  expect(await screen.findByText(`Destination ${v2ApiPath(apiId)}`)).toBeVisible();
});

it('asks before discarding and keeps the values if the developer stays', async () => {
  const form = open();
  await form.shown();
  await form.user.type(screen.getByRole('textbox', { name: 'Path' }), '/orders');
  await form.cancel();
  expect(screen.getByRole('dialog')).toBeVisible();
  await form.user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('textbox', { name: 'Path' })).toHaveValue('/orders');
  await form.cancel();
  await form.user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(await screen.findByText(`Destination ${v2ApiPath(apiId)}`)).toBeVisible();
});

it('registers the create screen without faults and sends the API ID from its address', async () => {
  expect(routePath).toBe('/aws/apigateway/apis/v2/a1b2c3d4e5/routes/create');
  expect(registryFaults([{ folder: 'apigateway', screens: SCREENS }], (folder) => folder === 'apigateway')).toEqual([]);
  const form = open();
  await form.shown();
  expect(api).toHaveBeenCalledExactlyOnceWith(engineOrigin, apiId, expect.any(AbortSignal));
  await form.choose('Route', 'default');
  await form.choose('Authorization', 'AWS_IAM');
  await form.choose('Existing integration', 'int-existing');
  await form.submit();
  await waitFor(() =>
    expect(create).toHaveBeenCalledExactlyOnceWith(
      engineOrigin,
      apiId,
      { key: '$default', authorization: 'AWS_IAM', integration: { kind: 'existing', id: 'int-existing' } },
      expect.any(AbortSignal),
    ),
  );
});
