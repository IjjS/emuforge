import {
  DisableKeyRotationCommand,
  EnableKeyRotationCommand,
  GetKeyRotationStatusCommand,
  ListKeyRotationsCommand,
  RotateKeyOnDemandCommand,
  type GetKeyRotationStatusCommandOutput,
  type KeyMetadata,
  type ListKeyRotationsCommandOutput,
} from '@aws-sdk/client-kms';
import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../../components/emulator-line';
import { creationDateText } from '../../../../components/format-date';
import { PageFlashContext, type FlashItem, type FlashResult } from '../../../../components/page-flash';
import { Rotation } from './rotation';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const keyId = 'local-key';
const connection = { engineOrigin: 'http://127.0.0.1:8310', result: undefined };
const offlineConnection: AreaConnection = {
  ...connection,
  result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9310 },
};
const reconnected: AreaConnection = {
  ...connection,
  result: {
    kind: 'connected',
    checkedAt: 2,
    emulator: { port: 9310, endpoint: 'https://127.0.0.1:9310' },
  },
};
const nextDate = new Date('2026-05-16T12:35:00Z');
const rotationDate = new Date('2026-02-04T14:15:00Z');
const enabledSettings = { KeyRotationEnabled: true, RotationPeriodInDays: 90, NextRotationDate: nextDate };
const page = createWrapper();

function RotationPage(props: ComponentProps<typeof Rotation>) {
  const [flash, setFlash] = useState<FlashResult>();
  return (
    <PageFlashContext.Provider value={{ show: setFlash, handOver: () => undefined }}>
      <Flashbar
        items={
          flash?.map((item) => ({
            ...item,
            dismissible: true,
            dismissLabel: 'Dismiss',
            onDismiss: () => setFlash(undefined),
          })) ?? []
        }
      />
      <Rotation {...props} />
    </PageFlashContext.Provider>
  );
}

function open(keySpec?: KeyMetadata['KeySpec'], writesEnabled = true) {
  const client = new QueryClient();
  const view = (currentConnection: AreaConnection, currentKey: string, allowWrites: boolean) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RotationPage connection={currentConnection} keyId={currentKey} keySpec={keySpec} writesEnabled={allowWrites} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view(connection, keyId, writesEnabled));
  return (currentConnection: AreaConnection, currentKey = keyId, allowWrites = writesEnabled) =>
    rerender(view(currentConnection, currentKey, allowWrites));
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function expectField(label: string, value: string) {
  const field = page
    .findKeyValuePairs()
    ?.findItems()
    .find((item) => item.findLabel()?.getElement().textContent === label);
  const element = field?.findValue()?.getElement();
  expect(element).toBeVisible();
  expect(element).toHaveTextContent(value);
}

function expectRotation(type: string, date: Date) {
  const history = page.findTable();
  expect(history?.findRows()).toHaveLength(1);
  const typeCell = history?.findBodyCell(1, 2)?.getElement();
  expect(typeCell).toBeVisible();
  expect(typeCell).toHaveTextContent(type);
  expect(history?.findBodyCell(1, 1)?.getElement()).toHaveTextContent(creationDateText(date));
}

function flashItem(type: FlashItem['type']) {
  return page.findFlashbar()?.findItemsByType(type)[0];
}

function expectSuccess(message: string) {
  const content = flashItem('success')?.findContent()?.getElement();
  expect(content).toBeVisible();
  expect(content).toHaveTextContent(message);
}

function pendingAnswer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  send.mockReset();
});

