import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { readFunctions } from '../lambda-api';
import { FunctionField } from './function-field';

vi.mock('../lambda-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9682';
const endpoint = 'https://127.0.0.1:9683';
const connection = {
  engineOrigin,
  result: { kind: 'connected' as const, checkedAt: 1, emulator: { endpoint, port: 9683 } },
};
const read = vi.mocked(readFunctions);

beforeEach(() => vi.resetAllMocks());

function renderField() {
  const onChange = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <FunctionField connection={connection} value={undefined} onChange={onChange} onAllowChange={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const select = createWrapper(container).findSelect();
  if (!select) throw new Error('Missing function choice');
  return { select, onChange };
}

it('reads on opening the choice and shows the name and ARN at the option with that ARN', async () => {
  const item = { name: 'orders', arn: 'arn:aws:lambda:us-west-2:123456789012:function:orders' };
  read.mockResolvedValueOnce({ items: [item] });
  const { select, onChange } = renderField();
  expect(read).not.toHaveBeenCalled();
  await userEvent.click(select.findTrigger().getElement());
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
  const { select } = renderField();
  const checkbox = screen.getByRole('checkbox', { name: 'Allow API Gateway to invoke this function' });
  expect(checkbox).toBeChecked();
  expect(checkbox).toHaveAccessibleDescription(
    "Adds a permission to the function's resource policy for this API. Without it the emulator answers 500.",
  );
  await userEvent.click(select.findTrigger().getElement());
  expect(await screen.findByText('No Lambda functions')).toBeVisible();
  expect(screen.getByText('The emulator holds no Lambda function.')).toBeVisible();
});

const operation = 'ListFunctions';
it.each<{ failure: RequestFailure; text: string; recovery?: boolean }>([
  { failure: { kind: 'not-implemented', operation }, text: 'Not implemented by the emulator' },
  { failure: { kind: 'access-denied', operation, message: 'No functions for this caller' }, text: 'Access denied' },
  {
    failure: { kind: 'other', operation, code: 'Denied', message: 'Function list refused' },
    text: 'ListFunctions: Denied: Function list refused',
  },
  { failure: { kind: 'engine-did-not-answer', operation }, text: 'The EmuForge engine at', recovery: true },
  { failure: { kind: 'emulator-did-not-answer', operation, message: '' }, text: 'Not answering at', recovery: true },
])('shows the ListFunctions failure $failure.kind', async ({ failure, text, recovery }) => {
  read.mockRejectedValueOnce(new RequestError(failure));
  const { select } = renderField();
  await userEvent.click(select.findTrigger().getElement());
  expect(await screen.findByText(text, { exact: !recovery })).toBeVisible();
  if (recovery) expect(screen.getByRole('link', { name: 'Connection status' })).toBeVisible();
});
