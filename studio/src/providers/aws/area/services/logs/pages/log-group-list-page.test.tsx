import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  aws,
  boxText,
  buttonIn,
  expectEmpty,
  expectModalAlert,
  modal as openModal,
  modalAlert,
  modalButton,
  modalInput,
  rowLink,
  rowRadio,
  type Modal,
  waitForLink,
  requiredElement,
} from '../../../../../../test/logs-test-utils';
import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import type { TokenPage } from '../../../components/use-token-listing';
import { useAreaFlash } from '../../../components/use-area-flash';
import { listLogGroups } from '../api';
import { deleteLogGroup } from '../group-delete-api';
import { LogGroupListPage } from './log-group-list-page';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listLogGroups: vi.fn(),
}));

vi.mock('../group-delete-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../group-delete-api')>()),
  deleteLogGroup: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8306';
const EMULATOR = { port: 9306, endpoint: 'https://127.0.0.1:9306' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const operation = 'DescribeLogGroups';
const groupTable = () => aws().findTable();
const read = vi.mocked(listLogGroups);
const remove = vi.mocked(deleteLogGroup);

beforeEach(() => {
  read.mockReset();
  remove.mockReset();
});

function renderPage(result: AreaConnection['result'] = CONNECTED) {
  const resources = vi.fn();
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const flash = useAreaFlash('/aws/logs/log-groups', 0, true);
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={flash.pageFlash}>
          <div ref={root}>
            {flash.shown && <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />}
            <PageResourcesContext.Provider value={resources}>
              <main>
                <LogGroupListPage connection={{ engineOrigin: ENGINE, result }} />
              </main>
            </PageResourcesContext.Provider>
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect(createWrapper(rendered.container).findTable()).not.toBeNull();
  return { ...rendered, resources };
}

const group = (name: string): TokenPage<LogGroup> => ({ items: [{ logGroupName: name }] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function changeFilter(value: string) {
  fireEvent.change(
    requiredElement(groupTable()?.findFilterSlot()?.findTextFilter()?.findInput().findNativeInput().getElement()),
    {
      target: { value },
    },
  );
}

const nextPage = () => requiredElement(groupTable()?.findPagination()?.findNextPageButton().getElement());

function refresh() {
  fireEvent.click(requiredElement(buttonIn(groupTable()?.findHeaderSlot() ?? null, 'Refresh')));
}

function expectRead(pattern: string, token?: string) {
  expect(read).toHaveBeenLastCalledWith(ENGINE, pattern, token, expect.any(AbortSignal));
}

it('shows the group values, the name link and the resource notice word', async () => {
  const creationTime = Date.UTC(2026, 10, 26, 12);
  read.mockResolvedValueOnce({
    items: [
      {
        logGroupName: '/app#Cold',
        retentionInDays: 7,
        logGroupClass: 'INFREQUENT_ACCESS',
        deletionProtectionEnabled: true,
        creationTime,
      },
      { logGroupName: 'app', logGroupClass: 'STANDARD', deletionProtectionEnabled: false },
    ],
  });
  const { container, resources } = renderPage();
  expect(resources).toHaveBeenCalledWith({ word: 'log groups' });
  expect(await waitForLink(groupTable, '/app#Cold')).toHaveAttribute(
    'href',
    '/aws/logs/log-groups/group/%2Fapp%23Cold',
  );
  const rows = createWrapper(container).findTable()?.findRows();
  expect(rows).toHaveLength(2);
  expect(rows?.[0]?.getElement()).toHaveTextContent(
    `/app#Cold7 daysInfrequent AccessOn${creationDateText(new Date(creationTime))}`,
  );
  expect(rows?.[1]?.getElement()).toHaveTextContent('appNever expireStandardOff');
});

it('shows loading, an empty emulator and a filter with no matches', async () => {
  read.mockResolvedValue({ items: [] });
  renderPage();
  const loading = groupTable()?.findLoadingText()?.getElement();
  expect(loading).toBeVisible();
  expect(loading).toHaveTextContent('Loading log groups');
  await expectEmpty(groupTable, 'No log groups');
  changeFilter('absent');
  await expectEmpty(groupTable, 'No log groups match');
  expectRead('absent');
});

it('waits for the entered filter and reads its first page after paging the unfiltered list', async () => {
  read
    .mockResolvedValueOnce({ ...group('first'), next: 'second' })
    .mockResolvedValueOnce(group('unfiltered second'))
    .mockResolvedValueOnce(group('mixed-case match'));
  renderPage();
  await waitForLink(groupTable, 'first');
  fireEvent.click(nextPage());
  await waitForLink(groupTable, 'unfiltered second');
  expectRead('', 'second');

  changeFilter('MiXeD');
  expect(read).toHaveBeenCalledTimes(2);
  expect(await waitForLink(groupTable, 'mixed-case match')).toBeVisible();
  expectRead('MiXeD');
  expect(groupTable()?.findPagination()?.findPageNumberByIndex(1)?.getElement()).toHaveAttribute(
    'aria-current',
    'true',
  );
});

async function endFilteredList() {
  read
    .mockResolvedValueOnce(group('all'))
    .mockResolvedValueOnce({ ...group('Keep 1'), next: 'second' })
    .mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
  renderPage();
  await waitForLink(groupTable, 'all');
  changeFilter('Keep');
  await waitForLink(groupTable, 'Keep 1');
  fireEvent.click(nextPage());
  await waitForLink(groupTable, 'Keep 2');
  expectRead('Keep', 'second');

  let resolveEnd!: (value: TokenPage<LogGroup>) => void;
  const end = new Promise<TokenPage<LogGroup>>((resolve) => {
    resolveEnd = resolve;
  });
  read.mockReturnValueOnce(end).mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
  fireEvent.click(nextPage());
  await waitFor(() => expectRead('Keep', 'third'));
  expect(rowLink(groupTable(), 'Keep 2')).toBeVisible();
  await act(async () => resolveEnd({ items: [] }));
  await waitFor(() => expectRead('Keep', 'second'));
  await waitFor(() =>
    expect(requiredElement(buttonIn(groupTable()?.findHeaderSlot() ?? null, 'Refresh'))).not.toHaveAttribute(
      'aria-disabled',
      'true',
    ),
  );
}

function expectEnd() {
  expect(rowLink(groupTable(), 'Keep 2')).toBeVisible();
  expect(groupTable()?.findPagination()?.findPageNumberByIndex(2)?.getElement()).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(groupTable()?.findPagination()?.findPageNumbers()[2]?.getElement() ?? null).not.toBeInTheDocument();
  expect(nextPage()).toHaveAttribute('aria-disabled', 'true');
  expect(boxText(createWrapper(screen.getByRole('main')), 'No more log groups.')).toBeVisible();
}

describe('after the end of a filtered list', () => {
  it('keeps the second page, closes its end and reports why', async () => {
    await endFilteredList();
    expectEnd();
  });

  it('starts a changed filter from its own first page with a next page', async () => {
    await endFilteredList();
    read.mockResolvedValueOnce({ ...group('New 1'), next: 'new second' });
    changeFilter('New');
    expect(await waitForLink(groupTable, 'New 1')).toBeVisible();
    expectRead('New');
    expect(boxText(aws(), 'No more log groups.') ?? null).not.toBeInTheDocument();
    expect(groupTable()?.findPagination()?.findPageNumberByIndex(1)?.getElement()).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(nextPage()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('refreshes the ended page with its own token and clears its end until it is met again', async () => {
    await endFilteredList();
    read.mockResolvedValueOnce({ ...group('Keep 2 refreshed'), next: 'third' });
    refresh();
    expect(await waitForLink(groupTable, 'Keep 2 refreshed')).toBeVisible();
    expectRead('Keep', 'second');
    expect(boxText(aws(), 'No more log groups.') ?? null).not.toBeInTheDocument();
    expect(nextPage()).not.toHaveAttribute('aria-disabled', 'true');

    read.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
    fireEvent.click(nextPage());
    await waitFor(expectEnd);
  });

  it('can go back and take the next page from the first page', async () => {
    await endFilteredList();
    read
      .mockResolvedValueOnce({ ...group('Keep 1'), next: 'second' })
      .mockResolvedValueOnce({ ...group('Keep 2'), next: 'third' });
    fireEvent.click(requiredElement(groupTable()?.findPagination()?.findPreviousPageButton().getElement()));
    expect(await waitForLink(groupTable, 'Keep 1')).toBeVisible();
    expectRead('Keep');
    expect(nextPage()).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(nextPage());
    expect(await waitForLink(groupTable, 'Keep 2')).toBeVisible();
    expectRead('Keep', 'second');
  });
});

const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator: EMULATOR,
  reason,
  message: '',
});

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, CONNECTED, '501 Not Implemented for DescribeLogGroups'],
  ['access denied', { kind: 'access-denied', operation, message: 'policy refusal' }, CONNECTED, 'policy refusal'],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9306',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    'Not answering at https://127.0.0.1:9306',
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: EMULATOR.port },
    `The EmuForge engine at ${ENGINE} is not answering`,
  ],
  [
    'another refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'bad name pattern' },
    CONNECTED,
    'InvalidParameterException: bad name pattern',
  ],
];

