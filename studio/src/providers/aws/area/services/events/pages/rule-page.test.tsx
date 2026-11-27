import type { RuleState, Target } from '@aws-sdk/client-eventbridge';
import Button from '@cloudscape-design/components/button';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { StrictMode, useRef, useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, usePageFlash, type HandOverNote } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { getRule, listRuleTargets, type RuleRead } from '../rule-api';
import {
  DeleteAfterRemovalError,
  deleteRule,
  RemoveTargetsError,
  removeRuleTarget,
  setRuleEnabled,
} from '../rule-change-api';
import { rulePath } from '../format';
import { putRuleTargets } from '../target-api';
import { RulePage } from './rule-page';

vi.mock('../rule-api', async (original) => ({
  ...(await original<typeof import('../rule-api')>()),
  getRule: vi.fn(),
  listRuleTargets: vi.fn(),
}));

vi.mock('../rule-change-api', async (original) => ({
  ...(await original<typeof import('../rule-change-api')>()),
  deleteRule: vi.fn(),
  removeRuleTarget: vi.fn(),
  setRuleEnabled: vi.fn(),
}));

vi.mock('../target-api', async (original) => ({
  ...(await original<typeof import('../target-api')>()),
  putRuleTargets: vi.fn(),
}));
vi.mock('../target-sources', async (original) => ({
  ...(await original<typeof import('../target-sources')>()),
  targetChoiceSource: (_kind: string, endpoint: string) => ({
    key: ['topics'],
    endpoint,
    operation: 'ListTopics',
    read: () => Promise.resolve({ items: [{ label: 'Orders', value: 'arn:topic', description: 'arn:topic' }] }),
    optionOf: (resource: { value: string; label: string }) => resource,
  }),
}));

vi.mock('../../../area-page', async (original) => {
  const area = await original<typeof import('../../../area-page')>();
  return {
    ...area,
    areaPage: (path: string) => {
      if (path !== handOverPath) return area.areaPage(path);
      const page = area.areaPage(destination);
      if (page.kind !== 'screen') throw new Error('Expected the EventBridge rule screen');
      return { ...page, screen: { ...page.screen, Page: HandOverSource } };
    },
  };
});

const operation = 'DescribeRule';
const engineOrigin = 'http://127.0.0.1:8314';
const arn = 'arn:aws:events:us-east-1:000000000000:rule/../.';
const found = { kind: 'found', rule: { Arn: arn, Description: 'Routes orders' } } satisfies RuleRead;
const read = vi.mocked(getRule);
const readTargets = vi.mocked(listRuleTargets);
const changeState = vi.mocked(setRuleEnabled);
const remove = vi.mocked(removeRuleTarget);
const drop = vi.mocked(deleteRule);
const add = vi.mocked(putRuleTargets);

beforeEach(() => {
  read.mockReset();
  changeState.mockReset();
  remove.mockReset();
  drop.mockReset();
  add.mockReset().mockResolvedValue(undefined);
  readTargets.mockReset().mockResolvedValue([]);
});

function open() {
  const resources = vi.fn();
  const show = vi.fn();
  const handOver = vi.fn();
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <MemoryRouter>
            <QueryClientProvider client={client}>
              <PageResourcesContext.Provider value={resources}>
                <PageFlashContext.Provider value={{ show, handOver }}>
                  <RulePage connection={{ engineOrigin, result: undefined }} params={{ bus: '*..', rule: '*.' }} />
                </PageFlashContext.Provider>
              </PageResourcesContext.Provider>
            </QueryClientProvider>
          </MemoryRouter>
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(<Area />);
  return { page: createWrapper(container), container, resources, show, handOver, client };
}

