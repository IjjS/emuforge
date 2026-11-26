import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  aws,
  boxText,
  buttonIn,
  requiredElement,
  detailValue,
  flash,
  modal as openModal,
  modalButton,
  modalInput,
  modalInputByValue,
  tableByHeading,
  waitForLink,
} from '../../../../../../test/logs-test-utils';
import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import { areaPage, areaPageTitle } from '../../../area-page';
import type { AreaConnection } from '../../../components/emulator-line';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { screenCrumbs } from '../../../screen-paths';
import { getLogGroup, listLogGroups, listLogGroupTags, type LogGroupRead } from '../api';
import { CREATE_LOG_GROUP_PATH, LOG_GROUPS_PATH } from '../format';
import { createLogGroup, putRetentionPolicy } from '../group-create-api';
import { deleteLogGroup } from '../group-delete-api';
import { putLogGroupDeletionProtection, saveLogGroupTags } from '../group-settings-api';
import { LOGS_KEYS } from '../queries';
import { listLogStreams } from '../stream-api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getLogGroup: vi.fn(),
  listLogGroups: vi.fn(),
  listLogGroupTags: vi.fn(),
}));
vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

vi.mock('../group-create-api', async (original) => ({
  ...(await original<typeof import('../group-create-api')>()),
  createLogGroup: vi.fn(),
  putRetentionPolicy: vi.fn(),
}));
vi.mock('../group-delete-api', async (original) => ({
  ...(await original<typeof import('../group-delete-api')>()),
  deleteLogGroup: vi.fn(),
}));
vi.mock('../group-settings-api', async (original) => ({
  ...(await original<typeof import('../group-settings-api')>()),
  putLogGroupDeletionProtection: vi.fn(),
  saveLogGroupTags: vi.fn(),
}));

const operation = 'DescribeLogGroups';
const emulator = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const engineOrigin = 'http://127.0.0.1:8310';
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});
const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, connected, `501 Not Implemented for ${operation}`],
  [
    'access denied',
    { kind: 'access-denied', operation, message: 'policy refusal' },
    connected,
    `${operation} was refused: policy refusal`,
  ],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9310',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    `Not answering at ${emulator.endpoint}`,
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: emulator.port },
    `The EmuForge engine at ${engineOrigin} is not answering`,
  ],
  [
    'other refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'request refused' },
    connected,
    'InvalidParameterException: request refused',
  ],
];

const group = '/app#Group';
const path = '/aws/logs/log-groups/group/%2Fapp%23Group';
const streamTable = () => tableByHeading('Log streams');
const groupReadBody = () => aws().findContentLayout()?.findContainer()?.findContent();
const read = vi.mocked(getLogGroup);
const tags = vi.mocked(listLogGroupTags);
const streams = vi.mocked(listLogStreams);
const found = { kind: 'found', group: { logGroupName: group, logGroupClass: 'STANDARD' } } as const;

function firstTagValue() {
  const table = createWrapper(document.body)
    .findAllTables()
    .find(
      (candidate) => candidate.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Tags',
    );
  return table?.findBodyCell(1, 2)?.getElement();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(listLogGroups).mockResolvedValue({ items: [] });
  vi.mocked(createLogGroup).mockResolvedValue({ $metadata: {} });
  vi.mocked(putRetentionPolicy).mockResolvedValue({ $metadata: {} });
  vi.mocked(putLogGroupDeletionProtection).mockResolvedValue({ $metadata: {} });
  vi.mocked(saveLogGroupTags).mockResolvedValue(undefined);
  vi.mocked(deleteLogGroup).mockResolvedValue(undefined);
  tags.mockReset().mockResolvedValue({ team: 'web' });
  streams.mockReset().mockResolvedValue({ items: [{ logStreamName: 'some-stream' }] });
});

afterEach(() => vi.unstubAllGlobals());

