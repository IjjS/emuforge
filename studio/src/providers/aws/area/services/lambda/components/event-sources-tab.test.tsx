import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import { useEventSources } from '../event-source-queries';
import { EventSourcesTab } from './event-sources-tab';

const SOURCE_ARN = 'arn:aws:sqs:us-east-1:000000000000:orders';
const OTHER_SOURCE_ARN = 'arn:aws:kinesis:us-east-1:000000000000:stream/other';
const ROLE_HINT = 'Check the function execution role’s permissions for this source.';
const MAPPING = { UUID: 'mapping-id', EventSourceArn: SOURCE_ARN, State: 'Enabled' };
const PATH = '/2015-03-31/event-source-mappings';
const calls: { method: string; path: string; body: unknown }[] = [];
let endpoint: string;
let nextPort = 9600;
let list: () => Response;
let write: (method: string) => Response | Promise<Response>;

function holdWrite() {
  let respond!: (answer: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  write = () => pending;
  return respond;
}

function refusal(message: string, status = 400, code = 'InvalidParameterValueException') {
  return Response.json({ message }, { status, headers: { 'x-amzn-errortype': code } });
}

function mappings(...items: object[]) {
  return Response.json({ EventSourceMappings: items });
}

beforeEach(() => {
  calls.length = 0;
  endpoint = engineEndpoint(++nextPort);
  list = () => mappings(MAPPING);
  write = () => refusal('The mapping request was refused.');
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return Response.json({ token: 'event-source-test-session' });
    }
    const body = request.body === null ? undefined : await request.json();
    calls.push({ method: request.method, path: url.pathname, body });
    return request.method === 'GET' ? list() : write(request.method);
  });
});

afterEach(() => vi.unstubAllGlobals());

function Page() {
  const root = useRef<HTMLDivElement>(null);
  const [messages, show] = useState<FlashResult>();
  const [createArn, setCreateArn] = useState('');
  const connection: AreaConnection = { engineOrigin: endpoint, result: undefined };
  const sources = useEventSources({ endpoint, name: 'orders', scope: 'test-scope', active: true });
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={{ show, handOver: () => undefined }}>
        <div ref={root}>
          <div style={{ position: 'sticky' }}>
            <nav aria-label="Breadcrumbs" />
          </div>
          <Flashbar items={messages ?? []} />
          <EventSourcesTab
            name="orders"
            sources={sources}
            connection={connection}
            ready
            createArn={createArn}
            onCreateArnChange={setCreateArn}
          />
        </div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

function open() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const wrapper = createWrapper(document.body);
const actionIndex = { Refresh: 0, Disable: 1, Enable: 1, Delete: 2, 'Add event source': 3 };

function required<T>(value: T | null | undefined): T {
  if (value == null) {
    throw new Error('Expected the Cloudscape element');
  }
  return value;
}

function button(name: keyof typeof actionIndex) {
  const actions = wrapper.findTable()?.findHeaderSlot()?.findHeader()?.findActions();
  const element = required(actions?.findAllButtons()[actionIndex[name]]).getElement();
  expect(element).toHaveAccessibleName(name);
  return element;
}

function refresh() {
  return button('Refresh');
}

function row(index = 0) {
  return required(wrapper.findTable()?.findRows()[index]);
}

function emptyList() {
  return wrapper.findTable()?.findEmptySlot()?.getElement();
}

function flash() {
  return required(wrapper.findFlashbar()?.findItems()[0]);
}

function flashContent() {
  return flash().findContent()?.getElement();
}

async function select() {
  const radio = await waitFor(() =>
    required(wrapper.findTable()?.findRowSelectionArea(1)?.find('input[type="radio"]')).getElement(),
  );
  expect(radio.getAttribute('aria-label')).toContain(SOURCE_ARN);
  fireEvent.click(radio);
  return radio;
}

async function openDialog(name: 'Add event source' | 'Delete', title: string = name) {
  const opener = button(name);
  opener.focus();
  fireEvent.click(opener);
  const dialog = await waitFor(() => required(wrapper.findModal()));
  expect(dialog.findHeader().getElement()).toHaveTextContent(title);
  return dialog;
}

async function add(arn?: string) {
  const dialog = await openDialog('Add event source');
  const field = required(dialog.findContent().findFormField());
  expect(field.findLabel()?.getElement()).toHaveTextContent('Event source ARN');
  const input = required(field.findControl()?.findInput()).findNativeInput().getElement();
  if (arn !== undefined) {
    fireEvent.change(input, { target: { value: arn } });
  }
  const submit = required(dialog.findFooter()?.findAllButtons()[1]).getElement();
  expect(submit).toHaveAccessibleName('Add event source');
  return { dialog, field, input, submit: () => fireEvent.click(submit) };
}

async function confirmDelete() {
  await select();
  const dialog = await openDialog('Delete', 'Delete event source mapping?');
  const buttons = required(dialog.findFooter()).findAllButtons();
  const cancel = required(buttons[0]).getElement();
  const confirm = required(buttons[1]).getElement();
  expect(cancel).toHaveAccessibleName('Cancel');
  expect(confirm).toHaveAccessibleName('Delete');
  return { cancel, confirm };
}

it('U1: shows an absent result and preserves a reported result in its own row', async () => {
  list = () =>
    mappings(MAPPING, {
      UUID: 'other-id',
      EventSourceArn: OTHER_SOURCE_ARN,
      State: 'Enabled',
      LastProcessingResult: 'No records processed',
    });
  open();
  const first = await waitFor(() => row().getElement());
  const second = row(1).getElement();
  expect(first).toBeVisible();
  expect(first).toHaveTextContent(SOURCE_ARN);
  expect(first).toHaveTextContent('Not reported');
  expect(second).toBeVisible();
  expect(second).toHaveTextContent(OTHER_SOURCE_ARN);
  expect(second).toHaveTextContent('No records processed');
});

it('keeps the full ARN, selection, state and processing result together in a narrow row', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  list = () => mappings({ ...MAPPING, LastProcessingResult: 'No records processed' });
  open();

  const mapping = await waitFor(() => row());
  expect(mapping.getElement()).toHaveTextContent(SOURCE_ARN);
  const pairs = required(mapping.findKeyValuePairs()).findItems();
  const state = required(pairs[0]);
  const result = required(pairs[1]);
  expect(state.findLabel()?.getElement()).toHaveTextContent('State');
  expect(state.findValue()?.getElement()).toHaveTextContent('Enabled');
  expect(result.findLabel()?.getElement()).toHaveTextContent('Last processing result');
  expect(result.findValue()?.getElement()).toHaveTextContent('No records processed');
  const copy = required(mapping.findCopyToClipboard()).findCopyButton().getElement();
  expect(copy).toHaveAccessibleName('Copy Source ARN');
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(SOURCE_ARN));

  expect(await select()).toBeChecked();
  expect(button('Disable')).toBeEnabled();
});

