import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import { bucketPropertiesPath, createEventNotificationPath, editEventNotificationPath } from '../format';

const BUCKET = 'alpha';
const CREATE = createEventNotificationPath(BUCKET);
const PROPERTIES = bucketPropertiesPath(BUCKET);
const QUEUE = 'arn:aws:sqs:us-east-1:000000000000:jobs';
const FUNCTION = 'arn:aws:lambda:us-east-1:000000000000:function:consumer';
const EMPTY = '<NotificationConfiguration/>';
const SAVED_RULE = `<QueueConfiguration><Id>saved</Id><Queue>${QUEUE}</Queue>
  <Event>s3:ObjectCreated:Copy</Event><Event>s3:ObjectCreated:Put</Event>
  <Filter><S3Key><FilterRule><Name>Prefix</Name><Value>logs/</Value></FilterRule>
  <FilterRule><Name>Suffix</Name><Value>.txt</Value></FilterRule></S3Key></Filter>
</QueueConfiguration>`;
const TOPIC =
  '<TopicConfiguration><Id>topic</Id><Topic>arn:aws:sns:us-east-1:000000000000:topic</Topic><Event>s3:ObjectCreated:*</Event></TopicConfiguration>';
const documentOf = (rules: string) => `<NotificationConfiguration>${rules}</NotificationConfiguration>`;
const response = (body = EMPTY) => new Response(body, { status: 200 });
const refusal = (status: number, code: string, message: string) =>
  new Response(`<Error><Code>${code}</Code><Message>${message}</Message></Error>`, { status });

function heldResponse() {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

function connected(target: string): AreaConnection['result'] {
  return { kind: 'connected', checkedAt: 0, emulator: { port: 9305, endpoint: 'https://127.0.0.1:9305' }, target };
}

class FakeEngine {
  reads: Request[] = [];
  writes: string[] = [];
  document = EMPTY;
  read = (): Response | Promise<Response> => response(this.document);
  write = (body: string): Response => {
    this.document = body;
    return new Response(null, { status: 204 });
  };

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') return Response.json({ token: 'notification-test' });
    if (url.searchParams.has('notification')) {
      if (request.method === 'PUT') {
        const body = await request.text();
        this.writes.push(body);
        return this.write(body);
      }
      this.reads.push(request);
      return this.read();
    }
    if (url.searchParams.get('x-id') === 'ListBuckets') {
      return response(
        '<ListAllMyBucketsResult><Buckets><Bucket><Name>alpha</Name></Bucket></Buckets></ListAllMyBucketsResult>',
      );
    }
    return response('<Empty/>');
  };
}

let engine: FakeEngine;
let nextPort = 8800;
let connection: AreaConnection;
let targetGeneration = 0;
let listener: (() => void) | undefined;

function Area() {
  const { pathname } = useLocation();
  const [visit, setVisit] = useState({ pathname, changes: 0 });
  const changes = visit.pathname === pathname ? visit.changes : visit.changes + 1;
  if (visit.pathname !== pathname) setVisit({ pathname, changes });
  const current = useSyncExternalStore(
    (update) => {
      listener = update;
      return () => {
        listener = undefined;
      };
    },
    () => connection,
  );
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      connection={current}
      routeChanges={changes}
      targetGeneration={targetGeneration}
    />
  );
}

function setConnection(result: AreaConnection['result']) {
  act(() => {
    const previous = connection.result;
    if (
      previous?.kind === 'connected' &&
      result?.kind === 'connected' &&
      previous.target !== undefined &&
      previous.target !== result.target
    )
      targetGeneration += 1;
    connection = { ...connection, result };
    listener?.();
  });
}