it.each(failures)('shows %s in the table and lets Retry read again', async (_name, failure, connection, text) => {
  read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(group('retried'));
  const { container } = renderPage(connection);
  const table = createWrapper(container).findTable();
  await waitFor(() => expect(table?.findEmptySlot()?.getElement()).toHaveTextContent(text));
  if (failure.kind === 'not-implemented') {
    expect(table?.findEmptySlot()?.getElement()).toHaveTextContent('Not implemented by the emulator');
  }
  fireEvent.click(requiredElement(buttonIn(groupTable()?.findEmptySlot() ?? null, 'Retry')));
  expect(await waitForLink(groupTable, 'retried')).toBeVisible();
  expectRead('');
});

it('links to the create form and disables Delete until a row is selected', async () => {
  read.mockResolvedValueOnce(group('selectable'));
  renderPage();
  await waitForLink(groupTable, 'selectable');
  const create = groupTable()?.findHeaderSlot()?.findButton('a[href="/aws/logs/log-groups/create"]')?.getElement();
  expect(create).toHaveAccessibleName('Create log group');
  expect(create).toHaveAttribute('href', '/aws/logs/log-groups/create');
  const remove = requiredElement(buttonIn(groupTable()?.findHeaderSlot() ?? null, 'Delete'));
  expect(remove).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(rowRadio(groupTable(), 'selectable'));
  expect(remove).toBeEnabled();
  expect(remove).not.toHaveAttribute('aria-disabled', 'true');
});

