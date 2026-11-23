import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { creationDateText } from '../../../../components/format-date';
import {
  BINARY_VALUE,
  chooseBinary,
  click,
  delayedReads,
  DELETION_DATE,
  denied,
  enter,
  expectList,
  lifecycleTests,
  NAME,
  NEW_KEY,
  notFound,
  openLifecycle,
  ORDERS,
  ORIGINAL_DESCRIPTION,
  ORIGINAL_KEY,
  ORIGINAL_TAG,
  ORIGINAL_VERSION,
  REFUSED,
  secretMetadata,
  STRING_VALUE,
} from './lifecycle-test-fixture';

lifecycleTests();

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
      expect(calls).toHaveBeenCalledWith('PutSecretValue', { SecretId: NAME, SecretBinary: BINARY_VALUE }),
    );
  });

  it('sends only the entered string when replacing a value with text', async () => {
    const { calls } = openLifecycle();
    const dialog = await openDialog('Edit secret value');
    enter('Secret value', STRING_VALUE, within(dialog));
    submit(dialog, 'Save secret value');
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith('PutSecretValue', { SecretId: NAME, SecretString: STRING_VALUE }),
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

describe.each([...CHANGES, DELETION])('$scenario', (flow) => {
  it('shows the rejection and preserves the original state on a fresh read', async () => {
    const initial = secretMetadata('initial' in flow ? flow.initial : undefined);
    const { count, calls } = openLifecycle({
      initial,
      handler: (operation) => (operation === flow.operation ? denied() : undefined),
    });
    const dialog = await submitEdit(flow);
    expect(await within(dialog).findByText(REFUSED, { exact: false })).toBeVisible();
    expect(calls).toHaveBeenCalledWith(flow.operation, { SecretId: NAME, ...flow.command });
    expect(screen.queryByText(flow.result)).not.toBeInTheDocument();
    submit(dialog, 'Cancel');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const reads = count('DescribeSecret');
    await click('Refresh');
    await waitFor(() => expect(count('DescribeSecret')).toBeGreaterThan(reads));
    expect(screen.getByText(flow.oldText)).toBeVisible();
    if (flow.newText !== undefined) expect(screen.queryByText(flow.newText)).not.toBeInTheDocument();
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
    expect(calls).toHaveBeenCalledWith(flow.operation, { SecretId: NAME, ...flow.command });
    if (flow.newText !== undefined) expect(await screen.findByText(flow.newText)).toBeVisible();
    if (flow.scenario === 'restoring')
      expect(await screen.findByRole('button', { name: 'Schedule deletion' })).toBeEnabled();
    if (flow.scenario !== 'tag addition') expect(screen.queryByText(flow.oldText)).not.toBeInTheDocument();
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
    expect(calls).toHaveBeenCalledWith('DeleteSecret', { SecretId: NAME, ...flow.command });
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
