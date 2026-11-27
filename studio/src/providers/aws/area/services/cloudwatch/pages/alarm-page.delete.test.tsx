import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext } from '../../../components/page-flash';
import type { TokenPage } from '../../../components/use-token-listing';
import type { Alarm } from '../alarm';
import { readAlarmHistory, readAlarmTags } from '../alarm-page-api';
import { listAlarms, readAlarm } from '../alarms-api';
import { deleteAlarm } from '../delete-api';
import { ALARMS_PATH, alarmPath } from '../paths';
import { AlarmPage } from './alarm-page';

vi.mock('../alarms-api', async (load) => ({
  ...(await load<typeof import('../alarms-api')>()),
  readAlarm: vi.fn(),
  listAlarms: vi.fn(),
}));
vi.mock('../alarm-page-api', async (load) => ({
  ...(await load<typeof import('../alarm-page-api')>()),
  readAlarmHistory: vi.fn(),
  readAlarmTags: vi.fn(),
}));
vi.mock('../delete-api', async (load) => ({
  ...(await load<typeof import('../delete-api')>()),
  deleteAlarm: vi.fn(),
}));

const ENGINE = 'http://127.0.0.1:8310';
const connection = {
  engineOrigin: ENGINE,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9310, endpoint: 'https://127.0.0.1:9310' } },
} as const;
const name = 'local-alarm';
const remove = vi.mocked(deleteAlarm);
const read = vi.mocked(readAlarm);
const list = vi.mocked(listAlarms);
const row = (alarmName: string): Alarm => ({ type: 'metric', data: { AlarmName: alarmName } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
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
  remove.mockReset().mockResolvedValue(undefined);
  read.mockReset().mockImplementation(async (_endpoint, alarmName) => row(alarmName));
  list.mockReset().mockResolvedValue({ items: [] });
  vi.mocked(readAlarmHistory).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(readAlarmTags).mockReset().mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

function open(alarmName = name, inLayout = false) {
  const handOver = vi.fn();
  const show = vi.fn();
  let navigate: NavigateFunction | undefined;
  function Area() {
    navigate = useNavigate();
    const { pathname, search } = useLocation();
    const root = useRef<HTMLDivElement>(null);
    return (
      <>
        <output aria-label="Address">{pathname + search}</output>
        {inLayout ? (
          <AreaLayout
            connection={connection}
            headerSelector="#studio-header"
            onContentTarget={vi.fn()}
            onPageTitle={vi.fn()}
            routeChanges={pathname === ALARMS_PATH ? 1 : 0}
          />
        ) : (
          <AreaRootContext.Provider value={root}>
            <div ref={root}>
              <PageFlashContext.Provider value={{ show, handOver }}>
                <AlarmPage connection={connection} params={{}} />
              </PageFlashContext.Provider>
            </div>
          </AreaRootContext.Provider>
        )}
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={[alarmPath(alarmName)]}>
      <QueryClientProvider client={new QueryClient()}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return {
    handOver,
    show,
    follow: (to: string) => {
      if (!navigate) throw new Error('Navigation missing');
      void navigate(to);
    },
  };
}

async function openDelete() {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  return screen.findByRole('dialog');
}

function confirm(modal: HTMLElement) {
  const dialog = within(modal);
  fireEvent.change(dialog.getByRole('textbox', { name: 'To confirm, type delete.' }), { target: { value: 'delete' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Delete' }));
}

it('deletes the alarm named in the header and leads to Alarms with the result', async () => {
  open(name, true);
  const modal = await openDelete();
  expect(modal).toHaveAccessibleName(`Delete alarm ${name}?`);
  confirm(modal);
  await waitFor(() => expect(screen.getByLabelText('Address').textContent).toBe(ALARMS_PATH));
  expect(createWrapper().findFlashbar()?.getElement()).toHaveTextContent(`Alarm ${name} deleted.`);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledExactlyOnceWith(ENGINE, name, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(['before', 'after'])('hands over once when a read finds no alarm %s the deletion answers', async (order) => {
  const reread = deferred<Alarm | undefined>();
  const deletion = deferred<undefined>();
  read.mockResolvedValueOnce(row(name)).mockReturnValueOnce(reread.promise);
  remove.mockReturnValueOnce(deletion.promise);
  const { handOver, show } = open();
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  const modal = await openDelete();
  fireEvent.click(refresh);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  confirm(modal);
  if (order === 'before') {
    await act(async () => reread.resolve(undefined));
    await waitFor(() => expect(screen.getByText('Alarm not found', { selector: 'h2' })).toBeVisible());
    expect(modal).toBeVisible();
    expect(handOver).not.toHaveBeenCalled();
  }
  await act(async () => deletion.resolve(undefined));
  if (order === 'after') {
    await act(async () => reread.resolve(undefined));
    expect(await screen.findByText('Alarm not found', { selector: 'h2' })).toBeVisible();
  }
  expect(handOver).toHaveBeenCalledExactlyOnceWith(ALARMS_PATH, [{ type: 'success', content: expect.anything() }]);
  expect(show).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('stays on the alarm and reports nothing to the flash on refusal', async () => {
  remove.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: 'DeleteAlarms',
      code: 'ValidationError',
      message: 'A composite alarm depends on it.',
    }),
  );
  const { handOver, show } = open();
  const modal = await openDelete();
  confirm(modal);
  expect(await within(modal).findByText('DeleteAlarms failed')).toBeVisible();
  expect(within(modal).getByText(/A composite alarm depends on it/)).toBeVisible();
  expect(screen.getByLabelText('Address').textContent).toBe(alarmPath(name));
  expect(handOver).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});

it('remembers a 501 and reopens the dialog with its confirmation disabled', async () => {
  remove.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DeleteAlarms' }));
  const { handOver, show } = open();
  const first = await openDelete();
  confirm(first);
  expect(await within(first).findByText('Not implemented by the emulator')).toBeVisible();
  fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }));
  const next = await openDelete();
  expect(within(next).getByText('Not implemented by the emulator')).toBeVisible();
  expect(within(next).getByText(/501 Not Implemented for DeleteAlarms/)).toBeVisible();
  confirm(next);
  expect(within(next).getByRole('button', { name: 'Delete' })).toBeDisabled();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(handOver).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});

it.each(['answers', 'fails'])(
  'keeps the hand-over in the area flash while the destination read loads and %s',
  async (outcome) => {
    const exactName = 'alarm with  spaces\nand a new line';
    const dest = deferred<TokenPage<Alarm>>();
    list.mockReturnValueOnce(dest.promise);
    open(exactName, true);
    confirm(await openDelete());
    expect(await screen.findByText('Loading alarms')).toBeVisible();

    function expectResult() {
      const flash = createWrapper().findFlashbar()?.getElement();
      const element = flash?.querySelector('.aws-area-value-name');
      expect(flash?.textContent).toContain(`Alarm ${exactName} deleted.`);
      expect(element?.textContent).toBe(exactName);
      expect(element?.parentElement).toHaveStyle({ whiteSpace: 'pre-wrap' });
    }

    expectResult();
    if (outcome === 'answers') {
      await act(async () => dest.resolve({ items: [row('other alarm')] }));
      expect(await screen.findByRole('link', { name: 'other alarm' })).toBeVisible();
    } else {
      await act(async () =>
        dest.reject(new RequestError({ kind: 'access-denied', operation: 'DescribeAlarms', message: 'Read refused' })),
      );
      expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
    }
    expectResult();
  },
);

it.each([false, true])('drops the first dialog when the name changes (request pending: %s)', async (pending) => {
  const deletion = deferred<undefined>();
  remove.mockReturnValueOnce(deletion.promise);
  const { follow, handOver, show } = open();
  const modal = await openDelete();
  if (pending) confirm(modal);
  act(() => follow(alarmPath('second-alarm')));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const next = await openDelete();
  expect(next).toHaveAccessibleName('Delete alarm second-alarm?');
  expect(within(next).getByRole('textbox')).toHaveValue('');
  if (pending) {
    expect(remove.mock.calls[0]?.[2].aborted).toBe(true);
    await act(async () => deletion.resolve(undefined));
  }
  expect(handOver).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
  expect(next).toBeVisible();
});