describe('deleting a log group', () => {
  const name = '/app#Cold';
  const current = group(name);
  const afterDelete = group('remaining');
  const readError = new RequestError({
    kind: 'other',
    operation,
    code: 'InvalidParameterException',
    message: 'List read refused.',
  });

  async function openDelete() {
    await waitForLink(groupTable, name);
    fireEvent.click(rowRadio(groupTable(), name));
    const opener = requiredElement(buttonIn(groupTable()?.findHeaderSlot() ?? null, 'Delete'));
    opener.focus();
    fireEvent.click(opener);
    const dialog = await openModal(`Delete log group ${name}?`);
    return dialog;
  }

  function enterName(dialog: Modal) {
    const field = modalInput(dialog, "To confirm, type the log group's name.");
    fireEvent.change(field, { target: { value: name } });
    return field;
  }

  function confirm(dialog: Modal) {
    enterName(dialog);
    fireEvent.click(modalButton(dialog, 'Delete'));
  }

  function expectSuccess(container: HTMLElement) {
    const result = createWrapper(container).findFlashbar()?.findItemsByType('success')[0];
    expect(result?.getElement()).toHaveTextContent(`Log group ${name} deleted.`);
    expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
  }

  it('shows the result, closes the dialog and reads the shown page again', async () => {
    read
      .mockResolvedValueOnce({ ...group('first'), next: 'second' })
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(afterDelete);
    remove.mockResolvedValueOnce(undefined);
    const { container } = renderPage();
    await waitForLink(groupTable, 'first');
    fireEvent.click(nextPage());
    confirm(await openDelete());

    expect(await waitForLink(groupTable, 'remaining')).toBeVisible();
    expectRead('', 'second');
    expect(groupTable()?.findPagination()?.findPageNumberByIndex(2)?.getElement()).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith(ENGINE, name, expect.any(AbortSignal));
    expectSuccess(container);
  });

  it.each([
    ['before', 'rows'],
    ['before', 'failure'],
    ['after', 'rows'],
    ['after', 'failure'],
  ] as const)('keeps the post-delete result when the previous read answers %s it with %s', async (when, outcome) => {
    const previous = deferred<TokenPage<LogGroup>>();
    const deletion = deferred<undefined>();
    const updated = deferred<TokenPage<LogGroup>>();
    read.mockResolvedValueOnce(current).mockReturnValueOnce(previous.promise).mockReturnValueOnce(updated.promise);
    remove.mockReturnValueOnce(deletion.promise);
    const { container } = renderPage();
    const dialog = await openDelete();

    // Refresh has started independently of the open confirmation. The dialog still owns the group it opened for.
    fireEvent.click(
      requiredElement(buttonIn(createWrapper(container).findTable()?.findHeaderSlot() ?? null, 'Refresh')),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    confirm(dialog);
    await act(async () => deletion.resolve(undefined));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expectSuccess(container);

    const finishPrevious = async () => {
      await act(async () => {
        if (outcome === 'rows') previous.resolve(current);
        else previous.reject(readError);
      });
    };
    if (when === 'before') {
      await finishPrevious();
      expect(rowLink(groupTable(), name) ?? null).not.toBeInTheDocument();
      expect(buttonIn(groupTable()?.findEmptySlot() ?? null, 'Retry') ?? null).not.toBeInTheDocument();
    }
    await act(async () => updated.resolve(afterDelete));
    expect(await waitForLink(groupTable, 'remaining')).toBeVisible();
    if (when === 'after') await finishPrevious();

    expectSuccess(container);
    expect(rowLink(groupTable(), 'remaining')).toBeVisible();
    expect(rowLink(groupTable(), name) ?? null).not.toBeInTheDocument();
    expect(buttonIn(groupTable()?.findEmptySlot() ?? null, 'Retry') ?? null).not.toBeInTheDocument();
  });

  it('keeps the successful deletion result when the subsequent page read fails', async () => {
    read.mockResolvedValueOnce(current).mockRejectedValueOnce(readError).mockResolvedValueOnce(afterDelete);
    remove.mockResolvedValueOnce(undefined);
    const { container } = renderPage();
    confirm(await openDelete());

    const retry = () => buttonIn(groupTable()?.findEmptySlot() ?? null, 'Retry');
    await waitFor(() => expect(retry()).toBeVisible());
    expect(groupTable()?.findEmptySlot()?.getElement()).toHaveTextContent('List read refused.');
    expectSuccess(container);
    fireEvent.click(requiredElement(retry()));
    expect(await waitForLink(groupTable, 'remaining')).toBeVisible();
    expectSuccess(container);
  });

  it('keeps Delete in the header and remembers 501 after dismissing the dialog', async () => {
    read.mockResolvedValueOnce(current);
    remove.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DeleteLogGroup' }));
    renderPage();
    const dialog = await openDelete();
    confirm(dialog);

    await expectModalAlert(dialog, 'Not implemented by the emulator');
    expect(modalAlert(dialog)?.findContent().getElement()).toHaveTextContent('DeleteLogGroup');
    expect(modalButton(dialog, 'Delete')).toBeDisabled();
    fireEvent.click(modalButton(dialog, 'Cancel'));
    expect(aws().findModal()?.getElement() ?? null).not.toBeInTheDocument();
    const opener = requiredElement(buttonIn(groupTable()?.findHeaderSlot() ?? null, 'Delete'));
    await waitFor(() => expect(opener).toHaveFocus());
    fireEvent.click(opener);

    const reopened = await openModal();
    const field = modalInput(reopened);
    expect(field).toHaveValue('');
    await expectModalAlert(reopened, 'Not implemented by the emulator');
    enterName(reopened);
    expect(modalButton(reopened, 'Delete')).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
