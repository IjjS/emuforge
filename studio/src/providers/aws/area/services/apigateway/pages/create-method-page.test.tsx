import type { Resource, RestApi } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import { registryFaults } from '../../../screens';
import { createMethodPath, restApiPath } from '../format';
import { readFunctions } from '../lambda-api';
import { createMethod } from '../method-create-api';
import { readRestApi, readRestResource, readRestResources, readRestStages } from '../rest-api';
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
  result: {
    kind: 'emulator-unreachable',
    reason: 'not_started',
    message: 'The emulator is stopped.',
    checkedAt: 1,
    emulator: { port: 9682, endpoint },
  },
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
  vi.mocked(readRestStages).mockResolvedValue([]);
  functions.mockResolvedValue({ items: [fn] });
  create.mockResolvedValue({ kind: 'created' });
});

function RegisteredPage({
  connection,
  stubDestination = false,
}: {
  connection: AreaConnection;
  stubDestination?: boolean;
}) {
  const { pathname, search } = useLocation();
  if (stubDestination && pathname === restApiPath(apiId)) return <p>Destination {pathname + search}</p>;
  const match = areaPage(pathname);
  if (match.kind !== 'screen') throw new Error(`No matching screen for ${pathname}`);
  return <match.screen.Page connection={connection} params={match.params} />;
}

function HandoverPage({ connection, onHandover }: { connection: AreaConnection; onHandover: PageFlash['handOver'] }) {
  const { pathname } = useLocation();
  const { shown, pageFlash, dismiss, announce } = useAreaFlash(pathname, pathname === address ? 0 : 1, true);
  return (
    <PageFlashContext.Provider
      value={{
        ...pageFlash,
        handOver: (to, result) => {
          onHandover(to, result);
          pageFlash.handOver(to, result);
        },
      }}
    >
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <RegisteredPage connection={connection} />
    </PageFlashContext.Provider>
  );
}

