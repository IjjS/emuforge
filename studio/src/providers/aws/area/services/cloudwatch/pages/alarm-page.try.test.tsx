import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import type { TokenPage } from '../../../components/use-token-listing';
import type { Alarm, AlarmType } from '../alarm';
import { readAlarmHistory, readAlarmTags, type AlarmHistoryItem } from '../alarm-page-api';
import { readAlarm } from '../alarms-api';
import { alarmPath } from '../paths';
import { setAlarmActions, setAlarmState } from '../try-api';

vi.mock('../alarms-api', async (load) => ({
  ...(await load<typeof import('../alarms-api')>()),
  readAlarm: vi.fn(),
}));
vi.mock('../alarm-page-api', async (load) => ({
  ...(await load<typeof import('../alarm-page-api')>()),
  readAlarmHistory: vi.fn(),
  readAlarmTags: vi.fn(),
}));
vi.mock('../try-api', async (load) => ({
  ...(await load<typeof import('../try-api')>()),
  setAlarmActions: vi.fn(),
  setAlarmState: vi.fn(),
}));

const engine = 'http://127.0.0.1:8310';
const connection = {
  engineOrigin: engine,
  result: { kind: 'connected', checkedAt: 0, emulator: { port: 9310, endpoint: 'https://127.0.0.1:9310' } },
} as const;
const name = 'local-alarm';
const stateResult = `State of ${name} set to In alarm.`;
const stateFlash = `${stateResult} View history`;
const actionsResult = `Actions of ${name} turned off.`;
const read = vi.mocked(readAlarm);
const history = vi.mocked(readAlarmHistory);
const changeState = vi.mocked(setAlarmState);
const changeActions = vi.mocked(setAlarmActions);
const page = createWrapper(document.body);

function alarm(actions: boolean, type: AlarmType = 'metric', alarmName = name): Alarm {
  return { type, data: { AlarmName: alarmName, ActionsEnabled: actions, StateValue: 'OK' } };
}

