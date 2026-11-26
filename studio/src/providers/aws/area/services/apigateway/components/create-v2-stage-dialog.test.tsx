import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext } from '../../../components/page-flash';
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
  const show = vi.fn();
  const close = vi.fn();
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };

  render(
    <AreaRootContext.Provider value={root}>
      <div ref={root}>
        <QueryClientProvider client={new QueryClient()}>
          <PageFlashContext.Provider value={{ show, handOver: vi.fn() }}>
            <CreateV2StageDialog apiId="api-1" endpoint={endpoint} onClose={close} />
          </PageFlashContext.Provider>
        </QueryClientProvider>
      </div>
    </AreaRootContext.Provider>,
  );

  const dialog = within(await screen.findByRole('dialog', { name: 'Create stage' }));
  const modal = createWrapper(document.body).findModal();
  assert(modal);
  const field = modal.findContent().findInput()?.findNativeInput();
  const autoDeploy = modal.findContent().findRadioGroup();
  assert(field && autoDeploy);
  const on = autoDeploy.findInputByValue('on');
  const off = autoDeploy.findInputByValue('off');
  assert(on && off);
  return {
    dialog,
    input: field.getElement(),
    on: on.getElement(),
    off: off.getElement(),
    button: dialog.getByRole('button', { name: 'Create stage' }),
    user,
    close,
    show,
  };
}

it('shows the name rule and the two described auto-deploy options with On selected by default', async () => {
  const { dialog, input, on, off, button, user, close } = await open();
  expect(dialog.getByText(V2_STAGE_NAME_RULE)).toBeVisible();
  expect(dialog.getByText('Changes are served at once.')).toBeVisible();
  expect(dialog.getByText('Changes are served after you deploy to the stage.')).toBeVisible();
  expect(on).toBeChecked();
  expect(off).not.toBeChecked();

  await user.click(button);
  expect(input).toHaveFocus();
  expect(create).not.toHaveBeenCalled();
  await user.type(input, '$default');
  await user.click(off);
  await user.click(button);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
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
  const { dialog, input, off, button, user, close, show } = await open();
  await user.type(input, 'dev');
  await user.click(off);
  await user.click(button);

  expect(await dialog.findByText(text, { exact: false })).toBeVisible();
  expect(dialog.getByText(/CreateStage/)).toBeVisible();
  expect(input).toHaveValue('dev');
  expect(off).toBeChecked();
  if (unavailable) expect(button).toBeDisabled();
  else expect(button).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});