function renderPage(result: AreaConnection['result'] = connected) {
  const route = areaPage(path);
  if (route.kind !== 'screen') throw new Error('The log group screen is not registered.');
  const {
    screen: { Page },
    params,
  } = route;
  const resources = vi.fn();
  const rendered = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={new QueryClient()}>
        <PageResourcesContext.Provider value={resources}>
          <main>
            <Page connection={{ engineOrigin, result }} params={params} />
          </main>
        </PageResourcesContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...rendered, resources, route };
}

it('opens the address by group name, uses it for the title and crumb, and shows the details and streams', async () => {
  read.mockResolvedValueOnce(found);
  const { route, resources } = renderPage();
  expect(areaPageTitle(route)).toBe(group);
  expect(screenCrumbs(route.screen, route.params, new URLSearchParams()).at(-1)).toEqual({ text: group });
  expect(screen.getByRole('heading', { level: 1, name: group })).toBeVisible();
  expect(resources).toHaveBeenCalledWith({ word: 'log streams' });
  await waitFor(() => {
    const value = detailValue('Class');
    expect(value).toBeVisible();
    expect(value).toHaveTextContent('Standard');
  });
  await waitFor(() => expect(firstTagValue()).toHaveTextContent('web'));
  expect(await waitForLink(streamTable, 'some-stream')).toBeVisible();
  expect(read).toHaveBeenCalledWith(engineOrigin, group, expect.any(AbortSignal));
});

it('shows a not-found state in place of the details and streams when the group is absent', async () => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  renderPage();
  await waitFor(() => expect(boxText(aws(), 'Log group not found', 'strong')).toBeVisible());
  expect(aws().findTable()?.getElement() ?? null).not.toBeInTheDocument();
  expect(streams).not.toHaveBeenCalled();
  expect(tags).not.toHaveBeenCalled();
});

it.each(failures)('shows %s in the page and retries the group read', async (_label, failure, result, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(found);
  renderPage(result);
  await waitFor(() => expect(groupReadBody()?.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented')
    expect(groupReadBody()?.findStatusIndicator()?.getElement()).toHaveTextContent('Not implemented by the emulator');
  expect(aws().findTable()?.getElement() ?? null).not.toBeInTheDocument();
  fireEvent.click(requiredElement(buttonIn(groupReadBody(), 'Retry')));
  expect(await waitForLink(streamTable, 'some-stream')).toBeVisible();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(engineOrigin, group, expect.any(AbortSignal));
});

it('links Search log events to the events page with the group chosen', async () => {
  read.mockResolvedValueOnce(found);
  const { container } = renderPage();
  await waitFor(() => {
    const value = detailValue('Class');
    expect(value).toBeVisible();
    expect(value).toHaveTextContent('Standard');
  });
  const search = createWrapper(container)
    .findContentLayout()
    ?.findHeader()
    ?.findButton('a[href^="/aws/logs/log-events?"]')
    ?.getElement();
  expect(search).toHaveAccessibleName('Search log events');
  expect(search).toHaveAttribute('href', '/aws/logs/log-events?group=%2Fapp%23Group');
});

it('jumps from the header to the log streams table on keyboard activation', async () => {
  read.mockResolvedValueOnce(found);
  const user = userEvent.setup();
  const { container } = renderPage();
  const header = createWrapper(container).findContentLayout()?.findHeader();
  const jump = await waitFor(() => {
    const link = requiredElement(header?.findButton('a[href^="#"]')?.getElement());
    expect(link).toBeVisible();
    expect(link).toHaveAccessibleName('Jump to log streams');
    return link;
  });
  const search = header?.findButton('a[href^="/aws/logs/log-events?"]')?.getElement();
  expect(search).toHaveAccessibleName('Search log events');
  const section = screen.getByRole('region', { name: 'Log streams' });
  expect(jump).toHaveAttribute('href', `#${section.id}`);
  await waitFor(() => expect(createWrapper(section).findTable()?.getElement()).toBeVisible());
  const scroll = vi.fn();
  Object.defineProperty(section, 'scrollIntoView', { value: scroll });

  jump.focus();
  await user.keyboard('{Enter}');

  expect(section).toHaveFocus();
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
});

it('omits the jump when there is no streams section', async () => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  renderPage();
  await waitFor(() => expect(boxText(aws(), 'Log group not found', 'strong')).toBeVisible());

  expect(
    aws().findContentLayout()?.findHeader()?.findButton('a[href^="#"]')?.getElement() ?? null,
  ).not.toBeInTheDocument();
});

const connection = { engineOrigin, result: connected };
const putRetention = vi.mocked(putRetentionPolicy);
const putProtection = vi.mocked(putLogGroupDeletionProtection);
const saveTags = vi.mocked(saveLogGroupTags);
const deleteGroup = vi.mocked(deleteLogGroup);
const original = { ...found, group: { ...found.group, retentionInDays: 7 } } satisfies LogGroupRead;

function Layout({ initialPath }: { initialPath: string }) {
  const { pathname } = useLocation();
  return (
    <AreaLayout
      connection={connection}
      headerSelector="#studio-header"
      onContentTarget={vi.fn()}
      onPageTitle={vi.fn()}
      routeChanges={pathname === initialPath ? 0 : 1}
    />
  );
}

function openLayout(initialPath = path) {
  const client = new QueryClient();
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={client}>
        <Layout initialPath={initialPath} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}

async function startDelete() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  const dialog = await openModal(`Delete log group ${group}?`);

  fireEvent.change(modalInput(dialog), { target: { value: group } });
  fireEvent.click(modalButton(dialog, 'Delete'));
}

