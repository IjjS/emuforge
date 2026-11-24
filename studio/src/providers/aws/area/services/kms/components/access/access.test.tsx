import {
  CreateGrantCommand,
  DescribeKeyCommand,
  GetKeyPolicyCommand,
  ListGrantsCommand,
  ListKeyPoliciesCommand,
  PutKeyPolicyCommand,
  RevokeGrantCommand,
} from '@aws-sdk/client-kms';
import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../../area-root';
import { PageFlashContext } from '../../../../components/page-flash';
import { useKmsKey } from '../../queries';
import { Access, type AccessProps } from './access';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const KEY_ID = '98e1417e-67c5-4e6f-bbc8-9ee897c848fe';
const OLD_POLICY = '{"Statement":[{"Sid":"Original","Effect":"Allow","Action":"kms:*","Resource":"*"}]}';
const NEW_POLICY = OLD_POLICY.replace('Original', 'Changed');
const GRANTEE = 'arn:aws:iam::123456789012:role/log-writer';
const REFUSAL = 'The local emulator refused the change.';
const online = {
  engineOrigin: 'http://127.0.0.1:8309',
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9309, endpoint: 'https://127.0.0.1:9309' } },
} as const;
const offline: AccessProps['connection'] = {
  engineOrigin: online.engineOrigin,
  result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: online.result.emulator.port },
};

function KeyDetails() {
  const { key } = useKmsKey(online.engineOrigin, KEY_ID, true);
  return key ? <h1>{key.Description}</h1> : null;
}

function open(initial: Partial<AccessProps> = {}) {
  const client = new QueryClient();

  function Page(props: AccessProps) {
    const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);
    const rootRef = useRef<HTMLDivElement>(null);
    return (
      <div ref={rootRef}>
        <AreaRootContext.Provider value={rootRef}>
          <PageFlashContext.Provider value={{ show: (result) => setItems([...result]), handOver: vi.fn() }}>
            <Flashbar items={items} />
            <KeyDetails />
            <Access {...props} />
          </PageFlashContext.Provider>
        </AreaRootContext.Provider>
      </div>
    );
  }

  const page = (props: Partial<AccessProps>, targetGeneration = 0) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page key={targetGeneration} connection={online} keyId={KEY_ID} {...initial} {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(page({}));
  return (props: Partial<AccessProps>, targetGeneration?: number) => view.rerender(page(props, targetGeneration));
}

function fallback(command: unknown) {
  if (command instanceof ListKeyPoliciesCommand) return { PolicyNames: ['default'] };
  if (command instanceof GetKeyPolicyCommand) return { Policy: OLD_POLICY };
  if (command instanceof ListGrantsCommand) return { Grants: [] };
  if (command instanceof DescribeKeyCommand) return { KeyMetadata: { KeyId: KEY_ID, Description: 'Key details' } };
  throw new Error('Unexpected command');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function refusal() {
  return { name: 'ValidationException', message: REFUSAL, $fault: 'client', $metadata: { httpStatusCode: 400 } };
}

async function editPolicy() {
  expect(await screen.findByText(OLD_POLICY)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Edit key policy' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Edit key policy' }));
  const field = dialog.getByRole('textbox', { name: 'Policy document' });
  expect(field).toHaveValue(OLD_POLICY);
  fireEvent.change(field, { target: { value: NEW_POLICY } });
  fireEvent.click(dialog.getByRole('button', { name: 'Save policy' }));
  return dialog;
}

function expectCommand(command: object) {
  expect(send).toHaveBeenCalledWith(command, { abortSignal: expect.any(AbortSignal) });
}

const grant = { GrantId: 'grant-on-page-two', GranteePrincipal: GRANTEE, Operations: ['Encrypt', 'DescribeKey'] };

function grantsTable() {
  const table = createWrapper(screen.getByRole('region', { name: 'Grants' })).findTable();
  if (table === null) throw new Error('Expected the grants table.');
  return table;
}

function grantRow(id: string) {
  return grantsTable()
    .findRows()
    .map((row) => row.getElement())
    .find((row) => within(row).queryByText(id, { exact: true }) !== null);
}

function successFlash(message: string) {
  return createWrapper()
    .findFlashbar()
    ?.findItemsByType('success')
    .map((item) => item.findContent()?.getElement())
    .find((content) => content?.textContent === message);
}

async function openRevocation() {
  const revoke = await waitFor(() => {
    const row = grantRow(grant.GrantId);
    if (row === undefined) throw new Error(`Expected the row for grant ${grant.GrantId}.`);
    return within(row).getByRole('button', { name: `Revoke grant ${grant.GrantId}` });
  });
  fireEvent.click(revoke);
  return within(await screen.findByRole('dialog', { name: 'Revoke grant' }));
}

