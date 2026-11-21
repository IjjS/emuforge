import createWrapper from '@cloudscape-design/components/test-utils/dom';
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
  writeRequests: Request[] = [];
  document = EMPTY;
  read = (): Response | Promise<Response> => response(this.document);
  write = (body: string): Response | Promise<Response> => {
    this.document = body;
    return new Response(null, { status: 204 });
  };

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') return Response.json({ token: 'notification-test' });
    if (url.searchParams.has('notification')) {
      if (request.method === 'PUT') {
        this.writeRequests.push(request);
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

const page = createWrapper(document.body);

function notificationFlashes(message: string) {
  return (page.findFlashbar()?.findItems() ?? []).filter(
    (item) => item.findContent()?.getElement().textContent === message,
  );
}

function field(label: string) {
  const found = page.findAllFormFields().find((candidate) => candidate.findLabel()?.getElement().textContent === label);
  if (found === undefined) throw new Error(`Missing form field ${label}`);
  return found;
}

function input(label: string) {
  const found = createWrapper(field(label).getElement()).findInput();
  if (found === null) throw new Error(`Missing input ${label}`);
  return found.findNativeInput().getElement();
}

function radioGroup(label: string) {
  const group = createWrapper(field(label).getElement()).findRadioGroup();
  if (group === null) throw new Error(`Missing radio group ${label}`);
  return group;
}

function radio(label: string, value: string) {
  const found = radioGroup(label).findInputByValue(value);
  if (found === null) throw new Error(`Missing radio option ${value}`);
  return found.getElement();
}

async function discardDialog() {
  return waitFor(() => {
    const dialog = page.findModal();
    expect(dialog?.findHeader().getElement()).toHaveTextContent('Discard what you entered?');
    if (dialog === null) throw new Error('Missing discard modal');
    return dialog;
  });
}

function discardAction(dialog: Awaited<ReturnType<typeof discardDialog>>, name: string) {
  const footer = dialog.findFooter();
  if (footer === null) throw new Error('Missing discard actions');
  return within(footer.getElement()).getByRole('button', { name });
}

const nameField = () => input('Notification name');
const arnField = () => input('Destination ARN');
const createButton = () => screen.getByRole('button', { name: 'Create event notification' });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });
const changeValue = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const fill = (arn = QUEUE, id = 'new') => {
  changeValue(nameField(), id);
  changeValue(arnField(), arn);
};
const loaded = () => waitFor(nameField);

