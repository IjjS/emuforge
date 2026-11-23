import { DescribeKeyCommand, type KeyMetadata } from '@aws-sdk/client-kms';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import { KEY_PATH, keyPath, KEYS_PATH } from '../paths';
import { KeyPage } from './key';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const endpoint = 'http://127.0.0.1:8311';
const emulator = { port: 9311, endpoint: 'https://127.0.0.1:9311' };
const online = { engineOrigin: endpoint, result: { kind: 'connected', checkedAt: 0, emulator } } as const;
const metadata = {
  KeyId: '12345678-1234-1234-1234-123456789012',
  Arn: 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012',
  KeyState: 'Enabled',
  KeySpec: 'SYMMETRIC_DEFAULT',
  KeyUsage: 'ENCRYPT_DECRYPT',
  Origin: 'AWS_KMS',
  Description: 'Local payment events',
  CreationDate: new Date('2026-01-15T12:34:56Z'),
} satisfies KeyMetadata;

function CurrentKey({ connection }: { connection: AreaConnection }) {
  const { keyId = '' } = useParams();
  return <KeyPage connection={connection} params={{ keyId }} />;
}

function open(keyId: string, connection: AreaConnection = online) {
  const client = new QueryClient();
  const at = (current: AreaConnection) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[keyPath(keyId)]}>
        <Routes>
          <Route path={KEY_PATH} element={<CurrentKey connection={current} />} />
          <Route path={KEYS_PATH} element={<h1>Customer managed keys</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(at(connection));
  return (current: AreaConnection) => view.rerender(at(current));
}

function expectField(label: string, value: string) {
  const term = screen.getByText(label).closest('dt');
  expect(term?.nextElementSibling).toHaveTextContent(value);
}

beforeEach(() => {
  send.mockReset();
});

describe('key details', () => {
  it('reads the key ID from a direct route and displays the returned metadata', async () => {
    send.mockResolvedValue({ KeyMetadata: metadata });
    open(metadata.KeyId);

    await screen.findByRole('heading', { name: 'Key metadata' });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ input: { KeyId: metadata.KeyId } }), {
      abortSignal: expect.any(AbortSignal),
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DescribeKeyCommand);
    expectField('Key ID', metadata.KeyId);
    expectField('ARN', metadata.Arn);
    expectField('Status', metadata.KeyState);
    expectField('Key spec', metadata.KeySpec);
    expectField('Key usage', metadata.KeyUsage);
    expectField('Origin', metadata.Origin);
    expectField('Description', metadata.Description);
    const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(
      metadata.CreationDate,
    );
    expectField('Created', date);
    expect(screen.getByText('Created').closest('dt')?.nextElementSibling).toHaveTextContent(
      /\d{2}:\d{2}:56 \(UTC[+-]\d{2}:\d{2}\)/,
    );
  });

  it('offers a way back to the list when the key does not exist', async () => {
    send.mockRejectedValue({
      name: 'NotFoundException',
      $fault: 'client',
      $metadata: { httpStatusCode: 400 },
    });
    open('absent');

    expect(await screen.findByText('Key not found')).toBeVisible();
    const back = screen.getByRole('link', { name: 'View customer managed keys' });
    expect(back).toHaveAttribute('href', KEYS_PATH);
    fireEvent.click(back);
    expect(screen.getByRole('heading', { name: 'Customer managed keys' })).toBeVisible();
  });

  it('shows distinct engine and emulator recovery states and retries the key read', async () => {
    const showConnection = open(metadata.KeyId, {
      engineOrigin: endpoint,
      result: { kind: 'engine-unreachable', lastEmulatorPort: emulator.port, checkedAt: 1 },
    });

    const expectRecovery = (label: string, message: string) => {
      expect(screen.getByText(label)).toHaveTextContent(message);
      expect(screen.getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(screen.queryByText('Key not found')).toBeNull();
    };
    expectRecovery('The EmuForge engine at is not answering', `The EmuForge engine at ${endpoint} is not answering`);

    const down = { kind: 'emulator-unreachable', emulator, checkedAt: 2, message: '' } as const;
    showConnection({ engineOrigin: endpoint, result: { ...down, reason: 'not_started' } });
    expectRecovery('Not started on port', `Not started on port ${emulator.port}`);

    showConnection({ engineOrigin: endpoint, result: { ...down, reason: 'timeout' } });
    expectRecovery('Not answering at', `Not answering at ${emulator.endpoint}`);
    expect(send).not.toHaveBeenCalled();

    send.mockResolvedValue({ KeyMetadata: metadata });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Key metadata' })).toBeVisible();
  });
});
