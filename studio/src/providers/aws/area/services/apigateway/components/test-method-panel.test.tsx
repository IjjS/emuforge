import type { TestInvokeMethodCommandOutput } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { TEST_INVOKE_METHOD, testInvokeMethod } from '../test-api';
import { TestMethodPanel } from './test-method-panel';

vi.mock('../test-api', { spy: true });

const endpoint = 'http://127.0.0.1:9682';
const invoke = vi.mocked(testInvokeMethod);
const renderPanel = () => {
  const client = new QueryClient();
  const user = userEvent.setup();
  const { container } = render(
    <QueryClientProvider client={client}>
      <TestMethodPanel endpoint={endpoint} apiId="api-1" resourceId="orders" method="ANY" path="/orders" />
    </QueryClientProvider>,
  );
  return { client, container, user };
};

beforeEach(() => {
  invoke.mockReset();
});

it('shows the registered method as text and fills in the resource path', () => {
  const { container } = renderPanel();
  expect(screen.getByText('ANY')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Path with query' })).toHaveValue('/orders');
  expect(screen.getByText('Calls the method in the emulator without a deployment.')).toBeVisible();
  expect(createWrapper(container).findSelect()).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Method' })).not.toBeInTheDocument();
});

it('shows the status, latency, headers, and preformatted body and log as text', async () => {
  const body = '<img src="invalid">\n  answer';
  const log = 'Execution log\n  Integration returned a 500';
  invoke.mockResolvedValueOnce({
    $metadata: {},
    status: 500,
    latency: 0,
    headers: { 'X-Result': 'failure' },
    body,
    log,
  });
  const { user } = renderPanel();
  await user.click(screen.getByRole('button', { name: 'Test' }));
  expect(await screen.findByRole('heading', { name: 'Response' })).toBeVisible();
  for (const value of ['500', '0 ms', 'X-Result', 'failure']) {
    expect(screen.getByText(value)).toBeVisible();
  }
  expect(screen.getByRole('heading', { name: 'Log' })).toBeVisible();
  for (const text of [body, log]) {
    expect(screen.getByText((_, node) => node?.tagName === 'PRE' && node.textContent === text)).toBeVisible();
  }
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('shows the refusal and then leaves Test unavailable after a 501', async () => {
  invoke
    .mockRejectedValueOnce(
      new RequestError({
        kind: 'other',
        operation: TEST_INVOKE_METHOD,
        code: 'BadRequestException',
        message: 'No integration defined for method',
      }),
    )
    .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: TEST_INVOKE_METHOD }));
  const { user } = renderPanel();
  const test = screen.getByRole('button', { name: 'Test' });

  await user.click(test);
  expect(await screen.findByText('TestInvokeMethod failed')).toBeVisible();
  expect(screen.getByText(/No integration defined for method/)).toBeVisible();
  await user.click(test);
  expect(await screen.findByText(/The emulator answered 501 Not Implemented for TestInvokeMethod/)).toBeVisible();
  expect(screen.getByText('Not implemented by the emulator', { selector: '[role="alert"] *' })).toBeVisible();
  expect(test).toHaveAttribute('aria-disabled', 'true');
  await user.click(test);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('validates headers before sending and submits the edited request', async () => {
  invoke.mockResolvedValueOnce({ $metadata: {} });
  const { user } = renderPanel();
  const test = screen.getByRole('button', { name: 'Test' });
  const headers = screen.getByRole('textbox', { name: 'Headers' });
  await user.type(headers, 'X-Mode');
  await user.click(test);
  expect(screen.getByText('Write each header as Name: value.')).toBeVisible();
  expect(invoke).not.toHaveBeenCalled();

  await user.type(headers, ': preview');
  await user.type(screen.getByRole('textbox', { name: 'Path with query' }), '?limit=2');
  await user.type(screen.getByRole('textbox', { name: 'Body' }), 'request body');
  await user.click(test);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith(
      endpoint,
      {
        restApiId: 'api-1',
        resourceId: 'orders',
        httpMethod: 'ANY',
        pathWithQueryString: '/orders?limit=2',
        headers: { 'X-Mode': 'preview' },
        body: 'request body',
      },
      expect.any(AbortSignal),
    ),
  );
});

it('keeps the third answer on screen after the second test finishes', async () => {
  const second = Promise.withResolvers<TestInvokeMethodCommandOutput>();
  const third = Promise.withResolvers<TestInvokeMethodCommandOutput>();
  invoke
    .mockResolvedValueOnce({ $metadata: {}, body: 'First answer' })
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  const { user, client } = renderPanel();
  const test = screen.getByRole('button', { name: 'Test' });

  await user.click(test);
  expect(await screen.findByText('First answer')).toBeVisible();
  await user.click(test);
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('First answer')).not.toBeInTheDocument();
  await user.click(test);
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  await act(async () => third.resolve({ $metadata: {}, body: 'Third answer' }));
  expect(await screen.findByText('Third answer')).toBeVisible();
  await act(async () => second.resolve({ $metadata: {}, body: 'Second answer' }));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(screen.getByText('Third answer')).toBeVisible();
  expect(screen.queryByText('Second answer')).not.toBeInTheDocument();
});
