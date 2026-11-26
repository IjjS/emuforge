import type { Resource } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import { readRestResources } from '../rest-api';
import { createResource, deleteMethod, deleteResource } from '../rest-change-api';
import { useRestResources } from '../rest-queries';
import { testInvokeMethod } from '../test-api';
import { RestResources } from './rest-resources';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-change-api', { spy: true });
vi.mock('../test-api', { spy: true });

const apiId = 'api-1';
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const fn = 'arn:aws:lambda:us-east-1:000000000000:function:orders';
const uri = `${endpoint}/orders?a=1&b=2`;
const responseTemplate = '<script>\n  response data\n</script>';
const orders: Resource = {
  id: 'resource-orders',
  path: '/orders',
  resourceMethods: {
    GET: {
      httpMethod: 'GET',
      authorizationType: 'AWS_IAM',
      apiKeyRequired: true,
      methodResponses: { '204': { statusCode: '204' } },
      methodIntegration: {
        type: 'AWS_PROXY',
        uri: `arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/${fn}/invocations`,
        integrationResponses: {
          '403': {
            statusCode: '403',
            selectionPattern: 'denied.*',
            responseTemplates: { 'text/plain': responseTemplate },
          },
        },
      },
    },
    POST: {
      httpMethod: 'POST',
      authorizationType: 'NONE',
      apiKeyRequired: false,
      methodIntegration: { type: 'HTTP_PROXY', uri },
    },
  },
};
const root = { id: 'root', path: '/' };
const reader = vi.mocked(readRestResources);

beforeEach(() => {
  vi.resetAllMocks();
  reader.mockResolvedValue({ items: [orders, root] });
});

function Content({ connection }: { connection: AreaConnection }) {
  const list = useRestResources(apiId, engineOrigin);
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/rest/api-1', 0, true);
  return (
    <PageFlashContext value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <RestResources apiId={apiId} connection={connection} list={list} />
    </PageFlashContext>
  );
}

function open(areaConnection = connection) {
  const user = userEvent.setup();
  const root = { current: null };
  const result = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AreaRootContext value={root}>
          <div ref={root}>
            <Content connection={areaConnection} />
          </div>
        </AreaRootContext>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, ...result };
}

function resources() {
  return createWrapper(screen.getByRole('region', { name: 'Resources' }));
}

function resourcePaths() {
  const region = resources();
  return region
    .findAllContainers()
    .filter((container) => container.getElement().closest('section') === region.getElement())
    .map((container) => container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent);
}

function resourceActions(index: number) {
  return resources().findAllHeaders()[index + 1]?.findActions()?.findAllButtons() ?? [];
}

function methodActions(index: number) {
  const method = resources().findAll('h4')[index];
  if (!method) return [];
  const actions = method.findClosestSpaceBetween();
  return actions ? createWrapper(actions.getElement()).findAllButtons() : [];
}

async function loadMoreResources() {
  return waitFor(() => {
    const button = resources().findAllButtons().at(-1)?.getElement();
    assert(button);
    expect(button).toHaveTextContent('Load more resources');
    return button;
  });
}

it('shows resource paths and methods, and copies IDs, Lambda ARNs and HTTP addresses verbatim', async () => {
  const { user } = open();
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  const region = resources();
  expect(region.findAll('h4').map((box) => box.getElement().textContent)).toEqual(['GET', 'POST']);
  const methodFields = region
    .findAllKeyValuePairs()
    .map((group) => group.findItems())
    .filter(([first]) => first?.findLabel()?.getElement().textContent === 'Authorization');
  expect(methodFields).toHaveLength(2);
  const expectedMethods = [
    ['AWS_IAM', 'Yes', 'Lambda function'],
    ['NONE', 'No', 'HTTP endpoint'],
  ] as const;
  for (const [index, [authorization, apiKey, integration]] of expectedMethods.entries()) {
    const [authValue, keyValue, integrationValue] = methodFields[index] ?? [];
    expect(authValue?.findValue()?.getElement().textContent).toBe(authorization);
    expect(keyValue?.findValue()?.getElement().textContent).toBe(apiKey);
    expect(integrationValue?.findValue()?.getElement()).toHaveTextContent(integration);
  }
  const rootResource = region.findContainer()?.findContent()?.getElement();
  expect(rootResource).toHaveTextContent('No methods');
  const copies = region.findAllCopyToClipboards();
  const expectedCopies = [
    ['Copy Resource ID', root.id],
    ['Copy Resource ID', orders.id],
    ['Copy Lambda function ARN', fn],
    ['Copy HTTP address', uri],
  ] as const;
  expect(copies).toHaveLength(expectedCopies.length);
  for (const [index, [label, value]] of expectedCopies.entries()) {
    const button = copies[index]?.findCopyButton().getElement();
    assert(button);
    expect(button).toHaveAccessibleName(label);
    await user.click(button);
    expect(await navigator.clipboard.readText()).toBe(value);
  }
});

