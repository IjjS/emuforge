import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import { QueryClient, QueryClientProvider, useIsFetching } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../../components/emulator-line';
import { creationDateText } from '../../../../components/format-date';
import AwsArea from '../../../../index';
import { SECRETS_PATH, secretPath } from '../../paths';
import { useSecretDetail, useSecretListing } from '../../queries';

const NAME = 'dev/key';
const ORIGINAL_KEY = 'arn:aws:kms:us-east-1:000000000000:key/original';
const NEW_KEY = 'arn:aws:kms:us-east-1:000000000000:key/replacement';
const DELETION_DATE = 1_800_000_000;
const ORIGINAL_DESCRIPTION = 'Original description';
const ORIGINAL_VERSION = 'existing-version';
const ORIGINAL_TAG = { Key: 'project', Value: 'original tag value' };
const REFUSED = 'Local policy refused this operation.';
const STRING_VALUE = '  synthetic value\nwith whitespace  ';
const BYTES = [0, 20, 160, 255];
const BINARY_VALUE = btoa(String.fromCharCode(...BYTES));

type Metadata = Omit<DescribeSecretCommandOutput, '$metadata' | 'DeletedDate'> & { DeletedDate?: number };
type Input = Record<string, unknown>;
type Reply = { body: unknown; status?: number };
type Handler = (operation: string, input: Input) => Reply | Promise<Reply> | undefined;

function secretMetadata(changes?: Partial<Metadata>): Metadata {
  return {
    Name: NAME,
    Description: ORIGINAL_DESCRIPTION,
    KmsKeyId: ORIGINAL_KEY,
    VersionIdsToStages: { [ORIGINAL_VERSION]: ['AWSCURRENT'] },
    Tags: [ORIGINAL_TAG],
    ...changes,
  };
}

function denied() {
  return { body: { __type: 'AccessDeniedException', message: REFUSED }, status: 403 };
}

function notFound() {
  return { body: { __type: 'ResourceNotFoundException', message: 'Missing secret' }, status: 404 };
}

let nextPort = 8750;

function useVisits(pathname: string) {
  const [visit, setVisit] = useState({ pathname, count: 0 });
  if (visit.pathname !== pathname) {
    setVisit({ pathname, count: visit.count + 1 });
  }
  return pathname === visit.pathname ? visit.count : visit.count + 1;
}

// Keep both production read hooks mounted while the real area navigates between its screens.
function ActiveReads({ connection }: { connection: AreaConnection }) {
  const list = useSecretListing(connection, false);
  const fetchingList = useIsFetching({ queryKey: ['aws', 'secretsmanager', 'ListSecrets'] }) > 0;
  const detail = useSecretDetail(connection, NAME);
  return (
    <>
      <output aria-label="List read" aria-busy={fetchingList}>
        {JSON.stringify(list.items ?? [])}
      </output>
      <output aria-label="Detail read" aria-busy={detail.loading}>
        {detail.failure?.kind === 'other' ? detail.failure.code : JSON.stringify(detail.details)}
      </output>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => vi.unstubAllGlobals());

function openLifecycle({
  initial = secretMetadata(),
  handler,
  observe = false,
}: { initial?: Metadata; handler?: Handler; observe?: boolean } = {}) {
  const connection: AreaConnection = {
    engineOrigin: `http://127.0.0.1:${String(nextPort++)}`,
    result: {
      kind: 'connected',
      checkedAt: Date.now(),
      emulator: { port: 9308, endpoint: 'https://127.0.0.1:9308' },
    },
  };
  const calls = vi.fn<(operation: string, input: Input) => void>();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const answer = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    const body = (await request.json()) as Input;
    calls(operation, body);
    const reply = await handler?.(operation, body);
    if (reply !== undefined) return answer(reply.body, reply.status);
    switch (operation) {
      case 'ListSecrets':
        return answer({ SecretList: initial.DeletedDate ? [] : [initial] });
      case 'DescribeSecret':
        return answer(initial);
      case 'GetSecretValue':
        throw new Error('The lifecycle controls must not retrieve a secret value.');
      default:
        return answer({});
    }
  });

  function Frame() {
    const { pathname } = useLocation();
    const routeChanges = useVisits(pathname);
    return (
      <>
        {observe && <ActiveReads connection={connection} />}
        <AwsArea
          headerSelector="#top-bar"
          connection={connection}
          targetGeneration={0}
          routeChanges={routeChanges}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
      </>
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [secretPath(NAME)] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    calls,
    count: (operation: string) => calls.mock.calls.filter(([name]) => name === operation).length,
    router,
  };
}

function enter(label: string, value: string, root: Pick<typeof screen, 'getByLabelText'> = screen) {
  fireEvent.change(root.getByLabelText(label), { target: { value } });
}

