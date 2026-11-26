import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { registryFaults } from '../../../screens';
import { createRoutePath, v2ApiPath } from '../format';
import { readFunctions } from '../lambda-api';
import { createRoute, type RouteOutcome } from '../route-create-api';
import { SCREENS } from '../screens';
import { getV2Api, readV2Integrations } from '../v2-api';

vi.mock('../v2-api', { spy: true });
vi.mock('../lambda-api', { spy: true });
vi.mock('../route-create-api', { spy: true });

const apiId = 'a1b2c3d4e5';
const routePath = createRoutePath(apiId);
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const stoppedConnection: AreaConnection = {
  engineOrigin,
  result: {
    kind: 'emulator-unreachable',
    checkedAt: 1,
    emulator: { port: 9682, endpoint },
    reason: 'not_started',
    message: 'The emulator is stopped.',
  },
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
  vi.mocked(readFunctions).mockResolvedValue({ items: [{ name: 'orders', arn }] });
  create.mockResolvedValue({ kind: 'created' });
});

function RegisteredPage({ connection }: { connection: AreaConnection }) {
  const { pathname, search } = useLocation();
  if (pathname === v2ApiPath(apiId)) return <p>Destination {pathname + search}</p>;
  const match = areaPage(pathname);
  if (match.kind !== 'screen') throw new Error(`No matching screen for ${pathname}`);
  return <match.screen.Page connection={connection} params={match.params} />;
}