function historyPage(type: string, summary: string, next?: string): TokenPage<AlarmHistoryItem> {
  return { items: [{ type, summary, time: undefined }], ...(next === undefined ? {} : { next }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
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
  read.mockReset().mockResolvedValue(alarm(true));
  history.mockReset().mockResolvedValue(historyPage('State', 'Opening history'));
  vi.mocked(readAlarmTags).mockReset().mockResolvedValue([]);
  changeState.mockReset().mockResolvedValue(undefined);
  changeActions.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

function open(alarmName = name) {
  let navigate: NavigateFunction | undefined;
  function Area() {
    navigate = useNavigate();
    return (
      <AreaLayout
        connection={connection}
        headerSelector="#studio-header"
        onContentTarget={vi.fn()}
        onPageTitle={vi.fn()}
        routeChanges={0}
      />
    );
  }
  render(
    <MemoryRouter initialEntries={[alarmPath(alarmName)]}>
      <QueryClientProvider client={new QueryClient()}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return (nextName: string) => {
    if (!navigate) throw new Error('Navigation missing');
    void navigate(alarmPath(nextName));
  };
}

async function openState() {
  fireEvent.click(await screen.findByRole('button', { name: 'Set state' }));
  await screen.findByRole('dialog');
  const modal = page.findModal();
  if (!modal) throw new Error('Set state dialog missing');
  return modal;
}

async function setState() {
  const modal = await openState();
  const select = modal.findContent().findSelect();
  if (!select) throw new Error('State choice missing');
  select.openDropdown();
  select.selectOptionByValue('ALARM');
  modal.findFooter()?.findAllButtons()[1]?.click();
}

function findFlashContent() {
  return (
    page
      .findFlashbar()
      ?.findItems()
      .map((item) => item.findContent()?.getElement().textContent) ?? []
  );
}

function summaryValue(label: string) {
  return page
    .findContentLayout()
    ?.findContent()
    .findKeyValuePairs()
    ?.findItems()
    .find((pair) => pair.findLabel()?.getElement().textContent === label)
    ?.findValue();
}

function refreshAlarm() {
  const button = page.findContentLayout()?.findHeader()?.findHeader()?.findActions()?.findButton();
  if (!button) throw new Error('Alarm refresh control missing');
  button.click();
}

async function expectHistory(type: string, summary: string) {
  await waitFor(() => {
    const table = page.findTable();
    expect(table?.findBodyCell(1, 2)?.getElement().textContent).toBe(type);
    expect(table?.findBodyCell(1, 3)?.getElement().textContent).toBe(summary);
  });
}

it.each<AlarmType>(['metric', 'metric-math', 'composite'])('opens Set state for a %s alarm', async (type) => {
  read.mockResolvedValueOnce(alarm(true, type));
  open();
  expect((await openState()).getElement()).toBeVisible();
  expect(changeState).not.toHaveBeenCalled();
});

it('preserves the alarm name in a span that inherits the page heading’s typography', async () => {
  const exactName = ' checkout  alarm\n ';
  read.mockResolvedValueOnce(alarm(true, 'metric', exactName));
  open(exactName);
  await screen.findByRole('button', { name: 'Set state' });
  const heading = page.findContentLayout()?.findHeader()?.findHeader()?.findHeadingText().getElement();
  const nameWrapper = heading?.firstElementChild;
  expect(heading?.textContent).toBe(exactName);
  expect(nameWrapper).toHaveStyle({ whiteSpace: 'pre-wrap' });
  expect(nameWrapper?.className).toBe('');
});

it('keeps the success sentence whole and focuses the existing History section from its link', async () => {
  open();
  await setState();
  await waitFor(() => expect(findFlashContent()).toEqual([stateFlash]));
  const flashContent = page.findFlashbar()?.findItemsByType('success')[0]?.findContent();
  const link = flashContent?.findLink()?.getElement();
  const section = screen.getByRole('region', { name: 'History' });
  const scrollIntoView = vi.fn();
  Object.defineProperty(section, 'scrollIntoView', { value: scrollIntoView });
  expect(link).toHaveAccessibleName('View history');
  expect(link).toHaveAttribute('href', `#${section.id}`);
  expect(link?.previousElementSibling?.textContent).toBe(stateResult);
  expect(createWrapper(section).findTable()).not.toBeNull();
  if (!link) throw new Error('View history link missing');
  fireEvent.click(link);
  expect(section).toHaveFocus();
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
});

it('disables Set state on a log alarm and explains why', async () => {
  read.mockResolvedValueOnce(alarm(true, 'log'));
  open();
  const button = await screen.findByRole('button', { name: 'Set state' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).toHaveAccessibleDescription('The emulator does not set the state of a log alarm.');
  fireEvent.click(button);
  expect(page.findModal()).toBeNull();
  expect(changeState).not.toHaveBeenCalled();
});

it.each<AlarmType>(['metric', 'metric-math', 'composite', 'log'])(
  'offers each action switch for a %s alarm',
  async (type) => {
    read.mockResolvedValueOnce(alarm(true, type)).mockResolvedValueOnce(alarm(false, type));
    open();
    const off = await screen.findByRole('button', { name: 'Turn actions off' });
    expect(off).toBeEnabled();
    fireEvent.click(off);
    expect(await screen.findByRole('button', { name: 'Turn actions on' })).toBeEnabled();
    expect(changeActions).toHaveBeenCalledExactlyOnceWith(engine, name, false, expect.any(AbortSignal));
  },
);

it.each(['history first', 'alarm first', 'alarm missing'])('keeps the set-state result with %s', async (order) => {
  const freshAlarm = deferred<Alarm | undefined>();
  const freshHistory = deferred<TokenPage<AlarmHistoryItem>>();
  read.mockResolvedValueOnce(alarm(true)).mockReturnValueOnce(freshAlarm.promise);
  history.mockResolvedValueOnce(historyPage('State', 'Opening history')).mockReturnValueOnce(freshHistory.promise);
  open();
  await expectHistory('State', 'Opening history');
  await setState();
  await waitFor(() => expect(findFlashContent()).toEqual([stateFlash]));
  expect(page.findModal()).toBeNull();
  expect(changeState).toHaveBeenCalledExactlyOnceWith(
    engine,
    name,
    'ALARM',
    'Set by hand in EmuForge Studio',
    expect.any(AbortSignal),
  );
  expect(read).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
  expect(history).toHaveBeenLastCalledWith(engine, name, undefined, expect.any(AbortSignal));

  const current = alarm(true);
  current.data.StateValue = 'ALARM';
  current.data.StateReason = 'Set by hand in EmuForge Studio';
  if (order === 'history first') {
    await act(async () => freshHistory.resolve(historyPage('State', 'Just set')));
    await expectHistory('State', 'Just set');
    expect(findFlashContent()).toEqual([stateFlash]);
  }
  await act(async () => freshAlarm.resolve(order === 'alarm missing' ? undefined : current));
  if (order === 'alarm missing') {
    expect(await screen.findByText('Alarm not found', { selector: 'h2' })).toBeVisible();
  } else {
    await waitFor(() =>
      expect(summaryValue('State reason')?.getElement()).toHaveTextContent('Set by hand in EmuForge Studio'),
    );
    expect(summaryValue('State')?.findStatusIndicator()?.getElement()).toHaveTextContent('In alarm');
  }
  if (order === 'alarm first') {
    expect(findFlashContent()).toEqual([stateFlash]);
    await act(async () => freshHistory.resolve(historyPage('State', 'Just set')));
    await expectHistory('State', 'Just set');
  }
  expect(findFlashContent()).toEqual([stateFlash]);
  expect(page.findModal()).toBeNull();
});

it.each([
  ['Set state', 'State'],
  ['Turn actions off', 'Configuration'],
])('resets history to page 1 after %s and shows the %s item', async (operation, type) => {
  history
    .mockResolvedValueOnce(historyPage('State', 'First history', 'page-two'))
    .mockResolvedValueOnce(historyPage('Action', 'Older history'))
    .mockResolvedValueOnce(historyPage(type, 'New history'));
  read.mockResolvedValueOnce(alarm(true)).mockResolvedValueOnce(alarm(false));
  open();
  await expectHistory('State', 'First history');
  page.findTable()?.findPagination()?.findNextPageButton().click();
  await expectHistory('Action', 'Older history');
  expect(history).toHaveBeenLastCalledWith(engine, name, 'page-two', expect.any(AbortSignal));
  expect(page.findTable()?.findPagination()?.findCurrentPage().getElement()).toHaveAccessibleName('History page 2');
  if (operation === 'Set state') await setState();
  else fireEvent.click(screen.getByRole('button', { name: operation }));
  await expectHistory(type, 'New history');
  expect(history).toHaveBeenLastCalledWith(engine, name, undefined, expect.any(AbortSignal));
  expect(page.findTable()?.findPagination()?.findCurrentPage().getElement()).toHaveAccessibleName('History page 1');
});

it.each(['history first', 'alarm first', 'history fails'])('keeps the actions result with %s', async (order) => {
  const freshAlarm = deferred<Alarm>();
  const freshHistory = deferred<TokenPage<AlarmHistoryItem>>();
  read.mockResolvedValueOnce(alarm(true)).mockReturnValueOnce(freshAlarm.promise);
  history.mockResolvedValueOnce(historyPage('State', 'Opening history')).mockReturnValueOnce(freshHistory.promise);
  open();
  await expectHistory('State', 'Opening history');
  fireEvent.click(await screen.findByRole('button', { name: 'Turn actions off' }));
  await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
  expect(findFlashContent()).toEqual([]);
  if (order === 'history first') {
    await act(async () => freshHistory.resolve(historyPage('Configuration', 'Actions disabled')));
    await expectHistory('Configuration', 'Actions disabled');
    expect(findFlashContent()).toEqual([]);
  }
  await act(async () => freshAlarm.resolve(alarm(false)));
  await waitFor(() => expect(summaryValue('Actions')?.getElement().textContent).toBe('Off'));
  await waitFor(() => expect(findFlashContent()).toEqual([actionsResult]));
  if (order === 'alarm first') {
    await act(async () => freshHistory.resolve(historyPage('Configuration', 'Actions disabled')));
    await expectHistory('Configuration', 'Actions disabled');
  } else if (order === 'history fails') {
    await act(async () =>
      freshHistory.reject(
        new RequestError({ kind: 'access-denied', operation: 'DescribeAlarmHistory', message: 'History refused' }),
      ),
    );
    await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('History refused'));
  }
  expect(findFlashContent()).toEqual([actionsResult]);
  expect(summaryValue('Actions')?.getElement().textContent).toBe('Off');
});

it.each(['before', 'after'])('drops the older alarm read when it answers %s the switch read', async (order) => {
  const old = deferred<Alarm>();
  const fresh = deferred<Alarm>();
  const written = deferred<undefined>();
  read.mockResolvedValueOnce(alarm(true)).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  changeActions.mockReturnValueOnce(written.promise);
  open();
  const button = await screen.findByRole('button', { name: 'Turn actions off' });
  refreshAlarm();
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  const oldSignal = read.mock.calls[1]?.[2];
  fireEvent.click(button);
  await act(async () => written.resolve(undefined));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  expect(oldSignal?.aborted).toBe(true);
  if (order === 'before') {
    await act(async () => old.resolve(alarm(true)));
    expect(findFlashContent()).toEqual([]);
  }
  await act(async () => fresh.resolve(alarm(false)));
  await waitFor(() => expect(summaryValue('Actions')?.getElement().textContent).toBe('Off'));
  if (order === 'after') await act(async () => old.resolve(alarm(true)));
  expect(summaryValue('Actions')?.getElement().textContent).toBe('Off');
  expect(findFlashContent()).toEqual([actionsResult]);
});

it.each(['dialog open', 'switch pending'])('resets controls on a different name with the first %s', async (mode) => {
  const written = deferred<undefined>();
  changeActions.mockReturnValueOnce(written.promise);
  read.mockImplementation(async (_engine, alarmName) => alarm(alarmName === name, 'metric', alarmName));
  const follow = open();
  if (mode === 'dialog open') {
    expect((await openState()).getElement()).toBeVisible();
  } else {
    fireEvent.click(await screen.findByRole('button', { name: 'Turn actions off' }));
    expect(changeActions).toHaveBeenCalledOnce();
  }
  act(() => follow('second-alarm'));
  expect(await screen.findByRole('button', { name: 'Turn actions on' })).toBeEnabled();
  expect(page.findModal()).toBeNull();
  if (mode === 'switch pending') {
    expect(changeActions.mock.calls[0]?.[3].aborted).toBe(true);
    await act(async () => written.resolve(undefined));
  }
  expect(summaryValue('Actions')?.getElement().textContent).toBe('Off');
  expect(findFlashContent()).toEqual([]);
  expect(read).toHaveBeenCalledTimes(2);
});

it('shows Alarm not found without a result if confirmation finds the alarm gone', async () => {
  read.mockResolvedValueOnce(alarm(true)).mockResolvedValueOnce(undefined);
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Turn actions off' }));
  expect(await screen.findByText('Alarm not found', { selector: 'h2' })).toBeVisible();
  expect(findFlashContent()).toEqual([]);
});

it.each([
  ['Turn actions off', true, 'DisableAlarmActions'],
  ['Turn actions on', false, 'EnableAlarmActions'],
])('keeps focus on %s while pending and after refusal', async (label, enabled, operation) => {
  const user = userEvent.setup();
  const written = deferred<undefined>();
  read.mockResolvedValueOnce(alarm(enabled));
  changeActions.mockReturnValueOnce(written.promise);
  open();
  const button = await waitFor(() => {
    const actions = page.findContentLayout()?.findHeader()?.findHeader()?.findActions();
    const control = actions?.findAllButtons().find((item) => item.getElement().textContent?.trim() === label);
    if (!control) throw new Error(`Missing ${label} button`);
    return control.getElement();
  });
  button.focus();
  await user.keyboard('{Enter}');
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  await user.keyboard('{Enter}');
  expect(changeActions).toHaveBeenCalledExactlyOnceWith(engine, name, !enabled, expect.any(AbortSignal));
  await act(async () =>
    written.reject(new RequestError({ kind: 'access-denied', operation, message: 'The change was refused.' })),
  );
  expect(findFlashContent()).toEqual([`${operation} was refused: The change was refused.`]);
  expect(button).toHaveFocus();
  expect(button).not.toHaveAttribute('aria-disabled', 'true');
});

it('keeps a switch that answered 501 in the header, unavailable', async () => {
  changeActions.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'DisableAlarmActions' }));
  open();
  const button = await screen.findByRole('button', { name: 'Turn actions off' });
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
  expect(button).toHaveAccessibleDescription('Not implemented by the emulator (DisableAlarmActions).');
  expect(findFlashContent()).toEqual(['The emulator answered 501 Not Implemented for DisableAlarmActions.']);
  fireEvent.click(button);
  expect(changeActions).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
});

it('keeps the 501 visible and reopens Set state with confirmation unavailable', async () => {
  changeState.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'SetAlarmState' }));
  open();
  await setState();
  await waitFor(() =>
    expect(page.findModal()?.findContent().findAlert()?.findHeader()?.getElement()).toHaveTextContent(
      'Not implemented by the emulator',
    ),
  );
  page.findModal()?.findFooter()?.findAllButtons()[0]?.click();
  const description = page.findContentLayout()?.findHeader()?.findHeader()?.findDescription();
  expect(description?.getElement()).toBeVisible();
  expect(description?.getElement().textContent).toBe('Not implemented by the emulator (SetAlarmState).');
  const second = await openState();
  expect(second.findContent().findAlert()?.getElement()).toHaveTextContent('501 Not Implemented for SetAlarmState');
  const confirm = second.findFooter()?.findAllButtons()[1];
  expect(confirm?.isDisabled()).toBe(true);
  confirm?.click();
  expect(changeState).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
});