it('opens read-only Responses showing codes, the selection pattern, and the exact template as text', async () => {
  const { user } = open();
  const [getResponses, postResponses] = await waitFor(() => {
    const sections = resources().findAllExpandableSections();
    expect(sections).toHaveLength(2);
    return sections;
  });
  assert(getResponses && postResponses);

  expect(getResponses.findHeaderText()?.getElement()).toHaveTextContent('Responses');
  await user.click(getResponses.findExpandButton().getElement());
  const get = getResponses.findContent();
  for (const text of ['Method responses', 'Integration responses', '204', '403', 'denied.*', 'text/plain']) {
    expect(get.getElement()).toHaveTextContent(text);
  }
  const template = get.findBox('pre')?.getElement();
  expect(template).toBeVisible();
  expect(template?.textContent).toBe(responseTemplate);
  expect(template?.querySelector('script')).toBeNull();
  expect(get.findAllButtons()).toHaveLength(0);
  expect(get.findInput()).toBeNull();
  expect(get.findTextarea()).toBeNull();

  expect(postResponses.findHeaderText()?.getElement()).toHaveTextContent('Responses');
  await user.click(postResponses.findExpandButton().getElement());
  expect(postResponses.findContent().getElement()).toHaveTextContent('No method responses');
  expect(postResponses.findContent().getElement()).toHaveTextContent('No integration responses');
});

it('links each resource to Create method with that resource preselected', async () => {
  open();
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  const links = [resourceActions(0)[1]?.getElement(), resourceActions(1)[1]?.getElement()];
  for (const link of links) expect(link).toHaveTextContent('Create method');
  expect(links.map((link) => link?.getAttribute('href'))).toEqual([
    '/aws/apigateway/apis/rest/api-1/methods/create?resource=root',
    '/aws/apigateway/apis/rest/api-1/methods/create?resource=resource-orders',
  ]);
});

it('loads the further resource page by position and appends it to the visible paths', async () => {
  reader.mockResolvedValueOnce({ items: [root], next: 'more' }).mockResolvedValueOnce({ items: [orders] });
  const { user } = open();
  const loadMore = await loadMoreResources();
  await user.click(loadMore);
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  expect(reader).toHaveBeenLastCalledWith(engineOrigin, apiId, 'more', expect.any(AbortSignal));
  expect(loadMore).not.toBeInTheDocument();
});

const readFailures: [RequestFailure, string, string, boolean?, AreaConnection?][] = [
  [
    { kind: 'not-implemented', operation: 'GetResources' },
    'Not implemented by the emulator',
    '501 Not Implemented for GetResources',
  ],
  [
    { kind: 'access-denied', operation: 'GetResources', message: 'No permission to list.' },
    'Access denied',
    'GetResources was refused: No permission to list.',
  ],
  [
    { kind: 'other', operation: 'GetResources', code: 'BadRequestException', message: 'Invalid position' },
    'The resources could not be read',
    'GetResources: BadRequestException: Invalid position',
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetResources', message: 'The emulator is stopped.' },
    'Not started on port 9682',
    'GetResources got no answer from the emulator. The emulator is stopped.',
    true,
    {
      engineOrigin,
      result: {
        kind: 'emulator-unreachable',
        checkedAt: 1,
        emulator: { port: 9682, endpoint },
        reason: 'not_started',
        message: 'The emulator is stopped.',
      },
    },
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetResources', message: 'Timeout.' },
    `Not answering at ${endpoint}`,
    'GetResources got no answer from the emulator. Timeout.',
    true,
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetResources' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetResources got no answer.',
    true,
  ],
];

describe.each(['first', 'further'] as const)('when the %s resources page fails', (page) => {
  it.each(readFailures)('shows and retries %j', async (failure, first, detail, recovery, areaConnection) => {
    if (page === 'further') reader.mockResolvedValueOnce({ items: [root], next: 'more' });
    reader.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [orders] });
    const { user } = open(areaConnection);
    if (page === 'further') await user.click(await loadMoreResources());

    const region = resources();
    const retry = await waitFor(() => {
      const status = region.findStatusIndicator()?.getElement();
      assert(status);
      expect(status).toHaveTextContent(first);
      const failure = createWrapper(status).findClosestBox();
      const button = failure && createWrapper(failure.getElement()).findButton()?.getElement();
      assert(button);
      expect(button).toHaveTextContent('Retry');
      return button;
    });
    expect(region.getElement()).toHaveTextContent(detail);
    if (recovery) {
      const link = region.findLink('[href="/"]')?.getElement();
      expect(link).toHaveTextContent('Connection status');
      expect(link).toHaveAttribute('href', '/');
    }
    if (page === 'further') expect(resourcePaths()).toEqual(['/']);

    await user.click(retry);
    await waitFor(() => expect(resourcePaths()).toEqual(page === 'further' ? ['/', '/orders'] : ['/orders']));
    expect(retry).not.toBeInTheDocument();
    expect(reader).toHaveBeenLastCalledWith(
      engineOrigin,
      apiId,
      page === 'further' ? 'more' : undefined,
      expect.any(AbortSignal),
    );
  });
});