it('uses the address to read the rule before reading its targets', async () => {
  let finishRead: (value: RuleRead) => void = () => {
    throw new Error('The rule read has not started');
  };
  read.mockImplementationOnce(
    () =>
      new Promise<RuleRead>((resolve) => {
        finishRead = resolve;
      }),
  );
  const { page, resources } = open();
  expect(page.findHeader()?.findHeadingText().getElement().textContent).toBe('.');
  expect(resources).toHaveBeenCalledWith({ word: 'targets' });
  await waitFor(() => expect(read).toHaveBeenCalledWith(engineOrigin, '..', '.', expect.any(AbortSignal)));
  expect(readTargets).not.toHaveBeenCalled();
  expect(page.findStatusIndicator()?.getElement().textContent).toBe('Loading rule');

  finishRead(found);
  await waitFor(() => expect(readTargets).toHaveBeenCalledWith(engineOrigin, '..', '.', expect.any(AbortSignal)));
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent(/^No targets$/));
});

it.each(['Rule . does not exist on EventBus ...', 'Event bus .. does not exist.'])(
  'shows Rule not found for "%s" and skips the targets read',
  async (message) => {
    read.mockResolvedValueOnce({ kind: 'not-found', message });
    const { page } = open();
    const state = page.findContainer()?.getElement();
    await waitFor(() => expect(state).toHaveTextContent('Rule not found'));
    expect(state).toHaveTextContent(message);
    const back = page.findButton('a')?.getElement();
    expect(back).toHaveAccessibleName('Go to Rules');
    expect(back).toHaveAttribute('href', '/aws/events/rules');
    expect(readTargets).not.toHaveBeenCalled();
  },
);

