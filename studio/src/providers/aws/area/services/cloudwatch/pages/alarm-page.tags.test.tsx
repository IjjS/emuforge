import type { Tag } from '@aws-sdk/client-cloudwatch';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import type { AlarmType } from '../alarm';
import { readAlarmHistory, readAlarmTags } from '../alarm-page-api';
import { readAlarm } from '../alarms-api';
import { alarmPath } from '../paths';
import { SaveAlarmTagsError, TAG_RESOURCE, UNTAG_RESOURCE, saveAlarmTags, type TagOperation } from '../tags-api';

vi.mock('../alarms-api', async (load) => ({
  ...(await load<typeof import('../alarms-api')>()),
  readAlarm: vi.fn(),
}));
vi.mock('../alarm-page-api', async (load) => ({
  ...(await load<typeof import('../alarm-page-api')>()),
  readAlarmHistory: vi.fn(),
  readAlarmTags: vi.fn(),
}));
vi.mock('../tags-api', async (load) => ({
  ...(await load<typeof import('../tags-api')>()),
  saveAlarmTags: vi.fn(),
}));

const engine = 'http://127.0.0.1:8310';
const name = ' local  alarm ';
const arn = (name: string) => `arn:aws:cloudwatch:us-east-1:123456789012:alarm:${name}`;
const initial = [{ Key: 'a', Value: '1' }];
const revised = [{ Key: 'a', Value: '2' }];
const flash = `Tags of ${name} saved.`;
const tags = vi.mocked(readAlarmTags);
const save = vi.mocked(saveAlarmTags);
const page = createWrapper(document.body);

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`${label} missing`);
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function refuse(operation: TagOperation, status: 400 | 501) {
  return new SaveAlarmTagsError(
    operation,
    false,
    new RequestError(
      status === 501
        ? { kind: 'not-implemented', operation }
        : { kind: 'other', operation, code: 'ValidationError', message: 'Tag change refused.' },
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(readAlarmHistory).mockReset().mockResolvedValue({ items: [] });
  tags.mockReset().mockResolvedValue(initial);
  save.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

function open(type: AlarmType = 'metric') {
  vi.mocked(readAlarm)
    .mockReset()
    .mockImplementation(async (_endpoint, alarmName) => ({
      type,
      data: { AlarmName: alarmName, AlarmArn: arn(alarmName) },
    }));
  let navigate: NavigateFunction;
  function Area() {
    navigate = useNavigate();
    return (
      <AreaLayout
        connection={{ engineOrigin: engine, result: undefined }}
        headerSelector="#studio-header"
        onContentTarget={vi.fn()}
        onPageTitle={vi.fn()}
        routeChanges={0}
      />
    );
  }
  render(
    <MemoryRouter initialEntries={[alarmPath(name)]}>
      <QueryClientProvider client={new QueryClient()}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return (nextName: string) => {
    void navigate(alarmPath(nextName));
  };
}

function table() {
  return page
    .findAllTables()
    .find(
      (candidate) => candidate.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Tags',
    );
}

function manageButton() {
  return table()?.findHeaderSlot()?.findHeader()?.findActions()?.findButton()?.getElement();
}

async function manage() {
  const control = await waitFor(() => {
    const button = manageButton();
    expect(button).toBeEnabled();
    return required(button, 'Manage tags button');
  });
  control.focus();
  await userEvent.keyboard('{Enter}');
  await screen.findByRole('dialog');
  const modal = required(page.findModal(), 'Tag dialog');
  const footer = required(modal.findFooter(), 'Dialog footer').findAllButtons();
  const row = required(modal.findContent().findAttributeEditor()?.findRow(1), 'First tag row');
  const field = (column: number, label: string) =>
    required(row.findField(column)?.findControl()?.findInput(), label).findNativeInput().getElement();
  return {
    modal,
    trigger: control,
    key: field(1, 'Tag key'),
    value: field(2, 'Tag value'),
    remove: required(row.findRemoveButton(), 'Remove tag button'),
    cancel: required(footer[0], 'Cancel button'),
    save: required(footer[1], 'Save button').getElement(),
  };
}

function flashText() {
  return page.findFlashbar()?.findItems()[0]?.findContent()?.getElement().textContent;
}

it.each<AlarmType>(['metric', 'composite', 'log'])(
  'enables Manage tags once the %s alarm’s tags are read',
  async (type) => {
    const reading = deferred<Tag[]>();
    tags.mockReturnValueOnce(reading.promise);
    open(type);
    await waitFor(() => expect(manageButton()).toBeDisabled());
    await act(async () => reading.resolve(initial));
    const dialog = await manage();
    expect(dialog.key).toHaveValue('a');
    expect(dialog.value).toHaveValue('1');
    expect(tags).toHaveBeenCalledWith(engine, arn(name), expect.any(AbortSignal));
  },
);

it.each<TagOperation>([UNTAG_RESOURCE, TAG_RESOURCE])(
  'remembers a 501 for %s when reopening the editor',
  async (operation) => {
    save.mockRejectedValueOnce(refuse(operation, 501));
    open();
    const dialog = await manage();
    if (operation === UNTAG_RESOURCE) fireEvent.click(dialog.remove.getElement());
    else fireEvent.change(dialog.value, { target: { value: '2' } });
    fireEvent.click(dialog.save);
    await waitFor(() => expect(dialog.cancel.getElement()).toBeEnabled());
    await waitFor(() => expect(dialog.modal.findContent().findAlert()?.getElement()).toHaveTextContent(operation));
    fireEvent.click(dialog.cancel.getElement());
    const reopened = await manage();
    const alert = reopened.modal.findContent().findAlert()?.getElement();
    expect(alert).toHaveTextContent('Not implemented by the emulator');
    expect(alert).toHaveTextContent(operation);
    expect(reopened.save).toBeDisabled();
    fireEvent.click(reopened.save);
    expect(save).toHaveBeenCalledOnce();
    expect(flashText()).toBeUndefined();
  },
);

it('closes the dialog, shows the saved flash, and uses the tags read afterward', async () => {
  tags.mockResolvedValueOnce(initial).mockResolvedValue(revised);
  open();
  const dialog = await manage();
  fireEvent.change(dialog.value, { target: { value: '2' } });
  fireEvent.click(dialog.save);
  await waitFor(() => expect(flashText()).toBe(flash));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(save).toHaveBeenCalledWith(
    engine,
    arn(name),
    { remove: [], put: [{ key: 'a', value: '2' }] },
    expect.any(AbortSignal),
  );
  await waitFor(() => expect(table()?.findBodyCell(1, 2)?.getElement().textContent).toBe('2'));
  expect(tags).toHaveBeenCalledTimes(2);
});

it('keeps the save’s flash and tags when a previous refresh answers later', async () => {
  const older = deferred<Tag[]>();
  tags.mockResolvedValueOnce(initial).mockReturnValueOnce(older.promise).mockResolvedValue(revised);
  open();
  await waitFor(() => expect(manageButton()).toBeEnabled());
  const refresh = required(
    page.findContentLayout()?.findHeader()?.findHeader()?.findActions()?.findButton(),
    'Page refresh button',
  );
  expect(refresh.getElement()).toHaveAccessibleName('Refresh');
  fireEvent.click(refresh.getElement());
  await waitFor(() => expect(tags).toHaveBeenCalledTimes(2));

  const dialog = await manage();
  fireEvent.change(dialog.value, { target: { value: '2' } });
  fireEvent.click(dialog.save);
  await waitFor(() => expect(table()?.findBodyCell(1, 2)?.getElement().textContent).toBe('2'));
  expect(tags).toHaveBeenCalledTimes(3);
  await act(async () => older.resolve(initial));
  expect(table()?.findBodyCell(1, 2)?.getElement().textContent).toBe('2');
  expect(flashText()).toBe(flash);
});

it('resets the editor when the alarm name in the address changes', async () => {
  const other = 'Other alarm';
  tags.mockImplementation(async (_endpoint, resource) =>
    resource === arn(other) ? [{ Key: 'second', Value: 'other' }] : initial,
  );
  const navigate = open();
  const dialog = await manage();
  fireEvent.change(dialog.value, { target: { value: 'unsaved change' } });
  await act(async () => navigate(other));
  expect(screen.queryByRole('dialog')).toBeNull();
  const next = await manage();
  expect(next.key).toHaveValue('second');
  expect(next.value).toHaveValue('other');
  expect(save).not.toHaveBeenCalled();
});

it('keeps the dialog mounted when rereading tags after a refused save fails', async () => {
  const readAgain = deferred<Tag[]>();
  tags
    .mockResolvedValueOnce(initial)
    .mockReturnValueOnce(readAgain.promise)
    .mockRejectedValue(new Error('Read failed'));
  save.mockRejectedValueOnce(refuse(TAG_RESOURCE, 400));
  open();
  const dialog = await manage();
  fireEvent.change(dialog.value, { target: { value: '2' } });
  fireEvent.click(dialog.save);
  await waitFor(() =>
    expect(dialog.modal.findContent().findStatusIndicator()?.getElement()).toHaveTextContent('Loading tags'),
  );
  expect(dialog.value).toHaveValue('2');
  await act(async () => readAgain.reject(new Error('Read failed')));
  await waitFor(() => expect(table()?.getElement()).toHaveTextContent('Read failed'));
  expect(dialog.modal.getElement()).toBeInTheDocument();
  expect(dialog.value).toHaveValue('2');
  expect(dialog.modal.findContent().findAlert()?.getElement()).toHaveTextContent('Tag change refused.');
  expect(dialog.save).toBeDisabled();
});

it('retries the dialog’s tag read with its ARN after an in-flight alarm refresh fails', async () => {
  const alarmRefresh = deferred<Awaited<ReturnType<typeof readAlarm>>>();
  open();
  await waitFor(() => expect(manageButton()).toBeEnabled());
  vi.mocked(readAlarm).mockReturnValueOnce(alarmRefresh.promise);
  tags
    .mockResolvedValueOnce(initial)
    .mockRejectedValueOnce(new Error('Tag read failed'))
    .mockResolvedValueOnce(initial);
  save.mockRejectedValueOnce(refuse(TAG_RESOURCE, 400));
  const layout = required(page.findContentLayout(), 'Alarm detail layout');
  const refresh = required(layout.findHeader()?.findHeader()?.findActions()?.findButton(), 'Page refresh button');
  expect(refresh.getElement()).toHaveAccessibleName('Refresh');
  fireEvent.click(refresh.getElement());
  await waitFor(() => expect(tags).toHaveBeenCalledTimes(2));

  const dialog = await manage();
  fireEvent.change(dialog.value, { target: { value: 'draft value' } });
  await act(async () =>
    alarmRefresh.reject(new RequestError({ kind: 'other', operation: 'DescribeAlarms', code: 'AlarmReadFailed' })),
  );
  await waitFor(() =>
    expect(layout.findContent().findStatusIndicator()?.getElement()).toHaveTextContent('The alarm could not be read'),
  );
  expect(dialog.value).toHaveValue('draft value');
  fireEvent.click(dialog.save);

  const retry = await waitFor(() => {
    const alert = required(dialog.modal.findContent().findAllAlerts()[1], 'Tag read failure');
    expect(alert.findContent().getElement()).toHaveTextContent('The tags could not be read again.');
    return required(alert.findActionSlot()?.findButton(), 'Retry button');
  });
  expect(tags).toHaveBeenNthCalledWith(3, engine, arn(name), expect.any(AbortSignal));
  expect(dialog.save).toBeDisabled();
  expect(dialog.value).toHaveValue('draft value');

  fireEvent.click(retry.getElement());
  await waitFor(() => expect(dialog.save).toBeEnabled());
  expect(tags).toHaveBeenNthCalledWith(4, engine, arn(name), expect.any(AbortSignal));
  expect(dialog.value).toHaveValue('draft value');
  expect(save).toHaveBeenCalledOnce();
});

it.each(['Escape', 'Close', 'Cancel'])('returns focus to Manage tags after Retry and %s', async (method) => {
  tags.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Tag read failed')).mockResolvedValue(initial);
  save.mockRejectedValueOnce(refuse(TAG_RESOURCE, 400));
  open();
  const dialog = await manage();
  fireEvent.change(dialog.value, { target: { value: 'draft value' } });
  fireEvent.click(dialog.save);

  const retry = await waitFor(() => {
    const alert = required(dialog.modal.findContent().findAllAlerts()[1], 'Tag read refusal');
    return required(alert.findActionSlot()?.findButton(), 'Retry button');
  });
  expect(retry.getElement()).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(dialog.save).toHaveFocus());
  expect(dialog.value).toHaveValue('draft value');
  expect(retry.getElement()).not.toBeInTheDocument();
  expect(manageButton()).toBe(dialog.trigger);

  if (method === 'Escape') fireEvent.keyDown(dialog.save, { key: 'Escape', code: 'Escape', keyCode: 27 });
  else if (method === 'Close') dialog.modal.findDismissButton().click();
  else dialog.cancel.click();
  expect(page.findModal()).toBeNull();
  expect(dialog.trigger).toHaveFocus();
});
