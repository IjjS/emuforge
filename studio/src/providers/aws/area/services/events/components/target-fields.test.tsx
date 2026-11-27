import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { buildTarget, emptyTarget, validateTarget, type TargetDraft } from '../target-form';
import { getTargetQueueArn, listTargetLogGroups, listTargetQueues, listTargetTopics } from '../target-sources';
import { TargetFields } from './target-fields';

vi.mock('../target-sources', async (original) => {
  const sources = await original<typeof import('../target-sources')>();
  const readers = { sqs: vi.fn(), sns: vi.fn(), logs: vi.fn() };
  return {
    ...sources,
    listTargetQueues: readers.sqs,
    listTargetTopics: readers.sns,
    listTargetLogGroups: readers.logs,
    getTargetQueueArn: vi.fn(),
    targetChoiceSource: (kind: keyof typeof readers, endpoint: string) => ({
      ...sources.targetChoiceSource(kind, endpoint),
      read: (origin: string, _text: string, token: string | undefined, signal: AbortSignal) =>
        readers[kind](origin, token, signal) as ReturnType<typeof listTargetQueues>,
    }),
  };
});

const connection = { engineOrigin: 'http://127.0.0.1:8327', result: undefined };
const queueA = { value: 'https://127.0.0.1/a.fifo', label: 'a.fifo', description: 'Queue A' };
const queueB = { value: 'https://127.0.0.1/b', label: 'b', description: 'Queue B' };
const topic = { value: 'arn:topic', label: 'orders', description: 'arn:topic' };
const group = { value: 'arn:log', label: '/orders', description: 'arn:log' };
const arnRead = vi.mocked(getTargetQueueArn);
const queues = vi.mocked(listTargetQueues);
const topics = vi.mocked(listTargetTopics);
const logs = vi.mocked(listTargetLogGroups);
const notImplemented = (operation: string) => new RequestError({ kind: 'not-implemented', operation });

beforeEach(() => {
  queues.mockReset().mockResolvedValue({ items: [queueA, queueB] });
  topics.mockReset().mockResolvedValue({ items: [topic] });
  logs.mockReset().mockResolvedValue({ items: [group] });
  arnRead.mockReset().mockResolvedValue('arn:queue');
});

function open() {
  let draft: TargetDraft = { ...emptyTarget(), id: 'delivery' };
  function Form() {
    const [value, setValue] = useState(draft);
    draft = value;
    return <TargetFields connection={connection} draft={value} onChange={setValue} />;
  }
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <Form />
    </QueryClientProvider>,
  );
  const page = createWrapper(container);
  function field(label: string) {
    return page.findAllFormFields().find((candidate) => candidate.findLabel()?.getElement().textContent === label);
  }
  function select(label: string) {
    const formField = field(label);
    const found = formField && createWrapper(formField.getElement()).findSelect();
    if (!found) throw new Error(`Expected a select for ${label}`);
    return found;
  }
  async function choose(label: string, value: string) {
    const current = select(label);
    act(() => current.openDropdown());
    await waitFor(() => expect(current.findDropdown().findOptionByValue(value)).not.toBeNull());
    act(() => current.selectOptionByValue(value));
  }
  return { page, field, select, choose, draft: () => draft };
}

it('shows the ID constraint and describes the only three kinds in the choice', () => {
  const form = open();
  expect(form.field('Target ID')?.findConstraint()?.getElement()).toHaveTextContent('1 to 64 characters');
  const select = form.select('Target kind');
  act(() => select.openDropdown());
  expect(select.findDropdown().findOptions()).toHaveLength(3);
  for (const [kind, description] of [
    ['sqs', 'allows events.amazonaws.com to send messages.'],
    ['sns', 'allows events.amazonaws.com to publish.'],
    ['logs', 'Each event is written to a log stream named after the rule.'],
  ]) {
    expect(
      select
        .findDropdown()
        .findOptionByValue(kind ?? '')
        ?.getElement(),
    ).toHaveTextContent(description ?? '');
  }
  expect(form.page.findAllInputs()).toHaveLength(1);
  expect(queues).not.toHaveBeenCalled();
});