it.each([
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Policy denied' }, 'Access denied', 'Policy denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${engineOrigin} did not answer`, ''],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Read refused' },
    'The rule could not be read',
    'Read refused',
  ],
] satisfies [RequestFailure, string, string][])(
  'shows the rule failure %j and retries the rule',
  async (failure, status, detail) => {
    read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(found);
    const { page } = open();
    await waitFor(() => expect(page.findStatusIndicator()?.getElement().textContent).toBe(status));
    if (detail) expect(page.findContainer()?.getElement()).toHaveTextContent(detail);
    expect(readTargets).not.toHaveBeenCalled();
    const retry = page.findButton()?.getElement();
    expect(retry).toHaveAccessibleName('Retry');
    if (retry) fireEvent.click(retry);
    await waitFor(() => expect(readTargets).toHaveBeenCalledOnce());
    expect(read).toHaveBeenCalledTimes(2);
  },
);

it('keeps the rule details visible when only the targets read fails', async () => {
  read.mockResolvedValueOnce(found);
  readTargets.mockRejectedValueOnce(
    new RequestError({
      kind: 'access-denied',
      operation: 'ListTargetsByRule',
      message: 'Targets refused',
    }),
  );
  const { page } = open();
  await waitFor(() =>
    expect(page.findTable()?.findEmptySlot()?.findStatusIndicator()?.getElement().textContent).toBe('Access denied'),
  );
  expect(page.findKeyValuePairs()?.findItems()[0]?.findValue()?.getElement().textContent).toBe(arn);
  expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent(
    'ListTargetsByRule was refused: Targets refused',
  );
});

const queue = { Id: 'queue', Arn: 'arn:aws:sqs:us-east-1:000000000000:orders' } satisfies Target;
const topic = { Id: 'topic', Arn: 'arn:aws:sns:us-east-1:000000000000:orders' } satisfies Target;
const logs = { Id: 'logs', Arn: 'arn:aws:logs:us-east-1:000000000000:log-group:orders' } satisfies Target;
const ruleIn = (State: RuleState): RuleRead => ({ ...found, rule: { ...found.rule, State } });
const refused = (operation: string, message: string) =>
  new RequestError({ kind: 'other', operation, code: 'ValidationException', message });

type Page = ReturnType<typeof createWrapper>;

function headerAction(page: Page, name: string) {
  const button = page
    .findHeader()
    ?.findActions()
    ?.findAllButtons()
    .find((candidate) => candidate.findTextRegion()?.getElement().textContent === name);
  if (!button) throw new Error(`Expected header button ${name}`);
  return button;
}

function headerButton(page: Page, name: string) {
  return headerAction(page, name).getElement();
}

async function modal(page: Page) {
  return waitFor(() => {
    const dialog = page.findModal();
    if (!dialog) throw new Error('Expected an open dialog');
    return dialog;
  });
}

async function openDelete(page: Page) {
  await waitFor(() => expect(headerButton(page, 'Delete rule')).toBeEnabled());
  fireEvent.click(headerButton(page, 'Delete rule'));
  return modal(page);
}

function confirmDelete(dialog: Awaited<ReturnType<typeof modal>>) {
  const field = dialog.findContent().findInput()?.findNativeInput().getElement();
  const [, confirm] = dialog.findFooter()?.findAllButtons() ?? [];
  if (!field || !confirm) throw new Error('Expected the delete controls');
  fireEvent.change(field, { target: { value: '.' } });
  fireEvent.click(confirm.getElement());
  return confirm;
}

async function confirmRemove(page: Page) {
  const button = await waitFor(() => {
    const action = page.findTable()?.findBodyCell(1, 5)?.findButton();
    if (!action) throw new Error('Expected the target Remove button');
    return action;
  });
  fireEvent.click(button.getElement());
  const dialog = await modal(page);
  const [, confirm] = dialog.findFooter()?.findAllButtons() ?? [];
  if (!confirm) throw new Error('Expected the Remove confirmation');
  fireEvent.click(confirm.getElement());
  return dialog;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function flashText(callback: ReturnType<typeof vi.fn>, argument = 0) {
  const result = callback.mock.lastCall?.[argument] as import('../../../components/page-flash').FlashResult | undefined;
  if (!result) throw new Error('Expected a page flash');
  const { container, unmount } = render(
    <>
      {result.map((item, index) => (
        <div key={index}>
          {item.header}
          {item.content}
        </div>
      ))}
    </>,
  );
  const message = container.textContent;
  unmount();
  return message;
}

it.each([
  ['ENABLED', 'Disable'],
  ['DISABLED', 'Enable'],
  ['ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS', 'Disable'],
] satisfies [RuleState, string][])('offers the correct switch action in %s', async (state, label) => {
  read.mockResolvedValue(ruleIn(state));
  const { page } = open();
  await waitFor(() => expect(headerButton(page, label)).toBeEnabled());
});

it.each([true, false])('reports the switch to enabled=%s and reads the rule again', async (enable) => {
  const pending = deferred<undefined>();
  changeState.mockReturnValueOnce(pending.promise);
  read
    .mockResolvedValueOnce(ruleIn(enable ? 'DISABLED' : 'ENABLED'))
    .mockResolvedValueOnce(ruleIn(enable ? 'ENABLED' : 'DISABLED'));
  const { page, show } = open();
  const button = await waitFor(() => headerButton(page, enable ? 'Enable' : 'Disable'));
  fireEvent.click(button);
  const action = headerAction(page, enable ? 'Enable' : 'Disable');
  expect(action.isDisabled()).toBe(true);
  expect(action.findLoadingIndicator()).not.toBeNull();
  expect(changeState).toHaveBeenCalledExactlyOnceWith(engineOrigin, '..', '.', enable, expect.any(AbortSignal));

  await act(async () => pending.resolve(undefined));
  await waitFor(() => expect(headerButton(page, enable ? 'Disable' : 'Enable')).toBeEnabled());
  expect(flashText(show)).toBe(`Rule . ${enable ? 'enabled' : 'disabled'}.`);
  expect(read).toHaveBeenCalledTimes(2);
  expect(readTargets).toHaveBeenCalledOnce();
});

it('flashes a refused switch with its operation and keeps the rule state', async () => {
  read.mockResolvedValue(ruleIn('ENABLED'));
  changeState.mockRejectedValueOnce(refused('DisableRule', 'Switch refused'));
  const { page, show } = open();
  fireEvent.click(await waitFor(() => headerButton(page, 'Disable')));
  await waitFor(() => expect(show).toHaveBeenCalledOnce());
  expect(flashText(show)).toBe('DisableRule failedValidationException: Switch refused');
  expect(headerButton(page, 'Disable')).toBeEnabled();
  expect(read).toHaveBeenCalledOnce();
});

it.each([
  ['ENABLED', 'Disable', 'DisableRule'],
  ['DISABLED', 'Enable', 'EnableRule'],
] satisfies [RuleState, string, string][])(
  'keeps the switch unavailable when %s returns 501',
  async (state, label, op) => {
    read.mockResolvedValue(ruleIn(state));
    changeState.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: op }));
    const { page, show } = open();
    fireEvent.click(await waitFor(() => headerButton(page, label)));
    await waitFor(() => expect(show).toHaveBeenCalledOnce());
    expect(flashText(show)).toContain(
      `Not implemented by the emulatorThe emulator answered 501 Not Implemented for ${op}.`,
    );
    expect(headerButton(page, label)).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(headerButton(page, label));
    expect(changeState).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  },
);

it.each([
  ['before', 'value'],
  ['after', 'value'],
  ['before', 'failure'],
  ['after', 'failure'],
])('ignores an old rule read returning %s the switch read (%s)', async (order, outcome) => {
  const old = deferred<RuleRead>();
  const fresh = deferred<RuleRead>();
  read.mockResolvedValueOnce(ruleIn('ENABLED')).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  changeState.mockResolvedValueOnce(undefined);
  const { page, client, show } = open();
  const disable = await waitFor(() => headerButton(page, 'Disable'));
  void client.refetchQueries({ queryKey: ['events', 'rule'] });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  fireEvent.click(disable);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  const answerOld = () =>
    outcome === 'value' ? old.resolve(ruleIn('ENABLED')) : old.reject(refused(operation, 'Old refusal'));
  if (order === 'before') await act(async () => answerOld());
  await act(async () => fresh.resolve(ruleIn('DISABLED')));
  await waitFor(() => expect(headerButton(page, 'Enable')).toBeEnabled());
  if (order === 'after') await act(async () => answerOld());
  expect(headerButton(page, 'Enable')).toBeEnabled();
  expect(flashText(show)).toBe('Rule . disabled.');
});

it('closes the remove dialog, flashes success and refreshes the targets', async () => {
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([queue]).mockResolvedValueOnce([]);
  remove.mockResolvedValueOnce(undefined);
  const { page, show } = open();
  await confirmRemove(page);
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No targets'));
  expect(page.findModal()).toBeNull();
  expect(flashText(show)).toBe('Target queue removed from ..');
  expect(readTargets).toHaveBeenCalledTimes(2);
});

it.each(['before', 'after'])('ignores a targets read returning %s the read started by removal', async (order) => {
  const old = deferred<Target[]>();
  const fresh = deferred<Target[]>();
  const removal = deferred<undefined>();
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([queue]).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  remove.mockReturnValueOnce(removal.promise);
  const { page, client, show } = open();
  await waitFor(() => expect(page.findTable()?.findRows()).toHaveLength(1));
  void client.refetchQueries({ queryKey: ['events', 'targets'] });
  await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(2));
  await confirmRemove(page);
  await act(async () => removal.resolve(undefined));
  await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(3));
  if (order === 'before') await act(async () => old.resolve([queue]));
  await act(async () => fresh.resolve([]));
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No targets'));
  if (order === 'after') await act(async () => old.resolve([queue]));
  expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No targets');
  expect(page.findModal()).toBeNull();
  expect(flashText(show)).toBe('Target queue removed from ..');
});

it('keeps the removal result when its fresh read fails and offers Retry', async () => {
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([queue]).mockRejectedValueOnce(refused('ListTargetsByRule', 'Refresh refused'));
  remove.mockResolvedValueOnce(undefined);
  const { page, show } = open();
  await confirmRemove(page);
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('Refresh refused'));
  expect(page.findTable()?.findEmptySlot()?.findButton()?.getElement()).toHaveAccessibleName('Retry');
  expect(page.findModal()).toBeNull();
  expect(flashText(show)).toBe('Target queue removed from ..');
});

it('waits for targets then hands off a successful delete to Rules for this bus', async () => {
  const targets = deferred<Target[]>();
  read.mockResolvedValue(found);
  readTargets.mockReturnValueOnce(targets.promise);
  drop.mockResolvedValueOnce(undefined);
  const { page, handOver, show } = open();
  await waitFor(() => expect(headerButton(page, 'Delete rule')).toBeDisabled());
  await act(async () => targets.resolve([queue]));
  confirmDelete(await openDelete(page));
  await waitFor(() => expect(handOver).toHaveBeenCalledOnce());
  expect(handOver.mock.lastCall?.[0]).toBe('/aws/events/rules?bus=..');
  expect(flashText(handOver, 1)).toBe('Rule . deleted.');
  expect(show).not.toHaveBeenCalled();
});

it.each(['before', 'after'])(
  'keeps missing reads that answer %s the delete from replacing the page or dialog',
  async (order) => {
    const oldRule = deferred<RuleRead>();
    const oldTargets = deferred<Target[]>();
    const deletion = deferred<undefined>();
    read.mockResolvedValueOnce(found).mockReturnValueOnce(oldRule.promise);
    readTargets.mockResolvedValueOnce([queue]).mockReturnValueOnce(oldTargets.promise);
    drop.mockReturnValueOnce(deletion.promise);
    const { page, client, container, handOver } = open();
    const dialog = await openDelete(page);
    void client.refetchQueries({ queryKey: ['events', 'rule'] });
    void client.refetchQueries({ queryKey: ['events', 'targets'] });
    await waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
      expect(readTargets).toHaveBeenCalledTimes(2);
    });
    const action = confirmDelete(dialog);
    const answerOld = () => {
      oldRule.resolve({ kind: 'not-found', message: 'Rule no longer exists' });
      oldTargets.reject(refused('ListTargetsByRule', 'Rule no longer exists'));
    };
    if (order === 'before') {
      await act(async () => answerOld());
      expect(page.findModal()?.getElement()).toBeVisible();
      expect(action.isDisabled()).toBe(true);
      expect(action.findLoadingIndicator()).not.toBeNull();
      expect(container).toHaveTextContent('Routes orders');
      expect(container).not.toHaveTextContent('Rule no longer exists');
      expect(container).not.toHaveTextContent('Rule not found');
    }
    await act(async () => deletion.resolve(undefined));
    if (order === 'after') await act(async () => answerOld());
    expect(handOver.mock.lastCall?.[0]).toBe('/aws/events/rules?bus=..');
    expect(flashText(handOver, 1)).toBe('Rule . deleted.');
    expect(container).not.toHaveTextContent('Rule not found');
  },
);

it('shows a missing rule after dismissing the delete dialog without confirming', async () => {
  const old = deferred<RuleRead>();
  read.mockResolvedValueOnce(found).mockReturnValueOnce(old.promise);
  const { page, client, container } = open();
  const dialog = await openDelete(page);
  void client.refetchQueries({ queryKey: ['events', 'rule'] });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => old.resolve({ kind: 'not-found' }));
  expect(container).not.toHaveTextContent('Rule not found');
  const [cancel] = dialog.findFooter()?.findAllButtons() ?? [];
  if (!cancel) throw new Error('Expected the Cancel button');
  fireEvent.click(cancel.getElement());
  await waitFor(() => expect(container).toHaveTextContent('Rule not found'));
  expect(drop).not.toHaveBeenCalled();
});

it('reads the targets again behind the dialog after a delete refused following removal', async () => {
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([queue]).mockResolvedValueOnce([]);
  drop.mockRejectedValueOnce(new DeleteAfterRemovalError(refused('DeleteRule', 'Delete refused')));
  const { page, handOver } = open();
  confirmDelete(await openDelete(page));
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No targets'));
  expect(page.findModal()?.findContent().findAlert()?.getElement()).toHaveTextContent(
    "The rule's targets were removed, but the rule was not deleted.",
  );
  expect(handOver).not.toHaveBeenCalled();
});

it.each(['ordinary', 'before', 'after'])('refreshes a partial removal behind the open dialog (%s)', async (order) => {
  const old = deferred<Target[]>();
  const fresh = deferred<Target[]>();
  const deletion = deferred<undefined>();
  read.mockResolvedValue(found);
  const all = [queue, topic, logs];
  readTargets.mockResolvedValueOnce(all);
  if (order !== 'ordinary') readTargets.mockReturnValueOnce(old.promise);
  readTargets.mockReturnValueOnce(fresh.promise);
  drop.mockReturnValueOnce(deletion.promise);
  const { page, client, handOver, show } = open();
  const dialog = await openDelete(page);
  if (order !== 'ordinary') {
    void client.refetchQueries({ queryKey: ['events', 'targets'] });
    await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(2));
  }
  confirmDelete(dialog);
  await act(async () =>
    deletion.reject(
      new RemoveTargetsError([{ TargetId: 'topic', ErrorCode: 'Busy', ErrorMessage: 'Topic target refused' }]),
    ),
  );
  await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(order === 'ordinary' ? 2 : 3));
  if (order === 'before') await act(async () => old.resolve(all));
  await act(async () => fresh.resolve([topic]));
  await waitFor(() => expect(page.findTable()?.findRows()).toHaveLength(1));
  if (order === 'after') await act(async () => old.resolve(all));
  expect(page.findTable()?.findRows()).toHaveLength(1);
  expect(page.findTable()?.findBodyCell(1, 1)?.getElement()).toHaveTextContent('topic');
  const alert = page.findModal()?.findContent().findAlert()?.getElement();
  expect(alert).toHaveTextContent('RemoveTargets failed');
  expect(alert).toHaveTextContent('topic Busy: Topic target refused');
  expect(handOver).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});

const addedTarget = { Id: 'delivery', Arn: 'arn:topic' };

async function confirmAdd(page: Page) {
  await waitFor(() => expect(headerAction(page, 'Add target').isDisabled()).toBe(false));
  fireEvent.click(headerButton(page, 'Add target'));
  const dialog = await modal(page);
  const input = dialog.findContent().findInput()?.findNativeInput().getElement();
  if (!input) throw new Error('Expected target ID field');
  fireEvent.change(input, { target: { value: addedTarget.Id } });
  act(() => dialog.findContent().findSelect()?.openDropdown());
  act(() => dialog.findContent().findSelect()?.selectOptionByValue('sns'));
  const select = dialog.findContent().findAllSelects()[1];
  act(() => select?.openDropdown());
  await waitFor(() => expect(select?.findDropdown().findOptionByValue(addedTarget.Arn)).toBeTruthy());
  act(() => select?.selectOptionByValue(addedTarget.Arn));
  const confirm = dialog.findFooter()?.findAllButtons()[1];
  if (!confirm) throw new Error('Expected Add target confirmation');
  act(() => confirm.click());
}

it('offers Add target after reading fewer than five targets and opens its dialog', async () => {
  const pending = deferred<Target[]>();
  read.mockResolvedValue(found);
  readTargets.mockReturnValueOnce(pending.promise);
  const { page } = open();
  await waitFor(() => expect(headerAction(page, 'Add target').isDisabled()).toBe(true));
  await act(async () => pending.resolve([queue]));
  await waitFor(() => expect(headerAction(page, 'Add target').isDisabled()).toBe(false));
  fireEvent.click(headerButton(page, 'Add target'));
  expect((await modal(page)).findHeader()?.getElement()).toHaveTextContent('Add target');
});

it('shows why Add target is unavailable after reading five targets', async () => {
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce(
    Array.from({ length: 5 }, (_, i) => ({ Id: String(i), Arn: `arn:target:${String(i)}` })),
  );
  const { page } = open();
  await waitFor(() =>
    expect(headerAction(page, 'Add target').findDisabledReason()?.getElement()).toHaveTextContent(
      'A rule holds at most 5 targets.',
    ),
  );
  expect(headerAction(page, 'Add target').isDisabled()).toBe(true);
});

it('closes Add target, flashes the result and refreshes the targets', async () => {
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([addedTarget]);
  const { page, show } = open();
  await confirmAdd(page);
  await waitFor(() => expect(page.findTable()?.findBodyCell(1, 1)?.getElement()).toHaveTextContent('delivery'));
  expect(page.findModal()).toBeNull();
  expect(flashText(show)).toBe('Target delivery added to ..');
  expect(readTargets).toHaveBeenCalledTimes(3);
});

it.each(['before', 'after'])('ignores an old targets read answering %s the one started by adding', async (order) => {
  const old = deferred<Target[]>();
  const fresh = deferred<Target[]>();
  read.mockResolvedValue(found);
  readTargets
    .mockResolvedValueOnce([queue])
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([queue])
    .mockReturnValueOnce(fresh.promise);
  const { page, client, show } = open();
  await waitFor(() => expect(page.findTable()?.findRows()).toHaveLength(1));
  void client.refetchQueries({ queryKey: ['events', 'targets'] });
  await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(2));
  await confirmAdd(page);
  await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(4));
  if (order === 'before') await act(async () => old.resolve([queue]));
  await act(async () => fresh.resolve([queue, addedTarget]));
  await waitFor(() => expect(page.findTable()?.findBodyCell(2, 1)?.getElement()).toHaveTextContent('delivery'));
  if (order === 'after') await act(async () => old.resolve([queue]));
  expect(page.findTable()?.findRows()).toHaveLength(2);
  expect(page.findModal()).toBeNull();
  expect(flashText(show)).toBe('Target delivery added to ..');
});

it('shows the fresh read failure and Retry while keeping the addition result', async () => {
  read.mockResolvedValue(found);
  readTargets
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(refused('ListTargetsByRule', 'Refresh refused'));
  const { page, show } = open();
  await confirmAdd(page);
  await waitFor(() => expect(page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('Refresh refused'));
  expect(page.findTable()?.findEmptySlot()?.findButton()?.getElement()).toHaveAccessibleName('Retry');
  expect(page.findModal()).toBeNull();
  expect(flashText(show)).toBe('Target delivery added to ..');
});

const handOverPath = '/aws/events/from-test';
const destination = rulePath('..', '.');
const warning = 'PutTargets was not implemented while creating the rule.';
const matchingNote = { notImplemented: 'PutTargets', bus: '..', rule: '.' };
let offeredNote: HandOverNote;
const handOverText = 'Open the created rule';

function HandOverSource() {
  const flash = usePageFlash();
  return (
    <Button onClick={() => flash.handOver(destination, [{ type: 'warning', content: warning }], offeredNote)}>
      {handOverText}
    </Button>
  );
}

function openFrame({
  path = handOverPath,
  strict = false,
  note = matchingNote,
}: {
  path?: string;
  strict?: boolean;
  note?: HandOverNote;
} = {}) {
  offeredNote = note;
  const initialPath = path.split('?')[0];
  const connection = {
    engineOrigin,
    result: {
      kind: 'connected',
      checkedAt: 1,
      emulator: { port: 9327, endpoint: 'https://127.0.0.1:9327' },
      target: 'earlier-target',
    } as const,
  };
  function Frame({ generation }: { generation: number }) {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [last, setLast] = useState({ path: initialPath, visits: 0 });
    const visits = last.visits + Number(pathname !== last.path);
    if (pathname !== last.path) setLast({ path: pathname, visits });
    return (
      <>
        <Button onClick={() => void navigate(rulePath('..', 'other'))}>Open another rule</Button>
        <Button onClick={() => void navigate(destination)}>Open the original rule</Button>
        <AreaLayout
          headerSelector="#test-header"
          connection={connection}
          routeChanges={visits}
          targetGeneration={generation}
          onPageTitle={() => {}}
          onContentTarget={() => {}}
        />
      </>
    );
  }
  const client = new QueryClient();
  const tree = (generation: number) => {
    const element = (
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={client}>
          <Frame generation={generation} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    return strict ? <StrictMode>{element}</StrictMode> : element;
  };
  const view = render(tree(0));
  const ui = within(view.container);
  return {
    page: createWrapper(view.container),
    ui,
    handOver: () => fireEvent.click(ui.getByRole('button', { name: handOverText })),
    changeTarget: () => view.rerender(tree(1)),
  };
}

async function readyOffered(ui: ReturnType<typeof within>) {
  await waitFor(() => expect(ui.getByRole('button', { name: 'Add target', exact: true })).toBeEnabled());
}

function expectUnavailable(ui: ReturnType<typeof within>) {
  const control = ui.getByRole('button', { name: 'Add target', exact: true });
  expect(control).toHaveAttribute('aria-disabled', 'true');
  expect(control).toHaveAccessibleDescription('Not implemented by the emulator (PutTargets).');
  return control;
}

it('keeps the hand-over refusal after reading again, dismissal and a later result', async () => {
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([queue]).mockResolvedValueOnce([]);
  remove.mockResolvedValueOnce(undefined);
  const frame = openFrame();
  frame.handOver();
  const button = await waitFor(() => expectUnavailable(frame.ui));
  await waitFor(() => expect(frame.page.findTable()?.findRows()).toHaveLength(1));
  fireEvent.click(button);
  expect(frame.page.findModal()).toBeNull();
  expect(add).not.toHaveBeenCalled();
  expect(frame.ui.getAllByText(warning).length).toBeGreaterThan(0);
  fireEvent.click(frame.ui.getByRole('button', { name: 'Dismiss' }));
  await waitFor(() => expect(frame.ui.queryByText(warning)).not.toBeInTheDocument());
  expectUnavailable(frame.ui);
  await confirmRemove(frame.page);
  await waitFor(() => expect(frame.page.findTable()?.findEmptySlot()?.getElement()).toHaveTextContent('No targets'));
  expectUnavailable(frame.ui);
  expect(frame.page.findFlashbar()?.getElement()).toHaveTextContent('Target queue removed from ..');
});

it('keeps the handed refusal under StrictMode', async () => {
  read.mockResolvedValue(found);
  const frame = openFrame({ strict: true });
  frame.handOver();
  await waitFor(() => expectUnavailable(frame.ui));
});

it.each([
  { ...matchingNote, bus: 'other' },
  { ...matchingNote, rule: 'other' },
])('offers Add target when the note names another resource %j', async (note) => {
  read.mockResolvedValue(found);
  const frame = openFrame({ note });
  frame.handOver();
  await readyOffered(frame.ui);
});

it.each([destination, `${destination}?not-implemented=PutTargets`])(
  'offers Add target on a fresh load of %s',
  async (path) => {
    read.mockResolvedValue(found);
    const frame = openFrame({ path });
    await readyOffered(frame.ui);
    expect(frame.ui.queryByText(/PutTargets/)).not.toBeInTheDocument();
  },
);

it.each(['before', 'while'])(
  'enables Add target and clears the warning when the target changes %s showing the rule',
  async (timing) => {
    read.mockResolvedValue(found);
    const frame = openFrame();
    if (timing === 'before') {
      act(() => {
        frame.handOver();
        frame.changeTarget();
      });
    } else {
      frame.handOver();
      await waitFor(() => expectUnavailable(frame.ui));
      expect(frame.ui.getAllByText(warning).length).toBeGreaterThan(0);
      frame.changeTarget();
    }
    await readyOffered(frame.ui);
    expect(frame.page.findFlashbar()).toBeNull();
    expect(frame.ui.queryByText(/PutTargets/)).not.toBeInTheDocument();
  },
);

it('offers Add target on a linked rule and on returning to the original rule', async () => {
  read.mockResolvedValue(found);
  const frame = openFrame();
  frame.handOver();
  await waitFor(() => expectUnavailable(frame.ui));
  fireEvent.click(frame.ui.getByRole('button', { name: 'Open another rule' }));
  await readyOffered(frame.ui);
  fireEvent.click(frame.ui.getByRole('button', { name: 'Open the original rule' }));
  await readyOffered(frame.ui);
  expect(frame.ui.queryByText(/PutTargets/)).not.toBeInTheDocument();
});
