import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  click,
  CURRENT,
  delayedRefresh,
  denied,
  dialogButton,
  dialogContent,
  expectAlert,
  findDialog,
  NAME,
  openSecret,
  ORDERS,
  page,
  press,
  REFUSAL,
  refusalReread,
  required,
  section,
} from './detail-support.test';

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
  fireEvent.click((await section('Resource policy')).findExpandButton().getElement());
}

async function editPolicy() {
  await click('Edit resource policy');
  return findDialog('Edit resource policy');
}

async function removePolicy() {
  await click('Remove resource policy');
  return findDialog('Remove resource policy');
}

type PolicyDialog = Awaited<ReturnType<typeof findDialog>>;

function policyField(dialog: PolicyDialog) {
  return required(dialogContent(dialog).findTextarea(), 'policy document');
}

function enter(dialog: PolicyDialog, document: string) {
  fireEvent.change(policyField(dialog).findNativeTextarea().getElement(), { target: { value: document } });
}

function validationStatus(dialog: PolicyDialog) {
  return dialogContent(dialog).findStatusIndicator()?.getElement();
}

async function validate(dialog: PolicyDialog) {
  press(dialog, 'Validate policy');
  await waitFor(() => expect(validationStatus(dialog)).toHaveTextContent('Policy validation passed.'));
}

async function discardDraft(dialog: PolicyDialog) {
  press(dialog, 'Cancel');
  press(await findDialog('Discard what you entered?'), 'Discard');
}

describe('Secret resource policy', () => {
  it('reads the policy on opening and shows the empty state for a response without a document', async () => {
    const { calls } = openSecret();
    await waitFor(() =>
      expect(
        page()
          .findAllHeaders()
          .some((header) => header.findHeadingText().getElement().textContent === NAME),
      ).toBe(true),
    );
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
    expect(policyField(dialog).getTextareaValue()).toBe(ORIGINAL);
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
    press(dialog, 'Validate policy');
    await expectAlert(dialogContent(dialog), 'Policy syntax: Missing Statement.');
    const save = dialogButton(dialog, 'Save policy');
    expect(save.isDisabled()).toBe(true);
    fireEvent.click(save.getElement());
    expect(calls).toHaveBeenCalledWith(VALIDATE, { SecretId: NAME, ResourcePolicy: '{}' });
    expect(calls.mock.calls.some(([operation]) => operation === PUT)).toBe(false);
  });

  it('requires new validation after editing a validated policy', async () => {
    const { calls } = openSecret({ handler: (operation) => (operation === VALIDATE ? VALID : undefined) });
    await openPolicy();
    const dialog = await editPolicy();
    enter(dialog, ORIGINAL);
    await validate(dialog);
    const save = dialogButton(dialog, 'Save policy');
    expect(save.isDisabled()).toBe(false);
    enter(dialog, UPDATED);
    expect(save.isDisabled()).toBe(true);
    expect(validationStatus(dialog)).toBeUndefined();
    await validate(dialog);
    expect(save.isDisabled()).toBe(false);
    expect(calls).toHaveBeenCalledWith(VALIDATE, { SecretId: NAME, ResourcePolicy: UPDATED });
  });

  it('keeps the existing policy if removal is canceled', async () => {
    const { calls } = openSecret({
      handler: (operation) => (operation === GET ? { body: { ResourcePolicy: ORIGINAL } } : undefined),
    });
    await openPolicy();
    const dialog = await removePolicy();
    expect(dialog.findContent().getElement()).toHaveTextContent(
      `Remove the resource policy from ${NAME} in your local emulator?`,
    );
    press(dialog, 'Cancel');
    expect(screen.getByText(ORIGINAL)).toBeVisible();
    expect(calls.mock.calls.some(([operation]) => operation === DELETE)).toBe(false);
  });

  it('keeps the editor draft after a save refusal and rereads the original policy', async () => {
    const refused = refusalReread(PUT, GET, { body: { ResourcePolicy: ORIGINAL } });
    const subject = openSecret({
      handler: (operation, input, request) =>
        operation === VALIDATE ? VALID : refused.handler(operation, input, request),
    });
    await openPolicy();
    const dialog = await editPolicy();
    enter(dialog, UPDATED);
    await validate(dialog);
    press(dialog, 'Save policy');
    await expectAlert(dialogContent(dialog), `${PUT} was refused: ${REFUSAL}`);
    expect(policyField(dialog).getTextareaValue()).toBe(UPDATED);
    await discardDraft(dialog);
    await openPolicy();
    await openPolicy();
    await refused.complete(subject);
    expect(screen.getByText(ORIGINAL)).toBeVisible();
    expect(screen.queryByText(UPDATED)).not.toBeInTheDocument();
  });

  it('shows a removal refusal and rereads the original policy', async () => {
    const refused = refusalReread(DELETE, GET, { body: { ResourcePolicy: ORIGINAL } });
    const subject = openSecret({ handler: refused.handler });
    await openPolicy();
    const dialog = await removePolicy();
    press(dialog, 'Remove resource policy');
    await expectAlert(dialogContent(dialog), `${DELETE} was refused: ${REFUSAL}`);
    press(dialog, 'Cancel');
    await openPolicy();
    await openPolicy();
    await refused.complete(subject);
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
    press(dialog, 'Remove resource policy');
    await expectAlert(dialogContent(dialog), `The emulator answered 501 Not Implemented for ${DELETE}.`);
    expect(dialogButton(dialog, 'Remove resource policy').isDisabled()).toBe(true);
    press(dialog, 'Cancel');
    expect(screen.getByRole('button', { name: 'Remove resource policy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit resource policy' })).toBeEnabled();
  });
  it.each([VALIDATE, PUT])(
    'keeps the %s 501 explanation in the editor after edits and reopening',
    async (operation) => {
      const { calls } = openSecret({
        handler: (called) => {
          if (called === GET) return { body: { ResourcePolicy: ORIGINAL } };
          if (called === operation) return { body: { __type: 'NotImplemented' }, status: 501 };
          if (called === VALIDATE) return VALID;
        },
      });
      await openPolicy();
      const dialog = await editPolicy();
      if (operation === PUT) await validate(dialog);
      const unavailable = operation === VALIDATE ? 'Validate policy' : 'Save policy';
      const message = `The emulator answered 501 Not Implemented for ${operation}.`;
      press(dialog, unavailable);
      await expectAlert(dialogContent(dialog), message);
      expect(dialogButton(dialog, unavailable).isDisabled()).toBe(true);

      enter(dialog, UPDATED);
      await expectAlert(dialogContent(dialog), message);
      expect(dialogButton(dialog, unavailable).isDisabled()).toBe(true);
      await discardDraft(dialog);

      const reopened = await editPolicy();
      await expectAlert(dialogContent(reopened), message);
      if (operation === PUT) await validate(reopened);
      expect(dialogButton(reopened, unavailable).isDisabled()).toBe(true);
      press(reopened, unavailable);
      expect(calls.mock.calls.filter(([called]) => called === operation)).toHaveLength(1);
    },
  );
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
    press(dialog, 'Save policy');
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
    press(dialog, 'Remove resource policy');
    await refresh.complete(order, 'Resource policy removed.');
    expect(screen.getByText(NO_POLICY)).toBeVisible();
    expect(screen.queryByText(ORIGINAL)).not.toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith(DELETE, { SecretId: NAME });
  });
});
