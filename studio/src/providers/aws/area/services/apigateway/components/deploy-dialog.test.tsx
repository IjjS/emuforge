import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { PageFlashContext } from '../../../components/page-flash';
import { STAGE_NAME_RULE } from '../deploy-form';
import { readRestStages } from '../rest-api';
import { deployRestApi } from '../rest-stage-api';
import { DeployDialog } from './deploy-dialog';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-stage-api', { spy: true });

const id = 'api-1';
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connected: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const disconnected: AreaConnection = {
  engineOrigin,
  result: {
    kind: 'emulator-unreachable',
    checkedAt: 1,
    reason: 'not_started',
    message: 'The emulator is stopped.',
    emulator: { port: 9682, endpoint },
  },
};
const read = vi.mocked(readRestStages);
const deploy = vi.mocked(deployRestApi);

beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue([
    { stageName: 'dev', deploymentId: 'dep-dev' },
    { stageName: 'prod', deploymentId: 'dep-prod' },
  ]);
  deploy.mockResolvedValue(undefined);
});

async function open(hasStages: boolean, connection = connected) {
  const show = vi.fn();
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
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient()}>
            <PageFlashContext.Provider value={{ show, handOver: vi.fn() }}>
              <DeployDialog apiId={id} connection={connection} hasStages={hasStages} onClose={close} />
            </PageFlashContext.Provider>
          </QueryClientProvider>
        </MemoryRouter>
      </div>
    </AreaRootContext.Provider>,
  );
  const dialog = within(await screen.findByRole('dialog', { name: 'Deploy API' }));
  const modal = createWrapper(document.body).findModal();
  assert(modal);
  const content = modal.findContent();
  return {
    user,
    show,
    close,
    dialog,
    content,
    deployButton: dialog.getByRole('button', { name: 'Deploy' }),
    radio: (value: string) => {
      const input = content.findRadioGroup()?.findInputByValue(value);
      assert(input);
      return input.getElement();
    },
    nameInput: () => {
      const input = content.findInput()?.findNativeInput();
      assert(input);
      return input.getElement();
    },
    descriptionInput: () => {
      const input = content.findTextarea()?.findNativeTextarea();
      assert(input);
      return input.getElement();
    },
    select: () => {
      const select = content.findSelect();
      assert(select);
      return select;
    },
  };
}

it('describes both targets and starts with a new-stage name when there are no stages', async () => {
  const { dialog, radio } = await open(false);
  expect(dialog.getByText('Moves a stage this API has to the new deployment.')).toBeVisible();
  expect(dialog.getByText('Creates a stage with this deployment.')).toBeVisible();
  expect(radio('new')).toBeChecked();
  expect(radio('existing')).not.toBeChecked();
  expect(dialog.getByText(STAGE_NAME_RULE)).toBeVisible();
  expect(read).not.toHaveBeenCalled();
});

it('reads stages when the dialog opens and deploys with the chosen option and description', async () => {
  const { user, radio, descriptionInput, select, deployButton, close } = await open(true);
  expect(radio('existing')).toBeChecked();
  await waitFor(() => expect(read).toHaveBeenCalledWith(engineOrigin, id, expect.any(AbortSignal)));
  const field = select();
  await user.click(field.findTrigger().getElement());
  const dropdown = field.findDropdown();
  await waitFor(() => {
    expect(dropdown.findOptionByValue('dev')?.getElement()).toHaveTextContent('devDeployment dep-dev');
    expect(dropdown.findOptionByValue('prod')?.getElement()).toHaveTextContent('prodDeployment dep-prod');
  });
  const option = dropdown.findOptionByValue('prod');
  assert(option);
  await user.click(option.getElement());
  await user.type(descriptionInput(), 'Send to production');
  await user.click(deployButton);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(read).toHaveBeenCalledOnce();
  expect(deploy).toHaveBeenCalledWith(
    engineOrigin,
    id,
    { stageName: 'prod', description: 'Send to production' },
    expect.any(AbortSignal),
  );
});

it.each<[RequestFailure, AreaConnection, string, string, boolean]>([
  [
    { kind: 'not-implemented', operation: 'GetStages' },
    connected,
    'Not implemented by the emulator',
    '501 Not Implemented for GetStages',
    false,
  ],
  [
    { kind: 'other', operation: 'GetStages', code: 'BadRequestException', message: 'Bad stage list.' },
    disconnected,
    'The stages could not be read',
    'GetStages: BadRequestException: Bad stage list.',
    false,
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetStages', message: 'Timeout.' },
    connected,
    `Not answering at ${endpoint}`,
    'GetStages got no answer from the emulator. Timeout.',
    true,
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetStages' },
    connected,
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetStages got no answer.',
    true,
  ],
])('shows and retries the stages choice failure %j', async (failure, connection, first, detail, recovery) => {
  read.mockRejectedValueOnce(new RequestError(failure));
  const { user, dialog, content, select } = await open(true, connection);
  expect(await dialog.findByText(detail, { exact: false })).toBeVisible();
  expect(content.findStatusIndicator()?.getElement()).toHaveTextContent(first);
  expect(Boolean(dialog.queryByRole('link', { name: 'Connection status' }))).toBe(recovery);
  const field = select();
  await user.click(field.findTrigger().getElement());
  const dropdown = field.findDropdown();
  const retry = await within(dropdown.getElement()).findByRole('button', { name: 'Retry' });
  expect(dropdown.getElement()).toHaveTextContent('The stages could not be loaded');
  expect(dialog.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
  await user.click(retry);
  await waitFor(() => expect(dropdown.findOptionByValue('dev')?.getElement()).toBeVisible());
  expect(dialog.queryByText(detail, { exact: false })).not.toBeInTheDocument();
});

it('deploys to a new name after the existing-stage choice fails', async () => {
  read.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'GetStages' }));
  const { user, dialog, radio, nameInput, deployButton } = await open(true);
  await dialog.findByText('Not implemented by the emulator');
  expect(dialog.getByText('Creates a stage with this deployment.')).toBeVisible();
  await user.click(radio('new'));
  await user.type(nameInput(), 'sandbox_2');
  await user.click(deployButton);
  await waitFor(() =>
    expect(deploy).toHaveBeenCalledWith(
      engineOrigin,
      id,
      { stageName: 'sandbox_2', description: '' },
      expect.any(AbortSignal),
    ),
  );
});

it.each<[RequestFailure, string, boolean]>([
  [{ kind: 'not-implemented', operation: 'CreateDeployment' }, 'Not implemented by the emulator', true],
  [
    {
      kind: 'other',
      operation: 'CreateDeployment',
      code: 'BadRequestException',
      message: "The REST API doesn't contain any methods",
    },
    "The REST API doesn't contain any methods",
    false,
  ],
])('keeps the deployment form and its draft when the change fails (%j)', async (failure, text, unavailable) => {
  deploy.mockRejectedValueOnce(new RequestError(failure));
  const { user, dialog, nameInput, descriptionInput, deployButton, close, show } = await open(false);
  await user.type(nameInput(), 'dev');
  await user.type(descriptionInput(), 'Draft');
  await user.click(deployButton);
  expect(await dialog.findByText(text, { exact: false })).toBeVisible();
  expect(dialog.getByText(/CreateDeployment/)).toBeVisible();
  expect(nameInput()).toHaveValue('dev');
  expect(descriptionInput()).toHaveValue('Draft');
  if (unavailable) expect(deployButton).toBeDisabled();
  else expect(deployButton).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});
