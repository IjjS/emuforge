import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { click, CURRENT, delayedRefresh, denied, NAME, openSecret, ORDERS, REFUSAL } from './detail-support.test';

const ORIGINAL =
  '{"Version":"2012-10-17","Statement":[{"Sid":"Original","Effect":"Deny","Principal":"*","Action":"secretsmanager:GetSecretValue","Resource":"*"}]}';
const UPDATED = ORIGINAL.replace('Original', 'Updated');
const NO_POLICY = 'This secret has no resource policy.';
const GET = 'GetResourcePolicy';
const PUT = 'PutResourcePolicy';
const DELETE = 'DeleteResourcePolicy';
const VALIDATE = 'ValidateResourcePolicy';
const VALID = { body: { PolicyValidationPassed: true } };

afterEach(() => vi.unstubAllGlobals());

async function openPolicy() {
  await click('Resource policy');
}

async function editPolicy() {
  await click('Edit resource policy');
  return within(await screen.findByRole('dialog', { name: 'Edit resource policy' }));
}

async function removePolicy() {
  await click('Remove resource policy');
  return within(await screen.findByRole('dialog', { name: 'Remove resource policy' }));
}

function enter(dialog: ReturnType<typeof within>, document: string) {
  fireEvent.change(dialog.getByRole('textbox', { name: 'Policy document' }), { target: { value: document } });
}

async function validate(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByRole('button', { name: 'Validate policy' }));
  expect(await dialog.findByText('Policy validation passed.')).toBeVisible();
}

describe('Secret resource policy', () => {
  it('reads the policy on opening and shows the empty state for a response without a document', async () => {
    const { calls } = openSecret();
    await screen.findByRole('heading', { name: NAME, level: 1 });
    expect(calls.mock.calls.some(([operation]) => operation === GET)).toBe(false);
    await openPolicy();
    expect(await screen.findByText(NO_POLICY)).toBeVisible();
    expect(calls).toHaveBeenCalledWith(GET, { SecretId: NAME });
  });

  it('shows the returned policy document when opened', async () => {
    openSecret({ handler: (operation) => (operation === GET ? { body: { ResourcePolicy: ORIGINAL } } : undefined) });
    await openPolicy();
    expect(await screen.findByText(ORIGINAL)).toBeVisible();
    const dialog = await editPolicy();
    expect(dialog.getByRole('textbox', { name: 'Policy document' })).toHaveValue(ORIGINAL);
  });

  it('shows a read denial and can retry instead of showing the empty state', async () => {
    let reads = 0;
    openSecret({
      handler: (operation) => {
        if (operation === GET) return reads++ === 0 ? denied() : { body: { ResourcePolicy: ORIGINAL } };
      },
    });
    await openPolicy();
    expect(await screen.findByText(`${GET} was refused: ${REFUSAL}`)).toBeVisible();
    expect(screen.queryByText(NO_POLICY)).not.toBeInTheDocument();
    await click('Retry');
    expect(await screen.findByText(ORIGINAL)).toBeVisible();
  });

  it('shows validation diagnostics and blocks saving when the policy fails validation', async () => {
    const { calls } = openSecret({
      handler: (operation) =>
        operation === VALIDATE
          ? {
              body: {
                PolicyValidationPassed: false,
                ValidationErrors: [{ CheckName: 'Policy syntax', ErrorMessage: 'Missing Statement.' }],
              },
            }
          : undefined,
    });
    await openPolicy();
    const dialog = await editPolicy();
    enter(dialog, '{}');
    fireEvent.click(dialog.getByRole('button', { name: 'Validate policy' }));
    expect(await dialog.findByText('Policy syntax: Missing Statement.')).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Save policy' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(calls).toHaveBeenCalledWith(VALIDATE, { SecretId: NAME, ResourcePolicy: '{}' });
    expect(calls.mock.calls.some(([operation]) => operation === PUT)).toBe(false);
  });

  it('requires new validation after editing a validated policy', async () => {
    const { calls } = openSecret({ handler: (operation) => (operation === VALIDATE ? VALID : undefined) });
    await openPolicy();
    const dialog = await editPolicy();
    enter(dialog, ORIGINAL);
    await validate(dialog);
    const save = dialog.getByRole('button', { name: 'Save policy' });
    expect(save).toBeEnabled();
    enter(dialog, UPDATED);
    expect(save).toBeDisabled();
    expect(dialog.queryByText('Policy validation passed.')).not.toBeInTheDocument();
    await validate(dialog);
    expect(save).toBeEnabled();
    expect(calls).toHaveBeenCalledWith(VALIDATE, { SecretId: NAME, ResourcePolicy: UPDATED });
  });

  it('keeps the existing policy if removal is canceled', async () => {
    const { calls } = openSecret({
      handler: (operation) => (operation === GET ? { body: { ResourcePolicy: ORIGINAL } } : undefined),
    });
    await openPolicy();
    const dialog = await removePolicy();
    expect(dialog.getByText(`Remove the resource policy from ${NAME} in your local emulator?`)).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(ORIGINAL)).toBeVisible();
    expect(calls.mock.calls.some(([operation]) => operation === DELETE)).toBe(false);
  });

  it('keeps the editor draft after a save refusal and rereads the original policy', async () => {
    const { calls } = openSecret({
      handler: (operation) => {
        if (operation === GET) return { body: { ResourcePolicy: ORIGINAL } };
        if (operation === VALIDATE) return VALID;
        if (operation === PUT) return denied();
      },
    });
    await openPolicy();
    const dialog = await editPolicy();
    enter(dialog, UPDATED);
    await validate(dialog);
    fireEvent.click(dialog.getByRole('button', { name: 'Save policy' }));
    expect(await dialog.findByText(`${PUT} was refused: ${REFUSAL}`)).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Policy document' })).toHaveValue(UPDATED);
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await click('Discard');
    await openPolicy();
    await openPolicy();
    await waitFor(() => expect(calls.mock.calls.filter(([operation]) => operation === GET)).toHaveLength(2));
    expect(screen.getByText(ORIGINAL)).toBeVisible();
    expect(screen.queryByText(UPDATED)).not.toBeInTheDocument();
  });

  it('shows a removal refusal and rereads the original policy', async () => {
    const { calls } = openSecret({
      handler: (operation) => {
        if (operation === GET) return { body: { ResourcePolicy: ORIGINAL } };
        if (operation === DELETE) return denied();
      },
    });
    await openPolicy();
    const dialog = await removePolicy();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove resource policy' }));
    expect(await dialog.findByText(`${DELETE} was refused: ${REFUSAL}`)).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await openPolicy();
    await openPolicy();
    await waitFor(() => expect(calls.mock.calls.filter(([operation]) => operation === GET)).toHaveLength(2));
    expect(screen.getByText(ORIGINAL)).toBeVisible();
  });

  it('keeps policy editing available when removal returns 501', async () => {
    openSecret({
      handler: (operation) => {
        if (operation === GET) return { body: { ResourcePolicy: ORIGINAL } };
        if (operation === DELETE) return { body: { __type: 'NotImplemented' }, status: 501 };
      },
    });
    await openPolicy();
    const dialog = await removePolicy();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove resource policy' }));
    expect(await dialog.findByText(`The emulator answered 501 Not Implemented for ${DELETE}.`)).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Remove resource policy' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Remove resource policy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit resource policy' })).toBeEnabled();
  });
});

