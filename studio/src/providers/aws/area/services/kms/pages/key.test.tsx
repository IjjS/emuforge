import { DescribeKeyCommand, ListKeysCommand, NotFoundException, type KeyMetadata } from '@aws-sdk/client-kms';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeEngine, renderApp } from '../../../../../../test/home-test-kit';
import { AWS_PROVIDER } from '../../../../provider';
import type { AreaConnection } from '../../../components/emulator-line';
import { patternParams } from '../../../screen-paths';
import { KEY_PATH, keyPath, KEYS_PATH } from '../paths';
import { KeyPage } from './key';
import { KeysPage } from './keys';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const endpoint = 'http://127.0.0.1:8311';
const emulator = { port: 9311, endpoint: 'https://127.0.0.1:9311' };
const online = { engineOrigin: endpoint, result: { kind: 'connected', checkedAt: 0, emulator } } as const;
const page = createWrapper(document.body);
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
  const { pathname } = useLocation();
  if (pathname === KEYS_PATH) return <KeysPage connection={connection} params={{}} />;

  const params = patternParams(KEY_PATH, pathname);
  if (params === undefined) throw new Error(`Expected a key detail path, received ${pathname}`);
  return <KeyPage connection={connection} params={params} />;
}

function open(keyId: string, connection: AreaConnection = online) {
  const client = new QueryClient();
  const at = (current: AreaConnection) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[keyPath(keyId)]}>
        <CurrentKey connection={current} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(at(connection));
  return (current: AreaConnection) => view.rerender(at(current));
}

function metadataHeading() {
  return page
    .findAllHeaders()
    .map((header) => header.findHeadingText().getElement())
    .find((heading) => heading.textContent === 'Key metadata');
}

function fieldValue(label: string) {
  const item = page
    .findAllKeyValuePairs()
    .flatMap((pairs) => pairs.findItems())
    .find((pair) => pair.findLabel()?.getElement().textContent === label);
  return item?.findValue()?.getElement();
}

function expectField(label: string, value: string) {
  expect(fieldValue(label)).toHaveTextContent(value);
}

beforeEach(() => {
  send.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('key details', () => {
  it('reads the key ID from a direct route and displays the returned metadata', async () => {
    send.mockResolvedValue({ KeyMetadata: metadata });
    open(metadata.KeyId);

    await waitFor(() => expect(metadataHeading()).toBeVisible());
    expect(send.mock.calls.filter(([command]) => command instanceof DescribeKeyCommand)).toEqual([
      [expect.objectContaining({ input: { KeyId: metadata.KeyId } }), { abortSignal: expect.any(AbortSignal) }],
    ]);
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
    const [time, offset] = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .format(metadata.CreationDate)
      .split(' GMT');
    expect(fieldValue('Created')?.textContent).toBe(`${date}, ${time} (UTC${offset || '+00:00'})`);
  });

  it('offers a way back to the list when the key does not exist', async () => {
    send.mockImplementation((command: unknown) => {
      if (command instanceof ListKeysCommand) return Promise.resolve({ Keys: [] });
      throw new NotFoundException({ message: 'Key not found', $metadata: { httpStatusCode: 400 } });
    });
    open('absent');

    expect(await screen.findByText('Key not found')).toBeVisible();
    const back = screen.getByRole('link', { name: 'View customer managed keys' });
    expect(back).toHaveAttribute('href', KEYS_PATH);
    fireEvent.click(back);
    const heading = page.findTable()?.findHeaderSlot()?.findHeader()?.findHeadingText().getElement();
    expect(heading).toBeVisible();
    expect(heading).toHaveTextContent('Customer managed keys');
  });

  it.each([
    {
      failure: new TypeError('Failed to fetch'),
      status: `The EmuForge engine at ${endpoint} is not answering`,
    },
    {
      failure: {
        name: 'EmulatorTimeout',
        message: 'The emulator did not answer in time.',
        $fault: 'server',
        $metadata: { httpStatusCode: 504 },
      },
      status: `Not answering at ${emulator.endpoint}`,
    },
  ])('shows $status when DescribeKey fails while the frame is connected', async ({ failure, status }) => {
    send.mockRejectedValue(failure);
    open(metadata.KeyId, online);

    const recovery = await waitFor(() => {
      const content = page.findContentLayout()?.findContent().findContainer()?.findContent();
      if (!content) throw new Error('Expected metadata read recovery');
      const indicator = content.findStatusIndicator()?.getElement();
      expect(indicator).toBeVisible();
      expect(indicator).toHaveTextContent(status);
      return within(content.getElement());
    });
    const connectionStatus = recovery.getByRole('link', { name: 'Connection status' });
    expect(connectionStatus).toBeVisible();
    expect(connectionStatus).toHaveAttribute('href', '/');
    const retry = recovery.getByRole('button', { name: 'Retry' });
    expect(retry).toBeVisible();

    send.mockResolvedValue({ KeyMetadata: metadata });
    fireEvent.click(retry);
    await waitFor(() => expect(metadataHeading()).toBeVisible());
  });

  // Bound: Loads the AWS area and its service screens before mounting the frame and starting the health check.
  it('recovers a failed direct key read while the first frame health response is pending', async () => {
    const engine = new FakeEngine();
    engine.configPort = 8311;
    engine.healthAnswers = [{ hang: true }];
    vi.stubGlobal('fetch', engine.fetch);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    send.mockRejectedValue(new TypeError('Failed to fetch'));
    await AWS_PROVIDER.loadArea();
    renderApp(keyPath(metadata.KeyId));

    const frame = await screen.findByRole('group', { name: 'Local emulator, not AWS' }, { timeout: 4000 });
    const recovery = await waitFor(() => {
      const content = page.findContentLayout()?.findContent().findContainer()?.findContent();
      if (!content) throw new Error('Expected metadata read recovery');
      const indicator = content.findStatusIndicator()?.getElement();
      expect(indicator).toBeVisible();
      expect(indicator).toHaveTextContent(`The EmuForge engine at ${endpoint} is not answering`);
      return within(content.getElement());
    });
    expect(within(frame).getByText('Checking')).toBeVisible();
    const connectionStatus = recovery.getByRole('link', { name: 'Connection status' });
    expect(connectionStatus).toBeVisible();
    expect(connectionStatus).toHaveAttribute('href', '/');
    const retry = recovery.getByRole('button', { name: 'Retry' });
    expect(retry).toBeVisible();

    send.mockResolvedValue({ KeyMetadata: metadata });
    fireEvent.click(retry);
    await waitFor(() => expect(metadataHeading()).toBeVisible());
    expectField('Key ID', metadata.KeyId);
    expectField('Description', metadata.Description);
    expect(within(frame).getByText('Checking')).toBeVisible();
    expect(engine.healths).toHaveLength(1);
    expect(engine.healths[0]?.aborted()).toBe(false);
  }, 15_000);

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
    await waitFor(() => expect(metadataHeading()).toBeVisible());
  });
});