function chooseBinary(root: HTMLElement) {
  fireEvent.click(screen.getByRole('radio', { name: 'Binary file' }));
  const upload = root.querySelector('input[type="file"]');
  if (upload === null) throw new Error('Missing file input');
  fireEvent.change(upload, { target: { files: [new File([new Uint8Array(BYTES)], 'secret.bin')] } });
}

async function click(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }));
}

function deferredReply() {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

const ORDERS = ['list first', 'detail first'] as const;
type ReadOrder = (typeof ORDERS)[number];

function delayedReads(operation: string, detailAnswer: Reply, listAnswer: Reply) {
  const list = deferredReply();
  const detail = deferredReply();
  let changed = false;
  const handler: Handler = (called) => {
    if (called === operation) {
      changed = true;
      return { body: { Name: NAME } };
    }
    if (changed && called === 'ListSecrets') return list.promise;
    if (changed && called === 'DescribeSecret') return detail.promise;
  };
  async function complete(order: ReadOrder, after: () => void) {
    const listRead = () => act(() => list.resolve(listAnswer));
    const detailRead = () => act(() => detail.resolve(detailAnswer));
    const waitForList = () =>
      waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    const waitForDetail = () =>
      waitFor(() => expect(screen.getByLabelText('Detail read')).toHaveAttribute('aria-busy', 'false'));
    await waitFor(() => {
      expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByLabelText('Detail read')).toHaveAttribute('aria-busy', 'true');
    });
    if (order === 'list first') {
      await listRead();
      await waitForList();
      after();
      await detailRead();
    } else {
      await detailRead();
      await waitForDetail();
      after();
      await listRead();
    }
    await waitForList();
    await waitForDetail();
    after();
  }
  return { handler, complete };
}

async function expectList(router: ReturnType<typeof openLifecycle>['router']) {
  await screen.findByRole('heading', { name: 'Secrets', level: 1 });
  expect(router.state.location.pathname).toBe(SECRETS_PATH);
}

async function openDialog(button: string, name = button) {
  await click(button);
  return screen.findByRole('dialog', { name });
}

function submit(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole('button', { name }));
}