describe.each(ORDERS)('Policy refresh with %s', (order) => {
  it('shows the reread policy and area success result after saving the validated document', async () => {
    const refresh = delayedRefresh(PUT, GET, { [CURRENT]: ['AWSCURRENT'] }, { body: { ResourcePolicy: UPDATED } });
    const { calls } = openSecret({
      observe: refresh.operations,
      handler: (operation, input, request) =>
        operation === VALIDATE ? VALID : refresh.handler(operation, input, request),
    });
    await openPolicy();
    expect(await screen.findByText(NO_POLICY)).toBeVisible();
    const dialog = await editPolicy();
    enter(dialog, UPDATED);
    await validate(dialog);
    fireEvent.click(dialog.getByRole('button', { name: 'Save policy' }));
    await refresh.complete(order, 'Resource policy saved.');
    expect(screen.getByText(UPDATED)).toBeVisible();
    expect(calls).toHaveBeenCalledWith(PUT, { SecretId: NAME, ResourcePolicy: UPDATED });
  });

  it('shows the reread empty state and area success result after removal', async () => {
    const refresh = delayedRefresh(DELETE, GET, { [CURRENT]: ['AWSCURRENT'] }, { body: {} });
    const { calls } = openSecret({
      observe: refresh.operations,
      handler: (operation, input, request) =>
        refresh.handler(operation, input, request) ??
        (operation === GET ? { body: { ResourcePolicy: ORIGINAL } } : undefined),
    });
    await openPolicy();
    const dialog = await removePolicy();
    fireEvent.click(dialog.getByRole('button', { name: 'Remove resource policy' }));
    await refresh.complete(order, 'Resource policy removed.');
    expect(screen.getByText(NO_POLICY)).toBeVisible();
    expect(screen.queryByText(ORIGINAL)).not.toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith(DELETE, { SecretId: NAME });
  });
});