const newResource = { id: 'new', path: '/new' };

it('opens Test for an eligible method and explains why a VPC link method cannot be tested', async () => {
  reader.mockResolvedValueOnce({
    items: [
      { ...root, resourceMethods: { ANY: {} } },
      { ...orders, resourceMethods: { POST: { methodIntegration: { type: 'MOCK', connectionType: 'VPC_LINK' } } } },
    ],
  });
  const { user } = open();
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  const eligible = methodActions(0)[0]?.getElement();
  const unavailable = methodActions(1)[0]?.getElement();
  assert(eligible && unavailable);
  expect(eligible).toHaveTextContent('Test');
  expect(unavailable).toHaveTextContent('Test');
  expect(unavailable).toHaveAttribute('aria-disabled', 'true');
  expect(unavailable).toHaveAccessibleDescription(
    'Test is not offered for an integration through a VPC link: where the emulator sends it has not been verified.',
  );
  await user.click(unavailable);
  expect(screen.queryByRole('region', { name: 'Test method' })).not.toBeInTheDocument();
  expect(testInvokeMethod).not.toHaveBeenCalled();

  await user.click(eligible);
  const panel = screen.getByRole('region', { name: 'Test method' });
  expect(createWrapper(panel).findKeyValuePairs()?.findItems()[0]?.findValue()?.getElement()).toHaveTextContent('ANY');
  const pathField = createWrapper(panel).findFormField();
  expect(pathField?.findLabel()?.getElement()).toHaveTextContent('Path with query');
  expect(pathField?.findControl()?.findInput()?.findNativeInput().getElement()).toHaveValue('/');
});

it('closes the panel from its own control and returns focus to the Test button for the selected method', async () => {
  const { user } = open();
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  const getTest = methodActions(0)[0]?.getElement();
  const postTest = methodActions(1)[0]?.getElement();
  assert(getTest && postTest);
  expect(getTest).toHaveTextContent('Test');
  expect(postTest).toHaveTextContent('Test');

  await user.click(getTest);
  await user.click(postTest);
  const panel = screen.getByRole('region', { name: 'Test method' });
  const panelWrapper = createWrapper(panel);
  expect(panelWrapper.findKeyValuePairs()?.findItems()[0]?.findValue()?.getElement()).toHaveTextContent('POST');
  expect(postTest).toHaveAttribute('aria-expanded', 'true');

  const close = panelWrapper.findHeader()?.findActions()?.findButton()?.getElement();
  assert(close);
  expect(close).toHaveTextContent('Close');
  await user.click(close);
  expect(panel).not.toBeInTheDocument();
  expect(postTest).toHaveAttribute('aria-expanded', 'false');
  expect(postTest).toHaveFocus();
  expect(testInvokeMethod).not.toHaveBeenCalled();
});

async function openChange(kind: 'create' | 'resource' | 'method', user = open().user) {
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  const partActions = resources().findHeader()?.findActions()?.findAllButtons();
  const trigger = (
    kind === 'create' ? partActions?.[1] : kind === 'resource' ? resourceActions(1)[0] : methodActions(0)[1]
  )?.getElement();
  assert(trigger);
  expect(trigger).toHaveTextContent(kind === 'create' ? 'Create resource' : 'Delete');
  await user.click(trigger);
  const title = {
    create: 'Create resource',
    resource: 'Delete resource /orders?',
    method: 'Delete method GET /orders?',
  }[kind];
  const modal = createWrapper(document.body).findModal();
  if (!modal) throw new Error('Missing change dialog');
  expect(modal.findHeader().getElement()).toHaveTextContent(title);
  const field = modal.findContent().findAllFormFields()[kind === 'create' ? 1 : 0];
  const input = field?.findControl()?.findInput()?.findNativeInput().getElement();
  if (!input) throw new Error('Missing change input');
  await user.type(input, { create: 'new', resource: '/orders', method: 'delete' }[kind]);
  const submit = modal.findFooter()?.findAllButtons().at(-1)?.getElement();
  assert(submit);
  expect(submit).toHaveTextContent(kind === 'create' ? 'Create resource' : 'Delete');
  return { submit: () => user.click(submit) };
}

