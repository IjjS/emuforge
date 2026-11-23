import {
  DisableKeyRotationCommand,
  EnableKeyRotationCommand,
  GetKeyRotationStatusCommand,
  ListKeyRotationsCommand,
  RotateKeyOnDemandCommand,
  type GetKeyRotationStatusCommandOutput,
  type ListKeyRotationsCommandOutput,
} from '@aws-sdk/client-kms';
import Flashbar from '@cloudscape-design/components/flashbar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { creationDateText } from '../../../../components/format-date';
import { PageFlashContext, type FlashResult } from '../../../../components/page-flash';
import { Rotation } from './rotation';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../../../../../../../lib/aws/client-factory', () => ({ createAwsClient: () => ({ send }) }));

const keyId = 'local-key';
const connection = { engineOrigin: 'http://127.0.0.1:8310' };
const nextDate = new Date('2026-05-16T12:35:00Z');
const rotationDate = new Date('2026-02-04T14:15:00Z');
const enabledSettings = { KeyRotationEnabled: true, RotationPeriodInDays: 90, NextRotationDate: nextDate };

function RotationPage() {
  const [flash, setFlash] = useState<FlashResult>();
  return (
    <PageFlashContext.Provider value={{ show: setFlash, handOver: () => undefined }}>
      <Flashbar items={flash ? [...flash] : []} />
      <Rotation connection={connection} keyId={keyId} />
    </PageFlashContext.Provider>
  );
}

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RotationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function expectField(label: string, value: string) {
  expect(screen.getByText(label).closest('dt')?.nextElementSibling).toHaveTextContent(value);
}

beforeEach(() => send.mockReset());

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

    expect(await screen.findByText(creationDateText(nextDate))).toBeVisible();
    expectField('Automatic rotation', 'Enabled');
    expectField('Rotation period', '90 days');
    expectField('Next rotation date', creationDateText(nextDate));
    expect(await screen.findByRole('row', { name: `${creationDateText(rotationDate)} On-demand` })).toBeVisible();

    click('Next page');
    expect(await screen.findByRole('row', { name: `${creationDateText(earlier)} Automatic` })).toBeVisible();
    expect(screen.queryByText('On-demand')).toBeNull();
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
    const settings = Promise.withResolvers<GetKeyRotationStatusCommandOutput>();
    const history = Promise.withResolvers<ListKeyRotationsCommandOutput>();
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

    expect(await screen.findByText('No completed rotations')).toBeVisible();
    expect(await screen.findByText('Enabled')).toBeVisible();
    click('Rotate now');
    expect(await screen.findByText('On-demand rotation requested.')).toBeVisible();
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
    expect(await screen.findByRole('row', { name: `${creationDateText(rotationDate)} On-demand` })).toBeVisible();
    expect(screen.getByText('Loading rotation settings…')).toBeVisible();
    expect(screen.getByText('On-demand rotation requested.')).toBeVisible();

    await act(() => settings.resolve({ $metadata: {}, ...enabledSettings }));
    expect(await screen.findByText('Enabled')).toBeVisible();
    expect(screen.getByText('On-demand')).toBeVisible();
    expect(screen.getByText('On-demand rotation requested.')).toBeVisible();
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

    expect(await screen.findByText('Enabled')).toBeVisible();
    click('Rotate now');

    expect(await screen.findByText('RotateKeyOnDemand failed')).toBeVisible();
    expect(screen.getByText(new RegExp(reason))).toBeVisible();
    expectField('Automatic rotation', 'Enabled');
    expectField('Rotation period', '90 days');
    expectField('Next rotation date', creationDateText(nextDate));
    expect(screen.queryByText('On-demand rotation requested.')).toBeNull();
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

    expect(await screen.findByText('Disabled')).toBeVisible();
    click('Enable automatic rotation');
    expect(await screen.findByText('Automatic rotation enabled.')).toBeVisible();
    expect(await screen.findByText('Enabled')).toBeVisible();
    click('Disable automatic rotation');
    expect(await screen.findByText('Automatic rotation disabled.')).toBeVisible();
    expect(await screen.findByText('Disabled')).toBeVisible();
    expect(send.mock.calls.find(([command]) => command instanceof EnableKeyRotationCommand)).toEqual([
      expect.objectContaining({ input: { KeyId: keyId } }),
      { abortSignal: expect.any(AbortSignal) },
    ]);
    expect(send.mock.calls.find(([command]) => command instanceof DisableKeyRotationCommand)).toEqual([
      expect.objectContaining({ input: { KeyId: keyId } }),
      { abortSignal: expect.any(AbortSignal) },
    ]);
  });

  it('leaves an unimplemented action visible and disables it without disabling other operations', async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetKeyRotationStatusCommand) return enabledSettings;
      if (command instanceof ListKeyRotationsCommand) return { Rotations: [] };
      throw { $metadata: { httpStatusCode: 501 } };
    });
    open();

    expect(await screen.findByText('Enabled')).toBeVisible();
    click('Rotate now');
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/501 Not Implemented for RotateKeyOnDemand/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rotate now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disable automatic rotation' })).toBeEnabled();
  });
});
