import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

async function openDelete() {
  await screen.findByRole('link', { name });
  fireEvent.click(screen.getByRole('radio', { name }));
  expect(deleteControl()).toBeEnabled();
  fireEvent.click(deleteControl());
  return screen.findByRole('dialog', { name: `Delete alarm ${name}?` });
}

function typeConfirmation(modal: HTMLElement) {
  fireEvent.change(within(modal).getByRole('textbox', { name: 'To confirm, type delete.' }), {
    target: { value: 'delete' },
  });
}

function confirm(modal: HTMLElement) {
  typeConfirmation(modal);
  fireEvent.click(within(modal).getByRole('button', { name: 'Delete' }));
}

function expectDeleted() {
  expect(createWrapper().findFlashbar()?.getElement()).toHaveTextContent(`Alarm ${name} deleted.`);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

it('requires one selected alarm and opens the confirmation for it', async () => {
  open();
  await screen.findByRole('link', { name });
  expect(deleteControl()).toBeDisabled();
  expect(await openDelete()).toBeVisible();
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
  expect(await within(first).findByText('Not implemented by the emulator')).toBeVisible();
  fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }));
  expect(deleteControl()).toBeEnabled();
  fireEvent.click(deleteControl());
  const next = await screen.findByRole('dialog');
  expect(within(next).getByText('Not implemented by the emulator')).toBeVisible();
  expect(within(next).getByText(/501 Not Implemented for DeleteAlarms/)).toBeVisible();
  confirm(next);
  expect(within(next).getByRole('button', { name: 'Delete' })).toBeDisabled();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(createWrapper().findFlashbar()).toBeNull();
});
