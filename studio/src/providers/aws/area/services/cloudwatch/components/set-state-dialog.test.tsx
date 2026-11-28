import type { StateValue } from '@aws-sdk/client-cloudwatch';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { requestFailure, RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
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

async function open(currentState: StateValue = 'OK') {
  const onSet = vi.fn();
  const onUnavailable = vi.fn();
  const onDismiss = vi.fn();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <SetStateDialog
            endpoint={endpoint}
            name={name}
            currentState={currentState}
            unavailable={false}
            onUnavailable={onUnavailable}
            onSet={onSet}
            onDismiss={onDismiss}
          />
        </div>
      </AreaRootContext.Provider>
    );
  }
  render(<Area />);
  const modal = await waitFor(() => {
    const dialog = page.findModal();
    if (!dialog?.isVisible()) throw new Error('Set state dialog missing');
    return dialog;
  });
  const state = modal.findContent().findSelect();
  const reason = modal.findContent().findTextarea();
  const [cancel, submit] = modal.findFooter()?.findAllButtons() ?? [];
  if (!state || !reason || !submit || !cancel) throw new Error('Set state controls missing');
  return { modal, onSet, onUnavailable, onDismiss, state, reason, submit, cancel };
}

it.each<StateValue>(['OK', 'ALARM', 'INSUFFICIENT_DATA'])(
  'offers and describes the states other than %s',
  async (current) => {
    const { state } = await open(current);
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

it('fills the reason and shows the rule and when actions run', async () => {
  const { modal, reason } = await open();
  expect(reason.getTextareaValue()).toBe(defaultReason);
  expect(modal.findContent().findAllFormFields()[1]?.findConstraint()?.getElement()).toHaveTextContent(
    '1 to 1023 characters.',
  );
  expect(modal.findContent().getElement()).toHaveTextContent(
    "When the state changes and the alarm's actions are on, the actions of the new state run. The history records the change and each action that ran.",
  );
});

it('requires a state and between 1 and 1023 reason characters', async () => {
  const { modal, state, reason, submit, onSet } = await open();
  submit.click();
  const fields = modal.findContent().findAllFormFields();
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

it.each([
  ['ResourceNotFound', 404, 'Alarm is gone', 'SetAlarmState failed', 'ResourceNotFound: Alarm is gone'],
  [
    'AccessDeniedException',
    403,
    'Changing the alarm state is denied.',
    'Access denied',
    'SetAlarmState was refused: Changing the alarm state is denied. (AccessDeniedException)',
  ],
])(
  'keeps the chosen state and reason on a %s refusal and shows the operation and code',
  async (code, status, message, header, content) => {
    const user = userEvent.setup();
    let refuse!: (error: RequestError) => void;
    send.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        refuse = reject;
      }),
    );
    const { modal, state, reason, submit, onSet, onDismiss } = await open();
    expect(modal.findDismissButton().getElement()).toHaveAccessibleName('Close dialog');
    state.openDropdown();
    state.selectOptionByValue('INSUFFICIENT_DATA');
    reason.setTextareaValue('Try again later');
    const button = submit.getElement();
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(modal.findDismissButton()).toBeNull();
    await waitFor(
      () =>
        expect(page.findAll('[aria-live="polite"]').map((region) => region.getElement().textContent)).toContain(
          'Setting alarm state',
        ),
      { timeout: 3000 },
    );
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(send).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () =>
      refuse(
        new RequestError(
          requestFailure('SetAlarmState', { Code: code, message, $metadata: { httpStatusCode: status } }),
        ),
      ),
    );
    await waitFor(() => expect(modal.findContent().findAlert()?.findHeader()?.getElement()).toHaveTextContent(header));
    const alert = modal.findContent().findAlert();
    expect(alert?.getElement().contains(document.activeElement)).toBe(true);
    expect(alert?.findContent().getElement()).toHaveTextContent(content);
    expect(state.findTrigger().getElement()).toHaveTextContent('Insufficient data');
    expect(reason.getTextareaValue()).toBe('Try again later');
    expect(onSet).not.toHaveBeenCalled();
    const close = modal.findDismissButton().getElement();
    expect(close).toHaveAccessibleName('Close dialog');
    await user.click(close);
    expect(onDismiss).toHaveBeenCalledOnce();
  },
);

it('reports a 501 and leaves the confirmation disabled', async () => {
  send.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'SetAlarmState' }));
  const { modal, state, submit, onUnavailable, onSet } = await open();
  state.openDropdown();
  state.selectOptionByValue('ALARM');
  submit.click();
  await waitFor(() =>
    expect(modal.findContent().findAlert()?.findHeader()?.getElement()).toHaveTextContent(
      'Not implemented by the emulator',
    ),
  );
  expect(modal.findContent().findAlert()?.findContent().getElement()).toHaveTextContent(
    'The emulator answered 501 Not Implemented for SetAlarmState.',
  );
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
  const { state, submit, cancel, onSet, onDismiss } = await open();
  state.openDropdown();
  state.selectOptionByValue('ALARM');
  submit.click();
  expect(submit.getElement()).toHaveAttribute('aria-disabled', 'true');
  expect(submit.getElement()).not.toBeDisabled();
  expect(cancel.getElement()).toBeDisabled();
  submit.click();
  cancel.click();
  expect(send).toHaveBeenCalledOnce();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(onSet).not.toHaveBeenCalled();
  await act(async () => answer());
  expect(onSet).toHaveBeenCalledExactlyOnceWith('ALARM');
});