it('hands the deletion result to Log groups without restarting the deleted group’s reads', async () => {
  read.mockResolvedValueOnce(found);
  openLayout();
  await startDelete();
  expect(await screen.findByRole('heading', { level: 1, name: 'Log groups' })).toBeVisible();
  expect(flash()?.getElement()).toHaveTextContent(`Log group ${group} deleted.`);
  expect(deleteGroup).toHaveBeenCalledWith(engineOrigin, group, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledTimes(1);
});

function HeldPage({ flash }: { flash: PageFlash }) {
  const root = useRef<HTMLDivElement>(null);
  const route = areaPage(path);
  if (route.kind !== 'screen') throw new Error('The log group screen is not registered.');
  const { Page } = route.screen;
  return (
    <AreaRootContext.Provider value={root}>
      <PageFlashContext.Provider value={flash}>
        <div ref={root}>
          <Page connection={connection} params={route.params} />
        </div>
      </PageFlashContext.Provider>
    </AreaRootContext.Provider>
  );
}

it('still hands over the result if an outstanding group read finds the deleted group missing before navigation', async () => {
  const oldRead = deferred<LogGroupRead>();
  const write = deferred<undefined>();
  read.mockResolvedValueOnce(found).mockReturnValueOnce(oldRead.promise);
  deleteGroup.mockReturnValueOnce(write.promise);
  const handOver = vi.fn<PageFlash['handOver']>();
  const client = new QueryClient();
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <HeldPage flash={{ handOver, show: vi.fn() }} />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  await screen.findByRole('button', { name: 'Delete' });
  void client.refetchQueries({ queryKey: LOGS_KEYS.group(group) });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await startDelete();
  expect(deleteGroup).toHaveBeenCalledTimes(1);
  await act(async () => oldRead.resolve({ kind: 'not-found' }));
  await waitFor(() => expect(client.getQueryData(readKey(client))).toEqual({ kind: 'not-found' }));
  expect(boxText(aws(), 'Log group not found', 'strong') ?? null).not.toBeInTheDocument();
  await act(async () => write.resolve(undefined));
  expect(handOver).toHaveBeenCalledWith(LOG_GROUPS_PATH, [expect.objectContaining({ type: 'success' })]);
  expect(boxText(aws(), 'Log group not found', 'strong') ?? null).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(2);
});

function readKey(client: QueryClient) {
  const query = client.getQueryCache().find({ queryKey: LOGS_KEYS.group(group), exact: false });
  if (query === undefined) throw new Error('The log group read was not found.');
  return query.queryKey;
}

const settings = [
  ['retention', `Retention of ${group} set to 30 days.`],
  ['protection', `Deletion protection turned on for ${group}.`],
  ['tags', `Tags of ${group} saved.`],
] as const;

it.each(
  settings.flatMap(([setting, result]) => [[setting, 'answers', result] as const, [setting, 'fails', result] as const]),
)(
  'keeps the %s result and closes its dialog when the new group read %s after the tags',
  async (setting, outcome, result) => {
    const oldRead = deferred<LogGroupRead>();
    const newRead = deferred<LogGroupRead>();
    const newTags = deferred<Record<string, string>>();
    const write = deferred<{ $metadata: object }>();
    read.mockResolvedValueOnce(original).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    tags.mockResolvedValueOnce({ team: 'old-team' }).mockReturnValueOnce(newTags.promise);
    if (setting === 'retention') putRetention.mockReturnValueOnce(write.promise);
    else if (setting === 'protection') putProtection.mockReturnValueOnce(write.promise);
    else
      saveTags.mockImplementationOnce(async () => {
        await write.promise;
      });
    const client = openLayout();
    await waitFor(() => expect(firstTagValue()).toHaveTextContent('old-team'));

    void client.refetchQueries({ queryKey: LOGS_KEYS.group(group) });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    if (setting === 'protection') {
      fireEvent.click(screen.getByRole('button', { name: 'Turn on deletion protection' }));
    } else {
      const label = setting === 'retention' ? 'Edit retention' : 'Manage tags';
      fireEvent.click(screen.getByRole('button', { name: label }));
      const dialog = await openModal(label);

      if (setting === 'retention') {
        const select = dialog.findContent().findSelect();
        if (select === null) throw new Error('Retention select not found.');
        act(() => select.openDropdown());
        act(() => select.selectOptionByValue('30'));
      } else {
        fireEvent.change(modalInputByValue(dialog, 'old-team'), { target: { value: 'new-team' } });
      }
      fireEvent.click(modalButton(dialog, 'Save'));
    }
    await act(async () => write.resolve({ $metadata: {} }));
    const notification = await waitFor(() => {
      const item = flash()?.getElement();
      expect(item).toBeVisible();
      return item;
    });
    expect(notification).toHaveTextContent(result);
    expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));

    await act(async () => oldRead.resolve(original));
    await act(async () => newTags.resolve({ team: 'new-team' }));
    await waitFor(() => expect(firstTagValue()).toHaveTextContent('new-team'));
    expect(notification).toHaveTextContent(result);
    expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();

    if (outcome === 'fails') {
      await act(async () =>
        newRead.reject(
          new RequestError({
            kind: 'other',
            operation,
            code: 'NewReadFailure',
            message: 'Could not refresh.',
          }),
        ),
      );
      await waitFor(() => expect(boxText(aws(), 'NewReadFailure', 'code')).toBeVisible());
    } else {
      await act(async () =>
        newRead.resolve({
          kind: 'found',
          group: { ...found.group, retentionInDays: 30, deletionProtectionEnabled: true },
        }),
      );
      expect(await screen.findByRole('button', { name: 'Turn off deletion protection' })).toBeEnabled();
    }
    expect(notification).toHaveTextContent(result);
    expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
  },
);

