import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const page = createWrapper();
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

function headerControl(label: string) {
  const control = page
    .findContentLayout()
    ?.findHeader()
    ?.findHeader()
    ?.findActions()
    ?.findAllButtons()
    .find((button) => {
      const name = button.getElement().getAttribute('aria-label') ?? button.findTextRegion()?.getElement().textContent;
      return name === label;
    });
  if (!control) throw new Error(`Alarm header control is missing: ${label}`);
  return control.getElement();
}

function expectAlarmNotFound() {
  const heading = page.findContentLayout()?.findContent().findContainer()?.findContent().findBox()?.getElement();
  expect(heading).toBeVisible();
  expect(heading?.tagName).toBe('H2');
  expect(heading?.textContent).toBe('Alarm not found');
}

async function openDelete() {
  const trigger = await waitFor(() => headerControl('Delete'));
  trigger.focus();
  fireEvent.click(trigger);
  return waitFor(() => {
    const modal = page.findModal();
    if (!modal?.isVisible()) throw new Error('Delete confirmation is missing');
    return modal;
  });
}

type DeleteModal = Awaited<ReturnType<typeof openDelete>>;

function modalButton(modal: DeleteModal, label: string) {
  const button = modal
    .findFooter()
    ?.findAllButtons()
    .find((item) => item.findTextRegion()?.getElement().textContent === label);
  if (!button) throw new Error(`Delete confirmation button missing: ${label}`);
  return button.getElement();
}

function confirmationField(modal: DeleteModal) {
  return modal.findContent().findInput()?.findNativeInput().getElement();
}

function confirm(modal: DeleteModal) {
  const field = confirmationField(modal);
  if (!field) throw new Error('Delete confirmation field is missing');
  expect(field).toHaveAccessibleName('To confirm, type delete.');
  fireEvent.change(field, { target: { value: 'delete' } });
  fireEvent.click(modalButton(modal, 'Delete'));
}

function expectDeletedFlash(alarmName: string) {
  const flash = page.findFlashbar()?.findItemsByType('success')[0]?.findContent();
  expect(flash?.getElement().textContent).toBe(`Alarm ${alarmName} deleted.`);
  return flash;
}