it('lists resources only for the selected kind, clears a choice and shows empty lists', async () => {
  const form = open();
  await form.choose('Target kind', 'sns');
  await form.choose('Topic', topic.value);
  expect(form.draft().resource).toEqual(topic);
  await form.choose('Target kind', 'logs');
  expect(form.draft().resource).toBeUndefined();
  await form.choose('Log group', group.value);
  expect(form.draft().resource).toEqual(group);
  queues.mockResolvedValueOnce({ items: [] });
  await form.choose('Target kind', 'sqs');
  const select = form.select('Queue');
  act(() => select.openDropdown());
  await waitFor(() => expect(select.findDropdown().getElement()).toHaveTextContent('No queues'));
});

it('describes each input choice and opens the corresponding field', async () => {
  const form = open();
  const select = form.select('What the target receives');
  act(() => select.openDropdown());
  expect(select.findDropdown().findOptionByValue('matched')?.getElement()).toHaveTextContent(
    'The whole event, as JSON.',
  );
  expect(select.findDropdown().findOptionByValue('constant')?.getElement()).toHaveTextContent(
    'The same JSON text for every event.',
  );
  expect(select.findDropdown().findOptionByValue('path')?.getElement()).toHaveTextContent('such as $.detail.');
  act(() => select.selectOptionByValue('constant'));
  const json = form.field('JSON text');
  expect(json && createWrapper(json.getElement()).findTextarea()).toBeTruthy();
  await form.choose('What the target receives', 'path');
  expect(form.field('JSON text')).toBeUndefined();
  const path = form.field('JSON path');
  expect(path && createWrapper(path.getElement()).findInput()).toBeTruthy();
});

function deferredArn() {
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((answer, refuse) => {
    resolve = answer;
    reject = refuse;
  });
  return { resolve, reject, promise };
}

it('waits for the queue ARN and keeps its Retry at the field after a read fails', async () => {
  const pending = deferredArn();
  arnRead.mockReturnValueOnce(pending.promise);
  const form = open();
  await form.choose('Target kind', 'sqs');
  await form.choose('Queue', queueB.value);
  await waitFor(() => expect(form.page.findStatusIndicator()?.getElement()).toHaveTextContent('Reading queue ARN'));
  expect(arnRead).toHaveBeenCalledWith(connection.engineOrigin, queueB.value, expect.any(AbortSignal));
  expect(buildTarget(form.draft())).toBeUndefined();
  await act(async () =>
    pending.reject(
      new RequestError({
        kind: 'other',
        operation: 'GetQueueAttributes',
        code: 'Denied',
        message: 'Queue read refused',
      }),
    ),
  );
  const retry = await waitFor(() => {
    expect(form.page.findStatusIndicator()?.getElement()).toHaveTextContent('The queue ARN could not be read');
    expect(form.page.getElement()).toHaveTextContent('Queue read refused');
    const button = form.page.findButton();
    expect(button?.getElement()).toHaveAccessibleName('Retry');
    return button;
  });
  act(() => retry?.click());
  await waitFor(() => expect(buildTarget(form.draft())?.Arn).toBe('arn:queue'));
  expect(arnRead).toHaveBeenCalledTimes(2);
});

it('requires a message group ID only when the chosen queue is FIFO', async () => {
  const form = open();
  await form.choose('Target kind', 'sqs');
  await form.choose('Queue', queueA.value);
  expect(form.field('Message group ID')?.findDescription()?.getElement()).toHaveTextContent(
    'Required for a FIFO queue.',
  );
  expect(validateTarget(form.draft()).messageGroupId).toBeDefined();
  await form.choose('Queue', queueB.value);
  expect(form.field('Message group ID')).toBeUndefined();
  expect(validateTarget(form.draft()).messageGroupId).toBeUndefined();
});