function open(path = CREATE) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <h1>Home</h1> },
      { path: '/aws/*', element: <Area /> },
    ],
    { initialEntries: [path] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  engine = new FakeEngine();
  targetGeneration = 0;
  connection = { engineOrigin: engineEndpoint(++nextPort), result: connected('first') };
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const nameField = () => screen.getByRole('textbox', { name: 'Notification name' });
const arnField = () => screen.getByRole('textbox', { name: 'Destination ARN' });
const createButton = () => screen.getByRole('button', { name: 'Create event notification' });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });
const changeValue = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const fill = (arn = QUEUE, id = 'new') => {
  changeValue(nameField(), id);
  changeValue(arnField(), arn);
};
const loaded = () => screen.findByRole('textbox', { name: 'Notification name' });

it('creates an empty draft and preloads every field and all saved events for direct edit', async () => {
  engine.document = documentOf(SAVED_RULE);
  const router = open();
  expect(await loaded()).toHaveValue('');
  expect(arnField()).toHaveValue('');
  expect(screen.getByRole('radio', { name: 'All object creation events' })).toBeChecked();
  await act(() => router.navigate(editEventNotificationPath(BUCKET, 'saved')));
  expect(await loaded()).toHaveValue('saved');
  expect(nameField()).toHaveAttribute('readonly');
  expect(arnField()).toHaveValue(QUEUE);
  expect(screen.getByRole('button', { name: 'Copy saved destination ARN' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Prefix (optional)' })).toHaveValue('logs/');
  expect(screen.getByRole('textbox', { name: 'Suffix (optional)' })).toHaveValue('.txt');
  expect(screen.getByRole('radio', { name: 'Keep existing events' })).toBeChecked();
  expect(screen.getByText('s3:ObjectCreated:Copy, s3:ObjectCreated:Put')).toBeVisible();
  fireEvent.click(cancelButton());
  await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
  expect(engine.writes).toEqual([]);
});

it.each([
  ['absent', 'The notification was not found.', SAVED_RULE],
  ['topic', 'Only queue and function notifications can be edited.', TOPIC],
  ['saved', 'More than one notification has this name.', SAVED_RULE + TOPIC.replace('>topic</Id>', '>saved</Id>')],
])('refuses direct edit of %s when no unique eligible rule exists', async (id, reason, rules) => {
  engine.document = documentOf(rules);
  open(editEventNotificationPath(BUCKET, id));
  expect(await screen.findByText(reason)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Return to Properties' })).toHaveAttribute('href', PROPERTIES);
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  expect(engine.writes).toEqual([]);
});

it('marks missing names and ARNs, conflicting IDs and malformed or mismatched destinations before any write', async () => {
  engine.document = documentOf(SAVED_RULE);
  open();
  await loaded();
  fireEvent.click(createButton());
  expect(screen.getByText('Enter a notification name.')).toBeVisible();
  expect(screen.getByText('Enter a destination ARN.')).toBeVisible();
  expect(nameField()).toHaveFocus();
  fill('not-an-arn', 'saved');
  fireEvent.click(createButton());
  expect(screen.getByText('A notification with this name already exists.')).toBeVisible();
  expect(screen.getByText('Enter a valid standard SQS queue ARN.')).toBeVisible();
  fill(FUNCTION);
  fireEvent.click(createButton());
  expect(screen.getByText('Enter a valid standard SQS queue ARN.')).toBeVisible();
  expect(arnField()).toHaveFocus();
  expect(engine.reads).toHaveLength(1);
  expect(engine.writes).toEqual([]);
});

it.each([
  ['SQS queue', QUEUE, 'Object PUTs', 's3:ObjectCreated:Put'],
  ['Lambda function', FUNCTION, 'All object creation events', 's3:ObjectCreated:*'],
])('submits one %s save while pending and serializes the event and filters', async (type, arn, label, event) => {
  const hold = heldResponse();
  const router = open();
  await loaded();
  engine.read = () => (engine.writes.length === 0 ? hold.promise : response(engine.document));
  fireEvent.click(screen.getByRole('radio', { name: type }));
  fill(arn);
  fireEvent.click(screen.getByRole('radio', { name: label }));
  changeValue(screen.getByRole('textbox', { name: 'Prefix (optional)' }), 'logs/');
  changeValue(screen.getByRole('textbox', { name: 'Suffix (optional)' }), '.txt');
  fireEvent.click(createButton());
  expect(createButton()).toBeDisabled();
  fireEvent.click(createButton());
  hold.resolve(response());
  await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
  expect(engine.writes).toHaveLength(1);
  expect(engine.writes[0]).toContain(`<Event>${event}</Event>`);
  expect(engine.writes[0]).toContain(arn);
  expect(engine.writes[0]).toContain('<Name>prefix</Name><Value>logs/</Value>');
  expect(engine.writes[0]).toContain('<Name>suffix</Name><Value>.txt</Value>');
});

it.each(['clean', 'restored', 'discarded'])('cancels a %s create without writing', async (mode) => {
  const router = open();
  await loaded();
  if (mode !== 'clean') changeValue(nameField(), 'draft');
  if (mode === 'restored') changeValue(nameField(), '');
  fireEvent.click(cancelButton());
  if (mode === 'discarded') {
    const dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    expect(within(dialog).getByText('What you entered on this page is not kept.')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
  }
  await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
  expect(engine.writes).toEqual([]);
});

it.each(['Keep editing', 'Escape', 'Close'])('%s restores the draft and Cancel focus', async (answer) => {
  open();
  await loaded();
  fill();
  cancelButton().focus();
  fireEvent.click(cancelButton());
  const dialog = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
  if (answer === 'Escape') {
    const keepEditing = within(dialog).getByRole('button', { name: 'Keep editing' });
    keepEditing.focus();
    fireEvent.keyDown(keepEditing, { key: 'Escape', code: 'Escape', keyCode: 27 });
  } else {
    fireEvent.click(within(dialog).getByRole('button', { name: answer }));
  }
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(cancelButton()).toHaveFocus());
  expect(nameField()).toHaveValue('new');
  expect(arnField()).toHaveValue(QUEUE);
  expect(engine.writes).toEqual([]);
});

it.each([
  ['SQS queue', QUEUE, 'Check that the queue policy allows S3 to send messages from this bucket'],
  ['Lambda function', FUNCTION, 'Check that the function allows S3 to invoke it from this bucket'],
])('keeps the %s draft and shows the validation reason and permission hint', async (type, arn, hint) => {
  engine.write = () => refusal(400, 'InvalidArgument', 'Unable to validate destination');
  open();
  await loaded();
  fireEvent.click(screen.getByRole('radio', { name: type }));
  fill(arn);
  fireEvent.click(createButton());
  expect(await screen.findByText(hint)).toBeVisible();
  expect(screen.getByText('InvalidArgument')).toBeVisible();
  expect(screen.getByText(/Unable to validate destination/)).toBeVisible();
  expect(arnField()).toHaveValue(arn);
  expect(nameField()).toHaveValue('new');
});

it.each([
  [403, 'AccessDenied', 'Your notification write was denied', false],
  [501, 'NotImplemented', 'PutBucketNotificationConfiguration', true],
])('shows the returned write failure for status %s', async (status, code, detail, disabled) => {
  engine.write = () => refusal(status, code, detail);
  open();
  await loaded();
  fill();
  fireEvent.click(createButton());
  expect(await screen.findByText(new RegExp(detail))).toBeVisible();
  if (disabled) {
    expect(screen.getByText('Not implemented by the emulator')).toBeVisible();
    expect(createButton()).toBeDisabled();
  } else {
    expect(createButton()).toBeEnabled();
  }
  expect(arnField()).toHaveValue(QUEUE);
});

it('shows the loading state, retries a failed read, and handles a missing bucket', async () => {
  const held = heldResponse();
  engine.read = () => held.promise;
  open();
  expect(await screen.findByText('Loading event notifications')).toBeVisible();
  held.resolve(refusal(400, 'InvalidRequest', 'Could not read this bucket'));
  expect(await screen.findByText(/Could not read this bucket/)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Notification name' })).toBeNull();
  engine.read = () => refusal(404, 'NoSuchBucket', 'Bucket missing');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Bucket not found')).toBeVisible();
  expect(engine.writes).toEqual([]);
});

it('distinguishes engine and emulator outages, then reads fresh before allowing changes', async () => {
  open();
  await loaded();
  const emulator = { port: 9305, endpoint: 'https://127.0.0.1:9305' };
  setConnection({ kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9305 });
  expect(screen.getAllByText(/is not answering/).length).toBeGreaterThan(1);
  expect(screen.getAllByRole('link', { name: 'Connection status' }).length).toBeGreaterThan(1);
  expect(screen.queryByRole('textbox', { name: 'Notification name' })).toBeNull();
  setConnection({ kind: 'emulator-unreachable', reason: 'not_started', emulator, message: '', checkedAt: 2 });
  expect(screen.getAllByText(/Not started on port/).length).toBeGreaterThan(1);
  const readCount = engine.reads.length;
  setConnection(connected('first'));
  expect(await loaded()).toBeVisible();
  expect(engine.reads.length).toBeGreaterThan(readCount);
  expect(engine.writes).toEqual([]);
});

it.each(['failed read', 'missing rule', 'different field'])(
  'retries %s verification with only a GET and confirms once',
  async (mode) => {
    const editing = mode === 'different field';
    if (editing) engine.document = documentOf(SAVED_RULE);
    const router = open(editing ? editEventNotificationPath(BUCKET, 'saved') : CREATE);
    await loaded();
    if (editing) changeValue(screen.getByRole('textbox', { name: 'Prefix (optional)' }), 'changed/');
    else fill();
    engine.read = () => {
      if (engine.writes.length === 0) return response(engine.document);
      if (mode === 'failed read') return refusal(400, 'InvalidRequest', 'Verification read failed');
      if (editing) return response(engine.document.replace('changed/', 'observed/'));
      return response();
    };
    fireEvent.click(editing ? screen.getByRole('button', { name: 'Save changes' }) : createButton());
    const retry = await screen.findByRole('button', { name: 'Check again' });
    expect(screen.queryByText('Event notification saved')).toBeNull();
    if (mode === 'failed read') expect(screen.getByText(/Verification read failed/)).toBeVisible();
    else expect(screen.getByText('The saved configuration differs from the requested change.')).toBeVisible();
    if (editing) expect(screen.getByText('observed/')).toBeVisible();
    const before = engine.reads.length;
    engine.read = () => response(engine.document);
    fireEvent.click(retry);
    await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
    expect(engine.reads.slice(before).every((request) => request.method === 'GET')).toBe(true);
    expect(engine.writes).toHaveLength(1);
    expect(await screen.findByText('Event notification saved')).toBeVisible();
  },
);

describe.each(['leave', 'switch target'])('while saving, %s', (cause) => {
  it.each(['pre-write read', 'verification success', 'verification failure'])('abandons a held %s', async (step) => {
    const hold = heldResponse();
    const router = open();
    await loaded();
    fill();
    engine.read = () => (step === 'pre-write read' || engine.writes.length > 0 ? hold.promise : response());
    fireEvent.click(createButton());
    const pendingReadCount = step === 'pre-write read' ? 2 : 3;
    await waitFor(() => expect(engine.reads).toHaveLength(pendingReadCount));
    const abandoned = engine.reads.at(-1);
    engine.read = () => response(engine.document);
    if (cause === 'leave') await act(() => router.navigate('/'));
    else {
      setConnection(connected('second'));
      expect(await loaded()).toHaveValue('');
    }
    expect(abandoned?.signal.aborted).toBe(true);
    const after = engine.reads.length;
    await act(async () => {
      hold.resolve(
        step === 'verification failure' ? refusal(500, 'InternalError', 'Late failure') : response(engine.document),
      );
      await hold.promise;
    });
    expect(engine.reads).toHaveLength(after);
    expect(engine.writes).toHaveLength(step === 'pre-write read' ? 0 : 1);
    expect(screen.queryByText('Event notification saved')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(router.state.location.pathname).toBe(cause === 'leave' ? '/' : CREATE);
  });
});
