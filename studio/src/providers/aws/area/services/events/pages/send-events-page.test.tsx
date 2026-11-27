import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { getEventBus, listEventBuses, type EventBusRead } from '../bus-api';
import { putEvent } from '../send-api';
import { SendEventsPage } from './send-events-page';

vi.mock('../bus-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../bus-api')>()),
  getEventBus: vi.fn(),
  listEventBuses: vi.fn(),
}));

vi.mock('../send-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../send-api')>()),
  putEvent: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8313';
const read = vi.mocked(getEventBus);
const send = vi.mocked(putEvent);

const detail = '{ "total": 8 }';
const event = { Source: 'shop', DetailType: 'order placed', Detail: detail };
const accepted = { kind: 'accepted', id: 'event-1' } as const;

function found(name: string): EventBusRead {
  return { kind: 'found', bus: { Name: name } };
}

beforeEach(() => {
  vi.resetAllMocks();
  read.mockImplementation(async (_endpoint, name) => found(name));
  send.mockResolvedValue(accepted);
  vi.mocked(listEventBuses).mockResolvedValue({ items: [{ Name: 'orders' }] });
});

function renderPage(query = '') {
  const resources = vi.fn();
  const show = vi.fn<(result: FlashResult) => void>();
  const { container } = render(
    <MemoryRouter initialEntries={['/aws/events/send-events' + query]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <PageFlashContext.Provider value={{ show, handOver: vi.fn() }}>
            <SendEventsPage connection={{ engineOrigin: endpoint, result: undefined }} />
          </PageFlashContext.Provider>
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const layout = createWrapper(container).findContentLayout();
  const form = layout?.findContent().findForm();
  const select = form?.findSelect();
  const button = form?.findActions()?.findButton();
  const [busField, sourceField, typeField, detailField] = form?.findAllFormFields() ?? [];
  const source = sourceField?.findInput()?.findNativeInput().getElement();
  const type = typeField?.findInput()?.findNativeInput().getElement();
  const text = detailField?.findTextarea()?.findNativeTextarea().getElement();
  if (
    !layout ||
    !form ||
    !select ||
    !button ||
    !busField ||
    !sourceField ||
    !typeField ||
    !detailField ||
    !source ||
    !type ||
    !text
  ) {
    throw new Error('Expected the send form and its four fields');
  }
  const fill = () => {
    fireEvent.change(source, { target: { value: event.Source } });
    fireEvent.change(type, { target: { value: event.DetailType } });
    fireEvent.change(text, { target: { value: event.Detail } });
  };
  function expectFilled() {
    expect(source).toHaveValue(event.Source);
    expect(type).toHaveValue(event.DetailType);
    expect(text).toHaveValue(event.Detail);
  }
  function errorRegion() {
    return form?.findError();
  }
  return {
    layout,
    form,
    select,
    button,
    busField,
    sourceField,
    typeField,
    detailField,
    source,
    type,
    text,
    resources,
    show,
    fill,
    expectFilled,
    errorRegion,
  };
}

function flashText(show: ReturnType<typeof renderPage>['show']) {
  const item = show.mock.lastCall?.[0][0];
  expect(item?.type).toBe('success');
  return render(<div>{item?.content}</div>).container.textContent;
}

it('opens with the addressed bus, an empty JSON object, the routing description and the notice word', async () => {
  const page = renderPage('?bus=orders');
  await waitFor(() => expect(page.select.findTrigger().getElement().textContent).toBe('orders'));
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
  expect(page.text).toHaveValue('{}');
  expect(page.layout.findHeader()?.findHeader()?.findDescription()?.getElement().textContent).toBe(
    "The bus's enabled rules whose pattern matches route the event to their targets. A target receives it only if it allows EventBridge to deliver. The event ID says the emulator accepted the event, not that a rule matched or a target received it.",
  );
  expect(page.resources).toHaveBeenCalledWith({ word: 'event buses' });
});

it('checks the bus again, sends the event, and flashes each accepted ID without clearing the form', async () => {
  const page = renderPage('?bus=orders');
  await waitFor(() => expect(page.select.findTrigger().getElement().textContent).toBe('orders'));
  read.mockClear();
  page.fill();
  page.button.click();

  await waitFor(() => expect(page.show).toHaveBeenCalledTimes(1));
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
  expect(send).toHaveBeenCalledExactlyOnceWith(endpoint, { ...event, EventBusName: 'orders' }, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledBefore(send);
  expect(flashText(page.show)).toBe('The emulator accepted the event for orders. Event ID event-1.');
  expect(page.select.findTrigger().getElement().textContent).toBe('orders');
  page.expectFilled();

  fireEvent.change(page.source, { target: { value: 'warehouse' } });
  send.mockResolvedValueOnce({ kind: 'accepted', id: 'event-2' });
  page.button.click();
  await waitFor(() => expect(page.show).toHaveBeenCalledTimes(2));
  expect(read).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(
    endpoint,
    { ...event, EventBusName: 'orders', Source: 'warehouse' },
    expect.any(AbortSignal),
  );
  expect(flashText(page.show)).toBe('The emulator accepted the event for orders. Event ID event-2.');
});

it('marks a bus deleted before send as missing and sends nothing', async () => {
  read.mockResolvedValueOnce(found('orders')).mockResolvedValueOnce({ kind: 'not-found' });
  const page = renderPage('?bus=orders');
  await waitFor(() => expect(page.select.findTrigger().getElement().textContent).toBe('orders'));
  page.fill();
  page.button.click();
  await waitFor(() =>
    expect(page.busField.findError()?.getElement().textContent).toBe(
      'Event bus orders is not in your local emulator. Choose an event bus.',
    ),
  );
  expect(read).toHaveBeenCalledTimes(2);
  expect(page.select.findTrigger().getElement().textContent).toBe('orders');
  expect(send).not.toHaveBeenCalled();
  expect(page.show).not.toHaveBeenCalled();
  page.expectFilled();
});

it.each(['DescribeEventBus', 'PutEvents'])(
  'shows a %s refusal above the actions and keeps the fields',
  async (operation) => {
    (operation === 'DescribeEventBus' ? read : send).mockRejectedValueOnce(
      new RequestError({ kind: 'other', operation, code: 'ValidationException', message: 'Refused by the emulator' }),
    );
    const page = renderPage();
    page.fill();
    page.button.click();
    await waitFor(() => expect(page.errorRegion()?.findAlert()?.getElement()).toBeVisible());
    const alert = page.errorRegion()?.findAlert();
    expect(alert?.findHeader()?.getElement().textContent).toBe(`${operation} failed`);
    expect(alert?.findContent().getElement().textContent).toBe('ValidationException: Refused by the emulator');
    expect(send).toHaveBeenCalledTimes(operation === 'DescribeEventBus' ? 0 : 1);
    expect(page.show).not.toHaveBeenCalled();
    page.expectFilled();
  },
);

it('shows the failed entry code and message without an acceptance flash', async () => {
  send.mockResolvedValueOnce({ kind: 'refused', code: 'MalformedDetail', message: 'Detail is malformed.' });
  const page = renderPage();
  page.fill();
  page.button.click();
  await waitFor(() =>
    expect(page.errorRegion()?.findAlert()?.findContent().getElement().textContent).toBe(
      'The emulator did not accept the event: MalformedDetail: Detail is malformed.',
    ),
  );
  expect(page.show).not.toHaveBeenCalled();
  page.expectFilled();
});

it.each(['DescribeEventBus', 'PutEvents'])(
  'shows %s returning 501 above the actions and keeps the fields',
  async (operation) => {
    (operation === 'DescribeEventBus' ? read : send).mockRejectedValueOnce(
      new RequestError({ kind: 'not-implemented', operation }),
    );
    const page = renderPage();
    page.fill();
    page.button.click();
    await waitFor(() =>
      expect(page.errorRegion()?.findAlert()?.findHeader()?.getElement().textContent).toBe(
        'Not implemented by the emulator',
      ),
    );
    expect(page.errorRegion()?.findAlert()?.findContent().getElement().textContent).toBe(
      `The emulator answered 501 Not Implemented for ${operation}.`,
    );
    expect(page.button.isDisabled()).toBe(operation === 'PutEvents');
    expect(send).toHaveBeenCalledTimes(operation === 'DescribeEventBus' ? 0 : 1);
    expect(page.show).not.toHaveBeenCalled();
    page.expectFilled();
  },
);

it('shows a 501 at the bus field when the address read fails and offers Retry', async () => {
  read.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DescribeEventBus' }));
  const page = renderPage('?bus=orders');
  await waitFor(() =>
    expect(page.busField.findStatusIndicator()?.getElement().textContent).toBe('Not implemented by the emulator'),
  );
  expect(page.busField.getElement()).toHaveTextContent('DescribeEventBus');
  expect(page.select.findTrigger().getElement().textContent).toBe('Choose an event bus');
  page.fill();
  page.button.click();
  expect(read).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  expect(page.show).not.toHaveBeenCalled();

  const retry = page.busField.findButton('button:not([aria-haspopup])');
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  await waitFor(() => expect(page.select.findTrigger().getElement().textContent).toBe('orders'));
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  ['missing', 1],
  ['arn:aws:events:us-east-1:123:event-bus/orders', 0],
  ['', 0],
])('rejects the unchosen bus from ?bus=%j before sending', async (name, reads) => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  const page = renderPage(`?bus=${encodeURIComponent(name)}`);
  const error = name
    ? `Event bus ${name} is not in your local emulator. Choose an event bus.`
    : 'The address names no event bus. Choose an event bus.';
  await waitFor(() => expect(page.busField.findError()?.getElement().textContent).toBe(error));
  page.fill();
  page.button.click();
  expect(read).toHaveBeenCalledTimes(reads);
  expect(send).not.toHaveBeenCalled();
  expect(page.show).not.toHaveBeenCalled();
});

it('shows field rules before calling DescribeEventBus or PutEvents', () => {
  const page = renderPage();
  fireEvent.change(page.source, { target: { value: 'aws.shop' } });
  fireEvent.change(page.text, { target: { value: '[]' } });
  page.button.click();
  expect(page.sourceField.findError()?.getElement().textContent).toBe('The source cannot start with aws.');
  expect(page.typeField.findError()?.getElement().textContent).toBe('Enter a detail type.');
  expect(page.detailField.findError()?.getElement().textContent).toBe('Enter a JSON object.');
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(page.show).not.toHaveBeenCalled();
});

it('uses the bus chosen from the list instead of an invalid address', async () => {
  const page = renderPage('?bus=');
  page.select.openDropdown();
  await waitFor(() =>
    expect(page.select.findDropdown().findOption(1)?.findLabel().getElement().textContent).toBe('orders'),
  );
  page.select.selectOptionByValue('orders');
  expect(page.busField.findError()).toBeNull();
  expect(read).not.toHaveBeenCalled();
  page.fill();
  page.button.click();
  await waitFor(() => expect(page.show).toHaveBeenCalledTimes(1));
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, 'orders', expect.any(AbortSignal));
  expect(send).toHaveBeenCalledExactlyOnceWith(endpoint, { ...event, EventBusName: 'orders' }, expect.any(AbortSignal));
});

it('keeps Send busy through both requests and ignores repeat presses', async () => {
  const bus = Promise.withResolvers<EventBusRead>();
  const outcome = Promise.withResolvers<Awaited<ReturnType<typeof putEvent>>>();
  read.mockReturnValueOnce(bus.promise);
  send.mockReturnValueOnce(outcome.promise);
  const page = renderPage();
  page.fill();
  page.button.click();
  expect(page.button.findLoadingIndicator()).not.toBeNull();
  page.button.click();
  expect(read).toHaveBeenCalledExactlyOnceWith(endpoint, 'default', expect.any(AbortSignal));
  expect(send).not.toHaveBeenCalled();

  await act(async () => bus.resolve(found('default')));
  expect(page.button.findLoadingIndicator()).not.toBeNull();
  page.button.click();
  expect(read).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(page.show).not.toHaveBeenCalled();

  await act(async () => outcome.resolve(accepted));
  expect(page.show).toHaveBeenCalledTimes(1);
  expect(page.button.findLoadingIndicator()).toBeNull();
});
