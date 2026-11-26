import type { Stage } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
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

function StagesWithFlash({ connection }: { connection: AreaConnection }) {
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/aws/apigateway/apis/rest/api-1', 0, true);
  return (
    <PageFlashContext.Provider value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      <RestStages apiId={apiId} connection={connection} />
    </PageFlashContext.Provider>
  );
}

function open(activeConnection = connection) {
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
            <StagesWithFlash connection={activeConnection} />
          </div>
        </AreaRootContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}

const root = () => createWrapper(document.body);
const table = () => root().findTable();
const cell = (row: number, column: number) => table()?.findBodyCell(row, column)?.getElement();
const names = () =>
  table()
    ?.findRows()
    .map((_, index) => cell(index + 1, 2)?.textContent);
const addressCell = (row: number) => cell(row, 5);
const success = () => root().findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement();

function stageAction(label: 'Refresh' | 'Delete' | 'Deploy API') {
  const index = ['Refresh', 'Delete', 'Deploy API'].indexOf(label);
  const action = table()?.findHeaderSlot()?.findHeader()?.findActions()?.findAllButtons()[index]?.getElement();
  assert(action);
  expect(action).toHaveTextContent(label);
  return action;
}

async function retryFailure(user: User, failure: HTMLElement, recovery: boolean) {
  const wrapper = createWrapper(failure);
  const link = wrapper.findLink()?.getElement();
  if (recovery) {
    expect(link).toHaveTextContent('Connection status');
    expect(link).toHaveAttribute('href', '/');
  } else {
    expect(wrapper.findLink()).toBeNull();
  }
  const retry = wrapper.findButton()?.getElement();
  assert(retry);
  expect(retry).toHaveTextContent('Retry');
  await user.click(retry);
}

it('shows stages, deployment IDs, last change and copyable invoke URLs as plain text', async () => {
  const user = open();
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  expect(table()?.findHeaderSlot()?.getElement()).toHaveTextContent(
    'A stage serves the API as it was when last deployed. Deploy again after you change resources or methods.',
  );
  expect(cell(1, 3)).toHaveTextContent('deploy-dev');
  expect(cell(1, 4)).toHaveTextContent(creationDateText(changed));
  const copyDeployment = table()?.findBodyCell(1, 3)?.findCopyToClipboard()?.findCopyButton().getElement();
  assert(copyDeployment);
  expect(copyDeployment).toHaveAccessibleName('Copy Deployment ID');
  await user.click(copyDeployment);
  expect(await navigator.clipboard.readText()).toBe('deploy-dev');

  await waitFor(() => expect(addressCell(1)).toHaveTextContent(invokeUrl('dev')));
  const address = addressCell(1);
  assert(address);
  expect(address.style.minWidth).toBe('28ch');
  const addressWrapper = createWrapper(address);
  expect(addressWrapper.find('a')).toBeNull();
  const copyAddress = addressWrapper.findCopyToClipboard()?.findCopyButton().getElement();
  assert(copyAddress);
  expect(copyAddress).toHaveAccessibleName('Copy Invoke URL');
  await user.click(copyAddress);
  expect(await navigator.clipboard.readText()).toBe(invokeUrl('dev'));
});

it('shows why a stage is needed when none exist', async () => {
  readStages.mockResolvedValue([]);
  open();
  await waitFor(() => expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent('No stages'));
  expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent('Deploy the API to a stage to get an invoke URL.');
  expect(readAddress).not.toHaveBeenCalled();
});

function readFailures(operation: 'GetExport' | 'GetStages', thing: string) {
  const stopped: AreaConnection = {
    engineOrigin,
    result: {
      kind: 'emulator-unreachable',
      checkedAt: 1,
      reason: 'not_started',
      message: 'The emulator is stopped.',
      emulator: { port: 9682, endpoint },
    },
  };
  return [
    {
      failure: { kind: 'not-implemented', operation },
      first: 'Not implemented by the emulator',
      detail: `501 Not Implemented for ${operation}`,
      connection,
      recovery: false,
    },
    {
      failure: { kind: 'access-denied', operation, message: 'Request refused.' },
      first: 'Access denied',
      detail: `${operation} was refused: Request refused.`,
      connection,
      recovery: false,
    },
    {
      failure: { kind: 'emulator-did-not-answer', operation, message: 'Connection refused.' },
      first: 'Not started on port 9682',
      detail: `${operation} got no answer from the emulator. Connection refused.`,
      connection: stopped,
      recovery: true,
    },
    {
      failure: { kind: 'emulator-did-not-answer', operation, message: 'Timeout.' },
      first: `Not answering at ${endpoint}`,
      detail: `${operation} got no answer from the emulator. Timeout.`,
      connection,
      recovery: true,
    },
    {
      failure: { kind: 'engine-did-not-answer', operation },
      first: `The EmuForge engine at ${engineOrigin} is not answering`,
      detail: `${operation} got no answer.`,
      connection,
      recovery: true,
    },
    {
      failure: { kind: 'other', operation, code: 'BadRequestException', message: 'Invalid request.' },
      first: `The ${thing} could not be read`,
      detail: `${operation}: BadRequestException: Invalid request.`,
      connection,
      recovery: false,
    },
  ] satisfies {
    failure: RequestFailure;
    first: string;
    detail: string;
    connection: AreaConnection;
    recovery: boolean;
  }[];
}

