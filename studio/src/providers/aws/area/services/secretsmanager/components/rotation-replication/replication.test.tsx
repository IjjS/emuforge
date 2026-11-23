import createWrapper from '@cloudscape-design/components/test-utils/dom';
import type ModalWrapper from '@cloudscape-design/components/test-utils/dom/modal';
import { waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buttonNamed,
  buttons,
  click,
  delayedRefresh,
  denied,
  dialogAlert,
  dialogButton,
  dialogInput,
  dialogNamed,
  expectDialogAlert,
  expectSuccess,
  findRow,
  flashContents,
  NAME,
  openSecret,
  ORDERS,
  REFUSAL,
  required,
  tableNamed,
} from './detail-support.test';

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
const REPLICAS = 'Regional replicas';
const PROMOTION = 'Promotion requires a connection to the replica Region. Studio uses us-east-1.';

afterEach(() => vi.unstubAllGlobals());

async function enterRegion(region = REGION, key?: string) {
  await click('Add');
  const dialog = await dialogNamed('Add replica');
  dialogInput(dialog, 'Target Region').setInputValue(region);
  if (key !== undefined) {
    dialogInput(dialog, 'KMS key ARN (optional)').setInputValue(key);
  }
  return dialog;
}

async function openRemoval() {
  await click(`Remove replica in ${REGION}`);
  return dialogNamed('Remove replica');
}

async function confirmRemoval() {
  const dialog = await openRemoval();
  dialogInput(dialog, CONFIRM).setInputValue(NAME);
  dialogButton(dialog, 'Remove replica').click();
  return dialog;
}

function contents(dialog: ModalWrapper) {
  return within(dialog.findContent().getElement());
}

function replicaRow() {
  return required(findRow(REPLICAS, REGION), `replica in ${REGION}`).getElement();
}

function expectEmpty() {
  const empty = required(tableNamed(REPLICAS).findEmptySlot(), 'empty replica slot');
  expect(within(empty.getElement()).getByText(EMPTY)).toBeVisible();
}