describe('Key rotation', () => {
  it('shows the returned settings and follows the next marker in rotation history', async () => {
    const earlier = new Date('2026-01-14T10:00:00Z');
    send.mockImplementation(async (command: GetKeyRotationStatusCommand | ListKeyRotationsCommand) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command.input.Marker === 'older-rotations') {
        return { Rotations: [{ RotationDate: earlier, RotationType: 'AUTOMATIC' }], Truncated: false };
      }
      return {
        Rotations: [{ RotationDate: rotationDate, RotationType: 'ON_DEMAND' }],
        Truncated: true,
        NextMarker: 'older-rotations',
      };
    });
    open();

    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    expectField('Rotation period', '90 days');
    expectField('Next rotation date', creationDateText(nextDate));
    await waitFor(() => expectRotation('On-demand', rotationDate));

    click('Next page');
    await waitFor(() => expectRotation('Automatic', earlier));
    expect(
      send.mock.calls.find(
        ([command]) => command instanceof ListKeyRotationsCommand && command.input.Marker === 'older-rotations',
      ),
    ).toEqual([
      expect.objectContaining({ input: { KeyId: keyId, Marker: 'older-rotations' } }),
      { abortSignal: expect.any(AbortSignal) },
    ]);
  });

  it('keeps the refreshed history and success notice when settings arrive later', async () => {
    const settings = pendingAnswer<GetKeyRotationStatusCommandOutput>();
    const history = pendingAnswer<ListKeyRotationsCommandOutput>();
    let requested = false;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) return requested ? settings.promise : enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return requested ? history.promise : { Rotations: [] };
      if (command instanceof RotateKeyOnDemandCommand) {
        requested = true;
        return {};
      }
      throw new Error('Unexpected KMS command');
    });
    open();

    await waitFor(() => {
      const empty = page.findTable()?.findEmptySlot()?.getElement();
      expect(empty).toBeVisible();
      expect(empty).toHaveTextContent('No completed rotations');
    });
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    click('Rotate now');
    await waitFor(() => expectSuccess('On-demand rotation requested.'));
    await waitFor(() => {
      expect(send.mock.calls.filter(([command]) => command instanceof GetKeyRotationStatusCommand)).toHaveLength(2);
      expect(send.mock.calls.filter(([command]) => command instanceof ListKeyRotationsCommand)).toHaveLength(2);
    });
    expect(send.mock.calls.find(([command]) => command instanceof RotateKeyOnDemandCommand)).toEqual([
      expect.objectContaining({ input: { KeyId: keyId } }),
      { abortSignal: expect.any(AbortSignal) },
    ]);

    await act(() =>
      history.resolve({ $metadata: {}, Rotations: [{ RotationDate: rotationDate, RotationType: 'ON_DEMAND' }] }),
    );
    await waitFor(() => expectRotation('On-demand', rotationDate));
    expect(screen.getByText('Loading rotation settings…')).toBeVisible();
    expectSuccess('On-demand rotation requested.');

    await act(() => settings.resolve({ $metadata: {}, ...enabledSettings }));
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    expectRotation('On-demand', rotationDate);
    expectSuccess('On-demand rotation requested.');
  });

  it('preserves the settings and shows the reason when rotation is refused for the key state', async () => {
    const reason = 'On-demand rotation requires the key to be enabled.';
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      throw {
        name: 'KMSInvalidStateException',
        message: reason,
        $fault: 'client',
        $metadata: { httpStatusCode: 400 },
      };
    });
    open();

    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    click('Rotate now');

    await waitFor(() =>
      expect(flashItem('error')?.findHeader()?.getElement()).toHaveTextContent('RotateKeyOnDemand failed'),
    );
    const content = flashItem('error')?.findContent()?.getElement();
    expect(content).toBeVisible();
    expect(content).toHaveTextContent(reason);
    expectField('Automatic rotation', 'Enabled');
    expectField('Rotation period', '90 days');
    expectField('Next rotation date', creationDateText(nextDate));
    expect(flashItem('success')).toBeUndefined();
  });

  it('enables and disables automatic rotation and shows the settings returned after each action', async () => {
    let automatic = false;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) {
        return automatic ? enabledSettings : { KeyRotationEnabled: false };
      }
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      if (command instanceof EnableKeyRotationCommand) automatic = true;
      if (command instanceof DisableKeyRotationCommand) automatic = false;
      return {};
    });
    open();

    await waitFor(() => expectField('Automatic rotation', 'Disabled'));
    click('Enable automatic rotation');
    await waitFor(() => expectSuccess('Automatic rotation enabled.'));
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    click('Disable automatic rotation');
    await waitFor(() => expectSuccess('Automatic rotation disabled.'));
    await waitFor(() => expectField('Automatic rotation', 'Disabled'));
    expect(send.mock.calls.find(([command]) => command instanceof EnableKeyRotationCommand)).toEqual([
      expect.objectContaining({ input: { KeyId: keyId } }),
      { abortSignal: expect.any(AbortSignal) },
    ]);
    expect(send.mock.calls.find(([command]) => command instanceof DisableKeyRotationCommand)).toEqual([
      expect.objectContaining({ input: { KeyId: keyId } }),
      { abortSignal: expect.any(AbortSignal) },
    ]);
  });

  it.each([
    ['Enable automatic rotation', 'EnableKeyRotation'],
    ['Rotate now', 'RotateKeyOnDemand'],
  ])('adds the key spec when %s receives an unsupported operation refusal', async (button, operation) => {
    const refusal = 'UnsupportedOperationException';
    const message = 'Rotation is unavailable for this key.';
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) return { KeyRotationEnabled: false };
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      throw { name: refusal, message, $fault: 'client', $metadata: { httpStatusCode: 400 } };
    });
    open('RSA_2048');

    await waitFor(() => expectField('Automatic rotation', 'Disabled'));
    click(button);

    await waitFor(() =>
      expect(flashItem('error')?.findHeader()?.getElement()).toHaveTextContent(`${operation} failed`),
    );
    const content = flashItem('error')?.findContent()?.getElement();
    expect(content).toBeVisible();
    expect(content).toHaveTextContent(`${refusal}: ${message}`);
    expect(content).toHaveTextContent('The emulator does not support this rotation operation on this RSA_2048 key.');
  });

  it('leaves an unimplemented action visible and disables it without disabling other operations', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      throw { $metadata: { httpStatusCode: 501 } };
    });
    open();

    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    click('Rotate now');
    await waitFor(() =>
      expect(flashItem('info')?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
    );
    const content = flashItem('info')?.findContent()?.getElement();
    expect(content).toBeVisible();
    expect(content).toHaveTextContent('501 Not Implemented for RotateKeyOnDemand');
    expect(screen.getByRole('button', { name: 'Rotate now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disable automatic rotation' })).toBeEnabled();
  });

  it('retains keyboard focus during a pending rotation and explains the disabled action after dismissal', async () => {
    const failure = { $metadata: { httpStatusCode: 501 } };
    const reply = pendingAnswer<typeof failure>();
    const user = userEvent.setup();
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      throw await reply.promise;
    });
    open();

    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    const rotate = screen.getByRole('button', { name: 'Rotate now' });
    rotate.focus();
    await user.keyboard('{Enter}{Enter}');

    expect(rotate).toHaveFocus();
    expect(rotate).toHaveAttribute('aria-disabled', 'true');
    expect(send.mock.calls.filter(([command]) => command instanceof RotateKeyOnDemandCommand)).toHaveLength(1);

    await act(() => reply.resolve(failure));

    const notice = flashItem('info');
    const header = notice?.findHeader()?.getElement();
    const dismiss = notice?.findDismissButton()?.getElement();
    if (!header || !dismiss) throw new Error('Expected a dismissible rotation result');
    expect(within(header).getByText('Not implemented by the emulator')).toHaveFocus();
    expect(dismiss).toHaveAccessibleName('Dismiss');
    await user.click(dismiss);
    expect(flashItem('info')).toBeUndefined();
    expect(rotate).toBeDisabled();
    expect(rotate).toHaveAccessibleDescription('The emulator does not implement RotateKeyOnDemand.');
    expect(screen.getByText('The emulator does not implement RotateKeyOnDemand.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disable automatic rotation' })).toBeEnabled();
  });

  it('blocks new writes until enabled and retains a pending refusal while writes are blocked', async () => {
    const reply = pendingAnswer<undefined>();
    const write = vi.fn<(signal: AbortSignal) => void>();
    send.mockImplementation(async (command: unknown, { abortSignal }: { abortSignal: AbortSignal }) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      write(abortSignal);
      await reply.promise;
      throw { $metadata: { httpStatusCode: 501 } };
    });
    const update = open(undefined, false);
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    const rotate = screen.getByRole('button', { name: 'Rotate now' });
    const toggle = screen.getByRole('button', { name: 'Disable automatic rotation' });

    expect(rotate).toBeDisabled();
    expect(toggle).toBeDisabled();
    fireEvent.click(rotate);
    fireEvent.click(toggle);
    expect(write).not.toHaveBeenCalled();

    update(connection, keyId, true);
    expect(rotate).toBeEnabled();
    fireEvent.click(rotate);
    const signal = write.mock.calls[0]?.[0];
    update(connection, keyId, false);
    expect(rotate).toHaveAttribute('aria-disabled', 'true');
    expect(signal?.aborted).toBe(false);
    await act(() => reply.resolve(undefined));
    expect(flashItem('info')?.findContent()?.getElement()).toHaveTextContent(
      '501 Not Implemented for RotateKeyOnDemand',
    );

    update(connection, keyId, true);
    expect(rotate).toBeDisabled();
    expect(rotate).toHaveAccessibleDescription('The emulator does not implement RotateKeyOnDemand.');
    expect(toggle).toBeEnabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each(['success', '501'] as const)(
    'preserves a held on-demand rotation across a same-target outage and reports its %s result',
    async (result) => {
      const reply = pendingAnswer<undefined>();
      const write = vi.fn<(signal: AbortSignal) => void>();
      send.mockImplementation(async (command: unknown, { abortSignal }: { abortSignal: AbortSignal }) => {
        if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
        if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
        write(abortSignal);
        await reply.promise;
        if (result === '501') throw { $metadata: { httpStatusCode: 501 } };
        return {};
      });
      const update = open();
      await waitFor(() => expectField('Automatic rotation', 'Enabled'));
      const rotate = screen.getByRole('button', { name: 'Rotate now' });
      rotate.focus();
      fireEvent.click(rotate);
      const signal = write.mock.calls[0]?.[0];
      expect(signal?.aborted).toBe(false);

      update(offlineConnection);
      expect(rotate).toHaveFocus();
      expect(rotate).toHaveAttribute('aria-disabled', 'true');
      expect(signal?.aborted).toBe(false);
      fireEvent.click(rotate);
      fireEvent.click(screen.getByRole('button', { name: /automatic rotation/ }));
      expect(write).toHaveBeenCalledTimes(1);

      await act(() => reply.resolve(undefined));
      if (result === 'success') {
        expectSuccess('On-demand rotation requested.');
      } else {
        expect(flashItem('info')?.findContent()?.getElement()).toHaveTextContent(
          '501 Not Implemented for RotateKeyOnDemand',
        );
      }
      expect(rotate).toBeDisabled();
      fireEvent.click(rotate);
      fireEvent.click(screen.getByRole('button', { name: /automatic rotation/ }));
      expect(write).toHaveBeenCalledTimes(1);

      update(reconnected);
      await waitFor(() => expectField('Automatic rotation', 'Enabled'));
      expect(signal?.aborted).toBe(false);
      if (result === 'success') {
        expect(rotate).toBeEnabled();
        expectSuccess('On-demand rotation requested.');
      } else {
        expect(rotate).toBeDisabled();
        expect(rotate).toHaveAccessibleDescription('The emulator does not implement RotateKeyOnDemand.');
      }
      expect(screen.getByRole('button', { name: 'Disable automatic rotation' })).toBeEnabled();
      expect(write).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the learned disable reason when a held rotation completes offline and settings refresh on reconnect', async () => {
    const rotation = pendingAnswer<undefined>();
    const settings = pendingAnswer<GetKeyRotationStatusCommandOutput>();
    const writes = vi.fn<(command: unknown) => void>();
    const readSettings = vi.fn();
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) {
        readSettings();
        return readSettings.mock.calls.length === 1 ? enabledSettings : settings.promise;
      }
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      writes(command);
      if (command instanceof DisableKeyRotationCommand) throw { $metadata: { httpStatusCode: 501 } };
      if (command instanceof RotateKeyOnDemandCommand) {
        await rotation.promise;
        return {};
      }
      throw new Error('Unexpected KMS command');
    });
    const update = open();
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    const disable = screen.getByRole('button', { name: 'Disable automatic rotation' });
    const rotate = screen.getByRole('button', { name: 'Rotate now' });
    const expectDisabledToggle = () => {
      expect(disable).toHaveAccessibleName('Disable automatic rotation');
      expect(disable).toBeDisabled();
      expect(disable).toHaveAccessibleDescription('The emulator does not implement DisableKeyRotation.');
      expect(screen.getByText('The emulator does not implement DisableKeyRotation.')).toBeVisible();
    };

    fireEvent.click(disable);
    await waitFor(expectDisabledToggle);
    fireEvent.click(rotate);
    update(offlineConnection);
    await act(() => rotation.resolve(undefined));

    expectSuccess('On-demand rotation requested.');
    expectDisabledToggle();
    expect(rotate).toBeDisabled();
    expect(readSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(disable);
    fireEvent.click(rotate);
    expect(writes).toHaveBeenCalledTimes(2);

    update(reconnected);
    await waitFor(() => expect(readSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loading rotation settings…')).toBeVisible();
    expectDisabledToggle();
    fireEvent.click(disable);

    await act(() => settings.resolve({ $metadata: {}, ...enabledSettings }));
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    expectDisabledToggle();
    expectSuccess('On-demand rotation requested.');
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['key', connection, 'other-key'],
    ['engine origin', { ...connection, engineOrigin: 'http://127.0.0.1:8311' }, keyId],
  ] as const)('aborts a held rotation when the %s changes', async (_identity, nextConnection, nextKey) => {
    const reply = pendingAnswer<undefined>();
    const write = vi.fn<(signal: AbortSignal) => void>();
    send.mockImplementation(async (command: unknown, { abortSignal }: { abortSignal: AbortSignal }) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      write(abortSignal);
      await reply.promise;
      return {};
    });
    const update = open();
    await waitFor(() => expectField('Automatic rotation', 'Enabled'));
    click('Rotate now');
    const signal = write.mock.calls[0]?.[0];
    expect(signal?.aborted).toBe(false);

    update(nextConnection, nextKey);

    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Rotate now' })).toBeEnabled();
    await act(() => reply.resolve(undefined));
    expect(flashItem('success')).toBeUndefined();
  });
});
