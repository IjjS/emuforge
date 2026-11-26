import type { Stage } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { readRestStages, readStageAddress } from '../rest-api';
import { deleteRestStage, deployRestApi } from '../rest-stage-api';
import { RestStages } from './rest-stages';

vi.mock('../rest-api', { spy: true });
vi.mock('../rest-stage-api', { spy: true });

const apiId = 'api-1';
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const changed = new Date('2026-11-26T12:00:00Z');
const stages: Stage[] = [
  { stageName: 'dev', deploymentId: 'deploy-dev', lastUpdatedDate: changed },
  { stageName: 'prod', deploymentId: 'deploy-prod' },
];
const invokeUrl = (stage: string) => `${endpoint}/_aws/execute-api/${apiId}/${stage}`;
const readStages = vi.mocked(readRestStages);
const readAddress = vi.mocked(readStageAddress);
const deploy = vi.mocked(deployRestApi);
const remove = vi.mocked(deleteRestStage);

beforeEach(() => {
  readStages.mockReset();
  readAddress.mockReset();
  deploy.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  readStages.mockResolvedValue(stages);
  readAddress.mockImplementation(async (_, __, name) => invokeUrl(name));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function StagesWithFlash() {
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/aws/apigateway/apis/rest/api-1', 0, true);
  return (
    <PageFlashContext.Provider value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <RestStages apiId={apiId} connection={connection} />
    </PageFlashContext.Provider>
  );
}

function open() {
  const user = userEvent.setup();
  const root = { current: null as HTMLDivElement | null };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AreaRootContext.Provider value={root}>
          <div
            ref={(element) => {
              root.current = element;
            }}
          >
            <StagesWithFlash />
          </div>
        </AreaRootContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}

function row(name: string) {
  const element = screen.getByRole('rowheader', { name }).closest('tr');
  assert(element);
  return within(element);
}

it('shows stages, deployment IDs, last change and copyable invoke URLs as plain text', async () => {
  const user = open();
  await screen.findByRole('rowheader', { name: 'dev' });
  expect(
    screen.getByText(
      'A stage serves the API as it was when last deployed. Deploy again after you change resources or methods.',
    ),
  ).toBeInTheDocument();
  expect(row('dev').getByText('deploy-dev')).toBeInTheDocument();
  expect(row('dev').getByRole('cell', { name: /November/ })).toHaveTextContent(creationDateText(changed));
  await user.click(row('dev').getByRole('button', { name: 'Copy Deployment ID' }));
  expect(await navigator.clipboard.readText()).toBe('deploy-dev');

  const copyAddress = await row('dev').findByRole('button', { name: 'Copy Invoke URL' });
  expect(row('dev').getByRole('cell', { name: new RegExp('execute-api') })).toHaveTextContent(invokeUrl('dev'));
  expect(row('dev').queryByRole('link')).not.toBeInTheDocument();
  await user.click(copyAddress);
  expect(await navigator.clipboard.readText()).toBe(invokeUrl('dev'));
});

it('shows why a stage is needed when none exist', async () => {
  readStages.mockResolvedValue([]);
  open();
  expect(await screen.findByText('No stages')).toBeVisible();
  expect(screen.getByText('Deploy the API to a stage to get an invoke URL.')).toBeVisible();
  expect(readAddress).not.toHaveBeenCalled();
});

it.each<[RequestFailure, string]>([
  [{ kind: 'not-implemented', operation: 'GetExport' }, 'Not implemented by the emulator'],
  [{ kind: 'access-denied', operation: 'GetExport', message: 'Export is refused.' }, 'Access denied'],
  [
    { kind: 'other', operation: 'GetExport', code: 'BadRequestException', message: 'Invalid export.' },
    'The invoke URL could not be read',
  ],
  [{ kind: 'emulator-did-not-answer', operation: 'GetExport', message: 'Timeout' }, `Not answering at ${endpoint}`],
  [
    { kind: 'engine-did-not-answer', operation: 'GetExport' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
  ],
])('keeps healthy addresses and refreshes every stage address after %j', async (failure, first) => {
  let failDev = true;
  readAddress.mockImplementation(async (_, __, name) => {
    if (name === 'dev' && failDev) throw new RequestError(failure);
    return invokeUrl(name);
  });
  const user = open();
  await screen.findByRole('rowheader', { name: 'dev' });
  await row('dev').findByText('GetExport');
  expect(row('dev').getByRole('cell', { name: /GetExport/ })).toHaveTextContent(first);
  expect(row('dev').queryByRole('button', { name: 'Copy Invoke URL' })).not.toBeInTheDocument();
  expect(await row('prod').findByRole('button', { name: 'Copy Invoke URL' })).toBeEnabled();
  expect(row('prod').getByRole('cell', { name: /execute-api/ })).toHaveTextContent(invokeUrl('prod'));
  failDev = false;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await row('dev').findByRole('button', { name: 'Copy Invoke URL' })).toBeEnabled();
  expect(row('dev').getByRole('cell', { name: /execute-api/ })).toHaveTextContent(invokeUrl('dev'));
  expect(readStages).toHaveBeenCalledTimes(2);
  for (const stage of ['dev', 'prod']) {
    expect(readAddress.mock.calls.filter(([, , name]) => name === stage)).toHaveLength(2);
  }
});

it.each<[RequestFailure, string, string]>([
  [
    { kind: 'not-implemented', operation: 'GetStages' },
    'Not implemented by the emulator',
    '501 Not Implemented for GetStages',
  ],
  [
    { kind: 'access-denied', operation: 'GetStages', message: 'Stages refused.' },
    'Access denied',
    'GetStages was refused: Stages refused.',
  ],
  [
    { kind: 'other', operation: 'GetStages', code: 'BadRequestException', message: 'Invalid API' },
    'The stages could not be read',
    'GetStages: BadRequestException: Invalid API',
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetStages', message: 'Timeout.' },
    `Not answering at ${endpoint}`,
    'GetStages got no answer from the emulator. Timeout.',
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetStages' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetStages got no answer.',
  ],
])('shows the failed GetStages state and retries it (%j)', async (failure, first, detail) => {
  readStages.mockRejectedValueOnce(new RequestError(failure));
  const user = open();
  const table = within(screen.getByRole('table', { name: 'Stages' }));
  await table.findByText(detail, { exact: false });
  expect(table.getByRole('row', { name: /GetStages/ })).toHaveTextContent(first);
  await user.click(table.getByRole('button', { name: 'Retry' }));
  expect(await table.findByRole('rowheader', { name: 'dev' })).toBeVisible();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type User = ReturnType<typeof userEvent.setup>;

async function deployToNewStage(user: User) {
  await user.click(screen.getByRole('button', { name: 'Deploy API' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Deploy API' }));
  const modal = createWrapper(document.body).findModal();
  assert(modal);
  const content = modal.findContent();
  const target = content.findRadioGroup()?.findInputByValue('new');
  assert(target);
  await user.click(target.getElement());
  const input = content.findInput()?.findNativeInput();
  assert(input);
  await user.type(input.getElement(), 'sandbox');
  await user.click(dialog.getByRole('button', { name: 'Deploy' }));
}

async function deleteDev(user: User) {
  const radio = createWrapper(document.body).findTable()?.findRowSelectionArea(1)?.find('input');
  assert(radio);
  await user.click(radio.getElement());
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Delete stage dev?' }));
  const input = createWrapper(document.body).findModal()?.findContent().findInput()?.findNativeInput();
  assert(input);
  await user.type(input.getElement(), 'dev');
  await user.click(dialog.getByRole('button', { name: 'Delete' }));
}

const deployedStages = [...stages, { stageName: 'sandbox', deploymentId: 'deploy-sandbox' }];

it('shows the deploy result and reads the stages and invoke URLs again', async () => {
  const user = open();
  await rowAfterRead('dev');
  deploy.mockImplementationOnce(async () => {
    readStages.mockResolvedValue(deployedStages);
    readAddress.mockImplementation(async (_, __, name) => invokeUrl(name) + '?deployment=latest');
  });
  await deployToNewStage(user);
  const notifications = await screen.findByRole('list', { name: 'Notifications' });
  expect(notifications).toHaveTextContent('API deployed to stage sandbox.');
  await rowAfterRead('sandbox');
  await waitFor(() =>
    expect(row('dev').getByRole('button', { name: 'Copy Invoke URL' }).closest('td')).toHaveTextContent(
      invokeUrl('dev') + '?deployment=latest',
    ),
  );
  expect(row('sandbox').getByRole('button', { name: 'Copy Invoke URL' }).closest('td')).toHaveTextContent(
    invokeUrl('sandbox') + '?deployment=latest',
  );
});

async function rowAfterRead(name: string) {
  await screen.findByRole('rowheader', { name });
  await row(name).findByRole('button', { name: 'Copy Invoke URL' });
}

it('enables Delete for a selection and reads the stages after deletion', async () => {
  const user = open();
  await rowAfterRead('dev');
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  remove.mockImplementationOnce(async () => {
    readStages.mockResolvedValue(stages.slice(1));
  });
  await deleteDev(user);
  const notifications = await screen.findByRole('list', { name: 'Notifications' });
  expect(notifications).toHaveTextContent('Stage dev deleted.');
  await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'dev' })).not.toBeInTheDocument());
  expect(screen.getByRole('rowheader', { name: 'prod' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

it.each(['deploy', 'delete'] as const)(
  'keeps the later stages, addresses and result when older reads answer after %s',
  async (action) => {
    const staleStages = deferred<Stage[]>();
    const staleAddress = deferred<string>();
    const user = open();
    await rowAfterRead('prod');
    readStages.mockReturnValueOnce(staleStages.promise);
    readAddress.mockImplementation(async (_, __, name) => (name === 'prod' ? staleAddress.promise : invokeUrl(name)));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(readStages).toHaveBeenCalledTimes(2);
      expect(readAddress.mock.calls.filter(([, , name]) => name === 'prod')).toHaveLength(2);
    });
    const stageSignal = readStages.mock.calls[1]?.[2];
    const exportSignal = readAddress.mock.calls.filter(([, , name]) => name === 'prod')[1]?.[3];
    const finishChange = async () => {
      readStages.mockResolvedValue(action === 'deploy' ? deployedStages : stages.slice(1));
      readAddress.mockImplementation(async (_, __, name) => invokeUrl(name) + '?deployment=latest');
    };
    if (action === 'deploy') {
      deploy.mockImplementationOnce(finishChange);
      await deployToNewStage(user);
    } else {
      remove.mockImplementationOnce(finishChange);
      await deleteDev(user);
    }
    const notifications = await screen.findByRole('list', { name: 'Notifications' });
    const message = action === 'deploy' ? 'API deployed to stage sandbox.' : 'Stage dev deleted.';
    await waitFor(() =>
      expect(row('prod').getByRole('button', { name: 'Copy Invoke URL' }).closest('td')).toHaveTextContent(
        invokeUrl('prod') + '?deployment=latest',
      ),
    );
    if (action === 'deploy') await rowAfterRead('sandbox');
    else await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'dev' })).not.toBeInTheDocument());
    expect(stageSignal?.aborted).toBe(true);
    expect(exportSignal?.aborted).toBe(true);
    await act(async () => {
      staleStages.resolve([...stages, { stageName: 'stale', deploymentId: 'stale' }]);
      staleAddress.resolve(invokeUrl('prod') + '?deployment=stale');
    });
    expect(screen.queryByRole('rowheader', { name: 'stale' })).not.toBeInTheDocument();
    if (action === 'deploy') expect(screen.getByRole('rowheader', { name: 'sandbox' })).toBeVisible();
    else expect(screen.queryByRole('rowheader', { name: 'dev' })).not.toBeInTheDocument();
    expect(row('prod').getByRole('button', { name: 'Copy Invoke URL' }).closest('td')).toHaveTextContent(
      invokeUrl('prod') + '?deployment=latest',
    );
    expect(notifications).toHaveTextContent(message);
  },
);
