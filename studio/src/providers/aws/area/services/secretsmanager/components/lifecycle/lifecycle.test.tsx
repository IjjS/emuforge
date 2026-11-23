import type { DescribeSecretCommandOutput } from '@aws-sdk/client-secrets-manager';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
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
const NEW_VERSION_LABEL = 'Store new version';
const PAGE = createWrapper(document.body);
type Dialog = NonNullable<ReturnType<typeof PAGE.findModal>>;
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

function area() {
  return PAGE.findAppLayout()?.findContentRegion();
}

function field(dialog: Dialog, label: string) {
  const found = dialog
    .findContent()
    .findAllFormFields()
    .find((item) => item.findLabel()?.getElement().textContent === label);
  if (!found) throw new Error(`Missing dialog field ${label}`);
  return found;
}

function input(dialog: Dialog, label: string) {
  const found = field(dialog, label);
  const control =
    found.findControl()?.findInput()?.findNativeInput() ?? found.findControl()?.findTextarea()?.findNativeTextarea();
  if (!control) throw new Error(`Missing dialog input ${label}`);
  return control.getElement();
}

function enter(dialog: Dialog, label: string, value: string) {
  fireEvent.change(input(dialog, label), { target: { value } });
}

function chooseBinary(dialog: Dialog) {
  const choice = field(dialog, 'Value type').findControl()?.findRadioGroup()?.findInputByValue('binary');
  if (!choice) throw new Error('Missing binary option');
  fireEvent.click(choice.getElement());
  const upload = field(dialog, 'Secret file').findControl()?.findFileUpload()?.findNativeInput();
  if (!upload) throw new Error('Missing secret file selector');
  fireEvent.change(upload.getElement(), { target: { files: [new File([new Uint8Array(BYTES)], 'secret.bin')] } });
}

function namedButton(root: ReturnType<typeof area>, name: string) {
  return root
    ?.findAllButtons()
    .find((item) => {
      const element = item.getElement();
      return (element.getAttribute('aria-label') ?? item.findTextRegion()?.getElement().textContent) === name;
    })
    ?.getElement();
}

function pageButton(name: string) {
  return namedButton(area(), name);
}

async function click(name: string) {
  const control = await waitFor(() => {
    const found = pageButton(name);
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
  });
  fireEvent.click(control);
}

function metadataValue(label: string) {
  return area()
    ?.findKeyValuePairs()
    ?.findItems()
    .flatMap((group) => group.findGroupPairs() ?? [])
    .find((pair) => pair.findLabel()?.getElement().textContent === label)
    ?.findValue()
    ?.getElement();
}

function table(title: string) {
  return area()
    ?.findAllTables()
    .find((item) => item.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === title);
}

function tagValue(key: string) {
  const tags = table('Tags');
  if (!tags) return undefined;
  const index = tags.findRows().findIndex((_, at) => tags.findBodyCell(at + 1, 1)?.getElement().textContent === key);
  return index < 0 ? undefined : tags.findBodyCell(index + 1, 2)?.getElement();
}

function dialogAlert(dialog: Dialog, title: string) {
  return dialog
    .findContent()
    .findAllAlerts()
    .find((item) => item.findHeader()?.getElement().textContent === title)
    ?.findContent()
    .getElement();
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
  await waitFor(() => {
    expect(table('Secrets')?.findHeaderSlot()?.findHeader()?.findHeadingText().getElement()).toBeVisible();
  });
  expect(router.state.location.pathname).toBe(SECRETS_PATH);
}

async function openDialog(button: string, title = button) {
  await click(button);
  return waitFor(() => {
    const dialog = PAGE.findModal();
    if (!dialog?.isVisible()) throw new Error(`Missing dialog ${title}`);
    expect(dialog.findHeader().getElement().textContent).toBe(title);
    return dialog;
  });
}

function dialogButton(dialog: Dialog, name: string) {
  return namedButton(dialog.findFooter() ?? undefined, name);
}

function submit(dialog: Dialog, name: string) {
  const control = dialogButton(dialog, name);
  if (!control) throw new Error(`Missing dialog button ${name}`);
  fireEvent.click(control);
}

function dialogContent(dialog: Dialog) {
  return within(dialog.findContent().getElement());
}

async function expectDialogClosed() {
  await waitFor(() => expect(PAGE.findModal()).toBeNull());
}

