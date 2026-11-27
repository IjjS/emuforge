import type { StateValue } from '@aws-sdk/client-cloudwatch';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { setAlarmState } from '../try-api';
import { SetStateDialog } from './set-state-dialog';

vi.mock('../try-api', async (load) => ({
  ...(await load<typeof import('../try-api')>()),
  setAlarmState: vi.fn(),
}));

const send = vi.mocked(setAlarmState);
const endpoint = 'http://127.0.0.1:9684';
const name = 'an alarm';
const defaultReason = 'Set by hand in EmuForge Studio';
const stateLabels = {
  OK: 'OK',
  ALARM: 'In alarm',
  INSUFFICIENT_DATA: 'Insufficient data',
};
const page = createWrapper(document.body);

beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined);
});

function open(currentState: StateValue = 'OK') {
  const onSet = vi.fn();
  const onUnavailable = vi.fn();
  const onDismiss = vi.fn();
  render(
    <SetStateDialog
      endpoint={endpoint}
      name={name}
      currentState={currentState}
      unavailable={false}
      onSet={onSet}
      onUnavailable={onUnavailable}
      onDismiss={onDismiss}
    />,
  );
  const modal = page.findModal()!;
  return {
    onSet,
    onUnavailable,
    onDismiss,
    state: modal.findSelect()!,
    reason: modal.findTextarea()!,
    submit: modal.findFooter()!.findAllButtons()[1]!,
    cancel: modal.findFooter()!.findAllButtons()[0]!,
  };
}

it.each<StateValue>(['OK', 'ALARM', 'INSUFFICIENT_DATA'])(
  'offers and describes the states other than %s',
  (current) => {
    const { state } = open(current);
    state.openDropdown();
    const dropdown = state.findDropdown();
    expect(dropdown.findOptionByValue(current)).toBeNull();
    for (const value of (Object.keys(stateLabels) as StateValue[]).filter((value) => value !== current)) {
      const label = stateLabels[value];
      const option = dropdown.findOptionByValue(value);
      expect(option?.findLabel().getElement().textContent).toBe(label);
      expect(option?.findDescription()?.getElement().textContent).toBe(`Sets the alarm to ${label}.`);
    }
  },
);

it('fills the reason and shows the rule and when actions run', () => {
  const { reason } = open();
  expect(reason.getTextareaValue()).toBe(defaultReason);
  expect(page.findAllFormFields()[1]?.findConstraint()?.getElement()).toHaveTextContent('1 to 1023 characters.');
  expect(
    screen.getByText(
      "When the state changes and the alarm's actions are on, the actions of the new state run. The history records the change and each action that ran.",
    ),
  ).toBeVisible();
});

it('requires a state and between 1 and 1023 reason characters', async () => {
  const { state, reason, submit, onSet } = open();
  submit.click();
  const fields = page.findAllFormFields();
  expect(fields[0]?.findError()?.getElement()).toHaveTextContent('Choose a state.');
  expect(send).not.toHaveBeenCalled();
  state.openDropdown();
  state.selectOptionByValue('ALARM');
  for (const invalid of ['', 'a'.repeat(1024)]) {
    reason.setTextareaValue(invalid);
    submit.click();
    expect(fields[1]?.findError()?.getElement()).toHaveTextContent('1 to 1023 characters.');
    expect(send).not.toHaveBeenCalled();
  }
  const valid = 'a'.repeat(1023);
  reason.setTextareaValue(valid);
  submit.click();
  await waitFor(() => expect(onSet).toHaveBeenCalledExactlyOnceWith('ALARM'));
  expect(send).toHaveBeenCalledExactlyOnceWith(endpoint, name, 'ALARM', valid, expect.any(AbortSignal));
});

it('keeps the chosen state and reason on refusal and names the operation and code', async () => {
  send.mockRejectedValueOnce(
    new RequestError({ kind: 'other', operation: 'SetAlarmState', code: 'ResourceNotFound', message: 'Alarm is gone' }),
  );
  const { state, reason, submit, onSet } = open();
  state.openDropdown();
  state.selectOptionByValue('INSUFFICIENT_DATA');
  reason.setTextareaValue('Try again later');
  submit.click();
  expect(await screen.findByText('SetAlarmState failed')).toBeVisible();
  expect(screen.getByText('ResourceNotFound')).toBeVisible();
  expect(state.findTrigger().getElement()).toHaveTextContent('Insufficient data');
  expect(reason.getTextareaValue()).toBe('Try again later');
  expect(onSet).not.toHaveBeenCalled();
});

it('reports a 501 and leaves the confirmation disabled', async () => {
  send.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'SetAlarmState' }));
  const { state, submit, onUnavailable, onSet } = open();
  state.openDropdown();
  state.selectOptionByValue('ALARM');
  submit.click();
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText('The emulator answered 501 Not Implemented for SetAlarmState.')).toBeVisible();
  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(submit.getElement()).toBeDisabled();
  expect(onSet).not.toHaveBeenCalled();
});

it('locks both buttons while the request is out and reports its state once', async () => {
  let answer!: () => void;
  send.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      answer = resolve;
    }),
  );
  const { state, submit, cancel, onSet, onDismiss } = open();
  state.openDropdown();
  state.selectOptionByValue('ALARM');
  submit.click();
  expect(submit.getElement()).toBeDisabled();
  expect(cancel.getElement()).toBeDisabled();
  submit.click();
  cancel.click();
  expect(send).toHaveBeenCalledOnce();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(onSet).not.toHaveBeenCalled();
  await act(async () => answer());
  expect(onSet).toHaveBeenCalledExactlyOnceWith('ALARM');
});
