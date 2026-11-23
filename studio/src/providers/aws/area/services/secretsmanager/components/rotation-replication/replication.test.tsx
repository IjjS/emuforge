import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { click, delayedRefresh, denied, NAME, openSecret, ORDERS, REFUSAL } from './detail-support.test';

const ADD = 'ReplicateSecretToRegions';
const REMOVE = 'RemoveRegionsFromReplication';
const REGION = 'us-west-2';
const KEY = 'arn:aws:kms:us-west-2:000000000000:key/replica-key';
const EXISTING = { ReplicationStatus: [{ Region: REGION, Status: 'InSync' }] };
const EMPTY = 'This secret has no replicas.';
const ADDED = 'Replication request accepted.';
const REMOVED = 'Replica removed.';
const WARNING = `Remove the replica of ${NAME} from ${REGION}? This permanently deletes the replica and its data from that Region in your local emulator.`;
const CONFIRM = `Type ${NAME} to confirm.`;
const PROMOTION = 'Promotion requires a connection to the replica Region. Studio uses us-east-1.';

afterEach(() => vi.unstubAllGlobals());

async function enterRegion(region = REGION, key?: string) {
  await click('Add');
  const dialog = within(await screen.findByRole('dialog', { name: 'Add replica' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Target Region' }), { target: { value: region } });
  if (key !== undefined) {
    fireEvent.change(dialog.getByRole('textbox', { name: 'KMS key ARN (optional)' }), { target: { value: key } });
  }
  return dialog;
}

async function openRemoval() {
  await click(`Remove replica in ${REGION}`);
  return within(await screen.findByRole('dialog', { name: 'Remove replica' }));
}

async function confirmRemoval() {
  const dialog = await openRemoval();
  fireEvent.change(dialog.getByRole('textbox', { name: CONFIRM }), { target: { value: NAME } });
  fireEvent.click(dialog.getByRole('button', { name: 'Remove replica' }));
  return dialog;
}

describe('Regional replicas', () => {
  it('shows the empty state when the secret has no replicas', async () => {
    openSecret();
    expect(await screen.findByText(EMPTY)).toBeVisible();
  });

  it('omits the optional encryption key if it is empty', async () => {
    const { calls } = openSecret({
      handler: (operation) => (operation === ADD ? { body: {} } : undefined),
    });
    const dialog = await enterRegion();
    fireEvent.click(dialog.getByRole('button', { name: 'Add replica' }));
    expect(await screen.findByText(ADDED)).toBeVisible();
    expect(calls).toHaveBeenCalledWith(ADD, { SecretId: NAME, AddReplicaRegions: [{ Region: REGION }] });
  });

  it.each(ORDERS)('shows the replica and its returned InProgress status after refresh (%s)', async (order) => {
    const refresh = delayedRefresh(ADD, {
      ReplicationStatus: [{ Region: REGION, KmsKeyId: KEY, Status: 'InProgress' }],
    });
    const { calls } = openSecret({ handler: refresh.handler, observe: true });
    const dialog = await enterRegion(REGION, KEY);
    fireEvent.click(dialog.getByRole('button', { name: 'Add replica' }));
    await refresh.complete(order, ADDED, () => {
      const row = screen.getByRole('row', { name: new RegExp(REGION) });
      expect(within(row).getByText('InProgress')).toBeVisible();
      expect(within(row).getByText(KEY)).toBeVisible();
    });
    expect(calls).toHaveBeenCalledWith(ADD, { SecretId: NAME, AddReplicaRegions: [{ Region: REGION, KmsKeyId: KEY }] });
  });

  it('shows the fixed-Region constraint alongside the replica without a promotion action', async () => {
    openSecret({ metadata: EXISTING });
    const row = await screen.findByRole('row', { name: new RegExp(REGION) });
    expect(within(row).getByText(PROMOTION)).toBeVisible();
    expect(within(row).queryByRole('button', { name: /promote|stop replication/i })).not.toBeInTheDocument();
  });

  it('identifies the secret and Region and requires the full name to submit', async () => {
    const { calls } = openSecret({ metadata: EXISTING });
    const dialog = await openRemoval();
    expect(dialog.getByText(WARNING)).toBeVisible();
    const confirmation = dialog.getByRole('textbox', { name: CONFIRM });
    expect(dialog.getByText(CONFIRM)).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'Remove replica' });
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: `${NAME} ` } });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(calls.mock.calls.some(([operation]) => operation === REMOVE)).toBe(false);
    fireEvent.change(confirmation, { target: { value: NAME } });
    expect(submit).toBeEnabled();
  });

  it('keeps the existing replica when the user cancels removal', async () => {
    const { calls } = openSecret({ metadata: EXISTING });
    const dialog = await openRemoval();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('row', { name: new RegExp(REGION) })).toBeVisible();
    expect(calls.mock.calls.some(([operation]) => operation === REMOVE)).toBe(false);
  });

  it.each(ORDERS)('removes the selected Region and preserves the success result during refresh (%s)', async (order) => {
    const refresh = delayedRefresh(REMOVE, {});
    const { calls } = openSecret({ metadata: EXISTING, handler: refresh.handler, observe: true });
    await confirmRemoval();
    await refresh.complete(order, REMOVED, () => {
      expect(screen.getByText(EMPTY)).toBeVisible();
      expect(screen.queryByRole('row', { name: new RegExp(REGION) })).not.toBeInTheDocument();
    });
    expect(calls).toHaveBeenCalledWith(REMOVE, { SecretId: NAME, RemoveReplicaRegions: [REGION] });
  });

  it('disables Add alone when replication returns 501', async () => {
    openSecret({
      metadata: EXISTING,
      handler: (operation) => (operation === ADD ? { body: { __type: 'NotImplemented' }, status: 501 } : undefined),
    });
    const dialog = await enterRegion('eu-west-1');
    fireEvent.click(dialog.getByRole('button', { name: 'Add replica' }));
    expect(await dialog.findByText(`The emulator answered 501 Not Implemented for ${ADD}.`)).toBeVisible();
    expect(dialog.getByText('Not implemented by the emulator')).toBeVisible();
    expect(dialog.getByRole('button', { name: 'Add replica' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    const remove = await openRemoval();
    expect(remove.getByText(WARNING)).toBeVisible();
  });

  it('shows an add refusal and refreshes to the same empty state', async () => {
    const { calls } = openSecret({ handler: (operation) => (operation === ADD ? denied() : undefined) });
    const dialog = await enterRegion();
    fireEvent.click(dialog.getByRole('button', { name: 'Add replica' }));
    expect(await dialog.findByText(`${ADD} was refused: ${REFUSAL}`)).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Target Region' })).toHaveValue(REGION);
    expect(screen.queryByText(ADDED)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await click('Refresh');
    await waitFor(() =>
      expect(calls.mock.calls.filter(([operation]) => operation === 'DescribeSecret')).toHaveLength(2),
    );
    expect(screen.getByText(EMPTY)).toBeVisible();
  });

  it('shows a remove refusal and still displays the existing replica after refresh', async () => {
    const { calls } = openSecret({
      metadata: EXISTING,
      handler: (operation) => (operation === REMOVE ? denied() : undefined),
    });
    const dialog = await confirmRemoval();
    expect(await dialog.findByText(`${REMOVE} was refused: ${REFUSAL}`)).toBeVisible();
    expect(screen.queryByText(REMOVED)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await click('Refresh');
    await waitFor(() =>
      expect(calls.mock.calls.filter(([operation]) => operation === 'DescribeSecret')).toHaveLength(2),
    );
    expect(await screen.findByRole('row', { name: new RegExp(REGION) })).toBeVisible();
  });
});
