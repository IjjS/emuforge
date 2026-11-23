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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../../area-root';
import { PageFlashContext } from '../../../../components/page-flash';
import { useKmsKey } from '../../queries';
import { Access } from './access';

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

function KeyDetails() {
  const { key } = useKmsKey(online.engineOrigin, KEY_ID, true);
  return key ? <h1>{key.Description}</h1> : null;
}

function open() {
  const client = new QueryClient();

  function Page() {
    const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);
    const [root] = useState(() => ({ current: null as HTMLDivElement | null }));
    return (
      <div
        ref={(element) => {
          root.current = element;
        }}
      >
        <AreaRootContext.Provider value={root}>
          <PageFlashContext.Provider value={{ show: (result) => setItems([...result]), handOver: vi.fn() }}>
            <Flashbar items={items} />
            <KeyDetails />
            <Access connection={online} keyId={KEY_ID} />
          </PageFlashContext.Provider>
        </AreaRootContext.Provider>
      </div>
    );
  }

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fallback(command: unknown) {
  if (command instanceof ListKeyPoliciesCommand) return { PolicyNames: ['default'] };
  if (command instanceof GetKeyPolicyCommand) return { Policy: OLD_POLICY };
  if (command instanceof ListGrantsCommand) return { Grants: [] };
  if (command instanceof DescribeKeyCommand) return { KeyMetadata: { KeyId: KEY_ID, Description: 'Key details' } };
  throw new Error('Unexpected command');
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

async function openRevocation() {
  fireEvent.click(await screen.findByRole('button', { name: `Revoke grant ${grant.GrantId}` }));
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
    const names = Promise.withResolvers<{ PolicyNames: string[] }>();
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

    expect(await screen.findByText(NEW_POLICY)).toBeVisible();
    expect(screen.getByText('Key policy saved.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit key policy' })).toBeDisabled();
    await act(async () => names.resolve({ PolicyNames: ['default'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit key policy' })).toBeEnabled());
    expect(screen.getByText(NEW_POLICY)).toBeVisible();
    expect(screen.getByText('Key policy saved.')).toBeVisible();
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

    await screen.findByText('grant-on-page-one');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const id = await screen.findByText(grant.GrantId);
    const row = id.closest('tr');
    expect(row).toHaveTextContent(GRANTEE);
    expect(row).toHaveTextContent('Encrypt');
    expect(row).toHaveTextContent('DescribeKey');
    expectCommand(expect.objectContaining({ input: { KeyId: KEY_ID, Marker: 'next-grants', Limit: 20 } }));

    const dialog = await openRevocation();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText(grant.GrantId)).toBeVisible();
    expect(send.mock.calls.some(([command]) => command instanceof RevokeGrantCommand)).toBe(false);
  });

  it('keeps the revoke result when the refreshed grant list finishes before the key details', async () => {
    const detail = Promise.withResolvers<{ KeyMetadata: { KeyId: string; Description: string } }>();
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

    expect(await screen.findByText('No grants')).toBeVisible();
    expect(screen.queryByText(grant.GrantId)).not.toBeInTheDocument();
    expect(screen.getByText('Grant revoked.')).toBeVisible();
    expectCommand(expect.objectContaining({ input: { KeyId: KEY_ID, GrantId: grant.GrantId } }));
    expect(send.mock.calls.filter(([command]) => command instanceof DescribeKeyCommand)).toHaveLength(2);
    await act(async () => detail.resolve({ KeyMetadata: { KeyId: KEY_ID, Description: 'Refreshed key details' } }));
    expect(await screen.findByRole('heading', { name: 'Refreshed key details' })).toBeVisible();
    expect(screen.getByText('Grant revoked.')).toBeVisible();
  });

  it('keeps the grantee and selected operations visible when CreateGrant is refused', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof CreateGrantCommand) throw refusal();
      return fallback(command);
    });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Create grant' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Create grant' }));
    const grantee = dialog.getByRole('textbox', { name: 'Grantee principal ARN' });
    fireEvent.change(grantee, { target: { value: GRANTEE } });
    fireEvent.click(dialog.getByRole('button', { name: /Allowed operations|Choose operations/ }));
    fireEvent.click(await dialog.findByRole('option', { name: 'Encrypt' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Create grant' }));

    expect(await dialog.findByText(REFUSAL, { exact: false })).toBeVisible();
    expect(grantee).toHaveValue(GRANTEE);
    expect(dialog.getByRole('button', { name: 'Remove Encrypt' })).toBeVisible();
    expectCommand(
      expect.objectContaining({ input: { KeyId: KEY_ID, GranteePrincipal: GRANTEE, Operations: ['Encrypt'] } }),
    );
  });
});
