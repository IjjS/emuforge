import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { listEventBuses } from '../bus-api';
import type { BusChoice } from '../use-bus-choice';
import { BusSelect } from './bus-select';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  listEventBuses: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const read = vi.mocked(listEventBuses);

beforeEach(() => {
  read.mockReset();
});

function renderField(initialChoice: BusChoice = { kind: 'chosen', name: 'default' }) {
  const change = vi.fn();
  function Field() {
    const [choice, setChoice] = useState(initialChoice);
    return (
      <BusSelect
        connection={{ engineOrigin: endpoint, result: undefined }}
        choice={choice}
        onChange={(name) => {
          setChoice({ kind: 'chosen', name });
          change(name);
        }}
      />
    );
  }
  const { container } = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <Field />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const page = createWrapper(container);
  const select = page.findSelect();
  const field = page.findFormField();
  if (!select || !field) throw new Error('Expected the bus field');
  return { page, select, field, change };
}

it('reads only on opening, shows descriptions or ARNs, pages and sends the typed prefix', async () => {
  read
    .mockResolvedValueOnce({
      items: [{ Name: 'orders', Description: 'Order events', Arn: 'arn:orders' }],
      next: 'page2',
    })
    .mockResolvedValueOnce({ items: [{ Name: 'shipments', Arn: 'arn:shipments' }] })
    .mockResolvedValueOnce({ items: [{ Name: 'shipping' }] });
  const { page, select, change } = renderField();
  expect(read).not.toHaveBeenCalled();
  select.openDropdown();
  const dropdown = select.findDropdown();
  await waitFor(() => expect(dropdown.findOption(1)?.getElement()).toHaveTextContent(/^ordersOrder events$/));
  expect(read).toHaveBeenLastCalledWith(endpoint, '', undefined, expect.any(AbortSignal));
  const more = page.findButton();
  if (!more) throw new Error('Expected Load more');
  expect(more.getElement()).toHaveAccessibleName('Load more');
  fireEvent.click(more.getElement());
  await waitFor(() => expect(dropdown.findOption(2)?.getElement()).toHaveTextContent(/^shipmentsarn:shipments$/));
  expect(read).toHaveBeenLastCalledWith(endpoint, '', 'page2', expect.any(AbortSignal));
  select.findFilteringInput()?.setInputValue('ship');
  await waitFor(() => expect(dropdown.findOption(1)?.getElement()).toHaveTextContent(/^shipping$/));
  expect(read).toHaveBeenLastCalledWith(endpoint, 'ship', undefined, expect.any(AbortSignal));
  select.selectOptionByValue('shipping');
  expect(change).toHaveBeenCalledExactlyOnceWith('shipping');
});

it.each([
  ['missing', 'missing', 'Event bus missing is not in your local emulator. Choose an event bus.'],
  ['', 'Choose an event bus', 'The address names no event bus. Choose an event bus.'],
])('shows the address error for %j and clears it after selection', async (name, shown, message) => {
  read.mockResolvedValue({ items: [{ Name: 'orders' }] });
  const { field, select, change } = renderField({ kind: 'invalid', name, message });
  expect(select.findTrigger().getElement().textContent).toBe(shown);
  expect(field.findError()?.getElement().textContent).toBe(message);
  select.openDropdown();
  await waitFor(() =>
    expect(select.findDropdown().findOption(1)?.findLabel().getElement()).toHaveTextContent(/^orders$/),
  );
  select.selectOptionByValue('orders');
  expect(change).toHaveBeenCalledExactlyOnceWith('orders');
  expect(field.findError()).toBeNull();
  expect(select.findTrigger().getElement()).toHaveTextContent(/^orders$/);
});

it.each([
  [{ kind: 'other', operation: 'ListEventBuses', code: 'Throttling', message: 'Slow down' }, 'Throttling: Slow down'],
  [
    { kind: 'not-implemented', operation: 'ListEventBuses' },
    'Not implemented by the emulator. The emulator answered 501 Not Implemented for ListEventBuses.',
  ],
] as const)('shows $0.kind in the list, offers no choices and retries', async (failure, message) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ items: [{ Name: 'orders' }] });
  const { select } = renderField();
  select.openDropdown();
  const dropdown = select.findDropdown();
  await waitFor(() => expect(dropdown.getElement().textContent).toContain(message));
  expect(dropdown.findOptions()).toHaveLength(0);
  const retry = select.findErrorRecoveryButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  await waitFor(() => expect(dropdown.findOption(1)?.findLabel().getElement()).toHaveTextContent(/^orders$/));
  expect(read).toHaveBeenCalledTimes(2);
});