it.each(['before', 'after'])('drops the old queue ARN arriving %s the selected queue ARN', async (order) => {
  const a = deferredArn();
  const b = deferredArn();
  arnRead.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const form = open();
  await form.choose('Target kind', 'sqs');
  await form.choose('Queue', queueA.value);
  await waitFor(() => expect(arnRead).toHaveBeenCalledTimes(1));
  await form.choose('Queue', queueB.value);
  await waitFor(() => expect(arnRead).toHaveBeenCalledTimes(2));
  expect(arnRead.mock.calls[0]?.[2].aborted).toBe(true);
  if (order === 'before') await act(async () => a.resolve('arn:old'));
  expect(buildTarget(form.draft())).toBeUndefined();
  await act(async () => b.resolve('arn:selected'));
  await waitFor(() => expect(buildTarget(form.draft())?.Arn).toBe('arn:selected'));
  if (order === 'after') await act(async () => a.resolve('arn:old'));
  expect(buildTarget(form.draft())?.Arn).toBe('arn:selected');
});

it('drops the old queue answer after changing kind', async () => {
  const a = deferredArn();
  arnRead.mockReturnValueOnce(a.promise);
  const form = open();
  await form.choose('Target kind', 'sqs');
  await form.choose('Queue', queueA.value);
  await waitFor(() => expect(arnRead).toHaveBeenCalledTimes(1));
  await form.choose('Target kind', 'sns');
  await act(async () => a.resolve('arn:old'));
  expect(form.draft()).toMatchObject({ kind: 'sns', resource: undefined, queueArn: undefined });
  expect(arnRead.mock.calls[0]?.[2].aborted).toBe(true);
});

it('shows a failed choice read with Retry and reads that choice again', async () => {
  topics.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: 'ListTopics',
      code: 'Denied',
      message: 'Topic read refused',
    }),
  );
  const form = open();
  await form.choose('Target kind', 'sns');
  const select = form.select('Topic');
  act(() => select.openDropdown());
  await waitFor(() => expect(select.findDropdown().getElement()).toHaveTextContent('Topic read refused'));
  const retry = select.findErrorRecoveryButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  act(() => retry?.click());
  await waitFor(() => expect(select.findDropdown().findOptionByValue(topic.value)).not.toBeNull());
  expect(topics).toHaveBeenCalledTimes(2);
});

it.each([
  ['sqs', 'Queue', 'ListQueues', queues],
  ['sns', 'Topic', 'ListTopics', topics],
  ['logs', 'Log group', 'DescribeLogGroups', logs],
] as const)(
  'shows the unavailable %s list, offers no resource and keeps the row unsendable',
  async (kind, label, operation, reader) => {
    reader.mockRejectedValueOnce(notImplemented(operation));
    const form = open();
    await form.choose('Target kind', kind);
    const select = form.select(label);
    act(() => select.openDropdown());
    await waitFor(() =>
      expect(select.findDropdown().getElement()).toHaveTextContent('Not implemented by the emulator'),
    );
    expect(select.findDropdown().getElement()).toHaveTextContent(operation);
    expect(select.findDropdown().findOptions()).toHaveLength(0);
    expect(buildTarget(form.draft())).toBeUndefined();
  },
);

it('shows a GetQueueAttributes 501 at the queue and keeps the selected row unsendable', async () => {
  arnRead.mockRejectedValueOnce(notImplemented('GetQueueAttributes'));
  const form = open();
  await form.choose('Target kind', 'sqs');
  await form.choose('Queue', queueB.value);
  await waitFor(() =>
    expect(form.page.findStatusIndicator()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(form.page.getElement()).toHaveTextContent('GetQueueAttributes');
  expect(buildTarget(form.draft())).toBeUndefined();
});