it.each(readFailures('GetExport', 'invoke URL'))(
  'keeps healthy addresses and can recover GetExport after $first',
  async ({ failure, first, detail, connection, recovery }) => {
    let failDev = true;
    readAddress.mockImplementation(async (_, __, name) => {
      if (name === 'dev' && failDev) throw new RequestError(failure);
      return invokeUrl(name);
    });
    const user = open(connection);
    await waitFor(() => expect(addressCell(1)).toHaveTextContent(detail));
    const failedCell = addressCell(1);
    assert(failedCell);
    expect(failedCell).toHaveTextContent(first);
    expect(failedCell).not.toHaveTextContent(invokeUrl('dev'));
    await waitFor(() => expect(addressCell(2)).toHaveTextContent(invokeUrl('prod')));
    expect(stageAction('Refresh')).toBeEnabled();

    failDev = false;
    await retryFailure(user, failedCell, recovery);
    await waitFor(() => expect(addressCell(1)).toHaveTextContent(invokeUrl('dev')));
    readAddress.mockImplementation(async (_, __, name) => invokeUrl(name) + '?deployment=latest');
    await user.click(stageAction('Refresh'));
    await waitFor(() =>
      expect([addressCell(1)?.textContent, addressCell(2)?.textContent]).toEqual([
        invokeUrl('dev') + '?deployment=latest',
        invokeUrl('prod') + '?deployment=latest',
      ]),
    );
    expect(readStages).toHaveBeenCalledTimes(3);
  },
);

