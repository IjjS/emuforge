import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { creationDateText } from '../../../../components/format-date';
import {
  buttonNamed,
  click,
  delayedRefresh,
  denied,
  dialogButton,
  dialogInput,
  dialogNamed,
  expectDialogAlert,
  expectSuccess,
  flashContents,
  NAME,
  openSecret,
  ORDERS,
  page,
  REFUSAL,
  required,
} from './detail-support.test';

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
  const dialog = await dialogNamed('Configure rotation');
  dialogInput(dialog, 'Rotation Lambda function ARN').setInputValue(FUNCTION);
  dialogInput(dialog, 'Rotation interval (days)').setInputValue('30');
  return dialog;
}

async function openRotationAction(title: string, submit: string) {
  await click(title);
  const dialog = await dialogNamed(title);
  dialogButton(dialog, submit).click();
  return dialog;
}

function expectField(label: string, value: string) {
  const pairs = page.findAllKeyValuePairs().flatMap((group) => group.findItems());
  const field = pairs
    .flatMap((item) => {
      const group = item.findGroupPairs();
      return group?.length ? group : [item];
    })
    .find((pair) => pair.findLabel()?.getElement().textContent?.trim() === label);
  const fieldValue = required(field?.findValue(), `value for "${label}"`).getElement();
  expect(fieldValue).toBeVisible();
  expect(fieldValue).toHaveTextContent(value);
}

describe('Secret rotation', () => {
  it('sends the function and interval with immediate rotation disabled', async () => {
    const { calls } = openSecret({ handler: (operation) => (operation === ROTATE ? { body: {} } : undefined) });
    const dialog = await enterSchedule();
    dialogButton(dialog, 'Save schedule').click();
    await waitFor(() => expectSuccess(SAVED));
    expect(calls).toHaveBeenCalledWith(ROTATE, {
      ClientRequestToken: expect.any(String),
      SecretId: NAME,
      RotationLambdaARN: FUNCTION,
      RotationRules: { AutomaticallyAfterDays: 30 },
      RotateImmediately: false,
    });
  });

  it('requests immediate rotation and reports acceptance without claiming completion', async () => {
    const { calls } = openSecret({
      metadata: ACTIVE,
      handler: (operation) => (operation === ROTATE ? { body: { VersionId: 'pending-rotation' } } : undefined),
    });
    await openRotationAction('Rotate now', 'Request rotation');
    await waitFor(() => expectSuccess(ACCEPTED));
    expect(flashContents()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/rotation (completed|succeeded)/i)]),
    );
    expect(calls).toHaveBeenCalledWith(ROTATE, {
      ClientRequestToken: expect.any(String),
      SecretId: NAME,
      RotateImmediately: true,
    });
  });

  it('reads disabled rotation and an absent next date after cancel despite retained settings', async () => {
    let canceled = false;
    const { calls } = openSecret({
      metadata: ACTIVE,
      handler: (operation) => {
        if (operation === CANCEL) {
          canceled = true;
          return { body: {} };
        }
        if (operation === 'DescribeSecret' && canceled) return { body: { Name: NAME, ...CANCELED } };
      },
    });
    await openRotationAction('Cancel rotation', 'Cancel rotation');
    await waitFor(() => expectField('Rotation status', 'Disabled'));
    expectField('Next rotation date', NO_NEXT);
    expectField('Rotation interval', '7 days');
    expectField('Rotation Lambda function', FUNCTION);
    expect(calls).toHaveBeenCalledWith(CANCEL, { SecretId: NAME });
  });

  it.each(ORDERS)('saves an interval without immediate rotation and shows refreshed settings (%s)', async (order) => {
    const next = NEXT + 86_400;
    const refresh = delayedRefresh(ROTATE, {
      ...ACTIVE,
      RotationRules: { AutomaticallyAfterDays: 30 },
      NextRotationDate: next,
    });
    openSecret({ handler: refresh.handler, observe: true });
    const dialog = await enterSchedule();
    dialogButton(dialog, 'Save schedule').click();
    await refresh.complete(order, SAVED, () => {
      expectField('Rotation interval', '30 days');
      expectField('Next rotation date', creationDateText(new Date(next * 1000)));
      expectField('Rotation status', 'Enabled');
    });
  });

  it.each(ORDERS)('shows acceptance and rereads settings after requesting immediate rotation (%s)', async (order) => {
    const next = NEXT + 86_400;
    const refresh = delayedRefresh(ROTATE, { ...ACTIVE, NextRotationDate: next });
    openSecret({ metadata: ACTIVE, handler: refresh.handler, observe: true });
    await openRotationAction('Rotate now', 'Request rotation');
    await refresh.complete(order, ACCEPTED, () => {
      expectField('Rotation status', 'Enabled');
      expectField('Next rotation date', creationDateText(new Date(next * 1000)));
    });
  });

  it.each(ORDERS)(
    'shows disabled rotation after cancel even when the schedule and function remain (%s)',
    async (order) => {
      const refresh = delayedRefresh(CANCEL, CANCELED);
      openSecret({ metadata: ACTIVE, handler: refresh.handler, observe: true });
      await openRotationAction('Cancel rotation', 'Cancel rotation');
      await refresh.complete(order, STOPPED, () => {
        expectField('Rotation status', 'Disabled');
      });
    },
  );

  it('preserves the schedule draft and shows the function invocation denial', async () => {
    const reason = 'Secrets Manager is not allowed to invoke the selected Lambda function.';
    openSecret({ handler: (operation) => (operation === ROTATE ? denied(reason) : undefined) });
    const dialog = await enterSchedule();
    dialogButton(dialog, 'Save schedule').click();
    await waitFor(() => expectDialogAlert(dialog, `${ROTATE} was refused: ${reason}`));
    expect(dialogInput(dialog, 'Rotation Lambda function ARN').getInputValue()).toBe(FUNCTION);
    expect(flashContents()).not.toContain(SAVED);
    dialogButton(dialog, 'Cancel').click();
    expectField('Rotation status', 'Disabled');
  });

  it('shows why immediate rotation was refused without claiming acceptance', async () => {
    openSecret({
      metadata: ACTIVE,
      handler: (operation) => (operation === ROTATE ? denied() : undefined),
    });
    const dialog = await openRotationAction('Rotate now', 'Request rotation');
    await waitFor(() => expectDialogAlert(dialog, `${ROTATE} was refused: ${REFUSAL}`));
    expect(flashContents()).not.toContain(ACCEPTED);
  });

  it('shows the cancel refusal and still shows active rotation after refresh', async () => {
    const { calls } = openSecret({
      metadata: ACTIVE,
      handler: (operation) => (operation === CANCEL ? denied() : undefined),
    });
    const dialog = await openRotationAction('Cancel rotation', 'Cancel rotation');
    await waitFor(() => expectDialogAlert(dialog, `${CANCEL} was refused: ${REFUSAL}`));
    expect(flashContents()).not.toContain(STOPPED);
    dialogButton(dialog, 'Keep rotation').click();
    await click('Refresh');
    await waitFor(() =>
      expect(calls.mock.calls.filter(([operation]) => operation === 'DescribeSecret')).toHaveLength(2),
    );
    await waitFor(() => expect(buttonNamed('Refresh').getElement()).toBeEnabled());
    await waitFor(() => expectField('Rotation status', 'Enabled'));
    expectField('Next rotation date', creationDateText(new Date(NEXT * 1000)));
  });
});
