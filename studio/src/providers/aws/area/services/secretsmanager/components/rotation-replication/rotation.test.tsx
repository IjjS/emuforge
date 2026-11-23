import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { creationDateText } from '../../../../components/format-date';
import { click, delayedRefresh, denied, NAME, openSecret, ORDERS, REFUSAL } from './detail-support.test';

const ROTATE = 'RotateSecret';
const CANCEL = 'CancelRotateSecret';
const FUNCTION = 'arn:aws:lambda:us-east-1:000000000000:function:local-rotation';
const NEXT = 1_800_000_000;
const ACTIVE = {
  RotationEnabled: true,
  RotationLambdaARN: FUNCTION,
  RotationRules: { AutomaticallyAfterDays: 7 },
  NextRotationDate: NEXT,
};
const CANCELED = { ...ACTIVE, RotationEnabled: false, NextRotationDate: undefined };
const SAVED = 'Rotation schedule saved.';
const ACCEPTED = 'Rotation request accepted.';
const STOPPED = 'Rotation canceled.';
const NO_NEXT = 'No next rotation date';

afterEach(() => vi.unstubAllGlobals());

async function enterSchedule() {
  await click('Configure rotation');
  const dialog = within(await screen.findByRole('dialog', { name: 'Configure rotation' }));
  fireEvent.change(dialog.getByRole('textbox', { name: 'Rotation Lambda function ARN' }), {
    target: { value: FUNCTION },
  });
  fireEvent.change(dialog.getByRole('spinbutton', { name: 'Rotation interval (days)' }), {
    target: { value: '30' },
  });
  return dialog;
}

async function openRotationAction(title: string, submit: string) {
  await click(title);
  const dialog = within(await screen.findByRole('dialog', { name: title }));
  fireEvent.click(dialog.getByRole('button', { name: submit }));
  return dialog;
}

describe('Secret rotation', () => {
  it.each(ORDERS)('saves an interval without immediate rotation and shows refreshed settings (%s)', async (order) => {
    const next = NEXT + 86_400;
    const refresh = delayedRefresh(ROTATE, {
      ...ACTIVE,
      RotationRules: { AutomaticallyAfterDays: 30 },
      NextRotationDate: next,
    });
    const { calls } = openSecret({ handler: refresh.handler, observe: true });
    const dialog = await enterSchedule();
    fireEvent.click(dialog.getByRole('button', { name: 'Save schedule' }));
    await refresh.complete(order, SAVED, () => {
      expect(screen.getByText('30 days')).toBeVisible();
      expect(screen.getByText(creationDateText(new Date(next * 1000)))).toBeVisible();
      expect(screen.getByText('Enabled')).toBeVisible();
    });
    expect(calls).toHaveBeenCalledWith(ROTATE, {
      SecretId: NAME,
      RotationLambdaARN: FUNCTION,
      RotationRules: { AutomaticallyAfterDays: 30 },
      RotateImmediately: false,
    });
  });

  it.each(ORDERS)('shows acceptance and rereads settings after requesting immediate rotation (%s)', async (order) => {
    const next = NEXT + 86_400;
    const refresh = delayedRefresh(ROTATE, { ...ACTIVE, NextRotationDate: next });
    const { calls } = openSecret({ metadata: ACTIVE, handler: refresh.handler, observe: true });
    await openRotationAction('Rotate now', 'Request rotation');
    await refresh.complete(order, ACCEPTED, () => {
      expect(screen.getByText('Enabled')).toBeVisible();
      expect(screen.getByText(creationDateText(new Date(next * 1000)))).toBeVisible();
      expect(screen.queryByText(/rotation (completed|succeeded)/i)).not.toBeInTheDocument();
    });
    expect(calls).toHaveBeenCalledWith(ROTATE, { SecretId: NAME, RotateImmediately: true });
  });

  it.each(ORDERS)(
    'shows disabled rotation after cancel even when the schedule and function remain (%s)',
    async (order) => {
      const refresh = delayedRefresh(CANCEL, CANCELED);
      const { calls } = openSecret({ metadata: ACTIVE, handler: refresh.handler, observe: true });
      await openRotationAction('Cancel rotation', 'Cancel rotation');
      await refresh.complete(order, STOPPED, () => {
        expect(screen.getByText('Disabled')).toBeVisible();
        expect(screen.getByText(NO_NEXT)).toBeVisible();
        expect(screen.getByText('7 days')).toBeVisible();
        expect(screen.getByText(FUNCTION)).toBeVisible();
      });
      expect(calls).toHaveBeenCalledWith(CANCEL, { SecretId: NAME });
    },
  );

  it('preserves the schedule draft and shows the function invocation denial', async () => {
    const reason = 'Secrets Manager is not allowed to invoke the selected Lambda function.';
    openSecret({ handler: (operation) => (operation === ROTATE ? denied(reason) : undefined) });
    const dialog = await enterSchedule();
    fireEvent.click(dialog.getByRole('button', { name: 'Save schedule' }));
    expect(await dialog.findByText(`${ROTATE} was refused: ${reason}`)).toBeVisible();
    expect(dialog.getByRole('textbox', { name: 'Rotation Lambda function ARN' })).toHaveValue(FUNCTION);
    expect(screen.queryByText(SAVED)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Disabled')).toBeVisible();
  });

  it('shows why immediate rotation was refused without claiming acceptance', async () => {
    openSecret({
      metadata: ACTIVE,
      handler: (operation) => (operation === ROTATE ? denied() : undefined),
    });
    const dialog = await openRotationAction('Rotate now', 'Request rotation');
    expect(await dialog.findByText(`${ROTATE} was refused: ${REFUSAL}`)).toBeVisible();
    expect(screen.queryByText(ACCEPTED)).not.toBeInTheDocument();
  });

  it('shows the cancel refusal and still shows active rotation after refresh', async () => {
    const { calls } = openSecret({
      metadata: ACTIVE,
      handler: (operation) => (operation === CANCEL ? denied() : undefined),
    });
    const dialog = await openRotationAction('Cancel rotation', 'Cancel rotation');
    expect(await dialog.findByText(`${CANCEL} was refused: ${REFUSAL}`)).toBeVisible();
    expect(screen.queryByText(STOPPED)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await click('Refresh');
    await waitFor(() =>
      expect(calls.mock.calls.filter(([operation]) => operation === 'DescribeSecret')).toHaveLength(2),
    );
    expect(await screen.findByText('Enabled')).toBeVisible();
    expect(screen.getByText(creationDateText(new Date(NEXT * 1000)))).toBeVisible();
  });
});