it('U2: shows a list refusal and refreshes successfully', async () => {
  list = () => refusal('The list could not be read.');
  open();
  await waitFor(() => expect(emptyList()).toHaveTextContent('The list could not be read.'));
  expect(refresh()).toBeEnabled();
  list = () => mappings(MAPPING);
  fireEvent.click(refresh());
  await waitFor(() => expect(row().getElement()).toHaveTextContent(SOURCE_ARN));
  expect(emptyList()).toBeUndefined();
  expect(calls).toHaveLength(2);
});

it('U3: leaves list Refresh visible and disabled when the list is unsupported', async () => {
  list = () => refusal('Not supported', 501);
  open();
  await waitFor(() => expect(emptyList()).toHaveTextContent('Not implemented by the emulator'));
  expect(emptyList()).toHaveTextContent('ListEventSourceMappings');
  expect(refresh()).toBeDisabled();
  fireEvent.click(refresh());
  expect(calls).toHaveLength(1);
});

it('U4: keeps an unsupported ARN editable and does not submit it', async () => {
  open();
  const { field, input, submit } = await add('arn:aws:sns:us-east-1:000000000000:orders');
  submit();
  expect(field.findError()?.getElement()).toHaveTextContent('Use a supported event source ARN.');
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: SOURCE_ARN } });
  expect(input).toHaveValue(SOURCE_ARN);
  expect(calls.filter(({ method }) => method === 'POST')).toEqual([]);
});

it('U5: reports a creation refusal unrelated to the execution role', async () => {
  open();
  const { submit } = await add(SOURCE_ARN);
  submit();
  await waitFor(() => expect(flashContent()).toHaveTextContent('The mapping request was refused.'));
  expect(flashContent()).toHaveTextContent('InvalidParameterValueException');
  expect(flashContent()).not.toHaveTextContent(ROLE_HINT);
  expect(calls).toContainEqual({
    method: 'POST',
    path: PATH,
    body: { FunctionName: 'orders', EventSourceArn: SOURCE_ARN },
  });
});

