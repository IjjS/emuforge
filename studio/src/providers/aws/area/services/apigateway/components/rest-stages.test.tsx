import type { Stage } from '@aws-sdk/client-api-gateway';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { readRestStages } from '../rest-api';
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
const invokeUrl = (stage: string, base = endpoint) => `${base}/_aws/execute-api/${apiId}/${stage}`;
const readStages = vi.mocked(readRestStages);
const deploy = vi.mocked(deployRestApi);
const remove = vi.mocked(deleteRestStage);

beforeEach(() => {
  readStages.mockReset();
  deploy.mockReset().mockResolvedValue(undefined);
  remove.mockReset().mockResolvedValue(undefined);
  readStages.mockResolvedValue(stages);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => vi.unstubAllGlobals());

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
  const client = new QueryClient();
  const app = (active: AreaConnection) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AreaRootContext.Provider value={root}>
          <div
            ref={(element) => {
              root.current = element;
            }}
          >
            <StagesWithFlash connection={active} />
          </div>
        </AreaRootContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(app(activeConnection));
  return Object.assign(user, { setConnection: (active: AreaConnection) => rerender(app(active)) });
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

function expectAddresses(expectedNames: readonly string[], base = endpoint) {
  expect(expectedNames.map((_, index) => addressCell(index + 1)?.textContent)).toEqual(
    expectedNames.map((name) => invokeUrl(name, base)),
  );
}

function expectNoAddresses() {
  for (const row of [1, 2]) {
    const address = addressCell(row);
    assert(address);
    expect(address.textContent).toBe('No local address');
    expect(createWrapper(address).findCopyToClipboard()).toBeNull();
  }
  expect(table()?.getElement()).not.toHaveTextContent('amazonaws.com');
}

it('shows the two stage addresses as plain text with just one GetStages request', async () => {
  readStages.mockReset();
  const requests = vi.fn<(method: string, path: string) => void>();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { pathname } = new URL(request.url);
    if (pathname === '/__emuforge/session') return Response.json({ token: 'test-session' });
    requests(request.method, pathname);
    return Response.json({ item: stages });
  });

  const user = open();
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  expect(table()?.findHeaderSlot()?.getElement()).toHaveTextContent(
    'A stage serves the API as it was when last deployed. Deploy again after you change resources or methods.',
  );
  expectAddresses(['dev', 'prod']);
  for (const [index, stage] of stages.entries()) {
    const row = index + 1;
    expect(cell(row, 3)).toHaveTextContent(stage.deploymentId ?? '');
    expect(cell(row, 4)).toHaveTextContent(creationDateText(stage.lastUpdatedDate));
    const copyDeployment = table()?.findBodyCell(row, 3)?.findCopyToClipboard()?.findCopyButton().getElement();
    assert(copyDeployment);
    expect(copyDeployment).toHaveAccessibleName('Copy Deployment ID');
    await user.click(copyDeployment);
    expect(await navigator.clipboard.readText()).toBe(stage.deploymentId);

    const address = addressCell(row);
    assert(address);
    expect(address.style.minWidth).toBe('28ch');
    expect(createWrapper(address).find('a')).toBeNull();
  }
  expect(requests).toHaveBeenCalledExactlyOnceWith('GET', `/restapis/${apiId}/stages`);
});

it('copies exactly the invoke URL shown in the row and confirms the copy', async () => {
  const user = open();
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  const address = addressCell(2);
  assert(address);
  const copyAddress = createWrapper(address).findCopyToClipboard()?.findCopyButton().getElement();
  assert(copyAddress);
  expect(copyAddress).toHaveAccessibleName('Copy Invoke URL');
  const shownAddress = address.textContent;
  expect(shownAddress).toBe(invokeUrl('prod'));
  await user.click(copyAddress);
  expect(await navigator.clipboard.readText()).toBe(shownAddress);
  expect(await screen.findByText('Invoke URL copied')).toBeVisible();
});

const unreachable = {
  kind: 'emulator-unreachable',
  checkedAt: 1,
  message: 'No response.',
  emulator: { port: 9682, endpoint },
} as const;

it.each<{ state: string; result: AreaConnection['result'] }>([
  { state: 'no answer yet', result: undefined },
  { state: 'emulator not started', result: { ...unreachable, reason: 'not_started' } },
  { state: 'emulator not answering', result: { ...unreachable, reason: 'timeout' } },
  { state: 'engine not answering', result: { kind: 'engine-unreachable', checkedAt: 1, lastEmulatorPort: 9682 } },
  {
    state: 'engine error',
    result: { kind: 'engine-error', checkedAt: 1, status: 500, code: undefined, message: endpoint },
  },
])('shows no local addresses with $state', async ({ result }) => {
  open({ engineOrigin, result });
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  expectNoAddresses();
});

function connectedAt(endpoint: string, port = 9682): AreaConnection {
  return { engineOrigin, result: { kind: 'connected', checkedAt: 1, emulator: { port, endpoint } } };
}

