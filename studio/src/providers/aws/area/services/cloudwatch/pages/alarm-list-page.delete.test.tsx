import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const deleteControl = () => screen.getByRole('button', { name: 'Delete' });

function findDeleteModal() {
  return waitFor(() => {
    const modal = page.findModal();
    if (!modal?.isVisible()) throw new Error('Delete confirmation is missing');
    return modal;
  });
}

async function openDelete() {
  await screen.findByRole('link', { name });
  fireEvent.click(screen.getByRole('radio', { name }));
  expect(deleteControl()).toBeEnabled();
  fireEvent.click(deleteControl());
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
  const field = modal.findContent().findFormField()?.findInput()?.findNativeInput().getElement();
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
  await screen.findByRole('link', { name });
  expect(deleteControl()).toBeDisabled();
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
  await screen.findByRole('link', { name: 'first-page-alarm' });
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
  confirm(await openDelete());
  await waitFor(() => expect(screen.queryByRole('link', { name })).not.toBeInTheDocument());
  await screen.findByRole('link', { name: 'remaining-alarm' });
  expectDeleted();
  expect(screen.getByRole('radio', { name: 'remaining-alarm' })).not.toBeChecked();
  expect(deleteControl()).toBeDisabled();
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
  const refresh = screen.getByRole('button', { name: 'Refresh' });
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
  await screen.findByRole('link', { name: 'remaining-alarm' });
  if (order === 'after') await act(async () => settleEarlier());
  expectDeleted();
  expect(screen.getByRole('link', { name: 'remaining-alarm' })).toBeVisible();
  expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

it('keeps the success flash when the post-delete read fails', async () => {
  read.mockReset().mockResolvedValueOnce(stale).mockRejectedValueOnce(readRefused);
  open();
  confirm(await openDelete());
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.getByText(/Could not read alarms/)).toBeVisible();
  expectDeleted();
  expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
});

it('goes to the next page with the post-delete token after an earlier response carries another token', async () => {
  const { earlier, later } = await startOverlappingRefresh();
  await act(async () => later.resolve(fresh));
  await screen.findByRole('link', { name: 'remaining-alarm' });
  await act(async () => earlier.resolve(stale));
  expectDeleted();
  expect(screen.getByRole('link', { name: 'remaining-alarm' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
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
  expect(deleteControl()).toBeEnabled();
  fireEvent.click(deleteControl());
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
