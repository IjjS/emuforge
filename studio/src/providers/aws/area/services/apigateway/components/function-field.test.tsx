import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFunctions } from '../lambda-api';
import { FunctionField } from './function-field';

vi.mock('../lambda-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9682';
const endpoint = 'https://127.0.0.1:9683';
const connected: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { endpoint, port: 9683 } },
};
const stopped: AreaConnection = {
  engineOrigin,
  result: {
    kind: 'emulator-unreachable',
    reason: 'not_started',
    message: 'The emulator is stopped.',
    checkedAt: 1,
    emulator: { endpoint, port: 9683 },
  },
};
const item = { name: 'orders', arn: 'arn:aws:lambda:us-west-2:123456789012:function:orders' };
const read = vi.mocked(readFunctions);

beforeEach(() => vi.resetAllMocks());

function renderField(connection = connected) {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <FunctionField connection={connection} value={undefined} onChange={onChange} onAllowChange={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const wrapper = createWrapper(container);
  const field = wrapper.findFormField();
  const select = field && createWrapper(field.getElement()).findSelect();
  if (!select) throw new Error('Missing function choice');
  return { field, select, onChange, user, wrapper };
}

it('reads on opening the choice and shows the name and ARN at the option with that ARN', async () => {
  read.mockResolvedValueOnce({ items: [item] });
  const { select, onChange, user } = renderField();
  expect(read).not.toHaveBeenCalled();
  await user.click(select.findTrigger().getElement());
  await waitFor(() =>
    expect(select.findDropdown().findOptionByValue(item.arn)?.getElement()).toHaveTextContent(
      `${item.name}${item.arn}`,
    ),
  );
  select.selectOptionByValue(item.arn);
  expect(onChange).toHaveBeenCalledWith(item);
});

it('describes the empty function choice and checks permission by default', async () => {
  read.mockResolvedValueOnce({ items: [] });
  const { field, select, user, wrapper } = renderField();
  const checkbox = wrapper.findCheckbox()?.findNativeInput().getElement();
  expect(checkbox).toHaveAccessibleName('Allow API Gateway to invoke this function');
  expect(checkbox).toBeChecked();
  expect(checkbox).toHaveAccessibleDescription(
    "Adds a permission to the function's resource policy for this API. Without it the emulator answers 500.",
  );
  await user.click(select.findTrigger().getElement());
  await waitFor(() => expect(select.findDropdown().getElement()).toHaveTextContent('No Lambda functions'));
  expect(field.findConstraint()?.getElement()).toHaveTextContent('The emulator holds no Lambda function.');
});

const operation = 'ListFunctions';
const emulatorFailure = { kind: 'emulator-did-not-answer', operation, message: 'Request timed out.' } as const;

it.each<{
  failure: RequestFailure;
  heading: string;
  reason: string;
  dropdown: string;
  connection?: AreaConnection;
  recovery?: boolean;
}>([
  {
    failure: { kind: 'not-implemented', operation },
    heading: 'Not implemented by the emulator',
    reason: '501 Not Implemented for ListFunctions',
    dropdown: '501 Not Implemented for ListFunctions',
  },
  {
    failure: { kind: 'access-denied', operation, message: 'No functions for this caller' },
    heading: 'Access denied',
    reason: 'ListFunctions was refused: No functions for this caller',
    dropdown: 'ListFunctions was refused: No functions for this caller',
  },
  {
    failure: { kind: 'other', operation, code: 'Denied', message: 'Function list refused' },
    connection: stopped,
    heading: 'The Lambda functions could not be read',
    reason: 'ListFunctions: Denied: Function list refused',
    dropdown: 'Denied: Function list refused',
  },
  {
    failure: emulatorFailure,
    connection: stopped,
    heading: 'Not started on port 9683',
    reason: 'ListFunctions got no answer from the emulator. Request timed out.',
    dropdown: 'Not started on port 9683',
    recovery: true,
  },
  {
    failure: emulatorFailure,
    heading: `Not answering at ${endpoint}`,
    reason: 'ListFunctions got no answer from the emulator. Request timed out.',
    dropdown: 'The emulator did not answer',
    recovery: true,
  },
  {
    failure: { kind: 'engine-did-not-answer', operation },
    heading: `The EmuForge engine at ${engineOrigin} is not answering`,
    reason: 'ListFunctions got no answer.',
    dropdown: `The EmuForge engine at ${engineOrigin} did not answer`,
    recovery: true,
  },
])('shows $heading for ListFunctions and restores the options on Retry', async (scenario) => {
  read.mockRejectedValueOnce(new RequestError(scenario.failure)).mockResolvedValueOnce({ items: [item] });
  const { field, select, user } = renderField(scenario.connection);
  await user.click(select.findTrigger().getElement());
  await waitFor(() => expect(select.findStatusIndicator()?.getElement()).toHaveTextContent(scenario.dropdown));
  const retry = select.findErrorRecoveryButton()?.getElement();
  expect(retry).toHaveTextContent('Retry');
  const fieldElement = field.getElement();
  const dropdown = select.findDropdown().getElement();
  const fieldWrapper = createWrapper(fieldElement);
  const status = fieldWrapper.findAllStatusIndicators().find((entry) => !dropdown.contains(entry.getElement()));
  expect(status?.getElement()).toHaveTextContent(scenario.heading);
  expect(fieldElement).toHaveTextContent(scenario.reason);
  const connectionLink = fieldWrapper.findLink('[href="/"]')?.getElement();
  if (scenario.recovery) expect(connectionLink).toHaveTextContent('Connection status');
  else expect(connectionLink).toBeUndefined();
  expect(select.findDropdown().findOptionByValue(item.arn)).toBeNull();
  const retryBelow = fieldWrapper.findButton()?.getElement();
  if (!retryBelow) throw new Error('Missing Retry below the choice');
  expect(retryBelow).toHaveTextContent('Retry');
  if (!retry) throw new Error('Missing Retry in the choice');
  await user.click(retry);
  await waitFor(() =>
    expect(select.findDropdown().findOptionByValue(item.arn)?.getElement()).toHaveTextContent(item.name),
  );
});
