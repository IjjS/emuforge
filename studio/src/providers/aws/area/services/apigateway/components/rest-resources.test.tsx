import type { Resource } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { readRestResources } from '../rest-api';
import { useRestResources } from '../rest-queries';
import { RestResources } from './rest-resources';

vi.mock('../rest-api', { spy: true });

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
  reader.mockReset();
  reader.mockResolvedValue({ items: [orders, root] });
});

function Content() {
  const list = useRestResources(apiId, engineOrigin);
  return <RestResources apiId={apiId} connection={connection} list={list} />;
}

function open() {
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Content />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, ...result };
}

it('shows resource paths and methods, and copies IDs, Lambda ARNs and HTTP addresses verbatim', async () => {
  const { user } = open();
  const region = within(screen.getByRole('region', { name: 'Resources' }));
  const headings = await region.findAllByRole('heading', { level: 3 });
  expect(headings.map((heading) => heading.textContent)).toEqual(['/', '/orders']);
  for (const value of [
    'GET',
    'POST',
    'AWS_IAM',
    'NONE',
    'Yes',
    'No',
    'Lambda function',
    'HTTP endpoint',
    'No methods',
  ]) {
    expect(
      region.getByText(
        (_, element) =>
          element?.textContent === value && ![...element.children].some((child) => child.textContent === value),
      ),
    ).toBeInTheDocument();
  }
  const resourceCopies = region.getAllByRole('button', { name: 'Copy Resource ID' });
  const copies = [
    [resourceCopies[0], root.id],
    [resourceCopies[1], orders.id],
    [region.getByRole('button', { name: 'Copy Lambda function ARN' }), fn],
    [region.getByRole('button', { name: 'Copy HTTP address' }), uri],
  ] as const;
  for (const [button, expected] of copies) {
    if (!button) throw new Error('Missing copy control');
    await user.click(button);
    expect(await navigator.clipboard.readText()).toBe(expected);
  }
});

it('opens read-only Responses showing codes, the selection pattern, and the exact template as text', async () => {
  const { container, user } = open();
  await screen.findByRole('heading', { name: 'POST' });
  const sections = createWrapper(container).findAllExpandableSections();
  const getResponses = sections[0];
  const postResponses = sections[1];
  if (!getResponses || !postResponses) throw new Error('Expected two method response sections');
  const get = within(getResponses.getElement());
  const post = within(postResponses.getElement());

  await user.click(get.getByRole('button', { name: 'Responses' }));
  for (const text of ['Method responses', 'Integration responses', '204', '403', 'denied.*', 'text/plain']) {
    expect(get.getByText(text)).toBeVisible();
  }
  const template = get.getByText(
    (_, element) => element?.tagName === 'PRE' && element.textContent === responseTemplate,
  );
  expect(template).toBeVisible();
  expect(template.querySelector('script')).toBeNull();
  expect(get.getAllByRole('button')).toHaveLength(1);
  expect(get.queryByRole('textbox')).not.toBeInTheDocument();

  await user.click(post.getByRole('button', { name: 'Responses' }));
  expect(post.getByText('No method responses')).toBeVisible();
  expect(post.getByText('No integration responses')).toBeVisible();
});

it('links each resource to Create method with that resource preselected', async () => {
  open();
  const links = await screen.findAllByRole('link', { name: 'Create method' });
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    '/aws/apigateway/apis/rest/api-1/methods/create?resource=root',
    '/aws/apigateway/apis/rest/api-1/methods/create?resource=resource-orders',
  ]);
});

it('loads the further resource page by position and appends it to the visible paths', async () => {
  reader.mockResolvedValueOnce({ items: [root], next: 'more' }).mockResolvedValueOnce({ items: [orders] });
  const { user } = open();
  await user.click(await screen.findByRole('button', { name: 'Load more resources' }));
  expect(await screen.findByRole('heading', { name: '/orders' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '/' })).toBeInTheDocument();
  expect(reader).toHaveBeenLastCalledWith(engineOrigin, apiId, 'more', expect.any(AbortSignal));
  expect(screen.queryByRole('button', { name: 'Load more resources' })).not.toBeInTheDocument();
});

it.each<[RequestFailure, string, string]>([
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
    { kind: 'emulator-did-not-answer', operation: 'GetResources', message: 'Timeout.' },
    `Not answering at ${endpoint}`,
    'GetResources got no answer from the emulator. Timeout.',
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetResources' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetResources got no answer.',
  ],
])('shows and retries a failed resource read (%j)', async (failure, first, detail) => {
  reader.mockRejectedValueOnce(new RequestError(failure));
  const { user } = open();
  const region = within(screen.getByRole('region', { name: 'Resources' }));
  await region.findByText(detail, { exact: false });
  expect(
    region.getByText(
      (_, element) =>
        element?.textContent === first && ![...element.children].some((child) => child.textContent === first),
    ),
  ).toBeInTheDocument();
  await user.click(region.getByRole('button', { name: 'Retry' }));
  expect(await region.findByRole('heading', { name: '/orders' })).toBeVisible();
});
