import Flashbar from '@cloudscape-design/components/flashbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
let write: (method: string) => Response;

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

function button(name: string) {
  return screen.getByRole('button', { name });
}

function refresh() {
  return button('Refresh');
}

async function select() {
  const radio = await screen.findByRole('radio', { name: (name) => name.endsWith(SOURCE_ARN) });
  fireEvent.click(radio);
}

async function add(arn?: string) {
  fireEvent.click(button('Add event source'));
  const dialog = await screen.findByRole('dialog', { name: 'Add event source' });
  const input = within(dialog).getByRole('textbox', { name: 'Event source ARN' });
  if (arn !== undefined) {
    fireEvent.change(input, { target: { value: arn } });
  }
  return {
    dialog,
    input,
    submit: () => fireEvent.click(within(dialog).getByRole('button', { name: 'Add event source' })),
  };
}

async function confirmDelete() {
  await select();
  fireEvent.click(button('Delete'));
  return within(await screen.findByRole('dialog', { name: 'Delete event source mapping?' }));
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
  const first = await screen.findByRole('row', { name: /orders/ });
  const second = await screen.findByRole('row', { name: /stream\/other/ });
  expect(within(first).getByText('Not reported')).toBeVisible();
  expect(within(second).getByText('No records processed')).toBeVisible();
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

  const row = await screen.findByRole('row', { name: /orders/ });
  expect(row).toHaveTextContent(SOURCE_ARN);
  expect(within(row).getByText('State')).toBeVisible();
  expect(within(row).getByText('Enabled')).toBeVisible();
  expect(within(row).getByText('Last processing result')).toBeVisible();
  expect(within(row).getByText('No records processed')).toBeVisible();
  fireEvent.click(within(row).getByRole('button', { name: 'Copy Source ARN' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(SOURCE_ARN));

  const radio = within(row).getByRole('radio');
  fireEvent.click(radio);
  expect(radio).toBeChecked();
  expect(button('Disable')).toBeEnabled();
});

it('U2: shows a list refusal and refreshes successfully', async () => {
  list = () => refusal('The list could not be read.');
  open();
  expect(await screen.findByText(/The list could not be read/)).toBeVisible();
  expect(refresh()).toBeEnabled();
  list = () => mappings(MAPPING);
  fireEvent.click(refresh());
  expect(await screen.findByRole('row', { name: /orders/ })).toBeVisible();
  expect(screen.queryByText(/The list could not be read/)).not.toBeInTheDocument();
  expect(calls).toHaveLength(2);
});

it('U3: leaves list Refresh visible and disabled when the list is unsupported', async () => {
  list = () => refusal('Not supported', 501);
  open();
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/ListEventSourceMappings/)).toBeVisible();
  expect(refresh()).toBeDisabled();
  fireEvent.click(refresh());
  expect(calls).toHaveLength(1);
});

it('U4: keeps an unsupported ARN editable and does not submit it', async () => {
  open();
  const { dialog, input, submit } = await add('arn:aws:sns:us-east-1:000000000000:orders');
  submit();
  expect(within(dialog).getByText('Use a supported event source ARN.')).toBeVisible();
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: SOURCE_ARN } });
  expect(input).toHaveValue(SOURCE_ARN);
  expect(calls.filter(({ method }) => method === 'POST')).toEqual([]);
});

it('U5: reports a creation refusal unrelated to the execution role', async () => {
  open();
  const { submit } = await add(SOURCE_ARN);
  submit();
  expect(await screen.findByText(/The mapping request was refused/)).toBeVisible();
  expect(screen.getByText('InvalidParameterValueException')).toBeVisible();
  expect(screen.queryByText(ROLE_HINT)).not.toBeInTheDocument();
  expect(calls).toContainEqual({
    method: 'POST',
    path: PATH,
    body: { FunctionName: 'orders', EventSourceArn: SOURCE_ARN },
  });
});

