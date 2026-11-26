import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

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
const read = vi.mocked(getLogGroup);
const tags = vi.mocked(listLogGroupTags);
const streams = vi.mocked(listLogStreams);
const found = { kind: 'found', group: { logGroupName: group, logGroupClass: 'STANDARD' } } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listLogGroups).mockResolvedValue({ items: [] });
  vi.mocked(createLogGroup).mockResolvedValue({ $metadata: {} });
  vi.mocked(putRetentionPolicy).mockResolvedValue({ $metadata: {} });
  vi.mocked(putLogGroupDeletionProtection).mockResolvedValue({ $metadata: {} });
  vi.mocked(saveLogGroupTags).mockResolvedValue(undefined);
  vi.mocked(deleteLogGroup).mockResolvedValue(undefined);
  tags.mockReset().mockResolvedValue({ team: 'web' });
  streams.mockReset().mockResolvedValue({ items: [{ logStreamName: 'some-stream' }] });
});

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
  expect(await screen.findByText('Standard')).toBeVisible();
  expect(await screen.findByText('web')).toBeVisible();
  expect(await screen.findByRole('link', { name: 'some-stream' })).toBeVisible();
  expect(read).toHaveBeenCalledWith(engineOrigin, group, expect.any(AbortSignal));
});

it('shows a not-found state in place of the details and streams when the group is absent', async () => {
  read.mockResolvedValueOnce({ kind: 'not-found' });
  renderPage();
  expect(await screen.findByText('Log group not found', { selector: 'strong' })).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(streams).not.toHaveBeenCalled();
  expect(tags).not.toHaveBeenCalled();
});

it.each(failures)('shows %s in the page and retries the group read', async (_label, failure, result, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(found);
  const { container } = renderPage(result);
  await waitFor(() => expect(container).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') expect(container).toHaveTextContent('Not implemented by the emulator');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('link', { name: 'some-stream' })).toBeVisible();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(engineOrigin, group, expect.any(AbortSignal));
});

it('links Search log events to the events page with the group chosen', async () => {
  read.mockResolvedValueOnce(found);
  const { container } = renderPage();
  await screen.findByText('Standard');
  const search = container.querySelector('a[href^="/aws/logs/log-events?"]');
  expect(search).toHaveAccessibleName('Search log events');
  expect(search).toHaveAttribute('href', '/aws/logs/log-events?group=%2Fapp%23Group');
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
  const element = await screen.findByRole('dialog', { name: `Delete log group ${group}?` });
  const dialog = within(element);
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: group } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

it('hands the deletion result to Log groups without restarting the deleted group’s reads', async () => {
  read.mockResolvedValueOnce(found);
  openLayout();
  await startDelete();
  expect(await screen.findByRole('heading', { level: 1, name: 'Log groups' })).toBeVisible();
  expect(screen.getByRole('list', { name: 'Notifications' })).toHaveTextContent(`Log group ${group} deleted.`);
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
  const oldRead = Promise.withResolvers<LogGroupRead>();
  const write = Promise.withResolvers<void>();
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
  expect(screen.queryByText('Log group not found')).not.toBeInTheDocument();
  await act(async () => write.resolve());
  expect(handOver).toHaveBeenCalledWith(LOG_GROUPS_PATH, [expect.objectContaining({ type: 'success' })]);
  expect(screen.queryByText('Log group not found')).not.toBeInTheDocument();
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
    const oldRead = Promise.withResolvers<LogGroupRead>();
    const newRead = Promise.withResolvers<LogGroupRead>();
    const newTags = Promise.withResolvers<Record<string, string>>();
    const write = Promise.withResolvers<{ $metadata: object }>();
    read.mockResolvedValueOnce(original).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    tags.mockResolvedValueOnce({ team: 'old-team' }).mockReturnValueOnce(newTags.promise);
    if (setting === 'retention') putRetention.mockReturnValueOnce(write.promise);
    else if (setting === 'protection') putProtection.mockReturnValueOnce(write.promise);
    else
      saveTags.mockImplementationOnce(async () => {
        await write.promise;
      });
    const client = openLayout();
    await screen.findByText('old-team');

    void client.refetchQueries({ queryKey: LOGS_KEYS.group(group) });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    if (setting === 'protection') {
      fireEvent.click(screen.getByRole('button', { name: 'Turn on deletion protection' }));
    } else {
      const label = setting === 'retention' ? 'Edit retention' : 'Manage tags';
      fireEvent.click(screen.getByRole('button', { name: label }));
      const element = await screen.findByRole('dialog', { name: label });
      const dialog = within(element);
      if (setting === 'retention') {
        const select = createWrapper(element).findSelect();
        if (select === null) throw new Error('Retention select not found.');
        act(() => select.openDropdown());
        act(() => select.selectOptionByValue('30'));
      } else {
        fireEvent.change(dialog.getByDisplayValue('old-team'), { target: { value: 'new-team' } });
      }
      fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    }
    await act(async () => write.resolve({ $metadata: {} }));
    const flash = await screen.findByRole('list', { name: 'Notifications' });
    expect(flash).toHaveTextContent(result);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));

    await act(async () => oldRead.resolve(original));
    await act(async () => newTags.resolve({ team: 'new-team' }));
    expect(await screen.findByText('new-team')).toBeVisible();
    expect(flash).toHaveTextContent(result);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

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
      expect(await screen.findByText('NewReadFailure')).toBeVisible();
    } else {
      await act(async () =>
        newRead.resolve({
          kind: 'found',
          group: { ...found.group, retentionInDays: 30, deletionProtectionEnabled: true },
        }),
      );
      expect(await screen.findByRole('button', { name: 'Turn off deletion protection' })).toBeEnabled();
    }
    expect(flash).toHaveTextContent(result);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
);

