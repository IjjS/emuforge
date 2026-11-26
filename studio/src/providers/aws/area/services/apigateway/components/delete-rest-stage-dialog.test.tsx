import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { deleteRestStage } from '../rest-stage-api';
import { DeleteRestStageDialog } from './delete-rest-stage-dialog';

vi.mock('../rest-stage-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9681';
const remove = vi.mocked(deleteRestStage);

beforeEach(() => {
  remove.mockReset();
  remove.mockResolvedValue(undefined);
});

async function open() {
  const onSuccess = vi.fn();
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
          <DeleteRestStageDialog
            apiId="api-1"
            stageName="dev"
            connection={{ engineOrigin, result: undefined }}
            onClose={close}
            onSuccess={onSuccess}
          />
        </QueryClientProvider>
      </div>
    </AreaRootContext.Provider>,
  );
  const modal = await waitFor(() => {
    const found = createWrapper(document.body).findModal();
    assert(found && found.isVisible());
    return found;
  });
  const dialog = within(modal.getElement());
  const content = modal.findContent();
  const input = content.findInput()?.findNativeInput();
  assert(input);
  return {
    modal,
    content,
    input: input.getElement(),
    button: dialog.getByRole('button', { name: 'Delete' }),
    user,
    close,
    onSuccess,
  };
}

it('requires the exact name of the stage and explains the effect on its invoke URL', async () => {
  const { modal, content, input, button, user, close, onSuccess } = await open();
  expect(modal.findHeader().getElement()).toHaveTextContent('Delete stage dev?');
  expect(content.getElement()).toHaveTextContent('Its invoke URL stops answering. It cannot be undone.');
  expect(button).toBeDisabled();
  await user.type(input, 'Dev{Enter}');
  expect(button).toBeDisabled();
  expect(remove).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, 'dev');
  expect(button).toBeEnabled();
  await user.click(button);
  await waitFor(() => expect(onSuccess).toHaveBeenCalledExactlyOnceWith('dev'));
  expect(close).not.toHaveBeenCalled();
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
  const { content, input, button, user, close, onSuccess } = await open();
  await user.type(input, 'dev');
  await user.click(button);
  await waitFor(() => expect(content.findAlert()?.getElement()).toHaveTextContent(text));
  expect(content.findAlert()?.getElement()).toHaveTextContent('DeleteStage');
  expect(input).toHaveValue('dev');
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(onSuccess).not.toHaveBeenCalled();
});