it('keeps the ARN read-only and focused during Enter submission, then restores the Add button', async () => {
  const respond = holdWrite();
  const user = userEvent.setup();
  open();
  const { input } = await add(SOURCE_ARN);
  input.focus();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(input).toHaveAttribute('readonly'));
  expect(input).toBeEnabled();
  expect(input).toHaveFocus();
  await user.keyboard('{Enter}{Enter}x');
  expect(input).toHaveFocus();
  expect(input).toHaveValue(SOURCE_ARN);
  await waitFor(() => expect(calls.filter(({ method }) => method === 'POST')).toHaveLength(1));

  respond(Response.json(MAPPING, { status: 202 }));
  await waitFor(() => expect(flashContent()).toHaveTextContent(`Added the event source mapping for ${SOURCE_ARN}.`));
  expect(wrapper.findModal()).toBeNull();
  await waitFor(() => expect(button('Add event source')).toHaveFocus());
  expect(calls.filter(({ method }) => method === 'POST')).toHaveLength(1);
});

it('prefills the refused ARN for retry and clears it after a successful create', async () => {
  open();
  (await add(SOURCE_ARN)).submit();
  await waitFor(() => expect(flashContent()).toHaveTextContent('The mapping request was refused.'));

  const retry = await add();
  expect(retry.input).toHaveValue(SOURCE_ARN);
  write = () => Response.json(MAPPING, { status: 202 });
  retry.submit();
  await waitFor(() => expect(flashContent()).toHaveTextContent(`Added the event source mapping for ${SOURCE_ARN}.`));
  expect(calls.filter(({ method }) => method === 'POST').map(({ body }) => body)).toEqual([
    { FunctionName: 'orders', EventSourceArn: SOURCE_ARN },
    { FunctionName: 'orders', EventSourceArn: SOURCE_ARN },
  ]);
  expect((await add()).input).toHaveValue('');
});

it('U6: shows a state change refusal and keeps the last state read from the list', async () => {
  open();
  await select();
  fireEvent.click(button('Disable'));
  await waitFor(() => expect(flashContent()).toHaveTextContent('The mapping request was refused.'));
  expect(row().getElement()).toHaveTextContent('Enabled');
  expect(calls).toContainEqual({ method: 'PUT', path: `${PATH}/mapping-id`, body: { Enabled: false } });
});

it('U7: keeps the row and sends no delete when the confirmation is canceled', async () => {
  open();
  const { cancel } = await confirmDelete();
  fireEvent.click(cancel);
  expect(wrapper.findModal()).toBeNull();
  expect(row().getElement()).toHaveTextContent(SOURCE_ARN);
  expect(button('Delete')).toHaveFocus();
  expect(calls.filter(({ method }) => method === 'DELETE')).toEqual([]);
});

it('U8: shows a delete refusal and keeps the row', async () => {
  open();
  const { confirm } = await confirmDelete();
  fireEvent.click(confirm);
  await waitFor(() => expect(flashContent()).toHaveTextContent('The mapping request was refused.'));
  expect(row().getElement()).toHaveTextContent(SOURCE_ARN);
  expect(calls).toContainEqual({ method: 'DELETE', path: `${PATH}/mapping-id`, body: undefined });
});

