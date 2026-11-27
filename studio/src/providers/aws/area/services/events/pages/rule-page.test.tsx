import type { RuleState, Target } from '@aws-sdk/client-eventbridge';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext } from '../../../components/page-flash';
import { PageResourcesContext } from '../../../components/page-resources';
import { getRule, listRuleTargets, type RuleRead } from '../rule-api';
import {
  DeleteAfterRemovalError,
  deleteRule,
  RemoveTargetsError,
  removeRuleTarget,
  setRuleEnabled,
} from '../rule-change-api';
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

const operation = 'DescribeRule';
const engineOrigin = 'http://127.0.0.1:8314';
const arn = 'arn:aws:events:us-east-1:000000000000:rule/../.';
const found = { kind: 'found', rule: { Arn: arn, Description: 'Routes orders' } } satisfies RuleRead;
const read = vi.mocked(getRule);
const readTargets = vi.mocked(listRuleTargets);
const changeState = vi.mocked(setRuleEnabled);
const remove = vi.mocked(removeRuleTarget);
const drop = vi.mocked(deleteRule);

beforeEach(() => {
  read.mockReset();
  changeState.mockReset();
  remove.mockReset();
  drop.mockReset();
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

function headerButton(page: Page, name: string) {
  const button = page
    .findHeader()
    ?.findActions()
    ?.findAllButtons()
    .find((candidate) => candidate.getElement().textContent === name);
  if (!button) throw new Error(`Expected header button ${name}`);
  return button.getElement();
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
  const [, confirm] = dialog.findFooter().findAllButtons();
  if (!field || !confirm) throw new Error('Expected the delete controls');
  fireEvent.change(field, { target: { value: '.' } });
  fireEvent.click(confirm.getElement());
  return confirm.getElement();
}

async function confirmRemove(page: Page) {
  const button = await waitFor(() => {
    const action = page.findTable()?.findBodyCell(1, 5)?.findButton();
    if (!action) throw new Error('Expected the target Remove button');
    return action;
  });
  fireEvent.click(button.getElement());
  const dialog = await modal(page);
  const [, confirm] = dialog.findFooter().findAllButtons();
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
  const pending = deferred<void>();
  changeState.mockReturnValueOnce(pending.promise);
  read
    .mockResolvedValueOnce(ruleIn(enable ? 'DISABLED' : 'ENABLED'))
    .mockResolvedValueOnce(ruleIn(enable ? 'ENABLED' : 'DISABLED'));
  const { page, show } = open();
  const button = await waitFor(() => headerButton(page, enable ? 'Enable' : 'Disable'));
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(changeState).toHaveBeenCalledExactlyOnceWith(engineOrigin, '..', '.', enable, expect.any(AbortSignal));

  await act(async () => pending.resolve());
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
  const removal = deferred<void>();
  read.mockResolvedValue(found);
  readTargets.mockResolvedValueOnce([queue]).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  remove.mockReturnValueOnce(removal.promise);
  const { page, client, show } = open();
  await waitFor(() => expect(page.findTable()?.findRows()).toHaveLength(1));
  void client.refetchQueries({ queryKey: ['events', 'targets'] });
  await waitFor(() => expect(readTargets).toHaveBeenCalledTimes(2));
  await confirmRemove(page);
  await act(async () => removal.resolve());
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
    const deletion = deferred<void>();
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
      expect(action).toBeDisabled();
      expect(action).toHaveAttribute('aria-busy', 'true');
      expect(container).toHaveTextContent('Routes orders');
      expect(container).not.toHaveTextContent('Rule no longer exists');
      expect(container).not.toHaveTextContent('Rule not found');
    }
    await act(async () => deletion.resolve());
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
  const [cancel] = dialog.findFooter().findAllButtons();
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
  const deletion = deferred<void>();
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