it('keeps the new first history page and its token when the earlier request answers late', async () => {
  const old = deferred<TokenPage<AlarmHistoryItem>>();
  const fresh = deferred<TokenPage<AlarmHistoryItem>>();
  history
    .mockImplementationOnce(async (_engine, _name, _token, signal) => {
      const result = await old.promise;
      signal.throwIfAborted();
      return result;
    })
    .mockReturnValueOnce(fresh.promise)
    .mockResolvedValueOnce(historyPage('Configuration', 'Next fresh page'));
  open();
  await waitFor(() => expect(history).toHaveBeenCalledOnce());
  const oldSignal = history.mock.calls[0]?.[3];
  await setState();
  await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => fresh.resolve(historyPage('State', 'New first page', 'fresh-token')));
  await expectHistory('State', 'New first page');
  await act(async () => old.resolve(historyPage('State', 'Stale page', 'stale-token')));
  await expectHistory('State', 'New first page');
  const pagination = page.findTable()?.findPagination();
  expect(pagination?.findCurrentPage().getElement()).toHaveAccessibleName('History page 1');
  pagination?.findNextPageButton().click();
  await expectHistory('Configuration', 'Next fresh page');
  expect(history).toHaveBeenLastCalledWith(engine, name, 'fresh-token', expect.any(AbortSignal));
  expect(findFlashContent()).toEqual([stateFlash]);
});