it('U9: leaves Add event source visible and disabled when creation is unsupported', async () => {
  write = () => refusal('Not supported', 501);
  open();
  await waitFor(() => row());
  const { submit } = await add(SOURCE_ARN);
  submit();
  await waitFor(() => expect(flash().findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator'));
  expect(flashContent()).toHaveTextContent('CreateEventSourceMapping');
  expect(button('Add event source')).toBeDisabled();
  await waitFor(() => expect(refresh()).toHaveFocus());
});

it('U10: disables both update directions and moves focus when a keyboard update is unsupported', async () => {
  const respond = holdWrite();
  const user = userEvent.setup();
  open();
  await select();
  const disable = button('Disable');
  disable.focus();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(disable).toHaveAttribute('aria-disabled', 'true'));
  expect(disable).toHaveFocus();
  respond(refusal('Not supported', 501));

  await waitFor(() => expect(flash().findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator'));
  expect(flashContent()).toHaveTextContent('UpdateEventSourceMapping');
  expect(disable).toBeDisabled();
  await waitFor(() => expect(button('Add event source')).toHaveFocus());
  list = () => mappings({ ...MAPPING, State: 'Disabled' });
  fireEvent.click(refresh());
  await waitFor(() => expect(button('Enable')).toBeDisabled());
});

it('leaves focus where the user moved it while waiting for an unsupported keyboard update', async () => {
  const respond = holdWrite();
  const user = userEvent.setup();
  list = () => mappings({ ...MAPPING, State: 'Disabled' });
  open();
  await select();
  const enable = button('Enable');
  enable.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(enable).toHaveAttribute('aria-disabled', 'true'));
  expect(enable).toHaveFocus();

  await user.tab({ shift: true });
  expect(refresh()).toHaveFocus();
  respond(refusal('Not supported', 501));

  await waitFor(() => expect(enable).toBeDisabled());
  expect(flashContent()).toHaveTextContent('UpdateEventSourceMapping');
  expect(refresh()).toHaveFocus();
});

it('reveals the focused mapping Refresh below a sticky breadcrumb after a narrow Disable refusal', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const scrollBy = vi.fn();
  vi.stubGlobal('scrollBy', scrollBy);
  const respond = holdWrite();
  const user = userEvent.setup();
  open();
  const breadcrumbs = required(wrapper.find('nav[aria-label="Breadcrumbs"]')).getElement();
  const stickyRow = required(breadcrumbs.parentElement);
  vi.spyOn(stickyRow, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 56, 390, 40));

  await select();
  const disable = button('Disable');
  disable.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(disable).toHaveAttribute('aria-disabled', 'true'));
  await user.tab({ shift: true });
  const focusedRefresh = refresh();
  expect(focusedRefresh).toHaveFocus();
  focusedRefresh.style.setProperty('--space-static-xs-b6kz15', '8px');
  vi.spyOn(focusedRefresh, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 83, 40, 32));
  expect(scrollBy).not.toHaveBeenCalled();

  respond(refusal('Not supported', 501));
  await waitFor(() => expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -21, behavior: 'instant' }));
  expect(focusedRefresh).toHaveFocus();
  expect(disable).toBeDisabled();
  expect(flashContent()).toHaveTextContent('UpdateEventSourceMapping');
});

it('U11: leaves Delete visible and disabled when deletion is unsupported', async () => {
  write = () => refusal('Not supported', 501);
  open();
  const { confirm } = await confirmDelete();
  fireEvent.click(confirm);
  await waitFor(() => expect(flash().findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator'));
  expect(flashContent()).toHaveTextContent('DeleteEventSourceMapping');
  expect(button('Delete')).toBeDisabled();
  await waitFor(() => expect(button('Add event source')).toHaveFocus());
});

it.each([
  {
    id: 'U12',
    service: 'DynamoDB',
    arn: 'arn:aws:dynamodb:us-east-1:000000000000:table/probe/stream/2026-11-22T16:43:19.257',
    permissionHelp: 'the GetRecords, GetShardIterator, DescribeStream, and ListStreams Actions on your stream in IAM.',
  },
  {
    id: 'U13',
    service: 'Kinesis',
    arn: 'arn:aws:kinesis:us-east-1:000000000000:stream/probe',
    permissionHelp:
      'the GetRecords, GetShardIterator, DescribeStream, DescribeStreamSummary, ListShards, and ListStreams Actions on your stream.',
  },
])('$id: shows the full $service stream refusal and the execution role hint', async ({ arn, permissionHelp }) => {
  const message = `Cannot access stream ${arn}. Please ensure the role can perform ${permissionHelp}`;
  write = () => refusal(message);
  open();
  const { dialog, submit } = await add(arn);
  const startingPosition = required(dialog.findContent().findAllFormFields()[1]);
  expect(startingPosition.findLabel()?.getElement()).toHaveTextContent('Starting position');
  expect(startingPosition.findControl()?.getElement()).toHaveTextContent('LATEST');
  submit();
  await waitFor(() => expect(flashContent()).toHaveTextContent(ROLE_HINT));
  expect(flashContent()).toHaveTextContent('InvalidParameterValueException');
  expect(flashContent()).toHaveTextContent(message);
  expect(calls).toContainEqual({
    method: 'POST',
    path: PATH,
    body: { FunctionName: 'orders', EventSourceArn: arn, StartingPosition: 'LATEST' },
  });
});