function successMessage() {
  return createWrapper(document.body).findFlashbar()?.findItemsByType('success')[0]?.findContent().getElement();
}

function expectFlash(message: string) {
  const flash = successMessage();
  expect(flash).toBeVisible();
  expect(flash).toHaveTextContent(message);
}

it.each([
  { kind: 'create', answer: [root, orders, newResource], message: 'Resource /new created.' },
  { kind: 'resource', answer: [root], message: 'Resource /orders deleted.' },
  {
    kind: 'method',
    answer: [root, { ...orders, resourceMethods: { POST: orders.resourceMethods?.POST ?? {} } }],
    message: 'Method GET /orders deleted.',
  },
] as const)(
  'closes the $kind dialog, reports the result, and re-reads the resources',
  async ({ kind, answer, message }) => {
    vi.mocked(createResource).mockResolvedValueOnce({ ...newResource, $metadata: {} });
    vi.mocked(deleteResource).mockResolvedValueOnce({ $metadata: {} });
    vi.mocked(deleteMethod).mockResolvedValueOnce({ $metadata: {} });
    const { submit } = await openChange(kind);
    const feedbackAtRead = vi.fn();
    reader.mockImplementationOnce(async () => {
      const flash = successMessage();
      const modal = createWrapper(document.body).findModal();
      const flashVisible = flash?.isConnected === true && getComputedStyle(flash).visibility === 'visible';
      feedbackAtRead(flash?.textContent, flashVisible, Boolean(modal?.isVisible()));
      return { items: [...answer] };
    });
    await submit();
    await waitFor(() => {
      expectFlash(message);
      expect(createWrapper(document.body).findModal()).toBeNull();
      if (kind === 'create') expect(resourcePaths()).toEqual(['/', '/new', '/orders']);
      if (kind === 'resource') expect(resourcePaths()).toEqual(['/']);
      if (kind === 'method') {
        expect(
          resources()
            .findAll('h4')
            .map((box) => box.getElement().textContent),
        ).toEqual(['POST']);
      }
    });
    expect(feedbackAtRead).toHaveBeenCalledExactlyOnceWith(message, true, false);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(reader).toHaveBeenLastCalledWith(engineOrigin, apiId, undefined, expect.any(AbortSignal));
  },
);

it('leaves the root Delete unavailable and explains the reason', async () => {
  const { user } = open();
  await waitFor(() => expect(resourcePaths()).toEqual(['/', '/orders']));
  const button = resourceActions(0)[0]?.getElement();
  assert(button);
  expect(button).toHaveTextContent('Delete');
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAccessibleDescription('The root resource cannot be deleted.');
  await user.hover(button);
  await waitFor(() => {
    expect(resourceActions(0)[0]?.findDisabledReason()?.getElement()).toHaveTextContent(
      'The root resource cannot be deleted.',
    );
  });
  await user.click(button);
  expect(createWrapper(document.body).findModal()).toBeNull();
});

function deferredPage() {
  let resolve!: (page: TokenPage<Resource>) => void;
  const promise = new Promise<TokenPage<Resource>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.each([
  ['create', [root, orders, newResource], '/new', 'Resource /new created.'],
  ['resource', [root], '/orders', 'Resource /orders deleted.'],
] as const)('after the %s action', (kind, items, path, flash) => {
  it.each(['earlier', 'refreshed'] as const)(
    'keeps the refreshed rows and result when the %s read answers first',
    async (first) => {
      const earlier = deferredPage();
      const refreshed = deferredPage();
      reader.mockResolvedValueOnce({ items: [root, orders], next: 'next' });
      vi.mocked(createResource).mockResolvedValueOnce({ ...newResource, $metadata: {} });
      vi.mocked(deleteResource).mockResolvedValueOnce({ $metadata: {} });

      reader.mockReturnValueOnce(earlier.promise);
      const { user } = open();
      await user.click(await loadMoreResources());
      await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
      const { submit } = await openChange(kind, user);
      reader.mockReturnValueOnce(refreshed.promise);
      await submit();
      await waitFor(() => expect(reader).toHaveBeenCalledTimes(3));
      expect(reader.mock.calls[1]?.[3].aborted).toBe(true);

      const answerEarlier = () => act(async () => earlier.resolve({ items: [{ id: 'old', path: '/stale' }] }));
      const answerRefreshed = () => act(async () => refreshed.resolve({ items: [...items] }));
      const expectLatest = () => {
        expectFlash(flash);
        expect(resourcePaths()).toEqual(kind === 'create' ? ['/', path, '/orders'] : ['/']);
      };

      if (first === 'earlier') {
        await answerEarlier();
        await answerRefreshed();
      } else {
        await answerRefreshed();
        await waitFor(expectLatest);
        await answerEarlier();
      }
      await waitFor(expectLatest);
    },
  );
});