describe('Secret lifecycle', () => {
  it('does not retrieve the existing secret when opening the value editor', async () => {
    const { count } = openLifecycle();
    const dialog = await openDialog('Edit secret value');
    expect(within(dialog).getByRole('textbox', { name: 'Secret value' })).toHaveValue('');
    expect(count('GetSecretValue')).toBe(0);
  });

  it('sends only the binary file bytes when replacing a value with a file', async () => {
    const { calls } = openLifecycle();
    const dialog = await openDialog('Edit secret value');
    chooseBinary(dialog);
    submit(dialog, 'Save secret value');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('PutSecretValue', {
        SecretId: NAME,
        SecretBinary: BINARY_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
  });

  it('sends only the entered string when replacing a value with text', async () => {
    const { calls } = openLifecycle();
    const dialog = await openDialog('Edit secret value');
    enter('Secret value', STRING_VALUE, within(dialog));
    submit(dialog, 'Save secret value');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('PutSecretValue', {
        SecretId: NAME,
        SecretString: STRING_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
  });

  it('sends only the selected recovery window when scheduling deletion', async () => {
    const { calls, router } = openLifecycle();
    const dialog = await openDialog('Schedule deletion');
    enter('Recovery window (days)', '12', within(dialog));
    submit(dialog, 'Schedule deletion');
    await expectList(router);
    expect(calls).toHaveBeenCalledWith('DeleteSecret', { SecretId: NAME, RecoveryWindowInDays: 12 });
  });

  it('sends only the force deletion option when permanently deleting', async () => {
    const { calls, router } = openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    enter(`Type ${NAME} to confirm.`, NAME, within(dialog));
    submit(dialog, 'Permanently delete');
    await expectList(router);
    expect(calls).toHaveBeenCalledWith('DeleteSecret', { SecretId: NAME, ForceDeleteWithoutRecovery: true });
  });

  it('names the resource and explains permanent local deletion', async () => {
    openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    expect(within(dialog).getByText(NAME)).toBeVisible();
    expect(
      within(dialog).getByText('Permanently delete this secret from your local emulator? This cannot be undone.'),
    ).toBeVisible();
  });

  it('requires the entire exact name for permanent deletion', async () => {
    const { count } = openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    enter(`Type ${NAME} to confirm.`, `${NAME} `, within(dialog));
    expect(within(dialog).getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
    submit(dialog, 'Permanently delete');
    expect(count('DeleteSecret')).toBe(0);
  });

  it('leaves the secret in place when permanent deletion is canceled', async () => {
    const { count } = openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    enter(`Type ${NAME} to confirm.`, NAME, within(dialog));
    submit(dialog, 'Cancel');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(ORIGINAL_DESCRIPTION)).toBeVisible();
    expect(count('DeleteSecret')).toBe(0);
  });
});

const SCHEDULED_DATE = creationDateText(new Date(DELETION_DATE * 1000));
const NEXT_DESCRIPTION = 'Updated description';
const NEXT_VERSION = 'new-current-version';
const ADDED_TAG = { Key: 'environment', Value: 'development' };
const NEXT_TAG_VALUE = 'updated tag value';

const CHANGES = [
  {
    scenario: 'description editing',
    operation: 'UpdateSecret',
    button: 'Edit description',
    submit: 'Save changes',
    inputs: { Description: NEXT_DESCRIPTION },
    command: { Description: NEXT_DESCRIPTION },
    changes: { Description: NEXT_DESCRIPTION },
    oldText: ORIGINAL_DESCRIPTION,
    newText: NEXT_DESCRIPTION,
    result: 'Description updated.',
  },
  {
    scenario: 'encryption key editing',
    operation: 'UpdateSecret',
    button: 'Change encryption key',
    submit: 'Save changes',
    inputs: { 'KMS key ARN': NEW_KEY },
    command: { KmsKeyId: NEW_KEY },
    changes: { KmsKeyId: NEW_KEY },
    oldText: ORIGINAL_KEY,
    newText: NEW_KEY,
    result: 'Encryption key updated.',
  },
  {
    scenario: 'tag addition',
    operation: 'TagResource',
    button: 'Add tag',
    submit: 'Add tag',
    inputs: { 'Tag key': ADDED_TAG.Key, 'Tag value': ADDED_TAG.Value },
    command: { Tags: [ADDED_TAG] },
    changes: { Tags: [ORIGINAL_TAG, ADDED_TAG] },
    oldText: ORIGINAL_TAG.Value,
    newText: ADDED_TAG.Key,
    result: 'Tag added.',
  },
  {
    scenario: 'tag editing',
    operation: 'TagResource',
    button: `Edit tag ${ORIGINAL_TAG.Key}`,
    title: 'Edit tag',
    submit: 'Save tag',
    inputs: { 'Tag value': NEXT_TAG_VALUE },
    command: { Tags: [{ Key: ORIGINAL_TAG.Key, Value: NEXT_TAG_VALUE }] },
    changes: { Tags: [{ Key: ORIGINAL_TAG.Key, Value: NEXT_TAG_VALUE }] },
    oldText: ORIGINAL_TAG.Value,
    newText: NEXT_TAG_VALUE,
    result: 'Tag updated.',
  },
  {
    scenario: 'tag removal',
    operation: 'UntagResource',
    button: `Remove tag ${ORIGINAL_TAG.Key}`,
    title: 'Remove tag',
    submit: 'Remove tag',
    command: { TagKeys: [ORIGINAL_TAG.Key] },
    changes: { Tags: [] },
    oldText: ORIGINAL_TAG.Value,
    newText: 'No tags',
    result: 'Tag removed.',
  },
  {
    scenario: 'value editing',
    operation: 'PutSecretValue',
    button: 'Edit secret value',
    submit: 'Save secret value',
    inputs: { 'Secret value': STRING_VALUE },
    command: { SecretString: STRING_VALUE },
    changes: { VersionIdsToStages: { [NEXT_VERSION]: ['AWSCURRENT'], [ORIGINAL_VERSION]: ['AWSPREVIOUS'] } },
    oldText: ORIGINAL_VERSION,
    newText: NEXT_VERSION,
    result: 'New secret version stored.',
  },
  {
    scenario: 'restoring',
    operation: 'RestoreSecret',
    button: 'Restore secret',
    submit: 'Restore secret',
    command: {},
    initial: { DeletedDate: DELETION_DATE },
    changes: {},
    oldText: SCHEDULED_DATE,
    newText: undefined,
    result: 'Secret restored.',
  },
];

const DELETION = {
  scenario: 'scheduling deletion',
  operation: 'DeleteSecret',
  button: 'Schedule deletion',
  submit: 'Schedule deletion',
  command: { RecoveryWindowInDays: 7 },
  changes: { DeletedDate: DELETION_DATE },
  oldText: ORIGINAL_DESCRIPTION,
  newText: undefined,
  result: `Deletion scheduled for ${NAME}.`,
};

const PERMANENT = {
  scenario: 'permanent deletion',
  operation: 'DeleteSecret',
  button: 'Permanently delete',
  title: 'Permanently delete secret',
  submit: 'Permanently delete',
  inputs: { [`Type ${NAME} to confirm.`]: NAME },
  command: { ForceDeleteWithoutRecovery: true },
  result: `Secret ${NAME} was permanently deleted.`,
};

interface EditFlow {
  button: string;
  title?: string;
  submit: string;
  inputs?: Record<string, string>;
}

async function submitEdit({ button, title, inputs, submit: label }: EditFlow) {
  const dialog = await openDialog(button, title);
  for (const [field, value] of Object.entries(inputs ?? {})) enter(field, value, within(dialog));
  submit(dialog, label);
  return dialog;
}

function commandInput(operation: string, input: object) {
  return {
    SecretId: NAME,
    ...input,
    ...((operation === 'UpdateSecret' || operation === 'PutSecretValue') && { ClientRequestToken: expect.any(String) }),
  };
}

function exactVisibleText(text: string) {
  return (_content: string, element: Element | null) =>
    element?.textContent === text && !Array.from(element.children).some((child) => child.textContent === text);
}

describe.each([...CHANGES, DELETION])('$scenario', (flow) => {
  it('shows the rejection and preserves the original state on a fresh read', async () => {
    const initial = secretMetadata('initial' in flow ? flow.initial : undefined);
    const { count, calls } = openLifecycle({
      initial,
      handler: (operation) => (operation === flow.operation ? denied() : undefined),
    });
    const dialog = await submitEdit(flow);
    expect(await within(dialog).findByText(REFUSED, { exact: false })).toBeVisible();
    expect(calls).toHaveBeenCalledWith(flow.operation, commandInput(flow.operation, flow.command));
    expect(screen.queryByText(flow.result)).not.toBeInTheDocument();
    submit(dialog, 'Cancel');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const reads = count('DescribeSecret');
    await click('Refresh');
    await waitFor(() => {
      expect(count('DescribeSecret')).toBeGreaterThan(reads);
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    });
    expect(screen.getByText(exactVisibleText(flow.oldText))).toBeVisible();
    if (flow.newText !== undefined) expect(screen.queryByText(exactVisibleText(flow.newText))).not.toBeInTheDocument();
    if (flow === DELETION) expect(screen.queryByText('Scheduled deletion')).not.toBeInTheDocument();
  });
});

function assertFlash(result: string) {
  expect(within(screen.getByRole('main')).getByText(result)).toBeVisible();
}

describe.each(CHANGES)('$scenario', (flow) => {
  it.each(ORDERS)('keeps the result and fresh detail when %s', async (order) => {
    const initial = secretMetadata(flow.initial);
    const updated = secretMetadata(flow.changes);
    const reads = delayedReads(flow.operation, { body: updated }, { body: { SecretList: [updated] } });
    const { calls } = openLifecycle({ initial, handler: reads.handler, observe: true });
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    await submitEdit(flow);
    await screen.findByText(flow.result);
    await reads.complete(order, () => assertFlash(flow.result));
    expect(calls).toHaveBeenCalledWith(flow.operation, commandInput(flow.operation, flow.command));
    if (flow.newText !== undefined) expect(await screen.findByText(exactVisibleText(flow.newText))).toBeVisible();
    if (flow.scenario === 'restoring')
      expect(await screen.findByRole('button', { name: 'Schedule deletion' })).toBeEnabled();
    if (flow.scenario !== 'tag addition')
      expect(screen.queryByText(exactVisibleText(flow.oldText))).not.toBeInTheDocument();
    expect(screen.getByLabelText('List read')).toHaveTextContent(NAME);
  });
});

describe.each([DELETION, PERMANENT])('$scenario', (flow) => {
  it.each(ORDERS)('keeps the deletion result on the list when %s', async (order) => {
    const detail = flow === PERMANENT ? notFound() : { body: secretMetadata(DELETION.changes) };
    const reads = delayedReads(flow.operation, detail, { body: { SecretList: [] } });
    const { router, calls } = openLifecycle({ observe: true, handler: reads.handler });
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveTextContent(NAME));
    await submitEdit(flow);
    await expectList(router);
    await reads.complete(order, () => assertFlash(flow.result));
    expect(await screen.findByText('No secrets')).toBeVisible();
    expect(screen.queryByRole('link', { name: NAME })).not.toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith('DeleteSecret', commandInput(flow.operation, flow.command));
    expect(screen.getByLabelText('Detail read')).toHaveTextContent(
      flow === PERMANENT ? 'ResourceNotFoundException' : new Date(DELETION_DATE * 1000).toISOString(),
    );
  });
});

it('disables both DeleteSecret entry points after a 501 and keeps other operations available', async () => {
  openLifecycle({
    handler: (operation) =>
      operation === 'DeleteSecret' ? { body: { __type: 'NotImplemented' }, status: 501 } : undefined,
  });
  const dialog = await openDialog('Schedule deletion');
  submit(dialog, 'Schedule deletion');
  expect(await within(dialog).findByText('Not implemented by the emulator')).toBeVisible();
  expect(within(dialog).getByText(/for DeleteSecret/)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: 'Schedule deletion' })).toBeDisabled();
  submit(dialog, 'Cancel');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Schedule deletion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit secret value' })).toBeEnabled();
});