it('deletes the alarm named in the header and leads to Alarms with the result', async () => {
  open(name, true);
  const modal = await openDelete();
  expect(modal.getElement()).toHaveAccessibleName(`Delete alarm ${name}?`);
  confirm(modal);
  await waitFor(() => expect(screen.getByLabelText('Address').textContent).toBe(ALARMS_PATH));
  expectDeletedFlash(name);
  expect(page.findModal()).toBeNull();
  expect(remove).toHaveBeenCalledExactlyOnceWith(ENGINE, name, expect.any(AbortSignal));
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(['before', 'after'])('hands over once when a read finds no alarm %s the deletion answers', async (order) => {
  const reread = deferred<Alarm | undefined>();
  const deletion = deferred<undefined>();
  read.mockResolvedValueOnce(row(name)).mockReturnValueOnce(reread.promise);
  remove.mockReturnValueOnce(deletion.promise);
  const { handOver, show } = open();
  const refresh = headerControl('Refresh');
  const modal = await openDelete();
  fireEvent.click(refresh);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  confirm(modal);
  if (order === 'before') {
    await act(async () => reread.resolve(undefined));
    await waitFor(expectAlarmNotFound);
    expect(modal.getElement()).toBeVisible();
    expect(handOver).not.toHaveBeenCalled();
  }
  await act(async () => deletion.resolve(undefined));
  if (order === 'after') {
    await act(async () => reread.resolve(undefined));
    await waitFor(expectAlarmNotFound);
  }
  expect(handOver).toHaveBeenCalledExactlyOnceWith(ALARMS_PATH, [{ type: 'success', content: expect.anything() }]);
  expect(show).not.toHaveBeenCalled();
  expect(page.findModal()).toBeNull();
});

it('stays on the alarm and reports nothing to the flash on refusal', async () => {
  const deletion = deferred<undefined>();
  remove.mockReturnValueOnce(deletion.promise);
  const { handOver, show } = open();
  const modal = await openDelete();
  const submit = modalButton(modal, 'Delete');
  confirm(modal);
  expect(submit).toHaveFocus();
  expect(modal.findDismissButton()).toBeNull();
  await act(async () =>
    deletion.reject(
      new RequestError({
        kind: 'other',
        operation: 'DeleteAlarms',
        code: 'ValidationError',
        message: 'A composite alarm depends on it.',
      }),
    ),
  );
  await waitFor(() => {
    const alert = modal.findContent().findAlert();
    const header = alert?.findHeader()?.getElement();
    const content = alert?.findContent().getElement();
    expect(header).toBeVisible();
    expect(header?.textContent).toBe('DeleteAlarms failed');
    expect(content).toBeVisible();
    expect(content).toHaveTextContent('A composite alarm depends on it.');
    expect(alert?.getElement().contains(document.activeElement)).toBe(true);
  });
  expect(modal.findDismissButton().getElement()).toHaveAccessibleName('Close dialog');
  const focusedAlert = modal.findContent().findAlert()?.find('[role="group"]')?.getElement();
  if (!focusedAlert) throw new Error('Delete refusal focus target is missing');
  fireEvent.keyDown(focusedAlert, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(page.findModal()).toBeNull();
  expect(headerControl('Delete')).toHaveFocus();
  expect(screen.getByLabelText('Address').textContent).toBe(alarmPath(name));
  expect(handOver).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});

it('remembers a 501 and reopens the dialog with its confirmation disabled', async () => {
  remove.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DeleteAlarms' }));
  const { handOver, show } = open();
  const first = await openDelete();
  confirm(first);
  await waitFor(() => {
    const header = first.findContent().findAlert()?.findHeader()?.getElement();
    expect(header).toBeVisible();
    expect(header?.textContent).toBe('Not implemented by the emulator');
  });
  fireEvent.click(modalButton(first, 'Cancel'));
  expect(page.findModal()).toBeNull();
  const next = await openDelete();
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
    await waitFor(() => {
      const loading = page.findTable()?.findLoadingText()?.getElement();
      expect(loading).toBeVisible();
      expect(loading).toHaveTextContent('Loading alarms');
    });

    function expectResult() {
      const element = expectDeletedFlash(exactName)?.find('.aws-area-value-name')?.getElement();
      expect(element?.textContent).toBe(exactName);
      expect(element?.parentElement).toHaveStyle({ whiteSpace: 'pre-wrap' });
    }

    expectResult();
    if (outcome === 'answers') {
      await act(async () => dest.resolve({ items: [row('other alarm')] }));
      await waitFor(() => {
        const link = page.findTable()?.findRows()[0]?.findLink()?.getElement();
        expect(link).toBeVisible();
        expect(link).toHaveAccessibleName('other alarm');
      });
    } else {
      await act(async () =>
        dest.reject(new RequestError({ kind: 'access-denied', operation: 'DescribeAlarms', message: 'Read refused' })),
      );
      await waitFor(() => {
        const retry = page.findTable()?.findEmptySlot()?.findButton()?.getElement();
        expect(retry).toBeVisible();
        expect(retry).toHaveAccessibleName('Retry');
      });
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
  expect(page.findModal()).toBeNull();
  const next = await openDelete();
  expect(next.getElement()).toHaveAccessibleName('Delete alarm second-alarm?');
  expect(confirmationField(next)).toHaveValue('');
  if (pending) {
    expect(remove.mock.calls[0]?.[2].aborted).toBe(true);
    await act(async () => deletion.resolve(undefined));
  }
  expect(handOver).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
  expect(next.getElement()).toBeVisible();
});
