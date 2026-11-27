import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { PageResourcesContext } from '../../../components/page-resources';
import { getEventBus, listEventBuses } from '../bus-api';
import { listRules } from '../rule-api';
import { RulesPage } from './rules-page';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  getEventBus: vi.fn(),
  listEventBuses: vi.fn(),
}));

vi.mock('../rule-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rule-api')>()),
  listRules: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const rulesPath = '/aws/events/rules';
const returnedBus = { kind: 'found', bus: { Name: 'orders' } } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listEventBuses).mockResolvedValue({ items: [{ Name: 'orders' }] });
  vi.mocked(listRules).mockResolvedValue({ items: [] });
});

function Address() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="address">
      {pathname}
      {search}
    </output>
  );
}

function renderPage(query = '') {
  const resources = vi.fn();
  const { container, getByTestId } = render(
    <MemoryRouter initialEntries={[rulesPath + query]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <RulesPage connection={{ engineOrigin: endpoint, result: undefined }} />
        </PageResourcesContext.Provider>
        <Address />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const page = createWrapper(container);
  const select = page.findSelect();
  const field = page.findFormField();
  const layout = page.findContentLayout();
  if (!select || !layout || !field) throw new Error('Expected the Rules page and its bus field');
  return { page, select, field, layout, resources, address: getByTestId('address') };
}

it.each([
  ['', 'default'],
  ['?bus=orders', 'orders'],
])('lists the chosen bus for %j', async (query, bus) => {
  vi.mocked(getEventBus).mockResolvedValueOnce(returnedBus);
  const { page, select, resources } = renderPage(query);
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement().textContent).toBe('No rules'));
  expect(select.findTrigger().getElement().textContent).toBe(bus);
  expect(listRules).toHaveBeenCalledExactlyOnceWith(endpoint, bus, '', undefined, expect.any(AbortSignal));
  expect(resources).toHaveBeenCalledWith({ word: 'rules' });
  if (query) expect(getEventBus).toHaveBeenCalledExactlyOnceWith(endpoint, bus, expect.any(AbortSignal));
  else expect(getEventBus).not.toHaveBeenCalled();
});

it('choosing a bus changes the query, empties the filter, starts on page one and enables the create link', async () => {
  vi.mocked(listRules)
    .mockResolvedValueOnce({ items: [{ Name: 'start' }] })
    .mockResolvedValueOnce({ items: [{ Name: 'shipment' }], next: 'page2' })
    .mockResolvedValueOnce({ items: [{ Name: 'shipping' }] })
    .mockResolvedValueOnce({ items: [{ Name: 'created-outside' }] });
  const { address, page, layout, select } = renderPage();
  await waitFor(() => expect(page.findTable()?.findRows()[0]?.getElement()).toHaveTextContent('start'));
  const input = page.findTextFilter()?.findInput().findNativeInput();
  if (!input) throw new Error('Expected the rule filter');
  fireEvent.change(input.getElement(), { target: { value: 'ship' } });
  await waitFor(() => expect(page.findTable()?.findRows()[0]?.findLink()?.getElement().textContent).toBe('shipment'));
  const next = page.findPagination()?.findNextPageButton();
  if (!next) throw new Error('Expected the next page control');
  fireEvent.click(next.getElement());
  await waitFor(() => expect(page.findTable()?.findRows()[0]?.findLink()?.getElement().textContent).toBe('shipping'));
  expect(listRules).toHaveBeenLastCalledWith(endpoint, 'default', 'ship', 'page2', expect.any(AbortSignal));

  select.openDropdown();
  await waitFor(() => expect(select.findDropdown().findOption(1)?.findLabel().getElement().textContent).toBe('orders'));
  select.selectOptionByValue('orders');
  await waitFor(() =>
    expect(page.findTable()?.findRows()[0]?.findLink()?.getElement().textContent).toBe('created-outside'),
  );
  expect(listRules).toHaveBeenLastCalledWith(endpoint, 'orders', '', undefined, expect.any(AbortSignal));
  expect(page.findTextFilter()?.findInput().findNativeInput().getElement()).toHaveValue('');
  expect(address.textContent).toBe('/aws/events/rules?bus=orders');
  const create = layout.findHeader()?.findButton('a')?.getElement();
  expect(create).toHaveAccessibleName('Create rule');
  expect(create).toHaveAttribute('href', '/aws/events/rules/create?bus=orders');
});

it.each([
  ['missing', true],
  ['arn:aws:events:us-east-1:123:event-bus/orders', false],
  ['', false],
])('explains an unchosen bus in both the field and the list position (%j)', async (name, described) => {
  vi.mocked(getEventBus).mockResolvedValueOnce({ kind: 'not-found' });
  const { layout, field, select } = renderPage(`?bus=${encodeURIComponent(name)}`);
  const message =
    name === ''
      ? 'The address names no event bus. Choose an event bus.'
      : `Event bus ${name} is not in your local emulator. Choose an event bus.`;
  await waitFor(() => expect(select.findTrigger().getElement().textContent).toBe(name || 'Choose an event bus'));
  expect(field.findError()?.getElement().textContent).toBe(message);
  const panels = layout.findContent().findAllContainers();
  expect(panels.at(-1)?.findContent().getElement().textContent).toBe(message);
  expect(listRules).not.toHaveBeenCalled();
  if (described) expect(getEventBus).toHaveBeenCalledExactlyOnceWith(endpoint, name, expect.any(AbortSignal));
  else expect(getEventBus).not.toHaveBeenCalled();
});

it('reports an unimplemented DescribeEventBus at the field and waits for Retry before listing rules', async () => {
  vi.mocked(getEventBus)
    .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DescribeEventBus' }))
    .mockResolvedValueOnce(returnedBus);
  const { page, select } = renderPage('?bus=orders');
  await waitFor(() =>
    expect(page.findStatusIndicator()?.getElement().textContent).toBe('Not implemented by the emulator'),
  );
  expect(page.findContainer()?.findContent().getElement()).toHaveTextContent('DescribeEventBus');
  expect(select.findTrigger().getElement().textContent).toBe('Choose an event bus');
  expect(listRules).not.toHaveBeenCalled();
  const retry = page.findContainer()?.findContent().findButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement().textContent).toBe('No rules'));
  expect(listRules).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', '', undefined, expect.any(AbortSignal));
  expect(getEventBus).toHaveBeenCalledTimes(2);
});