beforeEach(() => {
  send.mockReset();
});

describe('KMS key access', () => {
  it('reads the default policy and keeps the edited document and refusal when a save fails', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof PutKeyPolicyCommand) throw refusal();
      return fallback(command);
    });
    open();

    const dialog = await editPolicy();

    expect(await dialog.findByText(REFUSAL, { exact: false })).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Policy document' })).toHaveValue(NEW_POLICY);
    expectCommand(expect.objectContaining({ input: { KeyId: KEY_ID } }));
    expect(send.mock.calls.some(([command]) => command instanceof ListKeyPoliciesCommand)).toBe(true);
    expect(
      send.mock.calls.some(
        ([command]) => command instanceof GetKeyPolicyCommand && command.input.PolicyName === 'default',
      ),
    ).toBe(true);
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof PutKeyPolicyCommand &&
          command.input.KeyId === KEY_ID &&
          command.input.PolicyName === 'default' &&
          command.input.Policy === NEW_POLICY,
      ),
    ).toBe(true);
  });

  it('keeps the saved document and flash when the policy names finish after the document', async () => {
    const names = deferred<{ PolicyNames: string[] }>();
    let saved = false;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof PutKeyPolicyCommand) {
        saved = true;
        return {};
      }
      if (saved && command instanceof ListKeyPoliciesCommand) return names.promise;
      if (saved && command instanceof GetKeyPolicyCommand) return { Policy: NEW_POLICY };
      return fallback(command);
    });
    open();

    await editPolicy();

    await waitFor(() => expect(successFlash('Key policy saved.')).toBeVisible());
    expect(await screen.findByText(NEW_POLICY, { selector: ':not(textarea)' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit key policy' })).toBeDisabled();
    await act(async () => names.resolve({ PolicyNames: ['default'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit key policy' })).toBeEnabled());
    expect(screen.getByText(NEW_POLICY)).toBeVisible();
    expect(successFlash('Key policy saved.')).toBeVisible();
  });

  it('reads the next grants page and keeps the grant when revocation is cancelled', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListGrantsCommand) {
        return command.input.Marker === 'next-grants'
          ? { Grants: [grant] }
          : { Grants: [{ ...grant, GrantId: 'grant-on-page-one' }], Truncated: true, NextMarker: 'next-grants' };
      }
      return fallback(command);
    });
    open();

    await waitFor(() => expect(grantRow('grant-on-page-one')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      const row = grantRow(grant.GrantId);
      expect(row).toBeVisible();
      expect(row).toHaveTextContent(GRANTEE);
      expect(row).toHaveTextContent('Encrypt');
      expect(row).toHaveTextContent('DescribeKey');
    });
    expectCommand(expect.objectContaining({ input: { KeyId: KEY_ID, Marker: 'next-grants', Limit: 20 } }));

    const dialog = await openRevocation();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(grantRow(grant.GrantId)).toBeVisible());
    expect(send.mock.calls.some(([command]) => command instanceof RevokeGrantCommand)).toBe(false);
  });

  it('keeps the revoke result when the refreshed grant list finishes before the key details', async () => {
    const detail = deferred<{ KeyMetadata: { KeyId: string; Description: string } }>();
    let revoked = false;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof RevokeGrantCommand) {
        revoked = true;
        return {};
      }
      if (command instanceof ListGrantsCommand) return { Grants: revoked ? [] : [grant] };
      if (revoked && command instanceof DescribeKeyCommand) return detail.promise;
      return fallback(command);
    });
    open();
    expect(await screen.findByRole('heading', { name: 'Key details' })).toBeVisible();
    const dialog = await openRevocation();
    expect(dialog.getByText(grant.GrantId)).toBeVisible();
    expect(dialog.getByText(KEY_ID)).toBeVisible();
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'revoke' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Revoke grant' }));

    await waitFor(() => {
      expect(grantsTable().findEmptySlot()?.getElement()).toHaveTextContent('No grants');
      expect(grantRow(grant.GrantId)).toBeUndefined();
      expect(successFlash('Grant revoked.')).toBeVisible();
    });
    expectCommand(expect.objectContaining({ input: { KeyId: KEY_ID, GrantId: grant.GrantId } }));
    expect(send.mock.calls.filter(([command]) => command instanceof DescribeKeyCommand)).toHaveLength(2);
    await act(async () => detail.resolve({ KeyMetadata: { KeyId: KEY_ID, Description: 'Refreshed key details' } }));
    expect(await screen.findByRole('heading', { name: 'Refreshed key details' })).toBeVisible();
    expect(successFlash('Grant revoked.')).toBeVisible();
  });

  it('keeps the grantee and selected operations visible when CreateGrant is refused', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof CreateGrantCommand) throw refusal();
      return fallback(command);
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Create grant' }));
    const modal = await screen.findByRole('dialog', { name: 'Create grant' });
    const dialog = within(modal);
    const grantee = dialog.getByRole('textbox', { name: 'Grantee principal ARN' });
    fireEvent.change(grantee, { target: { value: GRANTEE } });
    const operations = createWrapper(modal).findMultiselect();
    if (operations === null) throw new Error('Expected the allowed operations field.');
    operations.openDropdown();
    await waitFor(() => expect(operations.findDropdown().findOptionByValue('Encrypt')).not.toBeNull());
    operations.selectOptionByValue('Encrypt');
    fireEvent.click(dialog.getByRole('button', { name: 'Create grant' }));

    expect(await dialog.findByText(REFUSAL, { exact: false })).toBeVisible();
    expect(grantee).toHaveValue(GRANTEE);
    expect(dialog.getByRole('button', { name: 'Remove Encrypt' })).toBeVisible();
    expectCommand(
      expect.objectContaining({ input: { KeyId: KEY_ID, GranteePrincipal: GRANTEE, Operations: ['Encrypt'] } }),
    );
  });

  it('keeps focus while saving, focuses the refusal, and restores the opener after dismissal', async () => {
    const response = deferred<undefined>();
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof PutKeyPolicyCommand) {
        await response.promise;
        throw refusal();
      }
      return fallback(command);
    });
    open();
    const user = userEvent.setup();
    await screen.findByText(OLD_POLICY);
    const opener = screen.getByRole('button', { name: 'Edit key policy' });
    await user.click(opener);
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit key policy' }));
    const save = dialog.getByRole('button', { name: 'Save policy' });
    await user.click(save);
    expect(save).toHaveFocus();
    expect(save).toHaveAttribute('aria-disabled', 'true');

    response.resolve(undefined);
    const reason = await dialog.findByText(REFUSAL, { exact: false });
    expect(document.activeElement).toContainElement(reason);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit key policy' })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('reports a JSON syntax error on the policy field without sending a save', async () => {
    send.mockImplementation(async (command: unknown) => fallback(command));
    open();
    const user = userEvent.setup();
    await screen.findByText(OLD_POLICY);
    await user.click(screen.getByRole('button', { name: 'Edit key policy' }));
    const modal = await screen.findByRole('dialog', { name: 'Edit key policy' });
    const dialog = within(modal);
    const field = dialog.getByRole('textbox', { name: 'Policy document' });
    fireEvent.change(field, { target: { value: '{"Statement":' } });
    await user.click(dialog.getByRole('button', { name: 'Save policy' }));

    const policyField = createWrapper(modal)
      .findAllFormFields()
      .find((candidate) => candidate.findLabel()?.getElement().textContent === 'Policy document');
    const error = policyField?.findError()?.getElement();
    expect(error).toBeVisible();
    expect(error).toHaveTextContent(/Invalid JSON/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(send.mock.calls.some(([command]) => command instanceof PutKeyPolicyCommand)).toBe(false);
  });

  it('keeps a dirty policy when the discard prompt is dismissed and drops it only on confirmation', async () => {
    send.mockImplementation(async (command: unknown) => fallback(command));
    open();
    const user = userEvent.setup();
    await screen.findByText(OLD_POLICY);
    const opener = screen.getByRole('button', { name: 'Edit key policy' });
    await user.click(opener);
    const editor = await screen.findByRole('dialog', { name: 'Edit key policy' });
    const field = within(editor).getByRole('textbox', { name: 'Policy document' });
    field.focus();
    fireEvent.change(field, { target: { value: NEW_POLICY } });
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard what you entered?' })).toBeNull());
    expect(field).toHaveValue(NEW_POLICY);
    expect(field).toHaveFocus();

    await user.click(within(editor).getByRole('button', { name: 'Close dialog' }));
    const confirm = await screen.findByRole('dialog', { name: 'Discard what you entered?' });
    await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
    expect(screen.getByText(OLD_POLICY)).toBeVisible();
  });

  it('keeps a pending policy save and announces its result across a same-target disconnect', async () => {
    const response = deferred<object>();
    let saveSignal: AbortSignal | undefined;
    let policy = OLD_POLICY;
    send.mockImplementation(async (command: unknown, options: { abortSignal: AbortSignal }) => {
      if (command instanceof PutKeyPolicyCommand) {
        saveSignal = options.abortSignal;
        const result = await response.promise;
        policy = NEW_POLICY;
        return result;
      }
      if (command instanceof GetKeyPolicyCommand) return { Policy: policy };
      return fallback(command);
    });
    const update = open();
    const dialog = await editPolicy();
    await waitFor(() => expect(saveSignal).toBeInstanceOf(AbortSignal));

    update({ connection: offline });
    expect(saveSignal?.aborted).toBe(false);
    expect(dialog.getByRole('textbox', { name: 'Policy document' })).toHaveValue(NEW_POLICY);
    expect(dialog.getByRole('button', { name: 'Save policy' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => response.resolve({}));

    expect(successFlash('Key policy saved.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit key policy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create grant' })).toBeDisabled();
    update({ connection: online });
    expect(await screen.findByText(NEW_POLICY)).toBeVisible();
    expect(successFlash('Key policy saved.')).toBeVisible();
  });

  it('gates Access writes before metadata and keeps a same-target grant dialog through connection changes', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListGrantsCommand) return { Grants: [grant] };
      return fallback(command);
    });
    const update = open({ writesEnabled: false });
    expect(await screen.findByText(OLD_POLICY)).toBeVisible();
    const controls = [
      screen.getByRole('button', { name: 'Edit key policy' }),
      screen.getByRole('button', { name: 'Create grant' }),
      await screen.findByRole('button', { name: `Revoke grant ${grant.GrantId}` }),
    ];
    for (const control of controls) {
      expect(control).toBeDisabled();
      fireEvent.click(control);
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      send.mock.calls.some(
        ([command]) =>
          command instanceof PutKeyPolicyCommand ||
          command instanceof CreateGrantCommand ||
          command instanceof RevokeGrantCommand,
      ),
    ).toBe(false);

    update({ writesEnabled: true });
    const dialog = await openRevocation();
    const confirmation = dialog.getByRole('textbox');
    fireEvent.change(confirmation, { target: { value: 'revoke' } });
    expect(dialog.getByRole('button', { name: 'Revoke grant' })).toBeEnabled();

    update({ connection: offline, writesEnabled: true });
    expect(confirmation).toHaveValue('revoke');
    const submit = dialog.getByRole('button', { name: 'Revoke grant' });
    expect(submit).toBeDisabled();
    fireEvent.keyDown(confirmation, { key: 'Enter', keyCode: 13 });
    expect(send.mock.calls.some(([command]) => command instanceof RevokeGrantCommand)).toBe(false);

    update({ connection: online, writesEnabled: true });
    expect(submit).toBeEnabled();
  });

  it('keeps a grant action 501 received while offline and clears it for another key or target', async () => {
    const response = deferred<undefined>();
    let revokeSignal: AbortSignal | undefined;
    send.mockImplementation(async (command: unknown, options: { abortSignal: AbortSignal }) => {
      if (command instanceof ListGrantsCommand) return { Grants: [grant] };
      if (command instanceof RevokeGrantCommand) {
        revokeSignal = options.abortSignal;
        await response.promise;
        throw { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } };
      }
      return fallback(command);
    });
    const update = open();

    async function startRevocation() {
      revokeSignal = undefined;
      const dialog = await openRevocation();
      fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'revoke' } });
      fireEvent.click(dialog.getByRole('button', { name: 'Revoke grant' }));
      await waitFor(() => expect(revokeSignal).toBeInstanceOf(AbortSignal));
    }

    const revokeName = `Revoke grant ${grant.GrantId}`;
    const notice = 'The emulator answered 501 Not Implemented for RevokeGrant.';
    await startRevocation();
    update({ connection: offline });
    expect(revokeSignal?.aborted).toBe(false);
    await act(async () => response.resolve(undefined));
    expect(grantsTable().findFooterSlot()?.getElement()).toHaveTextContent(notice);
    update({ connection: online });
    expect(await screen.findByRole('button', { name: revokeName })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create grant' })).toBeEnabled();

    const nextKey = 'e89de8d1-a905-432b-adfd-c510da7413aa';
    update({ keyId: nextKey });
    expect(await screen.findByRole('button', { name: revokeName })).toBeEnabled();
    await startRevocation();
    await waitFor(() => expect(grantsTable().findFooterSlot()?.getElement()).toHaveTextContent(notice));
    expect(screen.getByRole('button', { name: revokeName })).toBeDisabled();

    // The AWS area's target generation remounts the page even when the engine origin and key ID are unchanged.
    update({ keyId: nextKey }, 1);
    expect(await screen.findByRole('button', { name: revokeName })).toBeEnabled();
  });
});