describe('Secret lifecycle', () => {
  it('does not retrieve the existing secret when opening the value editor', async () => {
    const { count } = openLifecycle();
    const dialog = await openDialog(NEW_VERSION_LABEL);
    expect(input(dialog, 'Secret value')).toHaveValue('');
    expect(
      dialogContent(dialog).getByText('The new version becomes current. Existing versions keep their original values.'),
    ).toBeVisible();
    expect(count('GetSecretValue')).toBe(0);
  });

  it('sends only the binary file bytes when replacing a value with a file', async () => {
    const { calls } = openLifecycle();
    const dialog = await openDialog(NEW_VERSION_LABEL);
    chooseBinary(dialog);
    submit(dialog, NEW_VERSION_LABEL);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('PutSecretValue', {
        SecretId: NAME,
        SecretBinary: BINARY_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
    await waitFor(() => expect(successFlash('New secret version stored.')).toBeVisible());
  });

  it('sends only the entered string when replacing a value with text', async () => {
    const { calls } = openLifecycle();
    const dialog = await openDialog(NEW_VERSION_LABEL);
    enter(dialog, 'Secret value', STRING_VALUE);
    submit(dialog, NEW_VERSION_LABEL);
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('PutSecretValue', {
        SecretId: NAME,
        SecretString: STRING_VALUE,
        ClientRequestToken: expect.any(String),
      }),
    );
    await waitFor(() => expect(successFlash('New secret version stored.')).toBeVisible());
  });

  it('sends only the selected recovery window when scheduling deletion', async () => {
    const { calls, router } = openLifecycle();
    const dialog = await openDialog('Schedule deletion');
    enter(dialog, 'Recovery window (days)', '12');
    submit(dialog, 'Schedule deletion');
    await expectList(router);
    expect(calls).toHaveBeenCalledWith('DeleteSecret', { SecretId: NAME, RecoveryWindowInDays: 12 });
    expect(successFlash(`Deletion scheduled for ${NAME}.`)).toBeVisible();
  });

  it('sends only the force deletion option when permanently deleting', async () => {
    const { calls, router } = openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    enter(dialog, `Type ${NAME} to confirm.`, NAME);
    submit(dialog, 'Permanently delete');
    await expectList(router);
    expect(calls).toHaveBeenCalledWith('DeleteSecret', { SecretId: NAME, ForceDeleteWithoutRecovery: true });
    expect(successFlash(`Secret ${NAME} was permanently deleted.`)).toBeVisible();
  });

  it('names the resource and explains permanent local deletion', async () => {
    openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    expect(dialogContent(dialog).getByText(NAME)).toBeVisible();
    expect(
      dialogContent(dialog).getByText(
        'Permanently delete this secret from your local emulator? This cannot be undone.',
      ),
    ).toBeVisible();
  });

  it('requires the entire exact name for permanent deletion', async () => {
    const { count } = openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    enter(dialog, `Type ${NAME} to confirm.`, `${NAME} `);
    expect(dialogButton(dialog, 'Permanently delete')).toBeDisabled();
    submit(dialog, 'Permanently delete');
    expect(count('DeleteSecret')).toBe(0);
  });

  it('leaves the secret in place when permanent deletion is canceled', async () => {
    const { count } = openLifecycle();
    const dialog = await openDialog('Permanently delete', 'Permanently delete secret');
    enter(dialog, `Type ${NAME} to confirm.`, NAME);
    submit(dialog, 'Cancel');
    await expectDialogClosed();
    expect(metadataValue('Description')).toHaveTextContent(ORIGINAL_DESCRIPTION);
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
    original: () => metadataValue('Description'),
    oldText: ORIGINAL_DESCRIPTION,
    changed: () => metadataValue('Description'),
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
    original: () => metadataValue('Encryption key'),
    oldText: ORIGINAL_KEY,
    changed: () => metadataValue('Encryption key'),
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
    original: () => tagValue(ORIGINAL_TAG.Key),
    oldText: ORIGINAL_TAG.Value,
    changed: () => tagValue(ADDED_TAG.Key),
    newText: ADDED_TAG.Value,
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
    original: () => tagValue(ORIGINAL_TAG.Key),
    oldText: ORIGINAL_TAG.Value,
    changed: () => tagValue(ORIGINAL_TAG.Key),
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
    original: () => tagValue(ORIGINAL_TAG.Key),
    oldText: ORIGINAL_TAG.Value,
    changed: () => table('Tags')?.findEmptySlot()?.getElement(),
    newText: 'No tags',
    result: 'Tag removed.',
  },
  {
    scenario: 'value editing',
    operation: 'PutSecretValue',
    button: NEW_VERSION_LABEL,
    title: NEW_VERSION_LABEL,
    submit: NEW_VERSION_LABEL,
    inputs: { 'Secret value': STRING_VALUE },
    command: { SecretString: STRING_VALUE },
    changes: { VersionIdsToStages: { [NEXT_VERSION]: ['AWSCURRENT'], [ORIGINAL_VERSION]: ['AWSPREVIOUS'] } },
    original: () => metadataValue('Current version ID'),
    oldText: ORIGINAL_VERSION,
    changed: () => metadataValue('Current version ID'),
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
    original: () => metadataValue('Scheduled deletion'),
    oldText: SCHEDULED_DATE,
    changed: undefined,
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
  original: () => metadataValue('Description'),
  oldText: ORIGINAL_DESCRIPTION,
  changed: undefined,
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
  for (const [label, value] of Object.entries(inputs ?? {})) enter(dialog, label, value);
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

function successFlash(result: string) {
  return area()
    ?.findFlashbar()
    ?.findItemsByType('success')
    .find((item) => item.findContent()?.getElement().textContent === result)
    ?.findContent()
    ?.getElement();
}

describe.each([...CHANGES, DELETION])('$scenario', (flow) => {
  it('shows the rejection and preserves the original state on a fresh read', async () => {
    const initial = secretMetadata('initial' in flow ? flow.initial : undefined);
    const { count, calls } = openLifecycle({
      initial,
      handler: (operation) => (operation === flow.operation ? denied() : undefined),
    });
    const dialog = await submitEdit(flow);
    await waitFor(() => expect(dialogAlert(dialog, 'Access denied')).toBeVisible());
    expect(dialogAlert(dialog, 'Access denied')).toHaveTextContent(REFUSED);
    expect(calls).toHaveBeenCalledWith(flow.operation, commandInput(flow.operation, flow.command));
    expect(successFlash(flow.result)).toBeUndefined();
    submit(dialog, 'Cancel');
    await expectDialogClosed();
    const reads = count('DescribeSecret');
    await click('Refresh');
    await waitFor(() => {
      expect(count('DescribeSecret')).toBeGreaterThan(reads);
      expect(pageButton('Refresh')).toBeEnabled();
    });
    expect(flow.original()).toBeVisible();
    expect(flow.original()).toHaveTextContent(flow.oldText);
    if (flow.scenario === 'tag addition' || flow.scenario === 'tag removal') {
      expect(flow.changed?.()).toBeUndefined();
    } else if (flow.newText !== undefined) {
      expect(flow.changed?.()).toBeVisible();
      expect(flow.changed?.()).not.toHaveTextContent(flow.newText);
    }
    if (flow === DELETION) expect(metadataValue('Scheduled deletion')).toBeUndefined();
  });
});

describe.each(CHANGES)('$scenario', (flow) => {
  it.each(ORDERS)('keeps the result and fresh detail when %s', async (order) => {
    const initial = secretMetadata(flow.initial);
    const updated = secretMetadata(flow.changes);
    const reads = delayedReads(flow.operation, { body: updated }, { body: { SecretList: [updated] } });
    const { calls } = openLifecycle({ initial, handler: reads.handler, observe: true });
    await waitFor(() => expect(screen.getByLabelText('List read')).toHaveAttribute('aria-busy', 'false'));
    await submitEdit(flow);
    await waitFor(() => expect(successFlash(flow.result)).toBeVisible());
    await reads.complete(order, () => expect(successFlash(flow.result)).toBeVisible());
    expect(calls).toHaveBeenCalledWith(flow.operation, commandInput(flow.operation, flow.command));
    await waitFor(() => {
      if (flow.newText !== undefined) {
        expect(flow.changed?.()).toBeVisible();
        expect(flow.changed?.()).toHaveTextContent(flow.newText);
      }
      if (flow.scenario === 'restoring') expect(pageButton('Schedule deletion')).toBeEnabled();
      if (flow.scenario === 'tag removal' || flow.scenario === 'restoring') {
        expect(flow.original()).toBeUndefined();
      } else if (flow.scenario !== 'tag addition') {
        expect(flow.original()).not.toHaveTextContent(flow.oldText);
      }
    });
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
    await reads.complete(order, () => expect(successFlash(flow.result)).toBeVisible());
    const secrets = table('Secrets');
    expect(secrets?.findEmptySlot()?.getElement()).toBeVisible();
    expect(secrets?.findEmptySlot()?.getElement()).toHaveTextContent('No secrets');
    expect(secrets?.findRows()).toHaveLength(0);
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
  await waitFor(() => expect(dialogAlert(dialog, 'Not implemented by the emulator')).toBeVisible());
  expect(dialogAlert(dialog, 'Not implemented by the emulator')).toHaveTextContent(/for DeleteSecret/);
  expect(dialogButton(dialog, 'Schedule deletion')).toBeDisabled();
  submit(dialog, 'Cancel');
  await expectDialogClosed();
  expect(pageButton('Schedule deletion')).toBeDisabled();
  expect(pageButton('Permanently delete')).toBeDisabled();
  expect(pageButton(NEW_VERSION_LABEL)).toBeEnabled();
});
