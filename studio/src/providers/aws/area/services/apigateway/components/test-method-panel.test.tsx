import type { TestInvokeMethodCommandOutput } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
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
      <TestMethodPanel
        endpoint={endpoint}
        apiId="api-1"
        resourceId="orders"
        method="ANY"
        path="/orders"
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { client, panel: createWrapper(container), user };
};

beforeEach(() => {
  invoke.mockReset();
});

function findTestButton(panel: ReturnType<typeof createWrapper>) {
  const button = panel.findForm()?.findActions()?.findButton()?.getElement();
  if (!button) throw new Error('Missing Test action');
  return button;
}

function findBoxesByTag(panel: ReturnType<typeof createWrapper>, tag: 'H4' | 'PRE') {
  return panel
    .findAllBoxes()
    .map((box) => box.getElement())
    .filter((element) => element.tagName === tag);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('shows the registered method as text and fills in the resource path', () => {
  const { panel } = renderPanel();
  const fields = panel.findAllFormFields();
  expect(panel.findKeyValuePairs()?.findItems()[0]?.findValue()?.getElement()).toHaveTextContent('ANY');
  expect(fields.map((field) => field.findLabel()?.getElement().textContent)).toEqual([
    'Path with query',
    'Headers',
    'Body',
  ]);
  expect(fields[0]?.findControl()?.findInput()?.findNativeInput().getElement()).toHaveValue('/orders');
  expect(panel.findHeader()?.findDescription()?.getElement()).toHaveTextContent(
    'Calls the method in the emulator without a deployment.',
  );
  expect(panel.findSelect()).toBeNull();
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
  const { panel, user } = renderPanel();
  await user.click(findTestButton(panel));
  await waitFor(() => {
    const [responseHeading, logHeading] = findBoxesByTag(panel, 'H4');
    expect(responseHeading).toHaveTextContent('Response');
    expect(logHeading).toHaveTextContent('Log');

    const [, summary, headers] = panel.findAllKeyValuePairs();
    const [status, latency] = summary?.findItems() ?? [];
    const header = headers?.findItems()[0];
    expect(status?.findValue()?.getElement()).toHaveTextContent('500');
    expect(latency?.findValue()?.getElement()).toHaveTextContent('0 ms');
    expect(header?.findLabel()?.getElement()).toHaveTextContent('X-Result');
    expect(header?.findValue()?.getElement()).toHaveTextContent('failure');

    const [bodyBlock, logBlock] = findBoxesByTag(panel, 'PRE');
    expect(bodyBlock?.textContent).toBe(body);
    expect(logBlock?.textContent).toBe(log);
    expect(bodyBlock?.querySelector('img')).toBeNull();
  });
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
  const { panel, user } = renderPanel();
  const test = findTestButton(panel);

  await user.click(test);
  await waitFor(() => {
    const alert = panel.findAlert();
    expect(alert?.findHeader()?.getElement()).toHaveTextContent('TestInvokeMethod failed');
    expect(alert?.findContent().getElement()).toHaveTextContent('No integration defined for method');
  });
  await user.click(test);
  await waitFor(() => {
    const alert = panel.findAlert();
    expect(alert?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
    expect(alert?.findContent().getElement()).toHaveTextContent(
      'The emulator answered 501 Not Implemented for TestInvokeMethod',
    );
  });
  expect(test).toHaveAccessibleName('Test');
  expect(test).toHaveAttribute('aria-disabled', 'true');
  await user.click(test);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('validates headers before sending and submits the edited request', async () => {
  invoke.mockResolvedValueOnce({ $metadata: {} });
  const { panel, user } = renderPanel();
  const test = findTestButton(panel);
  const [pathField, headersField, bodyField] = panel.findAllFormFields();
  const path = pathField?.findControl()?.findInput()?.findNativeInput().getElement();
  const headers = headersField?.findControl()?.findTextarea()?.findNativeTextarea().getElement();
  const body = bodyField?.findControl()?.findTextarea()?.findNativeTextarea().getElement();
  if (!path || !headersField || !headers || !body) throw new Error('Missing request form fields');
  await user.type(headers, 'X-Mode');
  await user.click(test);
  expect(headersField.findError()?.getElement()).toHaveTextContent('Write each header as Name: value.');
  expect(invoke).not.toHaveBeenCalled();

  await user.type(headers, ': preview');
  await user.type(path, '?limit=2');
  await user.type(body, 'request body');
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
  const second = deferred<TestInvokeMethodCommandOutput>();
  const third = deferred<TestInvokeMethodCommandOutput>();
  invoke
    .mockResolvedValueOnce({ $metadata: {}, body: 'First answer' })
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise);
  const { user, client, panel } = renderPanel();
  const test = findTestButton(panel);

  await user.click(test);
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(client.isMutating()).toBe(0);
  });
  await user.click(test);
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  await user.click(test);
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
  await act(async () => third.resolve({ $metadata: {}, body: 'Third answer', log: 'Third log' }));
  await waitFor(() => expect(client.isMutating()).toBe(1));
  await act(async () => second.resolve({ $metadata: {}, body: 'Second answer' }));
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(findBoxesByTag(panel, 'PRE').map((block) => block.textContent)).toEqual(['Third answer', 'Third log']);
});