it.each([
  'https://api-1.execute-api.us-east-1.amazonaws.com',
  'https://localhost:9682',
  'https://192.168.0.5:9682',
  'not-a-url',
  '',
])('shows no local addresses when the connected endpoint is %j', async (endpoint) => {
  open(connectedAt(endpoint));
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  expectNoAddresses();
});

it('hides and restores both addresses as the emulator stops answering and reconnects', async () => {
  const { setConnection } = open();
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  expectAddresses(['dev', 'prod']);
  setConnection({ engineOrigin, result: { ...unreachable, reason: 'timeout' } });
  expect(names()).toEqual(['dev', 'prod']);
  expectNoAddresses();
  setConnection(connection);
  expectAddresses(['dev', 'prod']);
  expect(readStages).toHaveBeenCalledOnce();
});

it('updates both addresses when the connected endpoint changes', async () => {
  const { setConnection } = open();
  await waitFor(() => expect(names()).toEqual(['dev', 'prod']));
  expectAddresses(['dev', 'prod']);
  const replacement = 'https://127.0.0.1:9700';
  setConnection(connectedAt(replacement, 9700));
  expectAddresses(['dev', 'prod'], replacement);
  expect(readStages).toHaveBeenCalledOnce();
});

it('shows why a stage is needed when none exist', async () => {
  readStages.mockResolvedValue([]);
  open();
  await waitFor(() => expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent('No stages'));
  expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent('Deploy the API to a stage to get an invoke URL.');
});

function readFailures() {
  const operation = 'GetStages';
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
      first: 'The stages could not be read',
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

it.each(readFailures())(
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
    if (connection.result?.kind !== 'connected') {
      expectNoAddresses();
      user.setConnection(connectedAt(endpoint));
    }
    expectAddresses(['dev', 'prod']);
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
  },
  {
    action: 'delete',
    mutate: remove,
    submit: deleteDev,
    message: 'Stage dev deleted.',
    updated: stages.slice(1),
    expectedNames: ['prod'],
  },
];

it.each(changes)('shows the $action result and closes the dialog before refreshing stages', async (change) => {
  const user = open();
  await waitFor(() => expect(addressCell(2)).toHaveTextContent(invokeUrl('prod')));
  expect(stageAction('Delete')).toBeDisabled();
  const feedbackAtRead = () => ({
    flash: success()?.textContent,
    modalOpen: Boolean(root().findModal()?.isVisible()),
  });
  const stagesAtRefresh: ReturnType<typeof feedbackAtRead>[] = [];
  change.mutate.mockImplementationOnce(async () => {
    readStages.mockImplementationOnce(async () => {
      stagesAtRefresh.push(feedbackAtRead());
      return change.updated;
    });
  });
  await change.submit(user);
  await waitFor(() => expect(names()).toEqual(change.expectedNames));
  expectAddresses(change.expectedNames);
  expect(stagesAtRefresh).toEqual([{ flash: change.message, modalOpen: false }]);
  expect(success()).toHaveTextContent(change.message);
  if (change.action === 'delete') expect(stageAction('Delete')).toBeDisabled();
});

const orderCases = changes.flatMap((change) => (['older', 'newer'] as const).map((first) => ({ ...change, first })));

it.each(orderCases)(
  'keeps the newer stages, addresses and $action result with the $first reads answering first',
  async (change) => {
    const staleStages = deferred<Stage[]>();
    const freshStages = deferred<Stage[]>();
    const readFreshStages = vi.fn(() => freshStages.promise);
    const user = open();
    await waitFor(() => expect(addressCell(2)).toHaveTextContent(invokeUrl('prod')));
    readStages.mockReturnValueOnce(staleStages.promise);
    await user.click(stageAction('Refresh'));
    await waitFor(() => expect(readStages).toHaveBeenCalledTimes(2));
    const stageSignal = readStages.mock.calls[1]?.[2];
    change.mutate.mockImplementationOnce(async () => {
      readStages.mockImplementationOnce(readFreshStages);
    });
    await change.submit(user);
    await waitFor(() => expect(success()).toHaveTextContent(change.message));
    await waitFor(() => expect(readFreshStages).toHaveBeenCalledOnce());
    expect(stageSignal?.aborted).toBe(true);

    const finishOlder = () =>
      act(async () => {
        staleStages.resolve([...stages, { stageName: 'stale', deploymentId: 'stale' }]);
      });
    const finishNewer = async () => {
      await act(async () => freshStages.resolve(change.updated));
      await waitFor(() => expect(names()).toEqual(change.expectedNames));
      expectAddresses(change.expectedNames);
    };
    if (change.first === 'older') {
      await finishOlder();
      await finishNewer();
    } else {
      await finishNewer();
      await finishOlder();
    }

    expect(names()).toEqual(change.expectedNames);
    expectAddresses(change.expectedNames);
    expect(success()).toHaveTextContent(change.message);
  },
);