const readOrders = ['tags first', 'streams first', 'tags fail', 'group fails'] as const;

it.each([false, true].flatMap((partial) => readOrders.map((order) => [partial, order] as const)))(
  'keeps the create hand-over (partial = %s) when %s',
  async (partial, order) => {
    const groupRead = Promise.withResolvers<LogGroupRead>();
    const tagsRead = Promise.withResolvers<Record<string, string>>();
    const streamsRead = Promise.withResolvers<Awaited<ReturnType<typeof listLogStreams>>>();
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
    fireEvent.change(screen.getByRole('textbox', { name }), { target: { value: group } });
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
    expect(screen.getByText('Loading log group')).toBeVisible();
    const flash = screen.getByRole('list', { name: 'Notifications' });
    expect(flash).toHaveTextContent(result);
    if (partial) expect(flash).toHaveTextContent('Retention refused.');

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
      expect(await screen.findByText('GroupReadFailure')).toBeVisible();
      expect(tags).not.toHaveBeenCalled();
      expect(streams).not.toHaveBeenCalled();
    } else {
      await act(async () => groupRead.resolve(found));
      await screen.findByRole('heading', { name: 'Details' });
      expect(flash).toHaveTextContent(result);
      if (order === 'streams first') {
        await act(async () => streamsRead.resolve({ items: [{ logStreamName: 'first-stream' }] }));
        expect(await screen.findByRole('link', { name: 'first-stream' })).toBeVisible();
        expect(screen.getByText('Loading tags')).toBeVisible();
        expect(flash).toHaveTextContent(result);
        await act(async () => tagsRead.resolve({ team: 'last-tag' }));
        expect(await screen.findByText('last-tag')).toBeVisible();
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
          expect(await screen.findByText('TagsReadFailure')).toBeVisible();
        } else {
          await act(async () => tagsRead.resolve({ team: 'first-tag' }));
          expect(await screen.findByText('first-tag')).toBeVisible();
        }
        expect(flash).toHaveTextContent(result);
        await act(async () => streamsRead.resolve({ items: [{ logStreamName: 'last-stream' }] }));
        expect(await screen.findByRole('link', { name: 'last-stream' })).toBeVisible();
      }
    }
    expect(flash).toHaveTextContent(result);
  },
);
