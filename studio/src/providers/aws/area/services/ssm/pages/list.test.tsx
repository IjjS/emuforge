import type { DescribeParametersCommandInput } from '@aws-sdk/client-ssm';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CheckResult } from '../../../../../../lib/engine/engine-client';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import AwsArea from '../../../index';
import { PARAMETER_STORE_PATH } from '../paths';
import { useParameterMetadata } from '../queries';

const FIRST = '/app/database';
const SECOND = '/app/worker';
const emulator = { port: 9308, endpoint: 'https://127.0.0.1:9308' };
const connected = { kind: 'connected', emulator, target: 'local', checkedAt: 1 } as const;
const modified = 1795485600;

interface DeleteInput {
  Name?: string;
  Names?: string[];
}

const read = vi.fn<(input: DescribeParametersCommandInput, signal: AbortSignal) => Response | Promise<Response>>();
const remove = vi.fn<(input: DeleteInput, operation: string) => Response>();
let nextPort = 8750;
let engineOrigin: string;

function answer(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/x-amz-json-1.1' } });
}

function parameter(Name: string, Version = 1, Type = 'String', LastModifiedDate = modified) {
  return { Name, Type, Version, LastModifiedDate };
}

function page(names: string[], NextToken?: string) {
  return answer({ Parameters: names.map((name) => parameter(name)), NextToken });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  engineOrigin = `http://127.0.0.1:${String(nextPort++)}`;
  read.mockReset().mockImplementation(() => page([FIRST, SECOND]));
  remove.mockReset().mockImplementation(() => answer({}));
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === '/__emuforge/session') return answer({ token: 'test-session' });
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1);
    switch (operation) {
      case 'DescribeParameters':
        return read((await request.json()) as DescribeParametersCommandInput, request.signal);
      case 'DeleteParameter':
      case 'DeleteParameters':
        return remove((await request.json()) as DeleteInput, operation);
      default:
        throw new Error('Unexpected AWS request');
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

function MetadataObserver({ connection }: { connection: AreaConnection }) {
  const query = useParameterMetadata(connection, FIRST);
  return query.metadata === null ? <div>Observed metadata is empty</div> : null;
}

function open(observeMetadata = false) {
  const controls: { connect?: (result: CheckResult) => void } = {};
  function Frame() {
    const [result, setResult] = useState<CheckResult>(connected);
    useEffect(() => {
      controls.connect = setResult;
    }, []);
    const connection = { engineOrigin, result };
    return (
      <>
        <AwsArea
          connection={connection}
          headerSelector="#top-bar"
          routeChanges={0}
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
        />
        {observeMetadata && <MetadataObserver connection={connection} />}
      </>
    );
  }
  const router = createMemoryRouter([{ path: '/aws/*', Component: Frame }], { initialEntries: [PARAMETER_STORE_PATH] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return {
    router,
    connect: (result: CheckResult) => act(() => controls.connect?.(result)),
  };
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

const ui = createWrapper();
const table = () => ui.findTable();
const listHeader = () => table()?.findHeaderSlot()?.findHeader();
function readFeedback() {
  const header = table()?.findHeaderSlot();
  return header?.findStatusIndicator() ? header : table()?.findEmptySlot();
}
const actions = () => table()?.findHeaderSlot()?.findHeader()?.findActions()?.getElement();
function button(name: string) {
  const pagination = table()?.findPagination();
  switch (name) {
    case 'Next page':
      return required(pagination, 'pagination').findNextPageButton().getElement();
    case 'Previous page':
      return required(pagination, 'pagination').findPreviousPageButton().getElement();
    case 'Page 1':
      return required(pagination?.findPageNumberByIndex(1), 'page 1').getElement();
    case 'Retry':
      return required(
        readFeedback()
          ?.findAllButtons()
          .find((item) => item.getElement().textContent === name),
        name,
      ).getElement();
    default:
      return within(required(actions(), 'list actions')).getByRole('button', { name });
  }
}

function findRow(name: string) {
  return table()
    ?.findRows()
    .map((row) => within(row.getElement()))
    .find((row) => row.queryByRole('link', { name }) !== null);
}

async function row(name: string) {
  return waitFor(() => {
    const entry = findRow(name);
    if (entry === undefined) throw new Error(`Expected a parameter row for ${name}`);
    return entry;
  });
}

function selection(name: string) {
  return findRow(name)?.getByRole('checkbox', { name: `Select ${name}` });
}

const select = (name: string) => fireEvent.click(required(selection(name), `selection for ${name}`));

function rowCell(rowIndex: number, column: string) {
  const listing = required(table(), 'parameter table');
  const index = listing.findColumnHeaders().findIndex((header) => header.getElement().textContent?.trim() === column);
  if (index < 0) throw new Error(`Expected the ${column} column`);
  return required(listing.findBodyCell(rowIndex, index + 1), `${column} cell`).getElement();
}

function firstRowCell(column: string) {
  return rowCell(1, column);
}

function expectFirstRowCell(column: string, value: string) {
  const cell = firstRowCell(column);
  expect(cell).toBeVisible();
  expect(cell.textContent).toBe(value);
}

async function expectMetadata({ Name, Type, Version, LastModifiedDate }: ReturnType<typeof parameter>) {
  await waitFor(() => {
    const link = within(firstRowCell('Name')).getByRole('link', { name: Name });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', '/aws/ssm/parameters/detail?name=%2Fapp%2Fdatabase');
    expectFirstRowCell('Type', Type);
    expectFirstRowCell('Version', String(Version));
    expectFirstRowCell('Last modified', creationDateText(new Date(LastModifiedDate * 1000)));
  });
}

function flash(title: string) {
  return ui
    .findFlashbar()
    ?.findItems()
    .find((item) => item.findHeader()?.getElement().textContent === title);
}

function expectResultNames(title: string, names: string[]) {
  const item = flash(title);
  expect(item?.findHeader()?.getElement()).toBeVisible();
  const entries = within(required(item?.findContent(), `${title} message`).getElement()).getAllByRole('listitem');
  expect(entries.map((entry) => entry.textContent)).toEqual(names);
  for (const entry of entries) expect(entry).toBeVisible();
}

async function deleteDialog(names: string[]) {
  for (const name of names) {
    await row(name);
    select(name);
  }
  return openDeleteDialog(names.length);
}

async function openDeleteDialog(count: number) {
  const deleteAction = listHeader()
    ?.findActions()
    ?.findAllButtons()
    .find((item) => item.getElement().textContent?.trim() === 'Delete');
  fireEvent.click(required(deleteAction, 'Delete button').getElement());
  return waitFor(() => {
    const dialog = ui.findModal();
    if (dialog === null) throw new Error('Expected the delete confirmation dialog');
    expect(dialog.findHeader().getElement()).toHaveTextContent(
      count === 1 ? /^Delete parameter$/ : /^Delete parameters$/,
    );
    return dialog;
  });
}

type DeleteDialog = Awaited<ReturnType<typeof deleteDialog>>;

const dialogButton = (dialog: DeleteDialog, name: string) =>
  within(required(dialog.findFooter(), 'dialog footer').getElement()).getByRole('button', { name });

function confirm(dialog: DeleteDialog, text: string) {
  fireEvent.change(required(dialog.findContent().findInput(), 'confirmation input').findNativeInput().getElement(), {
    target: { value: text },
  });
  fireEvent.click(dialogButton(dialog, 'Delete'));
}

function expectSettledRows(parameters: ReturnType<typeof parameter>[]) {
  expect(table()?.findRows()).toHaveLength(parameters.length);
  for (const [index, { Name, Type, Version, LastModifiedDate }] of parameters.entries()) {
    const columns = {
      Name,
      Type,
      Version: String(Version),
      'Last modified': creationDateText(new Date(LastModifiedDate * 1000)),
    };
    for (const [column, value] of Object.entries(columns)) {
      const cell = rowCell(index + 1, column);
      expect(cell).toBeVisible();
      expect(cell.textContent).toBe(value);
    }
  }
}

function rowCheckbox(name: string) {
  const listing = required(table(), 'parameter table');
  const index = listing.findRows().findIndex((_, index) => rowCell(index + 1, 'Name').textContent === name);
  expect(index).toBeGreaterThanOrEqual(0);
  const input = required(
    listing.findRowSelectionArea(index + 1)?.find('input[type="checkbox"]'),
    `selection for ${name}`,
  ).getElement();
  expect(input).toHaveAccessibleName(`Select ${name}`);
  return input;
}

function expectDescribeRefusal() {
  const feedback = required(readFeedback(), 'DescribeParameters refusal');
  expect(feedback.findStatusIndicator()?.getElement()).toHaveTextContent('Not implemented by the emulator');
  expect(feedback.getElement()).toHaveTextContent(/501 Not Implemented for DescribeParameters/);
}

async function refuseNext(parameters: ReturnType<typeof parameter>[], names: string[]) {
  read
    .mockReturnValueOnce(answer({ Parameters: parameters, NextToken: 'next' }))
    .mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
  const view = open();
  await waitFor(() => expectSettledRows(parameters));
  for (const name of names) fireEvent.click(rowCheckbox(name));
  fireEvent.click(button('Next page'));
  await waitFor(expectDescribeRefusal);
  expectSettledRows(parameters);
  for (const name of names) expect(rowCheckbox(name)).toBeChecked();
  return view;
}

const refusedNextRequests = [{ MaxResults: 50 }, { MaxResults: 50, NextToken: 'next' }];

describe('Parameter Store list', () => {
  it('L1 shows loading, then the empty title and guidance', async () => {
    const response = deferred();
    read.mockReturnValue(response.promise);
    open();
    await waitFor(() => {
      const loading = table()?.findLoadingText()?.getElement();
      expect(loading).toBeVisible();
      expect(loading).toHaveTextContent('Loading parameters…');
    });
    response.resolve(page([]));
    await waitFor(() => {
      const empty = within(required(table()?.findEmptySlot(), 'empty table slot').getElement());
      expect(empty.getByText('No parameters')).toBeVisible();
      expect(empty.getByText('Create a parameter to store a configuration value.')).toBeVisible();
    });
  });

  it('L2 reads current metadata on entry, return and first-page Refresh', async () => {
    const initial = parameter(FIRST);
    const returned = parameter(FIRST, 2, 'StringList', modified + 3600);
    const refreshed = parameter(FIRST, 3, 'SecureString', modified + 7200);
    let metadata = initial;
    read.mockImplementation(({ NextToken }) =>
      NextToken === undefined ? answer({ Parameters: [metadata], NextToken: 'next' }) : page([SECOND]),
    );
    const { router } = open();
    await expectMetadata(initial);

    await act(() => router.navigate('/aws'));
    metadata = returned;
    await act(() => router.navigate(PARAMETER_STORE_PATH));
    await expectMetadata(returned);
    fireEvent.click(button('Next page'));
    await row(SECOND);
    metadata = refreshed;
    fireEvent.click(button('Refresh'));
    await expectMetadata(refreshed);
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, undefined, 'next', undefined]);
  });

  it('L3 follows tokens, clears selection, and continues through an empty page', async () => {
    read.mockImplementation(({ NextToken }) => {
      if (NextToken === 'through-empty') return page([SECOND]);
      return NextToken === 'next' ? page([], 'through-empty') : page([FIRST], 'next');
    });
    open();
    await row(FIRST);
    select(FIRST);
    expect(button('Delete')).toBeEnabled();
    fireEvent.click(button('Next page'));
    await waitFor(() => expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent('No parameters on this page'));
    expect(button('Delete')).toBeDisabled();
    expect(button('Next page')).toBeEnabled();
    fireEvent.click(button('Next page'));
    await row(SECOND);
    expect(selection(SECOND)).not.toBeChecked();
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, 'next', 'through-empty']);
  });

  it('L4 retries a read failure and gives the engine reason for access denial', async () => {
    read
      .mockReturnValueOnce(answer({ __type: 'ValidationException', message: 'The listing failed.' }, 400))
      .mockReturnValueOnce(page([FIRST]))
      .mockReturnValueOnce(
        answer({ __type: 'AccessDeniedException', message: 'Listing was denied by the engine.' }, 403),
      );
    open();
    await waitFor(() => expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent(/The listing failed/));
    fireEvent.click(button('Retry'));
    await row(FIRST);
    fireEvent.click(button('Refresh'));
    await waitFor(() =>
      expect(table()?.findEmptySlot()?.getElement()).toHaveTextContent(/Listing was denied by the engine/),
    );
  });

  it('L5 shows the DescribeParameters 501 and disables its read controls', async () => {
    read.mockReturnValueOnce(page([FIRST], 'next')).mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
    open();
    await row(FIRST);
    fireEvent.click(button('Next page'));
    await waitFor(expectDescribeRefusal);
    for (const name of ['Refresh', 'Retry']) {
      expect(button(name)).toBeDisabled();
      fireEvent.click(button(name));
    }
    for (const name of ['Previous page', 'Next page', 'Page 1']) {
      expect(button(name)).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button(name));
    }
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('deletes a selected parameter from the last confirmed page after Next returns 501', async () => {
    const selected = parameter(FIRST, 2, 'SecureString');
    const sibling = parameter(SECOND, 4, 'StringList', modified + 3600);
    const { connect } = await refuseNext([selected, sibling], [FIRST]);
    confirm(await openDeleteDialog(1), FIRST);
    await waitFor(() => {
      expectSettledRows([sibling]);
      const result = ui.findFlashbar()?.findItemsByType('success')[0];
      expect(result?.findContent()?.getElement()).toHaveTextContent(`Parameter ${FIRST} deleted.`);
    });
    expectDescribeRefusal();
    expect(remove.mock.calls).toEqual([[{ Name: FIRST }, 'DeleteParameter']]);
    expect(read.mock.calls.map(([input]) => input)).toEqual(refusedNextRequests);

    const otherPage = deferred();
    read.mockReturnValueOnce(otherPage.promise);
    connect({ ...connected, target: 'other', checkedAt: 2 });
    await waitFor(() => {
      expect(table()?.findLoadingText()?.getElement()).toBeVisible();
      expect(table()?.findRows()).toHaveLength(0);
    });
    const other = parameter(FIRST, 7, 'String', modified + 7200);
    otherPage.resolve(answer({ Parameters: [other] }));
    await waitFor(() => expectSettledRows([other]));
    expect(rowCheckbox(FIRST)).not.toBeChecked();
    expect(button('Refresh')).toBeEnabled();
    expect(read.mock.calls.map(([input]) => input)).toEqual([...refusedNextRequests, { MaxResults: 50 }]);
  });

  it('reconciles only confirmed bulk deletions on the last confirmed page after Next returns 501', async () => {
    const deleted = parameter(FIRST, 2, 'SecureString');
    const rejected = parameter(SECOND, 3, 'StringList', modified + 3600);
    const unconfirmed = parameter('/app/unconfirmed', 4, 'String', modified + 7200);
    const sibling = parameter('/app/sibling', 5, 'SecureString', modified + 10800);
    const names = [deleted.Name, rejected.Name, unconfirmed.Name];
    remove.mockReturnValueOnce(answer({ DeletedParameters: [deleted.Name], InvalidParameters: [rejected.Name] }));
    await refuseNext([deleted, rejected, unconfirmed, sibling], [deleted.Name, rejected.Name]);
    expect(rowCheckbox(unconfirmed.Name)).not.toBeChecked();
    fireEvent.click(rowCheckbox(unconfirmed.Name));
    expect(rowCheckbox(unconfirmed.Name)).toBeChecked();
    confirm(await openDeleteDialog(names.length), 'delete');
    await waitFor(() => {
      expectSettledRows([rejected, unconfirmed, sibling]);
      expectResultNames('Deleted parameters', [deleted.Name]);
      expectResultNames('Rejected parameters', [rejected.Name]);
      expectResultNames('Deletion not confirmed', [unconfirmed.Name]);
    });
    expectDescribeRefusal();
    expect(remove.mock.calls).toEqual([[{ Names: names }, 'DeleteParameters']]);
    expect(read.mock.calls.map(([input]) => input)).toEqual(refusedNextRequests);
  });

  it('L6 lists the selected names and requires exact confirmation before sending a delete', async () => {
    open();
    const dialog = await deleteDialog([FIRST, SECOND]);
    const content = within(dialog.findContent().getElement());
    expect(content.getByText(FIRST)).toBeVisible();
    expect(content.getByText(SECOND)).toBeVisible();
    expect(content.getByText(/their versions from your local emulator/)).toBeVisible();
    expect(content.getByText(/type .delete. in the field/)).toBeVisible();
    confirm(dialog, 'Delete');
    expect(dialogButton(dialog, 'Delete')).toBeDisabled();
    fireEvent.click(dialogButton(dialog, 'Cancel'));
    expect(ui.findModal()).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('L7 keeps the separate outcome while metadata and the list reconcile independently', async () => {
    const refreshedList = deferred();
    let deleted = false;
    read.mockImplementation(({ ParameterFilters }) => {
      if (ParameterFilters) return page(deleted ? [] : [FIRST]);
      return deleted ? refreshedList.promise : page([FIRST, SECOND]);
    });
    remove.mockImplementation(() => {
      deleted = true;
      return answer({ DeletedParameters: [FIRST], InvalidParameters: [SECOND] });
    });
    open(true);
    const dialog = await deleteDialog([FIRST, SECOND]);
    await waitFor(() => expect(read.mock.calls.some(([input]) => input.ParameterFilters !== undefined)).toBe(true));
    confirm(dialog, 'delete');
    expect(await screen.findByText('Observed metadata is empty')).toBeVisible();
    expectResultNames('Deleted parameters', [FIRST]);
    expectResultNames('Rejected parameters', [SECOND]);
    expect(remove).toHaveBeenCalledWith({ Names: [FIRST, SECOND] }, 'DeleteParameters');
    refreshedList.resolve(page([SECOND]));
    await waitFor(() => {
      expect(findRow(SECOND)).toBeDefined();
      expect(findRow(FIRST)).toBeUndefined();
    });
    expectResultNames('Deleted parameters', [FIRST]);
    expectResultNames('Rejected parameters', [SECOND]);
    expect(findRow(FIRST)).toBeUndefined();
  });

  it('L8 preserves completed batches and disables only bulk delete after a 501', async () => {
    const firstBatch = Array.from({ length: 10 }, (_, index) => `/batch/item-${String(index)}`);
    const firstRemaining = '/batch/item-10';
    const secondRemaining = '/batch/item-11';
    const remaining = [firstRemaining, secondRemaining];
    const names = [...firstBatch, ...remaining];
    read.mockReturnValueOnce(page(names)).mockImplementation(() => page(remaining));
    remove
      .mockReturnValueOnce(answer({ DeletedParameters: firstBatch }))
      .mockReturnValueOnce(answer({ __type: 'NotImplemented' }, 501));
    const { router } = open();
    const dialog = await deleteDialog(names);
    confirm(dialog, 'delete');
    await waitFor(() => {
      expect(table()?.findRows()).toHaveLength(remaining.length);
      for (const name of remaining) expect(findRow(name)).toBeDefined();
    });
    expectResultNames('Deleted parameters', firstBatch);
    expectResultNames('Deletion not confirmed', remaining);
    const unavailable = flash('Not implemented by the emulator');
    const message = 'The emulator answered 501 Not Implemented for DeleteParameters.';
    expect(unavailable?.findContent()?.getElement()).toHaveTextContent(message);
    expect(remove.mock.calls).toEqual([
      [{ Names: firstBatch }, 'DeleteParameters'],
      [{ Names: remaining }, 'DeleteParameters'],
    ]);
    select(firstRemaining);
    expect(button('Delete')).toBeEnabled();
    expect(actions()).not.toHaveTextContent(message);
    select(secondRemaining);
    expect(button('Delete')).toBeDisabled();
    expect(button('Delete')).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(actions()).toHaveTextContent(message);

    fireEvent.click(required(unavailable?.findDismissButton(), 'dismiss button').getElement());
    await waitFor(() => expect(flash('Not implemented by the emulator')).toBeUndefined());
    expect(actions()).toHaveTextContent(message);
    await act(() => router.navigate('/aws'));
    await act(() => router.navigate(PARAMETER_STORE_PATH));
    for (const name of remaining) {
      await row(name);
      select(name);
    }
    expect(button('Delete')).toBeDisabled();
    expect(actions()).toHaveTextContent(message);
  });

  it('L9 discards the in-flight page and selection on disconnect and reconnects from page one', async () => {
    const oldPage = deferred();
    read
      .mockReturnValueOnce(page([FIRST], 'next'))
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(page(['/app/reconnected']));
    const { connect } = open();
    await row(FIRST);
    select(FIRST);
    fireEvent.click(button('Next page'));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    connect({ ...connected, kind: 'emulator-unreachable', reason: 'not_started', message: '', checkedAt: 2 });
    expect(button('Delete')).toBeDisabled();
    connect({ ...connected, checkedAt: 3 });
    await row('/app/reconnected');
    await act(async () => oldPage.resolve(page(['/app/late'])));
    expect(findRow('/app/late')).toBeUndefined();
    expect(selection('/app/reconnected')).not.toBeChecked();
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([undefined, 'next', undefined]);
  });

  it('L10 invalidates every page on deletion and follows only the fresh first-page token', async () => {
    read
      .mockReturnValueOnce(page([FIRST], 'old-next'))
      .mockReturnValueOnce(answer({ Parameters: [parameter(SECOND, 2)] }))
      .mockReturnValueOnce(page([FIRST], 'old-next'))
      .mockReturnValueOnce(page(['/app/remaining'], 'new-next'))
      .mockReturnValueOnce(answer({ Parameters: [parameter(SECOND, 3)] }));
    open();
    await row(FIRST);
    fireEvent.click(button('Next page'));
    await row(SECOND);
    await waitFor(() => expectFirstRowCell('Version', '2'));
    fireEvent.click(button('Previous page'));
    confirm(await deleteDialog([FIRST]), FIRST);
    await row('/app/remaining');
    expect(remove).toHaveBeenCalledWith({ Name: FIRST }, 'DeleteParameter');
    fireEvent.click(button('Next page'));
    await row(SECOND);
    await waitFor(() => expectFirstRowCell('Version', '3'));
    expect(read.mock.calls.map(([input]) => input.NextToken)).toEqual([
      undefined,
      'old-next',
      undefined,
      undefined,
      'new-next',
    ]);
  });
});
