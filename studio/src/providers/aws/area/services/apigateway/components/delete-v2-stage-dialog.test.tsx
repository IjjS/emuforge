import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteV2Stage } from '../v2-stage-api';
import { DeleteV2StageDialog } from './delete-v2-stage-dialog';

vi.mock('../v2-stage-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9681';
const remove = vi.mocked(deleteV2Stage);

beforeEach(() => {
  remove.mockReset();
  remove.mockResolvedValue(undefined);
});

async function open() {
  const succeeded = vi.fn();
  const close = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  render(
    <AreaRootContext.Provider value={root}>
      <div
        ref={(element) => {
          root.current = element;
        }}
      >
        <QueryClientProvider client={new QueryClient()}>
          <DeleteV2StageDialog
            apiId="api-1"
            stageName="dev"
            endpoint={engineOrigin}
            onDeleted={succeeded}
            onClose={close}
          />
        </QueryClientProvider>
      </div>
    </AreaRootContext.Provider>,
  );
  const modal = await waitFor(() => {
    const dialog = createWrapper(document.body).findModal();
    assert(dialog && dialog.isVisible());
    return dialog;
  });
  expect(modal.findHeader().getElement()).toHaveTextContent('Delete stage dev?');
  const formField = modal.findContent().findFormField();
  const button = modal.findFooter()?.findAllButtons()[1];
  assert(formField && button);
  const input = formField.findControl()?.findInput()?.findNativeInput();
  assert(input);
  return {
    modal,
    input: input.getElement(),
    button: button.getElement(),
    user,
    close,
    succeeded,
  };
}

it('requires the exact name of the stage and explains the effect on its invoke URL', async () => {
  const { modal, input, button, user, succeeded } = await open();
  expect(modal.findContent().getElement()).toHaveTextContent('Its invoke URL stops answering. It cannot be undone.');
  expect(button).toBeDisabled();
  await user.type(input, 'Dev{Enter}');
  expect(button).toBeDisabled();
  expect(remove).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, 'dev');
  expect(button).toBeEnabled();
  await user.click(button);
  await waitFor(() => expect(succeeded).toHaveBeenCalledExactlyOnceWith('dev'));
  expect(remove).toHaveBeenCalledWith(engineOrigin, 'api-1', 'dev', expect.any(AbortSignal));
});

it.each<[RequestFailure, string, boolean]>([
  [{ kind: 'not-implemented', operation: 'DeleteStage' }, 'Not implemented by the emulator', true],
  [
    { kind: 'other', operation: 'DeleteStage', code: 'ConflictException', message: 'Stage is in use.' },
    'Stage is in use.',
    false,
  ],
])('keeps the confirmation and shows the failure inside the dialog (%j)', async (failure, text, unavailable) => {
  remove.mockRejectedValueOnce(new RequestError(failure));
  const { modal, input, button, user, close, succeeded } = await open();
  await user.type(input, 'dev');
  await user.click(button);
  await waitFor(() => {
    const alert = modal.findContent().findAlert()?.getElement();
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveTextContent('DeleteStage');
  });
  expect(input).toHaveValue('dev');
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(succeeded).not.toHaveBeenCalled();
});
