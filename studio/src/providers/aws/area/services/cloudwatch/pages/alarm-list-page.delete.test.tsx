import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, untilAborted } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import type { TokenPage } from '../../../components/use-token-listing';
import type { Alarm } from '../alarm';
import { listAlarms } from '../alarms-api';
import { deleteAlarm } from '../delete-api';
import { ALARMS_PATH } from '../paths';

vi.mock('../alarms-api', async (load) => ({
  ...(await load<typeof import('../alarms-api')>()),
  listAlarms: vi.fn(),
}));
vi.mock('../delete-api', async (load) => ({
  ...(await load<typeof import('../delete-api')>()),
  deleteAlarm: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8310';
const page = createWrapper();
const EMULATOR = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const CONNECTED = { kind: 'connected', checkedAt: 0, emulator: EMULATOR } as const;
const read = vi.mocked(listAlarms);
const remove = vi.mocked(deleteAlarm);
const name = 'local-alarm';
const row = (alarmName: string): Alarm => ({ type: 'metric', data: { AlarmName: alarmName } });
const fresh = { items: [row('remaining-alarm')], next: 'fresh-token' };
const stale = { items: [row(name)], next: 'stale-token' };
const readRefused = new RequestError({
  kind: 'other',
  operation: 'DescribeAlarms',
  code: 'InternalServiceError',
  message: 'Could not read alarms.',
});

function deferredRead() {
  let resolve!: (value: TokenPage<Alarm>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TokenPage<Alarm>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  read.mockReset().mockResolvedValue(fresh).mockResolvedValueOnce(stale);
  remove.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

function open() {
  render(
    <MemoryRouter initialEntries={[ALARMS_PATH]}>
      <QueryClientProvider client={new QueryClient()}>
        <AreaLayout
          connection={{ engineOrigin: ENGINE, result: CONNECTED }}
          headerSelector="#studio-header"
          onContentTarget={vi.fn()}
          onPageTitle={vi.fn()}
          routeChanges={0}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function table() {
  const alarms = page.findTable();
  if (!alarms) throw new Error('Alarms table is missing');
  return alarms;
}

function alarmLink(alarmName: string) {
  return table()
    .findRows()
    .map((row) => row.findLink())
    .find((link) => link?.getElement().textContent === alarmName)
    ?.getElement();
}

function selectionAt(rowIndex: number) {
  return table().findRowSelectionArea(rowIndex)?.find('input')?.getElement();
}

function headerControl(label: string) {
  const control = table()
    .findHeaderSlot()
    ?.findHeader()
    ?.findActions()
    ?.findAllButtons()
    .find((button) => {
      const name = button.getElement().getAttribute('aria-label') ?? button.findTextRegion()?.getElement().textContent;
      return name === label;
    });
  if (!control) throw new Error(`Alarms header control is missing: ${label}`);
  return control.getElement();
}

function nextPage() {
  const pagination = table().findPagination();
  if (!pagination) throw new Error('Alarms pagination is missing');
  fireEvent.click(pagination.findNextPageButton().getElement());
}

function retryControl() {
  return table().findEmptySlot()?.findButton()?.getElement();
}

function findDeleteModal() {
  return waitFor(() => {
    const modal = page.findModal();
    if (!modal?.isVisible()) throw new Error('Delete confirmation is missing');
    return modal;
  });
}

async function openDelete() {
  await waitFor(() => expect(alarmLink(name)).toBeVisible());
  const selection = selectionAt(1);
  if (!selection) throw new Error('Alarm selection is missing');
  expect(selection).toHaveAccessibleName(name);
  fireEvent.click(selection);
  expect(headerControl('Delete')).toBeEnabled();
  fireEvent.click(headerControl('Delete'));
  const modal = await findDeleteModal();
  expect(modal.getElement()).toHaveAccessibleName(`Delete alarm ${name}?`);
  return modal;
}

type DeleteModal = Awaited<ReturnType<typeof findDeleteModal>>;

function modalButton(modal: DeleteModal, label: string) {
  const button = modal
    .findFooter()
    ?.findAllButtons()
    .find((item) => item.findTextRegion()?.getElement().textContent === label);
  if (!button) throw new Error(`Delete confirmation button missing: ${label}`);
  return button.getElement();
}

function confirm(modal: DeleteModal) {
  const field = modal.findContent().findInput()?.findNativeInput().getElement();
  if (!field) throw new Error('Delete confirmation field is missing');
  expect(field).toHaveAccessibleName('To confirm, type delete.');
  fireEvent.change(field, { target: { value: 'delete' } });
  fireEvent.click(modalButton(modal, 'Delete'));
}

function expectDeleted() {
  const flash = page.findFlashbar()?.findItemsByType('success')[0]?.findContent();
  expect(flash?.getElement().textContent).toBe(`Alarm ${name} deleted.`);
  expect(page.findModal()).toBeNull();
}

it('requires one selected alarm and opens the confirmation for it', async () => {
  open();
  await waitFor(() => expect(alarmLink(name)).toBeVisible());
  expect(headerControl('Delete')).toBeDisabled();
  expect((await openDelete()).getElement()).toBeVisible();
  expect(remove).not.toHaveBeenCalled();
});

it('closes after deletion, reports success, and refreshes the shown page with no selection', async () => {
  read
    .mockReset()
    .mockResolvedValueOnce({ items: [row('first-page-alarm')], next: 'second-page' })
    .mockResolvedValueOnce({ items: [row(name), row('remaining-alarm')] })
    .mockResolvedValueOnce({ items: [row('remaining-alarm')] });
  open();
  await waitFor(() => expect(alarmLink('first-page-alarm')).toBeVisible());
  nextPage();
  confirm(await openDelete());
  await waitFor(() => {
    expect(alarmLink(name)).toBeUndefined();
    expect(alarmLink('remaining-alarm')).toBeVisible();
  });
  expectDeleted();
  expect(selectionAt(1)).toHaveAccessibleName('remaining-alarm');
  expect(selectionAt(1)).not.toBeChecked();
  expect(table().findSelectedRows()).toHaveLength(0);
  expect(headerControl('Delete')).toBeDisabled();
  expect(remove).toHaveBeenCalledExactlyOnceWith(ENGINE, name, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledTimes(3);
  expect(read).toHaveBeenLastCalledWith(ENGINE, { prefix: '' }, 'second-page', expect.any(AbortSignal));
});

async function startOverlappingRefresh() {
  const earlier = deferredRead();
  const later = deferredRead();
  // The service reader uses sendRequest, which rejects a superseded request even when its response still arrives.
  read.mockImplementationOnce((_endpoint, _filters, _token, signal) => untilAborted(earlier.promise, signal));
  read.mockImplementationOnce((_endpoint, _filters, _token, signal) => untilAborted(later.promise, signal));
  open();
  const refresh = headerControl('Refresh');
  const modal = await openDelete();
  fireEvent.click(refresh);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  const earlierSignal = read.mock.calls[1]?.[3];
  expect(earlierSignal?.aborted).toBe(false);
  confirm(modal);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(earlierSignal?.aborted).toBe(true);
  return { earlier, later };
}

it.each([
  ['before', 'answers'],
  ['before', 'fails'],
  ['after', 'answers'],
  ['after', 'fails'],
] as const)('keeps the post-delete rows when the earlier read %s the later one (%s)', async (order, outcome) => {
  const { earlier, later } = await startOverlappingRefresh();
  const settleEarlier = () => {
    if (outcome === 'fails') earlier.reject(readRefused);
    else earlier.resolve(stale);
  };
  if (order === 'before') await act(async () => settleEarlier());
  await act(async () => later.resolve(fresh));
  await waitFor(() => expect(alarmLink('remaining-alarm')).toBeVisible());
  if (order === 'after') await act(async () => settleEarlier());
  expectDeleted();
  expect(alarmLink('remaining-alarm')).toBeVisible();
  expect(alarmLink(name)).toBeUndefined();
  expect(retryControl()).toBeUndefined();
});

it('keeps the success flash when the post-delete read fails', async () => {
  read.mockReset().mockResolvedValueOnce(stale).mockRejectedValueOnce(readRefused);
  open();
  confirm(await openDelete());
  await waitFor(() => {
    expect(retryControl()).toBeVisible();
    expect(retryControl()).toHaveAccessibleName('Retry');
  });
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent('Could not read alarms.');
  expectDeleted();
  expect(table().findRows()).toHaveLength(0);
});

it('goes to the next page with the post-delete token after an earlier response carries another token', async () => {
  const { earlier, later } = await startOverlappingRefresh();
  await act(async () => later.resolve(fresh));
  await waitFor(() => expect(alarmLink('remaining-alarm')).toBeVisible());
  await act(async () => earlier.resolve(stale));
  expectDeleted();
  expect(alarmLink('remaining-alarm')).toBeVisible();
  nextPage();
  await waitFor(() => {
    expect(read).toHaveBeenCalledTimes(4);
    expect(read).toHaveBeenLastCalledWith(ENGINE, { prefix: '' }, 'fresh-token', expect.any(AbortSignal));
  });
});

it('remembers a 501 and reopens the dialog with its confirmation disabled', async () => {
  remove.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DeleteAlarms' }));
  open();
  const first = await openDelete();
  confirm(first);
  await waitFor(() => {
    const header = first.findContent().findAlert()?.findHeader()?.getElement();
    expect(header).toBeVisible();
    expect(header?.textContent).toBe('Not implemented by the emulator');
  });
  fireEvent.click(modalButton(first, 'Cancel'));
  expect(page.findModal()).toBeNull();
  expect(headerControl('Delete')).toBeEnabled();
  fireEvent.click(headerControl('Delete'));
  const next = await findDeleteModal();
  const alert = next.findContent().findAlert();
  const header = alert?.findHeader()?.getElement();
  const content = alert?.findContent().getElement();
  expect(header).toBeVisible();
  expect(header?.textContent).toBe('Not implemented by the emulator');
  expect(content).toBeVisible();
  expect(content).toHaveTextContent('501 Not Implemented for DeleteAlarms');
  confirm(next);
  expect(modalButton(next, 'Delete')).toBeDisabled();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(page.findFlashbar()).toBeNull();
});
