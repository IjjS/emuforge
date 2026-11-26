import { DescribeKeyCommand, ListAliasesCommand, ListKeysCommand } from '@aws-sdk/client-kms';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadArea } from '../../../../../../test/area-preload';
import { FakeEngine, renderApp } from '../../../../../../test/home-test-kit';
import { AWS_PROVIDER } from '../../../../provider';
import type { AreaConnection } from '../../../components/emulator-line';
import { KEY_PAGE_SIZE } from '../api';
import { KEYS_PATH } from '../paths';
import { KeysPage } from './keys';

await preloadArea(AWS_PROVIDER.loadArea);

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../lib/aws/client-factory', () => ({
  createAwsClient: () => ({ send: (...args: unknown[]) => Promise.resolve(send(...args) as unknown) }),
}));

const endpoint = 'http://127.0.0.1:8311';
const emulator = { port: 9311, endpoint: 'https://127.0.0.1:9311' };
const startPort = 9545;
const online = { engineOrigin: endpoint, result: { kind: 'connected', checkedAt: 0, emulator } } as const;
const page = createWrapper(document.body);

function open(connection: AreaConnection = { engineOrigin: endpoint, result: undefined }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <KeysPage connection={connection} params={{}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function keyEntry(id: string) {
  return { KeyId: id };
}

function aliasEntry(id: string) {
  return { TargetKeyId: id, AliasName: `alias/${id}` };
}

function answerKeyReads(command: DescribeKeyCommand | ListAliasesCommand, managedKeys: string[] = []) {
  const id = command.input.KeyId ?? '';
  if (command instanceof DescribeKeyCommand) {
    return {
      KeyMetadata: {
        KeyId: id,
        KeyManager: managedKeys.includes(id) ? 'AWS' : 'CUSTOMER',
        KeyState: 'Enabled',
        Description: `Description of ${id}`,
      },
    };
  }
  return { Aliases: [aliasEntry(id), aliasEntry('other-target')] };
}

function pendingAnswer() {
  let answer!: (value: unknown) => void;
  const promise = new Promise((resolve) => {
    answer = resolve;
  });
  return { answer, promise };
}

async function expectRow(id: string) {
  return waitFor(() => {
    for (const row of page.findTable()?.findRows() ?? []) {
      const element = row.getElement();
      const link = within(element).queryByRole('link', { name: id });
      if (link === null) continue;

      expect(link).toHaveAttribute('href', `/aws/kms/keys/${id}`);
      expect(element).toHaveTextContent(`alias/${id}`);
      expect(element).not.toHaveTextContent('alias/other-target');
      return element;
    }
    throw new Error(`Expected a table row for key ${id}`);
  });
}

function withinEmptySlot() {
  const slot = page.findTable()?.findEmptySlot();
  if (!slot) throw new Error('Expected the table empty slot');
  return within(slot.getElement());
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  send.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('customer managed keys', () => {
  it('shows loading before an empty response', async () => {
    const pending = pendingAnswer();
    send.mockReturnValue(pending.promise);
    open();

    const loading = page.findTable()?.findLoadingText()?.getElement();
    expect(loading).toBeVisible();
    expect(loading).toHaveTextContent('Loading keys…');
    await act(() => pending.answer({ Keys: [] }));
    await waitFor(() => expect(withinEmptySlot().getByText('No customer managed keys')).toBeVisible());
  });

  it('shows only customer keys and matches aliases to each key', async () => {
    send.mockImplementation((command: ListKeysCommand | DescribeKeyCommand | ListAliasesCommand) =>
      command instanceof ListKeysCommand
        ? { Keys: ['owned-a', 'managed', 'owned-b'].map(keyEntry) }
        : answerKeyReads(command, ['managed']),
    );
    open();

    const first = await expectRow('owned-a');
    const second = await expectRow('owned-b');
    expect(first).not.toHaveTextContent('alias/owned-b');
    expect(second).not.toHaveTextContent('alias/owned-a');
    expect(first).toHaveTextContent('Enabled');
    expect(second).toHaveTextContent('Description of owned-b');
    expect(screen.queryByRole('link', { name: 'managed' })).toBeNull();
    expect(
      send.mock.calls
        .map(([command]) => command as ListAliasesCommand)
        .filter((command) => command instanceof ListAliasesCommand)
        .map(({ input }) => input.KeyId),
    ).toEqual(['owned-a', 'owned-b']);
  });

  it('follows the marker when the first page has no customer keys and can go back', async () => {
    send.mockImplementation((command: ListKeysCommand | DescribeKeyCommand | ListAliasesCommand) => {
      if (command instanceof ListKeysCommand) {
        return command.input.Marker === 'next'
          ? { Keys: [keyEntry('later')] }
          : { Keys: [keyEntry('managed')], Truncated: true, NextMarker: 'next' };
      }
      return answerKeyReads(command, ['managed']);
    });
    open();

    await waitFor(() => expect(withinEmptySlot().getByText('No customer managed keys on this page')).toBeVisible());
    click('Next page');
    await expectRow('later');
    click('Previous page');
    await waitFor(() => expect(withinEmptySlot().getByText('No customer managed keys on this page')).toBeVisible());
    const inputs = send.mock.calls
      .map(([command]) => command as ListKeysCommand)
      .filter((command) => command instanceof ListKeysCommand)
      .map(({ input }) => input);
    expect(inputs).toEqual([undefined, 'next', undefined].map((Marker) => ({ Limit: KEY_PAGE_SIZE, Marker })));
  });

  it('keeps the refreshed keys and aliases when an older read settles last', async () => {
    const older = pendingAnswer();
    send.mockImplementation((command: ListKeysCommand | DescribeKeyCommand | ListAliasesCommand) => {
      if (command instanceof ListKeysCommand) {
        return { Keys: [keyEntry('new')] };
      }
      return answerKeyReads(command);
    });
    send.mockReturnValueOnce({ Keys: [keyEntry('old')], Truncated: true, NextMarker: 'old-marker' });
    send.mockImplementationOnce(() => ({ KeyMetadata: { KeyId: 'old', KeyManager: 'CUSTOMER' } }));
    send.mockReturnValueOnce(older.promise);
    open();

    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    click('Refresh');
    await expectRow('new');

    await act(() => older.answer({ Aliases: [aliasEntry('old')] }));
    await expectRow('new');
    expect(screen.queryByRole('link', { name: 'old' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the alias refusal and reads the row again on Retry', async () => {
    send.mockImplementation((command: ListKeysCommand | DescribeKeyCommand | ListAliasesCommand) =>
      command instanceof ListKeysCommand ? { Keys: [keyEntry('owned')] } : answerKeyReads(command),
    );
    send.mockReturnValueOnce({ Keys: [keyEntry('owned')] });
    send.mockReturnValueOnce({ KeyMetadata: { KeyId: 'owned', KeyManager: 'CUSTOMER' } });
    send.mockRejectedValueOnce({
      name: 'AccessDeniedException',
      message: 'Alias listing was refused for this key.',
      $fault: 'client',
      $metadata: { httpStatusCode: 400 },
    });
    open();

    await waitFor(() => expect(withinEmptySlot().getByText('Access denied')).toBeVisible());
    const empty = withinEmptySlot();
    expect(empty.getByText(/ListAliases was refused: Alias listing was refused for this key/)).toBeVisible();
    expect(empty.queryByText('No customer managed keys')).toBeNull();
    click('Retry');
    await expectRow('owned');
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
    {
      failure: {
        name: 'EmulatorUnavailable',
        message: `the emulator at https://127.0.0.1:${startPort} is not reachable (not_started): start the emulator on port ${startPort}`,
        $fault: 'server',
        $metadata: { httpStatusCode: 503 },
      },
      status: `Not started on port ${startPort}`,
      startInstruction: `start the emulator on port ${startPort}`,
    },
  ])(
    'shows $status when ListKeys fails while the frame is connected',
    async ({ failure, status, startInstruction }) => {
      send.mockRejectedValue(failure);
      open(online);

      await waitFor(() => {
        const indicator = page.findTable()?.findEmptySlot()?.findStatusIndicator()?.getElement();
        expect(indicator).toBeVisible();
        expect(indicator).toHaveTextContent(status);
      });
      const empty = withinEmptySlot();
      const connectionStatus = empty.getByRole('link', { name: 'Connection status' });
      if (startInstruction !== undefined) {
        expect(empty.getByText(failure.message)).toHaveTextContent(startInstruction);
      }
      expect(connectionStatus).toBeVisible();
      expect(connectionStatus).toHaveAttribute('href', '/');
      const retry = empty.getByRole('button', { name: 'Retry' });
      expect(retry).toBeVisible();

      if (startInstruction === undefined) {
        send.mockResolvedValue({ Keys: [] });
        fireEvent.click(retry);
        await waitFor(() => expect(withinEmptySlot().getByText('No customer managed keys')).toBeVisible());
      } else {
        send.mockImplementation((command: ListKeysCommand | DescribeKeyCommand | ListAliasesCommand) =>
          command instanceof ListKeysCommand ? { Keys: [keyEntry('recovered')] } : answerKeyReads(command),
        );
        fireEvent.click(retry);
        const row = await expectRow('recovered');
        expect(row).toHaveTextContent('Description of recovered');
      }
    },
  );

  it.each([
    {
      cause: 'an engine network rejection',
      failure: new TypeError('Failed to fetch'),
      status: `The EmuForge engine at ${endpoint} is not answering`,
    },
    {
      cause: 'EmulatorTimeout',
      failure: {
        name: 'EmulatorTimeout',
        message: `the emulator at ${emulator.endpoint} did not answer within 30 s`,
        $fault: 'server',
        $metadata: { httpStatusCode: 504 },
      },
      status: 'The emulator did not answer',
    },
    {
      cause: 'EmulatorUnavailable',
      failure: {
        name: 'EmulatorUnavailable',
        message: `the emulator at ${emulator.endpoint} is not reachable (not_started): start the emulator on port ${emulator.port}`,
        $fault: 'server',
        $metadata: { httpStatusCode: 503 },
      },
      status: 'The emulator did not answer',
    },
  ])('recovers a list read from $cause while first health is pending', async ({ failure, status }) => {
    const engine = new FakeEngine();
    engine.configPort = 8311;
    engine.healthAnswers = [{ hang: true }];
    vi.stubGlobal('fetch', engine.fetch);
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    send.mockRejectedValue(failure);
    renderApp(KEYS_PATH);

    const frame = createWrapper(
      await screen.findByRole('group', { name: 'Local emulator, not AWS' }, { timeout: 4000 }),
    );
    const expectChecking = () => {
      const indicator = frame.findStatusIndicator()?.getElement();
      expect(indicator).toBeVisible();
      expect(indicator).toHaveTextContent('Checking');
    };
    await waitFor(() => {
      const indicator = page.findTable()?.findEmptySlot()?.findStatusIndicator()?.getElement();
      expect(indicator).toBeVisible();
      expect(indicator).toHaveTextContent(status);
    });
    expectChecking();
    const empty = withinEmptySlot();
    if (!(failure instanceof TypeError)) expect(empty.getByText(failure.message)).toBeVisible();
    const connectionStatus = empty.getByRole('link', { name: 'Connection status' });
    expect(connectionStatus).toBeVisible();
    expect(connectionStatus).toHaveAttribute('href', '/');
    const retry = empty.getByRole('button', { name: 'Retry' });
    expect(retry).toBeVisible();

    send.mockImplementation((command: ListKeysCommand | DescribeKeyCommand | ListAliasesCommand) =>
      command instanceof ListKeysCommand ? { Keys: [keyEntry('recovered')] } : answerKeyReads(command),
    );
    fireEvent.click(retry);
    const row = await expectRow('recovered');
    expect(row).toHaveTextContent('Description of recovered');
    expectChecking();
    expect(engine.healths).toHaveLength(1);
    expect(engine.healths[0]?.aborted()).toBe(false);
  });

  it('names ListKeys when the emulator returns 501', async () => {
    send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 501 } });
    open();

    await waitFor(() => expect(withinEmptySlot().getByText('Not implemented by the emulator')).toBeVisible());
    const empty = withinEmptySlot();
    expect(empty.getByText(/answered 501 Not Implemented for ListKeys/)).toBeVisible();
    expect(empty.queryByText('No customer managed keys')).toBeNull();
  });
});