function open(currentConnection = connection) {
  const handOver = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  const { container } = render(
    <MemoryRouter initialEntries={[routePath]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageFlashContext.Provider value={{ handOver, show: vi.fn() }}>
          <AreaRootContext.Provider value={root}>
            <div ref={root}>
              <RegisteredPage connection={currentConnection} />
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
  const input = (label: string) => {
    const control = createWrapper(field(label).getElement()).findInput();
    if (!control) throw new Error(`Missing input ${label}`);
    return control.findNativeInput().getElement();
  };
  const select = (label: string) => {
    const control = createWrapper(field(label).getElement()).findSelect();
    if (!control) throw new Error(`Missing select ${label}`);
    return control;
  };
  const openSelect = async (label: string) => {
    const control = select(label);
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
  const shown = () =>
    waitFor(() => {
      const heading = wrapper.findContainer()?.findHeader()?.findHeader()?.findHeadingText().getElement();
      expect(heading).toHaveTextContent('Route settings');
      return heading;
    });
  const formAction = (index: number, label: string) => {
    const button = wrapper.findForm()?.findActions()?.findAllButtons()[index]?.getElement();
    if (!button) throw new Error(`Missing route form action ${label}`);
    expect(button).toHaveTextContent(label);
    return button;
  };
  const submitButton = () => formAction(1, 'Create route');
  const submit = () => user.click(submitButton());
  const cancel = () => user.click(formAction(0, 'Cancel'));
  const findAlert = () =>
    waitFor(() => {
      const alert = wrapper.findAlert()?.getElement();
      if (!alert) throw new Error('Missing form alert');
      return alert;
    });
  return {
    handOver,
    user,
    wrapper,
    field,
    input,
    select,
    openSelect,
    choose,
    chooseKind,
    shown,
    submitButton,
    submit,
    cancel,
    findAlert,
  };
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

  const header = form.wrapper.findHeader();
  expect(header?.findHeadingText().getElement()).toHaveTextContent('Create route');
  const description = header?.findDescription()?.getElement();
  expect(description).toBeVisible();
  expect(description).toHaveTextContent(`API: ${apiName}`);
});

it('names each route select with its field label and current choice', async () => {
  const form = open();
  await form.shown();

  const trigger = (label: string) => form.select(label).findTrigger().getElement();
  expect(trigger('Route')).toHaveAccessibleName('Route Method and path');
  expect(trigger('HTTP method')).toHaveAccessibleName('HTTP method GET');
  expect(trigger('Authorization')).toHaveAccessibleName('Authorization NONE');
  expect(trigger('Integration')).toHaveAccessibleName('Integration Use an existing integration');
  expect(trigger('Existing integration')).toHaveAccessibleName('Existing integration Choose an integration');
  await form.choose('Existing integration', 'int-existing');
  expect(trigger('Existing integration')).toHaveAccessibleName('Existing integration int-existing');

  await form.choose('Integration', 'new');
  expect(trigger('Integration')).toHaveAccessibleName('Integration Create an integration');
  expect(trigger('Payload format')).toHaveAccessibleName('Payload format 2.0');

  await form.chooseKind('http');
  expect(trigger('Integration HTTP method')).toHaveAccessibleName('Integration HTTP method GET');
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
  expect(form.field('Existing integration').findConstraint()?.getElement()).toHaveTextContent(
    "Creating a route with an existing integration does not change the Lambda function's permission.",
  );
  expect(form.wrapper.findAllFormFields().map((field) => field.findLabel()?.getElement().textContent)).not.toContain(
    'Lambda function',
  );
  expect(form.wrapper.findCheckbox()).toBeNull();

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
  await form.user.type(form.input('Path'), '/orders');
  const preview = form.wrapper.findContainer()?.findContent().findBox(':has(> .aws-area-value)')?.getElement();
  expect(preview).toBeVisible();
  expect(preview).toHaveTextContent('Route key PATCH /orders');
  await form.choose('Integration', 'new');
  expect(form.field('Integration kind').getElement()).toHaveTextContent(
    'A Lambda function the emulator holds is invoked.',
  );
  expect(form.field('Integration kind').getElement()).toHaveTextContent(
    'The emulator returns a redirect to an HTTP address.',
  );
  expect(createWrapper(form.field('Lambda function').getElement()).findSelect()?.getElement()).toBeVisible();
  const allow = form.wrapper.findCheckbox();
  expect(allow?.findLabel().getElement()).toHaveTextContent('Allow API Gateway to invoke this function');
  expect(allow?.findNativeInput().getElement()).toBeChecked();

  const formats = await form.openSelect('Payload format');
  expect(formats.findDropdown().findOptionByValue('2.0')?.getElement()).toHaveTextContent(
    'rawPath, routeKey, requestContext.',
  );
  expect(formats.findDropdown().findOptionByValue('1.0')?.getElement()).toHaveTextContent(
    'httpMethod, path, multi-value headers.',
  );
  await form.user.keyboard('{Escape}');

  await form.chooseKind('http');
  expect(form.field('HTTP address').findDescription()?.getElement()).toHaveTextContent(
    'The emulator calls no backend for an HTTP API. It answers this route with 307 and this address as Location.',
  );
  const method = await form.openSelect('Integration HTTP method');
  for (const [value, description] of Object.entries(methods)) {
    expect(method.findDropdown().findOptionByValue(value)?.getElement()).toHaveTextContent(description);
  }
  method.selectOptionByValue('POST');
  const address = `${endpoint}/orders`;
  await form.user.type(form.input('HTTP address'), address);
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
const cleanupUnavailable = { kind: 'not-implemented', operation: 'DeleteIntegration' } as const;

async function fillNewHttp(form: ReturnType<typeof open>) {
  await form.shown();
  await form.choose('Route', 'default');
  await form.choose('Integration', 'new');
  await form.chooseKind('http');
  await form.user.type(form.input('HTTP address'), `${endpoint}/orders`);
}

it.each([removalFailure, cleanupUnavailable])(
  'keeps the integration left by a $kind cleanup available as an existing integration',
  async (cleanup) => {
    create
      .mockResolvedValueOnce({ kind: 'left', failure: routeRefusal, integrationId: 'int-new', removalFailure: cleanup })
      .mockResolvedValueOnce({ kind: 'unchanged', failure: routeRefusal });
    const form = open();
    await form.shown();
    await form.choose('Existing integration', 'int-existing');
    expect(integrations).toHaveBeenCalledOnce();
    await fillNewHttp(form);
    await form.submit();
    const error = await form.findAlert();
    expect(error).toHaveTextContent('CreateRoute: ConflictException: Route already exists.');
    expect(error).toHaveTextContent('Integration int-new was created without a route and could not be removed:');
    const submit = form.submitButton();
    if (cleanup.kind === 'not-implemented') {
      expect(error).toHaveTextContent('Not implemented by the emulator');
      expect(error).toHaveTextContent('The emulator answered 501 Not Implemented for DeleteIntegration.');
      expect(error).toHaveTextContent(
        'Switch to “Use an existing integration” and choose the integration that was kept, or another one.',
      );
      expect(submit).toBeDisabled();
    } else {
      expect(error).toHaveTextContent('DeleteIntegration: BadRequestException: Removal refused.');
      expect(submit).toBeEnabled();
    }
    expect(form.handOver).not.toHaveBeenCalled();
    integrations.mockResolvedValue({
      items: [
        existing,
        { IntegrationId: 'int-new', IntegrationType: 'HTTP_PROXY', IntegrationUri: `${endpoint}/orders` },
      ],
    });
    await form.choose('Integration', 'existing');
    await form.choose('Existing integration', 'int-new');
    expect(error).toBeVisible();
    expect(submit).toBeEnabled();
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
    expect(await form.findAlert()).toHaveTextContent('CreateRoute: ConflictException: Route already exists.');
    expect(form.handOver).not.toHaveBeenCalled();
  },
);

it('shows that neither integration mode can create a route when route creation and cleanup return 501', async () => {
  create.mockResolvedValueOnce({
    kind: 'left',
    failure: { kind: 'not-implemented', operation: 'CreateRoute' },
    integrationId: 'int-new',
    removalFailure: cleanupUnavailable,
  });
  const form = open();
  await fillNewHttp(form);
  await form.submit();

  const error = await form.findAlert();
  expect(error).toHaveTextContent('CreateRoute');
  expect(error).toHaveTextContent('Integration int-new was created without a route and could not be removed:');
  expect(error).toHaveTextContent('The emulator answered 501 Not Implemented for DeleteIntegration.');
  expect(error).toHaveTextContent('Route creation is unavailable for both new and existing integrations.');
  expect(error).not.toHaveTextContent('Switch to “Use an existing integration”');
  const submit = form.submitButton();
  expect(submit).toBeDisabled();

  await form.choose('Integration', 'existing');
  await form.choose('Existing integration', 'int-existing');
  expect(error).toBeVisible();
  expect(submit).toBeDisabled();
  expect(create).toHaveBeenCalledOnce();
});

it('states that no route was created when taking back the integration succeeds', async () => {
  create.mockResolvedValueOnce({ kind: 'removed', failure: routeRefusal });
  const form = open();
  await fillNewHttp(form);
  await form.submit();
  const error = await form.findAlert();
  expect(error).toHaveTextContent('CreateRoute: ConflictException: Route already exists. No route was created.');
  expect(form.input('HTTP address')).toHaveValue(`${endpoint}/orders`);
  expect(form.handOver).not.toHaveBeenCalled();
});

type ReadCase = {
  state: string;
  failure: RequestFailure;
  status: string;
  detail: string;
  health?: AreaConnection;
  recovery?: boolean;
};

const denied = { kind: 'access-denied', message: 'Refused here.' } as const;
const emulatorTimeout = { kind: 'emulator-did-not-answer', message: 'Timed out' } as const;
const ordinaryRefusal = { kind: 'other', code: 'BadRequest', message: 'Entire message.' } as const;

function readCases(operation: 'GetApi' | 'GetIntegrations', thing: string) {
  return {
    unimplemented: {
      state: 'not implemented',
      failure: { kind: 'not-implemented', operation },
      status: 'Not implemented by the emulator',
      detail: `The emulator answered 501 Not Implemented for ${operation}, so Studio cannot show the ${thing}.`,
    },
    refused: {
      state: 'refused',
      failure: { ...ordinaryRefusal, operation },
      status: `The ${thing} could not be read`,
      detail: `${operation}: BadRequest: Entire message.`,
    },
    denied: {
      state: 'access denied',
      failure: { ...denied, operation },
      status: 'Access denied',
      detail: `${operation} was refused: Refused here.`,
    },
    emulatorDown: {
      state: 'emulator not answering',
      failure: { ...emulatorTimeout, operation },
      status: `Not answering at ${endpoint}`,
      detail: `${operation} got no answer from the emulator. Timed out`,
      recovery: true,
    },
    engineDown: {
      state: 'engine not answering',
      failure: { kind: 'engine-did-not-answer', operation },
      status: `The EmuForge engine at ${engineOrigin} is not answering`,
      detail: `${operation} got no answer.`,
      recovery: true,
    },
  } satisfies Record<string, ReadCase>;
}

const apiCases = readCases('GetApi', 'API');
it.each<ReadCase>([
  ...Object.values(apiCases),
  {
    ...apiCases.emulatorDown,
    state: 'emulator stopped',
    status: 'Not started on port 9682',
    health: stoppedConnection,
  },
])('recovers the GetApi form after $state', async ({ failure, status, detail, health, recovery }) => {
  api.mockRejectedValueOnce(new RequestError(failure));
  const form = open(health);
  await waitFor(() => expect(form.wrapper.findStatusIndicator()?.getElement()).toHaveTextContent(status));
  expect(form.wrapper.findBox('p')?.getElement()).toHaveTextContent(detail);
  if (recovery) expect(form.wrapper.findLink('[href="/"]')?.getElement()).toHaveTextContent('Connection status');
  const retry = form.wrapper.findButton()?.getElement();
  if (!retry) throw new Error('Missing GetApi Retry button');
  expect(retry).toHaveTextContent('Retry');
  await form.user.click(retry);
  expect(await form.shown()).toBeVisible();
  expect(form.field('Route').getElement()).toBeVisible();
  expect(create).not.toHaveBeenCalled();
});

const choiceCases = readCases('GetIntegrations', 'integrations');
it.each([
  { ...choiceCases.unimplemented, dropdownStatus: choiceCases.unimplemented.status },
  { ...choiceCases.refused, health: stoppedConnection, dropdownStatus: 'BadRequest: Entire message.' },
  { ...choiceCases.denied, dropdownStatus: 'Access denied. GetIntegrations was refused: Refused here.' },
  { ...choiceCases.emulatorDown, dropdownStatus: 'The emulator did not answer' },
  { ...choiceCases.engineDown, dropdownStatus: `The EmuForge engine at ${engineOrigin} did not answer` },
])('recovers the existing integration options after $state', async (test: ReadCase & { dropdownStatus: string }) => {
  const { failure, status, detail, health, recovery, dropdownStatus } = test;
  integrations.mockRejectedValueOnce(new RequestError(failure));
  const form = open(health);
  await form.shown();
  const choice = await form.openSelect('Existing integration');
  const field = createWrapper(form.field('Existing integration').getElement());
  await waitFor(() => expect(choice.findStatusIndicator()?.getElement()).toHaveTextContent(dropdownStatus));
  const retry = choice.findErrorRecoveryButton()?.getElement();
  expect(retry).toHaveTextContent('Retry');
  const dropdown = choice.findDropdown().getElement();
  const readStatus = field.findAllStatusIndicators().find((indicator) => !dropdown.contains(indicator.getElement()));
  expect(readStatus?.getElement()).toHaveTextContent(status);
  expect(field.findBox('p')?.getElement()).toHaveTextContent(detail);
  const connectionStatus = field.findLink('[href="/"]')?.getElement();
  if (recovery) expect(connectionStatus).toHaveTextContent('Connection status');
  else expect(connectionStatus).toBeUndefined();
  const fieldRetry = field.findAllButtons().find((button) => !dropdown.contains(button.getElement()));
  expect(fieldRetry?.getElement()).toHaveTextContent('Retry');
  if (!retry) throw new Error('Missing Retry in existing integration choice');
  await form.user.click(retry);
  await waitFor(() =>
    expect(choice.findDropdown().findOptionByValue(existing.IntegrationId)?.getElement()).toHaveTextContent(arn),
  );
  expect(create).not.toHaveBeenCalled();
});

it('links a WebSocket address to the API and offers no create form', async () => {
  api.mockResolvedValueOnce({ found: true, api: { ProtocolType: 'WEBSOCKET' } });
  const { wrapper } = open();
  await waitFor(() =>
    expect(wrapper.findHeader()?.findHeadingText().getElement()).toHaveTextContent(
      'Routes are created here for HTTP APIs only',
    ),
  );
  expect(wrapper.findLink(`[href="${v2ApiPath(apiId)}"]`)?.getElement()).toHaveTextContent('View API');
  expect(wrapper.findBox()?.getElement()).toHaveTextContent(new RegExp(`${apiId}.*is a WebSocket API\\.`));
  expect(wrapper.findForm()).toBeNull();
});

it('shows API not found for a missing API', async () => {
  api.mockResolvedValueOnce({ found: false });
  const { wrapper } = open();
  await waitFor(() => expect(wrapper.findHeader()?.findHeadingText().getElement()).toHaveTextContent('API not found'));
  expect(wrapper.findLink('[href="/aws/apigateway/apis"]')?.getElement()).toHaveTextContent('View APIs');
});

type PermissionCase = {
  name: string;
  warning?: Extract<RouteOutcome, { kind: 'created' }>['permissionWarning'];
  header?: string;
  reason?: string;
};

it.each<PermissionCase>([
  { name: 'with permission' },
  {
    name: 'with a permission refusal',
    warning: { functionName: 'orders', reason: 'AddPermission: Refused' },
    reason: 'AddPermission: Refused',
  },
  ...['AddPermission', 'GetPolicy'].map((operation): PermissionCase => ({
    name: `when ${operation} returns 501`,
    warning: {
      functionName: 'orders',
      reason: `${operation}: 501 Not Implemented`,
      failure: { kind: 'not-implemented', operation },
    },
    header: 'Not implemented by the emulator',
    reason: `The emulator answered 501 Not Implemented for ${operation}.`,
  })),
])('returns to the API with the creation result $name', async ({ warning, header, reason }) => {
  if (warning) create.mockResolvedValueOnce({ kind: 'created', permissionWarning: warning });
  const form = open();
  await form.shown();
  await form.choose('Route', 'default');
  await form.choose('Integration', 'new');
  await form.choose('Lambda function', arn);
  await form.submit();
  await waitFor(() => expect(form.handOver).toHaveBeenCalledOnce());
  const [target, result] = form.handOver.mock.calls[0] as [string, FlashResult];
  expect(target).toBe(v2ApiPath(apiId, 'routes'));
  const { container } = render(
    <AreaFlash
      result={{ id: 1, visit: 1, path: v2ApiPath(apiId), items: result.map((item) => ({ key: item.type, item })) }}
      onDismiss={vi.fn()}
      onAnnounce={vi.fn()}
    />,
  );
  const flash = createWrapper(container).findFlashbar();
  expect(flash?.findItems()).toHaveLength(warning ? 2 : 1);
  expect(flash?.findItemsByType('success')[0]?.getElement()).toHaveTextContent('Route $default created.');
  if (warning) {
    const item = flash?.findItemsByType('warning')[0];
    if (header) expect(item?.findHeader()?.getElement()).toHaveTextContent(header);
    expect(item?.findContent()?.getElement()).toHaveTextContent(
      `Route $default created, but the permission was not added to orders: ${reason}`,
    );
  }
});

const refusals = [
  { kind: 'not-implemented' },
  denied,
  ordinaryRefusal,
  emulatorTimeout,
  { kind: 'engine-did-not-answer' },
] as const;

for (const operation of ['CreateIntegration', 'CreateRoute']) {
  it.each(refusals)(`shows the ${operation} change failure ($kind) while retaining the form`, async (failure) => {
    create.mockResolvedValueOnce({ kind: 'unchanged', failure: { ...failure, operation } });
    const form = open();
    await fillNewHttp(form);
    await form.submit();
    const alert = await form.findAlert();
    expect(alert).toHaveTextContent(operation);
    expect(form.input('HTTP address')).toHaveValue(`${endpoint}/orders`);
    expect(form.handOver).not.toHaveBeenCalled();
    const submit = form.submitButton();
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
  await form.user.type(form.input('Path'), '/orders');
  await form.cancel();
  const answerDiscardDialog = async (index: number, label: string) => {
    const modal = form.wrapper.findModal();
    expect(modal?.getElement()).toBeVisible();
    const footer = modal?.findFooter()?.getElement();
    if (!footer) throw new Error('Missing discard dialog footer');
    const button = createWrapper(footer).findAllButtons()[index]?.getElement();
    if (!button) throw new Error(`Missing discard dialog action ${index}`);
    expect(button).toHaveTextContent(label);
    await form.user.click(button);
  };
  await answerDiscardDialog(0, 'Keep editing');
  expect(form.input('Path')).toHaveValue('/orders');
  await form.cancel();
  await answerDiscardDialog(1, 'Discard');
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