describe('Regional replicas', () => {
  it('keeps tag and replica actions inside their stacked rows on a narrow screen', async () => {
    openSecret({
      compact: true,
      metadata: {
        Tags: [{ Key: 'environment', Value: 'development' }],
        ReplicationStatus: [...EXISTING.ReplicationStatus, { Region: 'eu-west-1', Status: 'InSync' }],
      },
    });
    const tag = await waitFor(() => required(findRow('Tags', 'environment'), 'environment tag').getElement());
    expect(tableNamed('Tags').findColumnHeaders()).toHaveLength(1);
    expect(within(tag).getByText('development')).toBeVisible();
    expect(buttonNamed('Edit tag environment', createWrapper(tag)).getElement()).toBeVisible();
    expect(buttonNamed('Remove tag environment', createWrapper(tag)).getElement()).toBeVisible();

    expect(tableNamed(REPLICAS).findColumnHeaders()).toHaveLength(1);
    buttonNamed(`Remove replica in ${REGION}`, createWrapper(replicaRow())).click();
    const dialog = await dialogNamed('Remove replica');
    expect(contents(dialog).getByText(WARNING)).toBeVisible();
  });

  it('shows the empty state when the secret has no replicas', async () => {
    openSecret();
    await waitFor(expectEmpty);
  });

  it('omits the optional encryption key if it is empty', async () => {
    const { calls } = openSecret({
      handler: (operation) => (operation === ADD ? { body: {} } : undefined),
    });
    const dialog = await enterRegion();
    dialogButton(dialog, 'Add replica').click();
    await waitFor(() => expectSuccess(ADDED));
    expect(calls).toHaveBeenCalledWith(ADD, { SecretId: NAME, AddReplicaRegions: [{ Region: REGION }] });
  });

  it('shows InProgress from the primary secret after adding a replica', async () => {
    let added = false;
    openSecret({
      handler: (operation) => {
        if (operation === ADD) {
          added = true;
          return { body: {} };
        }
        if (operation === 'DescribeSecret' && added) {
          return { body: { Name: NAME, ReplicationStatus: [{ Region: REGION, Status: 'InProgress' }] } };
        }
      },
    });
    const dialog = await enterRegion();
    dialogButton(dialog, 'Add replica').click();
    const row = await waitFor(replicaRow);
    expect(within(row).getByText('InProgress')).toBeVisible();
  });

  it.each(ORDERS)('shows the replica and its returned InProgress status after refresh (%s)', async (order) => {
    const refresh = delayedRefresh(ADD, {
      ReplicationStatus: [{ Region: REGION, KmsKeyId: KEY, Status: 'InProgress' }],
    });
    const { calls } = openSecret({ handler: refresh.handler, observe: true });
    const dialog = await enterRegion(REGION, KEY);
    dialogButton(dialog, 'Add replica').click();
    await refresh.complete(order, ADDED, () => {
      const row = replicaRow();
      expect(within(row).getByText('InProgress')).toBeVisible();
      expect(row).toHaveTextContent(KEY);
    });
    expect(calls).toHaveBeenCalledWith(ADD, { SecretId: NAME, AddReplicaRegions: [{ Region: REGION, KmsKeyId: KEY }] });
  });

  it('shows the fixed-Region constraint alongside the replica without a promotion action', async () => {
    openSecret({ metadata: EXISTING });
    const row = await waitFor(replicaRow);
    expect(within(row).getByText(PROMOTION)).toBeVisible();
    expect(buttons(createWrapper(row)).map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/promote|stop replication/i)]),
    );
  });

  it('names the secret and Region and explains the permanence of removal', async () => {
    openSecret({ metadata: EXISTING });
    const dialog = await openRemoval();
    expect(contents(dialog).getByText(WARNING)).toBeVisible();
  });

  it('identifies the exact confirmation text next to the removal input', async () => {
    openSecret({ metadata: EXISTING });
    const dialog = await openRemoval();
    expect(contents(dialog).getByText(CONFIRM)).toBeVisible();
    expect(dialogInput(dialog, CONFIRM).findNativeInput().getElement()).toBeVisible();
  });

  it('requires the full name to submit removal', async () => {
    const { calls } = openSecret({ metadata: EXISTING });
    const dialog = await openRemoval();
    const confirmation = dialogInput(dialog, CONFIRM);
    const submit = dialogButton(dialog, 'Remove replica');
    expect(submit.getElement()).toBeDisabled();
    confirmation.setInputValue(`${NAME} `);
    expect(submit.getElement()).toBeDisabled();
    submit.click();
    expect(calls.mock.calls.some(([operation]) => operation === REMOVE)).toBe(false);
    confirmation.setInputValue(NAME);
    expect(submit.getElement()).toBeEnabled();
  });

  it('keeps the existing replica when the user cancels removal', async () => {
    const { calls } = openSecret({ metadata: EXISTING });
    const dialog = await openRemoval();
    dialogButton(dialog, 'Cancel').click();
    expect(replicaRow()).toBeVisible();
    expect(calls.mock.calls.some(([operation]) => operation === REMOVE)).toBe(false);
  });

  it.each(ORDERS)('removes the selected Region and preserves the success result during refresh (%s)', async (order) => {
    const refresh = delayedRefresh(REMOVE, {});
    const { calls } = openSecret({ metadata: EXISTING, handler: refresh.handler, observe: true });
    await confirmRemoval();
    await refresh.complete(order, REMOVED, () => {
      expectEmpty();
      expect(findRow(REPLICAS, REGION)).toBeUndefined();
    });
    expect(calls).toHaveBeenCalledWith(REMOVE, { SecretId: NAME, RemoveReplicaRegions: [REGION] });
  });

  it('disables Add alone when replication returns 501', async () => {
    openSecret({
      metadata: EXISTING,
      handler: (operation) => (operation === ADD ? { body: { __type: 'NotImplemented' }, status: 501 } : undefined),
    });
    const dialog = await enterRegion('eu-west-1');
    dialogButton(dialog, 'Add replica').click();
    await waitFor(() =>
      expect(dialogAlert(dialog).findContent()?.getElement()).toHaveTextContent(
        `The emulator answered 501 Not Implemented for ${ADD}.`,
      ),
    );
    expect(dialogAlert(dialog).findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
    expect(dialogButton(dialog, 'Add replica').getElement()).toBeDisabled();
    dialogButton(dialog, 'Cancel').click();
    expect(buttonNamed('Add').getElement()).toBeDisabled();
    const remove = await openRemoval();
    expect(contents(remove).getByText(WARNING)).toBeVisible();
  });

  it('shows an add refusal and refreshes to the same empty state', async () => {
    const { calls } = openSecret({ handler: (operation) => (operation === ADD ? denied() : undefined) });
    const dialog = await enterRegion();
    dialogButton(dialog, 'Add replica').click();
    await waitFor(() => expectDialogAlert(dialog, `${ADD} was refused: ${REFUSAL}`));
    expect(dialogInput(dialog, 'Target Region').getInputValue()).toBe(REGION);
    expect(flashContents()).not.toContain(ADDED);
    dialogButton(dialog, 'Cancel').click();
    await click('Refresh');
    await waitFor(() =>
      expect(calls.mock.calls.filter(([operation]) => operation === 'DescribeSecret')).toHaveLength(2),
    );
    await waitFor(() => expect(buttonNamed('Refresh').getElement()).toBeEnabled());
    expectEmpty();
  });

  it('shows a remove refusal and still displays the existing replica after refresh', async () => {
    const { calls } = openSecret({
      metadata: EXISTING,
      handler: (operation) => (operation === REMOVE ? denied() : undefined),
    });
    const dialog = await confirmRemoval();
    await waitFor(() => expectDialogAlert(dialog, `${REMOVE} was refused: ${REFUSAL}`));
    expect(flashContents()).not.toContain(REMOVED);
    dialogButton(dialog, 'Cancel').click();
    await click('Refresh');
    await waitFor(() =>
      expect(calls.mock.calls.filter(([operation]) => operation === 'DescribeSecret')).toHaveLength(2),
    );
    await waitFor(() => expect(buttonNamed('Refresh').getElement()).toBeEnabled());
    expect(await waitFor(replicaRow)).toBeVisible();
  });
});
