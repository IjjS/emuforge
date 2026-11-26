import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { createV2Stage } from '../v2-stage-api';
import { V2_STAGE_NAME_RULE } from '../v2-stage-form';
import { CreateV2StageDialog } from './create-v2-stage-dialog';

vi.mock('../v2-stage-api', { spy: true });

const endpoint = 'http://127.0.0.1:9681';
const create = vi.mocked(createV2Stage);

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue(undefined);
});

async function open() {
  const succeeded = vi.fn();
  const close = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };

  render(
    <AreaRootContext.Provider value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <CreateV2StageDialog apiId="api-1" endpoint={endpoint} onCreated={succeeded} onClose={close} />
        </QueryClientProvider>
      </div>
    </AreaRootContext.Provider>,
  );

  const modal = await waitFor(() => {
    const dialog = createWrapper(document.body).findModal();
    assert(dialog && dialog.isVisible());
    return dialog;
  });
  expect(modal.findHeader().getElement()).toHaveTextContent('Create stage');
  const formField = modal.findContent().findFormField();
  const button = modal.findFooter()?.findAllButtons()[1];
  assert(formField && button);
  const field = formField.findControl()?.findInput()?.findNativeInput();
  const autoDeploy = modal.findContent().findRadioGroup();
  assert(field && autoDeploy);
  const on = autoDeploy.findInputByValue('on');
  const off = autoDeploy.findInputByValue('off');
  assert(on && off);
  const [onOption, offOption] = autoDeploy.findButtons();
  return {
    modal,
    formField,
    onDescription: onOption?.findDescription()?.getElement(),
    offDescription: offOption?.findDescription()?.getElement(),
    input: field.getElement(),
    on: on.getElement(),
    off: off.getElement(),
    button: button.getElement(),
    user,
    close,
    succeeded,
  };
}

it('shows the name rule and the two described auto-deploy options with On selected by default', async () => {
  const { formField, onDescription, offDescription, input, on, off, button, user, succeeded } = await open();
  expect(formField.findConstraint()?.getElement()).toHaveTextContent(V2_STAGE_NAME_RULE);
  expect(onDescription).toHaveTextContent('Changes are served at once.');
  expect(offDescription).toHaveTextContent('Changes are served after you deploy to the stage.');
  expect(on).toBeChecked();
  expect(off).not.toBeChecked();

  await user.click(button);
  expect(input).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
  await user.type(input, '$default');
  await user.click(off);
  await user.click(button);
  await waitFor(() => expect(succeeded).toHaveBeenCalledExactlyOnceWith('$default'));
  expect(create).toHaveBeenCalledWith(
    endpoint,
    'api-1',
    { stageName: '$default', autoDeploy: false },
    expect.any(AbortSignal),
  );
});

it.each<[RequestFailure, string, boolean]>([
  [{ kind: 'not-implemented', operation: 'CreateStage' }, 'Not implemented by the emulator', true],
  [
    { kind: 'other', operation: 'CreateStage', code: 'ConflictException', message: 'Stage already exists' },
    'Stage already exists',
    false,
  ],
])('keeps the entered fields and shows a CreateStage refusal (%j)', async (failure, text, unavailable) => {
  create.mockRejectedValueOnce(new RequestError(failure));
  const { modal, input, off, button, user, close, succeeded } = await open();
  await user.type(input, 'dev');
  await user.click(off);
  await user.click(button);

  await waitFor(() => {
    const alert = modal.findContent().findAlert()?.getElement();
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveTextContent('CreateStage');
  });
  expect(input).toHaveValue('dev');
  expect(off).toBeChecked();
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(succeeded).not.toHaveBeenCalled();
});