it('creates an empty draft and preloads every field and all saved events for direct edit', async () => {
  engine.document = documentOf(SAVED_RULE);
  const router = open();
  expect(await loaded()).toHaveValue('');
  expect(arnField()).toHaveValue('');
  expect(radio('Event type', 's3:ObjectCreated:*')).toBeChecked();
  await act(() => router.navigate(editEventNotificationPath(BUCKET, 'saved')));
  expect(await loaded()).toHaveValue('saved');
  expect(nameField()).toHaveAttribute('readonly');
  expect(arnField()).toHaveValue(QUEUE);
  expect(screen.getByRole('button', { name: 'Copy saved destination ARN' })).toBeVisible();
  expect(input('Prefix (optional)')).toHaveValue('logs/');
  expect(input('Suffix (optional)')).toHaveValue('.txt');
  expect(radio('Event type', 'keep')).toBeChecked();
  const keep = radioGroup('Event type')
    .findButtons()
    .find((button) => button.findNativeInput().getElement().value === 'keep');
  expect(keep?.findLabel().getElement()).toHaveTextContent('Keep existing events');
  expect(keep?.findDescription()?.getElement()).toHaveTextContent('s3:ObjectCreated:Copy, s3:ObjectCreated:Put');
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

it('returns to Properties from a direct edit of a missing bucket without writing', async () => {
  engine.read = () => refusal(404, 'NoSuchBucket', 'Bucket missing');
  open(editEventNotificationPath(BUCKET, 'saved'));
  expect(await screen.findByText('Bucket not found')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Return to Properties' })).toHaveAttribute('href', PROPERTIES);
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  expect(engine.reads.map((request) => request.method)).toEqual(['GET']);
  expect(engine.writes).toEqual([]);
});

it('marks missing names and ARNs, conflicting IDs and malformed or mismatched destinations before any write', async () => {
  engine.document = documentOf(SAVED_RULE);
  open();
  await loaded();
  fireEvent.click(createButton());
  expect(field('Notification name').findError()?.getElement()).toHaveTextContent('Enter a notification name.');
  expect(field('Destination ARN').findError()?.getElement()).toHaveTextContent('Enter a destination ARN.');
  expect(nameField()).toHaveFocus();
  fill('not-an-arn', 'saved');
  fireEvent.click(createButton());
  expect(field('Notification name').findError()?.getElement()).toHaveTextContent(
    'A notification with this name already exists.',
  );
  expect(field('Destination ARN').findError()?.getElement()).toHaveTextContent('Enter a valid standard SQS queue ARN.');
  fill(FUNCTION);
  fireEvent.click(createButton());
  expect(field('Destination ARN').findError()?.getElement()).toHaveTextContent('Enter a valid standard SQS queue ARN.');
  expect(arnField()).toHaveFocus();
  expect(engine.reads).toHaveLength(1);
  expect(engine.writes).toEqual([]);
});

it.each([
  ['SQS queue', QUEUE, 's3:ObjectCreated:Put'],
  ['Lambda function', FUNCTION, 's3:ObjectCreated:*'],
])('submits one %s save while pending and serializes the event and filters', async (type, arn, event) => {
  const hold = heldResponse();
  const router = open();
  await loaded();
  engine.read = () => (engine.writes.length === 0 ? hold.promise : response(engine.document));
  fireEvent.click(radio('Destination type', type));
  fill(arn);
  fireEvent.click(radio('Event type', event));
  changeValue(input('Prefix (optional)'), 'logs/');
  changeValue(input('Suffix (optional)'), '.txt');
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
    const dialog = await discardDialog();
    expect(dialog.findContent().getElement()).toHaveTextContent('What you entered on this page is not kept.');
    fireEvent.click(discardAction(dialog, 'Discard'));
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
  const dialog = await discardDialog();
  if (answer === 'Escape') {
    const keepEditing = discardAction(dialog, 'Keep editing');
    keepEditing.focus();
    fireEvent.keyDown(keepEditing, { key: 'Escape', code: 'Escape', keyCode: 27 });
  } else {
    fireEvent.click(answer === 'Close' ? dialog.findDismissButton().getElement() : discardAction(dialog, answer));
  }
  await waitFor(() => expect(page.findModal()).toBeNull());
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
  fireEvent.click(radio('Destination type', type));
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
    if (editing) changeValue(input('Prefix (optional)'), 'changed/');
    else fill();
    engine.read = () => {
      if (engine.writes.length === 0) return response(engine.document);
      if (mode === 'failed read') return refusal(400, 'InvalidRequest', 'Verification read failed');
      if (editing) return response(engine.document.replace('changed/', 'observed/'));
      return response();
    };
    fireEvent.click(editing ? screen.getByRole('button', { name: 'Save changes' }) : createButton());
    const retry = await screen.findByRole('button', { name: 'Check again' });
    expect(retry).toHaveFocus();
    expect(notificationFlashes('Event notification saved')).toHaveLength(0);
    if (mode === 'failed read') expect(screen.getByText(/Verification read failed/)).toBeVisible();
    else expect(screen.getByText('The saved configuration differs from the requested change.')).toBeVisible();
    if (editing) expect(screen.getByText('observed/')).toBeVisible();
    const before = engine.reads.length;
    engine.read = () => response(engine.document);
    fireEvent.click(retry);
    await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
    expect(engine.reads.slice(before).every((request) => request.method === 'GET')).toBe(true);
    expect(engine.writes).toHaveLength(1);
    await waitFor(() => expect(notificationFlashes('Event notification saved')).toHaveLength(1));
  },
);

it.each(['missing rule', 'missing bucket'])(
  'refreshes an unconfirmed edit on same-target recovery with a %s',
  async (missing) => {
    engine.document = documentOf(SAVED_RULE);
    const path = editEventNotificationPath(BUCKET, 'saved');
    const router = open(path);
    await loaded();
    changeValue(input('Prefix (optional)'), 'changed/');
    engine.read = () => {
      if (engine.writes.length === 0) return response(engine.document);
      return missing === 'missing rule'
        ? response(documentOf(SAVED_RULE))
        : refusal(400, 'InvalidRequest', 'Verification read failed');
    };
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeVisible();
    expect(engine.writes).toHaveLength(1);
    if (missing === 'missing rule') {
      expect(screen.getByRole('heading', { name: 'Observed event notifications' })).toBeVisible();
    }

    setConnection({ kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9305 });
    const beforeReconnect = engine.reads.length;
    engine.read = () => (missing === 'missing rule' ? response() : refusal(404, 'NoSuchBucket', 'Bucket missing'));
    setConnection(connected('first'));
    expect(
      await screen.findByText(missing === 'missing rule' ? 'The notification was not found.' : 'Bucket not found'),
    ).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Notification name' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Observed event notifications' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Return to Properties' })).toHaveAttribute('href', PROPERTIES);
    expect(engine.reads.slice(beforeReconnect).map((request) => request.method)).toEqual(['GET']);

    const beforeRetry = engine.reads.length;
    engine.read = () => refusal(404, 'NoSuchBucket', 'Bucket missing');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('The bucket was not found during verification.')).toBeVisible();
    expect(screen.getByText('Bucket not found')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(engine.reads.slice(beforeRetry).map((request) => request.method)).toEqual(['GET']);
    expect(engine.writes).toHaveLength(1);
    expect(router.state.location.pathname).toBe(path);
    expect(notificationFlashes('Event notification saved')).toHaveLength(0);

    engine.read = () => response(engine.document);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(notificationFlashes('Event notification saved')).toHaveLength(1));
    expect(router.state.location.pathname).toBe(PROPERTIES);
    expect(engine.writes).toHaveLength(1);
  },
);

it('keeps the submitted create settings and read-only recovery after the observation is invalidated', async () => {
  const router = open();
  await loaded();
  fill(QUEUE, 'send-imports');
  changeValue(input('Prefix (optional)'), 'incoming/');
  changeValue(input('Suffix (optional)'), '.csv');
  // The emulator accepts the write but the verification response omits it.
  engine.read = () => response();
  fireEvent.click(createButton());
  const retry = await screen.findByRole('button', { name: 'Check again' });
  expect(retry).toHaveFocus();
  expect(screen.getByText('Review the configuration returned by the emulator.')).toBeVisible();

  setConnection({ kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9305 });
  const beforeReconnect = engine.reads.length;
  setConnection(connected('first'));
  expect(await screen.findByRole('heading', { name: 'Submitted notification' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Observed event notifications' })).toBeNull();
  expect(screen.queryByText('Review the configuration returned by the emulator.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Check again' })).toHaveAccessibleDescription(
    'Select Check again to read the current configuration.',
  );
  expect(screen.queryByRole('textbox', { name: 'Notification name' })).toBeNull();
  const settings = page.findKeyValuePairs()?.findItems();
  expect(
    settings?.map((item) => [item.findLabel()?.getElement().textContent, item.findValue()?.getElement().textContent]),
  ).toEqual([
    ['Notification name', 'send-imports'],
    ['Destination type', 'SQS queue'],
    ['Destination ARN', QUEUE],
    ['Event type', 'All object creation events'],
    ['Prefix', 'incoming/'],
    ['Suffix', '.csv'],
  ]);
  expect(engine.reads.slice(beforeReconnect).map((request) => request.method)).toEqual(['GET']);

  const verify = heldResponse();
  engine.read = () => verify.promise;
  const beforeRetry = engine.reads.length;
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(screen.getByRole('status', { name: 'Notification save progress' })).toHaveTextContent(
    'Checking saved configuration',
  );
  expect(screen.getByRole('heading', { name: 'Submitted notification' })).toBeVisible();
  verify.resolve(response(engine.document));
  await waitFor(() => expect(router.state.location.pathname).toBe(PROPERTIES));
  expect(engine.reads[beforeRetry]?.method).toBe('GET');
  expect(engine.writes).toHaveLength(1);
  await waitFor(() => expect(notificationFlashes('Event notification saved')).toHaveLength(1));
});

it.each([
  ['Create', 'pre-write GET'],
  ['Edit', 'pre-write GET'],
  ['Create', 'transmitted PUT'],
  ['Edit', 'transmitted PUT'],
])('%s abandons a held %s across a same-target outage', async (mode, stage) => {
  const editing = mode === 'Edit';
  const path = editing ? editEventNotificationPath(BUCKET, 'saved') : CREATE;
  const initial = editing ? documentOf(SAVED_RULE) : EMPTY;
  const fresh = editing ? documentOf(SAVED_RULE.replace('logs/', 'current/')) : EMPTY;
  engine.document = initial;
  const pending = heldResponse();
  const router = open(path);
  await loaded();
  if (!editing) fill(QUEUE, 'new');
  changeValue(input('Prefix (optional)'), 'attempted/');
  if (stage === 'pre-write GET') engine.read = () => pending.promise;
  else {
    engine.write = (body) => {
      engine.document = body;
      return pending.promise;
    };
  }
  fireEvent.click(editing ? screen.getByRole('button', { name: 'Save changes' }) : createButton());
  await waitFor(() => {
    expect(engine.reads).toHaveLength(2);
    expect(engine.writes).toHaveLength(stage === 'pre-write GET' ? 0 : 1);
  });
  const abandoned = stage === 'pre-write GET' ? engine.reads.at(-1) : engine.writeRequests.at(-1);

  setConnection({ kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9305 });
  expect(abandoned?.signal.aborted).toBe(true);
  if (stage === 'transmitted PUT') {
    const offlineRetry = screen.getByRole('button', { name: 'Check again' });
    expect(offlineRetry).toBeDisabled();
    expect(offlineRetry).toHaveAccessibleDescription('Verification can resume when the connection is restored.');
  }
  engine.read = () => response(fresh);
  setConnection(connected('first'));
  await waitFor(() => expect(engine.reads).toHaveLength(3));
  if (stage === 'pre-write GET') {
    expect(await loaded()).toHaveValue(editing ? 'saved' : '');
    expect(input('Prefix (optional)')).toHaveValue(editing ? 'current/' : '');
    expect(screen.getByRole('heading', { name: 'Unsubmitted attempt' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy attempt' })).toBeEnabled();
    const reference = page.findKeyValuePairs()?.findItems();
    expect(reference?.map((item) => item.findValue()?.getElement().textContent)).toEqual(
      editing
        ? ['saved', 'SQS queue', QUEUE, 's3:ObjectCreated:Copy, s3:ObjectCreated:Put', 'attempted/', '.txt']
        : ['new', 'SQS queue', QUEUE, 'All object creation events', 'attempted/', '—'],
    );
  } else {
    const retry = await screen.findByRole('button', { name: 'Check again' });
    expect(retry).toBeEnabled();
    expect(retry).toHaveFocus();
  }

  await act(async () => {
    pending.resolve(stage === 'pre-write GET' ? response(initial) : new Response(null, { status: 204 }));
    await pending.promise;
  });
  expect(engine.reads).toHaveLength(3);
  expect(engine.writes).toHaveLength(stage === 'pre-write GET' ? 0 : 1);
  expect(notificationFlashes('Event notification saved')).toHaveLength(0);
  expect(router.state.location.pathname).toBe(path);
  if (stage === 'pre-write GET') {
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  } else {
    engine.read = () => response(engine.document);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(notificationFlashes('Event notification saved')).toHaveLength(1));
    expect(engine.reads[3]?.method).toBe('GET');
    expect(engine.writes).toHaveLength(1);
  }
});

it.each(['Create', 'Edit'])('%s focuses the unavailable verification GET and disables recovery', async (mode) => {
  const editing = mode === 'Edit';
  engine.document = editing ? documentOf(SAVED_RULE) : EMPTY;
  open(editing ? editEventNotificationPath(BUCKET, 'saved') : CREATE);
  await loaded();
  if (!editing) fill();
  engine.read = () =>
    engine.writes.length === 0 ? response(engine.document) : refusal(400, 'InvalidRequest', 'Read unavailable');
  fireEvent.click(editing ? screen.getByRole('button', { name: 'Save changes' }) : createButton());
  const retry = await screen.findByRole('button', { name: 'Check again' });
  engine.read = () => refusal(501, 'NotImplemented', 'Operation unavailable');
  fireEvent.click(retry);
  const unavailable = await screen.findByRole('region', { name: 'Not implemented by the emulator' });
  expect(unavailable).toHaveFocus();
  expect(unavailable).toHaveAccessibleDescription(/501 Not Implemented for GetBucketNotificationConfiguration/);
  const disabled = screen.getByRole('button', { name: 'Check again' });
  expect(disabled).toBeDisabled();
  const reads = engine.reads.length;
  fireEvent.click(disabled);
  expect(engine.reads).toHaveLength(reads);
  expect(engine.writes).toHaveLength(1);
  expect(notificationFlashes('Event notification saved')).toHaveLength(0);
});

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
    expect(notificationFlashes('Event notification saved')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(router.state.location.pathname).toBe(cause === 'leave' ? '/' : CREATE);
  });
});