function open(path = address, connection = connected, followHandover = false) {
  const handOver = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageFlashContext.Provider value={{ handOver, show: vi.fn() }}>
          <AreaRootContext.Provider value={root}>
            <div ref={root}>
              {followHandover ? (
                <HandoverPage connection={connection} onHandover={handOver} />
              ) : (
                <RegisteredPage connection={connection} stubDestination />
              )}
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
    const match = createWrapper(field(label).getElement()).findSelect();
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
    const tile = createWrapper(field('Integration kind').getElement()).findTiles()?.findInputByValue(value);
    if (!tile) throw new Error(`Missing integration option ${value}`);
    await user.click(tile.getElement());
  };
  const shown = () =>
    waitFor(() => {
      const header = wrapper.findContainer()?.findHeader()?.getElement();
      const heading = header && createWrapper(header).findHeader()?.findHeadingText().getElement();
      expect(heading).toHaveTextContent('Method settings');
      expect(heading).toBeVisible();
    });
  const headingDescription = () => wrapper.findHeader()?.findDescription()?.getElement();
  const button = (label: string, scope = wrapper) =>
    scope
      .findAllButtons()
      .find((entry) => entry.getElement().textContent?.trim() === label)
      ?.getElement();
  const clickButton = (label: string, scope = wrapper) => {
    const element = button(label, scope);
    if (!element) throw new Error(`Missing button ${label}`);
    return user.click(element);
  };
  const actionScope = () => {
    const actions = wrapper.findForm()?.findActions();
    if (!actions) throw new Error('Missing form actions');
    return createWrapper(actions.getElement());
  };
  const submitButton = () => button('Create method', actionScope());
  const submit = () => clickButton('Create method', actionScope());
  const cancel = () => clickButton('Cancel', actionScope());
  const findAlert = () =>
    waitFor(() => {
      const alert = wrapper.findAlert()?.getElement();
      if (!alert) throw new Error('Missing failure alert');
      expect(alert).toBeVisible();
      return alert;
    });
  return {
    handOver,
    user,
    wrapper,
    field,
    select,
    openSelect,
    choose,
    chooseKind,
    shown,
    headingDescription,
    clickButton,
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

it('reads resources when opened and describes the resource and each known form option', async () => {
  const form = open();
  await form.shown();
  expect(form.headingDescription()).toHaveTextContent('API: Orders');
  expect(form.headingDescription()).toBeVisible();
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
  expect(integration).toHaveTextContent('Use an invoke URL served by this emulator.');
  expect(integration).toHaveTextContent('A fixed answer, without a backend.');
  await form.chooseKind('http');
  expect(form.field('HTTP address').findDescription()?.getElement()).toHaveTextContent(
    "The emulator sends no request to this address. It answers only for an address it serves itself, such as another API's invoke URL.",
  );
});

it('announces each select field label once with its current choice', async () => {
  const form = open();
  await form.shown();
  const trigger = (label: string) => form.select(label).findTrigger().getElement();

  expect(trigger('Resource')).toHaveAccessibleName('Resource Choose a resource');
  expect(trigger('HTTP method')).toHaveAccessibleName('HTTP method GET');
  expect(trigger('Authorization')).toHaveAccessibleName('Authorization NONE');
  expect(trigger('API key required')).toHaveAccessibleName('API key required No');
  expect(trigger('Lambda function')).toHaveAccessibleName('Lambda function Choose a Lambda function');

  await form.choose('Resource', 'root');
  expect(trigger('Resource')).toHaveAccessibleName('Resource /');
  await form.choose('Lambda function', fn.arn);
  expect(trigger('Lambda function')).toHaveAccessibleName(`Lambda function ${fn.name}`);

  await form.chooseKind('http');
  expect(trigger('Integration HTTP method')).toHaveAccessibleName('Integration HTTP method GET');
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
  const input = createWrapper(form.field('HTTP address').getElement()).findInput();
  if (!input) throw new Error('Missing HTTP address input');
  await form.user.type(input.findNativeInput().getElement(), url);
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
  expect(form.wrapper.findAlert()).toBeNull();
  expect(form.submitButton()).toBeEnabled();
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
    const headingElement = await waitFor(() => {
      const status = form.wrapper.findStatusIndicator()?.getElement();
      if (!status) throw new Error('Missing linked resource failure');
      expect(status).toHaveTextContent(heading);
      expect(status).toBeVisible();
      return status;
    });
    expect(form.wrapper.getElement()).toHaveTextContent(detail);
    const trigger = form.select('Resource').findTrigger().getElement();
    expect(headingElement.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger).toHaveTextContent('Choose a resource');
    if (recovery) expect(form.wrapper.findLink()?.getElement()).toHaveTextContent('Connection status');
    const choice = await form.openSelect('Resource');
    await waitFor(() => expect(choice.findDropdown().findOptionByValue('root')).not.toBeNull());
    await form.user.keyboard('{Escape}');
    await form.clickButton('Retry');
    await waitFor(() => expect(trigger).toHaveTextContent('/orders'));
    expect(linked).toHaveBeenCalledTimes(2);
  },
);

const emulatorFailure = { kind: 'emulator-did-not-answer', message: 'Request timed out.' } as const;
const engineFailure = { kind: 'engine-did-not-answer' } as const;

const getFailures = [
  {
    failure: { kind: 'not-implemented' },
    heading: 'Not implemented by the emulator',
    detail: '501 Not Implemented for GetRestApi',
  },
  {
    failure: { kind: 'access-denied', message: 'Refused here.' },
    heading: 'Access denied',
    detail: 'GetRestApi was refused: Refused here.',
  },
  {
    failure: { kind: 'other', code: 'BadRequest', message: 'Entire message.' },
    heading: 'The REST API could not be read',
    detail: 'GetRestApi: BadRequest: Entire message.',
  },
  {
    failure: emulatorFailure,
    connection: stopped,
    heading: 'Not started on port 9682',
    detail: 'GetRestApi got no answer from the emulator. Request timed out.',
    recovery: true,
  },
  {
    failure: emulatorFailure,
    heading: `Not answering at ${endpoint}`,
    detail: 'GetRestApi got no answer from the emulator. Request timed out.',
    recovery: true,
  },
  {
    failure: engineFailure,
    heading: `The EmuForge engine at ${engineOrigin} is not answering`,
    detail: 'GetRestApi got no answer.',
    recovery: true,
  },
] as const;

it.each(getFailures)('shows $heading for GetRestApi and restores the form on Retry', async (scenario) => {
  const { failure, heading, detail } = scenario;
  api.mockRejectedValueOnce(new RequestError({ ...failure, operation: 'GetRestApi' }));
  const form = open(address, 'connection' in scenario ? scenario.connection : connected);
  await waitFor(() => expect(form.wrapper.findStatusIndicator()?.getElement()).toHaveTextContent(heading));
  expect(form.wrapper.getElement()).toHaveTextContent(detail);
  const connectionLink = form.wrapper.findLink()?.getElement();
  if ('recovery' in scenario) expect(connectionLink).toHaveTextContent('Connection status');
  else expect(connectionLink).toBeUndefined();
  expect(form.wrapper.findForm()).toBeNull();
  await form.clickButton('Retry');
  await form.shown();
  expect(form.headingDescription()).toHaveTextContent('API: Orders');
  expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('Choose a resource');
});

const choiceFailures = [
  {
    failure: { kind: 'not-implemented' },
    heading: 'Not implemented by the emulator',
    dropdown: 'Not implemented by the emulator',
    detail: (operation: string) => `501 Not Implemented for ${operation}`,
  },
  {
    failure: { kind: 'other', code: 'BadRequest', message: 'Choice refused.' },
    connection: stopped,
    dropdown: 'BadRequest: Choice refused.',
    detail: (operation: string) => `${operation}: BadRequest: Choice refused.`,
  },
  {
    failure: emulatorFailure,
    heading: `Not answering at ${endpoint}`,
    dropdown: 'The emulator did not answer',
    detail: (operation: string) => `${operation} got no answer from the emulator. Request timed out.`,
    recovery: true,
  },
  {
    failure: engineFailure,
    heading: `The EmuForge engine at ${engineOrigin} is not answering`,
    dropdown: `The EmuForge engine at ${engineOrigin} did not answer`,
    detail: (operation: string) => `${operation} got no answer.`,
    recovery: true,
  },
] as const;

const choices = [
  { operation: 'GetResources', label: 'Resource', read: resources, value: firstResource.id, text: 'ID root' },
  { operation: 'ListFunctions', label: 'Lambda function', read: functions, value: fn.arn, text: fn.name },
];

it.each(choices.flatMap((choice) => choiceFailures.map((scenario) => ({ ...choice, scenario }))))(
  'shows $scenario.failure.kind at $operation and restores the choice on Retry',
  async ({ operation, label, read, value, text, scenario }) => {
    read.mockRejectedValueOnce(new RequestError({ ...scenario.failure, operation }));
    const form = open(address, 'connection' in scenario ? scenario.connection : connected);
    await form.shown();
    const choice = await form.openSelect(label);
    await waitFor(() => expect(choice.findStatusIndicator()?.getElement()).toHaveTextContent(scenario.dropdown));
    const retry = choice.findErrorRecoveryButton()?.getElement();
    if (!retry) throw new Error('Missing Retry in the choice');
    expect(retry).toHaveTextContent('Retry');
    const field = form.field(label).getElement();
    const heading =
      'heading' in scenario
        ? scenario.heading
        : `The ${operation === 'GetResources' ? 'resources' : 'Lambda functions'} could not be read`;
    const dropdown = choice.findDropdown().getElement();
    const fieldWrapper = createWrapper(field);
    const status = fieldWrapper.findAllStatusIndicators().find((entry) => !dropdown.contains(entry.getElement()));
    expect(status?.getElement()).toHaveTextContent(heading);
    expect(field).toHaveTextContent(scenario.detail(operation));
    const connectionLink = fieldWrapper.findLink('[href="/"]')?.getElement();
    if ('recovery' in scenario) expect(connectionLink).toHaveTextContent('Connection status');
    else expect(connectionLink).toBeUndefined();
    expect(choice.findDropdown().findOptionByValue(value)).toBeNull();
    expect(fieldWrapper.findButton()?.getElement()).toHaveTextContent('Retry');
    await form.user.click(retry);
    await waitFor(() => expect(choice.findDropdown().findOptionByValue(value)?.getElement()).toHaveTextContent(text));
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([
  { first: 'api', warn: false },
  { first: 'resources', warn: false },
  { first: 'api', warn: true },
  { first: 'resources', warn: true },
])('keeps the handed-over result when $first answers first (warning = $warn)', async ({ first, warn }) => {
  if (warn)
    create.mockResolvedValueOnce({
      kind: 'created',
      permissionWarning: { functionName: 'orders', reason: 'No permission' },
    });
  const pendingApi = deferred<RestApi>();
  const pendingResources = deferred<TokenPage<Resource>>();
  const form = open(`${address}?resource=later-page`, connected, true);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  await form.choose('Lambda function', fn.arn);
  api.mockReturnValueOnce(pendingApi.promise);
  resources.mockReturnValueOnce(pendingResources.promise);
  await form.submit();

  const expectResult = () => {
    const flashes = form.wrapper.findFlashbar();
    expect(flashes?.findItemsByType('success')[0]?.getElement()).toHaveTextContent('Method GET /orders created.');
    expect(flashes?.findItemsByType('warning')).toHaveLength(warn ? 1 : 0);
    if (warn)
      expect(flashes?.findItemsByType('warning')[0]?.getElement()).toHaveTextContent(
        'Method GET /orders created, but the permission was not added to orders: No permission',
      );
  };
  await waitFor(() => {
    expect(api).toHaveBeenCalledTimes(2);
    expect(resources).toHaveBeenCalledOnce();
    expectResult();
  });
  expect(form.handOver).toHaveBeenCalledExactlyOnceWith(restApiPath(apiId, 'resources'), expect.any(Array));
  const answerApi = () => pendingApi.resolve({ id: apiId, name: 'Orders' });
  const answerResources = () => pendingResources.resolve({ items: [linkedResource] });
  const answers = first === 'api' ? [answerApi, answerResources] : [answerResources, answerApi];
  for (const answer of answers) await act(async () => answer());
  await waitFor(() => {
    const resourcesSection = form.wrapper.find('section[aria-label="Resources"]');
    const heading = resourcesSection?.findContainer()?.findHeader()?.findHeader()?.findHeadingText().getElement();
    expect(heading).toHaveTextContent('/orders');
    expect(heading).toBeVisible();
  });
  expectResult();
});

it.each(['AddPermission', 'GetPolicy'])(
  'hands over the created method with a named %s 501 warning',
  async (operation) => {
    create.mockResolvedValueOnce({
      kind: 'created',
      permissionWarning: {
        functionName: fn.name,
        reason: `${operation}: 501 Not Implemented`,
        failure: { kind: 'not-implemented', operation },
      },
    });
    const form = open(`${address}?resource=later-page`, connected, true);
    await form.shown();
    await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
    await form.choose('Lambda function', fn.arn);
    await form.submit();

    await waitFor(() => {
      const flashes = form.wrapper.findFlashbar();
      expect(flashes?.findItemsByType('success')[0]?.getElement()).toHaveTextContent('Method GET /orders created.');
      const warning = flashes?.findItemsByType('warning')[0];
      expect(warning?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(warning?.findContent()?.getElement()).toHaveTextContent(
        `Method GET /orders created, but the permission was not added to orders: The emulator answered 501 Not Implemented for ${operation}.`,
      );
    });
    expect(form.handOver).toHaveBeenCalledExactlyOnceWith(restApiPath(apiId, 'resources'), expect.any(Array));
  },
);

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
  expect(await form.findAlert()).toHaveTextContent(
    'PutMethod: ConflictException: Method already exists for this resource',
  );
  expect(
    createWrapper(form.field('Response body').getElement()).findTextarea()?.findNativeTextarea().getElement(),
  ).toHaveValue('{"message": "ok"}');
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
  const alert = await form.findAlert();
  expect(alert).toHaveTextContent('PutIntegration: BadRequest: Integration refused');
  if (left) {
    const link = createWrapper(alert).findLink()?.getElement();
    expect(link).toHaveTextContent('View API resources');
    expect(link).toHaveAttribute('href', restApiPath(apiId, 'resources'));
    expect(alert).toHaveTextContent(
      'Method GET /orders was created without a working integration and could not be removed: DeleteMethod: Denied: Delete refused',
    );
  } else expect(alert).toHaveTextContent('No method was created.');
  expect(form.handOver).not.toHaveBeenCalled();
});

it('shows a write 501 with its operation and keeps Create method visible and unavailable', async () => {
  create.mockResolvedValueOnce({ kind: 'unchanged', failure: { kind: 'not-implemented', operation: 'PutMethod' } });
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  await form.chooseKind('mock');
  await form.submit();
  const alert = await form.findAlert();
  expect(alert).toHaveTextContent('Not implemented by the emulator');
  expect(alert).toHaveTextContent('PutMethod: 501 Not Implemented');
  expect(form.submitButton()).toBeDisabled();
});

it('shows API not found with a link to APIs when the API does not exist', async () => {
  api.mockResolvedValueOnce(null);
  const form = open();
  await waitFor(() => {
    const heading = form.wrapper.findHeader()?.findHeadingText().getElement();
    expect(heading).toHaveTextContent('API not found');
    expect(heading).toBeVisible();
  });
  const link = form.wrapper.findLink()?.getElement();
  expect(link).toHaveAccessibleName('View APIs');
  expect(link).toHaveAttribute('href', '/aws/apigateway/apis');
});

it.each([false, true])('leaves on Cancel and only asks after an edit (changed = %s)', async (changed) => {
  const form = open(`${address}?resource=later-page`);
  await form.shown();
  await waitFor(() => expect(form.select('Resource').findTrigger().getElement()).toHaveTextContent('/orders'));
  if (changed) await form.chooseKind('mock');
  await form.cancel();
  if (changed) {
    const modal = await waitFor(() => {
      const match = form.wrapper.findModal();
      if (!match) throw new Error('Missing discard dialog');
      expect(match.isVisible()).toBe(true);
      return match;
    });
    expect(modal.findHeader().getElement()).toHaveTextContent('Discard what you entered?');
    const footer = modal.findFooter();
    if (!footer) throw new Error('Missing discard dialog footer');
    await form.clickButton('Discard', createWrapper(footer.getElement()));
  } else expect(form.wrapper.findModal()).toBeNull();
  expect(await screen.findByText(`Destination ${restApiPath(apiId)}`)).toBeVisible();
});
