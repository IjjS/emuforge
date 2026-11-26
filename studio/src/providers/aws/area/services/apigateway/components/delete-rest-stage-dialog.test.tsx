import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { PageFlashContext } from '../../../components/page-flash';
import { deleteRestStage } from '../rest-stage-api';
import { DeleteRestStageDialog } from './delete-rest-stage-dialog';

vi.mock('../rest-stage-api', { spy: true });

const engineOrigin = 'http://127.0.0.1:9681';
const remove = vi.mocked(deleteRestStage);

beforeEach(() => {
  remove.mockReset();
  remove.mockResolvedValue(undefined);
});

function open() {
  const show = vi.fn();
  const close = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PageFlashContext.Provider value={{ show, handOver: vi.fn() }}>
        <DeleteRestStageDialog
          apiId="api-1"
          stageName="dev"
          connection={{ engineOrigin, result: undefined }}
          onClose={close}
        />
      </PageFlashContext.Provider>
    </QueryClientProvider>,
  );
  const dialog = within(screen.getByRole('dialog', { name: 'Delete stage dev?' }));
  const modal = createWrapper(document.body).findModal()!;
  return {
    dialog,
    input: modal.findContent().findInput()!.findNativeInput().getElement(),
    button: dialog.getByRole('button', { name: 'Delete' }),
    user,
    close,
    show,
  };
}

it('requires the exact name of the stage and explains the effect on its invoke URL', async () => {
  const { dialog, input, button, user, close } = open();
  expect(dialog.getByText('Its invoke URL stops answering. It cannot be undone.')).toBeVisible();
  expect(button).toBeDisabled();
  await user.type(input, 'Dev{Enter}');
  expect(button).toBeDisabled();
  expect(remove).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, 'dev');
  expect(button).toBeEnabled();
  await user.click(button);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
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
  const { dialog, input, button, user, close, show } = open();
  await user.type(input, 'dev');
  await user.click(button);
  expect(await dialog.findByText(text, { exact: false })).toBeVisible();
  expect(dialog.getByText(/DeleteStage/)).toBeVisible();
  expect(input).toHaveValue('dev');
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});