const readOrders = ['tags first', 'streams first', 'tags fail', 'group fails'] as const;

it.each([false, true].flatMap((partial) => readOrders.map((order) => [partial, order] as const)))(
  'keeps the create hand-over (partial = %s) when %s',
  async (partial, order) => {
    const groupRead = deferred<LogGroupRead>();
    const tagsRead = deferred<Record<string, string>>();
    const streamsRead = deferred<Awaited<ReturnType<typeof listLogStreams>>>();
    const result = partial
      ? `Log group ${group} created, but its retention was not set.`
      : `Log group ${group} created.`;
    read.mockReturnValueOnce(groupRead.promise);
    tags.mockReturnValueOnce(tagsRead.promise);
    streams.mockReturnValueOnce(streamsRead.promise);
    if (partial) {
      putRetention.mockRejectedValueOnce(
        new RequestError({
          kind: 'other',
          operation: 'PutRetentionPolicy',
          code: 'RetentionRefused',
          message: 'Retention refused.',
        }),
      );
    }

    const name = 'Log group name';
    openLayout(CREATE_LOG_GROUP_PATH);
    const nameField = aws()
      .findAllFormFields()
      .find((field) => field.findLabel()?.getElement().textContent === name);
    const input = requiredElement(nameField?.findControl()?.findInput()?.findNativeInput().getElement());
    fireEvent.change(input, { target: { value: group } });
    if (partial) {
      const control = createWrapper(document.body)
        .findAllFormFields()
        .find((field) => field.findLabel()?.getElement().textContent === 'Retention');
      const select = control && createWrapper(control.getElement()).findSelect();
      if (!select) throw new Error('Retention select not found.');
      act(() => select.openDropdown());
      act(() => select.selectOptionByValue('7'));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create log group' }));

    expect(await screen.findByRole('heading', { level: 1, name: group })).toBeVisible();
    const loading = groupReadBody()?.findStatusIndicator()?.getElement();
    expect(loading).toBeVisible();
    expect(loading).toHaveTextContent('Loading log group');
    const notification = flash()?.getElement();
    expect(notification).toHaveTextContent(result);
    if (partial) {
      const error = aws().findFlashbar()?.findItemsByType('error')[0]?.findContent()?.getElement();
      expect(error).toHaveTextContent('Retention refused.');
    }

    if (order === 'group fails') {
      await act(async () =>
        groupRead.reject(
          new RequestError({
            kind: 'other',
            operation,
            code: 'GroupReadFailure',
            message: 'Could not read group.',
          }),
        ),
      );
      await waitFor(() => expect(boxText(aws(), 'GroupReadFailure', 'code')).toBeVisible());
      expect(tags).not.toHaveBeenCalled();
      expect(streams).not.toHaveBeenCalled();
    } else {
      await act(async () => groupRead.resolve(found));
      await screen.findByRole('heading', { name: 'Details' });
      expect(notification).toHaveTextContent(result);
      if (order === 'streams first') {
        await act(async () => streamsRead.resolve({ items: [{ logStreamName: 'first-stream' }] }));
        expect(await waitForLink(streamTable, 'first-stream')).toBeVisible();
        const loading = tableByHeading('Tags')?.findLoadingText()?.getElement();
        expect(loading).toBeVisible();
        expect(loading).toHaveTextContent('Loading tags');
        expect(notification).toHaveTextContent(result);
        await act(async () => tagsRead.resolve({ team: 'last-tag' }));
        await waitFor(() => expect(firstTagValue()).toHaveTextContent('last-tag'));
      } else {
        if (order === 'tags fail') {
          await act(async () =>
            tagsRead.reject(
              new RequestError({
                kind: 'other',
                operation: 'ListTagsLogGroup',
                code: 'TagsReadFailure',
                message: 'Could not read tags.',
              }),
            ),
          );
          await waitFor(() =>
            expect(boxText(tableByHeading('Tags')?.findEmptySlot(), 'TagsReadFailure', 'code')).toBeVisible(),
          );
        } else {
          await act(async () => tagsRead.resolve({ team: 'first-tag' }));
          await waitFor(() => expect(firstTagValue()).toHaveTextContent('first-tag'));
        }
        expect(notification).toHaveTextContent(result);
        await act(async () => streamsRead.resolve({ items: [{ logStreamName: 'last-stream' }] }));
        expect(await waitForLink(streamTable, 'last-stream')).toBeVisible();
      }
    }
    expect(notification).toHaveTextContent(result);
  },
);