it('prefills the refused ARN for retry and clears it after a successful create', async () => {
  open();
  (await add(SOURCE_ARN)).submit();
  expect(await screen.findByText(/The mapping request was refused/)).toBeVisible();

  const retry = await add();
  expect(retry.input).toHaveValue(SOURCE_ARN);
  write = () => Response.json(MAPPING, { status: 202 });
  retry.submit();
  expect(await screen.findByText(/Added the event source mapping/)).toBeVisible();
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
  expect(await screen.findByText(/The mapping request was refused/)).toBeVisible();
  expect(screen.getByText('Enabled')).toBeVisible();
  expect(calls).toContainEqual({ method: 'PUT', path: `${PATH}/mapping-id`, body: { Enabled: false } });
});

it('U7: keeps the row and sends no delete when the confirmation is canceled', async () => {
  open();
  const dialog = await confirmDelete();
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('row', { name: /orders/ })).toBeVisible();
  expect(calls.filter(({ method }) => method === 'DELETE')).toEqual([]);
});

it('U8: shows a delete refusal and keeps the row', async () => {
  open();
  const dialog = await confirmDelete();
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText(/The mapping request was refused/)).toBeVisible();
  expect(screen.getByRole('row', { name: /orders/ })).toBeVisible();
  expect(calls).toContainEqual({ method: 'DELETE', path: `${PATH}/mapping-id`, body: undefined });
});

it('U9: leaves Add event source visible and disabled when creation is unsupported', async () => {
  write = () => refusal('Not supported', 501);
  open();
  const { submit } = await add(SOURCE_ARN);
  submit();
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/CreateEventSourceMapping/)).toBeVisible();
  expect(button('Add event source')).toBeDisabled();
});

it('U10: disables both directions of a state change after an unsupported update', async () => {
  write = () => refusal('Not supported', 501);
  open();
  await select();
  fireEvent.click(button('Disable'));
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/UpdateEventSourceMapping/)).toBeVisible();
  expect(button('Disable')).toBeDisabled();
  list = () => mappings({ ...MAPPING, State: 'Disabled' });
  fireEvent.click(refresh());
  expect(await screen.findByRole('button', { name: 'Enable' })).toBeDisabled();
});

it('U11: leaves Delete visible and disabled when deletion is unsupported', async () => {
  write = () => refusal('Not supported', 501);
  open();
  const dialog = await confirmDelete();
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/DeleteEventSourceMapping/)).toBeVisible();
  expect(button('Delete')).toBeDisabled();
});

it.each([
  {
    id: 'U12',
    service: 'DynamoDB',
    arn: 'arn:aws:dynamodb:us-east-1:000000000000:table/probe/stream/2026-11-22T16:43:19.257',
    required: 'the GetRecords, GetShardIterator, DescribeStream, and ListStreams Actions on your stream in IAM.',
  },
  {
    id: 'U13',
    service: 'Kinesis',
    arn: 'arn:aws:kinesis:us-east-1:000000000000:stream/probe',
    required:
      'the GetRecords, GetShardIterator, DescribeStream, DescribeStreamSummary, ListShards, and ListStreams Actions on your stream.',
  },
])('$id: shows the full $service stream refusal and the execution role hint', async ({ arn, required }) => {
  const message = `Cannot access stream ${arn}. Please ensure the role can perform ${required}`;
  write = () => refusal(message);
  open();
  const { dialog, submit } = await add(arn);
  expect(within(dialog).getByText('LATEST')).toBeVisible();
  submit();
  expect(await screen.findByText(ROLE_HINT)).toBeVisible();
  expect(screen.getByText('InvalidParameterValueException')).toBeVisible();
  expect(screen.getByText(`: ${message}`)).toBeVisible();
  expect(calls).toContainEqual({
    method: 'POST',
    path: PATH,
    body: { FunctionName: 'orders', EventSourceArn: arn, StartingPosition: 'LATEST' },
  });
});