it.each(readFailures('GetStages', 'stages'))(
  'shows and retries the failed GetStages state after $first',
  async ({ failure, first, detail, connection, recovery }) => {
    readStages.mockRejectedValueOnce(new RequestError(failure));
    const user = open(connection);
    await waitFor(() => expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent(detail));
    const empty = table()?.findEmptySlot()?.getElement();
    assert(empty);
    expect(empty).toHaveTextContent(first);
    await retryFailure(user, empty, recovery);
    await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type User = ReturnType<typeof userEvent.setup>;

async function openModal(user: User, button: 'Delete' | 'Deploy API') {
  await user.click(stageAction(button));
  return waitFor(() => {
    const modal = root().findModal();
    assert(modal && modal.isVisible());
    return modal;
  });
}

async function deployToNewStage(user: User) {
  const modal = await openModal(user, 'Deploy API');
  const content = modal.findContent();
  const target = content.findRadioGroup()?.findInputByValue('new');
  assert(target);
  await user.click(target.getElement());
  const input = content.findInput()?.findNativeInput();
  assert(input);
  await user.type(input.getElement(), 'sandbox');
  const submit = modal.findFooter()?.findAllButtons().at(-1)?.getElement();
  assert(submit);
  expect(submit).toHaveTextContent('Deploy');
  await user.click(submit);
}

async function deleteDev(user: User) {
  const radio = table()?.findRowSelectionArea(1)?.find('input');
  assert(radio);
  await user.click(radio.getElement());
  const modal = await openModal(user, 'Delete');
  const input = modal.findContent().findInput()?.findNativeInput();
  assert(input);
  await user.type(input.getElement(), 'dev');
  const submit = modal.findFooter()?.findAllButtons().at(-1)?.getElement();
  assert(submit);
  expect(submit).toHaveTextContent('Delete');
  await user.click(submit);
}

const changes = [
  {
    action: 'deploy',
    mutate: deploy,
    submit: deployToNewStage,
    message: 'API deployed to stage sandbox.',
    updated: [...stages, { stageName: 'sandbox', deploymentId: 'deploy-sandbox' }],
    expectedNames: ['dev', 'prod', 'sandbox'],
    prodRow: 2,
  },
  {
    action: 'delete',
    mutate: remove,
    submit: deleteDev,
    message: 'Stage dev deleted.',
    updated: stages.slice(1),
    expectedNames: ['prod'],
    prodRow: 1,
  },
];

it.each(changes)(
  'shows the $action result and closes the dialog before refreshing stages and exports',
  async (change) => {
    const user = open();
    await waitFor(() => expect(addressCell(2)).toHaveTextContent(invokeUrl('prod')));
    expect(stageAction('Delete')).toBeDisabled();
    const feedbackAtRead = () => ({
      flash: success()?.textContent,
      modalOpen: Boolean(root().findModal()?.isVisible()),
    });
    const stagesAtRefresh: ReturnType<typeof feedbackAtRead>[] = [];
    const exportsAtRefresh: ReturnType<typeof feedbackAtRead>[] = [];
    change.mutate.mockImplementationOnce(async () => {
      readStages.mockImplementationOnce(async () => {
        stagesAtRefresh.push(feedbackAtRead());
        return change.updated;
      });
      readAddress.mockImplementation(async (_, __, name) => {
        exportsAtRefresh.push(feedbackAtRead());
        return invokeUrl(name) + '?deployment=latest';
      });
    });
    await change.submit(user);
    await waitFor(() => expect(names()).toEqual(change.expectedNames));
    await waitFor(() =>
      expect(change.expectedNames.map((_, index) => addressCell(index + 1)?.textContent)).toEqual(
        change.expectedNames.map((name) => invokeUrl(name) + '?deployment=latest'),
      ),
    );
    const feedback = { flash: change.message, modalOpen: false };
    expect(stagesAtRefresh).toEqual([feedback]);
    expect(exportsAtRefresh.length).toBeGreaterThan(0);
    for (const state of exportsAtRefresh) expect(state).toEqual(feedback);
    expect(success()).toHaveTextContent(change.message);
    if (change.action === 'delete') expect(stageAction('Delete')).toBeDisabled();
  },
);

const orderCases = changes.flatMap((change) => (['older', 'newer'] as const).map((first) => ({ ...change, first })));

it.each(orderCases)(
  'keeps the newer stages, addresses and $action result with the $first reads answering first',
  async (change) => {
    const staleStages = deferred<Stage[]>();
    const staleAddress = deferred<string>();
    const freshStages = deferred<Stage[]>();
    const freshAddress = deferred<string>();
    const readFreshStages = vi.fn(() => freshStages.promise);
    const user = open();
    await waitFor(() => expect(addressCell(2)).toHaveTextContent(invokeUrl('prod')));
    readStages.mockReturnValueOnce(staleStages.promise);
    readAddress.mockImplementation(async (_, __, name) => (name === 'prod' ? staleAddress.promise : invokeUrl(name)));
    await user.click(stageAction('Refresh'));
    await waitFor(() => expect(readStages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readAddress.mock.calls.filter(([, , name]) => name === 'prod')).toHaveLength(2));
    const stageSignal = readStages.mock.calls[1]?.[2];
    const exportSignal = readAddress.mock.calls.filter(([, , name]) => name === 'prod')[1]?.[3];
    change.mutate.mockImplementationOnce(async () => {
      readStages.mockImplementationOnce(readFreshStages);
      readAddress.mockImplementation(async (_, __, name) => (name === 'prod' ? freshAddress.promise : invokeUrl(name)));
    });
    await change.submit(user);
    await waitFor(() => expect(success()).toHaveTextContent(change.message));
    await waitFor(() => expect(readFreshStages).toHaveBeenCalledOnce());
    await waitFor(() => expect(readAddress.mock.calls.filter(([, , name]) => name === 'prod')).toHaveLength(3));
    expect(stageSignal?.aborted).toBe(true);
    expect(exportSignal?.aborted).toBe(true);

    const finishOlder = () =>
      act(async () => {
        staleStages.resolve([...stages, { stageName: 'stale', deploymentId: 'stale' }]);
        staleAddress.resolve(invokeUrl('prod') + '?deployment=stale');
      });
    const finishNewer = async () => {
      await act(async () => freshStages.resolve(change.updated));
      await waitFor(() => expect(names()).toEqual(change.expectedNames));
      await act(async () => freshAddress.resolve(invokeUrl('prod') + '?deployment=latest'));
      await waitFor(() =>
        expect(addressCell(change.prodRow)).toHaveTextContent(invokeUrl('prod') + '?deployment=latest'),
      );
    };
    if (change.first === 'older') {
      await finishOlder();
      await finishNewer();
    } else {
      await finishNewer();
      await finishOlder();
    }

    expect(names()).toEqual(change.expectedNames);
    expect(addressCell(change.prodRow)).toHaveTextContent(invokeUrl('prod') + '?deployment=latest');
    expect(success()).toHaveTextContent(change.message);
  },
);
